// RaaS Phase 1 — Readiness + final report (Workstreams 1 & 7, §6 §33-34).
// Report metrics are calculated from source records (single source of truth).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { getReadiness } from '../raas/readiness.js';
import { auditFromReq } from '../audit.js';

const router = Router();
router.use(requireAuth);

router.get('/event/:eventId/readiness', requireEventAccess(), (req, res) => {
  res.json(getReadiness(req.eventId));
});

router.get('/event/:eventId/report', requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT id, name, date, venue, lifecycle_state, status, template_key FROM events WHERE id = ?').get(req.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  // RSVP Ownership Rule: confirmed/declined come from rsvps rows keyed by
  // invitation; no_response = invited - confirmed - declined. Check-in is a
  // separate attendance domain and never overwrites RSVP.
  const invited = db.prepare(
    "SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'"
  ).get(req.eventId).c;
  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'DECLINED' THEN 1 ELSE 0 END) AS declined
    FROM rsvps WHERE event_id = ?
  `).get(req.eventId);
  const rsvp = {
    invited,
    confirmed: agg.confirmed || 0,
    declined: agg.declined || 0,
    no_response: Math.max(0, invited - (agg.confirmed || 0) - (agg.declined || 0)),
  };
  const checkedIn = db.prepare(
    'SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ? AND g.status = ?'
  ).get(req.eventId, 'approved').c;
  const totalPeople = db.prepare(
    "SELECT COALESCE(SUM(guest_count),0) AS c FROM guests WHERE event_id = ? AND status = 'approved'"
  ).get(req.eventId).c;
  const peopleIn = db.prepare(
    "SELECT COALESCE(SUM(g.guest_count),0) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id JOIN activities a ON a.id = c.activity_id WHERE g.event_id = ? AND a.event_id = ? AND g.status = 'approved'"
  ).get(req.eventId, req.eventId).c;
  // Attendance is calculated from the single checkins source of truth;
  // the method breakdown is a view over the same rows, never a second source.
  const methods = db.prepare(`
    SELECT
      SUM(CASE WHEN c.method = 'SELF_SERVICE_QR' THEN 1 ELSE 0 END) AS self_service_qr,
      SUM(CASE WHEN c.method = 'STAFF_QR' THEN 1 ELSE 0 END) AS staff_qr,
      SUM(CASE WHEN c.method = 'MANUAL' OR c.method IS NULL THEN 1 ELSE 0 END) AS manual
    FROM checkins c JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE g.event_id = ? AND a.event_id = ? AND g.status = 'approved'
  `).get(req.eventId, req.eventId);
  const incidents = { open: 0, resolved: 0 }; // Phase 2 module; report shape reserved.
  const checkinMethods = {
    self_service_qr: methods.self_service_qr || 0,
    staff_qr: methods.staff_qr || 0,
    manual: methods.manual || 0,
  };
  const report = {
    event,
    guests: rsvp,
    attendance: {
      checked_in: checkedIn,
      not_checked_in: Math.max(0, rsvp.invited - checkedIn),
      attendance_pct: rsvp.invited ? Math.round((checkedIn / rsvp.invited) * 100) : 0,
      people_expected: totalPeople,
      people_checked_in: peopleIn,
      methods: checkinMethods,
    },
    incidents,
    generated_at: new Date().toISOString(),
  };
  auditFromReq(req, { action: 'report.generate', entityType: 'event', entityId: req.eventId, eventId: req.eventId });
  res.json(report);
});

export default router;
