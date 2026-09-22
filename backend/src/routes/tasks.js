// RaaS Phase 2.3 — Staff tasks. OPEN → ACCEPTED → IN_PROGRESS → COMPLETED
// (+ CANCELLED/BLOCKED). Assignees must have event access. "My Work" = list
// filtered by assignee. Duplicate completion is a safe no-op repeat.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, applyStatus, opsGuard, nowDb,
  checkFresh} from './opsCommon.js';
import { userHasEventAccess } from '../middleware/authorize.js';

const router = Router();
router.use(requireAuth);

function entityEventId(req) {
  const row = db.prepare('SELECT event_id FROM tasks WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

function shape(r) {
  if (!r) return r;
  const done = ['COMPLETED', 'CANCELLED'].includes(r.status);
  return { ...r, overdue: !done && r.due_at && r.due_at < nowDb() };
}

function checkAssignee(eventId, assignee_user_id) {
  if (!assignee_user_id) return null;
  const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(assignee_user_id);
  if (!u) return 'Assignee not found';
  if (u.role !== 'admin' && !userHasEventAccess(u.id, 'staff', eventId)) return 'Assignee has no access to this event';
  return null;
}

router.get('/', requireEventAccess(), requirePermission('task.view'), (req, res) => {
  const { assignee, status } = req.query;
  let q = 'SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.event_id = ?';
  const p = [req.eventId];
  if (assignee === 'me') { q += ' AND t.assignee_user_id = ?'; p.push(req.user.id); }
  else if (assignee) { q += ' AND t.assignee_user_id = ?'; p.push(assignee); }
  if (status) { q += ' AND t.status = ?'; p.push(status); }
  q += ' ORDER BY t.due_at ASC, t.created_at ASC';
  res.json(db.prepare(q).all(...p).map(shape));
});

router.post('/', requireEventAccess(), requirePermission('task.create'), opsGuard(true), withIdempotency((req, res) => {
  const { title, description, assignee_user_id, role_scope, zone, priority, due_at, notes } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  const err = checkAssignee(req.eventId, assignee_user_id);
  if (err) return res.status(400).json({ error: err });
  const r = db.prepare(`INSERT INTO tasks (event_id, title, description, assignee_user_id, role_scope, zone, priority, due_at, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, String(title).trim(), description || null, assignee_user_id || null, role_scope || null, zone || null,
      priority || 'MEDIUM', due_at || null, notes || null, req.user.id);
  auditFromReq(req, { action: 'task.create', entityType: 'tasks', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { assignee_user_id } });
  res.status(201).json(shape(db.prepare('SELECT * FROM tasks WHERE id = ?').get(r.lastInsertRowid)));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('task.view'), (req, res) => {
  const row = db.prepare('SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_user_id WHERE t.id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(shape(row));
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('task.update'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { title, description, assignee_user_id, role_scope, zone, priority, due_at, notes } = req.body;
  if (assignee_user_id !== undefined && assignee_user_id !== row.assignee_user_id) {
    const err = checkAssignee(req.eventId, assignee_user_id);
    if (err) return res.status(400).json({ error: err });
  }
  db.prepare(`UPDATE tasks SET title=?, description=?, assignee_user_id=?, role_scope=?, zone=?, priority=?, due_at=?, notes=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?`)
    .run(title ?? row.title, description !== undefined ? description : row.description,
      assignee_user_id !== undefined ? assignee_user_id : row.assignee_user_id,
      role_scope !== undefined ? role_scope : row.role_scope, zone !== undefined ? zone : row.zone,
      priority ?? row.priority, due_at !== undefined ? due_at : row.due_at, notes !== undefined ? notes : row.notes, req.params.id);
  auditFromReq(req, { action: 'task.update', entityType: 'tasks', entityId: req.params.id, eventId: req.eventId, metadata: { assignee_user_id } });
  res.json(shape(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('task.update'), opsGuard(false), (req, res) => {
  const { to } = req.body;
  if (!applyStatus({ machine: 'task', table: 'tasks', id: req.params.id, to, eventId: req.eventId, req, res, auditAction: 'task.status' })) return;
  res.json(shape(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

// Completion shortcut for staff with task.complete (idempotent: completing twice is fine).
router.post('/:id/complete', requireEntityEventAccess(entityEventId), requirePermission('task.complete'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status === 'COMPLETED') return res.json({ ...shape(row), unchanged: true });
  if (!applyStatus({ machine: 'task', table: 'tasks', id: req.params.id, to: 'COMPLETED', eventId: req.eventId, req, res, auditAction: 'task.complete' })) return;
  res.json(shape(db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('task.update'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'task.delete', entityType: 'tasks', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
