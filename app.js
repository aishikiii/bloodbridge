(function () {
  'use strict';
  const { api, MODE, GROUPS, URGENCY, W, LOCALITIES, HOSPITALS, BATCH_SIZE, RADIUS_STEP, RADIUS_MAX, MIN_INTERVAL_DAYS } = window.BB;
  const app = document.getElementById('app');
  const expanded = new Set();

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
  const todayStr = () => new Date().toISOString().slice(0, 10);

  let toastTimer;
  function toast(msg, isErr) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---------- chrome ----------
  const NAV = [['home', '#/', 'Home'], ['donor', '#/donor', 'Register donor'], ['request', '#/request', 'Raise request'], ['dashboard', '#/dashboard', 'Coordinator dashboard']];
  function setChrome(name) {
    document.getElementById('nav').innerHTML = NAV.map(([k, h, l]) => `<a href="${h}"${k === name ? ' aria-current="page"' : ''}>${l}</a>`).join('');
    document.getElementById('mode').textContent = MODE === 'aws' ? 'Connected: AWS API' : 'Demo mode: data stays in this browser';
  }
  function route() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const [name, id] = h.split('/');
    return { name: ['donor', 'request', 'dashboard'].includes(name) ? name : 'home', id: id || null };
  }

  // ---------- small view helpers ----------
  const statusChip = s => `<span class="chip ${({ Open: 'warn', Notified: 'info', Accepted: 'ok', Fulfilled: 'ok' })[s] || ''}">${esc(s)}</span>`;
  const notifChip = s => {
    const map = { Sent: ['info', 'Notified'], Accepted: ['ok', 'Accepted'], Declined: ['bad', 'Declined'], Timeout: ['warn', 'Timed out'], 'Stood down': ['dim', 'Stood down'] };
    const [c, l] = map[s] || ['', s]; return `<span class="chip ${c}">${l}</span>`;
  };
  const urgChip = u => `<span class="chip ${u === 3 ? 'bad' : u === 2 ? 'warn' : ''}">${URGENCY[u]}</span>`;
  const group = g => `<span class="bg">${esc(g)}</span>`;
  const score = v => `<span class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></span><span class="mono">${v.toFixed(1)}</span>`;

  function breakdown(n) {
    const rows = [
      ['Urgency & time-window fit', 'urgency'], ['Proximity', 'proximity'], ['Availability', 'availability'],
      ['Response signal' + (n.validated ? '' : ' (neutral, not yet validated)'), 'response'], ['Fairness (rest since last alert)', 'fairness'], ['Fatigue penalty', 'fatigue']
    ];
    return `<div class="bk">${rows.map(([l, k]) => `<div><span>${l} <span class="muted">×${W[k]}</span></span><b class="mono">${n.contrib[k] >= 0 ? '+' : '−'}${Math.abs(n.contrib[k] * 100).toFixed(1)}</b></div>`).join('')}</div>`;
  }

  // ---------- views ----------
  async function viewHome() {
    const [donors, reqs] = await Promise.all([api.listDonors(), api.listRequests()]);
    return `
    <section class="hero">
      <div class="hero-main">
        <span class="eyebrow">Emergency response on AWS</span>
        <h1>From verified shortage to accepted donor, faster.</h1>
        <p class="lede">BloodBridge connects verified hospitals and blood centres with consenting donors. It filters for eligibility first, ranks who to alert, notifies a small batch, and tracks every response until the request is fulfilled.</p>
        <div class="row">
          <a class="btn" href="#/request">Raise a request</a>
          <a class="btn ghost" href="#/donor">Register a donor</a>
          <a class="btn ghost" href="#/dashboard">Open dashboard</a>
        </div>
      </div>
      <aside class="hero-side">
        <h3>Proposed workflow</h3>
        <ol class="flow">
          <li><b>Verified request</b><span>Hospital or blood centre</span></li>
          <li><b>Eligibility filter</b><span>ABO/Rh, deferral, consent</span></li>
          <li><b>Rank candidates</b><span>Distance, urgency, response signal</span></li>
          <li><b>Notify a small batch</b><span>Contact details stay mediated</span></li>
          <li><b>Capture response, escalate, confirm</b><span>Accept, decline or timeout</span></li>
        </ol>
      </aside>
    </section>

    <section class="grid g3" style="margin-bottom:22px">
      <div class="card tile"><div class="stat">${donors.length}</div><h3>Donors registered</h3><p class="muted">Synthetic donors only. Names are masked for coordinators.</p></div>
      <div class="card tile"><div class="stat">${reqs.length}</div><h3>Requests raised</h3><p class="muted">${reqs.filter(r => r.status === 'Fulfilled').length} fulfilled, ${reqs.filter(r => r.status !== 'Fulfilled').length} in progress.</p></div>
      <div class="card tile">
        <h3>Demo data</h3>
        <p class="muted">Load 45 synthetic donors around Vellore to try the full flow.</p>
        <div class="row"><button class="btn sm" data-action="seed">Load demo donors</button>${MODE === 'demo' ? '<button class="btn sm ghost" data-action="reset">Reset all</button>' : ''}</div>
      </div>
    </section>

    <section class="card" style="margin-bottom:22px">
      <h2>Demo script</h2>
      <ol>
        <li><b>Load demo donors</b> above (or register your own).</li>
        <li><b>Raise a request</b> as a verified hospital, for example O− or B+ at Critical urgency.</li>
        <li>On the dashboard, <b>run the eligibility gate and ranking</b>. Expand a row to see the EDPS breakdown, and open “Why were others excluded?”.</li>
        <li>Press <b>Accept</b> on one donor, or <b>Decline</b> everyone, or <b>Simulate timeout</b> to widen the radius by ${RADIUS_STEP} km and notify the next batch.</li>
        <li><b>Mark fulfilled</b> once the blood centre confirms the donation.</li>
      </ol>
    </section>

    <div class="callout"><b>Safety boundary.</b> The score prioritizes outreach. It never replaces blood-centre screening or transfusion decisions.</div>`;
  }

  async function viewDonor() {
    const donors = (await api.listDonors()).slice().reverse();
    return `
    <h1>Register a donor</h1>
    <p class="lede">Donors opt in, and their contact details are never shown to hospitals. Use synthetic data only.</p>
    <div class="split">
      <form class="card" data-form="donor" novalidate>
        <div class="field"><label for="name">Name</label><input id="name" name="name" type="text" required maxlength="60" autocomplete="off" placeholder="e.g. Priya Sharma"></div>
        <fieldset><legend>Blood group</legend>
          <div class="seg" role="radiogroup">${GROUPS.map((g, i) => `<label><input type="radio" name="bloodGroup" value="${g}" ${i === 1 ? 'checked' : ''}><span>${g}</span></label>`).join('')}</div>
        </fieldset>
        <div class="field"><label for="locality">Locality</label>
          <select id="locality" name="locality">${LOCALITIES.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="last">Last donation date <span class="muted">(optional)</span></label><input id="last" name="lastDonationDate" type="date" max="${todayStr()}">
          <div class="hint">Donors are held back until ${MIN_INTERVAL_DAYS} days after their last donation.</div></div>
        <fieldset><legend>Availability</legend>
          <div class="seg"><label><input type="radio" name="availability" value="now" checked><span>Available now</span></label><label><input type="radio" name="availability" value="today"><span>Later today</span></label></div>
        </fieldset>
        <div class="field"><label class="check"><input type="checkbox" name="consent"> <span>I consent to being contacted for emergency blood requests through BloodBridge. My contact details stay mediated and are never shared with hospitals.</span></label></div>
        <button class="btn" type="submit">Register donor</button>
      </form>
      <aside>
        <h3>Recently registered (${donors.length})</h3>
        ${donors.length ? `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Donor</th><th>Group</th><th>Area</th></tr></thead><tbody>
          ${donors.slice(0, 12).map(d => `<tr><td class="mono">${esc(d.id)}</td><td>${esc(d.label)}</td><td>${group(d.bloodGroup)}</td><td>${esc(d.locality)}</td></tr>`).join('')}
        </tbody></table></div>${donors.length > 12 ? `<p class="hint">Showing 12 of ${donors.length}.</p>` : ''}` : '<div class="card empty muted">No donors yet. Register one, or load demo donors from the home page.</div>'}
      </aside>
    </div>`;
  }

  async function viewRequest() {
    const donors = await api.listDonors();
    return `
    <h1>Raise a blood request</h1>
    <p class="lede">Only verified hospitals and blood centres can raise requests. Matching starts when the coordinator runs it.</p>
    ${donors.length < 5 ? '<div class="callout" style="margin-bottom:18px">There are few donors registered. <button class="btn sm" data-action="seed">Load demo donors</button></div>' : ''}
    <form class="card" data-form="request" novalidate>
      <div class="field"><label for="hospital">Verified institution</label>
        <select id="hospital" name="hospitalId">${HOSPITALS.map(h => `<option value="${h.id}">${esc(h.name)} (${esc(h.area)})</option>`).join('')}</select></div>
      <fieldset><legend>Blood group needed</legend>
        <div class="seg">${GROUPS.map((g, i) => `<label><input type="radio" name="bloodGroup" value="${g}" ${g === 'B+' ? 'checked' : ''}><span>${g}</span></label>`).join('')}</div></fieldset>
      <div class="field"><label for="units">Units</label><input id="units" name="units" type="number" min="1" max="10" value="2"></div>
      <fieldset><legend>Urgency</legend>
        <div class="seg">${[1, 2, 3].map(u => `<label><input type="radio" name="urgency" value="${u}" ${u === 3 ? 'checked' : ''}><span>${URGENCY[u]}</span></label>`).join('')}</div>
        <div class="hint">Critical expects a donor within about 60 minutes, Urgent 3 hours, Routine 12 hours.</div></fieldset>
      <button class="btn" type="submit">Create request</button>
    </form>`;
  }

  function stepper(status) {
    const steps = ['Open', 'Notified', 'Accepted', 'Fulfilled'];
    const i = steps.indexOf(status);
    return `<ol class="stepper" aria-label="Request status">${steps.map((s, k) => `<li class="${k < i ? 'done' : k === i ? 'active' : ''}"${k === i ? ' aria-current="step"' : ''}>${s}</li>`).join('')}</ol>`;
  }

  function actionBar(data) {
    const r = data.request;
    const sent = data.notifications.filter(n => n.status === 'Sent').length;
    const nextRadius = Math.min(RADIUS_MAX, r.radiusKm + RADIUS_STEP);
    const canWiden = r.radiusKm < RADIUS_MAX || data.queue.length;
    let inner = '';
    if (r.status === 'Open' && r.batch === 0) {
      inner = `<p>Run the hard eligibility gate (ABO/Rh, consent, availability, deferral, ${MIN_INTERVAL_DAYS}-day interval, cooldown), then rank survivors by EDPS and notify the top ${BATCH_SIZE}.</p>
        <button class="btn" data-action="match">Run eligibility gate &amp; ranking</button>`;
    } else if (r.status === 'Open') {
      inner = `<p>No eligible donors within ${r.radiusKm} km.</p>${canWiden ? `<button class="btn" data-action="escalate">Widen radius to ${nextRadius} km &amp; retry</button>` : '<span class="chip bad">No candidates left</span>'}`;
    } else if (r.status === 'Notified') {
      inner = `<p>${sent ? `Waiting on ${sent} donor${sent > 1 ? 's' : ''}. Use Accept or Decline on a row to simulate their reply.` : '<b>Batch exhausted with no acceptance.</b> Escalate to the next ranked batch.'}</p>
        <div class="row"><button class="btn${sent ? ' ghost' : ''}" data-action="escalate">${sent ? 'Simulate timeout' : 'Escalate'} → notify next batch${r.radiusKm < RADIUS_MAX ? ` (radius ${nextRadius} km)` : ''}</button></div>`;
    } else if (r.status === 'Accepted') {
      const d = data.notifications.find(n => n.donorId === r.acceptedDonorId);
      inner = `<p><b>${esc(d ? d.donor.label : r.acceptedDonorId)}</b> accepted. The coordinator now mediates contact and the blood centre performs final screening.</p>
        <button class="btn ok" data-action="fulfil">Mark fulfilled</button>`;
    } else {
      inner = `<p><b>Fulfilled.</b> The request is closed and the donor enters the ${MIN_INTERVAL_DAYS}-day interval.</p>`;
    }
    return `<div class="actions">${inner}</div>`;
  }

  function metrics(data) {
    const r = data.request, n = data.notifications, m = r.metrics || {};
    const cnt = s => n.filter(x => x.status === s).length;
    const tta = r.acceptedAt ? Math.max(0, Math.round((r.acceptedAt - r.createdAt) / 1000)) : null;
    const cell = (v, l) => `<div class="metric"><b>${v}</b><span>${l}</span></div>`;
    return `<div class="metrics">
      ${cell(r.radiusKm + ' km', 'Search radius')}
      ${cell(r.batch, 'Batches sent')}
      ${cell(m.evaluated != null ? m.evaluated : '–', 'Donors evaluated')}
      ${cell(m.passedGate != null ? m.passedGate : '–', 'Passed hard gate')}
      ${cell(m.latencyMs != null ? m.latencyMs + ' ms' : '–', 'Matching latency' + (MODE === 'demo' ? ' (browser)' : ''))}
      ${cell(`${cnt('Accepted')} / ${cnt('Declined')} / ${cnt('Timeout')}`, 'Accept / decline / timeout')}
      ${tta != null ? cell(tta + ' s', 'Request to acceptance') : ''}
    </div>`;
  }

  function rankedTable(data) {
    const r = data.request;
    const live = r.status === 'Notified';
    const rows = [];
    data.notifications.forEach((n, i) => {
      const open = expanded.has(n.donorId);
      rows.push(`<tr>
        <td class="mono">${i + 1}</td>
        <td><b>${esc(n.donor.label)}</b><div class="hint mono" style="margin:0">${esc(n.donor.id)} · ${esc(n.donor.locality || '')}</div></td>
        <td>${group(n.donor.bloodGroup)}</td>
        <td class="num">${n.distanceKm} km<div class="hint" style="margin:0">~${n.etaMin} min</div></td>
        <td class="num">${score(n.score)}</td>
        <td class="num">${n.batch}</td>
        <td>${notifChip(n.status)}</td>
        <td><div class="row">
          ${n.status === 'Sent' && live ? `<button class="btn sm ok" data-action="respond" data-donor="${esc(n.donorId)}" data-response="accept">Accept</button><button class="btn sm ghost" data-action="respond" data-donor="${esc(n.donorId)}" data-response="decline">Decline</button>` : ''}
          <button class="btn sm ghost" data-action="toggle" data-donor="${esc(n.donorId)}" aria-expanded="${open}">${open ? 'Hide' : 'Why'}</button>
        </div></td></tr>`);
      if (open) rows.push(`<tr class="sub"><td></td><td colspan="7"><b>EDPS breakdown</b> (points out of 100)${breakdown(n)}</td></tr>`);
    });
    data.queue.forEach((q, i) => {
      const open = expanded.has(q.donorId);
      rows.push(`<tr>
        <td class="mono">${data.notifications.length + i + 1}</td>
        <td><b>${esc(q.donor.label)}</b><div class="hint mono" style="margin:0">${esc(q.donor.id)} · ${esc(q.donor.locality || '')}</div></td>
        <td>${group(q.donor.bloodGroup)}</td>
        <td class="num">${q.distanceKm} km<div class="hint" style="margin:0">~${q.etaMin} min</div></td>
        <td class="num">${score(q.score)}</td>
        <td class="num">–</td>
        <td><span class="chip dim">Queued</span></td>
        <td><button class="btn sm ghost" data-action="toggle" data-donor="${esc(q.donorId)}" aria-expanded="${open}">${open ? 'Hide' : 'Why'}</button></td></tr>`);
      if (open) rows.push(`<tr class="sub"><td></td><td colspan="7"><b>EDPS breakdown</b> (points out of 100)${breakdown(q)}</td></tr>`);
    });
    if (!rows.length) return `<div class="card empty muted">No ranked donors yet. Run the eligibility gate to see candidates.</div>`;
    return `<div class="tablewrap"><table><thead><tr><th class="num">#</th><th>Donor</th><th>Group</th><th class="num">Distance</th><th class="num">EDPS</th><th class="num">Batch</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function excludedBlock(data) {
    const ex = data.excluded;
    if (!data.request.metrics) return '';
    const byKind = {};
    ex.forEach(e => { const k = e.reason.replace(/\(.*\)/, '').replace(/\d+ km/, 'N km').trim(); (byKind[k] = byKind[k] || []).push(e); });
    return `<details><summary>Why were others excluded? (${ex.length})</summary>
      <div class="tablewrap"><table><thead><tr><th>Reason</th><th class="num">Donors</th></tr></thead><tbody>
      ${Object.entries(byKind).sort((a, b) => b[1].length - a[1].length).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${v.length}</td></tr>`).join('') || '<tr><td colspan="2" class="muted">Nobody was excluded.</td></tr>'}
      </tbody></table></div>
      <p class="hint">The hard gate runs before any scoring, so ineligible donors are never ranked. Donors outside the radius re-enter when the coordinator widens it.</p></details>`;
  }

  async function viewDashboard(id) {
    const reqs = await api.listRequests();
    if (!reqs.length) return `<h1>Coordinator dashboard</h1><div class="card empty"><h3>No requests yet</h3><p class="muted">Raise a request to see matching, ranking and live status here.</p><a class="btn" href="#/request">Raise a request</a></div>`;
    const sel = id && reqs.find(r => r.id === id) ? id : reqs[0].id;
    const data = await api.getRequest(sel);
    const r = data.request;
    return `<h1>Coordinator dashboard</h1>
    <div class="dash">
      <aside class="reqlist" aria-label="Requests">${reqs.map(q => `<a class="reqitem" href="#/dashboard/${esc(q.id)}" ${q.id === sel ? 'aria-current="true"' : ''}>
        <div class="top2"><b class="mono">${esc(q.id)}</b>${statusChip(q.status)}</div>
        <div class="row" style="gap:6px">${group(q.bloodGroup)}${urgChip(q.urgency)}</div>
        <div class="hint" style="margin:6px 0 0">${esc(q.hospitalName)}</div></a>`).join('')}</aside>
      <section>
        <div class="dhead">${group(r.bloodGroup).replace('class="bg"', 'class="bg big"')}
          <div><h2>${esc(r.hospitalName)}</h2>
          <div class="row" style="gap:8px"><span class="mono muted">${esc(r.id)}</span>${urgChip(r.urgency)}<span class="chip">${r.units} unit${r.units > 1 ? 's' : ''}</span><span class="chip ok">Verified centre</span></div></div></div>
        ${stepper(r.status)}
        ${actionBar(data)}
        ${metrics(data)}
        <h3>Ranked donors</h3>
        ${rankedTable(data)}
        ${excludedBlock(data)}
        <details open><summary>Activity log</summary><ul class="log">${r.log.map(l => `<li><time>${fmtTime(l.t)}</time>${esc(l.msg)}</li>`).join('')}</ul></details>
      </section>
    </div>`;
  }

  // ---------- render + events ----------
  async function render() {
    const r = route();
    setChrome(r.name);
    try {
      const html = r.name === 'donor' ? await viewDonor() : r.name === 'request' ? await viewRequest() : r.name === 'dashboard' ? await viewDashboard(r.id) : await viewHome();
      app.innerHTML = html;
    } catch (e) {
      app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back home</a></div>`;
    }
  }

  async function guarded(fn, okMsg) {
    try { const out = await fn(); if (okMsg) toast(okMsg); return out; }
    catch (e) { toast(e.message || 'Something went wrong', true); return null; }
  }

  document.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-action]'); if (!b) return;
    const a = b.dataset.action, id = route().id || (await api.listRequests())[0]?.id;
    if (a === 'toggle') { const k = b.dataset.donor; expanded.has(k) ? expanded.delete(k) : expanded.add(k); return render(); }
    b.disabled = true;
    if (a === 'seed') await guarded(() => api.seed(), 'Demo donors loaded');
    else if (a === 'reset') { if (confirm('Delete all demo donors and requests in this browser?')) { await api.reset(); expanded.clear(); toast('Reset'); } }
    else if (a === 'match') await guarded(() => api.match(id), 'Matching complete');
    else if (a === 'escalate') await guarded(() => api.escalate(id), 'Escalated');
    else if (a === 'respond') await guarded(() => api.respond(id, b.dataset.donor, b.dataset.response), b.dataset.response === 'accept' ? 'Donor accepted' : 'Donor declined');
    else if (a === 'fulfil') await guarded(() => api.fulfil(id), 'Request fulfilled');
    render();
  });

  document.addEventListener('submit', async ev => {
    const f = ev.target.closest('form[data-form]'); if (!f) return;
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    if (f.dataset.form === 'donor') {
      if (!d.name || !d.name.trim()) return toast('Please enter a name.', true);
      if (!f.elements.consent.checked) return toast('Consent is required to register.', true);
      d.consent = true;
      const out = await guarded(() => api.registerDonor(d));
      if (out) { toast(`Registered ${out.id} (${out.bloodGroup})`); render(); }
    } else {
      const out = await guarded(() => api.createRequest(d));
      if (out) { toast(`Request ${out.id} created`); location.hash = '#/dashboard/' + out.id; }
    }
  });

  window.addEventListener('hashchange', render);
  render();
})();
