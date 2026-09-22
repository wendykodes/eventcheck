// RaaS Phase 4 — Operator workspace, break-glass, notes, workload, quality.
// Service-delivery interface: assigned events + my load + internal notes.
// Break-glass: explicit, reason-required, time-limited, fully audited.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { getLifecycle } from '../raas/readiness.js';
import { getAttention, getHealth } from '../raas/attention.js';

const router = Router();
router.use(requireAuth);

function myEvents(userId, platformRole) {
  if (platformRole === 'admin') return db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  return db.prepare(`SELECT e.* FROM events e WHERE e.id IN (
    SELECT event_id FROM user_events WHERE user_id = ?
    UNION SELECT event_id FROM event_user_roles WHERE user_id = ?
    UNION SELECT event_id FROM break_glass_grants WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
  ) ORDER BY e.date DESC`).all(userId, userId, userId);
}

// ---- Operator workspace: my events w/ health + my open work + recent notes ----
router.get('/operator/workspace', (req, res) => {
  const events = myEvents(req.user.id, req.user.role).filter((e) => e.lifecycle_state !== 'ARCHIVED');
  const cards = events.map((e) => {
    const attention = getAttention(e.id);
    const health = getHealth(e.id, attention);
    const myTasks = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE event_id = ? AND assignee_user_id = ? AND status NOT IN ('COMPLETED','CANCELLED')").get(e.id, req.user.id).c;
    const myInc = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND assignee_user_id = ? AND status NOT IN ('RESOLVED','CLOSED')").get(e.id, req.user.id).c;
    return { id: e.id, name: e.name, date: e.date, lifecycle_state: e.lifecycle_state, health: health.status, attention_count: attention.length, my_tasks: myTasks, my_incidents: myInc };
  });
  const recent = cards.length ? db.prepare(`SELECT n.*, e.name AS event_name FROM operator_notes n JOIN events e ON e.id = n.event_id WHERE n.event_id IN (${cards.map(() => '?').join(',')}) ORDER BY n.id DESC LIMIT 20`).all(...cards.map((c) => c.id)) : [];
  res.json({ events: cards, recent_notes: recent });
});

// ---- Operator workload (admin): per-user open load across events ----
router.get('/operator/workload', requireAdmin, (req, res) => {
  res.json(db.prepare(`
    SELECT u.id, u.name,
      (SELECT COUNT(*) FROM tasks t JOIN user_events ue ON ue.event_id = t.event_id WHERE t.assignee_user_id = u.id AND t.status NOT IN ('COMPLETED','CANCELLED')) AS open_tasks,
      (SELECT COUNT(*) FROM incidents i JOIN user_events ue ON ue.event_id = i.event_id WHERE i.assignee_user_id = u.id AND i.status NOT IN ('RESOLVED','CLOSED')) AS open_incidents,
      (SELECT COUNT(*) FROM user_events WHERE user_id = u.id) AS event_count
    FROM users u WHERE u.status = 'active' ORDER BY open_tasks DESC, open_incidents DESC`).all());
});

// ---- Service quality (admin): per-event delivery signals, all from records ----
router.get('/operator/quality', requireAdmin, (req, res) => {
  const events = db.prepare('SELECT id, name, lifecycle_state FROM events ORDER BY date DESC LIMIT 50').all();
  res.json(events.map((e) => {
    const esc = db.prepare('SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND escalation_level > 0').get(e.id).c;
    const open = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')").get(e.id).c;
    const overdue = db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED') AND due_at IS NOT NULL AND due_at < datetime('now')").get(e.id).c;
    const avgResolve = db.prepare(`SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24 * 60) AS m FROM incidents
      WHERE event_id = ? AND resolved_at IS NOT NULL`).get(e.id).m;
    return { id: e.id, name: e.name, lifecycle_state: e.lifecycle_state, open_incidents: open, escalations: esc, overdue_tasks: overdue, avg_resolve_min: avgResolve !== null ? Math.round(avgResolve) : null };
  }));
});

// ---- Operator notes (INTERNAL default; CUSTOMER visible to event members) ----
// Event members with access see all notes (they're the delivery team);
// guests never reach this endpoint (no guest credential path exists for it).
router.get('/notes', requireEventAccess(), (req, res) => {
  res.json(db.prepare(`SELECT n.*, u.name AS author_name FROM operator_notes n LEFT JOIN users u ON u.id = n.author_id
    WHERE n.event_id = ? ORDER BY n.id DESC LIMIT 100`).all(req.eventId));
});

router.post('/notes', requireEventAccess(), (req, res) => {
  if (getLifecycle(Number(req.eventId)) === 'ARCHIVED') return res.status(409).json({ error: 'Event is ARCHIVED.' });
  const { body, visibility } = req.body;
  if (!body || !String(body).trim()) return res.status(400).json({ error: 'body is required' });
  const vis = visibility === 'CUSTOMER' ? 'CUSTOMER' : 'INTERNAL';
  const r = db.prepare('INSERT INTO operator_notes (event_id, author_id, body, visibility) VALUES (?, ?, ?, ?)')
    .run(req.eventId, req.user.id, String(body).trim().slice(0, 2000), vis);
  auditFromReq(req, { action: 'note.create', entityType: 'operator_notes', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { visibility: vis } });
  res.status(201).json(db.prepare('SELECT * FROM operator_notes WHERE id = ?').get(r.lastInsertRowid));
});

// ---- Break-glass: grant scoped emergency access (admin only, audited) ----
router.post('/break-glass', requireAdmin, (req, res) => {
  const { event_id, user_id, reason, minutes } = req.body;
  if (!event_id || !user_id || !reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'event_id, user_id and reason are required' });
  }
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(event_id);
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!event || !user) return res.status(404).json({ error: 'Event or user not found' });
  const mins = Math.min(Math.max(Number(minutes) || 60, 5), 24 * 60);
  const r = db.prepare(`INSERT INTO break_glass_grants (event_id, user_id, reason, expires_at, created_by)
    VALUES (?, ?, ?, datetime('now', ?), ?)`)
    .run(event_id, user_id, String(reason).trim().slice(0, 500), `+${mins} minutes`, req.user.id);
  auditFromReq(req, { action: 'breakglass.grant', entityType: 'break_glass_grants', entityId: r.lastInsertRowid, eventId: Number(event_id), metadata: { user_id, reason: String(reason).trim().slice(0, 200), minutes: mins } });
  res.status(201).json({ id: r.lastInsertRowid, event_id, user_id, minutes: mins });
});

router.post('/break-glass/:id/revoke', requireAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM break_glass_grants WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Grant not found' });
  db.prepare("UPDATE break_glass_grants SET revoked_at = datetime('now') WHERE id = ?").run(req.params.id);
  auditFromReq(req, { action: 'breakglass.revoke', entityType: 'break_glass_grants', entityId: req.params.id, eventId: g.event_id });
  res.json({ ok: true });
});

router.get('/break-glass', requireAdmin, (req, res) => {
  const { event_id } = req.query;
  const q = event_id
    ? db.prepare('SELECT * FROM break_glass_grants WHERE event_id = ? ORDER BY id DESC').all(event_id)
    : db.prepare('SELECT * FROM break_glass_grants ORDER BY id DESC LIMIT 100').all();
  res.json(q);
});

export default router;
