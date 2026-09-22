// RaaS Phase 2 — shared helpers for operational modules.
// Every module: event-scoped, permission-gated, lifecycle-gated, audited.
// Conventions: list routes take ?event_id=; entity routes resolve event via
// lookup; creates honor Idempotency-Key; status moves validate the machine.

import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess, requirePermission } from '../middleware/authorize.js';
import { withIdempotency } from '../middleware/idempotency.js';
import { auditFromReq } from '../audit.js';
import { getLifecycle } from '../raas/readiness.js';
import { canOpsTransition, opsWritePolicy, nowDb } from '../raas/ops.js';

export { requireAuth, requireEventAccess, requireEntityEventAccess, requirePermission, withIdempotency, auditFromReq, getLifecycle, canOpsTransition, opsWritePolicy, nowDb };

// Gate writes by lifecycle: CLOSED/ARCHIVED block everything; CLOSING blocks creates.
export function opsGuard(isCreate) {
  return (req, res, next) => {
    const eventId = req.eventId || (req.body && (req.body.event_id || req.body.eventId));
    if (!eventId) return res.status(400).json({ error: 'event_id is required' });
    const policy = opsWritePolicy(getLifecycle(Number(eventId)), isCreate);
    if (!policy.ok) return res.status(409).json({ error: policy.error });
    next();
  };
}

// Validate + apply a status transition inside a handler. Returns true if ok,
// otherwise sends the error response. Sets `row.status = to` on success.
export function applyStatus({ machine, table, id, to, extra = {}, eventId, req, res, auditAction }) {
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!row) { res.status(404).json({ error: 'Not found' }); return false; }
  if (row.event_id !== Number(eventId)) { res.status(403).json({ error: 'No access to this event' }); return false; }
  if (!canOpsTransition(machine, row.status, to)) {
    res.status(409).json({ error: `Illegal transition ${row.status} → ${to}` });
    return false;
  }
  const sets = ['status = ?', "updated_at = strftime('%Y-%m-%d %H:%M:%f','now')"];
  const vals = [to];
  for (const [col, val] of Object.entries(extra)) { sets.push(`${col} = ?`); vals.push(val); }
  // Stamp actual_* on first entry into IN_PROGRESS / terminal states.
  if (table === 'schedule_items') {
    if (to === 'IN_PROGRESS' && !row.actual_start) { sets.push("actual_start = datetime('now')"); }
    if ((to === 'COMPLETED' || to === 'CANCELLED') && !row.actual_end) { sets.push("actual_end = datetime('now')"); }
  }
  if ((table === 'tasks' || table === 'incidents' || table === 'service_requests') && (to === 'COMPLETED' || to === 'FULFILLED' || to === 'RESOLVED' || to === 'CLOSED' || to === 'CANCELLED')) {
    if (table === 'tasks' && !row.completed_at) sets.push("completed_at = datetime('now')");
    if ((table === 'incidents' || table === 'service_requests') && !row.resolved_at) sets.push("resolved_at = datetime('now')");
  }
  vals.push(id);
  db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  auditFromReq(req, { action: auditAction, entityType: table, entityId: id, eventId: Number(eventId), metadata: { from: row.status, to } });
  return true;
}

export function fetchRow(table, id, eventId) {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ? AND event_id = ?`).get(id, eventId);
}

// Phase 5 §49 — optimistic concurrency. If the client sends the `updated_at`
// value it originally read, a mismatch means someone else wrote first:
// reject with 409 + the current record (deterministic, never silent).
// Absent `updated_at` = legacy last-write-wins (backward compatible).
export function checkFresh(row, body, res) {
  const baseline = body && body.updated_at !== undefined ? body.updated_at : undefined;
  if (baseline === undefined || baseline === null) return true;
  if (row.updated_at !== baseline) {
    res.status(409).json({
      error: 'This record changed since you loaded it. Reload and retry your change.',
      code: 'STALE_WRITE',
      current_updated_at: row.updated_at,
    });
    return false;
  }
  return true;
}
