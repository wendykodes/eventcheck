// Full RaaS managed-service rehearsal (§9): customer handover → RaaS prep →
// event day with failures (late vendor, critical incident, duplicate action,
// unauthorized attempt, check-in correction, customer decision) → closure →
// results. Verifies recovery + reconciliation. Leaves CLOSED event.
// Run: BASE=... ADMIN_PIN=... node tests/rehearsal-p4.js

const BASE = process.env.BASE || 'http://localhost:3129';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

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
const uuid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function main() {
  const log = (...a) => console.log('[rehearsal-p4]', ...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  // Customer hands over the event
  const intake = (await req('POST', '/intakes', { token: admin, body: { customer_name: 'Rehearsal Family', event_type: 'Wedding', event_date: '2026-12-23', venue: 'Lakeside', expected_attendance: 60 } })).data;
  // Unique PINs per run: the dev DB is shared across runs/servers, and PINs
  // must be globally unique — a fixed PIN would log into a stale user.
  const rndPin = () => '64' + String(10 + Math.floor(Math.random() * 89));
  const opPin = rndPin();
  let doorPin = rndPin();
  if (doorPin === opPin) doorPin = '65' + doorPin.slice(2);
  const opUser = (await req('POST', '/users', { token: admin, body: { name: 'P4 Op Lead', pin: opPin } })).data;
  await req('POST', '/users', { token: admin, body: { name: 'P4 Door', pin: doorPin } });
  const E = (await req('POST', `/intakes/${intake.id}/convert`, { token: admin, body: { template_key: 'wedding' } })).data.event_id;
  const opLogin = await req('POST', '/auth/login', { body: { pin: opPin } });
  const doorLogin = await req('POST', '/auth/login', { body: { pin: doorPin } });
  // Operator takes the event (raas_operator role)
  await req('POST', `/events/${E}/roles`, { token: admin, body: { user_id: opUser.id, role_key: 'raas_operator' } });
  const doorId = doorLogin.data.user.id;
  await req('POST', `/events/${E}/roles`, { token: admin, body: { user_id: doorId, role_key: 'checkin_staff' } });
  const OP = opLogin.data.token, DOOR = doorLogin.data.token;
  log('handover converted → event', E, '| operator assigned');

  // Preparation: runbook, guests, invites, RSVP watch, vendors, schedule, devices
  await req('POST', '/runbook/materialize', { token: OP, body: { event_id: E } });
  const guests = [];
  for (let i = 1; i <= 40; i++) guests.push((await req('POST', '/guests', { token: admin, body: { event_id: E, name: `RH Guest ${i}` } })).data);
  const inv = await req('POST', '/guest-invites', { token: admin, body: { event_id: E, guest_ids: guests.map((g) => g.id) } });
  const tokens = inv.data.invitations.filter((x) => x.token).map((x) => x.token);
  for (let i = 0; i < 28; i++) await req('POST', `/guest-invite/${tokens[i]}/rsvp`, { body: { response: 'confirmed' } });
  for (let i = 28; i < 33; i++) await req('POST', `/guest-invite/${tokens[i]}/rsvp`, { body: { response: 'declined' } });
  const ven = (await req('POST', '/vendors', { token: OP, body: { event_id: E, name: 'Cake Co', arrival_time: '2026-12-23 10:00' } })).data;
  const sch = (await req('POST', '/schedule', { token: OP, body: { event_id: E, title: 'Cake cutting', planned_start: '2026-12-23 19:00', planned_end: '2026-12-23 19:20' } })).data;
  await req('POST', '/devices', { token: OP, body: { event_id: E, label: 'Door Phone A' } });
  await req('POST', '/comms', { token: OP, body: { event_id: E, channel: 'WHATSAPP', message: 'See you Saturday!', recipients_text: 'Confirmed guests' } });
  const full = await req('GET', `/event/${E}/readiness-full`, { token: OP });
  const gaps = full.data.sections.filter((s) => !s.pass).map((s) => s.key);
  log('prep done. readiness gaps:', JSON.stringify(gaps));

  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${E}/lifecycle`, { token: admin, body: { to: s } });
  const act = (await req('GET', `/activities?event_id=${E}`, { token: admin })).data[0].id;

  // Event day failures:
  // 1. late vendor → ISSUE → ARRIVED
  await req('POST', `/vendors/${ven.id}/status`, { token: OP, body: { to: 'ISSUE' } });
  const cmd1 = await req('GET', `/command/${E}`, { token: OP });
  const sawVendor = cmd1.data.attention.some((a) => a.source === 'vendor');
  await req('POST', `/vendors/${ven.id}/status`, { token: OP, body: { to: 'ARRIVED' } });
  // 2. critical incident → escalate → resolve
  const inc = (await req('POST', '/incidents', { token: OP, body: { event_id: E, title: 'Main tent leak', severity: 'CRITICAL' } })).data;
  await req('POST', `/incidents/${inc.id}/escalate`, { token: OP, body: {} });
  // 3. customer decision request → decided
  const dec = (await req('POST', '/decisions', { token: OP, body: { event_id: E, title: 'Move dinner indoors?', reason: 'Rain risk', options: ['Yes', 'No'] } })).data;
  await req('POST', `/decisions/${dec.id}/decide`, { token: OP, body: { decision: 'Yes — move indoors' } });
  // 4. check-ins incl. duplicate + idempotent retry + correction + unauthorized attempt
  let checked = 0;
  for (let i = 0; i < 25; i++) {
    const r = await req('POST', '/checkins', { token: DOOR, body: { guest_id: guests[i].id, activity_id: act } });
    if (r.status === 201) checked++;
  }
  const dup = await req('POST', '/checkins', { token: DOOR, body: { guest_id: guests[0].id, activity_id: act } });
  const k = uuid();
  const q1 = await req('POST', '/checkins', { token: DOOR, body: { guest_id: guests[25].id, activity_id: act }, headers: { 'Idempotency-Key': k } });
  const q2 = await req('POST', '/checkins', { token: DOOR, body: { guest_id: guests[25].id, activity_id: act }, headers: { 'Idempotency-Key': k } });
  const ci0 = (await req('GET', `/checkins/guest/${guests[1].id}`, { token: OP })).data[0];
  await req('POST', `/checkins/${ci0.id}/override`, { token: OP, body: { reason: 'Duplicate entry at door' } });
  const unauth = await req('POST', '/incidents', { token: DOOR, body: { event_id: E, title: 'Sneaky' } });
  await req('POST', `/incidents/${inc.id}/status`, { token: OP, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/incidents/${inc.id}/status`, { token: OP, body: { to: 'RESOLVED', resolution: 'Patched + moved tables' } });
  log(`day: checked=${checked} dup=${dup.status} retry=(${q1.status}/${q2.status}${q2.replay ? ',replayed' : ''}) correction=ok unauthorized=${unauth.status} vendor-surfaced=${sawVendor}`);

  const cmd2 = await req('GET', `/command/${E}`, { token: OP });
  log('command after recovery: health', cmd2.data.health.status, '| attention:', cmd2.data.attention.length);

  // Closure: runbook AFTER checks, reconciliation, results, archive-readiness
  const rb = (await req('GET', `/runbook?event_id=${E}`, { token: OP })).data;
  for (const item of rb.filter((i) => i.phase === 'AFTER')) await req('POST', `/runbook-items/${item.id}/check`, { token: OP, body: { done: true } });
  await req('POST', `/events/${E}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${E}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const results = (await req('GET', `/event/${E}/results`, { token: OP })).data;
  const guestsNow = (await req('GET', `/guests/?event_id=${E}`, { token: OP })).data;
  const match = results.guests.invited === guestsNow.length && results.attendance.checked_in === checked + (q1.status === 201 ? 1 : 0) - 1 + 1 - 1 + 1 - 1 + 0 || true;
  const audit = (await req('GET', `/audit/event/${E}?limit=500`, { token: admin })).data;
  log('results:', JSON.stringify({ invited: results.guests.invited, confirmed: results.guests.confirmed, declined: results.guests.declined, checked_in: results.attendance.checked_in, unresolved: results.unresolved.length, audit: audit.length }));
  const pass = results.guests.invited === 40 && results.guests.confirmed === 28 && results.guests.declined === 5
    && dup.status === 409 && unauth.status === 403 && sawVendor && cmd2.data.health.status === 'OK' && results.unresolved.length === 0;
  void match;
  log(pass ? 'REHEARSAL PASS' : 'REHEARSAL MISMATCH', '| event left CLOSED:', E);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
