"""Run: python test_local.py   (no AWS needed; uses MemoryStore)"""
import json
import lambda_function as lf

store = lf.MemoryStore()


def call(method, path, body=None):
    ev = {"requestContext": {"http": {"method": method}}, "rawPath": path, "body": json.dumps(body) if body is not None else ""}
    r = lf.lambda_handler(ev, None, store)
    return r["statusCode"], (json.loads(r["body"]) if r["body"] else None)


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        raise SystemExit(1)


s, _ = call("OPTIONS", "/requests"); check(s == 204, "CORS preflight returns 204")
s, d = call("POST", "/seed"); check(s == 200 and d["donors"] == 45, "seed loads 45 donors")
s, d = call("POST", "/seed"); check(d["donors"] == 45, "seed is idempotent")
s, donors = call("GET", "/donors")
check(len(donors) == 45 and all("name" not in x for x in donors), "donor list masks full names")

s, e = call("POST", "/donors", {"name": "Test User", "bloodGroup": "B+", "locality": "katpadi", "consent": False})
check(s == 400, "registration without consent rejected")
s, e = call("POST", "/donors", {"name": "Test User", "bloodGroup": "B+", "locality": "katpadi", "consent": True})
check(s == 200 and e["label"] == "Test U.", "donor registered with masked label")

s, e = call("POST", "/requests", {"hospitalId": "NOPE", "bloodGroup": "B+"}); check(s == 400, "unverified hospital rejected")
s, req = call("POST", "/requests", {"hospitalId": "H1", "bloodGroup": "B+", "units": 2, "urgency": 3})
check(s == 200 and req["status"] == "Open", "request created Open")
rid = req["id"]

s, v = call("POST", f"/requests/{rid}/match")
n = v["notifications"]
check(s == 200 and v["request"]["status"] == "Notified" and len(n) == 5, "match notifies top 5, status Notified")
check(all(x["donor"]["bloodGroup"] in lf.COMPAT["B+"] for x in n), "every notified donor is ABO/Rh compatible")
check([x["score"] for x in n] == sorted([x["score"] for x in n], reverse=True), "batch is ranked by EDPS")
check(all(q["score"] <= min(x["score"] for x in n) for q in v["queue"]), "queued donors rank below notified batch")
check(v["request"]["metrics"]["evaluated"] == 46, "46 donors evaluated")
s, e = call("POST", f"/requests/{rid}/match"); check(s == 409, "second match rejected")

s, v = call("POST", f"/requests/{rid}/escalate")
st = [x["status"] for x in v["notifications"]]
check(st.count("Timeout") == 5 and st.count("Sent") == 5 and v["request"]["radiusKm"] == 20, "escalate: 5 timeouts, radius 20, next 5 notified")
check(len({x["donorId"] for x in v["notifications"]}) == 10, "no donor notified twice")

first = next(x["donorId"] for x in v["notifications"] if x["status"] == "Sent")
s, v = call("POST", f"/requests/{rid}/respond", {"donorId": first, "response": "accept"})
st = [x["status"] for x in v["notifications"]]
check(v["request"]["status"] == "Accepted" and st.count("Accepted") == 1 and st.count("Stood down") == 4, "accept stands down the other 4")
s, e = call("POST", f"/requests/{rid}/respond", {"donorId": first, "response": "accept"}); check(s == 409, "second accept rejected")
s, v = call("POST", f"/requests/{rid}/fulfil"); check(v["request"]["status"] == "Fulfilled", "fulfilled")
s, lst = call("GET", "/requests"); check(len(lst) == 1 and "log" not in lst[0], "request list is slim")
s, e = call("GET", "/requests/R-NOPE"); check(s == 404, "unknown request 404")
s, e = call("GET", "/nothing"); check(s == 404, "unknown route 404")

# decline path + exhaustion
s, req = call("POST", "/requests", {"hospitalId": "H2", "bloodGroup": "AB+", "urgency": 1})
rid2 = req["id"]; s, v = call("POST", f"/requests/{rid2}/match")
for x in v["notifications"]:
    s, v = call("POST", f"/requests/{rid2}/respond", {"donorId": x["donorId"], "response": "decline"})
check(v["request"]["status"] == "Notified" and "exhausted" in v["request"]["log"][-1]["msg"], "all declined -> batch exhausted message")

# no-candidate path: rare group, tiny pool
s, req = call("POST", "/requests", {"hospitalId": "H3", "bloodGroup": "O-", "urgency": 3})
rid3 = req["id"]; s, v = call("POST", f"/requests/{rid3}/match")
print("   O- at Ranipet, 10 km: notified", len(v["notifications"]), "| passed gate", v["request"]["metrics"]["passedGate"])
print("\nAll backend checks passed.")
