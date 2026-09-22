import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess, requirePermission, userHasEventAccess } from '../middleware/authorize.js';
import { getLifecycle, writePolicy } from '../raas/readiness.js';
import { lifecycleAllows } from '../raas/lifecycle.js';
import { withIdempotency } from '../middleware/idempotency.js';
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

router.post('/', withIdempotency((req, res) => {
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
  // Closure + lifecycle policy: check-in only while ACTIVE (or CLOSING late arrivals).
  const lc = getLifecycle(guest.event_id);
  const policy = writePolicy(lc, 'checkin.perform');
  if (!policy.ok) return res.status(409).json({ error: policy.error });
  if (!lifecycleAllows(lc, 'checkin') && lc !== 'CLOSING') {
    return res.status(409).json({ error: `Check-in is not available while the event is ${lc}.` });
  }
  if (guest.status !== 'approved') return res.status(403).json({ error: 'Guest is not yet approved' });
  const existing = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest_id, activity_id);
  if (existing) {
    return res.status(409).json({ error: 'Already checked in', checkin: existing });
  }
  const result = db.prepare("INSERT INTO checkins (guest_id, activity_id, staff_id, method, invitation_id) VALUES (?, ?, ?, 'MANUAL', ?)").run(
    guest_id, activity_id, req.user.id,
    db.prepare("SELECT id FROM invitations WHERE guest_id = ? AND event_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1").get(guest_id, guest.event_id)?.id || null,
  );
  const checkin = db.prepare(`
    SELECT c.*, u.name AS staff_name, g.name AS guest_name, g.guest_count, a.name AS activity_name
    FROM checkins c
    JOIN users u ON u.id = c.staff_id
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  auditFromReq(req, { action: 'checkin.perform', entityType: 'checkin', entityId: result.lastInsertRowid, eventId: guest.event_id, metadata: { guest_id, activity_id, method: 'MANUAL' } });
  res.status(201).json(checkin);
}));

router.delete('/:id', requireAdmin, requireEntityEventAccess(checkinEventId), (req, res) => {
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
  const result = db.prepare('DELETE FROM checkins WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Check-in not found' });
  auditFromReq(req, { action: 'checkin.revoke', entityType: 'checkin', entityId: req.params.id, eventId: req.eventId, metadata: row ? { guest_id: row.guest_id, activity_id: row.activity_id } : {} });
  res.json({ ok: true });
});

// Reason-based correction/override (Phase 2.10, P2-02). The original record is
// snapshotted into checkin_corrections — history is never silently mutated.
router.post('/:id/override', requireEntityEventAccess(checkinEventId), requirePermission('checkin.override'), (req, res) => {
  const { reason } = req.body;
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'A reason is required for check-in correction' });
  const lc = getLifecycle(req.eventId);
  if (lc === 'CLOSED' || lc === 'ARCHIVED') return res.status(409).json({ error: `Event is ${lc}. Corrections are disabled.` });
  const row = db.prepare('SELECT * FROM checkins WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Check-in not found' });
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO checkin_corrections (event_id, checkin_id, guest_id, activity_id, staff_id, checked_in_at, actor_id, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.eventId, row.id, row.guest_id, row.activity_id, row.staff_id, row.checked_in_at, req.user.id, String(reason).trim().slice(0, 500));
    db.prepare('DELETE FROM checkins WHERE id = ?').run(row.id);
  });
  tx();
  auditFromReq(req, { action: 'checkin.override', entityType: 'checkin', entityId: req.params.id, eventId: req.eventId, metadata: { guest_id: row.guest_id, activity_id: row.activity_id, reason: String(reason).trim().slice(0, 500) } });
  res.json({ ok: true });
});

router.get('/corrections', requireEventAccess(), requirePermission('checkin.view'), (req, res) => {
  res.json(db.prepare(`
    SELECT c.*, u.name AS actor_name, g.name AS guest_name FROM checkin_corrections c
    LEFT JOIN users u ON u.id = c.actor_id LEFT JOIN guests g ON g.id = c.guest_id
    WHERE c.event_id = ? ORDER BY c.created_at DESC`).all(req.eventId));
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
