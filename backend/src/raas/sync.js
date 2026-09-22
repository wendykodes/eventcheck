// RaaS Phase 5 §25 — synchronization & conflict policy (explicit definition).
//
// The system never silently overwrites conflicting operational changes.
// Rules, in precedence order:
//
// 1. STATE MACHINES WIN: status transitions validate against the machine
//    (tasks/incidents/schedule/requests/vendors/transport/lifecycle). An
//    illegal transition is rejected (409) no matter who wrote last.
//
// 2. FRESHNESS CHECKS FOR FIELDS: PUT handlers accept an optional
//    `updated_at` baseline (the value the client originally read). On
//    mismatch the write is rejected with 409 STALE_WRITE + current record.
//    Clients must reload and re-apply. Absent baseline = legacy
//    last-write-wins (backward compatible with old clients).
//
// 3. IDEMPOTENT REPLAY FOR CREATES: POST creates honor `Idempotency-Key`.
//    Retries/offline-flush replays return the original response instead of
//    duplicating. Check-in additionally collapses on UNIQUE(guest_id,
//    activity_id) → 409 Already checked in (also safe, never duplicated).
//
// 4. RSVP SINGLE-OWNER: UNIQUE(invitation_id); concurrent submits serialize
//    on the row — second writer updates version, never forks.
//
// 5. OFFLINE OUTBOX (check-in today): queued items flush with their original
//    Idempotency-Key, so replay-after-reconnect cannot double-create. Items
//    rejected for business reasons (event closed) are dropped with a message,
//    never silently lost: they stay visible until the flush resolves them.
//
// 6. SEAT/TRANSport UNIQUENESS: UNIQUE(event_id, guest_id) and
//    UNIQUE(route_id, guest_id) make double-assigns deterministic 409s;
//    reassignment is explicit (?move=1) and audited.
//
// 7. TIMESTAMPS: every operational write stamps updated_at/resolved_at/
//    completed_at server-side. The server clock is the ordering authority;
//    client clocks are never trusted for ordering.

export const SYNC_POLICY_VERSION = '1.0';
