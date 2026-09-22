// RaaS Phase 2.6 — Seating zones + assignments. Operational correctness over
// drag-and-drop: capacity enforced, one seat per guest, VIP via zone kind.
// Check-in reads assignments; reassignment is explicit (?move=1) and audited.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, opsGuard,
  checkFresh} from './opsCommon.js';

const router = Router();
router.use(requireAuth);

function zoneEventId(req) {
  const row = db.prepare('SELECT event_id FROM seating_zones WHERE id = ?').get(req.params.id || req.params.zoneId);
  return row ? row.event_id : null;
}

router.get('/zones', requireEventAccess(), requirePermission('seating.view'), (req, res) => {
  const zones = db.prepare(`
    SELECT z.*, COUNT(sa.id) AS seated,
      CASE WHEN z.capacity IS NOT NULL THEN COUNT(sa.id) || '/' || z.capacity ELSE COUNT(sa.id) || '' END AS occupancy
    FROM seating_zones z LEFT JOIN seat_assignments sa ON sa.zone_id = z.id
    WHERE z.event_id = ? GROUP BY z.id ORDER BY z.name ASC`).all(req.eventId);
  res.json(zones);
});

router.post('/zones', requireEventAccess(), requirePermission('seating.assign'), opsGuard(true), withIdempotency((req, res) => {
  const { name, kind, capacity, location, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (capacity !== undefined && capacity !== null && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) {
    return res.status(400).json({ error: 'capacity must be a positive integer' });
  }
  const r = db.prepare('INSERT INTO seating_zones (event_id, name, kind, capacity, location, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.eventId, String(name).trim(), kind || 'TABLE', capacity || null, location || null, notes || null);
  auditFromReq(req, { action: 'seating.zone.create', entityType: 'seating_zones', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM seating_zones WHERE id = ?').get(r.lastInsertRowid));
}));

router.put('/zones/:id', requireEntityEventAccess(zoneEventId), requirePermission('seating.assign'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM seating_zones WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { name, kind, capacity, location, notes } = req.body;
  if (capacity !== undefined && capacity !== null) {
    const seated = db.prepare('SELECT COUNT(*) AS c FROM seat_assignments WHERE zone_id = ?').get(req.params.id).c;
    if (Number(capacity) < seated) return res.status(409).json({ error: `Capacity ${capacity} below current occupancy ${seated}` });
  }
  db.prepare("UPDATE seating_zones SET name=?, kind=?, capacity=?, location=?, notes=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE id=?")
    .run(name ?? row.name, kind ?? row.kind, capacity !== undefined ? capacity : row.capacity,
      location !== undefined ? location : row.location, notes !== undefined ? notes : row.notes, req.params.id);
  auditFromReq(req, { action: 'seating.zone.update', entityType: 'seating_zones', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM seating_zones WHERE id = ?').get(req.params.id));
});

router.delete('/zones/:id', requireEntityEventAccess(zoneEventId), requirePermission('seating.assign'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM seating_zones WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'seating.zone.delete', entityType: 'seating_zones', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

// Assignments: one seat per guest per event. POST /assign {zone_id, guest_id[, move]}.
router.get('/assignments', requireEventAccess(), requirePermission('seating.view'), (req, res) => {
  res.json(db.prepare(`
    SELECT sa.*, g.name AS guest_name, z.name AS zone_name, z.kind FROM seat_assignments sa
    JOIN guests g ON g.id = sa.guest_id JOIN seating_zones z ON z.id = sa.zone_id
    WHERE sa.event_id = ? ORDER BY z.name ASC, g.name ASC`).all(req.eventId));
});

router.post('/assign', requireEventAccess(), requirePermission('seating.assign'), opsGuard(true), withIdempotency((req, res) => {
  const { zone_id, guest_id, move } = req.body;
  if (!zone_id || !guest_id) return res.status(400).json({ error: 'zone_id and guest_id are required' });
  const zone = db.prepare('SELECT * FROM seating_zones WHERE id = ? AND event_id = ?').get(zone_id, req.eventId);
  if (!zone) return res.status(404).json({ error: 'Zone not found in this event' });
  const guest = db.prepare('SELECT id, event_id FROM guests WHERE id = ?').get(guest_id);
  if (!guest || guest.event_id !== Number(req.eventId)) return res.status(400).json({ error: 'Guest not found in this event' });
  const existing = db.prepare('SELECT * FROM seat_assignments WHERE event_id = ? AND guest_id = ?').get(req.eventId, guest_id);
  if (existing && existing.zone_id !== Number(zone_id)) {
    if (!move) return res.status(409).json({ error: 'Guest already seated elsewhere. Pass move=true to reassign.', assignment: existing });
    db.prepare('DELETE FROM seat_assignments WHERE id = ?').run(existing.id);
    auditFromReq(req, { action: 'seating.unassign', entityType: 'seat_assignments', entityId: existing.id, eventId: req.eventId, metadata: { guest_id, from_zone: existing.zone_id } });
  }
  if (zone.capacity) {
    const seated = db.prepare('SELECT COUNT(*) AS c FROM seat_assignments WHERE zone_id = ?').get(zone_id).c;
    if (seated >= zone.capacity) return res.status(409).json({ error: `Zone ${zone.name} is full (${seated}/${zone.capacity})` });
  }
  try {
    const r = db.prepare('INSERT INTO seat_assignments (event_id, zone_id, guest_id) VALUES (?, ?, ?)').run(req.eventId, zone_id, guest_id);
    auditFromReq(req, { action: move ? 'seating.reassign' : 'seating.assign', entityType: 'seat_assignments', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { guest_id, zone_id } });
    res.status(201).json(db.prepare('SELECT * FROM seat_assignments WHERE id = ?').get(r.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'Guest is already seated here' });
    throw e;
  }
}));

router.delete('/assign/:guestId', requireEventAccess(), requirePermission('seating.assign'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM seat_assignments WHERE event_id = ? AND guest_id = ?').get(req.eventId, req.params.guestId);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  db.prepare('DELETE FROM seat_assignments WHERE id = ?').run(row.id);
  auditFromReq(req, { action: 'seating.unassign', entityType: 'seat_assignments', entityId: row.id, eventId: req.eventId, metadata: { guest_id: row.guest_id } });
  res.json({ ok: true });
});

export default router;
