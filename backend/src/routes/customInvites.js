// Custom invitations - public shareable URLs that authorize entry without needing a guest account
// Similar to QR system but with custom names, descriptions, and usage limits
import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { auditFromReq, logAudit } from '../audit.js';

const router = Router();

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
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

function customInviteLink(req, token) {
  return `${frontendBase(req)}/custom-invite/${token}`;
}

// ---- AUTHED: create custom invitation ----
router.post('/custom-invites', requireAuth, requireAdmin, (req, res) => {
  const { event_id, name, description, expires_hours, max_uses } = req.body;
  if (!event_id || !name) {
    return res.status(400).json({ error: 'event_id and name are required' });
  }

  const event = db.prepare('SELECT id, name FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const ttl = Math.min(Math.max(Number(expires_hours) || 720, 1), 8760); // 1 hour to 1 year
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString().replace('T', ' ').split('.')[0];
  const maxUses = Math.min(Math.max(Number(max_uses) || 1, 1), 1000);

  const raw = crypto.randomBytes(24).toString('hex'); // 192-bit token
  const ins = db.prepare(
    "INSERT INTO custom_invites (token, event_id, name, description, max_uses, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(raw, event_id, name, description || null, maxUses, expiresAt, req.user.id);

  const inviteId = ins.lastInsertRowid;

  // Create access token entry
  db.prepare(
    'INSERT INTO access_tokens (event_id, subject_type, subject_id, token_hash, scope_json, expires_at, single_use, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(event_id, 'custom_invite', inviteId, hashToken(raw), JSON.stringify({ custom_invite_id: inviteId }), expiresAt, 0, req.user.id);

  auditFromReq(req, { action: 'custom_invite.create', entityType: 'custom_invite', entityId: inviteId, eventId: Number(event_id), metadata: { name, max_uses, expires_at: expiresAt } });

  res.status(201).json({
    id: inviteId,
    token: raw,
    link: customInviteLink(req, raw),
    name,
    description,
    max_uses,
    expires_at: expiresAt,
    uses_used: 0
  });
});

// ---- AUTHED: send custom invite to guests (bulk) ----
router.post('/custom-invites/:id/send', requireAuth, requireAdmin, (req, res) => {
  const { guest_ids } = req.body;
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (invite.expires_at && invite.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
    return res.status(410).json({ error: 'This invitation has expired' });
  }

  if (!Array.isArray(guest_ids) || guest_ids.length === 0) {
    return res.status(400).json({ error: 'guest_ids array is required' });
  }

  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(invite.event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const out = [];
  const tx = db.transaction(() => {
    for (const gid of guest_ids) {
      const guest = db.prepare('SELECT id, event_id, name FROM guests WHERE id = ?').get(gid);
      if (!guest || guest.event_id !== invite.event_id) {
        out.push({ guest_id: gid, error: 'Guest not found in this event' });
        continue;
      }

      // Check if already sent
      const existing = db.prepare(
        'SELECT * FROM custom_invite_sends WHERE custom_invite_id = ? AND guest_id = ?'
      ).get(req.params.id, gid);
      
      if (existing) {
        out.push({ guest_id: gid, error: 'Already sent', existing: true });
        continue;
      }

      // Create send record
      db.prepare(
        'INSERT INTO custom_invite_sends (custom_invite_id, guest_id, sent_by) VALUES (?, ?, ?)'
      ).run(req.params.id, gid, req.user.id);

      out.push({ guest_id: gid, sent: true, guest_name: guest.name });
    }
  });
  tx();

  auditFromReq(req, { action: 'custom_invite.send_bulk', entityType: 'custom_invite', entityId: Number(req.params.id), eventId: invite.event_id, metadata: { requested: guest_ids.length, sent: out.filter(o => o.sent).length } });

  res.json({ custom_invite_id: req.params.id, results: out });
});

// ---- AUTHED: get send tracking for a custom invite ----
router.get('/custom-invites/:id/sends', requireAuth, requireAdmin, (req, res) => {
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });

  const rows = db.prepare(`
    SELECT s.id, s.guest_id, g.name AS guest_name, g.phone AS guest_phone,
           s.sent_at, s.opened_at, s.clicked_at, s.sent_by,
           u.name AS sent_by_name
    FROM custom_invite_sends s
    JOIN guests g ON g.id = s.guest_id
    LEFT JOIN users u ON u.id = s.sent_by
    WHERE s.custom_invite_id = ?
    ORDER BY s.sent_at DESC
  `).all(req.params.id);

  res.json(rows);
});

// ---- AUTHED: get custom invitation with media ----
router.get('/custom-invites/:id', requireAuth, requireAdmin, (req, res) => {
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });

  // Get media attached to this invite
  const media = db.prepare(`
    SELECT * FROM images 
    WHERE entity_type = 'custom_invite' AND entity_id = ?
    ORDER BY is_primary DESC, uploaded_at DESC
  `).all(req.params.id);

  res.json({ ...invite, media });
});

// ---- AUTHED: add media to custom invitation ----
router.post('/custom-invites/:id/media', requireAuth, requireAdmin, (req, res) => {
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });

  const { media_type, url, alt_text, is_primary } = req.body;
  if (!media_type || !url) {
    return res.status(400).json({ error: 'media_type and url are required' });
  }

  const result = db.prepare(`
    INSERT INTO images (entity_type, entity_id, url, alt_text, is_primary, media_type)
    VALUES ('custom_invite', ?, ?, ?, ?, ?)
  `).run(req.params.id, url, alt_text || null, is_primary ? 1 : 0, media_type);

  const media = db.prepare('SELECT * FROM images WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(media);
});

