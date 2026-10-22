"""BloodBridge backend: one Lambda behind an API Gateway HTTP API.

Routes (all JSON):
    GET  /donors                      list donors (names masked)
    POST /donors                      register a donor
    GET  /requests                    list requests, newest first
    POST /requests                    create a request (verified hospitals only)
    GET  /requests/{id}               request + ranked notifications + queue + exclusions
    POST /requests/{id}/match         run the hard gate + EDPS ranking, notify the top batch
    POST /requests/{id}/respond       {"donorId": "...", "response": "accept"|"decline"}
    POST /requests/{id}/escalate      time out pending alerts, widen the radius, notify next batch
    POST /requests/{id}/fulfil        blood centre confirms the donation
    POST /seed                        load 45 synthetic donors

The matching engine (rank) mirrors api.js in the frontend so demo mode and
AWS mode behave the same. Safety boundary: the score only prioritizes outreach;
final screening and transfusion decisions stay with the licensed blood centre.

Storage is behind a small Store interface: DynamoStore in AWS, MemoryStore for
local tests (see test_local.py).
"""
import json
import math
import os
import random
import re
import time
import traceback
from datetime import datetime, timezone
from decimal import Decimal

# ---------------------------------------------------------------- constants
DAY = 86_400_000  # ms
BATCH_SIZE = 5
RADIUS_START, RADIUS_STEP, RADIUS_MAX = 10, 10, 50  # km
MIN_INTERVAL_DAYS = 90
MAX_NOTIFS_24H = 3
SPEED_KMH = 30

GROUPS = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
WINDOW_MIN = {1: 720, 2: 180, 3: 60}
W = {"urgency": 0.25, "proximity": 0.35, "availability": 0.15,
     "response": 0.15, "fairness": 0.10, "fatigue": 0.20}

# Illustrative red-cell compatibility (recipient -> allowed donor groups).
# NOT clinical guidance.
COMPAT = {
    "O-": ["O-"],
    "O+": ["O-", "O+"],
    "A-": ["O-", "A-"],
    "A+": ["O-", "O+", "A-", "A+"],
    "B-": ["O-", "B-"],
    "B+": ["O-", "O+", "B-", "B+"],
    "AB-": ["O-", "A-", "B-", "AB-"],
    "AB+": list(GROUPS),
}

LOCALITIES = [
    {"id": "katpadi", "name": "Katpadi", "lat": 12.9719, "lng": 79.1500},
    {"id": "gandhi", "name": "Gandhi Nagar", "lat": 12.9330, "lng": 79.1380},
    {"id": "sathu", "name": "Sathuvachari", "lat": 12.9450, "lng": 79.1250},
    {"id": "bagayam", "name": "Bagayam", "lat": 12.8900, "lng": 79.1000},
    {"id": "ranipet", "name": "Ranipet", "lat": 12.9224, "lng": 79.3307},
    {"id": "arcot", "name": "Arcot", "lat": 12.9050, "lng": 79.3190},
    {"id": "gudi", "name": "Gudiyatham", "lat": 12.9460, "lng": 78.8690},
]
HOSPITALS = [
    {"id": "H1", "name": "Riverside General Hospital", "area": "Gandhi Nagar", "lat": 12.9345, "lng": 79.1395},
    {"id": "H2", "name": "Lakeview Medical Centre", "area": "Katpadi", "lat": 12.9740, "lng": 79.1520},
    {"id": "H3", "name": "Ranipet District Blood Centre", "area": "Ranipet", "lat": 12.9240, "lng": 79.3320},
]


def now_ms():
    return int(time.time() * 1000)


def round_half_up(x, ndigits=0):
    """JavaScript Math.round semantics (half rounds up), unlike Python's round()."""
    f = 10 ** ndigits
    return math.floor(x * f + 0.5) / f


class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


# ------------------------------------------------------------------- engine
def haversine(lat1, lng1, lat2, lng2):
    R, rad = 6371, math.pi / 180
    d_lat, d_lng = (lat2 - lat1) * rad, (lng2 - lng1) * rad
    a = math.sin(d_lat / 2) ** 2 + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lng / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def notif_count_24h(d, now):
    last = d.get("lastNotifiedAt")
    return (d.get("notifCount24h") or 0) if last and now - last <= DAY else 0


def days_since(date_str, now):
    if not date_str:
        return math.inf
    dt = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return math.floor((now - dt.timestamp() * 1000) / DAY)


