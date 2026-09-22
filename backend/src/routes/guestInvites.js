// RaaS Phase 1 — Guest invitations + RSVP + passwordless guest access.
// Workstreams 3/4/5 (§12-24). Guests need no account: secure link → event → RSVP.
//
// RSVP OWNERSHIP RULE (locked):
//   Invitation owns the RSVP. event_id is the mandatory isolation boundary,
//   guest_id identifies the responder. There is NO pending RSVP row — the
//   absence of an rsvps row means NO RESPONSE. Check-in is a separate domain
//   and never overwrites RSVP. Guest writes resolve via token → invitation →
//   guest → event (no rsvp.create.any). Staff/operator writes are
//   distinguishable via responded_via and auditable.

import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess } from '../middleware/authorize.js';
import { auditFromReq, logAudit } from '../audit.js';
import { getLifecycle } from '../raas/readiness.js';

const router = Router();

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Shared with qrCheckin.js: QR payloads may carry the raw token or the full
// invite URL — accept both, never trust anything else inside the QR.
export function extractInviteToken(payload) {
  if (typeof payload !== 'string') return null;
  const s = payload.trim();
  if (!s) return null;
  const m = s.match(/\/invite\/([A-Za-z0-9_-]+)\/?(?:\?.*)?$/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{16,256}$/.test(s)) return s;
  return null;
}

function frontendBase(req) {
  const env = process.env.FRONTEND_URL;
  if (env) return env.replace(/\/$/, '');
  const origin = req.headers.origin || req.headers.referer;
  if (origin) {
    try { return new URL(origin).origin; } catch {}
  }
  return `${req.protocol}://${req.get('host').replace(/:3001$/, ':5173')}`;
}

function guestLink(req, token) {
  return `${frontendBase(req)}/invite/${token}`;
}

// Canonical DB status is UPPERCASE; public API keeps lowercase for compat.
function toPublicStatus(dbStatus) {
  if (dbStatus === 'CONFIRMED') return 'confirmed';
  if (dbStatus === 'DECLINED') return 'declined';
  return 'no_response';
}

function getRsvp(invitationId) {
  try {
    return db.prepare('SELECT * FROM rsvps WHERE invitation_id = ?').get(invitationId) || null;
  } catch {
    return null;
  }
}

