// Phase 4 tests — intakes, runbooks, devices, comms, decisions, notes,
// break-glass, exports, results, readiness-full, customer summary, workspace,
// workload/quality, lifecycle gates, isolation, audit. Self-cleaning.
// Run: BASE=... ADMIN_PIN=... node tests/phase4.test.js

const BASE = process.env.BASE || 'http://localhost:3128';
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
  const ct = res.headers.get('content-type') || '';
  let data = null;
  try { data = ct.includes('json') ? await res.json() : await res.text(); } catch {}
  return { status: res.status, data };
}

async function main() {
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  ok('admin login', !!admin);

  const rndPin = () => '54' + String(10 + Math.floor(Math.random() * 89));
  const mkUser = async (name, pin, roleKey, eventId) => {
    const p = pin || rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin: p } })).data;
    if (roleKey && eventId) await req('POST', `/events/${eventId}/roles`, { token: admin, body: { user_id: u.id, role_key: roleKey } });
    const login = await req('POST', '/auth/login', { body: { pin: p } });
    return { user: u, token: login.data.token };
  };

  // ---- 4.1 intakes ----
  const badIntake = await req('POST', '/intakes', { token: admin, body: {} });
  ok('intake requires customer', badIntake.status === 400);
  const intake = (await req('POST', '/intakes', { token: admin, body: { customer_name: 'P4 Family', event_type: 'Wedding', event_date: '2026-12-24', venue: 'Hall' } })).data;
  ok('intake created NEW', intake.status === 'NEW');
  const conv = await req('POST', `/intakes/${intake.id}/convert`, { token: admin, body: { template_key: 'wedding' } });
  ok('intake converts to DRAFT event', conv.status === 201 && conv.data.event_id);
  const E = conv.data.event_id;
  const evRow = await req('GET', `/events/${E}`, { token: admin });
  ok('converted event is DRAFT wedding', evRow.data.lifecycle_state === 'DRAFT' && evRow.data.template_key === 'wedding');
  const conv2 = await req('POST', `/intakes/${intake.id}/convert`, { token: admin, body: {} });
  ok('re-convert reuses event', conv2.data.reused === true && conv2.data.event_id === E);

  const op = await mkUser('P4 Operator', undefined, 'raas_operator', E);

  // ---- 4.7 runbooks ----
  const mat = await req('POST', '/runbook/materialize', { token: op.token, body: { event_id: E } });
  ok('runbook materialized from wedding template', mat.status === 201 && mat.data.count > 15, JSON.stringify(mat.data));
  const mat2 = await req('POST', '/runbook/materialize', { token: op.token, body: { event_id: E } });
  ok('re-materialize reuses', mat2.data.reused === true);
  const items = (await req('GET', `/runbook?event_id=${E}`, { token: op.token })).data;
  const phases = new Set(items.map((i) => i.phase));
  ok('runbook has 3 phases', phases.has('BEFORE') && phases.has('DURING') && phases.has('AFTER'));
  const chk = await req('POST', `/runbook-items/${items[0].id}/check`, { token: op.token, body: { done: true } });
  ok('runbook check audited', chk.status === 200 && chk.data.done === 1);

  // ---- 4.9 devices / 4.10 comms ----
  const dev = await req('POST', '/devices', { token: op.token, body: { event_id: E, label: 'Door Phone' } });
  ok('device added', dev.status === 201);
  ok('device deploy', (await req('POST', `/devices/${dev.data.id}/status`, { token: op.token, body: { to: 'DEPLOYED' } })).status === 200);
  const badDev = await req('POST', `/devices/${dev.data.id}/status`, { token: op.token, body: { to: 'FLYING' } });
  ok('bad device status rejected', badDev.status === 400);
  const comm = await req('POST', '/comms', { token: op.token, body: { event_id: E, channel: 'WHATSAPP', message: 'Doors at 6', recipients_text: 'All' } });
  ok('comm logged', comm.status === 201 && comm.data.status === 'DRAFT');
  ok('comm sent', (await req('POST', `/comms/${comm.data.id}/status`, { token: op.token, body: { to: 'SENT' } })).data.status === 'SENT');

  // ---- 4.6 decisions ----
  const dec = await req('POST', '/decisions', { token: op.token, body: { event_id: E, title: 'Extra chairs?', reason: 'Over plan', options: ['Yes', 'No'] } });
  ok('decision requested', dec.status === 201);
  ok('decision decided', (await req('POST', `/decisions/${dec.data.id}/decide`, { token: op.token, body: { decision: 'Yes' } })).data.status === 'DECIDED');
  const dec2 = await req('POST', `/decisions/${dec.data.id}/decide`, { token: op.token, body: { decision: 'No' } });
  ok('double decision rejected', dec2.status === 409);

  // ---- notes ----
  const note = await req('POST', '/notes', { token: op.token, body: { event_id: E, body: 'Cake late, backup ordered', visibility: 'INTERNAL' } });
  ok('operator note saved', note.status === 201);

  // ---- 4.5 break-glass ----
  const outsider = await mkUser('P4 Outsider', undefined);
  const denied0 = await req('GET', `/events/${E}`, { token: outsider.token });
  ok('outsider denied before grant', denied0.status === 403);
  const grant = await req('POST', '/break-glass', { token: admin, body: { event_id: E, user_id: outsider.user.id, reason: 'Cover shift', minutes: 30 } });
  ok('grant issued', grant.status === 201);
  ok('grant confers access', (await req('GET', `/events/${E}`, { token: outsider.token })).status === 200);
  ok('grant visible in portfolio', (await req('GET', '/command', { token: outsider.token })).data.events.some((e) => e.id === E));
  ok('grant revoked', (await req('POST', `/break-glass/${grant.data.id}/revoke`, { token: admin })).status === 200);
  ok('access ends after revoke', (await req('GET', `/events/${E}`, { token: outsider.token })).status === 403);
  const noReason = await req('POST', '/break-glass', { token: admin, body: { event_id: E, user_id: outsider.user.id } });
  ok('grant without reason rejected', noReason.status === 400);

  // ---- 4.2 readiness-full / 4.4 customer / 4.11 results / 4.8 exports ----
  const full = await req('GET', `/event/${E}/readiness-full`, { token: op.token });
  ok('readiness-full has gap sections', full.status === 200 && full.data.sections.length >= 12 && full.data.sections.some((s) => s.pass === false));
  const cust = await req('GET', `/event/${E}/customer-summary`, { token: op.token });
  ok('customer summary curated', cust.status === 200 && cust.data.decisions_needing_you && cust.data.attendance);
  const res = await req('GET', `/event/${E}/results`, { token: op.token });
  ok('results package from records', res.status === 200 && res.data.unresolved && res.data.audit_entries >= 0 && res.data.key_timeline);
  const csv = await req('GET', `/event/${E}/export/guests.csv`, { token: op.token });
  ok('guest CSV export', csv.status === 200 && String(csv.data).startsWith('name,phone'));
  const brief = await req('GET', `/event/${E}/export/brief.txt`, { token: op.token });
  ok('brief export', brief.status === 200 && String(brief.data).includes('EVENT BRIEF'));

  // ---- isolation: outsider denied everywhere ----
  for (const [m, p] of [['GET', `/runbook?event_id=${E}`], ['GET', `/devices?event_id=${E}`], ['GET', `/comms?event_id=${E}`], ['GET', `/decisions?event_id=${E}`], ['GET', `/event/${E}/results`], ['GET', `/notes?event_id=${E}`]]) {
    const r = await req(m, p, { token: outsider.token });
    ok(`outsider denied ${p.split('?')[0]}`, r.status === 403, `got ${r.status}`);
  }

  // ---- workspace / workload / quality ----
  const ws = await req('GET', '/operator/workspace', { token: op.token });
  ok('workspace shows assigned event', ws.data.events.some((e) => e.id === E));
  ok('workload + quality (admin)', (await req('GET', '/operator/workload', { token: admin })).status === 200 &&
    (await req('GET', '/operator/quality', { token: admin })).status === 200);
  ok('workload denied for staff', (await req('GET', '/operator/workload', { token: op.token })).status === 403);

  // ---- lifecycle gates: close, then verify ----
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE', 'CLOSING', 'CLOSED']) {
    if (s === 'READY') {
      await req('POST', '/guests', { token: admin, body: { event_id: E, name: 'P4 Guest' } });
    }
    await req('POST', `/events/${E}/lifecycle`, { token: admin, body: { to: s } });
  }
  const dClosed = await req('POST', '/decisions', { token: op.token, body: { event_id: E, title: 'Late?' } });
  ok('CLOSED blocks decision create', dClosed.status === 409);
  const rbCheck = await req('POST', `/runbook-items/${items[1].id}/check`, { token: op.token, body: { done: true } });
  ok('CLOSED allows runbook AFTER checks', rbCheck.status === 200);
  const resClosed = await req('GET', `/event/${E}/results`, { token: op.token });
  ok('results readable when CLOSED', resClosed.status === 200);

  // ---- audit ----
  const audit = await req('GET', `/audit/event/${E}?limit=200`, { token: admin });
  const actions = new Set(audit.data.map((r) => r.action));
  for (const need of ['intake.convert', 'runbook.materialize', 'decision.request', 'decision.decide', 'device.add', 'comm.create', 'breakglass.grant', 'breakglass.revoke', 'note.create', 'export.guests', 'report.generate']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].join(','));
  }

  // ---- cleanup ----
  await req('DELETE', `/events/${E}`, { token: admin });
  for (const u of [op, outsider]) await req('DELETE', `/users/${u.user.id}`, { token: admin });

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
