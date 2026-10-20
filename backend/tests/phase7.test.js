// Phase 7 tests — baselines, learning idempotency, rebuild authz, forecast
// math, bottlenecks, staffing recs, nudge queue + dedupe + lifecycle gate,
// isolation, audit. Self-cleaning (own org/users/events only).
// Run: BASE=... ADMIN_PIN=... node tests/phase7.test.js

const BASE = process.env.BASE || 'http://localhost:3135';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

let passed = 0, failed = 0;
const results = [];
function ok(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS ${name}`); }
  else { failed++; results.push(`FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  let data = null;
  try { data = ct.includes('json') ? await res.json() : await res.text(); } catch {}
  return { status: res.status, data, replay: res.headers.get('idempotent-replayed') };
}
const rndPin = () => String(1000 + Math.floor(Math.random() * 9000));
const uuid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
// Unique org per run: baselines are global state on the shared dev DB.
const ORG = `P7 Org ${Date.now().toString(36)}`;

async function main() {
  const admin0 = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  let admin = admin0;
  ok('admin login', !!admin);
  // Shared dev DB: another operator logging in as admin invalidates this
  // token (single-session). Transparently re-login once and retry.
  async function areq(method, path, opts = {}, extra = {}) {
    const merged = () => ({ ...opts, ...extra, token: admin });
    let r = await req(method, path, merged());
    if (r.status === 401 && JSON.stringify(r.data || '').includes('Session active')) {
      admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
      r = await req(method, path, merged());
    }
    return r;
  }

  const mkUser = async (name) => {
    const pin = rndPin();
    const u = (await areq('POST', '/users', { token: admin, body: { name, pin } })).data;
    if (!u.id) throw new Error(`user creation failed: ${JSON.stringify(u)}`);
    const login = await req('POST', '/auth/login', { body: { pin } });
    return { user: u, token: login.data.token };
  };
  const mgr = await mkUser('P7 Mgr');
  const outsider = await mkUser('P7 Outsider');

  const org = (await areq('POST', '/organizations', { token: admin, body: { name: ORG, type: 'planner' } })).data;
  await areq('POST', `/organizations/${org.id}/members`, { token: admin, body: { user_id: mgr.user.id, org_role: 'manager' } });

  const mkEvent = async (name, extra = {}) =>
    (await areq('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding', org_id: org.id, ...extra } })).data;

  // ---- history event with exact known numbers: 10 invited, 8 confirmed, 1 declined, 6 checked ----
  const h = await mkEvent('P7 History');
  const gids = [];
  for (let i = 0; i < 10; i++) gids.push((await areq('POST', '/guests', { token: admin, body: { event_id: h.id, name: `P7H Guest ${i}` } })).data.id);
  const inv = await areq('POST', '/guest-invites', { token: admin, body: { event_id: h.id, guest_ids: gids } });
  const toks = inv.data.invitations.filter((x) => x.token).map((x) => x.token);
  for (let i = 0; i < 8; i++) await req('POST', `/guest-invite/${toks[i]}/rsvp`, { body: { response: 'confirmed' } });
  await req('POST', `/guest-invite/${toks[8]}/rsvp`, { body: { response: 'declined' } });
  // one incident opened + resolved in 30 min (backdated created_at for determinism)
  const inc = (await areq('POST', '/incidents', { token: admin, body: { event_id: h.id, title: 'P7 past incident' } })).data;
  await areq('POST', `/incidents/${inc.id}/status`, { token: admin, body: { to: 'IN_PROGRESS' } });
  await areq('POST', `/incidents/${inc.id}/status`, { token: admin, body: { to: 'RESOLVED', resolution: 'done' } });
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await areq('POST', `/events/${h.id}/lifecycle`, { token: admin, body: { to: s } });
  const act = (await areq('GET', `/activities?event_id=${h.id}`, { token: admin })).data[0].id;
  for (let i = 0; i < 6; i++) await areq('POST', '/checkins', { token: admin, body: { guest_id: gids[i], activity_id: act } });
  await areq('POST', `/events/${h.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  ok('close triggers auto-learn', (await areq('POST', `/events/${h.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } })).status === 200);
  const learned = await areq('GET', `/audit/event/${h.id}?limit=50`, { token: admin });
  ok('learn.merge audited on close', learned.data.some((r) => r.action === 'learn.merge'));

  const bl = (await areq('GET', `/learning/baselines?org_id=${org.id}&template_key=wedding`, { token: admin })).data;
  const mean = (m) => bl.find((b) => b.metric === m);
  ok('show_up_rate learned exact (6/8)', mean('show_up_rate') && Math.abs(mean('show_up_rate').mean - 0.75) < 1e-9 && mean('show_up_rate').n === 1, JSON.stringify(mean('show_up_rate')));
  ok('decline_rate learned exact (1/10)', mean('decline_rate') && Math.abs(mean('decline_rate').mean - 0.1) < 1e-9);
  ok('incidents_per_100 learned (1/10*100)', mean('incidents_per_100') && Math.abs(mean('incidents_per_100').mean - 10) < 1e-9);

  // ---- second history event merges incrementally: 4 confirmed, 4 checked → show_up (0.75+1.0)/2 ----
  const h2 = await mkEvent('P7 History Two');
  const g2 = [];
  for (let i = 0; i < 4; i++) g2.push((await areq('POST', '/guests', { token: admin, body: { event_id: h2.id, name: `P7H2 Guest ${i}` } })).data.id);
  const inv2 = await areq('POST', '/guest-invites', { token: admin, body: { event_id: h2.id, guest_ids: g2 } });
  for (const t of inv2.data.invitations.filter((x) => x.token).map((x) => x.token)) {
    await req('POST', `/guest-invite/${t}/rsvp`, { body: { response: 'confirmed' } });
  }
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE', 'CLOSING', 'CLOSED']) {
    await areq('POST', `/events/${h2.id}/lifecycle`, { token: admin, body: { to: s } }).catch(() => ({}));
    if (s === 'ACTIVE') {
      const a2 = (await areq('GET', `/activities?event_id=${h2.id}`, { token: admin })).data[0].id;
      for (const gid of g2) await areq('POST', '/checkins', { token: admin, body: { guest_id: gid, activity_id: a2 } });
    }
  }
  const bl2 = (await areq('GET', `/learning/baselines?org_id=${org.id}&template_key=wedding`, { token: admin })).data;
  const su2 = bl2.find((b) => b.metric === 'show_up_rate');
  ok('incremental mean merged (n=2, mean=0.875)', su2 && su2.n === 2 && Math.abs(su2.mean - 0.875) < 1e-9, JSON.stringify(su2));

  // ---- live event: forecast math uses org history ----
  const live = await mkEvent('P7 Live');
  const gl = [];
  for (let i = 0; i < 8; i++) gl.push((await areq('POST', '/guests', { token: admin, body: { event_id: live.id, name: `P7L Guest ${i}` } })).data.id);
  const invL = await areq('POST', '/guest-invites', { token: admin, body: { event_id: live.id, guest_ids: gl } });
  const tokL = invL.data.invitations.filter((x) => x.token).map((x) => x.token);
  for (let i = 0; i < 4; i++) await req('POST', `/guest-invite/${tokL[i]}/rsvp`, { body: { response: 'confirmed' } });
  await req('POST', `/guest-invite/${tokL[4]}/rsvp`, { body: { response: 'declined' } });
  const intel = await areq('GET', `/intelligence/${live.id}`, { token: admin });
  ok('forecast math exact (4 confirmed × 0.875 = 4 rounded... 3.5→4)', intel.data.forecast.expected_arrivals === 4, JSON.stringify(intel.data.forecast));
  ok('forecast states basis', /past event/.test(intel.data.forecast.show_up_basis), intel.data.forecast.show_up_basis);
  ok('follow-up recommendation present', intel.data.recommendations.some((r) => r.key === 'rsvp-followup'));
  ok('every recommendation explained', intel.data.recommendations.every((r) => r.title && r.basis && r.action));

  // ---- staffing recommendation: overload one staffer ----
  const loader = await mkUser('P7 Loader');
  await areq('POST', `/events/${live.id}/roles`, { token: admin, body: { user_id: loader.user.id, role_key: 'waiter' } });
  for (let i = 0; i < 5; i++) {
    await areq('POST', '/tasks', { token: admin, body: { event_id: live.id, title: `P7 load ${i}`, assignee_user_id: loader.user.id } });
  }
  const intel2 = await areq('GET', `/intelligence/${live.id}`, { token: admin });
  ok('staffing overload recommended with basis', intel2.data.recommendations.some((r) => r.key === 'staffing'));

  // ---- nudges: queue, dedupe, idempotent replay, lifecycle gate ----
  const n1 = await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } });
  ok('nudges queued for 3 silent guests', n1.status === 201 && n1.data.queued === 3, JSON.stringify(n1.data));
  const n2 = await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } });
  ok('second run dedupes to 0', n2.data.queued === 0);
  const k = uuid();
  const r1 = await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } }, { headers: { 'Idempotency-Key': k } });
  const r2 = await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } }, { headers: { 'Idempotency-Key': k } });
  ok('idempotency-key replays', r2.replay === 'true' && JSON.stringify(r1.data) === JSON.stringify(r2.data));
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE', 'CLOSING', 'CLOSED']) {
    await areq('POST', `/events/${live.id}/lifecycle`, { token: admin, body: { to: s } });
  }
  ok('nudges blocked when CLOSED', (await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } })).status === 409);

  // ---- isolation + authz ----
  ok('outsider denied intelligence', (await req('GET', `/intelligence/${live.id}`, { token: outsider.token })).status === 403);
  ok('outsider denied nudges', (await req('POST', '/followups/rsvp-nudges', { token: outsider.token, body: { event_id: live.id } })).status === 403);
  ok('rebuild denied for staff', (await req('POST', '/learning/rebuild', { token: mgr.token })).status === 403);
  const rb = await areq('POST', '/learning/rebuild', { token: admin });
  ok('rebuild works + audited', rb.status === 200 && rb.data.events_learned >= 2);

  // ---- cleanup (own artifacts only) ----
  for (const e of [h, h2, live]) await areq('DELETE', `/events/${e.id}`, { token: admin }).catch(() => {});
  await areq('DELETE', `/organizations/${org.id}`, { token: admin }).catch(() => {});
  for (const u of [mgr, outsider, loader]) await areq('DELETE', `/users/${u.user.id}`, { token: admin }).catch(() => {});

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
