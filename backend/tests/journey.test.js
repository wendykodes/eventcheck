// Guest Journey & Event Companion — §27 scenarios + security + regression.
// Run: BASE=http://localhost:3001 ADMIN_PIN=1234 node tests/journey.test.js

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
  // Single-session auth: any concurrent admin login rotates the session.
  // Re-login and retry — callers may hold stale tokens, so track them all.
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

  const mkEvent = async (name) => {
    let r = await req('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding' } });
    if (!r.data?.id) throw new Error(`mkEvent failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const mkGuest = async (event_id, name) => {
    let r = await req('POST', '/guests', { token: admin, body: { event_id, name } });
    if (!r.data?.id) r = await req('POST', '/guests', { token: admin, body: { event_id, name } });
    if (!r.data?.id) throw new Error(`mkGuest failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const mkInvites = async (event_id, ids) => {
    let r = await req('POST', '/guest-invites', { token: admin, body: { event_id, guest_ids: ids } });
    if (!r.data?.invitations) r = await req('POST', '/guest-invites', { token: admin, body: { event_id, guest_ids: ids } });
    if (!r.data?.invitations) throw new Error(`mkInvites failed: ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  const activate = async (e) => {
    for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: s } });
  };

  const J1 = await mkEvent('JNY Event 1');
  const J2 = await mkEvent('JNY Event 2');
  const gSeat = await mkGuest(J1.id, 'Seated Sam');
  const gNoSeat = await mkGuest(J1.id, 'Wander Wendy');
  const gPending = await mkGuest(J1.id, 'Pending Pete');
  const gB = await mkGuest(J2.id, 'Other Olly');
  await activate(J1);
  await activate(J2);

  // Mark Uma unapproved: delete + recreate as staff-suggested pending
  const spin = String(100000 + Math.floor(Math.random() * 800000));
  const staffU = await req('POST', '/users', { token: admin, body: { name: 'JNY Staff', pin: spin } });
  const staffTok = (await req('POST', '/auth/login', { body: { pin: spin } })).data.token;
  await req('POST', `/events/${J1.id}/roles`, { token: admin, body: { user_id: staffU.data.id, role_key: 'checkin_staff' } });
  // Staff-suggested guest → pending approval (staff can create, not approve).
  const sugUma = await req('POST', '/guests', { token: staffTok, body: { event_id: J1.id, name: 'Suggested Sue' } });
  if (sugUma.data?.status !== 'pending') throw new Error(`expected pending guest, got ${JSON.stringify(sugUma.data)}`);

  const inv1 = await mkInvites(J1.id, [gSeat.id, gNoSeat.id, gPending.id, sugUma.data.id]);
  const tok = Object.fromEntries(inv1.invitations.map((i) => [i.guest_id, i.token]));
  const invB = await mkInvites(J2.id, [gB.id]);
  const tB = invB.invitations[0].token;

  // Seating + menu (organizer config)
  const zone = (await req('POST', '/seating/zones', { token: admin, body: { event_id: J1.id, name: 'Table 7', kind: 'TABLE', location: 'Pavilion left' } })).data;
  await req('POST', '/seating/assign', { token: admin, body: { event_id: J1.id, zone_id: zone.id, guest_id: gSeat.id } });
  const drink = (await req('POST', '/service-menu', { token: admin, body: { event_id: J1.id, label: 'Mocktail', kind: 'DRINK' } })).data;
  const bite = (await req('POST', '/service-menu', { token: admin, body: { event_id: J1.id, label: 'Samosa', kind: 'BITE' } })).data;
  const hidden = (await req('POST', '/service-menu', { token: admin, body: { event_id: J1.id, label: 'Secret', kind: 'DRINK' } })).data;
  await req('PUT', `/service-menu/${hidden.id}`, { token: admin, body: { available: false } });
  ok('menu crud', drink.id && bite.id, JSON.stringify({ drink, bite }).slice(0, 100));

  // ---- Identification matrix ----
  const ctx0 = await req('GET', `/journey/${tok[gSeat.id]}`);
  ok('identify valid', ctx0.status === 200 && ctx0.data.guest.name === 'Seated Sam' && ctx0.data.state === 'INVITED', JSON.stringify(ctx0.data).slice(0, 160));
  ok('identify exposes seat pre-checkin', ctx0.data.seat?.zone_name === 'Table 7');
  ok('identify leaks nothing', !ctx0.data.guest_list && ctx0.data.checked_in === undefined && !JSON.stringify(ctx0.data).includes('Other Olly'));
  const ctxUrl = await req('GET', `/journey/${encodeURIComponent(`https://x.test/invite/${tok[gSeat.id]}`)}`);
  ok('token from URL accepted', ctxUrl.status === 200, `got ${ctxUrl.status}`);
  ok('invalid rejected', (await req('GET', '/journey/' + 'ab'.repeat(24))).status === 404);
  const list1 = await req('GET', `/guest-invites?event_id=${J1.id}`, { token: admin });
  const revId = list1.data.find((r) => r.guest_id === gNoSeat.id).invitation_id;
  await req('POST', `/guest-invites/${revId}/revoke`, { token: admin });
  ok('revoked rejected', (await req('GET', `/journey/${tok[gNoSeat.id]}`)).status === 410);
  // reissue for later steps
  const re = await mkInvites(J1.id, [gNoSeat.id]);
  const tNoSeat = re.invitations.find((i) => i.token).token;
  const ctxB = await req('GET', `/journey/${tB}`);
  ok('cross-event isolation', ctxB.status === 200 && ctxB.data.event.id === J2.id && !JSON.stringify(ctxB.data).includes('Seated Sam'));

  // ---- Check-in via invite link ----
  const ci1 = await req('POST', `/guest-invite/${tok[gSeat.id]}/checkin`);
  ok('invite-link checkin', ci1.status === 201 && ci1.data.seat?.zone_name === 'Table 7', JSON.stringify(ci1.data).slice(0, 160));
  const ciDup = await req('POST', `/guest-invite/${tok[gSeat.id]}/checkin`);
  ok('invite-link duplicate', ciDup.status === 200 && ciDup.data.already === true, JSON.stringify(ciDup.data).slice(0, 120));
  const ciUnappr = await req('POST', `/guest-invite/${tok[sugUma.data.id]}/checkin`);
  ok('unapproved blocked', ciUnappr.status === 403, `got ${ciUnappr.status}`);
  // concurrency: fresh guest, 5 parallel
  const gRace = await mkGuest(J1.id, 'Race Ray');
  const tRace = (await mkInvites(J1.id, [gRace.id])).invitations.find((i) => i.token).token;
  const races = await Promise.all([1, 2, 3, 4, 5].map(() => req('POST', `/guest-invite/${tRace}/checkin`)));
  ok('concurrent single checkin', races.filter((r) => r.status === 201).length === 1, races.map((r) => r.status).join(','));
  // no check-in point: event with activity deleted
  const J3 = await mkEvent('JNY Event 3');
  const g3 = await mkGuest(J3.id, 'No Point Ned');
  await activate(J3);
  const t3 = (await mkInvites(J3.id, [g3.id])).invitations.find((i) => i.token).token;
  const act3 = (await req('GET', `/activities?event_id=${J3.id}`, { token: admin })).data[0].id;
  await req('DELETE', `/activities/${act3}`, { token: admin });
  ok('no checkin point 409', (await req('POST', `/guest-invite/${t3}/checkin`)).status === 409);

  // ---- Seating confirmation ----
  const ctx1 = (await req('GET', `/journey/${tok[gSeat.id]}`)).data;
  ok('state DIRECTED', ctx1.state === 'DIRECTED', ctx1.state);
  ok('wayfinding zones', Array.isArray(ctx1.venue_zones) && ctx1.venue_zones.some((z) => z.mine && z.zone_name === 'Table 7'), JSON.stringify(ctx1.venue_zones).slice(0, 160));
  const sc1 = await req('POST', `/journey/${tok[gSeat.id]}/seat-confirm`);
  ok('guest seat confirm', sc1.status === 200 && sc1.data.seat.seated_via === 'GUEST', JSON.stringify(sc1.data).slice(0, 120));
  ok('guest confirm idempotent', (await req('POST', `/journey/${tok[gSeat.id]}/seat-confirm`)).data.already === true);
  ok('state SEATED', (await req('GET', `/journey/${tok[gSeat.id]}`)).data.state === 'SEATED');
  // staff confirm for checked-in guest (Wendy has no seat → NO_SEAT; check in first)
  await req('POST', `/guest-invite/${tNoSeat}/checkin`);
  ok('confirm w/o seat 409', (await req('POST', `/journey/${tNoSeat}/seat-confirm`)).status === 409);
  // staff already has J1 access from setup above
  const gStaff = await mkGuest(J1.id, 'Staff Seater');
  const tStaff = (await mkInvites(J1.id, [gStaff.id])).invitations.find((i) => i.token).token;
  await req('POST', '/seating/assign', { token: admin, body: { event_id: J1.id, zone_id: zone.id, guest_id: gStaff.id } });
  await req('POST', `/guest-invite/${tStaff}/checkin`);
  const look = await req('POST', '/seat-lookup', { token: staffTok, body: { token: tStaff } });
  ok('staff seat lookup', look.status === 200 && look.data.seat?.zone_name === 'Table 7' && look.data.guest_name === 'Staff Seater', JSON.stringify(look.data).slice(0, 160));
  const lookDenied = await req('POST', '/seat-lookup', { token: staffTok, body: { token: tB } });
  ok('staff cross-event denied', lookDenied.status === 403, `got ${lookDenied.status}`);
  const scStaff = await req('POST', '/seat-confirm', { token: staffTok, body: { token: tStaff } });
  ok('staff seat confirm', scStaff.status === 200 && scStaff.data.seat.seated_via === 'STAFF', JSON.stringify(scStaff.data).slice(0, 120));
  ok('confirm w/o checkin 409', (await req('POST', `/journey/${tok[gPending.id]}/seat-confirm`)).status === 409);

  // ---- Guest services ----
  const menu = await req('GET', `/journey/${tok[gSeat.id]}/menu`);
  ok('menu available-only', menu.status === 200 && menu.data.length === 2 && !menu.data.some((m) => m.label === 'Secret'), JSON.stringify(menu.data));
  const ord = await req('POST', `/journey/${tok[gSeat.id]}/requests`, { body: { menu_item_id: drink.id } });
  ok('order drink', ord.status === 201 && ord.data.request.seat_label === 'Table 7' && ord.data.request.guest_id === gSeat.id, JSON.stringify(ord.data.request).slice(0, 160));
  const ordDup = await req('POST', `/journey/${tok[gSeat.id]}/requests`, { body: { menu_item_id: drink.id } });
  ok('order deduped', ordDup.data?.duplicate === true, JSON.stringify(ordDup.data).slice(0, 120));
  const badItem = await req('POST', `/service-menu`, { token: admin, body: { event_id: J2.id, label: 'J2 Wine', kind: 'DRINK' } });
  ok('foreign item rejected', (await req('POST', `/journey/${tok[gSeat.id]}/requests`, { body: { menu_item_id: badItem.data.id } })).status === 404);
  // tampered identifiers: body guest_id/event_id are ignored (no such fields honored)
  const tamp = await req('POST', `/journey/${tok[gSeat.id]}/requests`, { body: { menu_item_id: bite.id, guest_id: gNoSeat.id, event_id: J2.id } });
  ok('client ids ignored', tamp.status === 201 && tamp.data.request.guest_id === gSeat.id && tamp.data.request.event_id === J1.id, JSON.stringify(tamp.data.request).slice(0, 120));
  // unassigned guest assistance → staff ops
  const assist = await req('POST', `/journey/${tNoSeat}/requests`, { body: { category: 'SEATING_ASSISTANCE' } });
  ok('assistance request', assist.status === 201 && assist.data.request.location === 'Entrance', JSON.stringify(assist.data.request).slice(0, 140));
  const opsReqs = await req('GET', `/requests?event_id=${J1.id}`, { token: admin });
  ok('staff ops sees requests', opsReqs.data.some((r) => r.category === 'SEATING_ASSISTANCE' && r.guest_id === gNoSeat.id), `count=${opsReqs.data?.length}`);
  // staff fulfills → guest sees delivered
  const rid = ord.data.request.id;
  for (const s of ['ASSIGNED', 'IN_PROGRESS', 'FULFILLED']) await req('POST', `/requests/${rid}/status`, { token: admin, body: { to: s } });
  const mine = await req('GET', `/journey/${tok[gSeat.id]}/requests`);
  ok('guest sees delivered', mine.data.some((r) => r.id === rid && r.guest_status === 'delivered'), JSON.stringify(mine.data).slice(0, 160));
  // own-requests isolation
  const wendyReqs = await req('GET', `/journey/${tNoSeat}/requests`);
  ok('requests isolated', !wendyReqs.data.some((r) => r.guest_id === gSeat.id), `count=${wendyReqs.data?.length}`);

  // ---- Audit ----
  const audit = await req('GET', `/audit/event/${J1.id}?limit=400`, { token: admin });
  const actions = new Set((audit.data || []).map((r) => r.action));
  for (const need of ['seating.confirm', 'request.create', 'menu.create']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].join(','));
  }

  // ---- Cleanup ----
  for (const e of [J1, J2, J3]) await req('DELETE', `/events/${e.id}`, { token: admin });
  await req('DELETE', `/users/${staffU.data.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
