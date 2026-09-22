// RaaS Phase 2.2 — Event schedule / program (operational, not decorative).
// Plan vs Actual: planned_* vs actual_* stay distinct; overdue is derived.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, getLifecycle, applyStatus, opsGuard, nowDb,
  checkFresh} from './opsCommon.js';

const router = Router();
router.use(requireAuth);

function entityEventId(req) {
  const row = db.prepare('SELECT event_id FROM schedule_items WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

function shape(r) {
  if (!r) return r;
  const now = nowDb();
  const done = ['COMPLETED', 'CANCELLED'].includes(r.status);
  return {
    ...r,
    overdue: !done && r.planned_end && r.planned_end < now,
    upcoming: !done && r.planned_start && r.planned_start >= now,
  };
}

router.get('/', requireEventAccess(), requirePermission('schedule.view'), (req, res) => {
  const rows = db.prepare('SELECT s.*, u.name AS owner_name FROM schedule_items s LEFT JOIN users u ON u.id = s.owner_user_id WHERE s.event_id = ? ORDER BY s.planned_start ASC, s.sort_order ASC').all(req.eventId);
  res.json(rows.map(shape));
});

router.post('/', requireEventAccess(), requirePermission('schedule.manage'), opsGuard(true), withIdempotency((req, res) => {
  const { title, description, location, planned_start, planned_end, owner_user_id, priority, notes } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  if (owner_user_id) {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(owner_user_id);
    if (!u) return res.status(400).json({ error: 'Owner not found' });
  }
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM schedule_items WHERE event_id = ?').get(req.eventId).n;
  const r = db.prepare(`INSERT INTO schedule_items (event_id, title, description, location, planned_start, planned_end, owner_user_id, priority, sort_order, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, String(title).trim(), description || null, location || null, planned_start || null, planned_end || null,
      owner_user_id || null, priority || 'MEDIUM', maxOrder, notes || null, req.user.id);
  auditFromReq(req, { action: 'schedule.create', entityType: 'schedule_items', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(shape(db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(r.lastInsertRowid)));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('schedule.view'), (req, res) => {
  const row = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(shape(row));
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('schedule.manage'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { title, description, location, planned_start, planned_end, owner_user_id, priority, notes, sort_order } = req.body;
  db.prepare(`UPDATE schedule_items SET title=?, description=?, location=?, planned_start=?, planned_end=?, owner_user_id=?, priority=?, notes=?, sort_order=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?`)
    .run(title ?? row.title, description !== undefined ? description : row.description, location !== undefined ? location : row.location,
      planned_start !== undefined ? planned_start : row.planned_start, planned_end !== undefined ? planned_end : row.planned_end,
      owner_user_id !== undefined ? owner_user_id : row.owner_user_id, priority ?? row.priority,
      notes !== undefined ? notes : row.notes, sort_order ?? row.sort_order, req.params.id);
  auditFromReq(req, { action: 'schedule.update', entityType: 'schedule_items', entityId: req.params.id, eventId: req.eventId });
  res.json(shape(db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(req.params.id)));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('schedule.manage'), opsGuard(false), (req, res) => {
  const { to } = req.body;
  if (!applyStatus({ machine: 'schedule', table: 'schedule_items', id: req.params.id, to, eventId: req.eventId, req, res, auditAction: 'schedule.status' })) return;
  res.json(shape(db.prepare('SELECT * FROM schedule_items WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('schedule.manage'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM schedule_items WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'schedule.delete', entityType: 'schedule_items', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
