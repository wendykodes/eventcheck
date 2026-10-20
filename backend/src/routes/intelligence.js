// RaaS Phase 7 — Intelligence API. Deterministic, explainable outputs over
// learned baselines + live records. Every forecast states its basis; every
// recommendation states why. No scores without reasons, no auto-mutation of
// operational state (nudges are operator-mediated comms, never auto-sent).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';
import { lookupBaseline, learnEvent } from '../raas/learn.js';
import { withIdempotency } from '../middleware/idempotency.js';

const router = Router();
router.use(requireAuth);

function eventCtx(eventId) {
  return db.prepare('SELECT id, org_id, template_key, lifecycle_state FROM events WHERE id = ?').get(eventId);
}

// ---------- Baselines (read the learned foundation) ----------
router.get('/learning/baselines', (req, res) => {
  const { org_id, template_key } = req.query;
  let q = 'SELECT * FROM learning_baselines WHERE 1=1';
  const p = [];
  if (org_id !== undefined) { q += ' AND org_id = ?'; p.push(Number(org_id)); }
  if (template_key) { q += ' AND template_key = ?'; p.push(template_key); }
  res.json(db.prepare(q + ' ORDER BY org_id ASC, template_key ASC, metric ASC').all(...p));
});

// ---------- Rebuild baselines from all CLOSED/ARCHIVED events (admin) ----------
router.post('/learning/rebuild', requireAdmin, (req, res) => {
  const closed = db.prepare("SELECT id FROM events WHERE lifecycle_state IN ('CLOSED','ARCHIVED') ORDER BY id ASC").all();
  db.prepare('DELETE FROM learning_baselines').run();
  db.prepare('DELETE FROM learned_events').run();
  let learned = 0;
  const errors = [];
  for (const e of closed) {
    try {
      const r = learnEvent(e.id, { force: true });
      if (r.learned) learned++;
    } catch (err) {
      errors.push({ event_id: e.id, error: err.message });
    }
  }
  auditFromReq(req, { action: 'learn.rebuild', entityType: 'platform', entityId: 'baselines', metadata: { events: closed.length, learned } });
  res.json({ ok: true, events_scanned: closed.length, events_learned: learned, errors });
});

// ---------- Event intelligence: forecast + bottlenecks + staffing + nudges ----------
router.get('/intelligence/:eventId', requireEventAccess(), (req, res) => {
  const ctx = eventCtx(req.eventId);
  if (!ctx) return res.status(404).json({ error: 'Event not found' });
  const orgId = ctx.org_id || 0;
  const tpl = ctx.template_key || '*';

  const invited = db.prepare("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").get(req.eventId).c;
  const agg = db.prepare(`SELECT SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN r.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined FROM rsvps r WHERE r.event_id = ?`).get(req.eventId);
  const confirmed = agg.confirmed || 0;
  const declined = agg.declined || 0;
  const silent = Math.max(0, invited - confirmed - declined);
  const checked = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?').get(req.eventId).c;

  const showUp = lookupBaseline(orgId, tpl, 'show_up_rate');
  const decline = lookupBaseline(orgId, tpl, 'decline_rate');
  const throughput = lookupBaseline(orgId, tpl, 'checkins_per_min');
  const incidentRate = lookupBaseline(orgId, tpl, 'incidents_per_100');
  const resolveAvg = lookupBaseline(orgId, tpl, 'avg_resolve_min');

  const expectedArrivals = Math.round(confirmed * showUp.value);
  const expectedDeclines = Math.round(invited * decline.value);

  // Bottlenecks: remaining guests per check-in point vs learned throughput.
  const points = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(req.eventId);
  const remaining = Math.max(0, expectedArrivals - checked);
  const bottlenecks = points.map((a) => {
    const done = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c WHERE c.activity_id = ?').get(a.id).c;
    const share = points.length ? remaining / points.length : remaining;
    const minutesToClear = throughput.value > 0 ? share / throughput.value : null;
    return {
      activity_id: a.id, name: a.name, checked_in: done,
      projected_remaining: Math.round(share),
      minutes_to_clear: minutesToClear !== null ? Math.round(minutesToClear) : null,
      throughput_basis: throughput.basis,
    };
  }).sort((a, b) => (b.minutes_to_clear || 0) - (a.minutes_to_clear || 0));

  // Staffing: open load per assignee vs learned resolve pace.
  const load = db.prepare(`SELECT u.id, u.name,
      SUM(CASE WHEN t.status NOT IN ('COMPLETED','CANCELLED') THEN 1 ELSE 0 END) AS open_tasks,
      SUM(CASE WHEN i.status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) AS open_incidents
    FROM users u
    LEFT JOIN tasks t ON t.assignee_user_id = u.id AND t.event_id = ?
    LEFT JOIN incidents i ON i.assignee_user_id = u.id AND i.event_id = ?
    JOIN user_events ue ON ue.user_id = u.id AND ue.event_id = ?
    GROUP BY u.id HAVING open_tasks > 0 OR open_incidents > 0
    ORDER BY open_tasks DESC, open_incidents DESC`).all(req.eventId, req.eventId, req.eventId);
  const staffing = load.map((r) => {
    const open = (r.open_tasks || 0) + (r.open_incidents || 0);
    return {
      user_id: r.id, name: r.name, open_tasks: r.open_tasks || 0, open_incidents: r.open_incidents || 0,
      recommendation: open >= 5 ? 'Overloaded — reassign some items' : open >= 3 ? 'Heavy load — avoid new assignments' : 'Normal load',
      basis: `avg resolve ${Math.round(resolveAvg.value)} min (${resolveAvg.basis})`,
    };
  });

  // Nudge candidates: silent guests holding a live invitation.
  const candidates = db.prepare(`
    SELECT g.id AS guest_id, g.name, i.id AS invitation_id FROM guests g
    JOIN invitations i ON i.guest_id = g.id AND i.event_id = g.event_id AND i.status = 'pending'
    LEFT JOIN rsvps r ON r.invitation_id = i.id
    LEFT JOIN communications n ON n.guest_id = g.id AND n.event_id = g.event_id
      AND n.purpose = 'rsvp-followup' AND n.status IN ('QUEUED','SENT')
    WHERE g.event_id = ? AND g.status = 'approved' AND r.id IS NULL AND n.id IS NULL
    ORDER BY g.name ASC LIMIT 200`).all(req.eventId);

  const recommendations = [];
  if (silent > 0 && candidates.length > 0) {
    recommendations.push({
      key: 'rsvp-followup', title: `Follow up ${candidates.length} silent guest${candidates.length === 1 ? '' : 's'}`,
      basis: `${silent} invited guests have not responded; learned no-response handling suggests reminders convert before doors.`,
      action: 'POST /followups/rsvp-nudges',
    });
  }
  if (bottlenecks.length > 0 && bottlenecks[0].minutes_to_clear !== null && bottlenecks[0].minutes_to_clear > 30) {
    recommendations.push({
      key: 'bottleneck', title: `${bottlenecks[0].name} may take ~${bottlenecks[0].minutes_to_clear} min to clear`,
      basis: `${bottlenecks[0].projected_remaining} projected arrivals at learned pace ${throughput.value.toFixed(1)}/min (${throughput.basis}).`,
      action: 'Open another check-in point or split the queue',
    });
  }
  const overloaded = staffing.filter((s) => s.open_tasks + s.open_incidents >= 5);
  if (overloaded.length > 0) {
    recommendations.push({
      key: 'staffing', title: `${overloaded.map((s) => s.name).join(', ')} overloaded`,
      basis: `5+ open items each vs learned resolve pace ${Math.round(resolveAvg.value)} min (${resolveAvg.basis}).`,
      action: 'Reassign tasks in Operations',
    });
  }
  if (expectedDeclines > invited * 0.3 && invited > 0) {
    recommendations.push({
      key: 'declines', title: `High predicted declines (~${expectedDeclines})`,
      basis: `Learned decline rate ${(decline.value * 100).toFixed(0)}% (${decline.basis}).`,
      action: 'Confirm catering/seating numbers downward',
    });
  }

  res.json({
    event_id: req.eventId,
    lifecycle_state: ctx.lifecycle_state,
    forecast: {
      invited, confirmed, declined, silent, checked_in: checked,
      expected_arrivals: expectedArrivals, expected_declines: expectedDeclines,
      show_up_basis: showUp.basis, decline_basis: decline.basis,
    },
    bottlenecks,
    staffing,
    nudge_candidates: candidates.length,
    recommendations,
    learned: showUp.n + decline.n + throughput.n > 0,
  });
});

