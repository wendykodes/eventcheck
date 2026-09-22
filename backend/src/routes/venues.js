// RaaS Phase 6 — Venue management. Reusable org-scoped venues; events link
// via venue_id (free-text events.venue stays as backward-compatible display).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgAccess, requireOrgManager } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';

const router = Router();
router.use(requireAuth);

function venueOrgId(req) {
  const row = db.prepare('SELECT org_id FROM venues WHERE id = ?').get(req.params.id);
  return row && row.org_id ? row.org_id : null;
}

// Entity routes resolve the org from the venue row, then gate on membership.
function requireVenueOrg(req, res, next) {
  const orgId = venueOrgId(req);
  if (!orgId) return res.status(404).json({ error: 'Venue not found' });
  req.params.orgId = String(orgId);
  return requireOrgAccess()(req, res, next);
}

router.get('/', requireOrgAccess(), (req, res) => {
  const venues = db.prepare('SELECT v.*, (SELECT COUNT(*) FROM events WHERE venue_id = v.id) AS event_count FROM venues v WHERE v.org_id = ? ORDER BY v.name ASC').all(req.orgId);
  res.json(venues);
});

router.post('/', requireOrgAccess(), requireOrgManager(), (req, res) => {
  const { name, address, capacity, contact_name, contact_phone, notes } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  if (capacity !== undefined && capacity !== null && (!Number.isInteger(Number(capacity)) || Number(capacity) < 1)) {
    return res.status(400).json({ error: 'capacity must be a positive integer' });
  }
  const r = db.prepare('INSERT INTO venues (org_id, name, address, capacity, contact_name, contact_phone, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.orgId, String(name).trim(), address || null, capacity || null, contact_name || null, contact_phone || null, notes || null, req.user.id);
  auditFromReq(req, { action: 'venue.create', entityType: 'venues', entityId: r.lastInsertRowid, metadata: { org_id: req.orgId } });
  res.status(201).json(db.prepare('SELECT * FROM venues WHERE id = ?').get(r.lastInsertRowid));
});

router.get('/:id', requireVenueOrg, (req, res) => {
  const venue = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  const events = db.prepare('SELECT id, name, date, lifecycle_state FROM events WHERE venue_id = ? ORDER BY date DESC').all(req.params.id);
  res.json({ ...venue, events });
});

router.put('/:id', requireVenueOrg, requireOrgManager(), (req, res) => {
  const row = db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id);
  const { name, address, capacity, contact_name, contact_phone, notes } = req.body;
  db.prepare("UPDATE venues SET name=?, address=?, capacity=?, contact_name=?, contact_phone=?, notes=?, updated_at=datetime('now') WHERE id=?")
    .run(name !== undefined && String(name).trim() ? String(name).trim() : row.name,
      address !== undefined ? address : row.address, capacity !== undefined ? capacity : row.capacity,
      contact_name !== undefined ? contact_name : row.contact_name, contact_phone !== undefined ? contact_phone : row.contact_phone,
      notes !== undefined ? notes : row.notes, req.params.id);
  auditFromReq(req, { action: 'venue.update', entityType: 'venues', entityId: req.params.id, metadata: { org_id: req.orgId } });
  res.json(db.prepare('SELECT * FROM venues WHERE id = ?').get(req.params.id));
});

router.delete('/:id', requireVenueOrg, requireOrgManager(), (req, res) => {
  const linked = db.prepare('SELECT COUNT(*) AS c FROM events WHERE venue_id = ?').get(req.params.id).c;
  if (linked > 0) return res.status(409).json({ error: `Venue is linked to ${linked} event(s). Unlink first.` });
  db.prepare('DELETE FROM venues WHERE id = ?').run(req.params.id);
  auditFromReq(req, { action: 'venue.delete', entityType: 'venues', entityId: req.params.id, metadata: { org_id: req.orgId } });
  res.json({ ok: true });
});

export default router;
