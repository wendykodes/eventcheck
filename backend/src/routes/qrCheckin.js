// RaaS Phase 2 — QR Access & Dual Check-in (PATH A self-service + PATH B staff QR).
// PATH C manual fallback lives in checkins.js and is unchanged in behavior.
//
// Two QR concepts, kept separate:
//   Guest QR  = existing invitation token/URL (opaque, 192-bit, revocable).
//               Credential → Invitation → Guest → Check-in.
//   Venue QR  = events.self_checkin_code (opaque, 128-bit, rotatable).
//               Entry point → guest identifies with invitation → validation → check-in.
// The venue code alone grants nothing: no guest list, no counts, no privileged
// access. Check-in never reads-aside into RSVP writes: RSVP rows are only read
// for operational display, never created or mutated here.

import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireEventAccess, requirePermission, userHasEventAccess } from '../middleware/authorize.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { auditFromReq, logAudit } from '../audit.js';
import { getLifecycle, writePolicy } from '../raas/readiness.js';
import { lifecycleAllows } from '../raas/lifecycle.js';
import { resolveGuestInvite, extractInviteToken } from './guestInvites.js';

const router = Router();

function frontendBase(req) {
  const env = process.env.FRONTEND_URL;
  if (env) return env.replace(/\/$/, '');
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try { return new URL(origin).origin; } catch {}
  }
  return `${req.protocol}://${req.get('host').replace(/:3001$/, ':5173')}`;
}

function selfCheckinUrl(req, code) {
  return `${frontendBase(req)}/self-checkin/${code}`;
}

function rsvpPublic(rsvp) {
  if (!rsvp) return 'no_response';
  if (rsvp.status === 'CONFIRMED') return 'confirmed';
  if (rsvp.status === 'DECLINED') return 'declined';
  return 'no_response';
}

function rejected({ eventId, actorId, reason, method, invitationId = null, guestId = null, ip = null }) {
  logAudit({
    eventId, actorId: actorId || null, action: 'checkin.rejected',
    entityType: 'checkin', entityId: null,
    metadata: { reason, method, invitation_id: invitationId, guest_id: guestId },
    ip: ip || null,
  });
}

// Shared insert with backend-enforced uniqueness: concurrent duplicate scans
// collapse onto the existing row via the UNIQUE(guest_id, activity_id) index.
function insertCheckin({ guestId, activityId, staffId, method, invitationId }) {
  try {
    const r = db.prepare(
      'INSERT INTO checkins (guest_id, activity_id, staff_id, method, invitation_id) VALUES (?, ?, ?, ?, ?)'
    ).run(guestId, activityId, staffId, method, invitationId);
    return { id: r.lastInsertRowid, duplicate: false };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE constraint failed')) {
      return { id: null, duplicate: true };
    }
    throw e;
  }
}

function checkinRow(id) {
  return db.prepare(`
    SELECT c.id, c.guest_id, c.activity_id, c.staff_id, c.method, c.invitation_id, c.checked_in_at,
      g.name AS guest_name, a.name AS activity_name
    FROM checkins c JOIN guests g ON g.id = c.guest_id JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ?
  `).get(id);
}

function defaultActivity(eventId) {
  return db.prepare('SELECT id, event_id FROM activities WHERE event_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1').get(eventId) || null;
}

// ---- Venue QR management (event manager / RaaS operator) ----
router.get('/events/:eventId/checkin-qr', requireAuth, requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT id, name, lifecycle_state, self_checkin_code FROM events WHERE id = ?').get(req.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({
    event_id: event.id,
    code: event.self_checkin_code,
    url: selfCheckinUrl(req, event.self_checkin_code),
    checkin_open: checkinOpen(event.id),
  });
});

router.post('/events/:eventId/checkin-qr/rotate', requireAuth, requireEventAccess(), requirePermission('event.update'), (req, res) => {
  const code = crypto.randomBytes(16).toString('hex');
  db.prepare("UPDATE events SET self_checkin_code = ?, updated_at = datetime('now') WHERE id = ?").run(code, req.eventId);
  auditFromReq(req, { action: 'qr.venue.rotated', entityType: 'event', entityId: req.eventId, eventId: req.eventId });
  res.json({ event_id: req.eventId, code, url: selfCheckinUrl(req, code) });
});

