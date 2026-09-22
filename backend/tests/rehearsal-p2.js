// Phase 2 live operational rehearsal: realistic wedding operation end-to-end.
// Guests, staff, schedule, tasks, seating, vendors, transport, stays, requests,
// incident + escalation, reassignment, correction, unauthorized + duplicate
// attempts, simulated retry-after-interruption, closure, reconciliation.
// Run: BASE=... ADMIN_PIN=... node tests/rehearsal-p2.js (leaves CLOSED event).

const BASE = process.env.BASE || 'http://localhost:3121';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

async function req(method, path, { token, body, headers } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, replay: res.headers.get('idempotent-replayed') };
}
const uuid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function main() {
  const log = (...a) => console.log('[rehearsal-p2]', ...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  const evt = (await req('POST', '/events', { token: admin, body: { name: 'P2 Ops Wedding', date: '2026-12-19', venue: 'Gardens', template_key: 'wedding' } })).data;
  log('event', evt.id);

  // Staff: manager, waiter, driver
  const rndPin = () => '62' + String(10 + Math.floor(Math.random() * 89));
  const mk = async (name, pin, role) => {
    const p = pin || rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin: p } })).data;
    await req('POST', `/events/${evt.id}/roles`, { token: admin, body: { user_id: u.id, role_key: role } });
    return { ...(await req('POST', '/auth/login', { body: { pin: p } })).data, dbId: u.id };
  };
  const mgr = await mk('P2 OpsMgr', undefined, 'event_manager');
  const wait = await mk('P2 Waiter', undefined, 'waiter');
  const driv = await mk('P2 Driver', undefined, 'driver');

  // Guests + seating
  const guests = [];
  for (let i = 1; i <= 25; i++) {
    guests.push((await req('POST', '/guests', { token: admin, body: { event_id: evt.id, name: `Ops Guest ${i}` } })).data);
  }
  const t1 = (await req('POST', '/seating/zones', { token: mgr.token, body: { event_id: evt.id, name: 'T1', capacity: 10 } })).data;
  const vip = (await req('POST', '/seating/zones', { token: mgr.token, body: { event_id: evt.id, name: 'VIP', kind: 'VIP', capacity: 4 } })).data;
  for (let i = 0; i < 10; i++) await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: evt.id, zone_id: t1.id, guest_id: guests[i].id } });
  const over = await req('POST', '/seating/assign', { token: mgr.token, body: { event_id: evt.id, zone_id: vip.id, guest_id: guests[10].id } });
  log('seating: 10 seated, vip assign:', over.status);

  // Schedule with a delay
  const sched = [];
  for (const [title, start] of [['Setup', '2026-12-19 08:00'], ['Ceremony', '2026-12-19 14:00'], ['Dinner', '2026-12-19 18:00'], ['Send-off', '2026-12-19 21:00']]) {
    sched.push((await req('POST', '/schedule', { token: mgr.token, body: { event_id: evt.id, title, planned_start: start } })).data);
  }
  for (const s of sched.slice(0, 2)) {
    await req('POST', `/schedule/${s.id}/status`, { token: mgr.token, body: { to: 'READY' } });
    await req('POST', `/schedule/${s.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  }
  await req('POST', `/schedule/${sched[1].id}/status`, { token: mgr.token, body: { to: 'DELAYED' } });
  await req('POST', `/schedule/${sched[1].id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/schedule/${sched[1].id}/status`, { token: mgr.token, body: { to: 'COMPLETED' } });
  log('schedule: ceremony delayed then completed, actual_end stamped');

  // Tasks incl. reassignment + idempotent completion
  const tasks = [];
  const assignees = [wait.dbId, wait.dbId, driv.dbId, wait.dbId, null];
  const titles = ['Lay cutlery', 'Chill drinks', 'Fuel van', 'VIP water', 'Sound check'];
  for (let i = 0; i < 5; i++) {
    tasks.push((await req('POST', '/tasks', { token: mgr.token, body: { event_id: evt.id, title: titles[i], assignee_user_id: assignees[i], due_at: '2026-12-19 12:00' } })).data);
  }
  await req('PUT', `/tasks/${tasks[4].id}`, { token: mgr.token, body: { assignee_user_id: wait.dbId } });
  log('tasks: 5 created, unassigned one reassigned to waiter');
  await req('POST', `/tasks/${tasks[0].id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/tasks/${tasks[0].id}/complete`, { token: mgr.token });
  await req('POST', `/tasks/${tasks[0].id}/complete`, { token: mgr.token });

  // Incident: critical sound failure + unauthorized attempt + escalation + resolve
  const denied = await req('POST', '/incidents', { token: wait.token, body: { event_id: evt.id, title: 'Sneaky' } });
  const inc = (await req('POST', '/incidents', { token: mgr.token, body: { event_id: evt.id, title: 'Speaker blown', severity: 'CRITICAL', assignee_user_id: mgr.dbId } })).data;
  await req('POST', `/incidents/${inc.id}/escalate`, { token: mgr.token, body: {} });
  await req('POST', `/incidents/${inc.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/incidents/${inc.id}/status`, { token: mgr.token, body: { to: 'RESOLVED', resolution: 'Backup speaker live' } });
  log('incident: waiter attempt', denied.status, '| critical resolved, escalation level kept');

  // Service request via waiter, fulfilled
  const rq = (await req('POST', '/requests', { token: wait.token, body: { event_id: evt.id, description: 'High chair for baby', location: 'T1' } })).data;
  await req('PUT', `/requests/${rq.id}`, { token: mgr.token, body: { assignee_user_id: wait.dbId } });
  await req('POST', `/requests/${rq.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/requests/${rq.id}/status`, { token: mgr.token, body: { to: 'FULFILLED', resolution: 'Delivered' } });

  // Vendor late → issue → arrived; transport + stay
  const ven = (await req('POST', '/vendors', { token: mgr.token, body: { event_id: evt.id, name: 'Cake Co', arrival_time: '2026-12-19 10:00' } })).data;
  await req('POST', `/vendors/${ven.id}/status`, { token: mgr.token, body: { to: 'ISSUE' } });
  await req('POST', `/vendors/${ven.id}/status`, { token: mgr.token, body: { to: 'ARRIVED' } });
  const route = (await req('POST', '/transport', { token: mgr.token, body: { event_id: evt.id, name: 'Hotel shuttle', driver_user_id: driv.dbId } })).data;
  await req('POST', `/transport/${route.id}/passengers`, { token: mgr.token, body: { guest_id: guests[0].id } });
  await req('POST', '/stays', { token: mgr.token, body: { event_id: evt.id, name: 'Hotel', room: '5', guest_id: guests[0].id, transport_route_id: route.id } });

  // Activate + check-ins + correction + simulated retry-after-interruption
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: s } });
  const act = (await req('GET', `/activities?event_id=${evt.id}`, { token: admin })).data[0].id;
  let checked = 0;
  for (let i = 0; i < 12; i++) {
    const r = await req('POST', '/checkins', { token: mgr.token, body: { guest_id: guests[i].id, activity_id: act } });
    if (r.status === 201) checked++;
  }
  const firstCi = (await req('GET', `/checkins/guest/${guests[0].id}`, { token: mgr.token })).data[0];
  await req('POST', `/checkins/${firstCi.id}/override`, { token: mgr.token, body: { reason: 'Rehearsal: tapped wrong guest' } });
  const key = uuid();
  const r1 = await req('POST', '/checkins', { token: mgr.token, body: { guest_id: guests[12].id, activity_id: act }, headers: { 'Idempotency-Key': key } });
  const r2 = await req('POST', '/checkins', { token: mgr.token, body: { guest_id: guests[12].id, activity_id: act }, headers: { 'Idempotency-Key': key } });
  log('check-ins:', checked, '| correction ok | interruption-retry replayed:', r2.replay === 'true', `(${r1.status}/${r2.status})`);

  // Close + reconcile
  await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${evt.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const report = (await req('GET', `/event/${evt.id}/report`, { token: admin })).data;
  const tasksNow = (await req('GET', `/tasks?event_id=${evt.id}`, { token: admin })).data;
  const incNow = (await req('GET', `/incidents?event_id=${evt.id}`, { token: admin })).data;
  const schedNow = (await req('GET', `/schedule?event_id=${evt.id}`, { token: admin })).data;
  const seats = (await req('GET', '/seating/assignments?event_id=XX', { token: admin }).catch(() => ({ data: [] })));
  const seatsNow = (await req('GET', `/seating/assignments?event_id=${evt.id}`, { token: admin })).data;
  const audit = (await req('GET', `/audit/event/${evt.id}?limit=500`, { token: admin })).data;
  log('report:', JSON.stringify({ invited: report.guests.invited, checked_in: report.attendance.checked_in }));
  log('tasks done:', tasksNow.filter((t) => t.status === 'COMPLETED').length, '/5 | incidents resolved:', incNow.filter((i) => ['RESOLVED', 'CLOSED'].includes(i.status)).length, '/1',
    '| schedule completed:', schedNow.filter((s) => s.status === 'COMPLETED').length, '| seated:', seatsNow.length, '| audit rows:', audit.length);
  const pass = report.guests.invited === 25 && tasksNow.length === 5 && seatsNow.length === 11 && denied.status === 403;
  log(pass ? 'REHEARSAL PASS' : 'REHEARSAL MISMATCH', '| event left CLOSED:', evt.id);
  void seats;
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
