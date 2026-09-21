// RaaS Phase 0 — Universal event engine routes.
// Events are configured instances of templates, with explicit lifecycle.
// All event-scoped reads enforce membership (event isolation, spec §27).

import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { LIFECYCLE_STATES, canTransition, lifecycleToLegacyStatus } from '../raas/lifecycle.js';
import { EVENT_ROLES } from '../raas/permissions.js';

const router = Router();

router.use(requireAuth);

function shapeEvent(row) {
  if (!row) return row;
  let config = {};
  try { config = row.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  return { ...row, config };
}

router.get('/', (req, res) => {
  let events;
  if (req.user.role === 'admin') {
    events = db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  } else {
    events = db.prepare(`
      SELECT e.* FROM events e
      JOIN user_events ue ON ue.event_id = e.id
      WHERE ue.user_id = ?
      ORDER BY e.date DESC
    `).all(req.user.id);
  }
  res.json(events.map(shapeEvent));
});

router.get('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  // Event isolation: non-admins must be assigned to the event.
  if (req.user.role !== 'admin') {
    const link = db.prepare('SELECT 1 FROM user_events WHERE user_id = ? AND event_id = ?').get(req.user.id, req.params.id);
    const role = db.prepare('SELECT 1 FROM event_user_roles WHERE user_id = ? AND event_id = ?').get(req.user.id, req.params.id);
    if (!link && !role) return res.status(403).json({ error: 'No access to this event' });
  }
  res.json(shapeEvent(event));
});

