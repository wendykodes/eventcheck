// RaaS Phase 2.7 — Vendors. Event operations, not a marketplace: who provides
// what, when they arrive, where they operate, and whether there's an issue.

import { Router } from 'express';
import db from '../database.js';
import {
  requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission,
  withIdempotency, auditFromReq, applyStatus, opsGuard,
  checkFresh} from './opsCommon.js';

const router = Router();
router.use(requireAuth);

function entityEventId(req) {
  const row = db.prepare('SELECT event_id FROM vendors WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/', requireEventAccess(), requirePermission('vendor.view'), (req, res) => {
  const { status } = req.query;
  let q = 'SELECT v.*, z.name AS zone_name FROM vendors v LEFT JOIN seating_zones z ON z.id = v.zone_id WHERE v.event_id = ?';
  const p = [req.eventId];
  if (status) { q += ' AND v.status = ?'; p.push(status); }
  q += ' ORDER BY v.arrival_time ASC, v.name ASC';
  res.json(db.prepare(q).all(...p));
});

router.post('/', requireEventAccess(), requirePermission('vendor.manage'), opsGuard(true), withIdempotency((req, res) => {
  const { name, service, contact_name, contact_phone, arrival_time, zone_id, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (zone_id) {
    const z = db.prepare('SELECT id FROM seating_zones WHERE id = ? AND event_id = ?').get(zone_id, req.eventId);
    if (!z) return res.status(400).json({ error: 'Zone not found in this event' });
  }
  const r = db.prepare(`INSERT INTO vendors (event_id, name, service, contact_name, contact_phone, arrival_time, zone_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.eventId, String(name).trim(), service || null, contact_name || null, contact_phone || null, arrival_time || null, zone_id || null, notes || null);
  auditFromReq(req, { action: 'vendor.create', entityType: 'vendors', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(r.lastInsertRowid));
}));

router.get('/:id', requireEntityEventAccess(entityEventId), requirePermission('vendor.view'), (req, res) => {
  const row = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

router.put('/:id', requireEntityEventAccess(entityEventId), requirePermission('vendor.manage'), opsGuard(false), (req, res) => {
  const row = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!checkFresh(row, req.body, res)) return;
  const { name, service, contact_name, contact_phone, arrival_time, zone_id, notes } = req.body;
  db.prepare('UPDATE vendors SET name=?, service=?, contact_name=?, contact_phone=?, arrival_time=?, zone_id=?, notes=?, updated_at=strftime(\'%Y-%m-%d %H:%M:%f\',\'now\') WHERE id=?')
    .run(name ?? row.name, service !== undefined ? service : row.service, contact_name !== undefined ? contact_name : row.contact_name,
      contact_phone !== undefined ? contact_phone : row.contact_phone, arrival_time !== undefined ? arrival_time : row.arrival_time,
      zone_id !== undefined ? zone_id : row.zone_id, notes !== undefined ? notes : row.notes, req.params.id);
  auditFromReq(req, { action: 'vendor.update', entityType: 'vendors', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id));
});

router.post('/:id/status', requireEntityEventAccess(entityEventId), requirePermission('vendor.manage'), opsGuard(false), (req, res) => {
  const { to } = req.body;
  const extra = {};
  if (to === 'ARRIVED') extra.actual_arrival = new Date().toISOString().replace('T', ' ').split('.')[0];
  if (!applyStatus({ machine: 'vendor', table: 'vendors', id: req.params.id, to, extra, eventId: req.eventId, req, res, auditAction: 'vendor.status' })) return;
  res.json(db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireEntityEventAccess(entityEventId), requirePermission('vendor.manage'), opsGuard(false), (req, res) => {
  const r = db.prepare('DELETE FROM vendors WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'vendor.delete', entityType: 'vendors', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

export default router;
