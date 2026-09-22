// RaaS Phase 2.9 — Accommodation (optional module). Locations/rooms, guest
// assignment, check-in/out, transport linkage. Events that don't need it
// simply never create rows — no complexity leaks elsewhere.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, opsGuard,
  checkFresh} from './opsCommon.js';

const router = Router();
router.use(requireAuth);

function entityEventId(req) {
  const row = db.prepare('SELECT event_id FROM accommodations WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/', requireEventAccess(), requirePermission('accommodation.view'), (req, res) => {
  res.json(db.prepare(`
    SELECT a.*, g.name AS guest_name FROM accommodations a
    LEFT JOIN guests g ON g.id = a.guest_id
    WHERE a.event_id = ? ORDER BY a.name ASC, a.room ASC`).all(req.eventId));
});

router.post('/', requireEventAccess(), requirePermission('accommodation.manage'), opsGuard(true), withIdempotency((req, res) => {
  const { name, location, room, guest_id, check_in, check_out, notes, transport_route_id } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (guest_id) {
    const g = db.prepare('SELECT id, event_id FROM guests WHERE id = ?').get(guest_id);
    if (!g || g.event_id !== Number(req.eventId)) return res.status(400).json({ error: 'Guest not found in this event' });
  }
  if (transport_route_id) {
    const t = db.prepare('SELECT id, event_id FROM transport_routes WHERE id = ?').get(transport_route_id);
    if (!t || t.event_id !== Number(req.eventId)) return res.status(400).json({ error: 'Transport route not found in this event' });
  }
  const r = db.prepare(`INSERT INTO accommodations (event_id, name, location, room, guest_id, check_in, check_out, notes, transport_route_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, String(name).trim(), location || null, room || null, guest_id || null, check_in || null, check_out || null, notes || null, transport_route_id || null);
  auditFromReq(req, { action: 'stay.create', entityType: 'accommodations', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM accommodations WHERE id = ?').get(r.lastInsertRowid));
}));

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('accommodation.manage'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM accommodations WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { name, location, room, guest_id, check_in, check_out, notes, transport_route_id } = req.body;
  db.prepare('UPDATE accommodations SET name=?, location=?, room=?, guest_id=?, check_in=?, check_out=?, notes=?, transport_route_id=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\',\'now\') WHERE id=?')
    .run(name ?? row.name, location !== undefined ? location : row.location, room !== undefined ? room : row.room,
      guest_id !== undefined ? guest_id : row.guest_id, check_in !== undefined ? check_in : row.check_in,
      check_out !== undefined ? check_out : row.check_out, notes !== undefined ? notes : row.notes,
      transport_route_id !== undefined ? transport_route_id : row.transport_route_id, req.params.id);
  auditFromReq(req, { action: 'stay.update', entityType: 'accommodations', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM accommodations WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('accommodation.manage'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM accommodations WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'stay.delete', entityType: 'accommodations', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
