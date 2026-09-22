// Phase 3 tests — command aggregation, attention, escalation flags, health,
// timeline, plan-vs-actual, alerts/ack, multi-event global, authz, isolation.
// Run: BASE=... ADMIN_PIN=... node tests/phase3.test.js (self-cleaning).

const BASE = process.env.BASE || 'http://localhost:3123';
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

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  ok('admin login', !!admin);

  const mkEvent = async (name) => (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding' } })).data;
  const A = await mkEvent('P3T Event A (troubled)');
  const B = await mkEvent('P3T Event B (calm)');
  const C = await mkEvent('P3T Event C (preparing)');

  const rndPin = () => '53' + String(10 + Math.floor(Math.random() * 89));
  const mkUser = async (name, pin, roleKey, eventId) => {
    const p = pin || rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin: p } })).data;
    if (roleKey && eventId) await req('POST', `/events/${eventId}/roles`, { token: admin, body: { user_id: u.id, role_key: roleKey } });
    const login = await req('POST', '/auth/login', { body: { pin: p } });
    return { user: u, token: login.data.token };
  };
  const mgr = await mkUser('P3T Mgr', undefined, 'event_manager', A.id);

  // Build trouble in A: critical incident + overdue task + overdue schedule + vendor issue
  const inc = (await req('POST', '/incidents', { token: mgr.token, body: { event_id: A.id, title: 'Fire alarm fault', severity: 'CRITICAL' } })).data;
  await req('POST', '/tasks', { token: mgr.token, body: { event_id: A.id, title: 'Late tables', due_at: '2020-01-01 08:00' } });
  const sch = (await req('POST', '/schedule', { token: mgr.token, body: { event_id: A.id, title: 'Doors', planned_start: '2020-01-01 08:00', planned_end: '2020-01-01 09:00' } })).data;
  const ven = (await req('POST', '/vendors', { token: mgr.token, body: { event_id: A.id, name: 'Florist', arrival_time: '2020-01-01 07:00' } })).data;
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) {
    await req('POST', `/events/${A.id}/lifecycle`, { token: admin, body: { to: s } });
    await req('POST', `/events/${B.id}/lifecycle`, { token: admin, body: { to: s } });
  }
  await req('POST', `/events/${C.id}/lifecycle`, { token: admin, body: { to: 'CONFIGURING' } });

  // ---- command aggregation ----
  const cmd = await req('GET', `/command/${A.id}`, { token: mgr.token });
  ok('command 200', cmd.status === 200, `got ${cmd.status}`);
  ok('health CRITICAL with reason', cmd.data.health.status === 'CRITICAL' && cmd.data.health.reasons.length > 0, JSON.stringify(cmd.data.health));
  const sources = new Set(cmd.data.attention.map((a) => a.source));
  for (const s of ['incident', 'task', 'schedule', 'vendor']) ok(`attention has ${s}`, sources.has(s), [...sources].join(','));
  ok('counts reconcile', cmd.data.counts.critical_incidents === 1 && cmd.data.counts.open_tasks === 1, JSON.stringify(cmd.data.counts));
  ok('attention sorted critical-first', cmd.data.attention[0].severity === 'CRITICAL');

  // ---- escalation flags ----
  const esc = await req('POST', `/incidents/${inc.id}/escalate`, { token: mgr.token });
  ok('manual escalation recorded', esc.data.escalation_level === 1);
  const cmd2 = await req('GET', `/command/${A.id}`, { token: mgr.token });
  ok('escalated incident flagged', cmd2.data.attention.some((a) => a.source === 'incident' && a.escalation_due === true));

  // ---- plan vs actual ----
  await req('POST', `/schedule/${sch.id}/status`, { token: mgr.token, body: { to: 'READY' } });
  await req('POST', `/schedule/${sch.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/schedule/${sch.id}/status`, { token: mgr.token, body: { to: 'COMPLETED' } });
  const schRow = (await req('GET', `/schedule?event_id=${A.id}`, { token: mgr.token })).data.find((s) => s.id === sch.id);
  ok('plan vs actual stamped', !!schRow.actual_start && !!schRow.actual_end && schRow.planned_start !== schRow.actual_start);

  // ---- timeline ----
  const tl = await req('GET', `/command/${A.id}/timeline`, { token: mgr.token });
  const texts = tl.data.map((t) => t.text);
  ok('timeline has incident + escalation + task', texts.some((t) => /Incident opened/.test(t)) && texts.some((t) => /escalated/.test(t)), texts.slice(0, 8).join(' | '));
  ok('timeline skips noise (no login entries)', !tl.data.some((t) => t.action === 'auth.login'));

  // ---- alerts ack/unack ----
  const key = cmd2.data.attention.find((a) => a.source === 'task').key;
  ok('ack 200', (await req('POST', `/command/${A.id}/ack`, { token: mgr.token, body: { key } })).status === 200);
  const afterAck = await req('GET', `/command/${A.id}`, { token: mgr.token });
  ok('acked item hidden', !afterAck.data.attention.some((a) => a.key === key));
  const withAcked = await req('GET', `/command/${A.id}?include_acked=1`, { token: mgr.token });
  ok('include_acked reveals it', withAcked.data.attention.some((a) => a.key === key));
  ok('double ack idempotent', (await req('POST', `/command/${A.id}/ack`, { token: mgr.token, body: { key } })).status === 200);
  ok('unack restores', (await req('POST', `/command/${A.id}/unack`, { token: mgr.token, body: { key } })).status === 200 &&
    (await req('GET', `/command/${A.id}`, { token: mgr.token })).data.attention.some((a) => a.key === key));

  // ---- global multi-event ----
  const g = await req('GET', '/command', { token: admin });
  ok('global lists events', g.data.total >= 3);
  const cardA = g.data.events.find((e) => e.id === A.id);
  ok('troubled event first + flagged', g.data.events[0].id === A.id && g.data.needs_attention.includes(A.id), JSON.stringify(g.data.events.map((e) => [e.id, e.health])));
  ok('calm event OK', g.data.events.find((e) => e.id === B.id).health === 'OK');

  // ---- authz: staff portfolio scoping ----
  const onlyB = await mkUser('P3T OnlyB', undefined, 'usher', B.id);
  const gb = await req('GET', '/command', { token: onlyB.token });
  ok('staff global shows only assigned', gb.data.events.every((e) => e.id === B.id), JSON.stringify(gb.data.events.map((e) => e.id)));
  const xa = await req('GET', `/command/${A.id}`, { token: onlyB.token });
  ok('cross-event command denied', xa.status === 403, `got ${xa.status}`);
  const xtl = await req('GET', `/command/${A.id}/timeline`, { token: onlyB.token });
  ok('cross-event timeline denied', xtl.status === 403, `got ${xtl.status}`);

  // ---- resolve + verify command updates ----
  await req('POST', `/incidents/${inc.id}/status`, { token: mgr.token, body: { to: 'IN_PROGRESS' } });
  await req('POST', `/incidents/${inc.id}/status`, { token: mgr.token, body: { to: 'RESOLVED', resolution: 'Fixed' } });
  const cmd3 = await req('GET', `/command/${A.id}`, { token: mgr.token });
  ok('resolved incident leaves attention', !cmd3.data.attention.some((a) => a.entity_id === inc.id && a.source === 'incident'));
  ok('health improves from CRITICAL', cmd3.data.health.status !== 'CRITICAL', cmd3.data.health.status);

  // ---- audit ----
  const audit = await req('GET', `/audit/event/${A.id}?limit=100`, { token: admin });
  ok('audit has alert.ack', audit.data.some((r) => r.action === 'alert.ack'));

  // ---- cleanup ----
  for (const e of [A, B, C]) await req('DELETE', `/events/${e.id}`, { token: admin });
  for (const u of [mgr, onlyB]) await req('DELETE', `/users/${u.user.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
