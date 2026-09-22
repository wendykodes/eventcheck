// Phase 6 tests — organizations, venues, contracts, templates, clone,
// portfolio, org reporting, double-booking conflicts, lifecycle interplay.
// Self-cleaning. Run: BASE=... ADMIN_PIN=... node tests/phase6.test.js

const BASE = process.env.BASE || 'http://localhost:3134';
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
const rndPin = () => String(1000 + Math.floor(Math.random() * 9000));

async function main() {
  const admin0 = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
  let admin = admin0;
  ok('admin login', !!admin);
  // Shared dev DB: another operator logging in as admin invalidates this
  // token (single-session). Transparently re-login once and retry.
  async function areq(method, path, opts = {}) {
    let r = await req(method, path, { ...opts, token: admin });
    if (r.status === 401 && JSON.stringify(r.data || '').includes('Session active')) {
      admin = (await req('POST', '/auth/login', { body: { pin: PIN } })).data.token;
      r = await req(method, path, { ...opts, token: admin });
    }
    return r;
  }

  const mkUser = async (name, roleKey, eventId) => {
    const pin = rndPin();
    const u = (await areq('POST', '/users', { token: admin, body: { name, pin } })).data;
    if (!u.id) throw new Error(`user creation failed: ${JSON.stringify(u)}`);
    if (roleKey && eventId) await areq('POST', `/events/${eventId}/roles`, { token: admin, body: { user_id: u.id, role_key: roleKey } });
    const login = await req('POST', '/auth/login', { body: { pin } });
    return { user: u, token: login.data.token };
  };
  const planner = await mkUser('P6 Planner');
  const outsider = await mkUser('P6 Outsider');

  // ---- orgs: self-serve create → owner ----
  const org = (await req('POST', '/organizations', { token: planner.token, body: { name: 'P6 Events Co', type: 'planner' } })).data;
  ok('staff self-serves org', org.id && true, JSON.stringify(org).slice(0, 100));
  const detail = (await req('GET', `/organizations/${org.id}`, { token: planner.token })).data;
  ok('creator is owner', detail.members.some((m) => m.user_id === planner.user.id && m.org_role === 'owner'));
  ok('outsider denied org read', (await req('GET', `/organizations/${org.id}`, { token: outsider.token })).status === 403);
  ok('org update by owner', (await req('PUT', `/organizations/${org.id}`, { token: planner.token, body: { contact_name: 'Jo' } })).status === 200);
  // member add/remove + last-owner protection
  await req('POST', `/organizations/${org.id}/members`, { token: planner.token, body: { user_id: outsider.user.id, org_role: 'manager' } });
  const withMember = (await req('GET', `/organizations/${org.id}`, { token: outsider.token }));
  ok('added manager can read org', withMember.status === 200);
  const lastOwner = await req('DELETE', `/organizations/${org.id}/members/${planner.user.id}`, { token: planner.token });
  ok('last owner removal blocked', lastOwner.status === 409, String(lastOwner.status));
  await req('POST', `/organizations/${org.id}/members`, { token: planner.token, body: { user_id: outsider.user.id, org_role: 'owner' } });
  ok('remove member works', (await req('DELETE', `/organizations/${org.id}/members/${outsider.user.id}`, { token: planner.token })).status === 200);

  // ---- venues ----
  const badVenue = await req('POST', '/venues', { token: planner.token, body: { org_id: 999999, name: 'X' } });
  ok('venue needs real org', badVenue.status === 404, String(badVenue.status));
  const venue = (await req('POST', '/venues', { token: planner.token, body: { org_id: org.id, name: 'P6 Grand Hall', capacity: 300 } })).data;
  ok('venue created', venue.id && venue.capacity === 300);
  ok('outsider denied venues', (await req('GET', `/venues?org_id=${org.id}`, { token: outsider.token })).status === 403);

  // ---- events under org + venue link ----
  const mkEvent = async (name, extra = {}) =>
    (await areq('POST', '/events', { token: admin, body: { name, date: '2026-12-25', venue: 'Hall', template_key: 'wedding', org_id: org.id, ...extra } })).data;
  const e1 = await mkEvent('P6 Wedding One', { venue_id: venue.id, venue: undefined });
  ok('event links venue (name copied)', e1.venue === 'P6 Grand Hall' && e1.venue_id === venue.id, JSON.stringify({ venue: e1.venue, venue_id: e1.venue_id }));
  const e1b = await mkEvent('P6 Wedding One B', { venue_id: venue.id, venue: 'Custom Hall Name' });
  ok('explicit venue text wins over copy', e1b.venue === 'Custom Hall Name' && e1b.venue_id === venue.id);
  await areq('DELETE', `/events/${e1b.id}`, { token: admin });
  const e2 = await mkEvent('P6 Wedding Two');
  const e3 = await mkEvent('P6 Wedding Three');
  // cross-org venue rejection
  const orgB = (await areq('POST', '/organizations', { token: admin, body: { name: 'P6 Other Co' } })).data;
  const venueB = (await areq('POST', '/venues', { token: admin, body: { org_id: orgB.id, name: 'Far Hall' } })).data;
  const xorg = await areq('POST', '/events', { token: admin, body: { name: 'X', date: '2026-12-25', org_id: org.id, venue_id: venueB.id, template_key: 'wedding' } });
  ok('cross-org venue rejected', xorg.status === 400, String(xorg.status));
  ok('venue delete blocked while linked', (await req('DELETE', `/venues/${venue.id}`, { token: planner.token })).status === 409);

  // ---- double-booking warnings ----
  const crew = await mkUser('P6 Crew');
  await req('POST', `/organizations/${org.id}/members`, { token: planner.token, body: { user_id: crew.user.id, org_role: 'member' } });
  const a1 = await areq('POST', `/events/${e1.id}/roles`, { token: admin, body: { user_id: crew.user.id, role_key: 'usher' } });
  ok('first assignment clean', a1.status === 201 && (a1.data.warnings || []).length === 0);
  const a2 = await areq('POST', `/events/${e2.id}/roles`, { token: admin, body: { user_id: crew.user.id, role_key: 'usher' } });
  ok('second same-date assignment warns', a2.status === 201 && a2.data.warnings.some((w) => w.type === 'double_booked'));
  const conflicts = (await req('GET', `/organizations/${org.id}/conflicts`, { token: planner.token })).data;
  ok('conflicts report lists crew', conflicts.conflicts.some((c) => c.user_id === crew.user.id && c.events.length === 2));

  // ---- portfolio + org report ----
  await areq('POST', '/tasks', { token: admin, body: { event_id: e1.id, title: 'P6 task' } });
  await areq('POST', '/incidents', { token: admin, body: { event_id: e2.id, title: 'P6 incident', severity: 'HIGH' } });
  const portfolio = (await req('GET', `/organizations/${org.id}/portfolio`, { token: planner.token })).data;
  ok('portfolio lists 3 events', portfolio.total === 3, String(portfolio.total));
  const card = portfolio.events.find((e) => e.id === e2.id);
  ok('portfolio surfaces incident attention', card.open_incidents === 1 && card.attention_count >= 1);
  const report = (await req('GET', `/organizations/${org.id}/report`, { token: planner.token })).data;
  ok('org report aggregates', report.events === 3 && report.tasks.open === 1 && report.incidents.open === 1, JSON.stringify(report));
  ok('portfolio denied for outsider', (await req('GET', `/organizations/${org.id}/portfolio`, { token: outsider.token })).status === 403);

  // ---- contracts ----
  const badPkg = await req('POST', '/contracts', { token: planner.token, body: { org_id: org.id, title: 'X', package: 'GOLD' } });
  ok('bad package rejected', badPkg.status === 400);
  const contract = (await req('POST', '/contracts', { token: planner.token, body: { org_id: org.id, title: 'P6 Season', package: 'ENTERPRISE', value_cents: 500000, event_ids: [e1.id, e2.id] } })).data;
  ok('contract links 2 events', contract.id && contract.events.length === 2);
  const lone = await mkEvent('P6 Lone');
  await areq('PUT', `/events/${lone.id}`, { token: admin, body: { org_id: null } });
  const xlink = await req('PUT', `/contracts/${contract.id}`, { token: planner.token, body: { event_ids: [lone.id] } });
  ok('cross-org event link rejected', xlink.status === 400, String(xlink.status));
  await areq('DELETE', `/events/${lone.id}`, { token: admin });

  // ---- templates: CRUD guards + from-event + clone ----
  ok('bare key rejected', (await areq('POST', '/templates', { token: admin, body: { key: 'bare', name: 'X' } })).status === 400);
  ok('seed edit forbidden', (await areq('PUT', '/templates/wedding', { token: admin, body: { name: 'Hacked' } })).status === 403);
  ok('seed delete forbidden', (await areq('DELETE', '/templates/wedding', { token: admin })).status === 403);
  const snap = await areq('POST', `/templates/from-event/${e1.id}`, { token: admin, body: { key: 'custom_p6_wedding', name: 'P6 Wedding' } });
  ok('template snapshotted from event', snap.status === 201 && snap.data.default_roles.includes('usher'), JSON.stringify(snap.data).slice(0, 160));
  // seed reseed does not clobber custom keys: simulate by re-PUTting custom (allowed) and confirming seed intact
  ok('custom template editable', (await areq('PUT', '/templates/custom_p6_wedding', { token: admin, body: { description: 'Edited' } })).status === 200);
  // structure for clone source
  await areq('POST', '/schedule', { token: admin, body: { event_id: e1.id, title: 'P6 ceremony' } });
  await areq('POST', '/seating/zones', { token: admin, body: { event_id: e1.id, name: 'P6 T1', capacity: 8 } });
  await areq('POST', '/guests', { token: admin, body: { event_id: e1.id, name: 'P6 Guest' } });
  await areq('POST', '/tasks', { token: admin, body: { event_id: e1.id, title: 'P6 do-not-copy' } });
  const clone = (await areq('POST', `/events/${e1.id}/clone`, { token: admin, body: { name: 'P6 Wedding One (repeat)' } })).data;
  ok('clone created DRAFT', clone.lifecycle_state === 'DRAFT' && clone.org_id === org.id);
  const cloneAudit = await areq('GET', `/audit/event/${clone.id}?limit=20`, { token: admin });
  ok('audit has event.clone', cloneAudit.data.some((r) => r.action === 'event.clone'));
  const cSched = await areq('GET', `/schedule?event_id=${clone.id}`, { token: admin });
  const cZones = await areq('GET', `/seating/zones?event_id=${clone.id}`, { token: admin });
  const cGuests = await areq('GET', `/guests/?event_id=${clone.id}`, { token: admin });
  const cTasks = await areq('GET', `/tasks?event_id=${clone.id}`, { token: admin });
  ok('clone copies structure only', cSched.data.length === 1 && cZones.data.length === 1 && cGuests.data.length === 0 && cTasks.data.length === 0,
    `${cSched.data.length}/${cZones.data.length}/${cGuests.data.length}/${cTasks.data.length}`);
  await areq('DELETE', `/events/${clone.id}`, { token: admin });
  // custom template now unused (e1 still wedding) → delete allowed; first verify in-use guard on a used custom key
  const useCustom = (await areq('POST', '/events', { token: admin, body: { name: 'P6 Custom Use', date: '2026-12-26', template_key: 'custom_p6_wedding', org_id: org.id } })).data;
  ok('event from custom template', useCustom.template_key === 'custom_p6_wedding');
  ok('in-use custom delete blocked', (await areq('DELETE', '/templates/custom_p6_wedding', { token: admin })).status === 409);
  await areq('DELETE', `/events/${useCustom.id}`, { token: admin });
  ok('unused custom delete allowed', (await areq('DELETE', '/templates/custom_p6_wedding', { token: admin })).status === 200);

  // ---- org delete releases events, never destroys them ----
  // unlink venue first (delete-blocked while linked), then delete org
  await areq('PUT', `/events/${e1.id}`, { token: admin, body: { venue_id: null } });
  await req('DELETE', `/venues/${venue.id}`, { token: planner.token });
  const delOrg = await req('DELETE', `/organizations/${org.id}`, { token: planner.token });
  ok('owner deletes org', delOrg.status === 200);
  const released = await areq('GET', `/events/${e1.id}`, { token: admin });
  ok('events released (org_id NULL), history intact', released.status === 200 && released.data.org_id === null);
  ok('deleted org gone', (await areq('GET', `/organizations/${org.id}`, { token: admin })).status === 404);

  // ---- audit sample (event-scoped + global for org-level actions) ----
  const audit = await areq('GET', `/audit/event/${e2.id}?limit=100`, { token: admin });
  const actions = new Set(audit.data.map((r) => r.action));
  const recent = await areq('GET', '/audit/recent?limit=200', { token: admin });
  const globalActions = new Set((recent.data || []).map((r) => r.action));
  for (const need of ['event.role.assign']) {
    ok(`audit has ${need}`, actions.has(need), [...actions].slice(0, 12).join(','));
  }
  for (const need of ['contract.create', 'venue.create', 'org.member.add']) {
    ok(`audit has ${need}`, globalActions.has(need));
  }

  // ---- cleanup ----
  for (const e of [e1, e2, e3]) await areq('DELETE', `/events/${e.id}`, { token: admin }).catch(() => {});
  await areq('DELETE', `/organizations/${orgB.id}`, { token: admin }).catch(() => {});
  for (const u of [planner, outsider, crew]) await areq('DELETE', `/users/${u.user.id}`, { token: admin }).catch(() => {});

  console.log(results.join('\n'));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
