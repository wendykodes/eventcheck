// RaaS Phase 0 — Universal event engine routes.
// Events are configured instances of templates, with explicit lifecycle.
// All event-scoped reads enforce membership (event isolation, spec §27).

import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, userHasEventAccess, effectivePermissions } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { LIFECYCLE_STATES, canTransition, lifecycleToLegacyStatus } from '../raas/lifecycle.js';
import { getReadiness } from '../raas/readiness.js';
import { checkFresh } from './opsCommon.js';
import { learnEvent } from '../raas/learn.js';
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
  // Event isolation via the central engine (membership, roles, break-glass).
  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, req.params.id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }
  res.json(shapeEvent(event));
});

router.post('/', requireAdmin, (req, res) => {
  try {
    const { name, date, venue, venue_id, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, lifecycle_state, template_config } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Event name is required' });
    // Validate template_key against seeded templates; fall back to default.
    let tpl = template_key || 'private_celebration';
    const tplRow = db.prepare('SELECT key, default_modules_json, default_roles_json, default_settings_json FROM event_templates WHERE key = ?').get(tpl);
    if (!tplRow) return res.status(400).json({ error: `Unknown template_key: ${tpl}` });
    let settings = {};
    let modules = [];
    let roles = [];
    try { 
      settings = JSON.parse(tplRow.default_settings_json || '{}'); 
      modules = JSON.parse(tplRow.default_modules_json || '[]');
      roles = JSON.parse(tplRow.default_roles_json || '[]');
    } catch { settings = {}; }
    
    // Override with template_config if provided
    if (template_config) {
      if (template_config.default_settings) {
        settings = { ...settings, ...template_config.default_settings };
      }
      if (template_config.default_modules) {
        modules = template_config.default_modules;
      }
      if (template_config.default_roles) {
        roles = template_config.default_roles;
      }
    }
    
    if (org_id != null) {
      const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org_id);
      if (!org) return res.status(400).json({ error: 'Organization not found' });
    }
    // Optional venue link: copies the venue name into the display field.
    let venueName = venue && String(venue).trim() ? String(venue).trim() : '';
    let venueId = null;
    if (venue_id != null) {
      const v = db.prepare('SELECT id, name, org_id FROM venues WHERE id = ?').get(venue_id);
      if (!v) return res.status(400).json({ error: 'Venue not found' });
      if (org_id != null && v.org_id != null && v.org_id !== Number(org_id)) {
        return res.status(400).json({ error: 'Venue belongs to a different organization' });
      }
      venueId = v.id;
      if (!venueName) venueName = v.name;
    }
    const lifecycle = lifecycle_state && LIFECYCLE_STATES.includes(lifecycle_state) ? lifecycle_state : 'DRAFT';
    const result = db.prepare(
      'INSERT INTO events (name, date, venue, venue_id, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, lifecycle_state, onboarding_method, config_json, self_checkin_code) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      name.trim(),
      date && String(date).trim() ? String(date).trim() : '',
      venueName,
      venueId,
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
      JSON.stringify({ modules, template_config: { default_modules: modules, default_roles: roles, default_settings: settings } }),
      crypto.randomBytes(16).toString('hex'), // Phase 2: opaque venue-QR identity
    );
    const eventId = result.lastInsertRowid;
    
    // Seed event roles from template
    if (roles && roles.length > 0) {
      for (const role of roles) {
        db.prepare('INSERT OR IGNORE INTO event_user_roles (event_id, user_id, role_key) VALUES (?, NULL, ?)').run(eventId, role);
      }
    }
    
    try {
      db.prepare('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)').run(req.user.id, eventId);
    } catch {}
    // Every event starts with a default check-in point so activation readiness
    // never depends on the lazy side effect of a later activities read.
    try {
      db.prepare("INSERT INTO activities (event_id, name, sort_order) VALUES (?, 'General Check-In', 0)").run(eventId);
    } catch {}
    auditFromReq(req, { action: 'event.create', entityType: 'event', entityId: eventId, eventId, metadata: { template_key: tpl, lifecycle, template_config } });
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    res.status(201).json(shapeEvent(event));
  } catch (err) {
    console.error('Create event error:', err);
    res.status(400).json({ error: 'Failed to create event: ' + err.message });
  }
});

