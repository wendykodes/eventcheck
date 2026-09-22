// RaaS Phase 2.4 — Incidents. OPEN → ASSIGNED → IN_PROGRESS → RESOLVED → CLOSED.
// CRITICAL incidents surface via list filter + audit. Escalation bumps level.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, applyStatus, opsGuard,
  checkFresh} from './opsCommon.js';
import { userHasEventAccess } from '../middleware/authorize.js';

const router = Router();
router.use(requireAuth);

function entityEventId(req) {
  const row = db.prepare('SELECT event_id FROM incidents WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

function checkMember(eventId, userId, label) {
  if (!userId) return null;
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(userId);
  if (!u) return `${label} not found`;
  if (u.role !== 'admin' && !userHasEventAccess(u.id, 'staff', eventId)) return `${label} has no access to this event`;
  return null;
}

router.get('/', requireEventAccess(), requirePermission('incident.view'), (req, res) => {
  const { status, severity, critical } = req.query;
  let q = 'SELECT i.*, r.name AS reporter_name, a.name AS assignee_name FROM incidents i LEFT JOIN users r ON r.id = i.reporter_user_id LEFT JOIN users a ON a.id = i.assignee_user_id WHERE i.event_id = ?';
  const p = [req.eventId];
  if (critical) { q += " AND i.severity = 'CRITICAL' AND i.status NOT IN ('RESOLVED','CLOSED')"; }
  if (status) { q += ' AND i.status = ?'; p.push(status); }
  if (severity) { q += ' AND i.severity = ?'; p.push(severity); }
  q += ' ORDER BY CASE i.severity WHEN \'CRITICAL\' THEN 0 WHEN \'HIGH\' THEN 1 WHEN \'MEDIUM\' THEN 2 ELSE 3 END, i.created_at DESC';
  res.json(db.prepare(q).all(...p));
});

router.post('/', requireEventAccess(), requirePermission('incident.create'), opsGuard(true), withIdempotency((req, res) => {
  const { category, severity, title, description, location, assignee_user_id, notes } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  const err = checkMember(req.eventId, assignee_user_id, 'Assignee');
  if (err) return res.status(400).json({ error: err });
  const status = assignee_user_id ? 'ASSIGNED' : 'OPEN';
  const r = db.prepare(`INSERT INTO incidents (event_id, category, severity, title, description, location, reporter_user_id, assignee_user_id, status, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, category || null, severity || 'MEDIUM', String(title).trim(), description || null, location || null,
      req.user.id, assignee_user_id || null, status, notes || null);
  auditFromReq(req, { action: 'incident.create', entityType: 'incidents', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { severity: severity || 'MEDIUM' } });
  res.status(201).json(db.prepare('SELECT * FROM incidents WHERE id = ?').get(r.lastInsertRowid));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('incident.view'), (req, res) => {
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('incident.update'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { category, severity, title, description, location, assignee_user_id, resolution, notes } = req.body;
  if (assignee_user_id !== undefined && assignee_user_id !== row.assignee_user_id) {
    const err = checkMember(req.eventId, assignee_user_id, 'Assignee');
    if (err) return res.status(400).json({ error: err });
  }
  db.prepare(`UPDATE incidents SET category=?, severity=?, title=?, description=?, location=?, assignee_user_id=?, resolution=?, notes=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?`)
    .run(category !== undefined ? category : row.category, severity ?? row.severity, title ?? row.title,
      description !== undefined ? description : row.description, location !== undefined ? location : row.location,
      assignee_user_id !== undefined ? assignee_user_id : row.assignee_user_id,
      resolution !== undefined ? resolution : row.resolution, notes !== undefined ? notes : row.notes, req.params.id);
  // Auto-move OPEN → ASSIGNED when someone takes ownership.
  if (assignee_user_id && row.status === 'OPEN') {
    db.prepare("UPDATE incidents SET status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  }
  auditFromReq(req, { action: 'incident.update', entityType: 'incidents', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('incident.update'), opsGuard(false), (req, res) => {
  const { to, resolution } = req.body;
  const extra = {};
  if (to === 'RESOLVED' || to === 'CLOSED') {
    if (to === 'RESOLVED' && resolution) extra.resolution = resolution;
  }
  if (!applyStatus({ machine: 'incident', table: 'incidents', id: req.params.id, to, extra, eventId: req.eventId, req, res, auditAction: 'incident.status' })) return;
  res.json(db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id));
});

// Explicit escalation: level+1, timestamped, audited. Deterministic, no workflow engine.
router.post('/:id/escalate', requireEntityEventAccess(entityEventId), requirePermission('incident.assign'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (['RESOLVED', 'CLOSED'].includes(row.status)) return res.status(409).json({ error: 'Incident is already resolved' });
  const { assignee_user_id } = req.body;
  if (assignee_user_id) {
    const err = checkMember(req.eventId, assignee_user_id, 'Assignee');
    if (err) return res.status(400).json({ error: err });
  }
  db.prepare(`UPDATE incidents SET escalation_level = escalation_level + 1, escalated_at = datetime('now'),
    assignee_user_id = COALESCE(?, assignee_user_id),
    status = CASE WHEN status = 'OPEN' THEN 'ASSIGNED' ELSE status END,
    updated_at = datetime('now') WHERE id = ?`)
    .run(assignee_user_id || null, req.params.id);
  auditFromReq(req, { action: 'incident.escalate', entityType: 'incidents', entityId: req.params.id, eventId: req.eventId, metadata: { level: row.escalation_level + 1 } });
  res.json(db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('incident.update'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM incidents WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'incident.delete', entityType: 'incidents', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
