// RaaS Phase 2.8 — Transport coordination. Routes + passengers + driver.
// Simple operational visibility, not ride-hailing.

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
  const row = db.prepare('SELECT event_id FROM transport_routes WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/', requireEventAccess(), requirePermission('transport.view'), (req, res) => {
  const routes = db.prepare(`
    SELECT t.*, u.name AS driver_name, (SELECT COUNT(*) FROM transport_passengers p WHERE p.route_id = t.id) AS passenger_count
    FROM transport_routes t LEFT JOIN users u ON u.id = t.driver_user_id
    WHERE t.event_id = ? ORDER BY t.pickup_time ASC`).all(req.eventId);
  res.json(routes);
});

router.post('/', requireEventAccess(), requirePermission('transport.manage'), opsGuard(true), withIdempotency((req, res) => {
  const { name, pickup, destination, driver_user_id, vehicle, pickup_time, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (driver_user_id) {
    const u = db.prepare('SELECT id, role FROM users WHERE id = ?').get(driver_user_id);
    if (!u) return res.status(400).json({ error: 'Driver not found' });
    if (u.role !== 'admin' && !userHasEventAccess(u.id, 'staff', req.eventId)) return res.status(400).json({ error: 'Driver has no access to this event' });
  }
  const r = db.prepare(`INSERT INTO transport_routes (event_id, name, pickup, destination, driver_user_id, vehicle, pickup_time, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, String(name).trim(), pickup || null, destination || null, driver_user_id || null, vehicle || null, pickup_time || null, notes || null);
  auditFromReq(req, { action: 'transport.create', entityType: 'transport_routes', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(r.lastInsertRowid));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('transport.view'), (req, res) => {
  const row = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const passengers = db.prepare('SELECT p.*, g.name AS guest_name FROM transport_passengers p JOIN guests g ON g.id = p.guest_id WHERE p.route_id = ?').all(req.params.id);
  res.json({ ...row, passengers });
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('transport.manage'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { name, pickup, destination, driver_user_id, vehicle, pickup_time, notes } = req.body;
  db.prepare('UPDATE transport_routes SET name=?, pickup=?, destination=?, driver_user_id=?, vehicle=?, pickup_time=?, notes=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\',\'now\') WHERE id=?')
    .run(name ?? row.name, pickup !== undefined ? pickup : row.pickup, destination !== undefined ? destination : row.destination,
      driver_user_id !== undefined ? driver_user_id : row.driver_user_id, vehicle !== undefined ? vehicle : row.vehicle,
      pickup_time !== undefined ? pickup_time : row.pickup_time, notes !== undefined ? notes : row.notes, req.params.id);
  auditFromReq(req, { action: 'transport.update', entityType: 'transport_routes', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(req.params.id));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('transport.manage'), opsGuard(false), (req, res) => {
  const { to } = req.body;
  const extra = {};
  if (to === 'EN_ROUTE' || to === 'COMPLETED') extra.actual_pickup = new Date().toISOString().replace('T', ' ').split('.')[0];
  if (!applyStatus({ machine: 'transport', table: 'transport_routes', id: req.params.id, to, extra, eventId: req.eventId, req, res, auditAction: 'transport.status' })) return;
  res.json(db.prepare('SELECT * FROM transport_routes WHERE id = ?').get(req.params.id));
});

router.post('/:id/passengers', requireEntityEventAccess(entityEventId), requirePermission('transport.manage'), opsGuard(true), (req, res) => {
  const { guest_id } = req.body;
  if (!guest_id) return res.status(400).json({ error: 'guest_id is required' });
  const g = db.prepare('SELECT id, event_id FROM guests WHERE id = ?').get(guest_id);
  if (!g || g.event_id !== Number(req.eventId)) return res.status(400).json({ error: 'Guest not found in this event' });
  try {
    const r = db.prepare('INSERT INTO transport_passengers (route_id, guest_id) VALUES (?, ?)').run(req.params.id, guest_id);
    auditFromReq(req, { action: 'transport.passenger.add', entityType: 'transport_routes', entityId: req.params.id, eventId: req.eventId, metadata: { guest_id } });
    res.status(201).json({ id: r.lastInsertRowid, route_id: Number(req.params.id), guest_id });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Guest is already on this route' });
    throw e;
  }
});

router.delete('/:id/passengers/:guestId', requireEntityEventAccess(entityEventId), requirePermission('transport.manage'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM transport_passengers WHERE route_id = ? AND guest_id = ?').run(req.params.id, req.params.guestId);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'transport.passenger.remove', entityType: 'transport_routes', entityId: req.params.id, eventId: req.eventId, metadata: { guest_id: Number(req.params.guestId) } });
  res.json({ ok: true });
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('transport.manage'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM transport_routes WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'transport.delete', entityType: 'transport_routes', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
