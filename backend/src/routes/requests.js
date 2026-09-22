// RaaS Phase 2.5 — Service requests. Structured guest/service asks so nothing
// disappears into chat. OPEN → ASSIGNED → IN_PROGRESS → FULFILLED → CLOSED.

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
  const row = db.prepare('SELECT event_id FROM service_requests WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/', requireEventAccess(), requirePermission('service_request.view'), (req, res) => {
  const { status, assignee } = req.query;
  let q = 'SELECT s.*, u.name AS assignee_name FROM service_requests s LEFT JOIN users u ON u.id = s.assignee_user_id WHERE s.event_id = ?';
  const p = [req.eventId];
  if (status) { q += ' AND s.status = ?'; p.push(status); }
  if (assignee === 'me') { q += ' AND s.assignee_user_id = ?'; p.push(req.user.id); }
  q += " ORDER BY CASE s.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, s.created_at ASC";
  res.json(db.prepare(q).all(...p));
});

router.post('/', requireEventAccess(), requirePermission('service_request.create'), opsGuard(true), withIdempotency((req, res) => {
  const { requester_name, guest_id, category, priority, description, location } = req.body;
  if (!description || !String(description).trim()) return res.status(400).json({ error: 'description is required' });
  if (guest_id) {
    const g = db.prepare('SELECT id, event_id FROM guests WHERE id = ?').get(guest_id);
    if (!g || g.event_id !== Number(req.eventId)) return res.status(400).json({ error: 'Guest not found in this event' });
  }
  const r = db.prepare(`INSERT INTO service_requests (event_id, requester_name, guest_id, category, priority, description, location)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, requester_name || null, guest_id || null, category || null, priority || 'MEDIUM', String(description).trim(), location || null);
  auditFromReq(req, { action: 'request.create', entityType: 'service_requests', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM service_requests WHERE id = ?').get(r.lastInsertRowid));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('service_request.view'), (req, res) => {
  const row = db.prepare('SELECT * FROM service_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('service_request.assign'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM service_requests WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { category, priority, description, location, assignee_user_id, resolution } = req.body;
  if (assignee_user_id !== undefined && assignee_user_id !== null) {
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(assignee_user_id);
    if (!u) return res.status(400).json({ error: 'Assignee not found' });
    if (u.role !== 'admin' && !userHasEventAccess(u.id, 'staff', req.eventId)) return res.status(400).json({ error: 'Assignee has no access to this event' });
  }
  db.prepare(`UPDATE service_requests SET category=?, priority=?, description=?, location=?, assignee_user_id=?, resolution=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?`)
    .run(category !== undefined ? category : row.category, priority ?? row.priority, description ?? row.description,
      location !== undefined ? location : row.location, assignee_user_id !== undefined ? assignee_user_id : row.assignee_user_id,
      resolution !== undefined ? resolution : row.resolution, req.params.id);
  if (assignee_user_id && row.status === 'OPEN') {
    db.prepare("UPDATE service_requests SET status = 'ASSIGNED', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  }
  auditFromReq(req, { action: 'request.update', entityType: 'service_requests', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM service_requests WHERE id = ?').get(req.params.id));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('service_request.fulfill'), opsGuard(false), (req, res) => {
  const { to, resolution } = req.body;
  const extra = (to === 'FULFILLED' || to === 'CLOSED') && resolution ? { resolution } : {};
  if (!applyStatus({ machine: 'request', table: 'service_requests', id: req.params.id, to, extra, eventId: req.eventId, req, res, auditAction: 'request.status' })) return;
  res.json(db.prepare('SELECT * FROM service_requests WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('service_request.assign'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM service_requests WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'request.delete', entityType: 'service_requests', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