// ---------- Automated follow-up: RSVP nudges (operator-mediated, deduped) ----------
// Creates QUEUED communications (one per silent guest, skipped if an open
// nudge already exists). Nothing is auto-sent: an operator sends via the
// channel app and marks SENT. Idempotent per guest.
router.post('/followups/rsvp-nudges', requireEventAccess(), withIdempotency((req, res) => {
  const { message, channel, limit } = req.body;
  if (channel && !['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP', 'OPERATOR'].includes(channel)) {
    return res.status(400).json({ error: 'Invalid channel' });
  }
  const lc = db.prepare('SELECT lifecycle_state FROM events WHERE id = ?').get(req.eventId).lifecycle_state;
  if (['CLOSED', 'ARCHIVED'].includes(lc)) return res.status(409).json({ error: `Event is ${lc}. Follow-ups are disabled.` });
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const candidates = db.prepare(`
    SELECT g.id AS guest_id, g.name, g.phone FROM guests g
    JOIN invitations i ON i.guest_id = g.id AND i.event_id = g.event_id AND i.status = 'pending'
    LEFT JOIN rsvps r ON r.invitation_id = i.id
    LEFT JOIN communications n ON n.guest_id = g.id AND n.event_id = g.event_id
      AND n.purpose = 'rsvp-followup' AND n.status IN ('QUEUED','SENT')
    WHERE g.event_id = ? AND g.status = 'approved' AND r.id IS NULL AND n.id IS NULL
    ORDER BY g.name ASC LIMIT ?`).all(req.eventId, cap);
  const event = db.prepare('SELECT name, date, venue FROM events WHERE id = ?').get(req.eventId);
  const text = (message && String(message).trim()) || `Hello! A reminder to RSVP for ${event.name} (${event.date || 'date TBC'}${event.venue ? `, ${event.venue}` : ''}). Please reply to your invitation link.`;
  const ins = db.prepare(`INSERT INTO communications (event_id, sender_id, guest_id, recipients_text, channel, message, purpose, status)
    VALUES (?, ?, ?, ?, ?, ?, 'rsvp-followup', 'QUEUED')`);
  const tx = db.transaction(() => {
    for (const c of candidates) ins.run(req.eventId, req.user.id, c.guest_id, `${c.name}${c.phone ? ` (${c.phone})` : ''}`, channel || 'WHATSAPP', text.slice(0, 2000));
  });
  tx();
  auditFromReq(req, { action: 'followup.nudges', entityType: 'event', entityId: req.eventId, eventId: req.eventId, metadata: { count: candidates.length } });
  res.status(201).json({ ok: true, queued: candidates.length, guest_ids: candidates.map((c) => c.guest_id) });
}));

export default router;
