// Guest Journey & Event Companion — connects existing blocks into one flow:
// invitation credential → identify → check-in → seat → services → staff.
// No new identity, no accounts, no parallel request/check-in systems.
// Every id (event/guest/seat/item) is server-resolved from the invitation
// token or staff session; client values are never trusted (§21).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess, requirePermission, userHasEventAccess } from '../middleware/authorize.js';
import { logAudit, auditFromReq } from '../audit.js';
import { getLifecycle, writePolicy } from '../raas/readiness.js';
import { lifecycleAllows } from '../raas/lifecycle.js';
import { resolveGuestInvite, extractInviteToken } from './guestInvites.js';
import { performInvitationCheckin, seatForGuest } from './qrCheckin.js';

const router = Router();

function rsvpPublic(rsvp) {
  if (!rsvp) return 'no_response';
  if (rsvp.status === 'CONFIRMED') return 'confirmed';
  if (rsvp.status === 'DECLINED') return 'declined';
  return 'no_response';
}

function checkinForGuest(eventId, guestId) {
  try {
    return db.prepare(`
      SELECT c.id, c.checked_in_at, c.method, a.name AS activity_name
      FROM checkins c JOIN activities a ON a.id = c.activity_id
      JOIN guests g ON g.id = c.guest_id
      WHERE g.event_id = ? AND c.guest_id = ?
      ORDER BY c.checked_in_at DESC LIMIT 1
    `).get(eventId, guestId) || null;
  } catch {
    return null;
  }
}

function seatLabel(seat) {
  if (!seat) return null;
  return seat.zone_name;
}

// Derived journey state (§7) — computed from source rows, never stored.
function journeyState({ rsvp, checkin, seat, assistOpen }) {
  if (seat && seat.seated_at) return 'SEATED';
  if (checkin && (seat || assistOpen)) return 'DIRECTED';
  if (checkin) return 'CHECKED_IN';
  if (rsvp) return 'RSVP_RESPONDED';
  return 'INVITED';
}

function openAssistRequest(eventId, guestId) {
  try {
    return db.prepare(
      "SELECT id FROM service_requests WHERE event_id = ? AND guest_id = ? AND category = 'SEATING_ASSISTANCE' AND status NOT IN ('FULFILLED','CLOSED','CANCELLED') LIMIT 1"
    ).get(eventId, guestId) || null;
  } catch {
    return null;
  }
}

// Resolve journey context or send the error. Returns ctx or null (responded).
function journeyContext(tokenPayload, res) {
  const raw = extractInviteToken(tokenPayload);
  if (!raw) {
    res.status(404).json({ error: 'Invitation not recognized.' });
    return null;
  }
  const r = resolveGuestInvite(raw);
  if (r.error) {
    res.status(r.status).json({ error: r.error });
    return null;
  }
  return r;
}

// ---- Identify: full guest context for the journey home ----
router.get('/journey/:token', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  const seat = seatForGuest(r.event.id, r.guest.id);
  const checkin = checkinForGuest(r.event.id, r.guest.id);
  const assist = openAssistRequest(r.event.id, r.guest.id);
  const openCount = db.prepare(
    "SELECT COUNT(*) AS c FROM service_requests WHERE event_id = ? AND guest_id = ? AND status NOT IN ('FULFILLED','CLOSED','CANCELLED')"
  ).get(r.event.id, r.guest.id).c;
  // Venue directory for wayfinding: names/kinds/locations only — no
  // occupancy, no guests. Mine is flagged; coordinates can extend this later.
  let venueZones = [];
  try {
    venueZones = db.prepare(`
      SELECT z.name AS zone_name, z.kind, z.location,
        CASE WHEN sa.guest_id IS NOT NULL THEN 1 ELSE 0 END AS mine
      FROM seating_zones z LEFT JOIN seat_assignments sa
        ON sa.zone_id = z.id AND sa.guest_id = ?
      WHERE z.event_id = ? AND z.kind IN ('TABLE','VIP','ACCESSIBLE','ZONE')
      ORDER BY z.name ASC
    `).all(r.guest.id, r.event.id);
  } catch {}
  res.json({
    event: { id: r.event.id, name: r.event.name, date: r.event.date, venue: r.event.venue, description: r.event.description },
    guest: { name: r.guest.name },
    rsvp_status: rsvpPublic(r.rsvp),
    checkin,
    seat,
    state: journeyState({ rsvp: r.rsvp, checkin, seat, assistOpen: !!assist }),
    open_request_count: openCount,
    venue_zones: venueZones,
    checkin_open: writePolicy(getLifecycle(r.event.id), 'checkin.perform').ok,
  });
});

// ---- One-tap check-in from the invitation link (same core as venue QR) ----
router.post('/guest-invite/:token/checkin', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  const out = performInvitationCheckin({ eventId: r.event.id, tokenPayload: req.params.token, method: 'SELF_SERVICE_QR', ip: req.ip });
  return res.status(out.status).json(out.body);
});

