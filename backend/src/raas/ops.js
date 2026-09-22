// RaaS Phase 2 — shared operational state machines + policies.
// One engine for all ops modules: plan → active → done with exception states.
// Plan vs Actual (§7): planned_* timestamps vs actual_* timestamps stay distinct.

export const OPS_MACHINES = {
  schedule: {
    states: ['PLANNED', 'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DELAYED'],
    transitions: {
      PLANNED: ['READY', 'CANCELLED'],
      READY: ['IN_PROGRESS', 'PLANNED', 'CANCELLED'],
      IN_PROGRESS: ['COMPLETED', 'DELAYED', 'CANCELLED'],
      DELAYED: ['IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    },
    done: ['COMPLETED', 'CANCELLED'],
  },
  task: {
    states: ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'BLOCKED'],
    transitions: {
      OPEN: ['ACCEPTED', 'IN_PROGRESS', 'CANCELLED'],
      ACCEPTED: ['IN_PROGRESS', 'OPEN', 'CANCELLED', 'BLOCKED'],
      IN_PROGRESS: ['COMPLETED', 'BLOCKED', 'CANCELLED'],
      BLOCKED: ['OPEN', 'IN_PROGRESS', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: ['OPEN'],
    },
    done: ['COMPLETED', 'CANCELLED'],
  },
  incident: {
    states: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
    transitions: {
      OPEN: ['ASSIGNED', 'IN_PROGRESS'],
      ASSIGNED: ['IN_PROGRESS', 'OPEN'],
      IN_PROGRESS: ['RESOLVED'],
      RESOLVED: ['CLOSED', 'IN_PROGRESS'],
      CLOSED: [],
    },
    done: ['RESOLVED', 'CLOSED'],
  },
  request: {
    states: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'FULFILLED', 'CLOSED', 'CANCELLED'],
    transitions: {
      OPEN: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
      ASSIGNED: ['IN_PROGRESS', 'OPEN', 'CANCELLED'],
      IN_PROGRESS: ['FULFILLED', 'CANCELLED'],
      FULFILLED: ['CLOSED'],
      CLOSED: [],
      CANCELLED: [],
    },
    done: ['FULFILLED', 'CLOSED', 'CANCELLED'],
  },
  vendor: {
    states: ['EXPECTED', 'ARRIVED', 'DEPARTED', 'CANCELLED', 'ISSUE'],
    transitions: {
      EXPECTED: ['ARRIVED', 'CANCELLED', 'ISSUE'],
      ARRIVED: ['DEPARTED', 'ISSUE'],
      ISSUE: ['ARRIVED', 'DEPARTED', 'CANCELLED'],
      DEPARTED: [],
      CANCELLED: [],
    },
    done: ['DEPARTED', 'CANCELLED'],
  },
  transport: {
    states: ['PLANNED', 'EN_ROUTE', 'COMPLETED', 'CANCELLED', 'DELAYED'],
    transitions: {
      PLANNED: ['EN_ROUTE', 'CANCELLED'],
      EN_ROUTE: ['COMPLETED', 'DELAYED', 'CANCELLED'],
      DELAYED: ['EN_ROUTE', 'COMPLETED', 'CANCELLED'],
      COMPLETED: [],
      CANCELLED: [],
    },
    done: ['COMPLETED', 'CANCELLED'],
  },
};

export function canOpsTransition(machine, from, to) {
  const m = OPS_MACHINES[machine];
  if (!m || !m.states.includes(from) || !m.states.includes(to)) return false;
  return (m.transitions[from] || []).includes(to);
}

export function isOpsDone(machine, state) {
  const m = OPS_MACHINES[machine];
  return m ? m.done.includes(state) : false;
}

// Ops write policy over the event lifecycle (§31-32, Phase 2):
// CLOSED/ARCHIVED → all writes blocked. CLOSING → creates blocked, status
// progression + resolution allowed (finish what's open, start nothing new).
export function opsWritePolicy(lifecycleState, isCreate) {
  if (lifecycleState === 'CLOSED' || lifecycleState === 'ARCHIVED') {
    return { ok: false, error: `Event is ${lifecycleState}. Operational writes are disabled.` };
  }
  if (lifecycleState === 'CLOSING' && isCreate) {
    return { ok: false, error: 'Event is CLOSING. New operational items cannot be created.' };
  }
  return { ok: true };
}

// SQLite datetime('now') string; lexical compare works for planned/actual math.
export function nowDb() {
  return new Date().toISOString().replace('T', ' ').split('.')[0];
}
