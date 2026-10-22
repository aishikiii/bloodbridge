/* BloodBridge data layer.
 *
 * Two interchangeable backends behind one `api` object:
 *   - demo: matching engine + storage run in the browser (localStorage)
 *   - aws : thin fetch() wrapper over API Gateway -> Lambda -> DynamoDB
 *
 * The matching engine below (gate + EDPS) is the reference implementation;
 * the Lambda version should mirror it exactly.
 */
(function () {
  'use strict';

  const CFG = window.BLOODBRIDGE_CONFIG || {};
  const BASE = (CFG.API_BASE || '').replace(/\/$/, '');
  const MODE = BASE ? 'aws' : 'demo';

  const DAY = 864e5;
  const BATCH_SIZE = 5;
  const RADIUS_START = 10, RADIUS_STEP = 10, RADIUS_MAX = 50; // km
  const MIN_INTERVAL_DAYS = 90;
  const MAX_NOTIFS_24H = 3;
  const SPEED_KMH = 30; // assumed average travel speed for ETA

  const GROUPS = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];
  const URGENCY = { 1: 'Routine', 2: 'Urgent', 3: 'Critical' };
  const WINDOW_MIN = { 1: 720, 2: 180, 3: 60 }; // required time window per urgency

  // EDPS weights (positive terms sum to 1; fatigue is subtracted)
  const W = { urgency: 0.25, proximity: 0.35, availability: 0.15, response: 0.15, fairness: 0.10, fatigue: 0.20 };

  // Illustrative red-cell compatibility: recipient group -> allowed donor groups.
  // NOT clinical guidance; final screening stays with the licensed blood centre.
  const COMPAT = {
    'O-': ['O-'],
    'O+': ['O-', 'O+'],
    'A-': ['O-', 'A-'],
    'A+': ['O-', 'O+', 'A-', 'A+'],
    'B-': ['O-', 'B-'],
    'B+': ['O-', 'O+', 'B-', 'B+'],
    'AB-': ['O-', 'A-', 'B-', 'AB-'],
    'AB+': GROUPS.slice()
  };

  // Synthetic locations around Vellore, Tamil Nadu
  const LOCALITIES = [
    { id: 'katpadi', name: 'Katpadi', lat: 12.9719, lng: 79.1500 },
    { id: 'gandhi', name: 'Gandhi Nagar', lat: 12.9330, lng: 79.1380 },
    { id: 'sathu', name: 'Sathuvachari', lat: 12.9450, lng: 79.1250 },
    { id: 'bagayam', name: 'Bagayam', lat: 12.8900, lng: 79.1000 },
    { id: 'ranipet', name: 'Ranipet', lat: 12.9224, lng: 79.3307 },
    { id: 'arcot', name: 'Arcot', lat: 12.9050, lng: 79.3190 },
    { id: 'gudi', name: 'Gudiyatham', lat: 12.9460, lng: 78.8690 }
  ];

  // Verified institutions (synthetic names)
  const HOSPITALS = [
    { id: 'H1', name: 'Riverside General Hospital', area: 'Gandhi Nagar', lat: 12.9345, lng: 79.1395 },
    { id: 'H2', name: 'Lakeview Medical Centre', area: 'Katpadi', lat: 12.9740, lng: 79.1520 },
    { id: 'H3', name: 'Ranipet District Blood Centre', area: 'Ranipet', lat: 12.9240, lng: 79.3320 }
  ];

  // ---------- engine ----------
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  function notifCount24h(d, now) {
    return d.lastNotifiedAt && now - d.lastNotifiedAt <= DAY ? (d.notifCount24h || 0) : 0;
  }

  function daysSince(dateStr, now) {
    if (!dateStr) return Infinity;
    return Math.floor((now - new Date(dateStr + 'T00:00:00').getTime()) / DAY);
  }

  /** Hard gate, then EDPS. Returns { eligible (ranked), excluded }. */
  function rank(req, donors, priorNotifs, radiusKm, now) {
    now = now || Date.now();
    const already = new Set(priorNotifs.map(n => n.donorId));
    const eligible = [], excluded = [];
    const allowed = COMPAT[req.bloodGroup] || [];

    for (const d of donors) {
      if (already.has(d.id)) continue; // already contacted for this request
      const dist = haversine(req.lat, req.lng, d.lat, d.lng);
      const eta = Math.max(1, Math.round(dist / SPEED_KMH * 60));
      const dsl = daysSince(d.lastDonationDate, now);
      const eff = notifCount24h(d, now);

      let reason = null, kind = null;
      if (!d.consent) { reason = 'No consent on file'; kind = 'consent'; }
      else if (d.deferred) { reason = 'Deferral / medical flag'; kind = 'deferral'; }
      else if (!d.available) { reason = 'Not currently available'; kind = 'availability'; }
      else if (!allowed.includes(d.bloodGroup)) { reason = 'ABO/Rh not compatible'; kind = 'abo'; }
      else if (dsl < MIN_INTERVAL_DAYS) { reason = `Donated ${dsl} days ago (${MIN_INTERVAL_DAYS}-day interval)`; kind = 'interval'; }
      else if (eff >= MAX_NOTIFS_24H) { reason = `Notification cooldown (${eff} in 24 h)`; kind = 'cooldown'; }
      else if (dist > radiusKm) { reason = `Outside ${radiusKm} km radius (${dist.toFixed(1)} km)`; kind = 'radius'; }

      if (reason) { excluded.push({ donorId: d.id, reason, kind }); continue; }

      const urgencyNorm = req.urgency / 3;
      const timeFit = eta <= WINDOW_MIN[req.urgency] ? 1 : 0.5;
      const validated = (d.history && d.history.sent >= 3);
      const raw = {
        urgency: urgencyNorm * timeFit,
        proximity: Math.max(0, 1 - dist / radiusKm),
        availability: d.availability === 'now' ? 1 : 0.6,
        response: validated ? d.history.accepted / d.history.sent : 0.5, // neutral until validated
        fairness: d.lastNotifiedAt ? Math.min(1, (now - d.lastNotifiedAt) / (7 * DAY)) : 1,
        fatigue: eff / MAX_NOTIFS_24H
      };
      const contrib = {
        urgency: W.urgency * raw.urgency,
        proximity: W.proximity * raw.proximity,
        availability: W.availability * raw.availability,
        response: W.response * raw.response,
        fairness: W.fairness * raw.fairness,
        fatigue: -W.fatigue * raw.fatigue
      };
      const edps = Object.values(contrib).reduce((a, b) => a + b, 0);
      eligible.push({
        donorId: d.id,
        distanceKm: Math.round(dist * 10) / 10,
        etaMin: eta,
        score: Math.round(edps * 1000) / 10,
        raw, contrib, validated
      });
    }
    eligible.sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm);
    return { eligible, excluded, evaluated: donors.length - already.size };
  }

  // ---------- demo storage ----------
  const KEY = 'bloodbridge_demo_v1';
  let mem = null;
  function load() {
    if (mem) return mem;
    try { const s = localStorage.getItem(KEY); if (s) mem = JSON.parse(s); } catch (e) { /* storage blocked */ }
    if (!mem) mem = { donors: [], requests: [], notifs: [], seq: { d: 0, r: 0 } };
    return mem;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* ignore */ } }
  const clone = x => JSON.parse(JSON.stringify(x));
  const pad = (n, w) => String(n).padStart(w, '0');
  const today = () => new Date().toISOString().slice(0, 10);

  function logEvt(req, msg) { req.log.push({ t: Date.now(), msg }); }
  function loc(id) { return LOCALITIES.find(l => l.id === id); }

  function publicDonor(d) {
    // Privacy: hospitals/coordinators never see full name or contact details.
    const parts = String(d.name).trim().split(/\s+/);
    const label = parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : '');
    return { id: d.id, label, bloodGroup: d.bloodGroup, locality: (loc(d.locality) || {}).name || '', available: d.available,
      availability: d.availability, deferred: d.deferred, consent: d.consent, lastDonationDate: d.lastDonationDate,
      history: d.history };
  }

  function notify(s, req, picks) {
    const now = Date.now();
    for (const p of picks) {
      const d = s.donors.find(x => x.id === p.donorId);
      d.notifCount24h = notifCount24h(d, now) + 1;
      d.lastNotifiedAt = now;
      d.history.sent += 1;
      s.notifs.push({ requestId: req.id, donorId: d.id, batch: req.batch, status: 'Sent', sentAt: now,
        score: p.score, distanceKm: p.distanceKm, etaMin: p.etaMin, raw: p.raw, contrib: p.contrib, validated: p.validated });
    }
  }

  function runMatch(s, req, widened) {
    const t0 = performance.now();
    const prior = s.notifs.filter(n => n.requestId === req.id);
    const res = rank(req, s.donors, prior, req.radiusKm);
    const picks = res.eligible.slice(0, BATCH_SIZE);
    if (picks.length) {
      req.batch += 1;
      notify(s, req, picks);
      req.status = 'Notified';
      req.notifiedAt = req.notifiedAt || Date.now();
    }
    req.queue = res.eligible.slice(BATCH_SIZE);
    req.excluded = res.excluded;
    const ms = Math.round((performance.now() - t0) * 10) / 10;
    req.metrics = { latencyMs: ms, evaluated: res.evaluated, passedGate: res.eligible.length + 0 };
    logEvt(req, `${widened ? 'Escalation' : 'Match run'}: ${res.evaluated} donors evaluated, ${res.eligible.length} passed the hard gate within ${req.radiusKm} km (${ms} ms).`);
    if (picks.length) {
      logEvt(req, `Batch ${req.batch}: notified ${picks.length} donor${picks.length > 1 ? 's' : ''} (${picks.map(p => p.donorId).join(', ')}). Contact details stay mediated.`);
    } else {
      logEvt(req, `No eligible donors within ${req.radiusKm} km. Widen the radius to continue.`);
    }
  }

  function view(s, req) {
    const notifications = s.notifs.filter(n => n.requestId === req.id).map(n => {
      const d = s.donors.find(x => x.id === n.donorId);
      return Object.assign({}, n, { donor: d ? publicDonor(d) : { id: n.donorId, label: n.donorId } });
    }).sort((a, b) => a.batch - b.batch || b.score - a.score);
    const queue = (req.queue || []).map(q => {
      const d = s.donors.find(x => x.id === q.donorId);
      return Object.assign({}, q, { donor: d ? publicDonor(d) : { id: q.donorId, label: q.donorId } });
    });
    const excluded = (req.excluded || []).map(e => {
      const d = s.donors.find(x => x.id === e.donorId);
      return Object.assign({}, e, { donor: d ? publicDonor(d) : { id: e.donorId, label: e.donorId } });
    });
    return clone({ request: req, notifications, queue, excluded });
  }

  // deterministic PRNG so seeded data is reproducible
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const FIRST = ['Aarav', 'Diya', 'Kiran', 'Meera', 'Rohan', 'Ananya', 'Vikram', 'Sneha', 'Arjun', 'Priya', 'Karthik', 'Divya', 'Suresh', 'Lakshmi', 'Imran', 'Nisha', 'Rahul', 'Pooja', 'Dev', 'Isha', 'Manoj', 'Kavya', 'Faizan', 'Tanvi'];
  const LAST = ['Sharma', 'Iyer', 'Nair', 'Reddy', 'Khan', 'Das', 'Menon', 'Patel', 'Rao', 'Singh', 'Pillai', 'Gupta', 'Kumar', 'Joseph'];
  const GW = [['O+', 36], ['B+', 28], ['A+', 21], ['AB+', 6], ['O-', 3], ['B-', 2], ['A-', 3], ['AB-', 1]];

  const FORCED = ['O-', 'O-', 'O-', 'B-', 'A-', 'O-']; // guarantee some universal-donor coverage
  function seedDonors(s, n) {
    const rnd = mulberry32(2026);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const pickGroup = () => { let r = rnd() * 100, acc = 0; for (const [g, w] of GW) { acc += w; if (r < acc) return g; } return 'O+'; };
    for (let i = 0; i < n; i++) {
      const L = pick(LOCALITIES);
      const sent = Math.floor(rnd() * 8);
      const accepted = Math.min(sent, Math.round(sent * (0.2 + rnd() * 0.7)));
      const lastDays = rnd() < 0.15 ? Math.floor(20 + rnd() * 60) : Math.floor(100 + rnd() * 300);
      s.seq.d += 1;
      s.donors.push({
        id: 'D-' + pad(s.seq.d, 3),
        name: pick(FIRST) + ' ' + pick(LAST),
        bloodGroup: i < FORCED.length ? FORCED[i] : pickGroup(),
        locality: L.id,
        lat: L.lat + (rnd() - 0.5) * 0.04,
        lng: L.lng + (rnd() - 0.5) * 0.04,
        consent: rnd() > 0.05,
        available: rnd() > 0.15,
        availability: rnd() > 0.4 ? 'now' : 'today',
        deferred: rnd() < 0.05,
        lastDonationDate: rnd() < 0.1 ? null : new Date(Date.now() - lastDays * DAY).toISOString().slice(0, 10),
        notifCount24h: 0, lastNotifiedAt: null,
        history: { sent, accepted },
        createdAt: Date.now()
      });
    }
  }

  // ---------- demo API ----------
  const demo = {
    async listDonors() { const s = load(); return clone(s.donors.map(publicDonor)); },
    async registerDonor(p) {
      const s = load();
      const L = loc(p.locality);
      if (!p.name || !GROUPS.includes(p.bloodGroup) || !L) throw new Error('Name, blood group and locality are required.');
      if (!p.consent) throw new Error('Consent is required to register.');
      s.seq.d += 1;
      const d = {
        id: 'D-' + pad(s.seq.d, 3), name: String(p.name).trim().slice(0, 60), bloodGroup: p.bloodGroup, locality: L.id,
        lat: L.lat, lng: L.lng, consent: true, available: p.available !== false,
        availability: p.availability === 'today' ? 'today' : 'now', deferred: false,
        lastDonationDate: p.lastDonationDate || null, notifCount24h: 0, lastNotifiedAt: null,
        history: { sent: 0, accepted: 0 }, createdAt: Date.now()
      };
      s.donors.push(d); save();
      return clone(publicDonor(d));
    },
    async listRequests() { const s = load(); return clone(s.requests.slice().sort((a, b) => b.createdAt - a.createdAt)); },
    async createRequest(p) {
      const s = load();
      const H = HOSPITALS.find(h => h.id === p.hospitalId);
      if (!H || !GROUPS.includes(p.bloodGroup)) throw new Error('Pick a verified hospital and a blood group.');
      s.seq.r += 1;
      const req = {
        id: 'R-' + pad(s.seq.r, 4), hospitalId: H.id, hospitalName: H.name, area: H.area, lat: H.lat, lng: H.lng,
        bloodGroup: p.bloodGroup, units: Math.max(1, Math.min(10, +p.units || 1)), urgency: [1, 2, 3].includes(+p.urgency) ? +p.urgency : 2,
        status: 'Open', batch: 0, radiusKm: RADIUS_START, createdAt: Date.now(), verified: true,
        queue: [], excluded: [], metrics: null, acceptedDonorId: null, log: []
      };
      logEvt(req, `Request created by ${H.name} (verified centre). Status: Open.`);
      s.requests.push(req); save();
      return clone(req);
    },
    async getRequest(id) {
      const s = load(); const req = s.requests.find(r => r.id === id);
      if (!req) throw new Error('Request not found.');
      return view(s, req);
    },
    async match(id) {
      const s = load(); const req = s.requests.find(r => r.id === id);
      if (!req) throw new Error('Request not found.');
      if (req.status !== 'Open' || req.batch > 0) throw new Error('Matching already started for this request.');
      runMatch(s, req, false); save(); return view(s, req);
    },
    async respond(id, donorId, response) {
      const s = load(); const req = s.requests.find(r => r.id === id);
      if (!req) throw new Error('Request not found.');
      if (req.status === 'Accepted' || req.status === 'Fulfilled') throw new Error('This request already has an accepted donor.');
      const n = s.notifs.find(x => x.requestId === id && x.donorId === donorId && x.status === 'Sent');
      if (!n) throw new Error('No pending notification for that donor.');
      const d = s.donors.find(x => x.id === donorId);
      if (response === 'accept') {
        n.status = 'Accepted'; n.respondedAt = Date.now(); d.history.accepted += 1;
        req.status = 'Accepted'; req.acceptedAt = Date.now(); req.acceptedDonorId = donorId;
        let stood = 0;
        s.notifs.forEach(x => { if (x.requestId === id && x.status === 'Sent') { x.status = 'Stood down'; stood++; } });
        logEvt(req, `${donorId} accepted. ${stood} other pending notification${stood === 1 ? '' : 's'} stood down. Coordinator mediates contact.`);
      } else {
        n.status = 'Declined'; n.respondedAt = Date.now();
        logEvt(req, `${donorId} declined.`);
        const pending = s.notifs.filter(x => x.requestId === id && x.status === 'Sent').length;
        if (!pending) logEvt(req, `Batch ${req.batch} exhausted with no acceptance. Escalate to the next ranked batch.`);
      }
      save(); return view(s, req);
    },
    async escalate(id) {
      const s = load(); const req = s.requests.find(r => r.id === id);
      if (!req) throw new Error('Request not found.');
      if (req.status === 'Accepted' || req.status === 'Fulfilled') throw new Error('Request already has an accepted donor.');
      let timeouts = 0;
      s.notifs.forEach(x => { if (x.requestId === id && x.status === 'Sent') { x.status = 'Timeout'; timeouts++; } });
      if (timeouts) logEvt(req, `${timeouts} notification${timeouts === 1 ? '' : 's'} timed out with no response.`);
      const before = req.radiusKm;
      req.radiusKm = Math.min(RADIUS_MAX, req.radiusKm + RADIUS_STEP);
      if (req.radiusKm !== before) logEvt(req, `Radius widened ${before} → ${req.radiusKm} km.`);
      runMatch(s, req, true); save(); return view(s, req);
    },
    async fulfil(id) {
      const s = load(); const req = s.requests.find(r => r.id === id);
      if (!req || req.status !== 'Accepted') throw new Error('Only an accepted request can be fulfilled.');
      req.status = 'Fulfilled'; req.fulfilledAt = Date.now();
      const d = s.donors.find(x => x.id === req.acceptedDonorId);
      if (d) { d.lastDonationDate = today(); d.available = false; }
      logEvt(req, `Donation confirmed by the blood centre. Status: Fulfilled. ${req.acceptedDonorId} enters the ${MIN_INTERVAL_DAYS}-day interval.`);
      save(); return view(s, req);
    },
    async seed() {
      const s = load();
      if (s.donors.length < 30) seedDonors(s, 45 - s.donors.length);
      save(); return { donors: s.donors.length };
    },
    async reset() { mem = { donors: [], requests: [], notifs: [], seq: { d: 0, r: 0 } }; save(); return {}; }
  };

  // ---------- AWS API ----------
  async function http(method, path, body) {
    let res;
    try {
      res = await fetch(BASE + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { throw new Error('Could not reach the API. Check API_BASE in config.js and CORS on API Gateway.'); }
    let data = null; try { data = await res.json(); } catch (e) { /* empty body */ }
    if (!res.ok) throw new Error((data && (data.error || data.message)) || `Request failed (${res.status})`);
    return data;
  }
  const aws = {
    listDonors: () => http('GET', '/donors'),
    registerDonor: p => http('POST', '/donors', p),
    listRequests: () => http('GET', '/requests'),
    createRequest: p => http('POST', '/requests', p),
    getRequest: id => http('GET', `/requests/${encodeURIComponent(id)}`),
    match: id => http('POST', `/requests/${encodeURIComponent(id)}/match`),
    respond: (id, donorId, response) => http('POST', `/requests/${encodeURIComponent(id)}/respond`, { donorId, response }),
    escalate: id => http('POST', `/requests/${encodeURIComponent(id)}/escalate`),
    fulfil: id => http('POST', `/requests/${encodeURIComponent(id)}/fulfil`),
    seed: () => http('POST', '/seed'),
    reset: async () => ({})
  };

  window.BB = {
    MODE, GROUPS, URGENCY, W, LOCALITIES, HOSPITALS, BATCH_SIZE, RADIUS_STEP, RADIUS_MAX, MIN_INTERVAL_DAYS, MAX_NOTIFS_24H,
    api: MODE === 'aws' ? aws : demo,
    _engine: { rank, haversine, COMPAT } // exposed for testing
  };
})();