// ---- Guest confirms "I'm at my seat" (idempotent) ----
router.post('/journey/:token/seat-confirm', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  const seat = seatForGuest(r.event.id, r.guest.id);
  if (!checkinForGuest(r.event.id, r.guest.id)) {
    return res.status(409).json({ error: 'Check in first, then confirm your seat.', code: 'NOT_CHECKED_IN' });
  }
  if (!seat) {
    return res.status(409).json({ error: 'No seat assigned yet. Ask staff or request seating assistance.', code: 'NO_SEAT' });
  }
  if (seat.seated_at) return res.json({ ok: true, already: true, seat });
  db.prepare("UPDATE seat_assignments SET seated_at = datetime('now'), seated_via = 'GUEST', seated_by = NULL WHERE event_id = ? AND guest_id = ?")
    .run(r.event.id, r.guest.id);
  logAudit({
    eventId: r.event.id, actorId: null, action: 'seating.confirm', entityType: 'seat_assignments', entityId: `${r.event.id}:${r.guest.id}`,
    metadata: { via: 'GUEST', zone_id: seat.zone_id }, ip: req.ip || null,
  });
  res.json({ ok: true, seat: seatForGuest(r.event.id, r.guest.id) });
});

// ---- Staff confirms seating by scanning the guest pass (authed) ----
router.post('/seat-confirm', requireAuth, (req, res) => {
  const r = journeyContext(req.body?.token, res);
  if (!r) return;
  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, r.event.id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }
  const seat = seatForGuest(r.event.id, r.guest.id);
  if (!checkinForGuest(r.event.id, r.guest.id)) {
    return res.status(409).json({ error: 'Guest is not checked in.', code: 'NOT_CHECKED_IN' });
  }
  if (!seat) {
    return res.status(409).json({ error: 'Guest has no seat assignment.', code: 'NO_SEAT' });
  }
  if (seat.seated_at) return res.json({ ok: true, already: true, seat, guest_name: r.guest.name });
  db.prepare("UPDATE seat_assignments SET seated_at = datetime('now'), seated_via = 'STAFF', seated_by = ? WHERE event_id = ? AND guest_id = ?")
    .run(req.user.id, r.event.id, r.guest.id);
  auditFromReq(req, { action: 'seating.confirm', entityType: 'seat_assignments', entityId: `${r.event.id}:${r.guest.id}`, eventId: r.event.id, metadata: { via: 'STAFF', zone_id: seat.zone_id, guest_id: r.guest.id } });
  const checkin = checkinForGuest(r.event.id, r.guest.id);
  res.json({ ok: true, seat: seatForGuest(r.event.id, r.guest.id), guest_name: r.guest.name, rsvp_status: rsvpPublic(r.rsvp), checked_in_at: checkin?.checked_in_at || null });
});

// ---- Staff scan card: who is this guest + where do they sit (authed) ----
router.post('/seat-lookup', requireAuth, (req, res) => {
  const r = journeyContext(req.body?.token, res);
  if (!r) return;
  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, r.event.id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }
  res.json({
    guest_name: r.guest.name,
    rsvp_status: rsvpPublic(r.rsvp),
    checkin: checkinForGuest(r.event.id, r.guest.id),
    seat: seatForGuest(r.event.id, r.guest.id),
  });
});

