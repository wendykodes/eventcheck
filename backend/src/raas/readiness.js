// RaaS Phase 1 — Event readiness validation (Workstream 1, §6).
// Prevents accidental ACTIVE while critical configuration is incomplete.
// Keep minimal: block only on missing essentials, warn on the rest.

import db from '../database.js';

export function getReadiness(eventId) {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  if (!event) return { ready: false, checks: [], error: 'Event not found' };
  const guestCount = db.prepare("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").get(eventId).c;
  const activityCount = db.prepare('SELECT COUNT(*) AS c FROM activities WHERE event_id = ?').get(eventId).c;
  const staffCount = db.prepare(
    'SELECT COUNT(*) AS c FROM (SELECT user_id FROM user_events WHERE event_id = ? UNION SELECT user_id FROM event_user_roles WHERE event_id = ?)'
  ).get(eventId, eventId).c;

  const checks = [
    { key: 'name', label: 'Event name', pass: !!(event.name && event.name.trim()), blocking: true },
    { key: 'date', label: 'Event date', pass: !!(event.date && String(event.date).trim()), blocking: true },
    { key: 'venue', label: 'Venue / location', pass: !!(event.venue && String(event.venue).trim()), blocking: true },
    { key: 'guests', label: 'At least 1 approved guest', pass: guestCount > 0, blocking: true, detail: guestCount },
    { key: 'activities', label: 'At least 1 check-in point', pass: activityCount > 0, blocking: true, detail: activityCount },
    { key: 'staff', label: 'Staff assigned', pass: staffCount > 0, blocking: false, detail: staffCount },
    { key: 'access', label: 'Staff access code set', pass: !!event.staff_access_code, blocking: false },
  ];
  const blockingFailed = checks.filter((c) => c.blocking && !c.pass);
  return {
    event_id: eventId,
    lifecycle_state: event.lifecycle_state,
    ready: blockingFailed.length === 0,
    blocking_failed: blockingFailed.map((c) => c.key),
    checks,
  };
}

// Closure policy (Workstream 7, §31-32):
// CLOSED/ARCHIVED → all operational writes blocked (reads + reports allowed).
// CLOSING → guest create/import blocked, check-in + RSVP still allowed (late arrivals).
export function writePolicy(lifecycleState, kind) {
  if (lifecycleState === 'CLOSED' || lifecycleState === 'ARCHIVED') {
    return { ok: false, error: `Event is ${lifecycleState}. Operational writes are disabled.` };
  }
  if (lifecycleState === 'CLOSING' && (kind === 'guest.create' || kind === 'guest.import' || kind === 'guest.delete')) {
    return { ok: false, error: 'Event is CLOSING. Guest list is frozen; check-in and reporting remain available.' };
  }
  return { ok: true };
}

export function getLifecycle(eventId) {
  const row = db.prepare('SELECT lifecycle_state FROM events WHERE id = ?').get(eventId);
  return row ? row.lifecycle_state || 'DRAFT' : null;
}
