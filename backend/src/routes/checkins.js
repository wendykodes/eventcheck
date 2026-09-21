import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess, userHasEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';

const router = Router();

router.use(requireAuth);

function checkinEventId(req) {
  const row = db.prepare(`
    SELECT g.event_id AS gid, a.event_id AS aid FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ?
  `).get(req.params.id);
  if (!row) return null;
  if (row.gid !== row.aid) return row.gid;
  return row.gid;
}

function guestCheckinEventId(req) {
  const row = db.prepare('SELECT event_id FROM guests WHERE id = ?').get(req.params.guest_id);
  return row ? row.event_id : null;
}

function activityCheckinEventId(req) {
  const row = db.prepare('SELECT event_id FROM activities WHERE id = ?').get(req.params.activity_id);
  return row ? row.event_id : null;
}

router.post('/', (req, res) => {
  const { guest_id, activity_id } = req.body;
  if (!guest_id || !activity_id) {
    return res.status(400).json({ error: 'guest_id and activity_id are required' });
  }
  const guest = db.prepare('SELECT id, event_id, status FROM guests WHERE id = ?').get(guest_id);
  if (!guest) return res.status(404).json({ error: 'Guest not found' });
  const activity = db.prepare('SELECT id, event_id FROM activities WHERE id = ?').get(activity_id);
  if (!activity) return res.status(404).json({ error: 'Activity not found' });
  // Cross-event protection: guest and activity must belong to the same event.
  if (guest.event_id !== activity.event_id) {
    return res.status(400).json({ error: 'Guest and activity belong to different events' });
  }
  // Event isolation: staff must be assigned to the event.
  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, guest.event_id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }
  if (guest.status !== 'approved') return res.status(403).json({ error: 'Guest is not yet approved' });
  const existing = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest_id, activity_id);
  if (existing) {
    return res.status(409).json({ error: 'Already checked in', checkin: existing });
  }
  const result = db.prepare('INSERT INTO checkins (guest_id, activity_id, staff_id) VALUES (?, ?, ?)').run(guest_id, activity_id, req.user.id);
  const checkin = db.prepare(`
    SELECT c.*, u.name AS staff_name, g.name AS guest_name, g.guest_count, a.name AS activity_name
    FROM checkins c
    JOIN users u ON u.id = c.staff_id
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  auditFromReq(req, { action: 'checkin.perform', entityType: 'checkin', entityId: result.lastInsertRowid, eventId: guest.event_id, metadata: { guest_id, activity_id } });
  res.status(201).json(checkin);
});

router.delete('/:id', requireAdmin, requireEntityEventAccess(checkinEventId), (req, res) => {
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
  const result = db.prepare('DELETE FROM checkins WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Check-in not found' });
  auditFromReq(req, { action: 'checkin.revoke', entityType: 'checkin', entityId: req.params.id, eventId: req.eventId, metadata: row ? { guest_id: row.guest_id, activity_id: row.activity_id } : {} });
  res.json({ ok: true });
});

router.get('/guest/:guest_id', requireEntityEventAccess(guestCheckinEventId), (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, a.name AS activity_name, u.name AS staff_name
    FROM checkins c
    JOIN activities a ON a.id = c.activity_id
    JOIN users u ON u.id = c.staff_id
    WHERE c.guest_id = ?
    ORDER BY c.checked_in_at DESC
  `).all(req.params.guest_id);
  res.json(checkins);
});

router.get('/activity/:activity_id', requireEntityEventAccess(activityCheckinEventId), (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, g.name AS guest_name, g.phone, g.guest_count, g.table_number, u.name AS staff_name
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN users u ON u.id = c.staff_id
    WHERE c.activity_id = ?
    ORDER BY c.checked_in_at DESC
  `).all(req.params.activity_id);
  res.json(checkins);
});

export default router;
