// Phase 3 multi-event rehearsal: A active (critical incident, overdue task,
// delayed vendor, service request, schedule deviation, attendance anomaly),
// B active (routine), C preparing (READY, silent majority). Verify surfacing,
// portfolio isolation for a B-only staffer, resolution updates, reconciliation.
// Run: BASE=... ADMIN_PIN=... node tests/rehearsal-p3.js (leaves A CLOSED).

const BASE = process.env.BASE || 'http://localhost:3124';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

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
  const log = (...a) => console.log('[rehearsal-p3]', ...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  const mk = async (name, tpl = 'wedding') =>
    (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-20', venue: 'Grounds', template_key: tpl } })).data;
  const A = await mk('P3 Wedding A');
  const B = await mk('P3 Conference B', 'conference');
  const C = await mk('P3 Wedding C (prep)');

  const rndPin = () => '63' + String(10 + Math.floor(Math.random() * 89));
  const mkUser = async (name, pin, role, ev) => {
    const p = pin || rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin: p } })).data;
    await req('POST', `/events/${ev}/roles`, { token: admin, body: { user_id: u.id, role_key: role } });
    return { ...(await req('POST', '/auth/login', { body: { pin: p } })).data, dbId: u.id };
  };
  const mgrA = await mkUser('P3 MgrA', undefined, 'event_manager', A.id);
  const staffB = await mkUser('P3 StaffB', undefined, 'usher', B.id);

  // C: 12 silent guests (RSVP silence signal while READY)
  const cGuests = [];
  for (let i = 1; i <= 12; i++) {
    cGuests.push((await req('POST', '/guests', { token: admin, body: { event_id: C.id, name: `C Guest ${i}` } })).data);
  }
  for (const s of ['CONFIGURING', 'READY']) {
    await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: s } });
    await req('POST', `/events/${B.id}/lifecycle`, { token: admin, body: { to: s } });
    await req('POST', `/events/${C.id}/lifecycle`, { token: admin, body: { to: s } });
  }
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'ACTIVE' } });
  await req('POST', `/events/${B.id}/lifecycle`, { token: admin, body: { to: 'ACTIVE' } });

  // A: trouble everywhere
  const gA = [];
  for (let i = 1; i <= 8; i++) gA.push((await req('POST', '/guests', { token: admin, body: { event_id: A.id, name: `A Guest ${i}` } })).data);
  const inc = (await req('POST', '/incidents', { token: mgrA.token, body: { event_id: A.id, title: 'Stage power out', severity: 'CRITICAL' } })).data;
  await req('POST', '/tasks', { token: mgrA.token, body: { event_id: A.id, title: 'Fix cable ramp', due_at: '2020-01-01 06:00' } });
  const ven = (await req('POST', '/vendors', { token: mgrA.token, body: { event_id: A.id, name: 'Lights Co', arrival_time: '2020-01-01 06:00' } })).data;
  await req('POST', '/requests', { token: mgrA.token, body: { event_id: A.id, description: 'Wheelchair access to stage side', priority: 'HIGH' } });
  const sch = (await req('POST', '/schedule', { token: mgrA.token, body: { event_id: A.id, title: 'First dance', planned_start: '2020-01-01 20:00', planned_end: '2020-01-01 20:10' } })).data;
  // B: routine single task, no trouble
  await req('POST', '/tasks', { token: admin, body: { event_id: B.id, title: 'Print badges', due_at: '2026-12-21 09:00' } });

  const glob1 = await req('GET', '/command', { token: admin });
  const cardA = glob1.data.events.find((e) => e.id === A.id);
  log('global: A health', cardA.health, '| reasons:', cardA.reasons.length, '| first card is A:', glob1.data.events[0].id === A.id);
  log('A attention:', (await req('GET', `/command/${A.id}`, { token: admin })).data.attention.map((a) => `${a.severity}/${a.source}`).join(', '));
  const cmdC = await req('GET', `/command/${C.id}`, { token: admin });
  log('C (preparing) surfaces RSVP silence:', cmdC.data.attention.some((a) => a.source === 'rsvp'));

  // B-only staffer: portfolio isolation
  const gb = await req('GET', '/command', { token: staffB.token });
  const leakA = await req('GET', `/command/${A.id}`, { token: staffB.token });
  log('staffer sees only B:', gb.data.events.every((e) => e.id === B.id), '| A denied:', leakA.status === 403);

  // Resolve everything in A, verify command clears
  await req('POST', `/incidents/${inc.id}/status`, { token: mgrA.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/incidents/${inc.id}/status`, { token: mgrA.token, body: { to: 'RESOLVED', resolution: 'Generator on' } });
  await req('POST', `/vendors/${ven.id}/status`, { token: mgrA.token, body: { to: 'ARRIVED' } });
  const tasksA = (await req('GET', `/tasks?event_id=${A.id}`, { token: admin })).data;
  for (const t of tasksA) {
    if (t.status === 'OPEN') await req('POST', `/tasks/${t.id}/status`, { token: admin, body: { to: 'IN_PROGRESS' } });
    await req('POST', `/tasks/${t.id}/complete`, { token: admin });
  }
  await req('POST', `/schedule/${sch.id}/status`, { token: mgrA.token, body: { to: 'READY' } });
  await req('POST', `/schedule/${sch.id}/status`, { token: mgrA.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/schedule/${sch.id}/status`, { token: mgrA.token, body: { to: 'COMPLETED' } });
  const reqsA = (await req('GET', `/requests?event_id=${A.id}`, { token: admin })).data;
  for (const r of reqsA) {
    await req('PUT', `/requests/${r.id}`, { token: admin, body: { assignee_user_id: mgrA.dbId } });
    await req('POST', `/requests/${r.id}/status`, { token: admin, body: { to: 'IN_PROGRESS' } });
    await req('POST', `/requests/${r.id}/status`, { token: admin, body: { to: 'FULFILLED' } });
  }
  const cmdA2 = await req('GET', `/command/${A.id}`, { token: admin });
  log('after resolution: A health', cmdA2.data.health.status, '| attention left:', cmdA2.data.attention.length);
  const glob2 = await req('GET', '/command', { token: admin });
  log('global needs_attention now:', JSON.stringify(glob2.data.needs_attention));

  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const tl = await req('GET', `/command/${A.id}/timeline`, { token: admin });
  log('timeline entries:', tl.data.length, '| has resolution:', tl.data.some((t) => /RESOLVED|FULFILLED|Completed/i.test(t.text)));
  const pass = cardA.health === 'CRITICAL' && glob1.data.events[0].id === A.id && cmdA2.data.health.status === 'OK' && leakA.status === 403;
  log(pass ? 'REHEARSAL PASS' : 'REHEARSAL MISMATCH', '| A left CLOSED:', A.id);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
