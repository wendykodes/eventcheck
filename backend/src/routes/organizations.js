// RaaS Phase 0 + Phase 6 — Organization model.
// Platform → Organization → Events. Supports planners, venues, enterprise.
// Phase 6: self-serve creation (creator → owner), update/delete, member
// removal, org portfolio (health-enriched event list), org reporting,
// staff double-booking conflicts. Reads: member-or-admin. Writes: manager+.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireOrgAccess, requireOrgManager, orgIdFromReq } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { getAttention, getHealth } from '../raas/attention.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(db.prepare('SELECT * FROM organizations ORDER BY name ASC').all());
  }
  res.json(db.prepare(`
    SELECT o.* FROM organizations o
    JOIN organization_users ou ON ou.org_id = o.id
    WHERE ou.user_id = ? ORDER BY o.name ASC
  `).all(req.user.id));
});

// Self-serve: any authenticated user can found an org; creator becomes owner.
router.post('/', (req, res) => {
  const { name, type, contact_name, contact_phone } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Organization name is required' });
  const r = db.prepare('INSERT INTO organizations (name, type, contact_name, contact_phone) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), type || null, contact_name || null, contact_phone || null);
  db.prepare('INSERT OR IGNORE INTO organization_users (org_id, user_id, org_role) VALUES (?, ?, ?)').run(r.lastInsertRowid, req.user.id, 'owner');
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(r.lastInsertRowid);
  auditFromReq(req, { action: 'org.create', entityType: 'organization', entityId: r.lastInsertRowid, metadata: { name } });
  res.status(201).json(org);
});

router.get('/:id', (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (req.user.role !== 'admin') {
    const link = db.prepare('SELECT 1 FROM organization_users WHERE org_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!link) return res.status(403).json({ error: 'No access to this organization' });
  }
  const events = db.prepare('SELECT id, name, lifecycle_state, status, date FROM events WHERE org_id = ? ORDER BY date DESC').all(req.params.id);
  const members = db.prepare(`
    SELECT ou.*, u.name AS user_name FROM organization_users ou
    JOIN users u ON u.id = ou.user_id WHERE ou.org_id = ?
  `).all(req.params.id);
  res.json({ ...org, events, members });
});

router.put('/:id', requireOrgAccess(), requireOrgManager(), (req, res) => {
  const { name, type, contact_name, contact_phone } = req.body;
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.orgId);
  db.prepare('UPDATE organizations SET name=?, type=?, contact_name=?, contact_phone=?, updated_at=datetime(\'now\') WHERE id=?')
    .run(name !== undefined && String(name).trim() ? String(name).trim() : org.name,
      type !== undefined ? type : org.type,
      contact_name !== undefined ? contact_name : org.contact_name,
      contact_phone !== undefined ? contact_phone : org.contact_phone, req.orgId);
  auditFromReq(req, { action: 'org.update', entityType: 'organization', entityId: req.orgId });
  res.json(db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.orgId));
});

router.delete('/:id', requireOrgAccess(), (req, res) => {
  // Delete: admin always; org owners only (managers cannot dissolve the org).
  if (req.user.role !== 'admin' && req.orgRole !== 'owner') {
    return res.status(403).json({ error: 'Organization owner required' });
  }
  // Events are released (org_id NULL), never cascade-deleted: destroying an
  // org must not destroy event history.
  const tx = db.transaction(() => {
    db.prepare('UPDATE events SET org_id = NULL WHERE org_id = ?').run(req.orgId);
    db.prepare('DELETE FROM organization_users WHERE org_id = ?').run(req.orgId);
    db.prepare('DELETE FROM venues WHERE org_id = ?').run(req.orgId);
    db.prepare('DELETE FROM contracts WHERE org_id = ?').run(req.orgId);
    db.prepare('DELETE FROM organizations WHERE id = ?').run(req.orgId);
  });
  tx();
  auditFromReq(req, { action: 'org.delete', entityType: 'organization', entityId: req.orgId });
  res.json({ ok: true });
});

router.post('/:id/members', requireOrgAccess(), requireOrgManager(), (req, res) => {
  const { user_id, org_role } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const role = ['owner', 'manager', 'member'].includes(org_role) ? org_role : 'member';
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR REPLACE INTO organization_users (org_id, user_id, org_role) VALUES (?, ?, ?)').run(req.orgId, user_id, role);
  auditFromReq(req, { action: 'org.member.add', entityType: 'organization', entityId: req.orgId, metadata: { user_id, org_role: role } });
  res.status(201).json({ ok: true });
});

router.delete('/:id/members/:userId', requireOrgAccess(), requireOrgManager(), (req, res) => {
  // Cannot remove the last owner.
  const target = db.prepare('SELECT org_role FROM organization_users WHERE org_id = ? AND user_id = ?').get(req.orgId, req.params.userId);
  if (!target) return res.status(404).json({ error: 'Membership not found' });
  if (target.org_role === 'owner') {
    const owners = db.prepare("SELECT COUNT(*) AS c FROM organization_users WHERE org_id = ? AND org_role = 'owner'").get(req.orgId).c;
    if (owners <= 1) return res.status(409).json({ error: 'Cannot remove the last owner' });
  }
  db.prepare('DELETE FROM organization_users WHERE org_id = ? AND user_id = ?').run(req.orgId, req.params.userId);
  auditFromReq(req, { action: 'org.member.remove', entityType: 'organization', entityId: req.orgId, metadata: { user_id: Number(req.params.userId) } });
  res.json({ ok: true });
});

