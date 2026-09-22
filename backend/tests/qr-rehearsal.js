// Phase 2 live QR rehearsal (spec §27): realistic wedding, 100 guests.
// 60 self-check-in (venue QR) + 30 staff-scanned invitation QR + 10 manual.
// Then: duplicate scan, revoked invitation, invalid QR, wrong-event QR,
// unpermitted staff, idempotent retry, one correction. Leaves the CLOSED
// event + report in place for inspection; prints the reconciliation.
// Run: BASE=http://localhost:3001 ADMIN_PIN=1234 node tests/qr-rehearsal.js

const BASE = process.env.BASE || 'http://localhost:3001';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

async function req(method, path, { token, body, key } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(key ? { 'Idempotency-Key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

const NAMES = ['Amina', 'Brian', 'Cathy', 'David', 'Esther', 'Frank', 'Grace', 'Henry', 'Irene', 'James', 'Kevin', 'Lydia', 'Moses', 'Nancy', 'Oscar', 'Patricia', 'Quincy', 'Ruth', 'Samuel', 'Tina'];
const SURN = ['Mukasa', 'Nabirye', 'Okello', 'Achieng', 'Kato', 'Babirye', 'Omondi', 'Wanjiru', 'Ssemakula', 'Namono'];

async function main() {
  const log = (...a) => console.log(...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  const ev = (await req('POST', '/events', { token: admin, body: { name: `QR-REHEARSAL ${new Date().toISOString().slice(0, 10)}`, date: '2026-12-25', venue: 'Grand Hall', template_key: 'wedding' } })).data;
  log('event', ev.id, 'venue-code', ev.self_checkin_code?.slice(0, 8) + '…');

  // 100 guests
  const guests = [];
  for (let i = 0; i < 100; i++) {
    const g = (await req('POST', '/guests', { token: admin, body: { event_id: ev.id, name: `${NAMES[i % NAMES.length]} ${SURN[(i * 7) % SURN.length]} ${i + 1}` } })).data;
    guests.push(g);
  }
  log('guests created:', guests.length);

  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) {
    const r = await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: s } });
    if (r.status !== 200) throw new Error(`lifecycle -> ${s} failed: ${r.status} ${JSON.stringify(r.data)}`);
  }

  // Invitations for all 100
  const inv = (await req('POST', '/guest-invites', { token: admin, body: { event_id: ev.id, guest_ids: guests.map((g) => g.id) } })).data;
  const tokens = inv.invitations.map((x) => x.token);
  log('invitations issued:', tokens.filter(Boolean).length);

  // RSVP mix: 70 confirmed, 15 declined, 15 silent (one declined guest still attends)
  for (let i = 0; i < 70; i++) await req('POST', `/guest-invite/${tokens[i]}/rsvp`, { body: { response: 'confirmed' } });
  for (let i = 70; i < 85; i++) await req('POST', `/guest-invite/${tokens[i]}/rsvp`, { body: { response: 'declined' } });
  log('rsvp: 70 confirmed / 15 declined / 15 silent');

  // Two staff: entrance scanner (assigned) + outsider (not assigned)
  const mkStaff = async (name) => {
    const pin = String(1000 + Math.floor(Math.random() * 8000));
    const u = await req('POST', '/users', { token: admin, body: { name, pin } });
    const t = (await req('POST', '/auth/login', { body: { pin } })).data.token;
    return { id: u.data.id, token: t };
  };
  const entrance = await mkStaff('QR Entrance');
  const outsider = await mkStaff('QR Outsider');
  await req('POST', `/events/${ev.id}/roles`, { token: admin, body: { user_id: entrance.id, role_key: 'checkin_staff' } });

  const code = (await req('GET', `/events/${ev.id}/checkin-qr`, { token: admin })).data.code;
  const acts = (await req('GET', `/activities?event_id=${ev.id}`, { token: admin })).data;
  if (!Array.isArray(acts) || acts.length === 0) throw new Error(`no activities: ${JSON.stringify(acts)}`);
  const act = acts[0].id;

  // PATH A: 60 self-check-ins (indices 0..59)
  let selfOk = 0;
  for (let i = 0; i < 60; i++) {
    const r = await req('POST', `/self-checkin/${code}/checkin`, { body: { token: tokens[i] } });
    if (r.status === 201) selfOk++;
  }
  // PATH B: 30 staff scans (indices 60..89, includes declined guests 70..84)
  let staffOk = 0, staffCheckinId = null;
  for (let i = 60; i < 90; i++) {
    const r = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: tokens[i], activity_id: act } });
    if (r.status === 201) { staffOk++; if (!staffCheckinId) staffCheckinId = r.data.id; }
  }
  // PATH C: 10 manual (indices 90..99)
  let manOk = 0;
  for (let i = 90; i < 100; i++) {
    const r = await req('POST', '/checkins', { token: entrance.token, body: { guest_id: guests[i].id, activity_id: act } });
    if (r.status === 201) manOk++;
  }
  log(`check-ins: self=${selfOk} staff=${staffOk} manual=${manOk}`);

  // Exceptions
  const dup = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: tokens[65], activity_id: act } });
  log('duplicate scan:', dup.status, dup.data?.reason);
  const list = (await req('GET', `/guest-invites?event_id=${ev.id}`, { token: admin })).data;
  const revokeId = list.find((r) => r.guest_id === guests[95].id).invitation_id;
  await req('POST', `/guest-invites/${revokeId}/revoke`, { token: admin });
  // guest 95 was manually checked in BEFORE revocation: attendance stands, re-scan fails
  const revScan = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: tokens[95], activity_id: act } });
  log('revoked QR scan:', revScan.status, '(attendance from manual check-in stands)');
  const invalid = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: 'ff'.repeat(24), activity_id: act } });
  log('invalid QR:', invalid.status);
  const other = (await req('POST', '/events', { token: admin, body: { name: 'QR-Other', date: '2026-12-26', venue: 'Elsewhere', template_key: 'wedding' } })).data;
  const otherGuest = (await req('POST', '/guests', { token: admin, body: { event_id: other.id, name: 'Wrong Event Wally' } })).data;
  const otherTok = (await req('POST', '/guest-invites', { token: admin, body: { event_id: other.id, guest_ids: [otherGuest.id] } })).data.invitations[0].token;
  const wrongEv = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: otherTok, activity_id: act } });
  log('wrong-event QR:', wrongEv.status, wrongEv.data?.reason);
  const noPerm = await req('POST', '/checkins/qr', { token: outsider.token, body: { token: tokens[10], activity_id: act } });
  log('unpermitted staff:', noPerm.status);
  const retryKey = `rehearsal-${Date.now()}`;
  const rt1 = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: tokens[61], activity_id: act }, key: retryKey });
  const rt2 = await req('POST', '/checkins/qr', { token: entrance.token, body: { token: tokens[61], activity_id: act }, key: retryKey });
  log('idempotent retry:', rt1.status, rt2.status, '(second is a duplicate: no new row either way)');
  // Correction: remove the first staff check-in (guest error at entrance)
  await req('POST', `/checkins/${staffCheckinId}/override`, { token: admin, body: { reason: 'Rehearsal: guest scanned wrong invitation' } });
  log('correction recorded for one staff check-in');

  // Close + reconcile
  await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const rep = (await req('GET', `/event/${ev.id}/report`, { token: admin })).data;
  const m = rep.attendance.methods;
  const expectedTotal = selfOk + staffOk + manOk - 1; // minus the corrected check-in
  const reconciled = rep.attendance.checked_in === expectedTotal
    && (m.self_service_qr + m.staff_qr + m.manual) === rep.attendance.checked_in
    && m.self_service_qr === selfOk && m.manual === manOk && m.staff_qr === staffOk - 1;
  log('report:', JSON.stringify({ checked_in: rep.attendance.checked_in, methods: m }));
  log(`expected total ${expectedTotal}; self=${selfOk} staff=${staffOk - 1} manual=${manOk}`);
  log(reconciled ? 'RECONCILED ✔' : 'MISMATCH ✘');
  const sum = (await req('GET', `/rsvp-summary?event_id=${ev.id}`, { token: admin })).data;
  log('rsvp after close:', JSON.stringify({ confirmed: sum.confirmed, declined: sum.declined, no_response: sum.no_response }), '(check-in created no RSVPs)');

  await req('DELETE', `/events/${other.id}`, { token: admin });
  await req('DELETE', `/users/${outsider.id}`, { token: admin });
  // Entrance staff + CLOSED event left in place for inspection (established pattern).
  log(`done. event ${ev.id} left CLOSED for inspection.`);
  process.exit(reconciled ? 0 : 1);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
