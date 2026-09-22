// RaaS Phase 3 — Command centers. Event command (attention-first operational
// view), global multi-event command (authorized portfolio only), explainable
// health, audit-derived timeline, ackable alerts. Read-model: reconciles to
// source records by construction (every number is a live query).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { getAttention, getHealth } from '../raas/attention.js';
import { getReadiness } from '../raas/readiness.js';

const router = Router();
router.use(requireAuth);

function scopedEvents(req) {
  if (req.user.role === 'admin') {
    return db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  }
  return db.prepare(`
    SELECT e.* FROM events e WHERE e.id IN (
      SELECT event_id FROM user_events WHERE user_id = ?
      UNION SELECT event_id FROM event_user_roles WHERE user_id = ?
      UNION SELECT event_id FROM break_glass_grants WHERE user_id = ? AND revoked_at IS NULL AND expires_at > datetime('now')
    ) ORDER BY e.date DESC`).all(req.user.id, req.user.id, req.user.id);
}

// ---- Event command center ----
router.get('/command/:eventId', requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.eventId);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const includeAcked = req.query.include_acked === '1';
  const attention = getAttention(req.eventId, { includeAcked });
  const health = getHealth(req.eventId, attention);
  const readiness = getReadiness(req.eventId);

  const attendance = db.prepare(`
    SELECT (SELECT COUNT(*) FROM guests WHERE event_id = ? AND status = 'approved') AS invited,
      (SELECT COUNT(DISTINCT c.guest_id) FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?) AS checked_in
  `).get(req.eventId, req.eventId);

  const counts = {
    open_incidents: db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')").get(req.eventId).c,
    critical_incidents: db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND severity = 'CRITICAL' AND status NOT IN ('RESOLVED','CLOSED')").get(req.eventId).c,
    open_tasks: db.prepare("SELECT COUNT(*) AS c FROM tasks WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED')").get(req.eventId).c,
    open_requests: db.prepare("SELECT COUNT(*) AS c FROM service_requests WHERE event_id = ? AND status NOT IN ('FULFILLED','CLOSED','CANCELLED')").get(req.eventId).c,
    vendors_issue: db.prepare("SELECT COUNT(*) AS c FROM vendors WHERE event_id = ? AND status = 'ISSUE'").get(req.eventId).c,
    schedule_open: db.prepare("SELECT COUNT(*) AS c FROM schedule_items WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED')").get(req.eventId).c,
  };

  const upcoming = db.prepare(`SELECT id, title, planned_start, status FROM schedule_items
    WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED') AND planned_start IS NOT NULL
    ORDER BY planned_start ASC LIMIT 5`).all(req.eventId);

  res.json({
    event: { id: event.id, name: event.name, date: event.date, venue: event.venue, lifecycle_state: event.lifecycle_state, status: event.status, template_key: event.template_key },
    health, attention, readiness: { ready: readiness.ready, blocking_failed: readiness.blocking_failed },
    attendance, counts, upcoming_milestones: upcoming,
  });
});

// ---- Acknowledge an attention item (scoped, reversible, audited) ----
router.post('/command/:eventId/ack', requireEventAccess(), (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key is required' });
  db.prepare('INSERT OR IGNORE INTO alert_acks (event_id, key, actor_id) VALUES (?, ?, ?)').run(req.eventId, key.slice(0, 200), req.user.id);
  auditFromReq(req, { action: 'alert.ack', entityType: 'attention', entityId: key.slice(0, 200), eventId: req.eventId });
  res.json({ ok: true });
});

router.post('/command/:eventId/unack', requireEventAccess(), (req, res) => {
  const { key } = req.body;
  if (!key || typeof key !== 'string') return res.status(400).json({ error: 'key is required' });
  db.prepare('DELETE FROM alert_acks WHERE event_id = ? AND key = ?').run(req.eventId, key.slice(0, 200));
  auditFromReq(req, { action: 'alert.unack', entityType: 'attention', entityId: key.slice(0, 200), eventId: req.eventId });
  res.json({ ok: true });
});