// ---------- Phase 6: org portfolio (planner view) ----------
router.get('/:id/portfolio', requireOrgAccess(), (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE org_id = ? ORDER BY date DESC').all(req.orgId);
  const cards = events.map((e) => {
    const attention = getAttention(e.id);
    const health = getHealth(e.id, attention);
    const openInc = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')").get(e.id).c;
    return {
      id: e.id, name: e.name, date: e.date, venue: e.venue, lifecycle_state: e.lifecycle_state,
      template_key: e.template_key, health: health.status, reasons: health.reasons.slice(0, 3),
      attention_count: attention.length, open_incidents: openInc,
      top_attention: attention.slice(0, 3),
    };
  });
  const order = { CRITICAL: 0, WATCH: 1, OK: 2 };
  cards.sort((a, b) => (order[a.health] - order[b.health]) || (b.attention_count - a.attention_count));
  res.json({ org_id: req.orgId, events: cards, total: cards.length, needs_attention: cards.filter((c) => c.health !== 'OK').map((c) => c.id) });
});

// ---------- Phase 6: organization-level reporting (live aggregates) ----------
router.get('/:id/report', requireOrgAccess(), (req, res) => {
  const eventIds = db.prepare('SELECT id FROM events WHERE org_id = ?').all(req.orgId).map((r) => r.id);
  if (eventIds.length === 0) {
    return res.json({ org_id: req.orgId, events: 0, by_lifecycle: {}, guests: { invited: 0, checked_in: 0 }, incidents: { open: 0 }, tasks: { open: 0, done: 0 }, rsvp: { confirmed: 0, declined: 0 } });
  }
  const ph = eventIds.map(() => '?').join(',');
  const byLifecycle = db.prepare(`SELECT lifecycle_state, COUNT(*) AS c FROM events WHERE org_id = ? GROUP BY lifecycle_state`).all(req.orgId);
  const guests = db.prepare(`SELECT COUNT(*) AS invited,
    (SELECT COUNT(DISTINCT c.guest_id) FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id IN (${ph})) AS checked_in
    FROM guests WHERE event_id IN (${ph}) AND status = 'approved'`).get(...eventIds, ...eventIds);
  const incidents = db.prepare(`SELECT SUM(CASE WHEN status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS open FROM incidents WHERE event_id IN (${ph})`).get(...eventIds);
  const tasks = db.prepare(`SELECT SUM(CASE WHEN status NOT IN ('COMPLETED','CANCELLED') THEN 1 ELSE 0 END) AS open,
    SUM(CASE WHEN status IN ('COMPLETED','CANCELLED') THEN 1 ELSE 0 END) AS done FROM tasks WHERE event_id IN (${ph})`).get(...eventIds);
  const rsvp = db.prepare(`SELECT SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN status = 'DECLINED' THEN 1 ELSE 0 END) AS declined FROM rsvps WHERE event_id IN (${ph})`).get(...eventIds);
  res.json({
    org_id: req.orgId, events: eventIds.length,
    by_lifecycle: Object.fromEntries(byLifecycle.map((r) => [r.lifecycle_state, r.c])),
    guests: { invited: guests.invited || 0, checked_in: guests.checked_in || 0 },
    incidents: { open: incidents.open || 0 },
    tasks: { open: tasks.open || 0, done: tasks.done || 0 },
    rsvp: { confirmed: rsvp.confirmed || 0, declined: rsvp.declined || 0 },
  });
});

// ---------- Phase 6: staff double-booking conflicts ----------
// Same user assigned to 2+ non-closed events on the same date. Deterministic,
// explainable, warn-not-block (assignment endpoints surface these as warnings).
export function findConflicts(orgId) {
  const rows = db.prepare(`
    SELECT ue.user_id, u.name AS user_name, e.id AS event_id, e.name AS event_name, e.date AS event_date
    FROM user_events ue
    JOIN users u ON u.id = ue.user_id
    JOIN events e ON e.id = ue.event_id
    WHERE e.org_id = ? AND e.lifecycle_state NOT IN ('CLOSED','ARCHIVED','CANCELLED')
    ORDER BY ue.user_id, e.date ASC`).all(orgId);
  const byUserDate = new Map();
  for (const r of rows) {
    const key = `${r.user_id}|${r.event_date || ''}`;
    if (!byUserDate.has(key)) byUserDate.set(key, []);
    byUserDate.get(key).push(r);
  }
  const conflicts = [];
  for (const [key, list] of byUserDate) {
    const ids = [...new Set(list.map((r) => r.event_id))];
    if (ids.length > 1) {
      conflicts.push({ user_id: list[0].user_id, user_name: list[0].user_name, date: list[0].event_date, events: ids.map((id) => ({ id, name: list.find((r) => r.event_id === id).event_name })) });
    }
  }
  return conflicts;
}

router.get('/:id/conflicts', requireOrgAccess(), (req, res) => {
  res.json({ org_id: req.orgId, conflicts: findConflicts(req.orgId) });
});

export default router;
