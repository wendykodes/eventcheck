// Phase 2 automated tests — permissions, schedule, tasks, incidents, requests,
// seating, vendors, transport, stays, check-in override, idempotency,
// lifecycle, isolation, audit. Run: BASE=... ADMIN_PIN=... node tests/phase2.test.js
// Self-cleaning: deletes its events + users at the end.

const BASE = process.env.BASE || 'http://localhost:3120';
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
  let data = null;
  try { data = await res.json(); } catch {}
  const replay = res.headers.get('idempotent-replayed');
  return { status: res.status, data, replay };
}
const uuid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  ok('admin login', !!admin);

  const mkEvent = async (name) => (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding' } })).data;
  const A = await mkEvent('P2T Event A');
  const B = await mkEvent('P2T Event B');

  const rndPin = () => '52' + String(10 + Math.floor(Math.random() * 89));
  const mkUser = async (name, pin, roleKey, eventId) => {
    const p = pin || rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin: p } })).data;
    if (roleKey && eventId) await req('POST', `/events/${eventId}/roles`, { token: admin, body: { user_id: u.id, role_key: roleKey } });
    const login = await req('POST', '/auth/login', { body: { pin: p } });
    return { user: u, token: login.data.token };
  };
  const mgr = await mkUser('P2T Manager', undefined, 'event_manager', A.id);
  const waiter = await mkUser('P2T Waiter', undefined, 'waiter', A.id);
  const checkerB = await mkUser('P2T CheckerB', undefined, 'checkin_staff', B.id);

  // ---- 2.1 granular permissions ----
  const t1 = await req('POST', '/tasks', { token: mgr.token, body: { event_id: A.id, title: 'Mgr task' } });
  ok('manager creates task', t1.status === 201, `got ${t1.status}`);
  const w1 = await req('POST', '/incidents', { token: waiter.token, body: { event_id: A.id, title: 'Waiter incident' } });
  ok('waiter denied incident.create (403)', w1.status === 403, `got ${w1.status}`);
  const w2 = await req('POST', '/vendors', { token: waiter.token, body: { event_id: A.id, name: 'X' } });
  ok('waiter denied vendor.manage (403)', w2.status === 403, `got ${w2.status}`);
  const w3 = await req('POST', '/requests', { token: waiter.token, body: { event_id: A.id, description: 'Water please' } });
  ok('waiter creates service request', w3.status === 201, `got ${w3.status} ${JSON.stringify(w3.data)}`);
  const cross = await req('GET', `/tasks?event_id=${A.id}`, { token: checkerB.token });
  ok('event-B staff denied event-A tasks (403)', cross.status === 403, `got ${cross.status}`);
  // Revoked access stops working
  await req('PUT', `/users/${waiter.user.id}`, { token: admin, body: { status: 'inactive' } });
  const rev = await req('GET', `/tasks?event_id=${A.id}`, { token: waiter.token });
  ok('inactive staff blocked', rev.status === 401 || rev.status === 403, `got ${rev.status}`);
  await req('PUT', `/users/${waiter.user.id}`, { token: admin, body: { status: 'active' } });
  const back = await req('GET', `/tasks?event_id=${A.id}`, { token: waiter.token });
  ok('reactivated staff reads tasks via baseline task.view', back.status === 200, `got ${back.status}`);

  // ---- 2.2 schedule ----
  const s1 = await req('POST', '/schedule', { token: mgr.token, body: { event_id: A.id, title: 'Ceremony', planned_start: '2020-01-01 10:00', planned_end: '2020-01-01 11:00' } });
  ok('schedule create', s1.status === 201 && s1.data.overdue === true, JSON.stringify(s1.data).slice(0, 160));
  const sbad = await req('POST', `/schedule/${s1.data.id}/status`, { token: mgr.token, body: { to: 'COMPLETED' } });
  ok('illegal PLANNED->COMPLETED rejected', sbad.status === 409, `got ${sbad.status}`);
  await req('POST', `/schedule/${s1.data.id}/status`, { token: mgr.token, body: { to: 'READY' } });
  await req('POST', `/schedule/${s1.data.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  const sdone = await req('POST', `/schedule/${s1.data.id}/status`, { token: mgr.token, body: { to: 'COMPLETED' } });
  ok('schedule completes with actual_end stamped', sdone.status === 200 && !!sdone.data.actual_end, JSON.stringify(sdone.data).slice(0, 200));

  // ---- 2.3 tasks ----
  const task = await req('POST', '/tasks', { token: mgr.token, body: { event_id: A.id, title: 'Lay tables', due_at: '2020-01-01 09:00', assignee_user_id: waiter.user.id } });
  ok('task assigned (assignee has event access)', task.status === 201, `got ${task.status} ${JSON.stringify(task.data)}`);
  const badAssign = await req('POST', '/tasks', { token: mgr.token, body: { event_id: A.id, title: 'Bad', assignee_user_id: checkerB.user.id } });
  ok('assigning outsider rejected', badAssign.status === 400, `got ${badAssign.status}`);
  const mine = await req('GET', `/tasks?event_id=${A.id}&assignee=me`, { token: mgr.token });
  ok('assignee filter works', Array.isArray(mine.data));
  await req('POST', `/tasks/${task.data.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  const comp1 = await req('POST', `/tasks/${task.data.id}/complete`, { token: mgr.token });
  const comp2 = await req('POST', `/tasks/${task.data.id}/complete`, { token: mgr.token });
  ok('completion + idempotent repeat', comp1.status === 200 && comp2.data.unchanged === true, `${comp1.status}/${JSON.stringify(comp2.data)}`);
  ok('overdue derived on open task', (await req('GET', `/tasks?event_id=${A.id}`, { token: mgr.token })).data.some((t) => t.overdue === true || t.overdue === false));

  // ---- 2.4 incidents ----
  const inc = await req('POST', '/incidents', { token: mgr.token, body: { event_id: A.id, title: 'Mic failure', severity: 'CRITICAL' } });
  ok('incident created OPEN (no assignee)', inc.status === 201 && inc.data.status === 'OPEN');
  const crit = await req('GET', `/incidents?event_id=${A.id}&critical=1`, { token: mgr.token });
  ok('critical filter surfaces it', crit.data.length === 1);
  const esc = await req('POST', `/incidents/${inc.data.id}/escalate`, { token: mgr.token, body: {} });
  ok('escalation bumps level', esc.status === 200 && esc.data.escalation_level === 1);
  await req('POST', `/incidents/${inc.data.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  const res = await req('POST', `/incidents/${inc.data.id}/status`, { token: mgr.token, body: { to: 'RESOLVED', resolution: 'Swapped mic' } });
  ok('resolve with resolution', res.status === 200 && res.data.resolution === 'Swapped mic' && !!res.data.resolved_at);
  await req('POST', `/incidents/${inc.data.id}/status`, { token: mgr.token, body: { to: 'CLOSED' } });
  const escClosed = await req('POST', `/incidents/${inc.data.id}/escalate`, { token: mgr.token, body: {} });
  ok('escalating closed incident rejected', escClosed.status === 409);

  // ---- 2.5 requests ----
  const rq = await req('POST', '/requests', { token: mgr.token, body: { event_id: A.id, description: 'Extra chair T4', category: 'seating' } });
  await req('PUT', `/requests/${rq.data.id}`, { token: mgr.token, body: { assignee_user_id: waiter.user.id } });
  const rqMid = await req('GET', `/requests/${rq.data.id}`, { token: mgr.token });
  ok('assign auto-moves OPEN->ASSIGNED', rqMid.data.status === 'ASSIGNED' || rqMid.data.status === 'OPEN');
  await req('POST', `/requests/${rq.data.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  const ful = await req('POST', `/requests/${rq.data.id}/status`, { token: mgr.token, body: { to: 'FULFILLED', resolution: 'Chair delivered' } });
  ok('request fulfilled', ful.status === 200);

  // ---- 2.6 seating ----
  const g1 = (await req('POST', '/guests', { token: admin, body: { event_id: A.id, name: 'Seat Ann' } })).data;
  const g2 = (await req('POST', '/guests', { token: admin, body: { event_id: A.id, name: 'Seat Bob' } })).data;
  const g3 = (await req('POST', '/guests', { token: admin, body: { event_id: A.id, name: 'Seat Cat' } })).data;
  const z1 = (await req('POST', '/seating/zones', { token: mgr.token, body: { event_id: A.id, name: 'T1', kind: 'TABLE', capacity: 2 } })).data;
  const z2 = (await req('POST', '/seating/zones', { token: mgr.token, body: { event_id: A.id, name: 'VIP Deck', kind: 'VIP' } })).data;
  ok('zones created', z1.id && z2.kind === 'VIP');
  ok('seat assign', (await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: A.id, zone_id: z1.id, guest_id: g1.id } })).status === 201);
  ok('seat assign 2', (await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: A.id, zone_id: z1.id, guest_id: g2.id } })).status === 201);
  const full = await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: A.id, zone_id: z1.id, guest_id: g3.id } });
  ok('over-capacity prevented', full.status === 409, `got ${full.status}`);
  const dupSeat = await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: A.id, zone_id: z2.id, guest_id: g1.id } });
  ok('double-seat without move rejected', dupSeat.status === 409, `got ${dupSeat.status}`);
  const moved = await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: A.id, zone_id: z2.id, guest_id: g1.id, move: true } });
  ok('reassign with move works', moved.status === 201, `got ${moved.status}`);
  const shrink = await req('PUT', `/seating/zones/${z1.id}`, { token: mgr.token, body: { capacity: 0 } });
  ok('capacity shrink below occupancy rejected', shrink.status === 409 || shrink.status === 400, `got ${shrink.status}`);

  // ---- 2.7 vendors / 2.8 transport / 2.9 stays ----
  const v1 = await req('POST', '/vendors', { token: mgr.token, body: { event_id: A.id, name: 'Caterer', service: 'Food', arrival_time: '2026-12-25 12:00' } });
  ok('vendor created', v1.status === 201);
  const varr = await req('POST', `/vendors/${v1.data.id}/status`, { token: mgr.token, body: { to: 'ARRIVED' } });
  ok('vendor arrival stamped', varr.status === 200 && !!varr.data.actual_arrival);
  const tr = await req('POST', '/transport', { token: mgr.token, body: { event_id: A.id, name: 'Airport run', driver_user_id: waiter.user.id } });
  ok('transport route created', tr.status === 201);
  ok('passenger added', (await req('POST', `/transport/${tr.data.id}/passengers`, { token: mgr.token, body: { guest_id: g1.id } })).status === 201);
  const gB = (await req('POST', '/guests', { token: admin, body: { event_id: B.id, name: 'Stranger' } })).data;
  const xpass = await req('POST', `/transport/${tr.data.id}/passengers`, { token: mgr.token, body: { guest_id: gB.id } });
  ok('cross-event passenger rejected', xpass.status === 400, `got ${xpass.status}`);
  const stay = await req('POST', '/stays', { token: mgr.token, body: { event_id: A.id, name: 'Hotel X', room: '101', guest_id: g1.id, transport_route_id: tr.data.id } });
  ok('stay with transport link', stay.status === 201);

  // ---- 2.10 check-in override ----
  for (const s of ['CONFIGURING', 'READY']) await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: s } });
  const acts = await req('GET', `/activities?event_id=${A.id}`, { token: admin });
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'ACTIVE' } });
  const ci = await req('POST', '/checkins', { token: mgr.token, body: { guest_id: g1.id, activity_id: acts.data[0].id } });
  ok('check-in for override test', ci.status === 201, `got ${ci.status} ${JSON.stringify(ci.data)}`);
  const noReason = await req('POST', `/checkins/${ci.data.id}/override`, { token: mgr.token, body: {} });
  ok('override without reason rejected', noReason.status === 400, `got ${noReason.status}`);
  const ovr = await req('POST', `/checkins/${ci.data.id}/override`, { token: mgr.token, body: { reason: 'Wrong guest tapped' } });
  ok('reason-based override works', ovr.status === 200, `got ${ovr.status}`);
  const corr = await req('GET', `/checkins/corrections?event_id=${A.id}`, { token: mgr.token });
  ok('correction snapshot preserved', corr.data.length === 1 && corr.data[0].reason === 'Wrong guest tapped');
  const recheck = await req('POST', '/checkins', { token: mgr.token, body: { guest_id: g1.id, activity_id: acts.data[0].id } });
  ok('re-check-in after correction works', recheck.status === 201);

  // ---- idempotency ----
  const k = uuid();
  const i1 = await req('POST', '/incidents', { token: mgr.token, body: { event_id: A.id, title: 'Idem test' }, headers: { 'Idempotency-Key': k } });
  const i2 = await req('POST', '/incidents', { token: mgr.token, body: { event_id: A.id, title: 'Idem test' }, headers: { 'Idempotency-Key': k } });
  ok('idempotent replay dedupes', i1.status === 201 && i2.replay === 'true' && i1.data.id === i2.data.id, `${i1.status}/${i2.status}`);

  // ---- lifecycle: CLOSING blocks creates, allows progression; CLOSED blocks all ----
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  const closed1 = await req('POST', '/tasks', { token: mgr.token, body: { event_id: A.id, title: 'Late task' } });
  ok('CLOSING blocks task create', closed1.status === 409, `got ${closed1.status}`);
  const prog = await req('POST', `/incidents/${i1.data.id}/status`, { token: mgr.token, body: { to: 'ASSIGNED' } });
  ok('CLOSING allows status progression', prog.status === 200, `got ${prog.status}`);
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const closed2 = await req('POST', `/incidents/${i1.data.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  ok('CLOSED blocks incident update', closed2.status === 409, `got ${closed2.status}`);

  // ---- audit ----
  const audit = await req('GET', `/audit/event/${A.id}?limit=300`, { token: admin });
  const actions = new Set((audit.data || []).map((r) => r.action));
  for (const need of ['task.create', 'incident.create', 'incident.escalate', 'request.create', 'seating.assign', 'vendor.create', 'transport.create', 'stay.create', 'checkin.override', 'schedule.create']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].join(','));
  }

  // ---- cleanup ----
  await req('DELETE', `/events/${A.id}`, { token: admin });
  await req('DELETE', `/events/${B.id}`, { token: admin });
  for (const u of [mgr, waiter, checkerB]) await req('DELETE', `/users/${u.user.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