// ---- AUTHED: delete media from custom invitation ----
router.delete('/custom-invites/:id/media/:mediaId', requireAuth, requireAdmin, (req, res) => {
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });

  const media = db.prepare('SELECT * FROM images WHERE id = ? AND entity_type = ? AND entity_id = ?')
    .get(req.params.mediaId, 'custom_invite', req.params.id);
  if (!media) return res.status(404).json({ error: 'Media not found' });

  db.prepare('DELETE FROM images WHERE id = ?').run(req.params.mediaId);
  res.json({ ok: true });
});

// ---- AUTHED: list custom invitations for event ----
router.get('/custom-invites', requireAuth, requireEventAccess(), (req, res) => {
  const rows = db.prepare(`
    SELECT id, token, name, description, max_uses, uses_used, expires_at, created_at, status
    FROM custom_invites
    WHERE event_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(req.eventId);

  res.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    max_uses: r.max_uses,
    uses_used: r.uses_used,
    expires_at: r.expires_at,
    created_at: r.created_at,
    status: r.status,
    link: customInviteLink(req, r.token),
    card_link: `${frontendBase(req)}/custom-invite-card/${r.token}`
  })));
});

// ---- AUTHED: revoke custom invitation ----
router.post('/custom-invites/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const invite = db.prepare('SELECT * FROM custom_invites WHERE id = ?').get(req.params.id);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });

  db.prepare("UPDATE custom_invites SET status = 'revoked' WHERE id = ?").run(req.params.id);
  db.prepare("UPDATE access_tokens SET revoked_at = datetime('now') WHERE subject_type = 'custom_invite' AND subject_id = ?").run(req.params.id);

  auditFromReq(req, { action: 'custom_invite.revoke', entityType: 'custom_invite', entityId: Number(req.params.id), eventId: invite.event_id });

  res.json({ ok: true });
});

// ---- PUBLIC: resolve custom invitation ----
router.get('/custom-invite/:token', (req, res) => {
  const token = req.params.token;
  const invite = db.prepare('SELECT * FROM custom_invites WHERE token = ?').get(token);
  
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (invite.expires_at && invite.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
    return res.status(410).json({ error: 'This invitation has expired' });
  }
  if (invite.uses_used >= invite.max_uses) {
    return res.status(410).json({ error: 'This invitation has reached its maximum uses' });
  }

  const event = db.prepare("SELECT id, name, date, venue, description, lifecycle_state FROM events WHERE id = ?").get(invite.event_id);
  if (!event) return res.status(410).json({ error: 'This event no longer exists' });

  // Get media attached to this invite
  const media = db.prepare(`
    SELECT * FROM images 
    WHERE entity_type = 'custom_invite' AND entity_id = ?
    ORDER BY is_primary DESC, uploaded_at DESC
  `).all(invite.id);

  try {
    logAudit({ eventId: event.id, action: 'custom_invite.opened', entityType: 'custom_invite', entityId: invite.id, ip: req.ip || null });
  } catch {}

  res.json({
    invite: {
      id: invite.id,
      name: invite.name,
      description: invite.description,
      max_uses: invite.max_uses,
      uses_used: invite.uses_used,
      expires_at: invite.expires_at
    },
    event: {
      id: event.id,
      name: event.name,
      date: event.date,
      venue: event.venue,
      description: event.description,
      lifecycle_state: event.lifecycle_state
    },
    media,
    card_link: `${frontendBase(req)}/custom-invite-card/${token}`
  });
});

// ---- PUBLIC: use custom invitation to check in ----
router.post('/custom-invite/:token/checkin', (req, res) => {
  const token = req.params.token;
  const { guest_name, guest_phone } = req.body;

  const invite = db.prepare('SELECT * FROM custom_invites WHERE token = ?').get(token);
  if (!invite) return res.status(404).json({ error: 'Custom invitation not found' });
  if (invite.status === 'revoked') return res.status(410).json({ error: 'This invitation has been revoked' });
  if (invite.expires_at && invite.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
    return res.status(410).json({ error: 'This invitation has expired' });
  }
  if (invite.uses_used >= invite.max_uses) {
    return res.status(410).json({ error: 'This invitation has reached its maximum uses' });
  }

  // Create or find guest
  let guestId;
  const existingGuest = db.prepare('SELECT id FROM guests WHERE event_id = ? AND (phone = ? OR name = ?) AND status = "approved"').get(invite.event_id, guest_phone || null, guest_name);
  
  if (existingGuest) {
    guestId = existingGuest.id;
  } else {
    const guestIns = db.prepare(
      "INSERT INTO guests (event_id, name, phone, status, created_by) VALUES (?, ?, ?, 'approved', ?)"
    ).run(invite.event_id, guest_name, guest_phone || null, null);
    guestId = guestIns.lastInsertRowid;
  }

  // Check in the guest
  const activity = db.prepare('SELECT id FROM activities WHERE event_id = ? ORDER BY sequence ASC LIMIT 1').get(invite.event_id);
  if (!activity) return res.status(400).json({ error: 'No check-in activity found for this event' });

  db.prepare(`
    INSERT INTO checkins (guest_id, activity_id, event_id, checked_in_at, checked_in_by)
    VALUES (?, ?, ?, datetime('now'), ?)
  `).run(guestId, activity.id, invite.event_id, 'custom_invite');

  // Update usage count
  db.prepare("UPDATE custom_invites SET uses_used = uses_used + 1 WHERE id = ?").run(invite.id);

  logAudit({ eventId: invite.event_id, action: 'checkin.create', entityType: 'checkin', entityId: null, metadata: { guest_id: guestId, via: 'custom_invite', custom_invite_id: invite.id }, ip: req.ip || null });

  res.json({ ok: true, guest_id: guestId, uses_used: invite.uses_used + 1 });
});

export default router;