router.post('/', requireAdmin, (req, res) => {
  try {
    const { name, date, venue, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, lifecycle_state } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Event name is required' });
    // Validate template_key against seeded templates; fall back to default.
    let tpl = template_key || 'private_celebration';
    const tplRow = db.prepare('SELECT key, default_settings_json FROM event_templates WHERE key = ?').get(tpl);
    if (!tplRow) return res.status(400).json({ error: `Unknown template_key: ${tpl}` });
    let settings = {};
    try { settings = JSON.parse(tplRow.default_settings_json || '{}'); } catch { settings = {}; }
    if (org_id != null) {
      const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org_id);
      if (!org) return res.status(400).json({ error: 'Organization not found' });
    }
    const lifecycle = lifecycle_state && LIFECYCLE_STATES.includes(lifecycle_state) ? lifecycle_state : 'DRAFT';
    const result = db.prepare(
      'INSERT INTO events (name, date, venue, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, lifecycle_state, onboarding_method, config_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name.trim(),
      date && String(date).trim() ? String(date).trim() : '',
      venue && String(venue).trim() ? String(venue).trim() : '',
      description && String(description).trim() ? String(description).trim() : null,
      status || lifecycleToLegacyStatus(lifecycle),
      tpl,
      org_id || null,
      timezone || 'Africa/Kampala',
      start_time || null,
      end_time || null,
      expected_attendance ?? null,
      max_capacity ?? null,
      lifecycle,
      settings.onboarding_method || 'approval',
      JSON.stringify({ modules: settings.modules || undefined }),
    );
    const eventId = result.lastInsertRowid;
    try {
      db.prepare('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)').run(req.user.id, eventId);
    } catch {}
    auditFromReq(req, { action: 'event.create', entityType: 'event', entityId: eventId, eventId, metadata: { template_key: tpl, lifecycle } });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    res.status(201).json(shapeEvent(event));
  } catch (err) {
    console.error('Create event error:', err);
    res.status(400).json({ error: 'Failed to create event: ' + err.message });
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, date, venue, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, config_json } = req.body;
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (template_key) {
    const tplRow = db.prepare('SELECT key FROM event_templates WHERE key = ?').get(template_key);
    if (!tplRow) return res.status(400).json({ error: `Unknown template_key: ${template_key}` });
  }
  if (org_id != null) {
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org_id);
    if (!org) return res.status(400).json({ error: 'Organization not found' });
  }
  // Lifecycle changes must go through the transition endpoint; reject direct edits.
  db.prepare(`
    UPDATE events SET name=?, date=?, venue=?, description=?, status=?, template_key=?, org_id=?, timezone=?, start_time=?, end_time=?, expected_attendance=?, max_capacity=?, config_json=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? existing.name,
    date !== undefined ? date : existing.date,
    venue !== undefined ? venue : existing.venue,
    description !== undefined ? description : existing.description,
    status ?? existing.status,
    template_key ?? existing.template_key,
    org_id !== undefined ? org_id : existing.org_id,
    timezone ?? existing.timezone,
    start_time !== undefined ? start_time : existing.start_time,
    end_time !== undefined ? end_time : existing.end_time,
    expected_attendance !== undefined ? expected_attendance : existing.expected_attendance,
    max_capacity !== undefined ? max_capacity : existing.max_capacity,
    config_json !== undefined ? (typeof config_json === 'string' ? config_json : JSON.stringify(config_json)) : existing.config_json,
    req.params.id
  );
  auditFromReq(req, { action: 'event.update', entityType: 'event', entityId: req.params.id, eventId: Number(req.params.id) });
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  res.json(shapeEvent(event));
});

// Explicit lifecycle transition: POST /api/events/:id/lifecycle { to }
router.post('/:id/lifecycle', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  const { to } = req.body;
  if (!to || !LIFECYCLE_STATES.includes(to)) return res.status(400).json({ error: `Invalid target state. Valid: ${LIFECYCLE_STATES.join(', ')}` });
  const from = existing.lifecycle_state || 'DRAFT';
  if (from === to) return res.json(shapeEvent(existing));
  if (!canTransition(from, to)) return res.status(409).json({ error: `Illegal transition ${from} → ${to}` });
  db.prepare("UPDATE events SET lifecycle_state = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(to, lifecycleToLegacyStatus(to), req.params.id);
  auditFromReq(req, { action: 'event.lifecycle', entityType: 'event', entityId: req.params.id, eventId: Number(req.params.id), metadata: { from, to } });
  res.json(shapeEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id)));
});

// Event-scoped role assignment: roles are configuration (spec §11).
router.get('/:id/roles', requireEventAccess(), (req, res) => {
  const rows = db.prepare(`
    SELECT eur.*, u.name AS user_name FROM event_user_roles eur
    JOIN users u ON u.id = eur.user_id
    WHERE eur.event_id = ? ORDER BY eur.created_at DESC
  `).all(req.eventId);
  res.json(rows);
});

router.post('/:id/roles', requireAdmin, (req, res) => {
  const { user_id, role_key, zone } = req.body;
  if (!user_id || !role_key) return res.status(400).json({ error: 'user_id and role_key are required' });
  if (!EVENT_ROLES.includes(role_key)) return res.status(400).json({ error: `Unknown role_key: ${role_key}` });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)').run(user_id, req.params.id);
  db.prepare('INSERT OR IGNORE INTO event_user_roles (event_id, user_id, role_key, zone) VALUES (?, ?, ?, ?)')
    .run(req.params.id, user_id, role_key, zone || null);
  auditFromReq(req, { action: 'event.role.assign', entityType: 'event_user_role', entityId: `${req.params.id}:${user_id}:${role_key}`, eventId: Number(req.params.id), metadata: { user_id, role_key, zone } });
  res.status(201).json({ ok: true });
});

router.delete('/:id/roles/:roleId', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM event_user_roles WHERE id = ? AND event_id = ?').get(req.params.roleId, req.params.id);
  if (!row) return res.status(404).json({ error: 'Role assignment not found' });
  db.prepare('DELETE FROM event_user_roles WHERE id = ?').run(req.params.roleId);
  auditFromReq(req, { action: 'event.role.revoke', entityType: 'event_user_role', entityId: req.params.roleId, eventId: Number(req.params.id), metadata: row });
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const eventId = req.params.id;
  const existing = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  try {
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM checkins WHERE guest_id IN (SELECT id FROM guests WHERE event_id = ?)').run(eventId);
      db.prepare('DELETE FROM guests WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM activities WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM user_events WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM event_user_roles WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM registration_requests WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM invitations WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM import_history WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM access_tokens WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM audit_log WHERE event_id = ?').run(eventId);
      db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
    });
    tx();
    auditFromReq(req, { action: 'event.delete', entityType: 'event', entityId: eventId, metadata: {} });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Failed to delete event: ' + err.message });
  }
});

router.get('/:id/access-code', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT id, name, staff_access_code FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ access_code: event.staff_access_code });
});

router.put('/:id/access-code', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const { access_code } = req.body;
  const code = access_code || crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('UPDATE events SET staff_access_code = ?, updated_at = datetime(\'now\') WHERE id = ?').run(code, req.params.id);
  auditFromReq(req, { action: 'event.access_code.rotate', entityType: 'event', entityId: req.params.id, eventId: Number(req.params.id) });
  res.json({ access_code: code });
});

router.delete('/:id/access-code', requireAdmin, (req, res) => {
  db.prepare('UPDATE events SET staff_access_code = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  auditFromReq(req, { action: 'event.access_code.revoke', entityType: 'event', entityId: req.params.id, eventId: Number(req.params.id) });
  res.json({ ok: true });
});

export default router;