// Centralized RSVP write. Enforces: invitation↔guest↔event consistency,
// event-scope isolation, version increment, guest-cache sync, audit with
// actor distinction (responded_via). Returns { rsvp, created, previous }.
function writeRsvp({ inv, guest, event, statusUpper, via, note, attendeeCount, actorId, ip }) {
  if (inv.event_id !== guest.event_id || inv.event_id !== event.id || guest.id !== inv.guest_id) {
    const err = new Error('Invitation/guest/event mismatch');
    err.status = 403;
    throw err;
  }
  const existing = getRsvp(inv.id);
  const previous = existing ? toPublicStatus(existing.status) : 'no_response';
  const cleanNote = typeof note === 'string' && note.trim() ? note.trim().slice(0, 500) : null;
  let count = null;
  if (attendeeCount !== undefined && attendeeCount !== null && attendeeCount !== '') {
    count = Number(attendeeCount);
    if (!Number.isInteger(count) || count < 1) {
      const err = new Error('attendee_count must be a positive integer');
      err.status = 400;
      throw err;
    }
    // Party-size guard: an invitation for a single guest cannot claim 5 seats.
    const cap = Number.isFinite(Number(guest.guest_count)) ? Number(guest.guest_count) : 1;
    if (count > Math.max(1, cap)) {
      const err = new Error(`attendee_count exceeds party size (${Math.max(1, cap)})`);
      err.status = 400;
      throw err;
    }
  }
  const now = new Date().toISOString().replace('T', ' ').split('.')[0];
  let rsvp;
  if (!existing) {
    const ins = db.prepare(`
      INSERT INTO rsvps (event_id, invitation_id, guest_id, status, responded_at, responded_via, attendee_count, guest_note, response_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'), ?, ?, ?, 1, datetime('now'), datetime('now'))
    `).run(event.id, inv.id, guest.id, statusUpper, via, count, cleanNote);
    rsvp = db.prepare('SELECT * FROM rsvps WHERE id = ?').get(ins.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE rsvps SET status = ?, responded_at = datetime('now'), responded_via = ?,
        attendee_count = COALESCE(?, attendee_count),
        guest_note = COALESCE(?, guest_note),
        response_version = response_version + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(statusUpper, via, count, cleanNote, existing.id);
    rsvp = db.prepare('SELECT * FROM rsvps WHERE id = ?').get(existing.id);
  }
  // Sync deprecated guests.rsvp_* read-model cache (backward compat only).
  try {
    db.prepare("UPDATE guests SET rsvp_status = ?, rsvp_updated_at = datetime('now'), rsvp_note = COALESCE(?, rsvp_note) WHERE id = ?")
      .run(toPublicStatus(statusUpper), cleanNote, guest.id);
  } catch {}
  logAudit({
    eventId: event.id, actorId: actorId || null, action: 'rsvp.submit',
    entityType: 'rsvp', entityId: rsvp.id,
    metadata: {
      from: previous, to: toPublicStatus(statusUpper),
      invitation_id: inv.id, guest_id: guest.id,
      responded_via: via, response_version: rsvp.response_version,
      created: !existing,
    },
    ip: ip || null,
  });
  void now;
  return { rsvp, created: !existing, previous };
}

// Resolve + validate a guest invitation token. Returns {inv, guest, event, rsvp} or {error, status}.
// Exported for qrCheckin.js (staff QR + self-check-in resolve the same chain).
export function resolveGuestInvite(token) {
  const inv = db.prepare('SELECT * FROM invitations WHERE token = ?').get(token);
  if (!inv || !inv.guest_id) return { error: 'This invitation is invalid.', status: 404 };
  if (inv.status === 'revoked') return { error: 'This invitation has been revoked.', status: 410 };
  if (inv.status === 'accepted') return { error: 'This invitation has already been used.', status: 410 };
  if (inv.expires_at && inv.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
    return { error: 'This invitation has expired.', status: 410 };
  }
  // Hashed access-token row (when present) is the second gate: revocation/expiry enforced there too.
  const at = db.prepare('SELECT * FROM access_tokens WHERE token_hash = ?').get(hashToken(token));
  if (at) {
    if (at.revoked_at) return { error: 'This invitation has been revoked.', status: 410 };
    if (at.expires_at && at.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
      return { error: 'This invitation has expired.', status: 410 };
    }
    if (at.single_use && at.used_at) return { error: 'This invitation has already been used.', status: 410 };
  }
  const guest = db.prepare('SELECT id, event_id, name, guest_count FROM guests WHERE id = ?').get(inv.guest_id);
  if (!guest) return { error: 'This invitation is no longer valid.', status: 410 };
  if (guest.event_id !== inv.event_id) return { error: 'This invitation is invalid.', status: 403 };
  const event = db.prepare("SELECT id, name, date, venue, description, lifecycle_state FROM events WHERE id = ?").get(inv.event_id);
  if (!event) return { error: 'This event no longer exists.', status: 410 };
  return { inv, guest, event, rsvp: getRsvp(inv.id) };
}

// ---- PUBLIC: open invitation (marks opened, returns minimal event info) ----
router.get('/guest-invite/:token', (req, res) => {
  const r = resolveGuestInvite(req.params.token);
  if (r.error) return res.status(r.status).json({ error: r.error });
  if (!r.inv.opened_at) {
    try { db.prepare("UPDATE invitations SET opened_at = datetime('now') WHERE id = ?").run(r.inv.id); } catch {}
  }
  try {
    logAudit({ eventId: r.event.id, action: 'invite.opened', entityType: 'invitation', entityId: r.inv.id, ip: req.ip || null });
  } catch {}
  res.json({
    event: { id: r.event.id, name: r.event.name, date: r.event.date, venue: r.event.venue, description: r.event.description },
    guest: { name: r.guest.name },
    rsvp_status: r.rsvp ? toPublicStatus(r.rsvp.status) : 'no_response',
    rsvp: r.rsvp ? {
      status: toPublicStatus(r.rsvp.status),
      responded_at: r.rsvp.responded_at,
      attendee_count: r.rsvp.attendee_count,
    } : null,
    opened: true,
  });
});

// ---- PUBLIC: submit RSVP (idempotent; retry-safe; token-scoped, no global perm) ----
router.post('/guest-invite/:token/rsvp', (req, res) => {
  const r = resolveGuestInvite(req.params.token);
  if (r.error) return res.status(r.status).json({ error: r.error });
  const lifecycle = getLifecycle(r.event.id);
  if (lifecycle === 'CLOSED' || lifecycle === 'ARCHIVED') {
    return res.status(409).json({ error: 'This event is closed. RSVP is no longer available.' });
  }
  const { response, note, attendee_count } = req.body;
  const normalized = typeof response === 'string' ? response.trim().toUpperCase() : '';
  if (!['CONFIRMED', 'DECLINED'].includes(normalized)) {
    return res.status(400).json({ error: 'response must be confirmed or declined' });
  }
  const current = r.rsvp ? toPublicStatus(r.rsvp.status) : 'no_response';
  // Idempotent: identical repeat returns current state without new audit noise.
  if (current === normalized.toLowerCase()) {
    return res.json({ ok: true, rsvp_status: current, unchanged: true });
  }
  try {
    const { rsvp, previous } = writeRsvp({
      inv: r.inv, guest: r.guest, event: r.event,
      statusUpper: normalized, via: 'GUEST_LINK', note,
      attendeeCount: attendee_count, actorId: null, ip: req.ip || null,
    });
    res.json({ ok: true, rsvp_status: toPublicStatus(rsvp.status), previous });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Failed to record RSVP' });
  }
});

// ---- AUTHED (organizer): create guest invitations (idempotent per guest) ----
router.post('/guest-invites', requireAuth, requireAdmin, (req, res) => {
  const { event_id, guest_ids, ttl_hours } = req.body;
  if (!event_id || !Array.isArray(guest_ids) || guest_ids.length === 0) {
    return res.status(400).json({ error: 'event_id and guest_ids array are required' });
  }
  if (guest_ids.length > 500) return res.status(400).json({ error: 'Max 500 invitations per request' });
  const event = db.prepare('SELECT id, name FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const lifecycle = getLifecycle(event_id);
  if (lifecycle === 'CLOSED' || lifecycle === 'ARCHIVED' || lifecycle === 'CLOSING') {
    return res.status(409).json({ error: `Event is ${lifecycle}. Invitations are frozen.` });
  }
  const ttl = Math.min(Math.max(Number(ttl_hours) || 24 * 30, 1), 24 * 90);
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString().replace('T', ' ').split('.')[0];
  const out = [];
  const tx = db.transaction(() => {
    for (const gid of guest_ids) {
      const guest = db.prepare('SELECT id, event_id, name FROM guests WHERE id = ?').get(gid);
      if (!guest || guest.event_id !== Number(event_id)) {
        out.push({ guest_id: gid, error: 'Guest not found in this event' });
        continue;
      }
      // Idempotent: reuse a live pending invite for the same guest.
      const existing = db.prepare(
        "SELECT * FROM invitations WHERE guest_id = ? AND event_id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY id DESC LIMIT 1"
      ).get(gid, event_id);
      if (existing) {
        out.push({ guest_id: gid, token: null, reused: true, link: guestLink(req, existing.token), expires_at: existing.expires_at });
        continue;
      }
      const raw = crypto.randomBytes(24).toString('hex'); // 192-bit
      const ins = db.prepare(
        "INSERT INTO invitations (token, event_id, guest_id, role, status, created_by, expires_at) VALUES (?, ?, ?, 'staff', 'pending', ?, ?)"
      ).run(raw, event_id, gid, req.user.id, expiresAt);
      db.prepare(
        'INSERT INTO access_tokens (event_id, subject_type, subject_id, token_hash, scope_json, expires_at, single_use, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(event_id, 'guest', gid, hashToken(raw), JSON.stringify({ invitation_id: ins.lastInsertRowid }), expiresAt, 0, req.user.id);
      out.push({ guest_id: gid, token: raw, link: guestLink(req, raw), expires_at: expiresAt });
    }
  });
  tx();
  const created = out.filter((o) => o.token).length;
  auditFromReq(req, { action: 'invite.create', entityType: 'event', entityId: event_id, eventId: Number(event_id), metadata: { requested: guest_ids.length, created, reused: out.filter((o) => o.reused).length } });
  res.status(201).json({ event_id, invitations: out });
});

// ---- AUTHED: staff/organizer RSVP override (distinguishable from guest response) ----
function inviteEventId(req) {
  const row = db.prepare('SELECT event_id FROM invitations WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}
router.post('/guest-invites/:id/rsvp', requireAuth, requireEntityEventAccess(inviteEventId), (req, res) => {
  const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND guest_id IS NOT NULL').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Guest invitation not found' });
  if (inv.status === 'revoked') return res.status(410).json({ error: 'Invitation has been revoked' });
  const guest = db.prepare('SELECT id, event_id, name, guest_count FROM guests WHERE id = ?').get(inv.guest_id);
  if (!guest || guest.event_id !== inv.event_id) return res.status(403).json({ error: 'Invitation/guest mismatch' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(inv.event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const lifecycle = getLifecycle(inv.event_id);
  if (lifecycle === 'CLOSED' || lifecycle === 'ARCHIVED') {
    return res.status(409).json({ error: `Event is ${lifecycle}. RSVP is frozen.` });
  }
  const { response, note, attendee_count } = req.body;
  const normalized = typeof response === 'string' ? response.trim().toUpperCase() : '';
  if (!['CONFIRMED', 'DECLINED'].includes(normalized)) {
    return res.status(400).json({ error: 'response must be confirmed or declined' });
  }
  const via = req.user.role === 'admin' ? 'ORGANIZER' : 'STAFF';
  try {
    const { rsvp, previous, created } = writeRsvp({
      inv, guest, event: { id: inv.event_id },
      statusUpper: normalized, via, note,
      attendeeCount: attendee_count, actorId: req.user.id, ip: req.ip || null,
    });
    auditFromReq(req, { action: 'rsvp.override', entityType: 'rsvp', entityId: rsvp.id, eventId: inv.event_id, metadata: { from: previous, to: toPublicStatus(rsvp.status), invitation_id: inv.id, responded_via: via } });
    res.json({ ok: true, rsvp_status: toPublicStatus(rsvp.status), previous, created, responded_via: via });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Failed to record RSVP' });
  }
});

// ---- AUTHED: organizer invite list (guest-level detail w/ RSVP + check-in state) ----
// RSVP derived from rsvps table; absence = no_response. Check-in counted
// separately and never merged into RSVP state.
router.get('/guest-invites', requireAuth, requireEventAccess(), (req, res) => {
  const rows = db.prepare(`
    SELECT g.id AS guest_id, g.name, g.phone,
      CASE WHEN r.status = 'CONFIRMED' THEN 'confirmed'
           WHEN r.status = 'DECLINED' THEN 'declined'
           ELSE 'no_response' END AS rsvp_status,
      r.responded_at AS rsvp_updated_at, r.responded_via, r.attendee_count,
      i.id AS invitation_id, i.status AS invite_status, i.expires_at, i.opened_at,
      (SELECT COUNT(*) FROM checkins c WHERE c.guest_id = g.id) AS checkin_count
    FROM guests g
    LEFT JOIN invitations i ON i.guest_id = g.id AND i.event_id = g.event_id AND i.status = 'pending'
    LEFT JOIN rsvps r ON r.invitation_id = i.id
    WHERE g.event_id = ? AND g.status = 'approved'
    ORDER BY g.name ASC
  `).all(req.eventId);
  // Fallback: legacy guests.rsvp_status cache for rows whose invitation was
  // replaced (backfill window). Source of truth remains rsvps.
  const legacy = db.prepare("SELECT id, rsvp_status FROM guests WHERE event_id = ? AND status = 'approved'").all(req.eventId);
  const legacyById = new Map(legacy.map((g) => [g.guest_id ?? g.id, g.rsvp_status]));
  res.json(rows.map((r) => {
    const status = r.invitation_id ? r.rsvp_status : (legacyById.get(r.guest_id) || 'no_response');
    return { ...r, rsvp_status: status, token: undefined, link: r.invitation_id ? null : null };
  }));
});

// ---- AUTHED: RSVP summary (counts for organizer dashboard) ----
// invited = approved guests; confirmed/declined = rsvps rows; no_response =
// invited - confirmed - declined (never a stored PENDING row).
router.get('/rsvp-summary', requireAuth, requireEventAccess(), (req, res) => {
  const invited = db.prepare(
    "SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'"
  ).get(req.eventId).c;
  const agg = db.prepare(`
    SELECT
      SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN r.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined
    FROM rsvps r WHERE r.event_id = ?
  `).get(req.eventId);
  const confirmed = agg.confirmed || 0;
  const declined = agg.declined || 0;
  const opened = db.prepare(
    "SELECT COUNT(*) AS c FROM invitations WHERE event_id = ? AND guest_id IS NOT NULL AND opened_at IS NOT NULL AND status = 'pending'"
  ).get(req.eventId).c;
  const checkedIn = db.prepare(
    'SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?'
  ).get(req.eventId).c;
  res.json({ event_id: req.eventId, invited, confirmed, declined, no_response: Math.max(0, invited - confirmed - declined), opened, checked_in: checkedIn });
});

// ---- AUTHED: resend (extend expiry + new link) ----
router.post('/guest-invites/:id/resend', requireAuth, requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND guest_id IS NOT NULL').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Guest invitation not found' });
  if (inv.status !== 'pending') return res.status(409).json({ error: 'Only pending invitations can be resent' });
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().replace('T', ' ').split('.')[0];
  db.prepare("UPDATE invitations SET expires_at = ? WHERE id = ?").run(expiresAt, inv.id);
  db.prepare('UPDATE access_tokens SET expires_at = ?, revoked_at = NULL WHERE token_hash = ?').run(expiresAt, hashToken(inv.token));
  auditFromReq(req, { action: 'invite.resend', entityType: 'invitation', entityId: inv.id, eventId: inv.event_id });
  res.json({ ok: true, link: guestLink(req, inv.token), expires_at: expiresAt });
});

// ---- AUTHED: revoke (both gates) ----
router.post('/guest-invites/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const inv = db.prepare('SELECT * FROM invitations WHERE id = ? AND guest_id IS NOT NULL').get(req.params.id);
  if (!inv) return res.status(404).json({ error: 'Guest invitation not found' });
  db.prepare("UPDATE invitations SET status = 'revoked' WHERE id = ?").run(inv.id);
  db.prepare("UPDATE access_tokens SET revoked_at = datetime('now') WHERE token_hash = ?").run(hashToken(inv.token));
  auditFromReq(req, { action: 'invite.revoke', entityType: 'invitation', entityId: inv.id, eventId: inv.event_id });
  res.json({ ok: true });
});

export default router;
