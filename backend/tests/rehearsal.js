// Phase 1 live rehearsal (§51-52): realistic wedding, 110 guests via validated
// 5-step import, mixed RSVP, revocation, activation, 2 staff checking in,
// duplicate/cross-event attempts, closure, report-vs-records reconciliation.
// Run: BASE=http://localhost:3104 ADMIN_PIN=1234 node tests/rehearsal.js
// Leaves the CLOSED event + report in place for inspection; prints report.

const BASE = process.env.BASE || 'http://localhost:3104';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${API_BASE()}/api`;
function API_BASE() { return BASE; }

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

const NAMES = ['Amina', 'Brian', 'Cathy', 'David', 'Esther', 'Frank', 'Grace', 'Henry', 'Irene', 'James', 'Kevin', 'Lydia', 'Moses', 'Nancy', 'Oscar', 'Patricia', 'Quincy', 'Ruth', 'Samuel', 'Tina'];
const SURN = ['Mukasa', 'Nabirye', 'Okello', 'Achieng', 'Kato', 'Babirye', 'Omondi', 'Wanjiru', 'Ssemakula', 'Namono'];

function buildCsv(n) {
  const rows = ['Name,Phone,Table,Category'];
  for (let i = 0; i < n; i++) {
    const name = `${NAMES[i % NAMES.length]} ${SURN[(i * 7) % SURN.length]} ${i + 1}`;
    const phone = `07${String(10000000 + i * 137).slice(0, 8)}`;
    const table = `T${(i % 12) + 1}`;
    rows.push(`${name},${phone},${table},${i % 9 === 0 ? 'VIP' : 'Regular'}`);
  }
  // Intentional dirty rows: 1 missing phone, 1 duplicate of row 1, 1 missing name
  rows.push(`No Phone,,T1,Regular`);
  rows.push(rows[1]);
  rows.push(`,0712345678,T2,Regular`);
  return rows.join('\n');
}

async function main() {
  const log = (...a) => console.log('[rehearsal]', ...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  // 1-4. Create + configure
  const evt = (await req('POST', '/events', { token: admin, body: { name: 'Premium Wedding Rehearsal', date: '2026-12-18', venue: 'Speke Resort Gardens', template_key: 'wedding', expected_attendance: 120, max_capacity: 200 } })).data;
  log('1-4. event', evt.id, evt.lifecycle_state, evt.template_key);
  await req('PUT', `/events/${evt.id}/access-code`, { token: admin, body: {} });

  // 5-6. Import: upload -> parse -> validate -> preview -> confirm
  const csv = buildCsv(110);
  const b64 = Buffer.from(csv).toString('base64');
  const parse = await req('POST', '/guests/import/parse', { token: admin, body: { file_data: b64 } });
  log('5. parsed rows:', parse.data.total_rows, 'cols:', parse.data.columns?.join(','));
  const mapping = { name: parse.data.columns[0], phone: parse.data.columns[1], table_number: parse.data.columns[2], category: parse.data.columns[3] };
  const preview = await req('POST', '/guests/import/preview', { token: admin, body: { event_id: evt.id, session_id: parse.data.session_id, mapping, duplicate_rule: 'phone' } });
  log('6. preview: total=%d valid=%d duplicates=%d invalid=%d warnings=%d', preview.data.total, preview.data.valid, preview.data.duplicates, preview.data.invalid, (preview.data.warnings || []).length);
  const confirm = await req('POST', '/guests/import/confirm', { token: admin, body: { session_id: parse.data.session_id, duplicate_action: 'skip', file_name: 'rehearsal.csv' } });
  log('confirm:', JSON.stringify(confirm.data));

  const guests = (await req('GET', `/guests/?event_id=${evt.id}`, { token: admin })).data;
  log('7. guests in production:', guests.length);

  // 7-10. Invitations for all; open + confirm ~70, decline ~15, rest silent
  const all = (await req('POST', '/guest-invites', { token: admin, body: { event_id: evt.id, guest_ids: guests.map((g) => g.id) } })).data;
  const live = all.invitations.filter((i) => i.token);
  log('8. invitations issued:', live.length, 'reused/errors:', all.invitations.length - live.length);
  for (let i = 0; i < 70; i++) await req('POST', `/guest-invite/${live[i].token}/rsvp`, { body: { response: 'confirmed' } });
  for (let i = 70; i < 85; i++) await req('POST', `/guest-invite/${live[i].token}/rsvp`, { body: { response: 'declined' } });
  // 11-16. Revoke one live invite, verify denied
  const invList = (await req('GET', `/guest-invites?event_id=${evt.id}`, { token: admin })).data;
  const revokeTarget = invList.find((r) => r.guest_id === guests[100].id);
  await req('POST', `/guest-invites/${revokeTarget.invitation_id}/revoke`, { token: admin });
  const denied = await req('GET', `/guest-invite/${live[100].token}`);
  log('15-16. revoked access denied:', denied.status === 410, JSON.stringify(denied.data));

  // 17-19. Activate with 2 staff
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: s } });
  const mkStaff = async (name, pin) => {
    const u = (await req('POST', '/users', { token: admin, body: { name, pin } })).data;
    await req('POST', `/events/${evt.id}/roles`, { token: admin, body: { user_id: u.id, role_key: 'checkin_staff' } });
    return (await req('POST', '/auth/login', { body: { pin } })).data.token;
  };
  const s1 = await mkStaff('Rehearsal Checker One', '6101');
  const s2 = await mkStaff('Rehearsal Checker Two', '6102');
  const act = (await req('GET', `/activities?event_id=${evt.id}`, { token: admin })).data[0].id;

  // 20-23. Arrivals: 62 check-ins across 2 staff, duplicate + cross-event attempts
  let okCount = 0;
  for (let i = 0; i < 62; i++) {
    const r = await req('POST', '/checkins', { token: i % 2 ? s1 : s2, body: { guest_id: guests[i].id, activity_id: act } });
    if (r.status === 201) okCount++;
  }
  const dup = await req('POST', '/checkins', { token: s1, body: { guest_id: guests[0].id, activity_id: act } });
  log('20-23. checked in:', okCount, '| duplicate rejected:', dup.status === 409 && dup.data.error === 'Already checked in');

  // 24-25. Cross-event attack from a second event
  const other = (await req('POST', '/events', { token: admin, body: { name: 'Rehearsal Decoy', template_key: 'conference' } })).data;
  const oGuest = (await req('POST', '/guests', { token: admin, body: { event_id: other.id, name: 'Decoy Dan' } })).data;
  const xa = await req('POST', '/checkins', { token: s1, body: { guest_id: oGuest.id, activity_id: act } });
  const xb = await req('GET', `/events/${other.id}`, { token: s1 });
  log('24-25. cross-event checkin blocked:', xa.status !== 201, '| cross-event read blocked:', xb.status === 403);

  // 26-28. Close + report + reconcile against records
  await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const report = (await req('GET', `/event/${evt.id}/report`, { token: admin })).data;
  const guestsNow = (await req('GET', `/guests/?event_id=${evt.id}`, { token: admin })).data;
  const invited = guestsNow.length;
  const confirmed = guestsNow.filter((g) => g.rsvp_status === 'confirmed').length;
  const declined = guestsNow.filter((g) => g.rsvp_status === 'declined').length;
  const match = report.guests.invited === invited && report.guests.confirmed === confirmed && report.guests.declined === declined && report.attendance.checked_in === okCount;
  log('26-28. report:', JSON.stringify({ invited: report.guests.invited, confirmed: report.guests.confirmed, declined: report.guests.declined, no_response: report.guests.no_response, ...report.attendance }));
  log('reconciled with records:', match);

  // 29-30. Audit + closed readability
  const audit = (await req('GET', `/audit/event/${evt.id}?limit=500`, { token: admin })).data;
  const readable = (await req('GET', `/events/${evt.id}`, { token: admin })).status === 200;
  log('29-30. audit rows:', audit.length, '| closed event readable:', readable);
  await req('DELETE', `/events/${other.id}`, { token: admin });
  log('DONE. rehearsal event id:', evt.id, '(left CLOSED for inspection)');
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