// Phase 6 — clone event STRUCTURE for reuse. Copies activities, schedule
// items and seating zones only. People, guests, RSVPs, check-ins, tasks,
// incidents and all operational data are NEVER copied.
router.post('/:id/clone', requireAdmin, (req, res) => {
  const source = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!source) return res.status(404).json({ error: 'Event not found' });
  const { name, date } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required for the cloned event' });
  const tx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO events (name, date, venue, venue_id, description, status, template_key, org_id, timezone, start_time, end_time,
        expected_attendance, max_capacity, lifecycle_state, onboarding_method, config_json, self_checkin_code)
      VALUES (?, ?, ?, ?, ?, 'upcoming', ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?)`)
      .run(String(name).trim(), date || '', source.venue, source.venue_id, source.description, source.template_key,
        source.org_id, source.timezone, source.start_time, source.end_time, source.expected_attendance, source.max_capacity,
        source.onboarding_method, source.config_json, crypto.randomBytes(16).toString('hex'));
    const nid = r.lastInsertRowid;
    db.prepare('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)').run(req.user.id, nid);
    for (const a of db.prepare('SELECT name, sort_order FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(source.id)) {
      db.prepare('INSERT INTO activities (event_id, name, sort_order) VALUES (?, ?, ?)').run(nid, a.name, a.sort_order);
    }
    for (const s of db.prepare('SELECT title, description, location, planned_start, planned_end, priority, sort_order, notes FROM schedule_items WHERE event_id = ?').all(source.id)) {
      db.prepare(`INSERT INTO schedule_items (event_id, title, description, location, planned_start, planned_end, priority, sort_order, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(nid, s.title, s.description, s.location, s.planned_start, s.planned_end, s.priority || 'MEDIUM', s.sort_order || 0, s.notes, req.user.id);
    }
    for (const z of db.prepare('SELECT name, kind, capacity, location, notes FROM seating_zones WHERE event_id = ?').all(source.id)) {
      db.prepare('INSERT INTO seating_zones (event_id, name, kind, capacity, location, notes) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nid, z.name, z.kind, z.capacity, z.location, z.notes);
    }
    return nid;
  });
  let eventId;
  try {
    eventId = tx();
  } catch (err) {
    return res.status(400).json({ error: 'Failed to clone event: ' + err.message });
  }
  auditFromReq(req, { action: 'event.clone', entityType: 'event', entityId: eventId, eventId, metadata: { from_event: Number(req.params.id) } });
  res.status(201).json(shapeEvent(db.prepare('SELECT * FROM events WHERE id = ?').get(eventId)));
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, date, venue, venue_id, description, status, template_key, org_id, timezone, start_time, end_time, expected_attendance, max_capacity, config_json } = req.body;
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!checkFresh(existing, req.body, res)) return;
  if (template_key) {
    const tplRow = db.prepare('SELECT key FROM event_templates WHERE key = ?').get(template_key);
    if (!tplRow) return res.status(400).json({ error: `Unknown template_key: ${template_key}` });
  }
  if (org_id != null) {
    const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(org_id);
    if (!org) return res.status(400).json({ error: 'Organization not found' });
  }
  let venueId = existing.venue_id;
  let venueName = venue !== undefined ? venue : existing.venue;
  if (venue_id !== undefined) {
    if (venue_id === null) {
      venueId = null;
    } else {
      const v = db.prepare('SELECT id, name, org_id FROM venues WHERE id = ?').get(venue_id);
      if (!v) return res.status(400).json({ error: 'Venue not found' });
      const effOrg = org_id !== undefined ? org_id : existing.org_id;
      if (effOrg != null && v.org_id != null && v.org_id !== Number(effOrg)) {
        return res.status(400).json({ error: 'Venue belongs to a different organization' });
      }
      venueId = v.id;
      if (venue === undefined) venueName = v.name;
    }
  }
  // Lifecycle changes must go through the transition endpoint; reject direct edits.
  db.prepare(`
    UPDATE events SET name=?, date=?, venue=?, venue_id=?, description=?, status=?, template_key=?, org_id=?, timezone=?, start_time=?, end_time=?, expected_attendance=?, max_capacity=?, config_json=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now')
    WHERE id=?
  `).run(
    name ?? existing.name,
    date !== undefined ? date : existing.date,
    venueName,
    venueId,
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
  // Phase 1 readiness gate: READY → ACTIVE requires minimum operational config.
  if (to === 'ACTIVE') {
    const readiness = getReadiness(Number(req.params.id));
    if (!readiness.ready) {
      return res.status(409).json({ error: 'Event is not ready for activation', blocking_failed: readiness.blocking_failed, checks: readiness.checks });
    }
  }
  db.prepare("UPDATE events SET lifecycle_state = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(to, lifecycleToLegacyStatus(to), req.params.id);
  auditFromReq(req, { action: 'event.lifecycle', entityType: 'event', entityId: req.params.id, eventId: Number(req.params.id), metadata: { from, to } });
  // Phase 7: post-event learning on CLOSE. Best-effort: learning must never
  // break the lifecycle transition itself.
  if (to === 'CLOSED') {
    try {
      learnEvent(Number(req.params.id));
    } catch (e) {
      console.error('Post-event learning notice:', e.message);
    }
  }
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

// Get a user's effective permissions for an event
router.get('/:id/users/:userId/permissions', requireEventAccess(), (req, res) => {
  const { userId } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  const effective = effectivePermissions(userId, user.role, req.eventId);
  if (effective === null) {
    // Admin has all permissions
    res.json(db.prepare('SELECT permission FROM permissions').all().map(p => p.permission));
  } else {
    res.json(Array.from(effective));
  }
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
  // Phase 6: deterministic double-booking warning (warn-not-block). Same user
  // on another non-closed event with the same date.
  let warnings = [];
  try {
    const thisEvent = db.prepare('SELECT date FROM events WHERE id = ?').get(req.params.id);
    if (thisEvent && thisEvent.date) {
      warnings = db.prepare(`
        SELECT e.id, e.name, e.date, e.lifecycle_state FROM user_events ue
        JOIN events e ON e.id = ue.event_id
        WHERE ue.user_id = ? AND e.id != ? AND e.date = ?
          AND e.lifecycle_state NOT IN ('CLOSED','ARCHIVED','CANCELLED')`).all(user_id, req.params.id, thisEvent.date)
        .map((e) => ({ type: 'double_booked', event_id: e.id, event_name: e.name, date: e.date, lifecycle_state: e.lifecycle_state }));
    }
  } catch {}
  auditFromReq(req, { action: 'event.role.assign', entityType: 'event_user_role', entityId: `${req.params.id}:${user_id}:${role_key}`, eventId: Number(req.params.id), metadata: { user_id, role_key, zone, warnings: warnings.length } });
  res.status(201).json({ ok: true, warnings });
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

// Event analytics (post-event reporting)
router.get('/:id/analytics', requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  
  // RSVP summary
  const rsvp = db.prepare(`
    SELECT 
      COUNT(CASE WHEN rsvp_status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN rsvp_status = 'declined' THEN 1 END) AS declined,
      COUNT(CASE WHEN rsvp_status = 'no_response' THEN 1 END) AS no_response,
      ROUND(COUNT(CASE WHEN rsvp_status != 'no_response' THEN 1 END) * 100.0 / COUNT(*), 1) AS response_rate
    FROM guests WHERE event_id = ?
  `).get(req.params.id);
  
  // Attendance timeline (hourly check-ins)
  const timeline = db.prepare(`
    SELECT 
      strftime('%H:00', checked_in_at) AS time,
      COUNT(*) AS checked_in,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?), 1) AS percent
    FROM checkins c JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ? AND checked_in_at IS NOT NULL
    GROUP BY strftime('%H', checked_in_at)
    ORDER BY time
  `).all(req.params.id, req.params.id);
  
  // Peak arrival
  const peak = db.prepare(`
    SELECT strftime('%H:%M', checked_in_at) AS time, COUNT(*) AS count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?), 1) AS percent
    FROM checkins c JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ? AND checked_in_at IS NOT NULL
    GROUP BY strftime('%H:%M', checked_in_at)
    ORDER BY count DESC LIMIT 1
  `).get(req.params.id, req.params.id);
  
  // Check-in by activity
  const byActivity = db.prepare(`
    SELECT a.name, COUNT(*) AS checked_in,
      (SELECT COUNT(*) FROM guests WHERE event_id = ?) AS total
    FROM checkins c JOIN activities a ON a.id = c.activity_id JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ?
    GROUP BY a.id, a.name
    ORDER BY checked_in DESC
  `).all(req.params.id, req.params.id);
  
  // Staff performance
  const staffPerf = db.prepare(`
    SELECT u.name, COUNT(*) AS checkins,
      strftime('%H:%M', MIN(c.checked_in_at)) AS first_checkin,
      strftime('%H:%M', MAX(c.checked_in_at)) AS last_checkin
    FROM checkins c JOIN users u ON u.id = c.staff_id JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ?
    GROUP BY u.id, u.name
    ORDER BY checkins DESC
  `).all(req.params.id);
  
  // Process staff performance
  const staffPerformance = staffPerf.map(s => {
    const duration = s.last_checkin && s.first_checkin 
      ? (new Date(s.last_checkin) - new Date(s.first_checkin)) / 3600000 // hours
      : 1;
    return {
      name: s.name,
      checkins: s.checkins,
      peak_time: s.last_checkin ? new Date(s.last_checkin).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'N/A',
      avg_per_hour: Math.round(s.checkins / Math.max(duration, 1))
    };
  });
  
  // Incident summary
  const incidents = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) AS critical,
      COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) AS resolved,
      AVG(CASE WHEN resolved_at IS NOT NULL 
        THEN (julianday(resolved_at) - julianday(created_at)) * 24 * 60 
        END) AS avg_resolution_time
    FROM incidents WHERE event_id = ?
  `).get(req.params.id);
  
  // Attendance heatmap (24-hour check-in density)
  const hourlyCheckins = db.prepare(`
    SELECT 
      CAST(strftime('%H', checked_in_at) AS INTEGER) AS hour,
      COUNT(*) AS value
    FROM checkins c JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ? AND checked_in_at IS NOT NULL
    GROUP BY hour
  `).all(req.params.id);
  
  const heatmap = Array.from({ length: 24 }, (_, i) => ({
    hour: i,
    value: hourlyCheckins.find(h => h.hour === i)?.value || 0
  }));
  
  res.json({
    rsvp_summary: rsvp,
    attendance_timeline: timeline,
    peak_arrival: peak,
    checkin_by_activity: byActivity,
    staff_performance: staffPerformance,
    incident_summary: {
      total: incidents.total || 0,
      critical: incidents.critical || 0,
      resolved: incidents.resolved || 0,
      avg_resolution_time: incidents.avg_resolution_time ? `${Math.round(incidents.avg_resolution_time)}m` : 'N/A'
    },
    heatmap
  });
});

// Helper function to get analytics data (refactored for export/comparison)
function getAnalyticsData(eventId) {
  const rsvp = db.prepare(`
    SELECT 
      COUNT(CASE WHEN rsvp_status = 'confirmed' THEN 1 END) AS confirmed,
      COUNT(CASE WHEN rsvp_status = 'declined' THEN 1 END) AS declined,
      COUNT(CASE WHEN rsvp_status = 'no_response' THEN 1 END) AS no_response,
      ROUND(COUNT(CASE WHEN rsvp_status != 'no_response' THEN 1 END) * 100.0 / COUNT(*), 1) AS response_rate
    FROM guests WHERE event_id = ?
  `).get(eventId);
  
  const incidents = db.prepare(`
    SELECT 
      COUNT(*) AS total,
      COUNT(CASE WHEN severity = 'CRITICAL' THEN 1 END) AS critical,
      COUNT(CASE WHEN status = 'RESOLVED' THEN 1 END) AS resolved,
      AVG(CASE WHEN resolved_at IS NOT NULL 
        THEN (julianday(resolved_at) - julianday(created_at)) * 24 * 60 
        END) AS avg_resolution_time
    FROM incidents WHERE event_id = ?
  `).get(eventId);
  
  return {
    rsvp_summary: rsvp,
    incident_summary: {
      total: incidents.total || 0,
      critical: incidents.critical || 0,
      resolved: incidents.resolved || 0,
      avg_resolution_time: incidents.avg_resolution_time ? `${Math.round(incidents.avg_resolution_time)}m` : 'N/A'
    }
  };
}

// Event finances (revenue/expense tracking)
router.get('/:id/finances', requireEventAccess(), (req, res) => {
  const finances = db.prepare(`
    SELECT ef.*, u.name AS recorded_by_name
    FROM event_finances ef
    LEFT JOIN users u ON u.id = ef.recorded_by
    WHERE ef.event_id = ?
    ORDER BY ef.recorded_at DESC
  `).all(req.params.id);
  
  const summary = db.prepare(`
    SELECT 
      category,
      SUM(amount) AS total
    FROM event_finances
    WHERE event_id = ?
    GROUP BY category
  `).all(req.params.id);
  
  const revenue = summary.find(s => s.category === 'revenue')?.total || 0;
  const expenses = summary.find(s => s.category === 'expense')?.total || 0;
  
  res.json({
    finances,
    summary: {
      revenue,
      expenses,
      profit: revenue - expenses,
      margin: revenue > 0 ? ((revenue - expenses) / revenue * 100).toFixed(1) : 0
    }
  });
});

router.post('/:id/finances', requireEventAccess(), (req, res) => {
  const { category, subcategory, description, amount, currency, notes } = req.body;
  if (!category || !description || !amount) {
    return res.status(400).json({ error: 'category, description, and amount are required' });
  }
  
  const result = db.prepare(`
    INSERT INTO event_finances (event_id, category, subcategory, description, amount, currency, recorded_by, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.params.id, category, subcategory, description, amount, currency || 'USD', req.user.id, notes);
  
  const finance = db.prepare('SELECT * FROM event_finances WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(finance);
});

router.delete('/:id/finances/:financeId', requireEventAccess(), (req, res) => {
  const finance = db.prepare('SELECT * FROM event_finances WHERE id = ? AND event_id = ?')
    .get(req.params.financeId, req.params.id);
  if (!finance) return res.status(404).json({ error: 'Finance record not found' });
  
  db.prepare('DELETE FROM event_finances WHERE id = ?').run(req.params.financeId);
  res.json({ ok: true });
});

// Budget management
router.get('/:id/budgets', requireEventAccess(), (req, res) => {
  const budgets = db.prepare(`
    SELECT 
      eb.*,
      (SELECT COALESCE(SUM(amount), 0) FROM event_finances 
       WHERE event_id = eb.event_id AND category = 'expense' 
       AND (subcategory = eb.subcategory OR eb.subcategory IS NULL)) AS spent
    FROM event_budgets eb WHERE event_id = ?
  `).all(req.params.id);
  res.json(budgets);
});

router.post('/:id/budgets', requireEventAccess(), (req, res) => {
  const { category, subcategory, budget_amount, currency } = req.body;
  if (!category || !budget_amount) {
    return res.status(400).json({ error: 'category and budget_amount are required' });
  }
  const result = db.prepare(`
    INSERT INTO event_budgets (event_id, category, subcategory, budget_amount, currency, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(req.params.id, category, subcategory || null, budget_amount, currency || 'USD', req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM event_budgets WHERE id = ?').get(result.lastInsertRowid));
});

// Expense approval workflow
router.put('/:id/finances/:financeId/approve', requireEventAccess(), (req, res) => {
  db.prepare(`
    UPDATE event_finances 
    SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now')
    WHERE id = ? AND event_id = ?
  `).run(req.user.id, req.params.financeId, req.params.id);
  res.json({ ok: true });
});

router.put('/:id/finances/:financeId/reject', requireEventAccess(), (req, res) => {
  db.prepare(`
    UPDATE event_finances 
    SET status = 'REJECTED'
    WHERE id = ? AND event_id = ?
  `).run(req.params.financeId, req.params.id);
  res.json({ ok: true });
});

// Export to CSV
router.get('/:id/finances/export', requireEventAccess(), (req, res) => {
  const finances = db.prepare(`
    SELECT ef.*, u.name AS recorded_by_name
    FROM event_finances ef
    LEFT JOIN users u ON u.id = ef.recorded_by
    WHERE ef.event_id = ?
    ORDER BY ef.recorded_at DESC
  `).all(req.params.id);
  
  const headers = ['id', 'category', 'subcategory', 'description', 'amount', 'currency', 'status', 'recorded_at', 'recorded_by_name'];
  const csv = [
    headers.join(','),
    ...finances.map(f => headers.map(h => JSON.stringify(f[h] || '')).join(','))
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="finances-${req.params.id}.csv"`);
  res.send(csv);
});

// Analytics export and comparison
router.get('/:id/analytics/export', requireEventAccess(), (req, res) => {
  const analytics = getAnalyticsData(req.params.id);
  const csv = [
    'Metric,Value',
    'RSVP Confirmed,' + (analytics.rsvp_summary?.confirmed || 0),
    'RSVP Declined,' + (analytics.rsvp_summary?.declined || 0),
    'RSVP No Response,' + (analytics.rsvp_summary?.no_response || 0),
    'Response Rate %,' + (analytics.rsvp_summary?.response_rate || 0),
    'Total Incidents,' + (analytics.incident_summary?.total || 0),
    'Critical Incidents,' + (analytics.incident_summary?.critical || 0),
    'Resolved Incidents,' + (analytics.incident_summary?.resolved || 0),
    'Avg Resolution Time,' + (analytics.incident_summary?.avg_resolution_time || 'N/A')
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="analytics-${req.params.id}.csv"`);
  res.send(csv);
});

router.get('/compare', requireAuth, (req, res) => {
  const { event_ids } = req.query;
  if (!event_ids) return res.status(400).json({ error: 'event_ids query parameter is required' });
  
  const events = event_ids.split(',');
  const comparison = events.map(eid => ({
    event_id: eid,
    analytics: getAnalyticsData(eid)
  }));
  res.json(comparison);
});

export default router;
