// Phase 2 QR Access & Dual Check-in — security matrix + data integrity.
// Run: BASE=http://localhost:3001 ADMIN_PIN=1234 node tests/qr-checkin.test.js
// Covers spec §25 matrix, §26 categories, §15 isolation, §16 RSVP separation.

const BASE = process.env.BASE || 'http://localhost:3001';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

let passed = 0, failed = 0;
const results = [];
function ok(name, cond, detail = '') {
  if (cond) { passed++; results.push(`PASS ${name}`); }
  else { failed++; results.push(`FAIL ${name} ${detail}`); }
}

let adminToken = null;
const knownAdminTokens = new Set();
async function req(method, path, { token, body, key } = {}) {
  const call = async (tok) => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { status: res.status, data, replayed: res.headers.get('Idempotent-Replayed') };
  };
  let r = await call(token);
  if (r.status === 401 && token && knownAdminTokens.has(token)) {
    adminToken = await adminLogin();
    knownAdminTokens.add(adminToken);
    r = await call(adminToken);
  }
  return r;
}

const adminLogin = async () => (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

async function main() {
  const admin = await adminLogin();
  adminToken = admin;
  knownAdminTokens.add(admin);
  ok('admin login', !!admin);

  const mkEvent = async (name) => (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding' } })).data;
  const A = await mkEvent('QRT Event A');
  const B = await mkEvent('QRT Event B');
  const C = await mkEvent('QRT Event C (lifecycle)');
  ok('events have venue codes', !!A.self_checkin_code && !!B.self_checkin_code && A.self_checkin_code !== B.self_checkin_code);

  const mkGuest = async (event_id, name) => {
    let r = await req('POST', '/guests', { token: admin, body: { event_id, name } });
    if (!r.data?.id) r = await req('POST', '/guests', { token: admin, body: { event_id, name } }); // setup retry
    if (!r.data?.id) throw new Error(`setup mkGuest failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const a1 = await mkGuest(A.id, 'A One');   // confirmed RSVP, self-check-in
  const a2 = await mkGuest(A.id, 'A Two');   // no response, staff QR
  const a3 = await mkGuest(A.id, 'A Three'); // declined RSVP, staff QR
  const a4 = await mkGuest(A.id, 'A Four');  // no invite at all
  const a5 = await mkGuest(A.id, 'A Five');  // revoked invite
  const a6 = await mkGuest(A.id, 'A Six');   // concurrency target
  const b1 = await mkGuest(B.id, 'B One');
  const c1 = await mkGuest(C.id, 'C One');
  for (const e of [A, B, C]) for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) {
    const r = await req('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: s } });
    if (s === 'ACTIVE') ok(`lifecycle ACTIVE ${e.name}`, r.status === 200, JSON.stringify(r.data).slice(0, 100));
  }

  const mkInvites = async (event_id, ids) => {
    let r = await req('POST', '/guest-invites', { token: admin, body: { event_id, guest_ids: ids } });
    if (!r.data?.invitations) r = await req('POST', '/guest-invites', { token: admin, body: { event_id, guest_ids: ids } }); // setup retry
    if (!r.data?.invitations) throw new Error(`setup mkInvites failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const invA = await mkInvites(A.id, [a1.id, a2.id, a3.id, a5.id, a6.id]);
  const tok = Object.fromEntries(invA.invitations.map((i) => [i.guest_id, i.token]));
  const invB = await mkInvites(B.id, [b1.id]);
  const tB1 = invB.invitations[0].token;
  const invC = await mkInvites(C.id, [c1.id]);
  const tC1 = invC.invitations[0].token;

  // RSVP states: a1 confirmed, a3 declined, rest silent
  await req('POST', `/guest-invite/${tok[a1.id]}/rsvp`, { body: { response: 'confirmed' } });
  await req('POST', `/guest-invite/${tok[a3.id]}/rsvp`, { body: { response: 'declined' } });

  // Revoke a5's invitation
  const listA = await req('GET', `/guest-invites?event_id=${A.id}`, { token: admin });
  const invId5 = listA.data.find((r) => r.guest_id === a5.id).invitation_id;
  await req('POST', `/guest-invites/${invId5}/revoke`, { token: admin });

  const actsA = (await req('GET', `/activities?event_id=${A.id}`, { token: admin })).data;
  const actsB = (await req('GET', `/activities?event_id=${B.id}`, { token: admin })).data;
  const actA = actsA[0].id, actB = actsB[0].id;

  // Staff users: one assigned to A, one unassigned
  const mkStaff = async (name) => {
    const pin = String(100000 + Math.floor(Math.random() * 800000)); // 6-digit: no collision with accumulated test users
    const u = await req('POST', '/users', { token: admin, body: { name, pin } });
    const t = (await req('POST', '/auth/login', { body: { pin } })).data.token;
    return { id: u.data.id, token: t };
  };
  const stA = await mkStaff('QRT Staff A');
  const stNone = await mkStaff('QRT Staff None');
  await req('POST', `/events/${A.id}/roles`, { token: admin, body: { user_id: stA.id, role_key: 'checkin_staff' } });

  const codeA = (await req('GET', `/events/${A.id}/checkin-qr`, { token: admin })).data.code;
  const codeB = (await req('GET', `/events/${B.id}/checkin-qr`, { token: admin })).data.code;

  // ---- Venue QR resolution: public, no guest data ----
  const pub = await req('GET', `/self-checkin/${codeA}`);
  ok('venue resolve public', pub.status === 200 && pub.data.event.id === A.id);
  ok('venue leaks nothing', pub.status === 200 && !pub.data.guest_list && pub.data.checked_in === undefined && JSON.stringify(pub.data).length < 500, JSON.stringify(pub.data).slice(0, 200));
  const pubBad = await req('GET', '/self-checkin/ffffffffffffffffffffffffffffffff');
  ok('unknown venue 404', pubBad.status === 404, `got ${pubBad.status}`);

  // ---- PATH A self-check-in ----
  const self1 = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: tok[a1.id] } });
  ok('self check-in succeeds', self1.status === 201 && self1.data.guest_name === 'A One', JSON.stringify(self1.data));
  const selfUrl = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: `https://x.test/invite/${tok[a2.id]}` } });
  ok('self accepts full invite URL', selfUrl.status === 201, JSON.stringify(selfUrl.data));
  const selfDup = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: tok[a1.id] } });
  ok('self duplicate friendly', selfDup.status === 200 && selfDup.data.already === true, JSON.stringify(selfDup.data));
  const selfBad = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: 'ab'.repeat(24) } });
  ok('self invalid token 404', selfBad.status === 404);
  const selfNone = await req('POST', `/self-checkin/${codeA}/checkin`, { body: {} });
  ok('self missing token 404', selfNone.status === 404);
  const selfRev = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: tok[a5.id] } });
  ok('self revoked 410', selfRev.status === 410, JSON.stringify(selfRev.data));
  const selfWrong = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: tB1 } });
  ok('self wrong-event 403', selfWrong.status === 403, JSON.stringify(selfWrong.data));
  const tampered = tok[a2.id].slice(0, -2) + (tok[a2.id].endsWith('aa') ? 'bb' : 'aa');
  const selfTam = await req('POST', `/self-checkin/${codeA}/checkin`, { body: { token: tampered } });
  ok('self tampered 404', selfTam.status === 404);

  // ---- PATH B staff QR ----
  const staff1 = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a3.id], activity_id: actA } });
  ok('staff qr succeeds (declined still eligible)', staff1.status === 201 && staff1.data.method === 'STAFF_QR' && staff1.data.rsvp_status === 'declined', JSON.stringify(staff1.data));
  const staffDup = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a3.id], activity_id: actA } });
  ok('staff duplicate 409', staffDup.status === 409 && staffDup.data.reason === 'ALREADY_CHECKED_IN', JSON.stringify(staffDup.data));
  const staffRev = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a5.id], activity_id: actA } });
  ok('staff revoked 410', staffRev.status === 410, JSON.stringify(staffRev.data));
  const staffWrong1 = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tB1, activity_id: actA } });
  ok('staff cross-event token rejected', staffWrong1.status === 400 && staffWrong1.data.reason === 'WRONG_EVENT', `got ${staffWrong1.status}`);
  const staffWrong2 = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a2.id], activity_id: actB } });
  ok('staff guest/activity mismatch rejected', staffWrong2.status !== 201, `got ${staffWrong2.status}`);
  const staffNoAuth = await req('POST', '/checkins/qr', { body: { token: tok[a2.id], activity_id: actA } });
  ok('staff qr requires auth', staffNoAuth.status === 401, `got ${staffNoAuth.status}`);
  const staffDenied = await req('POST', '/checkins/qr', { token: stNone.token, body: { token: tok[a6.id], activity_id: actA } });
  ok('unauthorized staff 403', staffDenied.status === 403, `got ${staffDenied.status}`);

  // Idempotency replay: same key twice → one row
  const rkey = `qr-test-${Date.now()}`;
  const r1 = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a6.id], activity_id: actA }, key: rkey });
  const r2 = await req('POST', '/checkins/qr', { token: stA.token, body: { token: tok[a6.id], activity_id: actA }, key: rkey });
  ok('idempotent replay', r1.status === 201 && r2.status === 201 && r2.replayed === 'true', `${r1.status}/${r2.status} replayed=${r2.replayed}`);

  // Concurrency: 5 parallel scans of one QR → exactly one new check-in
  const gRace = await mkGuest(A.id, 'A Race');
  const invRaceRaw = await req('POST', '/guest-invites', { token: admin, body: { event_id: A.id, guest_ids: [gRace.id] } });
  if (!invRaceRaw.data?.invitations) throw new Error(`race invite failed: status=${invRaceRaw.status} body=${JSON.stringify(invRaceRaw.data)} guest=${JSON.stringify(gRace)}`);
  const invRace = invRaceRaw.data;
  const tRace = invRace.invitations.find((i) => i.token)?.token;
  ok('race invite issued', !!tRace);
  const before = (await req('GET', `/event/${A.id}/report`, { token: admin })).data.attendance.checked_in;
  const races = await Promise.all([1, 2, 3, 4, 5].map(() => req('POST', '/checkins/qr', { token: stA.token, body: { token: tRace, activity_id: actA } })));
  const created = races.filter((r) => r.status === 201).length;
  const after = (await req('GET', `/event/${A.id}/report`, { token: admin })).data.attendance.checked_in;
  ok('concurrent scans single row', created === 1 && after - before === 1, `created=${created} delta=${after - before}`);

  // Rotation invalidates old venue code
  const rot = await req('POST', `/events/${A.id}/checkin-qr/rotate`, { token: admin });
  ok('venue rotate', rot.status === 200 && rot.data.code !== codeA, JSON.stringify(rot.data).slice(0, 100));
  const oldCode = await req('GET', `/self-checkin/${codeA}`);
  ok('old venue code dead', oldCode.status === 404, `got ${oldCode.status}`);
  const newCode = (await req('GET', `/events/${A.id}/checkin-qr`, { token: admin })).data.code;
  ok('new venue code live', (await req('GET', `/self-checkin/${newCode}`)).status === 200 && newCode === rot.data.code);

  // Lifecycle: close C → self + staff denied
  await req('POST', `/events/${C.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${C.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const codeC = (await req('GET', `/events/${C.id}/checkin-qr`, { token: admin })).data.code;
  const closedSelf = await req('POST', `/self-checkin/${codeC}/checkin`, { body: { token: tC1 } });
  ok('self closed 409', closedSelf.status === 409, `got ${closedSelf.status}`);
  const closedStaff = await req('POST', '/checkins/qr', { token: admin, body: { token: tC1, activity_id: (await req('GET', `/activities?event_id=${C.id}`, { token: admin })).data[0].id } });
  ok('staff closed 409', closedStaff.status === 409, `got ${closedStaff.status}`);

  // ---- Data integrity + RSVP separation ----
  const sum = await req('GET', `/rsvp-summary?event_id=${A.id}`, { token: admin });
  ok('rsvp untouched by check-in', sum.data.confirmed === 1 && sum.data.declined === 1 && sum.data.no_response === sum.data.invited - 2, JSON.stringify(sum.data));
  const rep = await req('GET', `/event/${A.id}/report`, { token: admin });
  const m = rep.data.attendance.methods;
  ok('report methods reconcile', m.self_service_qr + m.staff_qr + m.manual === rep.data.attendance.checked_in && m.self_service_qr >= 2 && m.staff_qr >= 2, JSON.stringify(m));
  const audit = await req('GET', `/audit/event/${A.id}?limit=300`, { token: admin });
  const actions = new Set((audit.data || []).map((r) => r.action));
  for (const need of ['checkin.perform', 'checkin.rejected', 'qr.venue.rotated']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].join(','));
  }

  // ---- Cleanup ----
  for (const e of [A, B, C]) await req('DELETE', `/events/${e.id}`, { token: admin });
  await req('DELETE', `/users/${stA.id}`, { token: admin });
  await req('DELETE', `/users/${stNone.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