function checkinOpen(eventId) {
  const lc = getLifecycle(eventId);
  return writePolicy(lc, 'checkin.perform').ok && (lifecycleAllows(lc, 'checkin') || lc === 'CLOSING');
}

// ---- PATH A: public self-check-in entry point ----
router.get('/self-checkin/:code', (req, res) => {
  const event = db.prepare('SELECT id, name, date, venue, description FROM events WHERE self_checkin_code = ?').get(req.params.code);
  if (!event) return res.status(404).json({ error: 'Check-in point not recognized.' });
  res.json({ event, checkin_open: checkinOpen(event.id) });
});

router.post('/self-checkin/:code/checkin', (req, res) => {
  const event = db.prepare('SELECT id, name, date, venue FROM events WHERE self_checkin_code = ?').get(req.params.code);
  if (!event) {
    rejected({ eventId: null, reason: 'UNKNOWN_VENUE_CODE', method: 'SELF_SERVICE_QR', ip: req.ip });
    return res.status(404).json({ error: 'Check-in point not recognized.' });
  }
  const raw = extractInviteToken(req.body?.token);
  if (!raw) {
    rejected({ eventId: event.id, reason: 'INVALID_CREDENTIAL', method: 'SELF_SERVICE_QR', ip: req.ip });
    return res.status(404).json({ error: 'Invitation not recognized. Please check the link from your invitation.' });
  }
  const r = resolveGuestInvite(raw);
  if (r.error) {
    rejected({ eventId: event.id, reason: r.status === 410 ? 'REVOKED_OR_EXPIRED' : 'INVALID_CREDENTIAL', method: 'SELF_SERVICE_QR', ip: req.ip });
    return res.status(r.status).json({ error: r.error });
  }
  if (r.inv.event_id !== event.id) {
    // Valid credential for a DIFFERENT event: reject without revealing it.
    rejected({ eventId: event.id, reason: 'WRONG_EVENT', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(403).json({ error: 'This invitation is not valid for this event.' });
  }
  const lc = getLifecycle(event.id);
  if (!writePolicy(lc, 'checkin.perform').ok || (!lifecycleAllows(lc, 'checkin') && lc !== 'CLOSING')) {
    rejected({ eventId: event.id, reason: 'LIFECYCLE_CLOSED', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(409).json({ error: `Check-in is not open for this event (${lc}). Please see staff.` });
  }
  const guest = db.prepare('SELECT id, event_id, name, status FROM guests WHERE id = ?').get(r.guest.id);
  if (!guest || guest.status !== 'approved') {
    rejected({ eventId: event.id, reason: 'GUEST_NOT_APPROVED', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(403).json({ error: 'This invitation cannot be used for check-in. Please see staff.' });
  }
  const activity = defaultActivity(event.id);
  if (!activity) {
    rejected({ eventId: event.id, reason: 'NO_CHECKIN_POINT', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: guest.id, ip: req.ip });
    return res.status(409).json({ error: 'Check-in is not ready yet. Please see staff.' });
  }
  const existing = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest.id, activity.id);
  if (existing) {
    rejected({ eventId: event.id, reason: 'ALREADY_CHECKED_IN', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: guest.id, ip: req.ip });
    return res.json({ ok: true, already: true, guest_name: guest.name, checked_in_at: existing.checked_in_at, rsvp_status: rsvpPublic(r.rsvp) });
  }
  const ins = insertCheckin({ guestId: guest.id, activityId: activity.id, staffId: null, method: 'SELF_SERVICE_QR', invitationId: r.inv.id });
  if (ins.duplicate) {
    const dup = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest.id, activity.id);
    rejected({ eventId: event.id, reason: 'ALREADY_CHECKED_IN', method: 'SELF_SERVICE_QR', invitationId: r.inv.id, guestId: guest.id, ip: req.ip });
    return res.json({ ok: true, already: true, guest_name: guest.name, checked_in_at: dup.checked_in_at, rsvp_status: rsvpPublic(r.rsvp) });
  }
  logAudit({
    eventId: event.id, actorId: null, action: 'checkin.perform', entityType: 'checkin', entityId: ins.id,
    metadata: { guest_id: guest.id, activity_id: activity.id, method: 'SELF_SERVICE_QR', invitation_id: r.inv.id, actor: 'guest' },
    ip: req.ip || null,
  });
  const row = checkinRow(ins.id);
  res.status(201).json({ ok: true, guest_name: guest.name, checked_in_at: row.checked_in_at, activity_name: row.activity_name, rsvp_status: rsvpPublic(r.rsvp) });
});

// ---- PATH B: staff scans guest invitation QR ----
router.post('/checkins/qr', requireAuth, withIdempotency((req, res) => {
  const raw = extractInviteToken(req.body?.token);
  const { activity_id } = req.body || {};
  if (!raw) return res.status(400).json({ error: 'A guest QR code or invitation token is required' });
  if (!activity_id) return res.status(400).json({ error: 'activity_id is required' });
  const r = resolveGuestInvite(raw);
  if (r.error) {
    // Staff-facing: state the reason class so the entrance can act on it.
    if (r.inv) {
      rejected({ eventId: r.inv.event_id, actorId: req.user.id, reason: r.status === 410 ? 'REVOKED_OR_EXPIRED' : 'INVALID_CREDENTIAL', method: 'STAFF_QR', invitationId: r.inv.id, ip: req.ip });
    }
    const code = r.status === 403 ? 403 : r.status;
    return res.status(code).json({ error: r.error, reason: r.status === 410 ? 'REVOKED_OR_EXPIRED' : r.status === 403 ? 'WRONG_EVENT' : 'INVALID_CREDENTIAL' });
  }
  const activity = db.prepare('SELECT id, event_id, name FROM activities WHERE id = ?').get(activity_id);
  if (!activity) return res.status(404).json({ error: 'Check-in point not found' });
  if (activity.event_id !== r.event.id) {
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'WRONG_EVENT', method: 'STAFF_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(400).json({ error: 'Guest and check-in point belong to different events', reason: 'WRONG_EVENT' });
  }
  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, r.event.id)) {
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'UNAUTHORIZED_STAFF', method: 'STAFF_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(403).json({ error: 'No access to this event', reason: 'UNAUTHORIZED_STAFF' });
  }
  const lc = getLifecycle(r.event.id);
  if (!writePolicy(lc, 'checkin.perform').ok || (!lifecycleAllows(lc, 'checkin') && lc !== 'CLOSING')) {
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'LIFECYCLE_CLOSED', method: 'STAFF_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(409).json({ error: `Check-in is not available while the event is ${lc}.`, reason: 'LIFECYCLE_CLOSED' });
  }
  const guest = db.prepare('SELECT id, event_id, name, status, guest_count, table_number FROM guests WHERE id = ?').get(r.guest.id);
  if (!guest || guest.status !== 'approved') {
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'GUEST_NOT_APPROVED', method: 'STAFF_QR', invitationId: r.inv.id, guestId: r.guest.id, ip: req.ip });
    return res.status(403).json({ error: 'Guest is not yet approved', reason: 'GUEST_NOT_APPROVED' });
  }
  const existing = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest.id, activity.id);
  if (existing) {
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'ALREADY_CHECKED_IN', method: 'STAFF_QR', invitationId: r.inv.id, guestId: guest.id, ip: req.ip });
    return res.status(409).json({ error: 'Already checked in', reason: 'ALREADY_CHECKED_IN', checkin: existing, guest_name: guest.name, rsvp_status: rsvpPublic(r.rsvp) });
  }
  const ins = insertCheckin({ guestId: guest.id, activityId: activity.id, staffId: req.user.id, method: 'STAFF_QR', invitationId: r.inv.id });
  if (ins.duplicate) {
    const dup = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest.id, activity.id);
    rejected({ eventId: r.event.id, actorId: req.user.id, reason: 'ALREADY_CHECKED_IN', method: 'STAFF_QR', invitationId: r.inv.id, guestId: guest.id, ip: req.ip });
    return res.status(409).json({ error: 'Already checked in', reason: 'ALREADY_CHECKED_IN', checkin: dup, guest_name: guest.name, rsvp_status: rsvpPublic(r.rsvp) });
  }
  auditFromReq(req, { action: 'checkin.perform', entityType: 'checkin', entityId: ins.id, eventId: r.event.id, metadata: { guest_id: guest.id, activity_id: activity.id, method: 'STAFF_QR', invitation_id: r.inv.id } });
  const row = checkinRow(ins.id);
  res.status(201).json({ ...row, guest: { id: guest.id, name: guest.name, guest_count: guest.guest_count, table_number: guest.table_number }, rsvp_status: rsvpPublic(r.rsvp) });
}));

export default router;
