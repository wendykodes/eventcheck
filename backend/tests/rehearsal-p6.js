// Phase 6 rehearsal — planner acceptance: "An event company can manage many
// events through one organization." Self-serve org, members, venue, 3 events,
// template snapshot, clone, double-booking warning, ENTERPRISE contract,
// live ops on one event, portfolio/report reconciliation, release on delete.
// Run: BASE=... ADMIN_PIN=... node tests/rehearsal-p6.js (self-cleaning).

const BASE = process.env.BASE || 'http://localhost:3134';
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
  const log = (...a) => console.log('[rehearsal-p6]', ...a);
  const admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;

  const mkUser = async (name) => {
    const pin = rndPin();
    const u = (await req('POST', '/users', { token: admin, body: { name, pin } })).data;
    const login = await req('POST', '/auth/login', { body: { pin } });
    return { user: u, token: login.data.token };
  };
  const owner = await mkUser('RH6 Owner');
  const mgr = await mkUser('RH6 Manager');
  const crew = await mkUser('RH6 Crew');

  // 1. Planner self-serves an org (platform staff, NOT admin)
  const org = (await req('POST', '/organizations', { token: owner.token, body: { name: 'RH6 Events Co', type: 'planner' } })).data;
  await req('POST', `/organizations/${org.id}/members`, { token: owner.token, body: { user_id: mgr.user.id, org_role: 'manager' } });
  await req('POST', `/organizations/${org.id}/members`, { token: owner.token, body: { user_id: crew.user.id, org_role: 'member' } });
  log('org founded by staffer, 3 members:', org.id);

  // 2. Venue + 3 same-date events (wedding season Saturday)
  const venue = (await req('POST', '/venues', { token: mgr.token, body: { org_id: org.id, name: 'RH6 Lakeside', capacity: 400 } })).data;
  const mkEvent = async (name, extra = {}) =>
    (await req('POST', '/events', { token: admin, body: { name, date: '2026-12-19', venue: 'Grounds', template_key: 'wedding', org_id: org.id, ...extra } })).data;
  const e1 = await mkEvent('RH6 Wedding Alpha', { venue_id: venue.id, venue: undefined });
  const e2 = await mkEvent('RH6 Wedding Beta');
  const e3 = await mkEvent('RH6 Kwanjula Gamma', { venue_id: venue.id, venue: undefined });
  log('3 events under org, venue linked:', e1.venue === 'RH6 Lakeside' && e3.venue_id === venue.id);

  // 3. Reuse: snapshot template from e1, clone e1's structure after adding some
  await req('POST', '/schedule', { token: admin, body: { event_id: e1.id, title: 'RH6 ceremony' } });
  await req('POST', '/seating/zones', { token: admin, body: { event_id: e1.id, name: 'RH6 T1', capacity: 10 } });
  await req('POST', `/templates/from-event/${e1.id}`, { token: admin, body: { key: 'custom_rh6', name: 'RH6 House Wedding' } });
  const e4 = (await req('POST', '/events', { token: admin, body: { name: 'RH6 Wedding Delta', date: '2026-12-20', template_key: 'custom_rh6', org_id: org.id } })).data;
  const e5 = (await req('POST', `/events/${e1.id}/clone`, { token: admin, body: { name: 'RH6 Wedding Alpha II' } })).data;
  const e5sched = await req('GET', `/schedule?event_id=${e5.id}`, { token: admin });
  log('template snapshot + custom-template event + clone (schedule copied):', e4.template_key === 'custom_rh6' && e5sched.data.length === 1);

  // 4. Crew works all three Saturday events → warnings fire
  const warnings = [];
  for (const e of [e1, e2, e3]) {
    const r = await req('POST', `/events/${e.id}/roles`, { token: admin, body: { user_id: crew.user.id, role_key: 'usher' } });
    warnings.push(...(r.data.warnings || []));
  }
  log('double-booking warnings:', warnings.length, '(expect 3: 0+1+2, third names both overlaps)');

  // 5. ENTERPRISE contract covering the season
  const contract = (await req('POST', '/contracts', { token: mgr.token, body: { org_id: org.id, title: 'RH6 Season 2026', package: 'ENTERPRISE', value_cents: 15000000, event_ids: [e1.id, e2.id, e3.id, e4.id, e5.id] } })).data;
  log('contract links', contract.events.length, 'events');

  // 6. Live ops on e1: guests, RSVP, activate, check-ins, task+incident
  const guests = [];
  for (let i = 1; i <= 30; i++) guests.push((await req('POST', '/guests', { token: admin, body: { event_id: e1.id, name: `RH6 Guest ${i}` } })).data);
  const inv = await req('POST', '/guest-invites', { token: admin, body: { event_id: e1.id, guest_ids: guests.map((g) => g.id) } });
  const tokens = inv.data.invitations.filter((x) => x.token).map((x) => x.token);
  for (let i = 0; i < 20; i++) await req('POST', `/guest-invite/${tokens[i]}/rsvp`, { body: { response: 'confirmed' } });
  await req('POST', '/tasks', { token: admin, body: { event_id: e1.id, title: 'RH6 setup' } });
  await req('POST', '/incidents', { token: admin, body: { event_id: e1.id, title: 'RH6 leak', severity: 'HIGH' } });
  for (const s of ['CONFIGURING', 'READY', 'ACTIVE']) await req('POST', `/events/${e1.id}/lifecycle`, { token: admin, body: { to: s } });
  const act = (await req('GET', `/activities?event_id=${e1.id}`, { token: admin })).data[0].id;
  let checked = 0;
  for (let i = 0; i < 18; i++) {
    if ((await req('POST', '/checkins', { token: admin, body: { guest_id: guests[i].id, activity_id: act } })).status === 201) checked++;
  }

  // 7. Portfolio + org report reconcile
  const portfolio = (await req('GET', `/organizations/${org.id}/portfolio`, { token: owner.token })).data;
  const report = (await req('GET', `/organizations/${org.id}/report`, { token: owner.token })).data;
  const pe1 = portfolio.events.find((e) => e.id === e1.id);
  log('portfolio:', portfolio.total, 'events | e1 health:', pe1.health, '| open incidents:', pe1.open_incidents);
  log('org report:', JSON.stringify({ events: report.events, guests: report.guests, tasks: report.tasks, incidents: report.incidents, rsvp: report.rsvp }));

  // 8. Close e1, verify report, release org
  await req('POST', `/events/${e1.id}/lifecycle`, { token: admin, body: { to: 'CLOSING' } });
  await req('POST', `/events/${e1.id}/lifecycle`, { token: admin, body: { to: 'CLOSED' } });
  await req('PUT', `/events/${e1.id}`, { token: admin, body: { venue_id: null } });
  const hist = await req('GET', `/command/${e1.id}/timeline`, { token: admin });
  await req('DELETE', `/organizations/${org.id}`, { token: owner.token });
  const released = await req('GET', `/events/${e2.id}`, { token: admin });

  const pass = portfolio.total === 5 && report.events === 5 && report.guests.invited === 30
    && report.tasks.open === 1 && report.incidents.open === 1 && report.rsvp.confirmed === 20
    && checked === 18 && warnings.length === 3 && contract.events.length === 5
    && pe1.open_incidents === 1 && released.data.org_id === null && hist.data.length > 10;
  log(pass ? 'REHEARSAL PASS' : 'REHEARSAL MISMATCH');
  log('org deleted, events released, history intact');

  // cleanup
  for (const e of [e1, e2, e3, e4, e5]) await req('DELETE', `/events/${e.id}`, { token: admin }).catch(() => {});
  await req('DELETE', '/templates/custom_rh6', { token: admin }).catch(() => {});
  for (const u of [owner, mgr, crew]) await req('DELETE', `/users/${u.user.id}`, { token: admin }).catch(() => {});
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('REHEARSAL CRASH:', e); process.exit(1); });