// ---- Operational timeline (significant activity from audit trail) ----
const TIMELINE_TEXT = {
  'event.create': () => 'Event created',
  'event.lifecycle': (m) => `Lifecycle ${m?.from || ''} → ${m?.to || ''}`,
  'guest.create': () => 'Guest added',
  'guest.import': (m) => `Imported ${m?.imported ?? '?'} guests`,
  'invite.create': (m) => `Invitations issued (${m?.created ?? '?'})`,
  'invite.opened': () => 'Invitation opened',
  'invite.revoke': () => 'Invitation revoked',
  'rsvp.submit': (m) => `RSVP ${m?.from || ''} → ${m?.to || ''}`,
  'rsvp.override': (m) => `RSVP overridden ${m?.from || ''} → ${m?.to || ''}`,
  'checkin.perform': () => 'Guest checked in',
  'checkin.override': (m) => `Check-in corrected (${m?.reason || 'no reason given'})`,
  'checkin.revoke': () => 'Check-in revoked',
  'task.create': () => 'Task created',
  'task.complete': () => 'Task completed',
  'task.status': (m) => `Task ${m?.from || ''} → ${m?.to || ''}`,
  'incident.create': () => 'Incident opened',
  'incident.escalate': (m) => `Incident escalated to L${m?.level ?? '?'}`,
  'incident.status': (m) => `Incident ${m?.from || ''} → ${m?.to || ''}`,
  'request.create': () => 'Service request opened',
  'request.status': (m) => `Request ${m?.from || ''} → ${m?.to || ''}`,
  'schedule.create': () => 'Program item added',
  'schedule.status': (m) => `Program ${m?.from || ''} → ${m?.to || ''}`,
  'vendor.status': (m) => `Vendor ${m?.from || ''} → ${m?.to || ''}`,
  'transport.status': (m) => `Transport ${m?.from || ''} → ${m?.to || ''}`,
  'seating.assign': () => 'Guest seated',
  'seating.reassign': () => 'Guest moved seats',
  'event.role.assign': (m) => `Staff assigned (${m?.role_key || ''})`,
  'auth.login': () => null, // noise: skip
  'report.generate': () => null, // noise: skip
};

router.get('/command/:eventId/timeline', requireEventAccess(), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.event_id = ? ORDER BY a.id DESC LIMIT ?`).all(req.eventId, limit);
  const items = [];
  for (const r of rows) {
    const fmt = TIMELINE_TEXT[r.action];
    if (!fmt) continue;
    let meta = null;
    try { meta = r.metadata_json ? JSON.parse(r.metadata_json) : null; } catch {}
    const text = fmt(meta);
    if (!text) continue;
    items.push({ id: r.id, at: r.created_at, action: r.action, text, actor: r.actor_name || 'Guest', entity_type: r.entity_type, entity_id: r.entity_id });
  }
  res.json(items);
});

// ---- Global RaaS command (authorized portfolio only) ----
router.get('/command', (req, res) => {
  const events = scopedEvents(req).filter((e) => e.lifecycle_state !== 'ARCHIVED');
  const cards = events.map((e) => {
    const attention = getAttention(e.id);
    const health = getHealth(e.id, attention);
    const openInc = db.prepare("SELECT COUNT(*) AS c FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')").get(e.id).c;
    const crit = attention.filter((a) => a.severity === 'CRITICAL').length;
    return {
      id: e.id, name: e.name, date: e.date, venue: e.venue, lifecycle_state: e.lifecycle_state,
      health: health.status, reasons: health.reasons.slice(0, 3),
      attention_count: attention.length, critical_count: crit, open_incidents: openInc,
      top_attention: attention.slice(0, 3),
    };
  });
  cards.sort((a, b) => {
    const rank = { CRITICAL: 0, WATCH: 1, OK: 2 };
    return (rank[a.health] - rank[b.health]) || (b.attention_count - a.attention_count);
  });
  const needsMe = cards.filter((c) => c.health !== 'OK');
  res.json({ events: cards, needs_attention: needsMe.map((c) => c.id), total: cards.length });
});

// ---- Admin-only: ack table housekeeping is automatic via event cascade ----
export default router;