def rank(req, donors, prior_notifs, radius_km, now=None):
    """Hard gate first, then EDPS. Returns dict(eligible, excluded, evaluated)."""
    now = now or now_ms()
    already = {n["donorId"] for n in prior_notifs}
    allowed = COMPAT.get(req["bloodGroup"], [])
    eligible, excluded = [], []

    for d in donors:
        if d["id"] in already:
            continue
        dist = haversine(req["lat"], req["lng"], d["lat"], d["lng"])
        eta = max(1, int(round_half_up(dist / SPEED_KMH * 60)))
        dsl = days_since(d.get("lastDonationDate"), now)
        eff = notif_count_24h(d, now)

        reason = kind = None
        if not d.get("consent"):
            reason, kind = "No consent on file", "consent"
        elif d.get("deferred"):
            reason, kind = "Deferral / medical flag", "deferral"
        elif not d.get("available"):
            reason, kind = "Not currently available", "availability"
        elif d["bloodGroup"] not in allowed:
            reason, kind = "ABO/Rh not compatible", "abo"
        elif dsl < MIN_INTERVAL_DAYS:
            reason, kind = f"Donated {dsl} days ago ({MIN_INTERVAL_DAYS}-day interval)", "interval"
        elif eff >= MAX_NOTIFS_24H:
            reason, kind = f"Notification cooldown ({eff} in 24 h)", "cooldown"
        elif dist > radius_km:
            reason, kind = f"Outside {radius_km} km radius ({dist:.1f} km)", "radius"
        if reason:
            excluded.append({"donorId": d["id"], "reason": reason, "kind": kind})
            continue

        hist = d.get("history") or {"sent": 0, "accepted": 0}
        validated = hist["sent"] >= 3
        time_fit = 1 if eta <= WINDOW_MIN[req["urgency"]] else 0.5
        last = d.get("lastNotifiedAt")
        raw = {
            "urgency": (req["urgency"] / 3) * time_fit,
            "proximity": max(0, 1 - dist / radius_km),
            "availability": 1 if d.get("availability") == "now" else 0.6,
            "response": hist["accepted"] / hist["sent"] if validated else 0.5,
            "fairness": min(1, (now - last) / (7 * DAY)) if last else 1,
            "fatigue": eff / MAX_NOTIFS_24H,
        }
        contrib = {
            "urgency": W["urgency"] * raw["urgency"],
            "proximity": W["proximity"] * raw["proximity"],
            "availability": W["availability"] * raw["availability"],
            "response": W["response"] * raw["response"],
            "fairness": W["fairness"] * raw["fairness"],
            "fatigue": -W["fatigue"] * raw["fatigue"],
        }
        edps = sum(contrib.values())
        eligible.append({
            "donorId": d["id"],
            "distanceKm": round_half_up(dist, 1),
            "etaMin": eta,
            "score": round_half_up(edps * 100, 1),
            "raw": raw, "contrib": contrib, "validated": validated,
        })

    eligible.sort(key=lambda e: (-e["score"], e["distanceKm"]))
    return {"eligible": eligible, "excluded": excluded, "evaluated": len(donors) - len(already)}


# ------------------------------------------------------------------- stores
class MemoryStore:
    """In-memory store for local tests."""

    def __init__(self):
        self.donors, self.requests, self.notifs = {}, {}, {}

    def donors_all(self):
        return [json.loads(json.dumps(d)) for d in self.donors.values()]

    def donor_put(self, d):
        self.donors[d["id"]] = json.loads(json.dumps(d))

    def donors_put_many(self, items):
        for d in items:
            self.donor_put(d)

    def req_get(self, rid):
        r = self.requests.get(rid)
        return json.loads(json.dumps(r)) if r else None

    def req_put(self, r):
        self.requests[r["id"]] = json.loads(json.dumps(r))

    def reqs_all(self):
        return [json.loads(json.dumps(r)) for r in self.requests.values()]

    def notifs_for(self, rid):
        return [json.loads(json.dumps(n)) for (r, _), n in self.notifs.items() if r == rid]

    def notif_put(self, n):
        self.notifs[(n["requestId"], n["donorId"])] = json.loads(json.dumps(n))


def _to_ddb(obj):
    """DynamoDB rejects Python floats; round-trip through JSON to Decimals."""
    return json.loads(json.dumps(obj), parse_float=Decimal)


