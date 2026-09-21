// RaaS Phase 0 — Granular permission catalogue + default role mappings.
// Spec §10-13, §72: one authorization engine. Roles are configuration.
// Permission format: <resource>.<action>, e.g. guest.view, checkin.perform.

export const PERMISSIONS = [
  'guest.view',
  'guest.create',
  'guest.update',
  'guest.delete',
  'checkin.view',
  'checkin.perform',
  'checkin.override',
  'seating.view',
  'seating.assign',
  'seating.update',
  'incident.view',
  'incident.create',
  'incident.assign',
  'incident.resolve',
  'order.view',
  'order.create',
  'order.update',
  'order.fulfill',
  'transport.view',
  'transport.assign',
  'transport.update',
  'event.view',
  'event.update',
  'event.close',
  'event.delete',
  'staff.view',
  'staff.assign',
  'report.view',
  'audit.view',
  'template.view',
  'org.view',
  'org.manage',
];

// Configurable event-level roles. Platform roles (admin/staff in users.role)
// remain; these role_keys scope what a user can do WITHIN one event.
export const EVENT_ROLES = [
  'event_owner',
  'event_manager',
  'raas_operator',
  'checkin_staff',
  'security',
  'usher',
  'waiter',
  'kitchen',
  'bar',
  'driver',
  'transport_coordinator',
  'sound',
  'performer',
  'photographer',
  'vendor',
  'speaker',
  'vip_coordinator',
];

const ALL = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSIONS = {
  event_owner: ALL,
  event_manager: [
    'guest.view', 'guest.create', 'guest.update',
    'checkin.view', 'checkin.perform', 'checkin.override',
    'seating.view', 'seating.assign', 'seating.update',
    'incident.view', 'incident.create', 'incident.assign', 'incident.resolve',
    'order.view', 'order.create', 'order.update', 'order.fulfill',
    'transport.view', 'transport.assign', 'transport.update',
    'event.view', 'event.update',
    'staff.view', 'staff.assign',
    'report.view',
  ],
  raas_operator: [
    'guest.view', 'guest.create', 'guest.update',
    'checkin.view', 'checkin.perform', 'checkin.override',
    'seating.view', 'seating.assign',
    'incident.view', 'incident.create', 'incident.assign', 'incident.resolve',
    'order.view', 'order.update', 'order.fulfill',
    'transport.view', 'transport.assign', 'transport.update',
    'event.view', 'event.update', 'event.close',
    'staff.view', 'staff.assign',
    'report.view', 'audit.view',
  ],
  checkin_staff: ['guest.view', 'guest.create', 'checkin.view', 'checkin.perform', 'event.view'],
  security: ['guest.view', 'checkin.view', 'incident.view', 'incident.create', 'event.view'],
  usher: ['guest.view', 'checkin.view', 'seating.view', 'event.view'],
  waiter: ['order.view', 'order.create', 'seating.view', 'event.view'],
  kitchen: ['order.view', 'order.update', 'order.fulfill', 'event.view'],
  bar: ['order.view', 'order.update', 'order.fulfill', 'event.view'],
  driver: ['transport.view', 'event.view'],
  transport_coordinator: ['transport.view', 'transport.assign', 'transport.update', 'guest.view', 'event.view'],
  sound: ['event.view'],
  performer: ['event.view'],
  photographer: ['event.view'],
  vendor: ['event.view'],
  speaker: ['event.view'],
  vip_coordinator: ['guest.view', 'seating.view', 'seating.assign', 'transport.view', 'event.view'],
};

// Legacy platform mapping (users.role) → baseline permissions when no
// event-specific role row exists. Preserves v1 behavior while Phase 0
// introduces granular checks.
export const PLATFORM_BASELINE = {
  admin: ALL,
  staff: ['guest.view', 'guest.create', 'checkin.view', 'checkin.perform', 'event.view', 'report.view'],
};

export function defaultPermissionsForRole(roleKey) {
  return DEFAULT_ROLE_PERMISSIONS[roleKey] || [];
}
