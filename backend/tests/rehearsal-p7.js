// Phase 7 rehearsal — organizational learning across events: two closed
// weddings teach show-up/decline/throughput baselines; a live wedding is
// forecast from them; nudges + staffing recs fire with stated bases; closing
// the live event updates the baselines (n=3). All numbers hand-checked.
// Run: BASE=... ADMIN_PIN=... node tests/rehearsal-p7.js (self-cleaning).

const BASE = process.env.BASE || 'http://localhost:3136';
const PIN = process.env.ADMIN_PIN || '1234';
const API = `${BASE}/api`;

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
const rndPin = () => String(1000 + Math.floor(Math.random() * 9000));

async function main() {
  const log = (...a) => console.log('[rehearsal-p7]', ...a);
  let admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  async function areq(method, path, opts = {}) {
    let r = await req(method, path, { ...opts, token: admin });
    if (r.status === 401 && JSON.stringify(r.data || '').includes('Session active')) {
      admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
      r = await req(method, path, { ...opts, token: admin });
    }
    return r;
  }
  const ORG = `RH7 Org ${Date.now().toString(36)}`;
  const org = (await areq('POST', '/organizations', { token: admin, body: { name: ORG } })).data;

  async function histEvent(name, nGuests, nConfirmed, nDeclined, nChecked) {
    const e = (await areq('POST', '/events', { token: admin, body: { name, date: '2026-06-01', venue: 'H', template_key: 'wedding', org_id: org.id } })).data;
    const gids = [];
    for (let i = 0; i < nGuests; i++) gids.push((await areq('POST', '/guests', { token: admin, body: { event_id: e.id, name: `${name} G${i}` } })).data.id);
    const inv = await areq('POST', '/guest-invites', { token: admin, body: { event_id: e.id, guest_ids: gids } });
    const toks = inv.data.invitations.filter((x) => x.token).map((x) => x.token);
    for (let i = 0; i < nConfirmed; i++) await req('POST', `/guest-invite/${toks[i]}/rsvp`, { body: { response: 'confirmed' } });
    for (let i = nConfirmed; i < nConfirmed + nDeclined; i++) await req('POST', `/guest-invite/${toks[i]}/rsvp`, { body: { response: 'declined' } });
    for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await areq('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: s } });
    const act = (await areq('GET', `/activities?event_id=${e.id}`, { token: admin })).data[0].id;
    for (let i = 0; i < nChecked; i++) await areq('POST', '/checkins', { token: admin, body: { guest_id: gids[i], activity_id: act } });
    await areq('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
    await areq('POST', `/events/${e.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
    return e;
  }

  // H1: 20 invited, 16 confirmed, 2 declined → show_up 12/16 = 0.75
  // H2: 10 invited, 10 confirmed → show_up 10/10 = 1.0 → merged 0.875
  await histEvent('RH7 H1', 20, 16, 2, 12);
  await histEvent('RH7 H2', 10, 10, 0, 10);
  const bl = (await areq('GET', `/learning/baselines?org_id=${org.id}&template_key=wedding`, { token: admin })).data;
  const su = bl.find((b) => b.metric === 'show_up_rate');
  log('learned show_up:', su.mean, 'n=' + su.n, '(expect 0.875, n=2)');

  // Live: 12 invited, 6 confirmed, 1 declined, 5 silent
  const live = (await areq('POST', '/events', { token: admin, body: { name: 'RH7 Live', date: '2026-12-25', venue: 'H', template_key: 'wedding', org_id: org.id } })).data;
  const gl = [];
  for (let i = 0; i < 12; i++) gl.push((await areq('POST', '/guests', { token: admin, body: { event_id: live.id, name: `RH7L G${i}` } })).data.id);
  const invL = await areq('POST', '/guest-invites', { token: admin, body: { event_id: live.id, guest_ids: gl } });
  const tokL = invL.data.invitations.filter((x) => x.token).map((x) => x.token);
  for (let i = 0; i < 6; i++) await req('POST', `/guest-invite/${tokL[i]}/rsvp`, { body: { response: 'confirmed' } });
  await req('POST', `/guest-invite/${tokL[6]}/rsvp`, { body: { response: 'declined' } });
  const pin = rndPin();
  const loader = (await areq('POST', '/users', { token: admin, body: { name: 'RH7 Loader', pin } })).data;
  await areq('POST', `/events/${live.id}/roles`, { token: admin, body: { user_id: loader.id, role_key: 'waiter' } });
  for (let i = 0; i < 5; i++) await areq('POST', '/tasks', { token: admin, body: { event_id: live.id, title: `RH7 load ${i}`, assignee_user_id: loader.id } });

  const intel = await areq('GET', `/intelligence/${live.id}`, { token: admin });
  const f = intel.data.forecast;
  log('forecast: expected', f.expected_arrivals, '(expect round(6×0.875)=5) | silent', f.silent, '| basis:', f.show_up_basis);
  log('recs:', intel.data.recommendations.map((r) => r.key).join(','));
  const nudge = await areq('POST', '/followups/rsvp-nudges', { token: admin, body: { event_id: live.id } });
  log('nudges queued:', nudge.data.queued, '(expect 5)');

  // Run the live event to close: check in, resolve, close → baselines n=3
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await areq('POST', `/events/${live.id}/lifecycle`, { token: admin, body: { to: s } });
  const actsRes = await areq('GET', `/activities?event_id=${live.id}`, { token: admin });
  if (!Array.isArray(actsRes.data) || actsRes.data.length === 0) {
    throw new Error(`activities unexpected: status=${actsRes.status} body=${JSON.stringify(actsRes.data).slice(0, 200)} live=${live.id}`);
  }
  const act = actsRes.data[0].id;
  for (let i = 0; i < 5; i++) await areq('POST', '/checkins', { token: admin, body: { guest_id: gl[i], activity_id: act } });
  await areq('POST', `/events/${live.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await areq('POST', `/events/${live.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  const bl2 = (await areq('GET', `/learning/baselines?org_id=${org.id}&template_key=wedding`, { token: admin })).data;
  const su2 = bl2.find((b) => b.metric === 'show_up_rate');
  // live: 5 checked / 6 confirmed = 0.8333 → merged (0.875*2 + 0.8333)/3
  const expectMean = (0.875 * 2 + 5 / 6) / 3;
  log('after close: n=' + su2.n, 'mean=' + su2.mean.toFixed(4), `(expect n=3, ${expectMean.toFixed(4)})`);

  const pass = su.n === 2 && Math.abs(su.mean - 0.875) < 1e-9 && f.expected_arrivals === 5
    && nudge.data.queued === 5 && su2.n === 3 && Math.abs(su2.mean - expectMean) < 1e-9
    && intel.data.recommendations.every((r) => r.title && r.basis && r.action);
  log(pass ? 'REHEARSAL PASS' : 'REHEARSAL MISMATCH');

  for (const e of (await areq('GET', '/events', { token: admin })).data.filter((e) => e.name.startsWith('RH7 '))) {
    await areq('DELETE', `/events/${e.id}`, { token: admin }).catch(() => {});
  }
  await areq('DELETE', `/organizations/${org.id}`, { token: admin }).catch(() => {});
  await areq('DELETE', `/users/${loader.id}`, { token: admin }).catch(() => {});
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
