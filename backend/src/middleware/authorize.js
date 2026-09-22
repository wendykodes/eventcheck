// RaaS Phase 0 — central authorization engine.
// Spec §10-13, §27, §72:
//   Identity → Organization membership → Event membership → Role → Permission → Scope → Action
// Enforces event isolation: Event A must never expose Event B.

import db from '../database.js';
import { PLATFORM_BASELINE } from '../raas/permissions.js';

// Resolve the event_id relevant to this request from params/query/body.
export function resolveEventId(req) {
  if (req.params) {
    // /api/events/:id, /api/dashboard/:event_id, /api/staff/stats/:id (user id, not event — caller handles)
    if (req.params.eventId) return Number(req.params.eventId);
    if (req.params.event_id) return Number(req.params.event_id);
    if (req.params.id && req.baseUrl && req.baseUrl.includes('/events')) return Number(req.params.id);
    if (req.params.importId) return null;
  }
  if (req.query) {
    if (req.query.event_id) return Number(req.query.event_id);
    if (req.query.eventId) return Number(req.query.eventId);
    if (req.query.event) return Number(req.query.event);
  }
  if (req.body && typeof req.body === 'object') {
    if (req.body.event_id) return Number(req.body.event_id);
    if (req.body.eventId) return Number(req.body.eventId);
  }
  return null;
}

export function userHasEventAccess(userId, platformRole, eventId) {
  if (!eventId || Number.isNaN(eventId)) return false;
  if (platformRole === 'admin') return true; // admins see all, but every access is audited
  const link = db.prepare('SELECT 1 FROM user_events WHERE user_id = ? AND event_id = ?').get(userId, eventId);
  if (link) return true;
  const role = db.prepare('SELECT 1 FROM event_user_roles WHERE user_id = ? AND event_id = ?').get(userId, eventId);
  if (role) return true;
  // Break-glass (§51/4.5): explicit, reason-required, time-limited emergency
  // access. Checked at the single membership choke point so it scopes exactly
  // one event and expires automatically. Grant/revoke are audited.
  try {
    const bg = db.prepare(`SELECT 1 FROM break_glass_grants WHERE user_id = ? AND event_id = ?
      AND revoked_at IS NULL AND expires_at > datetime('now')`).get(userId, eventId);
    if (bg) return true;
  } catch {}
  return false;
}

export function viaBreakGlass(userId, eventId) {
  try {
    const bg = db.prepare(`SELECT id FROM break_glass_grants WHERE user_id = ? AND event_id = ?
      AND revoked_at IS NULL AND expires_at > datetime('now')`).get(userId, eventId);
    return bg ? bg.id : null;
  } catch { return null; }
}

// Resolve effective permissions for a user within an event:
// event-specific role rows (union) + platform baseline fallback.
export function effectivePermissions(userId, platformRole, eventId) {
  if (platformRole === 'admin') return null; // null = all (admin bypass, audited)
  const rows = eventId
    ? db.prepare('SELECT role_key FROM event_user_roles WHERE user_id = ? AND event_id = ?').all(userId, eventId)
    : [];
  const perms = new Set(PLATFORM_BASELINE[platformRole] || []);
  // Staff without explicit event assignment get baseline only if assigned via user_events.
  // Membership itself is checked separately; here we just union role grants.
  for (const r of rows) {
    const grants = db.prepare('SELECT permission FROM role_permissions WHERE role_key = ?').all(r.role_key);
    for (const g of grants) perms.add(g.permission);
  }
  return perms;
}

// Gate: user must have access to the resolved event.
export function requireEventAccess({ allowAdmin = true } = {}) {
  return (req, res, next) => {
    const eventId = resolveEventId(req);
    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'event_id is required' });
    }
    if (req.user.role === 'admin' && allowAdmin) {
      req.eventId = eventId;
      return next();
    }
    if (!userHasEventAccess(req.user.id, req.user.role, eventId)) {
      return res.status(403).json({ error: 'No access to this event' });
    }
    req.eventId = eventId;
    next();
  };
}

// Gate: user must hold a specific permission within the resolved event.
export function requirePermission(...permissions) {
  return (req, res, next) => {
    const eventId = req.eventId || resolveEventId(req);
    if (req.user.role === 'admin') {
      if (eventId) req.eventId = eventId;
      return next();
    }
    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ error: 'event_id is required' });
    }
    if (!userHasEventAccess(req.user.id, req.user.role, eventId)) {
      return res.status(403).json({ error: 'No access to this event' });
    }
    const effective = effectivePermissions(req.user.id, req.user.role, eventId);
    const missing = permissions.filter((p) => !effective.has(p));
    if (missing.length > 0) {
      return res.status(403).json({ error: `Missing permission: ${missing.join(', ')}` });
    }
    req.eventId = eventId;
    next();
  };
}

// Resolve event_id for entity-level routes (guest/:id, activity/:id, checkin ids)
// then enforce membership. Usage: requireEntityEventAccess(({params}) => eventId lookup fn)
export function requireEntityEventAccess(lookupEventId) {
  return (req, res, next) => {
    let eventId = null;
    try {
      eventId = lookupEventId(req);
    } catch {
      return res.status(500).json({ error: 'Failed to resolve event scope' });
    }
    if (!eventId || Number.isNaN(Number(eventId))) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, Number(eventId))) {
      return res.status(403).json({ error: 'No access to this event' });
    }
    req.eventId = Number(eventId);
    next();
  };
}

export function guestEventId(req) {
  const row = db.prepare('SELECT event_id FROM guests WHERE id = ?').get(req.params.id);
  return row ? row.event_id : null;
}