def _plain(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj == obj.to_integral_value() else float(obj)
    if isinstance(obj, list):
        return [_plain(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _plain(v) for k, v in obj.items()}
    return obj


class DynamoStore:
    """Tables: BB_Donors (PK donorId), BB_Requests (PK requestId),
    BB_Notifications (PK requestId, SK donorId)."""

    def __init__(self):
        import boto3
        from boto3.dynamodb.conditions import Key
        self._Key = Key
        ddb = boto3.resource("dynamodb")
        self.t_donors = ddb.Table(os.environ.get("DONORS_TABLE", "BB_Donors"))
        self.t_reqs = ddb.Table(os.environ.get("REQUESTS_TABLE", "BB_Requests"))
        self.t_notifs = ddb.Table(os.environ.get("NOTIFS_TABLE", "BB_Notifications"))

    @staticmethod
    def _scan(table):
        items, kwargs = [], {}
        while True:
            res = table.scan(**kwargs)
            items += res.get("Items", [])
            if "LastEvaluatedKey" not in res:
                return [_plain(i) for i in items]
            kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def donors_all(self):
        return self._scan(self.t_donors)

    def donor_put(self, d):
        self.t_donors.put_item(Item=_to_ddb({**d, "donorId": d["id"]}))

    def donors_put_many(self, items):
        with self.t_donors.batch_writer() as bw:  # retries unprocessed items
            for d in items:
                bw.put_item(Item=_to_ddb({**d, "donorId": d["id"]}))

    def req_get(self, rid):
        item = self.t_reqs.get_item(Key={"requestId": rid}).get("Item")
        return _plain(item) if item else None

    def req_put(self, r):
        self.t_reqs.put_item(Item=_to_ddb({**r, "requestId": r["id"]}))

    def reqs_all(self):
        return self._scan(self.t_reqs)

    def notifs_for(self, rid):
        items, kwargs = [], {"KeyConditionExpression": self._Key("requestId").eq(rid)}
        while True:
            res = self.t_notifs.query(**kwargs)
            items += res.get("Items", [])
            if "LastEvaluatedKey" not in res:
                return [_plain(i) for i in items]
            kwargs["ExclusiveStartKey"] = res["LastEvaluatedKey"]

    def notif_put(self, n):
        self.t_notifs.put_item(Item=_to_ddb(n))


STORE = None


def get_store():
    global STORE
    if STORE is None:
        STORE = DynamoStore()
    return STORE


# ------------------------------------------------------------------ helpers
def public_donor(d):
    """Privacy: coordinators/hospitals see a masked label, never name or contact."""
    parts = str(d["name"]).split()
    label = parts[0] + (f" {parts[1][0]}." if len(parts) > 1 else "")
    loc = next((l["name"] for l in LOCALITIES if l["id"] == d.get("locality")), "")
    return {"id": d["id"], "label": label, "bloodGroup": d["bloodGroup"], "locality": loc,
            "available": d.get("available"), "availability": d.get("availability"),
            "deferred": d.get("deferred"), "consent": d.get("consent"),
            "lastDonationDate": d.get("lastDonationDate"), "history": d.get("history")}


def log_evt(req, msg):
    req["log"].append({"t": now_ms(), "msg": msg})


def new_id(prefix, n=4):
    return f"{prefix}-" + "".join(random.choices("0123456789ABCDEF", k=n))


def build_view(store, req):
    donors = {d["id"]: d for d in store.donors_all()}

    def pub(did):
        return public_donor(donors[did]) if did in donors else {"id": did, "label": did}

    notifs = sorted(store.notifs_for(req["id"]), key=lambda n: (n["batch"], -n["score"]))
    return {
        "request": req,
        "notifications": [{**n, "donor": pub(n["donorId"])} for n in notifs],
        "queue": [{**q, "donor": pub(q["donorId"])} for q in req.get("queue", [])],
        "excluded": [{**e, "donor": pub(e["donorId"])} for e in req.get("excluded", [])],
    }


def run_match(store, req, donors, widened):
    t0 = time.perf_counter()
    prior = store.notifs_for(req["id"])
    res = rank(req, donors, prior, req["radiusKm"])
    picks = res["eligible"][:BATCH_SIZE]
    now = now_ms()
    if picks:
        req["batch"] += 1
        by_id = {d["id"]: d for d in donors}
        for p in picks:
            d = by_id[p["donorId"]]
            d["notifCount24h"] = notif_count_24h(d, now) + 1
            d["lastNotifiedAt"] = now
            d["history"]["sent"] += 1
            store.donor_put(d)
            store.notif_put({"requestId": req["id"], "donorId": d["id"], "batch": req["batch"],
                             "status": "Sent", "sentAt": now, "score": p["score"],
                             "distanceKm": p["distanceKm"], "etaMin": p["etaMin"],
                             "raw": p["raw"], "contrib": p["contrib"], "validated": p["validated"]})
        req["status"] = "Notified"
        req["notifiedAt"] = req.get("notifiedAt") or now
    req["queue"] = res["eligible"][BATCH_SIZE:]
    req["excluded"] = res["excluded"]
    ms = round_half_up((time.perf_counter() - t0) * 1000, 1)
    req["metrics"] = {"latencyMs": ms, "evaluated": res["evaluated"], "passedGate": len(res["eligible"])}
    log_evt(req, f"{'Escalation' if widened else 'Match run'}: {res['evaluated']} donors evaluated, "
                 f"{len(res['eligible'])} passed the hard gate within {req['radiusKm']} km ({ms} ms).")
    if picks:
        ids = ", ".join(p["donorId"] for p in picks)
        log_evt(req, f"Batch {req['batch']}: notified {len(picks)} donor{'s' if len(picks) > 1 else ''} "
                     f"({ids}). Contact details stay mediated.")
    else:
        log_evt(req, f"No eligible donors within {req['radiusKm']} km. Widen the radius to continue.")
    # One structured line per run -> CloudWatch Logs Insights gives the latency metrics for the report.
    print(json.dumps({"event": "match", "requestId": req["id"], "batch": req["batch"], "radiusKm": req["radiusKm"],
                      "evaluated": res["evaluated"], "passedGate": len(res["eligible"]),
                      "notified": len(picks), "latencyMs": ms}))


def load_request(store, rid):
    req = store.req_get(rid)
    if not req:
        raise ApiError("Request not found.", 404)
    return req


# ----------------------------------------------------------------- handlers
def list_donors(store, _body):
    return [public_donor(d) for d in store.donors_all()]


def register_donor(store, body):
    loc = next((l for l in LOCALITIES if l["id"] == body.get("locality")), None)
    name = str(body.get("name") or "").strip()[:60]
    if not name or body.get("bloodGroup") not in GROUPS or not loc:
        raise ApiError("Name, blood group and locality are required.")
    if not body.get("consent"):
        raise ApiError("Consent is required to register.")
    last = body.get("lastDonationDate") or None
    if last and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", last):
        raise ApiError("Last donation date must be YYYY-MM-DD.")
    d = {"id": new_id("D"), "name": name, "bloodGroup": body["bloodGroup"], "locality": loc["id"],
         "lat": loc["lat"], "lng": loc["lng"], "consent": True, "available": body.get("available") is not False,
         "availability": "today" if body.get("availability") == "today" else "now", "deferred": False,
         "lastDonationDate": last, "notifCount24h": 0, "lastNotifiedAt": None,
         "history": {"sent": 0, "accepted": 0}, "createdAt": now_ms()}
    store.donor_put(d)
    return public_donor(d)


def list_requests(store, _body):
    out = []
    for r in sorted(store.reqs_all(), key=lambda r: -r["createdAt"]):
        out.append({k: v for k, v in r.items() if k not in ("queue", "excluded", "log")})
    return out


def create_request(store, body):
    h = next((h for h in HOSPITALS if h["id"] == body.get("hospitalId")), None)
    if not h or body.get("bloodGroup") not in GROUPS:
        raise ApiError("Pick a verified hospital and a blood group.")
    try:
        units = max(1, min(10, int(body.get("units") or 1)))
        urgency = int(body.get("urgency") or 2)
    except (TypeError, ValueError):
        raise ApiError("Units and urgency must be numbers.")
    req = {"id": new_id("R"), "hospitalId": h["id"], "hospitalName": h["name"], "area": h["area"],
           "lat": h["lat"], "lng": h["lng"], "bloodGroup": body["bloodGroup"], "units": units,
           "urgency": urgency if urgency in (1, 2, 3) else 2, "status": "Open", "batch": 0,
           "radiusKm": RADIUS_START, "createdAt": now_ms(), "verified": True,
           "queue": [], "excluded": [], "metrics": None, "acceptedDonorId": None, "log": []}
    log_evt(req, f"Request created by {h['name']} (verified centre). Status: Open.")
    store.req_put(req)
    return req


def get_request(store, rid, _body):
    return build_view(store, load_request(store, rid))


def match(store, rid, _body):
    req = load_request(store, rid)
    if req["status"] != "Open" or req["batch"] > 0:
        raise ApiError("Matching already started for this request.", 409)
    run_match(store, req, store.donors_all(), False)
    store.req_put(req)
    return build_view(store, req)


def respond(store, rid, body):
    req = load_request(store, rid)
    if req["status"] in ("Accepted", "Fulfilled"):
        raise ApiError("This request already has an accepted donor.", 409)
    donor_id, response = body.get("donorId"), body.get("response")
    if response not in ("accept", "decline"):
        raise ApiError("response must be 'accept' or 'decline'.")
    notifs = store.notifs_for(rid)
    n = next((x for x in notifs if x["donorId"] == donor_id and x["status"] == "Sent"), None)
    if not n:
        raise ApiError("No pending notification for that donor.", 409)
    now = now_ms()
    if response == "accept":
        n["status"], n["respondedAt"] = "Accepted", now
        store.notif_put(n)
        donor = next(d for d in store.donors_all() if d["id"] == donor_id)
        donor["history"]["accepted"] += 1
        store.donor_put(donor)
        req.update(status="Accepted", acceptedAt=now, acceptedDonorId=donor_id)
        stood = 0
        for x in notifs:
            if x["donorId"] != donor_id and x["status"] == "Sent":
                x["status"] = "Stood down"
                store.notif_put(x)
                stood += 1
        log_evt(req, f"{donor_id} accepted. {stood} other pending notification{'' if stood == 1 else 's'} "
                     f"stood down. Coordinator mediates contact.")
    else:
        n["status"], n["respondedAt"] = "Declined", now
        store.notif_put(n)
        log_evt(req, f"{donor_id} declined.")
        if not any(x["status"] == "Sent" and x["donorId"] != donor_id for x in notifs):
            log_evt(req, f"Batch {req['batch']} exhausted with no acceptance. Escalate to the next ranked batch.")
    store.req_put(req)
    return build_view(store, req)


def escalate(store, rid, _body):
    req = load_request(store, rid)
    if req["status"] in ("Accepted", "Fulfilled"):
        raise ApiError("Request already has an accepted donor.", 409)
    timeouts = 0
    for x in store.notifs_for(rid):
        if x["status"] == "Sent":
            x["status"] = "Timeout"
            store.notif_put(x)
            timeouts += 1
    if timeouts:
        log_evt(req, f"{timeouts} notification{'' if timeouts == 1 else 's'} timed out with no response.")
    before = req["radiusKm"]
    req["radiusKm"] = min(RADIUS_MAX, before + RADIUS_STEP)
    if req["radiusKm"] != before:
        log_evt(req, f"Radius widened {before} → {req['radiusKm']} km.")
    run_match(store, req, store.donors_all(), True)
    store.req_put(req)
    return build_view(store, req)


def fulfil(store, rid, _body):
    req = load_request(store, rid)
    if req["status"] != "Accepted":
        raise ApiError("Only an accepted request can be fulfilled.", 409)
    req["status"], req["fulfilledAt"] = "Fulfilled", now_ms()
    donor = next((d for d in store.donors_all() if d["id"] == req["acceptedDonorId"]), None)
    if donor:
        donor["lastDonationDate"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        donor["available"] = False
        store.donor_put(donor)
    log_evt(req, f"Donation confirmed by the blood centre. Status: Fulfilled. "
                 f"{req['acceptedDonorId']} enters the {MIN_INTERVAL_DAYS}-day interval.")
    store.req_put(req)
    return build_view(store, req)


FIRST = ["Aarav", "Diya", "Kiran", "Meera", "Rohan", "Ananya", "Vikram", "Sneha", "Arjun", "Priya", "Karthik",
         "Divya", "Suresh", "Lakshmi", "Imran", "Nisha", "Rahul", "Pooja", "Dev", "Isha", "Manoj", "Kavya",
         "Faizan", "Tanvi"]
LAST = ["Sharma", "Iyer", "Nair", "Reddy", "Khan", "Das", "Menon", "Patel", "Rao", "Singh", "Pillai", "Gupta",
        "Kumar", "Joseph"]
GROUP_WEIGHTS = [("O+", 36), ("B+", 28), ("A+", 21), ("AB+", 6), ("O-", 3), ("B-", 2), ("A-", 3), ("AB-", 1)]
FORCED = ["O-", "O-", "O-", "B-", "A-", "O-"]  # guarantee universal-donor coverage


def seed(store, _body, total=45):
    existing = store.donors_all()
    if len(existing) >= 30:
        return {"donors": len(existing)}
    rnd = random.Random(2026)
    taken = {d["id"] for d in existing}
    groups, weights = zip(*GROUP_WEIGHTS)
    new, i = [], 0
    while len(existing) + len(new) < total:
        did = f"D-{i + 1:03d}"
        i += 1
        if did in taken:
            continue
        loc = rnd.choice(LOCALITIES)
        sent = rnd.randrange(8)
        accepted = min(sent, int(round_half_up(sent * (0.2 + rnd.random() * 0.7))))
        last_days = rnd.randrange(20, 80) if rnd.random() < 0.15 else rnd.randrange(100, 400)
        idx = len(new)
        new.append({
            "id": did, "name": f"{rnd.choice(FIRST)} {rnd.choice(LAST)}",
            "bloodGroup": FORCED[idx] if idx < len(FORCED) else rnd.choices(groups, weights)[0],
            "locality": loc["id"],
            "lat": round(loc["lat"] + (rnd.random() - 0.5) * 0.04, 6),
            "lng": round(loc["lng"] + (rnd.random() - 0.5) * 0.04, 6),
            "consent": rnd.random() > 0.05, "available": rnd.random() > 0.15,
            "availability": "now" if rnd.random() > 0.4 else "today", "deferred": rnd.random() < 0.05,
            "lastDonationDate": None if rnd.random() < 0.1 else
            datetime.fromtimestamp(time.time() - last_days * 86400, timezone.utc).strftime("%Y-%m-%d"),
            "notifCount24h": 0, "lastNotifiedAt": None,
            "history": {"sent": sent, "accepted": accepted}, "createdAt": now_ms()})
    store.donors_put_many(new)
    return {"donors": len(existing) + len(new)}


# ------------------------------------------------------------------- router
def route(store, method, parts, body):
    if parts == ["donors"]:
        if method == "GET":
            return list_donors(store, body)
        if method == "POST":
            return register_donor(store, body)
    elif parts == ["requests"]:
        if method == "GET":
            return list_requests(store, body)
        if method == "POST":
            return create_request(store, body)
    elif parts == ["seed"] and method == "POST":
        return seed(store, body)
    elif len(parts) == 2 and parts[0] == "requests" and method == "GET":
        return get_request(store, parts[1], body)
    elif len(parts) == 3 and parts[0] == "requests" and method == "POST":
        action = {"match": match, "respond": respond, "escalate": escalate, "fulfil": fulfil}.get(parts[2])
        if action:
            return action(store, parts[1], body)
    raise ApiError("Not found.", 404)


def _json_default(o):
    if isinstance(o, Decimal):
        return int(o) if o == o.to_integral_value() else float(o)
    raise TypeError(f"not serializable: {type(o)}")


def _response(status, payload=None):
    headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": os.environ.get("ALLOWED_ORIGIN", "*"),
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    }
    return {"statusCode": status, "headers": headers,
            "body": "" if payload is None else json.dumps(payload, default=_json_default)}


def lambda_handler(event, context=None, store=None):
    http = (event.get("requestContext") or {}).get("http") or {}
    method = (http.get("method") or "GET").upper()
    if method == "OPTIONS":  # CORS preflight (CORS is handled here, not in API Gateway)
        return _response(204)
    try:
        parts = [p for p in (event.get("rawPath") or "/").split("/") if p]
        raw = event.get("body") or ""
        if event.get("isBase64Encoded") and raw:
            import base64
            raw = base64.b64decode(raw).decode("utf-8")
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            raise ApiError("Body must be valid JSON.")
        if not isinstance(body, dict):
            raise ApiError("Body must be a JSON object.")
        return _response(200, route(store or get_store(), method, parts, body))
    except ApiError as e:
        return _response(e.status, {"error": str(e)})
    except Exception:  # noqa: BLE001
        traceback.print_exc()  # goes to CloudWatch Logs
        return _response(500, {"error": "Internal error."})