// ---- Event service menu (organizer config; guests see available only) ----
function menuEventId(req) {
  const row = db.prepare('SELECT event_id FROM guest_service_menu WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/service-menu', requireAuth, requireEventAccess(), (req, res) => {
  res.json(db.prepare('SELECT * FROM guest_service_menu WHERE event_id = ? ORDER BY sort_order ASC, id ASC').all(req.eventId));
});

router.post('/service-menu', requireAuth, requireEventAccess(), requirePermission('event.update'), (req, res) => {
  const { label, kind, available, sort_order } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  const k = (kind || 'OTHER').toUpperCase();
  if (!['DRINK', 'BITE', 'ASSISTANCE', 'OTHER'].includes(k)) return res.status(400).json({ error: 'Invalid kind' });
  const lc = getLifecycle(req.eventId);
  if (lc === 'CLOSED' || lc === 'ARCHIVED') return res.status(409).json({ error: `Event is ${lc}. Menu is frozen.` });
  const r = db.prepare('INSERT INTO guest_service_menu (event_id, label, kind, available, sort_order) VALUES (?, ?, ?, ?, ?)')
    .run(req.eventId, String(label).trim().slice(0, 120), k, available === false ? 0 : 1, Number.isInteger(sort_order) ? sort_order : 0);
  auditFromReq(req, { action: 'menu.create', entityType: 'guest_service_menu', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { label, kind: k } });
  res.status(201).json(db.prepare('SELECT * FROM guest_service_menu WHERE id = ?').get(r.lastInsertRowid));
});

router.put('/service-menu/:id', requireAuth, requireEntityEventAccess(menuEventId), requirePermission('event.update'), (req, res) => {
  const row = db.prepare('SELECT * FROM guest_service_menu WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const { label, kind, available, sort_order } = req.body;
  const k = kind ? String(kind).toUpperCase() : row.kind;
  if (!['DRINK', 'BITE', 'ASSISTANCE', 'OTHER'].includes(k)) return res.status(400).json({ error: 'Invalid kind' });
  db.prepare("UPDATE guest_service_menu SET label = ?, kind = ?, available = ?, sort_order = ?, updated_at = datetime('now') WHERE id = ?")
    .run(label !== undefined ? String(label).trim().slice(0, 120) : row.label, k,
      available === undefined ? row.available : (available ? 1 : 0),
      sort_order !== undefined ? sort_order : row.sort_order, req.params.id);
  auditFromReq(req, { action: 'menu.update', entityType: 'guest_service_menu', entityId: req.params.id, eventId: req.eventId });
  res.json(db.prepare('SELECT * FROM guest_service_menu WHERE id = ?').get(req.params.id));
});

router.delete('/service-menu/:id', requireAuth, requireEntityEventAccess(menuEventId), requirePermission('event.update'), (req, res) => {
  const r = db.prepare('DELETE FROM guest_service_menu WHERE id = ?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Not found' });
  auditFromReq(req, { action: 'menu.delete', entityType: 'guest_service_menu', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

// ---- Guest: available menu (token-scoped, own event only) ----
router.get('/journey/:token/menu', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  res.json(db.prepare('SELECT id, label, kind, sort_order FROM guest_service_menu WHERE event_id = ? AND available = 1 ORDER BY sort_order ASC, id ASC').all(r.event.id));
});

// ---- Guest: create service request (token-scoped; seat/check-in resolved server-side) ----
router.post('/journey/:token/requests', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  const lc = getLifecycle(r.event.id);
  if (!writePolicy(lc, 'checkin.perform').ok) {
    return res.status(409).json({ error: `This event is ${lc}. Requests are unavailable.` });
  }
  const checkin = checkinForGuest(r.event.id, r.guest.id);
  if (!checkin) {
    return res.status(409).json({ error: 'Check in first, then request services.', code: 'NOT_CHECKED_IN' });
  }
  const { menu_item_id, category, note } = req.body || {};
  let item = null, cat = null, description = null;
  if (menu_item_id !== undefined && menu_item_id !== null) {
    item = db.prepare('SELECT * FROM guest_service_menu WHERE id = ? AND event_id = ?').get(menu_item_id, r.event.id);
    if (!item || !item.available) return res.status(404).json({ error: 'That service is not available.' });
    cat = item.kind;
    description = item.label;
  } else if (typeof category === 'string' && ['SEATING_ASSISTANCE', 'ASSISTANCE', 'OTHER'].includes(category.toUpperCase())) {
    cat = category.toUpperCase() === 'OTHER' ? 'OTHER' : category.toUpperCase();
    description = cat === 'SEATING_ASSISTANCE' ? 'Seating assistance' : 'General assistance';
  } else {
    return res.status(400).json({ error: 'menu_item_id or a valid category is required' });
  }
  if (typeof note === 'string' && note.trim()) description += ` — ${note.trim().slice(0, 200)}`;
  // Dedupe: one live request per guest + item/category (retries never duplicate).
  const dupe = db.prepare(`
    SELECT * FROM service_requests WHERE event_id = ? AND guest_id = ?
      AND category = ? AND description = ? AND status NOT IN ('FULFILLED','CLOSED','CANCELLED') LIMIT 1
  `).get(r.event.id, r.guest.id, cat, description);
  if (dupe) return res.json({ ok: true, duplicate: true, request: dupe });
  const seat = seatForGuest(r.event.id, r.guest.id);
  const ins = db.prepare(`
    INSERT INTO service_requests (event_id, requester_name, guest_id, category, priority, description, location, checkin_id, seat_label)
    VALUES (?, ?, ?, ?, 'MEDIUM', ?, ?, ?, ?)
  `).run(r.event.id, r.guest.name, r.guest.id, cat, description,
    seat?.location || seat?.zone_name || 'Entrance', checkin.id, seatLabel(seat));
  logAudit({
    eventId: r.event.id, actorId: null, action: 'request.create', entityType: 'service_requests', entityId: ins.lastInsertRowid,
    metadata: { guest_id: r.guest.id, category: cat, menu_item_id: item?.id || null, via: 'GUEST_JOURNEY' }, ip: req.ip || null,
  });
  res.status(201).json({ ok: true, request: db.prepare('SELECT * FROM service_requests WHERE id = ?').get(ins.lastInsertRowid) });
});

// ---- Guest: own requests + mapped status ----
const GUEST_STATUS = { OPEN: 'received', ASSIGNED: 'received', IN_PROGRESS: 'preparing', FULFILLED: 'delivered', CLOSED: 'delivered', CANCELLED: 'cancelled' };
router.get('/journey/:token/requests', (req, res) => {
  const r = journeyContext(req.params.token, res);
  if (!r) return;
  const rows = db.prepare(`
    SELECT id, category, description, status, updated_at, created_at FROM service_requests
    WHERE event_id = ? AND guest_id = ? ORDER BY created_at DESC LIMIT 20
  `).all(r.event.id, r.guest.id);
  res.json(rows.map((x) => ({ ...x, guest_status: GUEST_STATUS[x.status] || 'received' })));
});

export default router;
