// RaaS Phase 4 — Managed-service delivery: intakes → runbooks → fallback
// exports → comms → decisions → customer results. All event-scoped, audited.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess } from '../middleware/authorize.js';
import { auditFromReq, logAudit } from '../audit.js';
import { getLifecycle, getReadiness } from '../raas/readiness.js';
import { getAttention, getHealth } from '../raas/attention.js';
import { defaultsForTemplate } from '../raas/runbooks.js';
import { opsGuard } from './opsCommon.js';

const router = Router();
router.use(requireAuth);

// Post-event reconciliation stays possible: only ARCHIVED is fully frozen
// for updates/decisions/checks. Creates follow the standard ops policy.
function unlessArchived(req, res, next) {
  const eventId = req.eventId;
  const lc = getLifecycle(Number(eventId));
  if (lc === 'ARCHIVED') return res.status(409).json({ error: 'Event is ARCHIVED.' });
  next();
}

// ---------- 4.1 Intakes (customer handover → event) ----------
router.get('/intakes', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT i.*, u.name AS assignee_name FROM intakes i LEFT JOIN users u ON u.id = i.assignee_user_id ORDER BY i.id DESC').all());
});

router.post('/intakes', requireAdmin, (req, res) => {
  const { customer_name, customer_phone, event_type, event_date, venue, expected_attendance, services, requirements, assignee_user_id } = req.body;
  if (!customer_name || !String(customer_name).trim()) return res.status(400).json({ error: 'customer_name is required' });
  const r = db.prepare(`INSERT INTO intakes (customer_name, customer_phone, event_type, event_date, venue, expected_attendance, services_json, requirements, assignee_user_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(String(customer_name).trim(), customer_phone || null, event_type || null, event_date || null, venue || null,
      expected_attendance || null, JSON.stringify(services || []), requirements || null, assignee_user_id || null, req.user.id);
  auditFromReq(req, { action: 'intake.create', entityType: 'intakes', entityId: r.lastInsertRowid });
  res.status(201).json(db.prepare('SELECT * FROM intakes WHERE id = ?').get(r.lastInsertRowid));
});

router.post('/intakes/:id/convert', requireAdmin, (req, res) => {
  const intake = db.prepare('SELECT * FROM intakes WHERE id = ?').get(req.params.id);
  if (!intake) return res.status(404).json({ error: 'Intake not found' });
  if (intake.status === 'CONVERTED' && intake.converted_event_id) {
    return res.json({ ok: true, event_id: intake.converted_event_id, reused: true });
  }
  if (!['NEW', 'REVIEWED'].includes(intake.status)) return res.status(409).json({ error: `Intake is ${intake.status}` });
  const { template_key } = req.body;
  const tpl = template_key || 'private_celebration';
  if (!db.prepare('SELECT key FROM event_templates WHERE key = ?').get(tpl)) return res.status(400).json({ error: `Unknown template_key: ${tpl}` });
  const tx = db.transaction(() => {
    const ev = db.prepare(`INSERT INTO events (name, date, venue, status, template_key, lifecycle_state, expected_attendance, onboarding_method)
      VALUES (?, ?, ?, 'upcoming', ?, 'DRAFT', ?, 'approval')`)
      .run(`${intake.customer_name} — ${intake.event_type || 'Event'}`, intake.event_date || '', intake.venue || '', tpl, intake.expected_attendance);
    db.prepare("INSERT INTO activities (event_id, name, sort_order) VALUES (?, 'General Check-In', 0)").run(ev.lastInsertRowid);
    db.prepare("UPDATE intakes SET status = 'CONVERTED', converted_event_id = ?, updated_at = datetime('now') WHERE id = ?").run(ev.lastInsertRowid, intake.id);
    if (intake.assignee_user_id) {
      db.prepare('INSERT OR IGNORE INTO user_events (user_id, event_id) VALUES (?, ?)').run(intake.assignee_user_id, ev.lastInsertRowid);
      db.prepare('INSERT OR IGNORE INTO event_user_roles (event_id, user_id, role_key) VALUES (?, ?, ?)').run(ev.lastInsertRowid, intake.assignee_user_id, 'raas_operator');
    }
    return ev.lastInsertRowid;
  });
  const eventId = tx();
  auditFromReq(req, { action: 'intake.convert', entityType: 'intakes', entityId: req.params.id, eventId, metadata: { template_key: tpl } });
  res.status(201).json({ ok: true, event_id: eventId });
});

router.post('/intakes/:id/status', requireAdmin, (req, res) => {
  const { to } = req.body;
  if (!['NEW', 'REVIEWED', 'CANCELLED'].includes(to)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE intakes SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, req.params.id);
  auditFromReq(req, { action: 'intake.status', entityType: 'intakes', entityId: req.params.id, metadata: { to } });
  res.json({ ok: true, status: to });
});

// ---------- 4.6 Decision requests ----------
function decisionEventId(req) {
  const row = db.prepare('SELECT event_id FROM decisions WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/decisions', requireEventAccess(), (req, res) => {
  const { status } = req.query;
  let q = 'SELECT d.*, u.name AS decided_by_name FROM decisions d LEFT JOIN users u ON u.id = d.decided_by WHERE d.event_id = ?';
  const p = [req.eventId];
  if (status) { q += ' AND d.status = ?'; p.push(status); }
  res.json(db.prepare(q + ' ORDER BY d.id DESC').all(...p));
});

router.post('/decisions', requireEventAccess(), opsGuard(true), (req, res) => {
  const { title, reason, options } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  const r = db.prepare('INSERT INTO decisions (event_id, title, reason, options_json, requested_by) VALUES (?, ?, ?, ?, ?)')
    .run(req.eventId, String(title).trim(), reason || null, JSON.stringify(options || []), req.user.id);
  auditFromReq(req, { action: 'decision.request', entityType: 'decisions', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM decisions WHERE id = ?').get(r.lastInsertRowid));
});

router.post('/decisions/:id/decide', requireEntityEventAccess(decisionEventId), unlessArchived, (req, res) => {
  const { decision } = req.body;
  if (!decision || !String(decision).trim()) return res.status(400).json({ error: 'decision is required' });
  const row = db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.status !== 'OPEN') return res.status(409).json({ error: `Decision is ${row.status}` });
  db.prepare("UPDATE decisions SET status = 'DECIDED', decision = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(String(decision).trim().slice(0, 1000), req.user.id, req.params.id);
  auditFromReq(req, { action: 'decision.decide', entityType: 'decisions', entityId: req.params.id, eventId: req.eventId, metadata: { decision: String(decision).trim().slice(0, 200) } });
  res.json(db.prepare('SELECT * FROM decisions WHERE id = ?').get(req.params.id));
});

// ---------- 4.7 Runbooks ----------
router.get('/runbook', requireEventAccess(), (req, res) => {
  res.json(db.prepare('SELECT r.*, u.name AS done_by_name FROM runbook_items r LEFT JOIN users u ON u.id = r.done_by WHERE r.event_id = ? ORDER BY r.phase ASC, r.sort_order ASC').all(req.eventId));
});

router.post('/runbook/materialize', requireEventAccess(), opsGuard(true), (req, res) => {
  const existing = db.prepare('SELECT COUNT(*) AS c FROM runbook_items WHERE event_id = ?').get(req.eventId).c;
  if (existing > 0) return res.json({ ok: true, reused: true, count: existing });
  const event = db.prepare('SELECT template_key FROM events WHERE id = ?').get(req.eventId);
  const items = defaultsForTemplate(event ? event.template_key : 'private_celebration');
  const ins = db.prepare('INSERT INTO runbook_items (event_id, phase, title, sort_order) VALUES (?, ?, ?, ?)');
  const tx = db.transaction(() => { for (const it of items) ins.run(req.eventId, it.phase, it.title, it.sort_order); });
  tx();
  auditFromReq(req, { action: 'runbook.materialize', entityType: 'event', entityId: req.eventId, eventId: req.eventId, metadata: { count: items.length } });
  res.status(201).json({ ok: true, count: items.length });
});

function runbookItemEventId(req) {
  const row = db.prepare('SELECT event_id FROM runbook_items WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.post('/runbook-items/:id/check', requireEntityEventAccess(runbookItemEventId), unlessArchived, (req, res) => {
  const { done } = req.body;
  const row = db.prepare('SELECT * FROM runbook_items WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const d = done === undefined ? !row.done : !!done;
  db.prepare('UPDATE runbook_items SET done = ?, done_by = ?, done_at = CASE WHEN ? THEN datetime(\'now\') ELSE NULL END WHERE id = ?')
    .run(d ? 1 : 0, d ? req.user.id : null, d ? 1 : 0, req.params.id);
  auditFromReq(req, { action: d ? 'runbook.check' : 'runbook.uncheck', entityType: 'runbook_items', entityId: req.params.id, eventId: req.eventId, metadata: { title: row.title } });
  res.json(db.prepare('SELECT * FROM runbook_items WHERE id = ?').get(req.params.id));
});

// ---------- 4.9 Devices ----------
function deviceEventId(req) {
  const row = db.prepare('SELECT event_id FROM devices WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/devices', requireEventAccess(), (req, res) => {
  res.json(db.prepare(`SELECT d.*, u.name AS assignee_name FROM devices d LEFT JOIN users u ON u.id = d.assigned_to
    WHERE d.event_id = ? ORDER BY d.label ASC`).all(req.eventId));
});

router.post('/devices', requireEventAccess(), opsGuard(true), (req, res) => {
  const { label, kind, assigned_to, notes } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  const r = db.prepare('INSERT INTO devices (event_id, label, kind, assigned_to, notes) VALUES (?, ?, ?, ?, ?)')
    .run(req.eventId, String(label).trim(), kind || 'PHONE', assigned_to || null, notes || null);
  auditFromReq(req, { action: 'device.add', entityType: 'devices', entityId: r.lastInsertRowid, eventId: req.eventId });
  res.status(201).json(db.prepare('SELECT * FROM devices WHERE id = ?').get(r.lastInsertRowid));
});

router.post('/devices/:id/status', requireEntityEventAccess(deviceEventId), unlessArchived, (req, res) => {
  const { to } = req.body;
  if (!['READY', 'DEPLOYED', 'ISSUE', 'RETURNED'].includes(to)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE devices SET status = ?, updated_at = datetime('now') WHERE id = ?").run(to, req.params.id);
  auditFromReq(req, { action: 'device.status', entityType: 'devices', entityId: req.params.id, eventId: req.eventId, metadata: { to } });
  res.json(db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id));
});

// ---------- 4.10 Communications (provider-agnostic object) ----------
function commEventId(req) {
  const row = db.prepare('SELECT event_id FROM communications WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}

router.get('/comms', requireEventAccess(), (req, res) => {
  res.json(db.prepare(`SELECT c.*, u.name AS sender_name FROM communications c LEFT JOIN users u ON u.id = c.sender_id
    WHERE c.event_id = ? ORDER BY c.id DESC LIMIT 100`).all(req.eventId));
});

router.post('/comms', requireEventAccess(), opsGuard(true), (req, res) => {
  const { recipients_text, channel, message, purpose } = req.body;
  if (!message || !String(message).trim()) return res.status(400).json({ error: 'message is required' });
  if (channel && !['WHATSAPP', 'SMS', 'EMAIL', 'IN_APP', 'OPERATOR'].includes(channel)) return res.status(400).json({ error: 'Invalid channel' });
  const r = db.prepare('INSERT INTO communications (event_id, sender_id, recipients_text, channel, message, purpose) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.eventId, req.user.id, recipients_text || null, channel || 'OPERATOR', String(message).trim().slice(0, 2000), purpose || null);
  auditFromReq(req, { action: 'comm.create', entityType: 'communications', entityId: r.lastInsertRowid, eventId: req.eventId, metadata: { channel: channel || 'OPERATOR' } });
  res.status(201).json(db.prepare('SELECT * FROM communications WHERE id = ?').get(r.lastInsertRowid));
});

router.post('/comms/:id/status', requireEntityEventAccess(commEventId), unlessArchived, (req, res) => {
  const { to } = req.body;
  if (!['QUEUED', 'SENT', 'FAILED', 'DRAFT'].includes(to)) return res.status(400).json({ error: 'Invalid status' });
  const row = db.prepare('SELECT * FROM communications WHERE id = ?').get(req.params.id);
  db.prepare(`UPDATE communications SET status = ?, sent_at = CASE WHEN ? = 'SENT' THEN datetime('now') ELSE sent_at END,
    retry_count = CASE WHEN ? = 'FAILED' THEN retry_count + 1 ELSE retry_count END, updated_at = datetime('now') WHERE id = ?`)
    .run(to, to, to, req.params.id);
  auditFromReq(req, { action: 'comm.status', entityType: 'communications', entityId: req.params.id, eventId: req.eventId, metadata: { from: row.status, to } });
  res.json(db.prepare('SELECT * FROM communications WHERE id = ?').get(req.params.id));
});

// ---------- 4.8 Physical fallback exports (audited, scoped) ----------
function csv(rows, cols) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

router.get('/event/:eventId/export/guests.csv', requireEventAccess(), (req, res) => {
  const rows = db.prepare(`SELECT g.name, g.phone, g.table_number, g.guest_count, g.category,
    CASE WHEN r.status = 'CONFIRMED' THEN 'confirmed' WHEN r.status = 'DECLINED' THEN 'declined' ELSE 'no_response' END AS rsvp,
    (SELECT COUNT(*) FROM checkins c WHERE c.guest_id = g.id) AS checkins,
    (SELECT z.name FROM seat_assignments sa JOIN seating_zones z ON z.id = sa.zone_id WHERE sa.guest_id = g.id LIMIT 1) AS seat
    FROM guests g LEFT JOIN invitations i ON i.guest_id = g.id AND i.event_id = g.event_id AND i.status = 'pending'
    LEFT JOIN rsvps r ON r.invitation_id = i.id WHERE g.event_id = ? AND g.status = 'approved' ORDER BY g.name ASC`).all(req.eventId);
  auditFromReq(req, { action: 'export.guests', entityType: 'event', entityId: req.eventId, eventId: req.eventId, metadata: { count: rows.length } });
  res.type('text/csv').send(csv(rows, ['name', 'phone', 'table_number', 'guest_count', 'category', 'rsvp', 'checkins', 'seat']));
});

router.get('/event/:eventId/export/staff.csv', requireEventAccess(), (req, res) => {
  const rows = db.prepare(`SELECT u.name, COALESCE(eur.role_key, 'staff') AS role, eur.zone FROM users u
    LEFT JOIN event_user_roles eur ON eur.user_id = u.id AND eur.event_id = ?
    JOIN user_events ue ON ue.user_id = u.id AND ue.event_id = ? ORDER BY u.name ASC`).all(req.eventId, req.eventId);
  auditFromReq(req, { action: 'export.staff', entityType: 'event', entityId: req.eventId, eventId: req.eventId, metadata: { count: rows.length } });
  res.type('text/csv').send(csv(rows, ['name', 'role', 'zone']));
});

router.get('/event/:eventId/export/brief.txt', requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.eventId);
  const sched = db.prepare('SELECT title, planned_start, location FROM schedule_items WHERE event_id = ? ORDER BY planned_start ASC').all(req.eventId);
  const vendors = db.prepare('SELECT name, service, contact_phone, status FROM vendors WHERE event_id = ?').all(req.eventId);
  const contacts = db.prepare(`SELECT u.name, u.phone FROM users u JOIN user_events ue ON ue.user_id = u.id WHERE ue.event_id = ?`).all(req.eventId);
  auditFromReq(req, { action: 'export.brief', entityType: 'event', entityId: req.eventId, eventId: req.eventId });
  const lines = [
    `EVENT BRIEF — ${event.name}`, `${event.date || ''} ${event.venue || ''}`.trim(), `Status: ${event.lifecycle_state}`, '',
    'PROGRAM:', ...sched.map((s) => ` - ${s.planned_start || '?'} ${s.title}${s.location ? ` @ ${s.location}` : ''}`), '',
    'VENDORS:', ...vendors.map((v) => ` - ${v.name} (${v.service || '?'}) ${v.contact_phone || ''} [${v.status}]`), '',
    'STAFF CONTACTS:', ...contacts.map((c) => ` - ${c.name} ${c.phone || ''}`),
  ];
  res.type('text/plain').send(lines.join('\n'));
});

// ---------- 4.2 Expanded readiness (gap-identifying sections, not a %) ----------
router.get('/event/:eventId/readiness-full', requireEventAccess(), (req, res) => {
  const base = getReadiness(req.eventId);
  const q = (sql, ...a) => db.prepare(sql).get(req.eventId, ...a);
  const sections = [
    { key: 'event_info', label: 'Event information complete', pass: !base.blocking_failed.some((k) => ['name', 'date', 'venue'].includes(k)) },
    { key: 'guests', label: `${q("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").c} approved guests`, pass: !base.blocking_failed.includes('guests') },
    { key: 'invitations', label: 'Invitations prepared', pass: q('SELECT COUNT(*) AS c FROM invitations WHERE event_id = ? AND guest_id IS NOT NULL').c > 0, detail: q('SELECT COUNT(*) AS c FROM invitations WHERE event_id = ? AND guest_id IS NOT NULL').c },
    { key: 'rsvp', label: 'RSVP progress', pass: true, detail: (() => { const t = q("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").c; const r = q('SELECT COUNT(*) AS c FROM rsvps WHERE event_id = ?').c; return `${r}/${t} responded`; })() },
    { key: 'staffing', label: 'Staffing ready', pass: db.prepare('SELECT COUNT(*) AS c FROM (SELECT user_id FROM user_events WHERE event_id = ? UNION SELECT user_id FROM event_user_roles WHERE event_id = ?)').get(req.eventId, req.eventId).c > 0 },
    { key: 'vendors', label: 'Vendors confirmed', pass: db.prepare("SELECT COUNT(*) AS c FROM vendors WHERE event_id = ? AND (status = 'ISSUE' OR (status = 'EXPECTED' AND arrival_time IS NOT NULL AND arrival_time < datetime('now')))").get(req.eventId).c === 0, detail: `${db.prepare("SELECT COUNT(*) AS c FROM vendors WHERE event_id = ? AND status NOT IN ('ARRIVED','DEPARTED')").get(req.eventId).c} pending` },
    { key: 'schedule', label: 'Schedule complete', pass: q('SELECT COUNT(*) AS c FROM schedule_items WHERE event_id = ?').c > 0 },
    { key: 'seating', label: 'Seating ready', pass: (() => { const z = q('SELECT COUNT(*) AS c FROM seating_zones WHERE event_id = ?').c; if (!z) return true; return q('SELECT COUNT(*) AS c FROM seat_assignments WHERE event_id = ?').c > 0; })() },
    { key: 'transport', label: 'Transport ready', pass: q("SELECT COUNT(*) AS c FROM transport_routes WHERE event_id = ? AND status IN ('PLANNED','DELAYED')").c === 0 },
    { key: 'stays', label: 'Accommodation ready', pass: true },
    { key: 'devices', label: 'Devices ready', pass: q("SELECT COUNT(*) AS c FROM devices WHERE event_id = ? AND status NOT IN ('READY','DEPLOYED','RETURNED')").c === 0, detail: `${q('SELECT COUNT(*) AS c FROM devices WHERE event_id = ?').c} registered` },
    { key: 'runbook', label: 'Runbook progress', pass: true, detail: (() => { const t = q('SELECT COUNT(*) AS c FROM runbook_items WHERE event_id = ?').c; const d = q('SELECT COUNT(*) AS c FROM runbook_items WHERE event_id = ? AND done = 1').c; return t ? `${d}/${t} checked` : 'not materialized'; })() },
    { key: 'rehearsal', label: 'Rehearsal completed', pass: logAudit && !!q("SELECT COUNT(*) AS c FROM audit_log WHERE event_id = ? AND action = 'rehearsal.complete'").c },
  ];
  res.json({ event_id: req.eventId, lifecycle_state: base.lifecycle_state, activation_ready: base.ready, sections });
});

// ---------- 4.4 Customer summary (results + status, no operational noise) ----------
router.get('/event/:eventId/customer-summary', requireEventAccess(), (req, res) => {
  const event = db.prepare('SELECT id, name, date, venue, lifecycle_state, template_key FROM events WHERE id = ?').get(req.eventId);
  const invited = db.prepare("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").get(req.eventId).c;
  const agg = db.prepare(`SELECT SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN r.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined FROM rsvps r WHERE r.event_id = ?`).get(req.eventId);
  const checked = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?').get(req.eventId).c;
  const decisions = db.prepare("SELECT id, title, reason, status, decision FROM decisions WHERE event_id = ? AND status = 'OPEN'").all(req.eventId);
  const notes = db.prepare("SELECT body, created_at FROM operator_notes WHERE event_id = ? AND visibility = 'CUSTOMER' ORDER BY id DESC LIMIT 10").all(req.eventId);
  res.json({
    event, rsvp: { invited, confirmed: agg.confirmed || 0, declined: agg.declined || 0, no_response: Math.max(0, invited - (agg.confirmed || 0) - (agg.declined || 0)) },
    attendance: { checked_in: checked, pct: invited ? Math.round((checked / invited) * 100) : 0 },
    decisions_needing_you: decisions, updates: notes,
  });
});

// ---------- 4.11 Premium results package (all derived from source records) ----------
router.get('/event/:eventId/results', requireEventAccess(), (req, res) => {
  const base = db.prepare('SELECT * FROM events WHERE id = ?').get(req.eventId);
  const guests = db.prepare(`SELECT COUNT(*) AS invited,
    SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN r.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined
    FROM guests g LEFT JOIN invitations i ON i.guest_id = g.id AND i.event_id = g.event_id AND i.status = 'pending'
    LEFT JOIN rsvps r ON r.invitation_id = i.id WHERE g.event_id = ? AND g.status = 'approved'`).get(req.eventId);
  const checked = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?').get(req.eventId).c;
  const incidents = db.prepare(`SELECT status, COUNT(*) AS c FROM incidents WHERE event_id = ? GROUP BY status`).all(req.eventId);
  const requests = db.prepare(`SELECT status, COUNT(*) AS c FROM service_requests WHERE event_id = ? GROUP BY status`).all(req.eventId);
  const schedVar = db.prepare(`SELECT title, planned_start, actual_start, planned_end, actual_end, status FROM schedule_items
    WHERE event_id = ? AND (actual_start IS NOT NULL OR status IN ('DELAYED','COMPLETED'))`).all(req.eventId);
  const open = db.prepare(`SELECT 'incident' AS kind, id, title, status FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')
    UNION ALL SELECT 'request', id, description, status FROM service_requests WHERE event_id = ? AND status NOT IN ('FULFILLED','CLOSED','CANCELLED')
    UNION ALL SELECT 'decision', id, title, status FROM decisions WHERE event_id = ? AND status = 'OPEN'`).all(req.eventId, req.eventId, req.eventId);
  const auditCount = db.prepare('SELECT COUNT(*) AS c FROM audit_log WHERE event_id = ?').get(req.eventId).c;
  const timeline = db.prepare(`SELECT action, created_at FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT 25`).all(req.eventId);
  const report = {
    event: { id: base.id, name: base.name, date: base.date, venue: base.venue, lifecycle_state: base.lifecycle_state, template_key: base.template_key },
    guests: { ...guests, no_response: Math.max(0, guests.invited - (guests.confirmed || 0) - (guests.declined || 0)) },
    attendance: { checked_in: checked, pct: guests.invited ? Math.round((checked / guests.invited) * 100) : 0 },
    incidents, requests, schedule_variance: schedVar, unresolved: open,
    audit_entries: auditCount, key_timeline: timeline, generated_at: new Date().toISOString(),
  };
  auditFromReq(req, { action: 'report.generate', entityType: 'event', entityId: req.eventId, eventId: req.eventId, metadata: { package: 'premium-results' } });
  res.json(report);
});

export default router;
