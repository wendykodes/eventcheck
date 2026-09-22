// Phase 5 scale tests — 10 simultaneous events, larger guest volumes,
// concurrent staff activity, concurrent-edit collisions, failure containment
// (mid-load event deletion + staff revocation), pagination, observability,
// isolation under load. Self-cleaning.
// Run: BASE=... ADMIN_PIN=... node tests/scale.test.js

const BASE = process.env.BASE || 'http://localhost:3132';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

const N_EVENTS = 10;
const GUESTS_PER_EVENT = 200;

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
  return { status: res.status, data, headers: res.headers, replay: res.headers.get('idempotent-replayed') };
}
const rndPin = () => String(1000 + Math.floor(Math.random() * 9000));
const uuid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function main() {
  const t0 = Date.now();
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  ok('admin login', !!admin);

  // ---- 10 simultaneous events ----
  const events = [];
  for (let i = 0; i < N_EVENTS; i++) {
    const e = (await req('POST', '/events', { token: admin, body: { name: `P5 Scale ${i}`, date: '2026-12-25', venue: `Hall ${i}`, template_key: i % 2 ? 'wedding' : 'conference' } })).data;
    events.push(e);
  }
  ok('10 events created DRAFT', events.length === N_EVENTS && events.every((e) => e.lifecycle_state === 'DRAFT'));

  // ---- larger guest volumes: 200 per event via bulk JSON import ----
  let totalImported = 0;
  for (const e of events) {
    const batch = [];
    for (let i = 0; i < GUESTS_PER_EVENT; i++) batch.push({ name: `Scale Guest ${e.id}-${i}`, phone: `07${String(20000000 + e.id * 1000 + i).slice(0, 8)}` });
    const r = await req('POST', '/guests/import', { token: admin, body: { event_id: e.id, guests: batch } });
    totalImported += r.data.imported || 0;
  }
  ok(`2000 guests imported (${totalImported})`, totalImported === N_EVENTS * GUESTS_PER_EVENT, String(totalImported));
  const importMs = Date.now() - t0;

  // ---- pagination: bounded page + total ----
  const page = await req('GET', `/guests/?event_id=${events[0].id}&limit=50`, { token: admin });
  ok('guest page bounded with total header', page.status === 200 && page.data.length === 50 &&
    page.headers.get('X-Total-Count') === String(GUESTS_PER_EVENT) && page.headers.get('X-Truncated') === 'true',
    `${page.data.length}/${page.headers.get('X-Total-Count')}`);
  const full = await req('GET', `/guests/?event_id=${events[0].id}&limit=1000`, { token: admin });
  ok('full page retrievable', full.data.length === GUESTS_PER_EVENT && full.headers.get('X-Truncated') === 'false');

  // ---- simultaneous staff activity: 1 staffer per event, parallel check-ins ----
  const staffTokens = [];
  for (const e of events) {
    const pin = rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name: `P5 Checker ${e.id}`, pin } })).data;
    if (!u.id) throw new Error(`staff creation failed for event ${e.id}: ${JSON.stringify(u)}`);
    await req('POST', `/events/${e.id}/roles`, { token: admin, body: { user_id: u.id, role_key: 'checkin_staff' } });
    const login = await req('POST', '/auth/login', { body: { pin } });
    staffTokens.push({ token: login.data.token, user: u, eventId: e.id });
  }
  // activate all events (needs 1 guest + activity: present; activate sequentially)
  for (const e of events) {
    await req('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: 'CONFIGURING' } });
    await req('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: 'READY' } });
    await req('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: 'ACTIVE' } });
  }
  const acts = {};
  for (const e of events) acts[e.id] = (await req('GET', `/activities?event_id=${e.id}`, { token: admin })).data[0].id;
  const guestsByEvent = {};
  for (const e of events) guestsByEvent[e.id] = (await req('GET', `/guests/?event_id=${e.id}&limit=1000`, { token: admin })).data;

  // parallel burst: 20 check-ins per event concurrently
  const burst = async (s) => {
    const gs = guestsByEvent[s.eventId].slice(0, 20);
    const rs = await Promise.all(gs.map((g) => req('POST', '/checkins', { token: s.token, body: { guest_id: g.id, activity_id: acts[s.eventId] }, headers: { 'Idempotency-Key': uuid() } })));
    return rs.filter((r) => r.status === 201).length;
  };
  const burstResults = await Promise.all(staffTokens.map(burst));
  ok('parallel check-in burst (200 total)', burstResults.every((n) => n === 20), JSON.stringify(burstResults));

  // ---- concurrent edits: same task updated by two writers, one must lose deterministically ----
  const task = (await req('POST', '/tasks', { token: admin, body: { event_id: events[0].id, title: 'Contended task' } })).data;
  const baseline = task.updated_at;
  const [w1, w2] = await Promise.all([
    req('PUT', `/tasks/${task.id}`, { token: admin, body: { title: 'Writer One', updated_at: baseline } }),
    req('PUT', `/tasks/${task.id}`, { token: admin, body: { title: 'Writer Two', updated_at: baseline } }),
  ]);
  const statuses = [w1.status, w2.status].sort().join(',');
  ok('concurrent edit: exactly one wins, other gets 409 STALE_WRITE', statuses === '200,409' && [w1, w2].some((r) => r.data && r.data.code === 'STALE_WRITE'), `${w1.status}/${w2.status}`);
  const final = (await req('GET', `/tasks/${task.id}`, { token: admin })).data;
  ok('winner persisted, no corruption', final.title === 'Writer One' || final.title === 'Writer Two');

  // ---- failure containment: delete event 9 mid-load, revoke staffer on event 8 ----
  const victim = events[9];
  const doomedGuests = guestsByEvent[victim.id].slice(20, 40);
  const other = events[0];
  const [delRes, ...during] = await Promise.all([
    req('DELETE', `/events/${victim.id}`, { token: admin }),
    ...doomedGuests.slice(0, 5).map(() => req('GET', `/guests/?event_id=${other.id}&limit=5`, { token: admin })),
  ]);
  ok('event deletion succeeds mid-load', delRes.status === 200);
  const otherOk = during.every((r) => r.status === 200 && r.data.length === 5);
  ok('unrelated event unaffected during deletion', otherOk);
  const afterDel = await req('GET', `/guests/?event_id=${victim.id}&limit=5`, { token: admin });
  ok('deleted event data gone, others intact', afterDel.status === 200 && afterDel.data.length === 0 &&
    (await req('GET', `/guests/?event_id=${other.id}&limit=5`, { token: admin })).data.length === 5,
    `${afterDel.status}/${JSON.stringify(afterDel.data).slice(0, 80)}`);
  // revoke staffer mid-load on event 8
  const target = staffTokens[8];
  await req('PUT', `/users/${target.user.id}`, { token: admin, body: { status: 'suspended' } });
  const denied = await req('POST', '/checkins', { token: target.token, body: { guest_id: guestsByEvent[target.eventId][50].id, activity_id: acts[target.eventId] } });
  ok('suspended staffer blocked immediately', denied.status === 401 || denied.status === 403, String(denied.status));
  const sibling = await req('POST', '/checkins', { token: staffTokens[7].token, body: { guest_id: guestsByEvent[events[7].id][50].id, activity_id: acts[events[7].id] } });
  ok('sibling event staff unaffected', sibling.status === 201, String(sibling.status));

  // ---- isolation under load: cross-event reads still denied at volume ----
  const xa = await req('GET', `/guests/?event_id=${events[1].id}&limit=5`, { token: staffTokens[0].token });
  ok('cross-event read denied under load', xa.status === 403, String(xa.status));

  // ---- observability: platform endpoint + auth scoping ----
  const plat = await req('GET', '/platform', { token: admin });
  ok('platform status (admin)', plat.status === 200 && plat.data.uptime_s >= 0 && Array.isArray(plat.data.endpoints) && plat.data.db);
  ok('platform denied for staff', (await req('GET', '/platform', { token: staffTokens[0].token })).status === 403);

  // ---- audit sampled under load ----
  const audit = await req('GET', `/audit/event/${other.id}?limit=500`, { token: admin });
  ok('audit trail present', audit.data.length > 0, String(audit.data.length));

  const totalMs = Date.now() - t0;
  console.log(`[scale] 10 events, ${totalImported} guests, burst+collisions+failures in ${totalMs}ms`);

  // ---- cleanup ----
  for (const e of events) await req('DELETE', `/events/${e.id}`, { token: admin }).catch(() => {});
  for (const s of staffTokens) await req('DELETE', `/users/${s.user.id}`, { token: admin }).catch(() => {});

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
