// Phase 1 automated tests — lifecycle, authz, RSVP, check-in, report, isolation.
// Plain Node (no framework). Run: BASE=http://localhost:3103 ADMIN_PIN=1234 node tests/phase1.test.js
// Creates Event A + Event B, exercises cross-event attacks, cleans up.

const BASE = process.env.BASE || 'http://localhost:3103';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

let passed = 0, failed = 0;
const results = [];
function ok(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS ${name}`); }
  else { failed++; results.push(`FAIL ${name} ${detail}`); }
}

async function req(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const adminLogin = async () => (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

async function main() {
  const admin = await adminLogin();
  ok('admin login', !!admin);

  // --- Setup: two events, guests, staff ---
  const mkEvent = async (name) => (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding' } })).data;
  const A = await mkEvent('P1T Event A');
  const B = await mkEvent('P1T Event B');
  ok('events created DRAFT', A.lifecycle_state === 'DRAFT' && B.lifecycle_state === 'DRAFT');

  // Invalid direct activation blocked (also readiness gate would block)
  const bad = await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'ACTIVE' } });
  ok('illegal DRAFT->ACTIVE rejected', bad.status === 409);

  const mkGuest = async (event_id, name) => (await req('POST', '/guests', { token: admin, body: { event_id, name } })).data;
  const gA1 = await mkGuest(A.id, 'Ann A');
  const gA2 = await mkGuest(A.id, 'Andy A');
  const gB1 = await mkGuest(B.id, 'Ben B');
  ok('guests created', gA1.id && gB1.id);

  // Staff assigned to A only
  const spin = String(1000 + Math.floor(Math.random() * 8000));
  const staff = await req('POST', '/users', { token: admin, body: { name: 'P1T Staff', pin: spin } });
  const staffLogin = await req('POST', '/auth/login', { body: { pin: spin } });
  const st = staffLogin.data.token;
  await req('POST', `/events/${A.id}/roles`, { token: admin, body: { user_id: staff.data.id, role_key: 'checkin_staff' } });

  // Isolation: staff A cannot read B
  const sb = await req('GET', `/events/${B.id}`, { token: st });
  ok('staff cannot read unassigned event', sb.status === 403, JSON.stringify(sb.data));
  const sg = await req('GET', `/guests/?event_id=${B.id}`, { token: st });
  ok('staff cannot list unassigned guests', sg.status === 403);
  const sd = await req('GET', `/dashboard/${B.id}`, { token: st });
  ok('staff cannot view unassigned dashboard', sd.status === 403);

  // --- Invitations + RSVP ---
  const inv = await req('POST', '/guest-invites', { token: admin, body: { event_id: A.id, guest_ids: [gA1.id, gA2.id] } });
  ok('invites created', inv.status === 201 && inv.data.invitations.length === 2 && !!inv.data.invitations[0].token);
  const tA1 = inv.data.invitations[0].token;

  const open = await req('GET', `/guest-invite/${tA1}`);
  ok('guest opens invite (no auth)', open.status === 200 && open.data.event.id === A.id);
  ok('invite leaks no other guests', open.status === 200 && !open.data.guest_list && open.data.guest.name === 'Ann A');

  const rsvp1 = await req('POST', `/guest-invite/${tA1}/rsvp`, { body: { response: 'confirmed' } });
  ok('rsvp confirm', rsvp1.status === 200 && rsvp1.data.rsvp_status === 'confirmed');
  const rsvpRetry = await req('POST', `/guest-invite/${tA1}/rsvp`, { body: { response: 'confirmed' } });
  ok('rsvp retry idempotent', rsvpRetry.status === 200 && rsvpRetry.data.unchanged === true);
  const rsvpChange = await req('POST', `/guest-invite/${tA1}/rsvp`, { body: { response: 'declined' } });
  ok('rsvp change allowed', rsvpChange.status === 200 && rsvpChange.data.previous === 'confirmed');
  await req('POST', `/guest-invite/${tA1}/rsvp`, { body: { response: 'confirmed' } });

  // Cross-event: B guest has no invite in A; invalid token fails
  const badRsvp = await req('POST', '/guest-invite/0000000000000000000000000000000000000000/rsvp', { body: { response: 'confirmed' } });
  ok('invalid token rejected', badRsvp.status === 404);

  // Revocation
  const list = await req('GET', `/guest-invites?event_id=${A.id}`, { token: admin });
  const invId2 = list.data.find((r) => r.guest_id === gA2.id).invitation_id;
  await req('POST', `/guest-invites/${invId2}/revoke`, { token: admin });
  const tA2 = inv.data.invitations[1].token;
  const revoked = await req('GET', `/guest-invite/${tA2}`);
  ok('revoked invite denied', revoked.status === 410);

  // Summary accuracy
  const sum = await req('GET', `/rsvp-summary?event_id=${A.id}`, { token: admin });
  ok('rsvp summary accurate', sum.data.invited === 2 && sum.data.confirmed === 1 && sum.data.no_response === 1, JSON.stringify(sum.data));

  // --- Activation gate + check-in ---
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) {
    const r = await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: s } });
    ok(`lifecycle -> ${s}`, r.status === 200, JSON.stringify(r.data).slice(0, 120));
  }
  const acts = await req('GET', `/activities?event_id=${A.id}`, { token: admin });
  const actA = acts.data[0].id;
  const actsB = await req('GET', `/activities?event_id=${B.id}`, { token: admin });
  const actB = actsB.data[0].id;

  const ci = await req('POST', '/checkins', { token: st, body: { guest_id: gA1.id, activity_id: actA } });
  ok('check-in works', ci.status === 201);
  const dup = await req('POST', '/checkins', { token: st, body: { guest_id: gA1.id, activity_id: actA } });
  ok('duplicate check-in 409', dup.status === 409 && dup.data.error === 'Already checked in', JSON.stringify(dup.data).slice(0, 120));
  const cross = await req('POST', '/checkins', { token: st, body: { guest_id: gB1.id, activity_id: actA } });
  ok('cross-event check-in blocked', cross.status !== 201, `got ${cross.status}`);
  const cross2 = await req('POST', '/checkins', { token: st, body: { guest_id: gA1.id, activity_id: actB } });
  ok('guest/activity mismatch blocked', cross2.status === 400, `got ${cross2.status}`);

  // --- Closure + report ---
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  const frozen = await req('POST', '/guests', { token: admin, body: { event_id: A.id, name: 'Late Lee' } });
  ok('guest create frozen in CLOSING', frozen.status === 409);
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const ciClosed = await req('POST', '/checkins', { token: st, body: { guest_id: gA2.id, activity_id: actA } });
  ok('check-in blocked when CLOSED', ciClosed.status === 409);
  const report = await req('GET', `/event/${A.id}/report`, { token: admin });
  ok('report accurate', report.status === 200 && report.data.guests.invited === 2 && report.data.attendance.checked_in === 1, JSON.stringify(report.data?.attendance));
  const audit = await req('GET', `/audit/event/${A.id}?limit=200`, { token: admin });
  const actions = new Set((audit.data || []).map((r) => r.action));
  for (const need of ['event.create', 'guest.create', 'invite.create', 'rsvp.submit', 'checkin.perform']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].join(','));
  }

  // --- Cleanup ---
  await req('DELETE', `/events/${A.id}`, { token: admin });
  await req('DELETE', `/events/${B.id}`, { token: admin });
  await req('DELETE', `/users/${staff.data.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
