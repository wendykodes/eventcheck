// RaaS Phase 0 — tamper-resistant audit log helper.
// Spec §17, §50: record access, check-ins, changes, permission/role changes,
// incidents, admin actions, exports, revocations, financial actions.

import db from './database.js';

export function logAudit({ eventId = null, actorId = null, action, entityType = null, entityId = null, metadata = null, ip = null }) {
  try {
    db.prepare(`
      INSERT INTO audit_log (event_id, actor_id, action, entity_type, entity_id, metadata_json, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      actorId,
      action,
      entityType,
      entityId != null ? String(entityId) : null,
      metadata ? JSON.stringify(metadata) : null,
      ip || null,
    );
  } catch (err) {
    // Audit must never break the operational path, but must be visible.
    console.error('Audit log write failed:', err.message);
  }
}

export function auditFromReq(req, { action, entityType = null, entityId = null, metadata = null, eventId = null }) {
  logAudit({
    eventId,
    actorId: req.user ? req.user.id : null,
    action,
    entityType,
    entityId,
    metadata,
    ip: req.ip || req.headers['x-forwarded-for'] || null,
  });
}
