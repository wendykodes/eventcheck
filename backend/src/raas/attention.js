// RaaS Phase 3 — Attention engine. Deterministic rules over operational facts.
// No scores, no AI: every item is explainable (source + entity + age + action).
// Read-model only: nothing here mutates operational state.

import db from '../database.js';
import { nowDb } from './ops.js';

function ageMin(ts) {
  if (!ts) return null;
  const ms = Date.now() - new Date(String(ts).replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / 60000);
}

const SEV_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };

// Escalation thresholds (minutes, deterministic). An item past its threshold
// is flagged escalation_due — visibility, not auto-mutation.
export const ESCALATION_THRESHOLDS = {
  incident_critical: 30,
  incident_high: 60,
  service_request: 60,
  task_overdue: 0,
};

export function getAttention(eventId, { includeAcked = false } = {}) {
  const items = [];
  const push = (source, severity, title, opts = {}) => {
    items.push({
      key: `${source}:${opts.entity_type || 'event'}:${opts.entity_id || '0'}`,
      event_id: eventId, source, severity, title,
      detail: opts.detail || null,
      entity_type: opts.entity_type || null,
      entity_id: opts.entity_id ?? null,
      age_min: opts.age_min ?? null,
      escalation_due: !!opts.escalation_due,
      action: opts.action || null,
    });
  };

  // Incidents
  const incidents = db.prepare("SELECT * FROM incidents WHERE event_id = ? AND status NOT IN ('RESOLVED','CLOSED')").all(eventId);
  for (const i of incidents) {
    const age = ageMin(i.created_at);
    if (i.severity === 'CRITICAL') {
      push('incident', 'CRITICAL', `CRITICAL incident: ${i.title}`, {
        detail: i.location || i.category || null, entity_type: 'incidents', entity_id: i.id, age_min: age,
        escalation_due: i.escalation_level > 0 || (age !== null && age >= ESCALATION_THRESHOLDS.incident_critical),
        action: i.assignee_user_id ? 'Resolve now' : 'Assign + resolve now',
      });
    } else if (i.escalation_level > 0) {
      push('incident', 'HIGH', `Escalated incident (L${i.escalation_level}): ${i.title}`, {
        entity_type: 'incidents', entity_id: i.id, age_min: age, escalation_due: true, action: 'Resolve now',
      });
    } else if (i.severity === 'HIGH') {
      push('incident', 'HIGH', `High incident: ${i.title}`, {
        entity_type: 'incidents', entity_id: i.id, age_min: age,
        escalation_due: age !== null && age >= ESCALATION_THRESHOLDS.incident_high, action: 'Assign + resolve',
      });
    } else {
      push('incident', 'MEDIUM', `Open incident: ${i.title}`, {
        entity_type: 'incidents', entity_id: i.id, age_min: age, action: 'Triage',
      });
    }
  }

  // Tasks
  const now = nowDb();
  const tasks = db.prepare("SELECT * FROM tasks WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED')").all(eventId);
  let overdueTasks = 0, unassigned = 0;
  for (const t of tasks) {
    if (t.due_at && t.due_at < now) {
      overdueTasks++;
      push('task', 'HIGH', `Overdue task: ${t.title}`, {
        detail: t.due_at ? `due ${t.due_at}` : null, entity_type: 'tasks', entity_id: t.id,
        age_min: ageMin(t.due_at), escalation_due: true, action: 'Complete or reassign',
      });
    }
    if (!t.assignee_user_id && t.status === 'OPEN') unassigned++;
  }
  if (unassigned > 0) {
    push('task', 'MEDIUM', `${unassigned} open task${unassigned > 1 ? 's' : ''} with no owner`, {
      entity_type: 'tasks', entity_id: null, action: 'Assign owners',
    });
  }

  // Schedule
  const sched = db.prepare("SELECT * FROM schedule_items WHERE event_id = ? AND status NOT IN ('COMPLETED','CANCELLED')").all(eventId);
  for (const s of sched) {
    if (s.planned_end && s.planned_end < now) {
      push('schedule', 'HIGH', `Overdue program item: ${s.title}`, {
        detail: s.planned_end ? `planned end ${s.planned_end}` : null, entity_type: 'schedule_items', entity_id: s.id, escalation_due: true, action: 'Complete or reschedule',
      });
    } else if (s.planned_start && !['IN_PROGRESS'].includes(s.status)) {
      const startMs = new Date(String(s.planned_start).replace(' ', 'T') + 'Z').getTime() - Date.now();
      if (Number.isFinite(startMs) && startMs > 0 && startMs <= 3600000) {
        push('schedule', 'MEDIUM', `Starting soon: ${s.title}`, {
          detail: `planned ${s.planned_start}`, entity_type: 'schedule_items', entity_id: s.id, action: s.status === 'READY' ? 'Begin now' : 'Get ready',
        });
      }
    }
  }

  // Service requests (aging)
  const reqs = db.prepare("SELECT * FROM service_requests WHERE event_id = ? AND status NOT IN ('FULFILLED','CLOSED','CANCELLED')").all(eventId);
  for (const r of reqs) {
    const age = ageMin(r.created_at);
    const stale = age !== null && age >= ESCALATION_THRESHOLDS.service_request;
    if (r.priority === 'CRITICAL' || stale) {
      push('request', r.priority === 'CRITICAL' ? 'HIGH' : 'MEDIUM', `Waiting request: ${r.description ? String(r.description).slice(0, 80) : r.category || 'request'}`, {
        entity_type: 'service_requests', entity_id: r.id, age_min: age, escalation_due: stale, action: r.assignee_user_id ? 'Fulfill now' : 'Assign + fulfill',
      });
    }
  }

  // Vendors
  const vendors = db.prepare('SELECT * FROM vendors WHERE event_id = ?').all(eventId);
  for (const v of vendors) {
    if (v.status === 'ISSUE') {
      push('vendor', 'HIGH', `Vendor issue: ${v.name}`, {
        detail: v.service || null, entity_type: 'vendors', entity_id: v.id, escalation_due: true, action: 'Contact vendor',
      });
    } else if (v.status === 'EXPECTED' && v.arrival_time && v.arrival_time < now) {
      push('vendor', 'HIGH', `Vendor not arrived: ${v.name}`, {
        detail: `expected ${v.arrival_time}`, entity_type: 'vendors', entity_id: v.id, age_min: ageMin(v.arrival_time), escalation_due: true, action: 'Contact vendor',
      });
    }
  }

  // Transport
  const delayed = db.prepare("SELECT * FROM transport_routes WHERE event_id = ? AND status = 'DELAYED'").all(eventId);
  for (const t of delayed) {
    push('transport', 'MEDIUM', `Transport delayed: ${t.name}`, {
      entity_type: 'transport_routes', entity_id: t.id, action: 'Update passengers',
    });
  }

  // Staffing gap on live events
  const event = db.prepare('SELECT lifecycle_state FROM events WHERE id = ?').get(eventId);
  if (event && event.lifecycle_state === 'ACTIVE') {
    const staff = db.prepare('SELECT COUNT(*) AS c FROM (SELECT user_id FROM user_events WHERE event_id = ? UNION SELECT user_id FROM event_user_roles WHERE event_id = ?)').get(eventId, eventId).c;
    if (staff === 0) {
      push('staffing', 'HIGH', 'Active event has no assigned staff', { action: 'Assign staff now' });
    }
  }

  // Attendance anomaly: more arrivals than guest list
  const invited = db.prepare("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").get(eventId).c;
  const checked = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?').get(eventId).c;
  if (invited > 0 && checked > invited) {
    push('checkin', 'MEDIUM', `More arrivals (${checked}) than guest list (${invited})`, { action: 'Review door control' });
  }

  // RSVP silence on preparing events
  if (event && ['READY', 'CONFIGURING'].includes(event.lifecycle_state) && invited >= 10) {
    const resp = db.prepare('SELECT COUNT(*) AS c FROM rsvps WHERE event_id = ?').get(eventId).c;
    if (invited - resp > invited / 2) {
      push('rsvp', 'MEDIUM', `${invited - resp} of ${invited} guests have not responded`, { action: 'Follow up invitations' });
    }
  }

  // Ack filtering (scoped, reversible, audited at write time)
  let filtered = items;
  if (!includeAcked) {
    try {
      const acked = new Set(db.prepare('SELECT key FROM alert_acks WHERE event_id = ?').all(eventId).map((r) => r.key));
      filtered = items.filter((i) => !acked.has(i.key));
    } catch {}
  }

  filtered.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || ((b.age_min || 0) - (a.age_min || 0)));
  return filtered;
}

export function getHealth(eventId, attention = null) {
  const att = attention || getAttention(eventId);
  const reasons = [];
  let status = 'OK';
  for (const a of att) {
    if (a.severity === 'CRITICAL') {
      status = 'CRITICAL';
      reasons.push(a.title);
    } else if (a.severity === 'HIGH' && status !== 'CRITICAL') {
      status = 'WATCH';
      reasons.push(a.title);
    } else if (a.severity === 'MEDIUM' && status === 'OK') {
      status = 'WATCH';
    }
  }
  if (status === 'WATCH' && reasons.length === 0) {
    reasons.push(...att.filter((a) => a.severity === 'MEDIUM').map((a) => a.title));
  }
  return { event_id: eventId, status, reasons: reasons.slice(0, 10), attention_count: att.length };
}
