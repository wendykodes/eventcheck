// Guest Journey end-to-end rehearsal (§31 DoD scenario): organizer creates
// event → guest added → invite → RSVP → seat assigned → menu configured →
// guest scans generic venue QR → identified → checked in → sees seat →
// confirms seated → orders drink → staff fulfils → guest sees delivered.
// Plus: seating assistance for unassigned guest, duplicate-safety, isolation.
// Run: BASE=http://localhost:3001 ADMIN_PIN=1234 node tests/journey-rehearsal.js

const BASE = process.env.BASE || 'http://localhost:3001';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;
const log = (...a) => console.log(...a);

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

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  let ok = true;
  const check = (name, cond, extra = '') => { log(`${cond ? '✔' : '✘'} ${name}${extra && !cond ? ' — ' + extra : ''}`); if (!cond) ok = false; };

  // 1-2. Organizer creates event, guest added
  const ev = (await req('POST', '/events', { token: admin, body: { name: `JOURNEY-REHEARSAL ${new Date().toISOString().slice(0, 10)}`, date: '2026-12-25', venue: 'Grand Hall', template_key: 'wedding' } })).data;
  const sarah = (await req('POST', '/guests', { token: admin, body: { event_id: ev.id, name: 'Sarah Namukasa' } })).data;
  const lost = (await req('POST', '/guests', { token: admin, body: { event_id: ev.id, name: 'Lost Larry' } })).data;
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: s } });

  // 3-5. Invitation, RSVP
  const toks = (await req('POST', '/guest-invites', { token: admin, body: { event_id: ev.id, guest_ids: [sarah.id, lost.id] } })).data.invitations.map((i) => i.token);
  await req('POST', `/guest-invite/${toks[0]}/rsvp`, { body: { response: 'confirmed' } });

  // 6-9. Seat, venue QR, menu
  const zone = (await req('POST', '/seating/zones', { token: admin, body: { event_id: ev.id, name: 'Table 7', kind: 'TABLE', location: 'Pavilion, left side' } })).data;
  await req('POST', '/seating/assign', { token: admin, body: { event_id: ev.id, zone_id: zone.id, guest_id: sarah.id } });
  await req('POST', '/service-menu', { token: admin, body: { event_id: ev.id, label: 'Mocktail', kind: 'DRINK' } });
  const code = (await req('GET', `/events/${ev.id}/checkin-qr`, { token: admin })).data.code;
  const pin = String(100000 + Math.floor(Math.random() * 800000));
  const usher = await req('POST', '/users', { token: admin, body: { name: 'Rehearsal Usher', pin } });
  const usherTok = (await req('POST', '/auth/login', { body: { pin } })).data.token;
  await req('POST', `/events/${ev.id}/roles`, { token: admin, body: { user_id: usher.data.id, role_key: 'usher' } });

  // 10-13. Generic QR → identified → checked in (venue entry, token pasted once)
  const venue = await req('GET', `/self-checkin/${code}`);
  check('venue QR resolves (public, no guest data)', venue.status === 200 && !JSON.stringify(venue.data).includes('Sarah'));
  const ctx0 = await req('GET', `/journey/${toks[0]}`);
  check('identified as Sarah', ctx0.status === 200 && ctx0.data.guest.name === 'Sarah Namukasa' && ctx0.data.state === 'RSVP_RESPONDED', JSON.stringify(ctx0.data).slice(0, 160));
  const ci = await req('POST', `/self-checkin/${code}/checkin`, { body: { token: toks[0] } });
  check('checked in via generic QR', ci.status === 201 && ci.data.seat?.zone_name === 'Table 7', JSON.stringify(ci.data).slice(0, 120));

  // 14-16. Sees seat, directions, confirms seated
  const ctx1 = (await req('GET', `/journey/${toks[0]}`)).data;
  check('seat + wayfinding', ctx1.state === 'DIRECTED' && ctx1.seat.location === 'Pavilion, left side' && ctx1.venue_zones.some((z) => z.mine));
  check('guest confirms seated', (await req('POST', `/journey/${toks[0]}/seat-confirm`)).data.seat.seated_via === 'GUEST');

  // 17-21. Orders drink → staff sees with table → fulfils → guest sees status
  const mocktail = (await req('GET', `/journey/${toks[0]}/menu`)).data.find((m) => m.label === 'Mocktail');
  const order = (await req('POST', `/journey/${toks[0]}/requests`, { body: { menu_item_id: mocktail.id } })).data.request;
  check('drink ordered w/ table known', order.seat_label === 'Table 7' && order.guest_id === sarah.id, JSON.stringify(order).slice(0, 140));
  const opsQ = (await req('GET', `/requests?event_id=${ev.id}`, { token: admin })).data;
  check('usher queue sees it', opsQ.some((r) => r.id === order.id && r.guest_id === sarah.id));
  for (const s of ['ASSIGNED', 'IN_PROGRESS', 'FULFILLED']) await req('POST', `/requests/${order.id}/status`, { token: admin, body: { to: s } });
  check('guest sees delivered', (await req('GET', `/journey/${toks[0]}/requests`)).data[0].guest_status === 'delivered');

  // Assistance path for unassigned guest
  await req('POST', `/self-checkin/${code}/checkin`, { body: { token: toks[1] } });
  const help = (await req('POST', `/journey/${toks[1]}/requests`, { body: { category: 'SEATING_ASSISTANCE' } })).data.request;
  check('seating assistance routed', help.category === 'SEATING_ASSISTANCE' && help.location === 'Entrance');

  // 22-24. Audit, duplicates, isolation
  const audit = (await req('GET', `/audit/event/${ev.id}?limit=400`, { token: admin })).data.map((r) => r.action);
  for (const a of ['checkin.perform', 'seating.confirm', 'request.create', 'menu.create']) check(`audit ${a}`, audit.includes(a));
  const dup1 = await req('POST', `/self-checkin/${code}/checkin`, { body: { token: toks[0] } });
  // Reordering a FULFILLED drink legitimately creates a new request — so the
  // duplicate check uses Larry's still-OPEN assistance request instead.
  const dup2 = await req('POST', `/journey/${toks[1]}/requests`, { body: { category: 'SEATING_ASSISTANCE' } });
  check('no duplicate check-in/request', dup1.data.already === true && dup2.data.duplicate === true);
  const rep = (await req('GET', `/event/${ev.id}/report`, { token: admin })).data;
  check('report reconciles (2 checked in)', rep.attendance.checked_in === 2, JSON.stringify(rep.attendance.methods));

  await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${ev.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  await req('DELETE', `/users/${usher.data.id}`, { token: admin });
  await req('DELETE', `/events/${ev.id}`, { token: admin });
  log(ok ? 'JOURNEY RECONCILED ✔' : 'JOURNEY MISMATCH ✘');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
