// RaaS Phase 0 — Event lifecycle state machine.
// Spec §8, §18: DRAFT → CONFIGURING → READY → ACTIVE → CLOSING → CLOSED → ARCHIVED
// State determines valid actions. No unstructured event bags.

export const LIFECYCLE_STATES = [
  'DRAFT',
  'CONFIGURING',
  'READY',
  'ACTIVE',
  'CLOSING',
  'CLOSED',
  'ARCHIVED',
];

// Allowed forward (and limited backward) transitions.
// REOPEN paths are explicit so close/reopen is auditable.
export const LIFECYCLE_TRANSITIONS = {
  DRAFT: ['CONFIGURING', 'ARCHIVED'],
  CONFIGURING: ['READY', 'DRAFT'],
  READY: ['ACTIVE', 'CONFIGURING'],
  ACTIVE: ['CLOSING'],
  CLOSING: ['CLOSED', 'ACTIVE'],
  CLOSED: ['ARCHIVED', 'ACTIVE'],
  ARCHIVED: [],
};

export function canTransition(from, to) {
  if (!LIFECYCLE_STATES.includes(from) || !LIFECYCLE_STATES.includes(to)) return false;
  return (LIFECYCLE_TRANSITIONS[from] || []).includes(to);
}

// Backwards compat: legacy v1 status → lifecycle mapping.
export function legacyStatusToLifecycle(status) {
  switch (status) {
    case 'upcoming': return 'READY';
    case 'active': return 'ACTIVE';
    case 'completed': return 'CLOSED';
    default: return 'DRAFT';
  }
}

export function lifecycleToLegacyStatus(lifecycle) {
  switch (lifecycle) {
    case 'DRAFT':
    case 'CONFIGURING': return 'upcoming';
    case 'READY': return 'upcoming';
    case 'ACTIVE': return 'active';
    case 'CLOSING': return 'active';
    case 'CLOSED':
    case 'ARCHIVED': return 'completed';
    default: return 'upcoming';
  }
}

// Which lifecycle states allow which classes of operation.
export function lifecycleAllows(state, operation) {
  switch (operation) {
    case 'configure': // edit setup, guests, activities, staff assignment
      return ['DRAFT', 'CONFIGURING', 'READY', 'ACTIVE'].includes(state);
    case 'checkin': // live operations
      return ['ACTIVE'].includes(state);
    case 'rehearse': // test mode without contaminating production
      return ['READY', 'ACTIVE'].includes(state);
    case 'close':
      return ['ACTIVE', 'CLOSING'].includes(state);
    case 'report':
      return ['CLOSING', 'CLOSED', 'ARCHIVED', 'ACTIVE'].includes(state);
    default:
      return false;
  }
}
