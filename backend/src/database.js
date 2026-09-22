import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { mkdirSync, accessSync, constants } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { formatUgandanPhoneNumber } from './phoneUtils.js';
import { LIFECYCLE_STATES, legacyStatusToLifecycle } from './raas/lifecycle.js';
import { DEFAULT_ROLE_PERMISSIONS } from './raas/permissions.js';
import { EVENT_TEMPLATES } from './raas/templates.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  try {
    // Check if standard Railway volume directory exists and is writable
    accessSync('/data', constants.W_OK);
    dbPath = '/data/data.db';
    console.log('Using persistent SQLite database at /data/data.db');
  } catch (e) {
    dbPath = join(__dirname, '..', 'data.db');
  }
}

// Ensure parent directory exists (especially important for mounted volume paths in production)
try {
  mkdirSync(dirname(dbPath), { recursive: true });
} catch (err) {
  console.warn('Failed to create database directory, falling back to local path:', err.message);
  dbPath = join(__dirname, '..', 'data.db');
}

let db;
try {
  db = new Database(dbPath);
} catch (err) {
  console.warn(`Failed to initialize database at ${dbPath}, falling back to local file:`, err.message);
  dbPath = join(__dirname, '..', 'data.db');
  db = new Database(dbPath);
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Phase 2 §29: entrances produce concurrent writes (rapid scans). Wait on
// locks instead of failing fast; uniqueness constraints still decide winners.
db.pragma('busy_timeout = 5000');

function migrate() {
  const userCols = db.prepare("PRAGMA table_info('users')").all().map(c => c.name);
  if (!userCols.includes('status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended'))");
  } else {
    const usersSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    if (usersSchema && !usersSchema.sql.includes('suspended')) {
      db.transaction(() => {
        db.exec('ALTER TABLE users RENAME TO users_old');
        db.exec(`
          CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            pin_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),
            last_login TEXT,
            phone TEXT,
            email TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
          )
        `);
        const colsToCopy = ['id', 'name', 'pin_hash', 'role', 'status', 'created_at', 'updated_at'].filter(c => userCols.includes(c));
        if (userCols.includes('last_login')) colsToCopy.push('last_login');
        if (userCols.includes('phone')) colsToCopy.push('phone');
        if (userCols.includes('email')) colsToCopy.push('email');
        const colString = colsToCopy.join(', ');
        db.exec(`INSERT INTO users (${colString}) SELECT ${colString} FROM users_old`);
        db.exec('DROP TABLE users_old');
      })();
    }
  }
  if (!userCols.includes('last_login')) db.exec('ALTER TABLE users ADD COLUMN last_login TEXT');
  if (!userCols.includes('phone')) db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
  if (!userCols.includes('email')) db.exec('ALTER TABLE users ADD COLUMN email TEXT');
  if (!userCols.includes('current_session_id')) db.exec('ALTER TABLE users ADD COLUMN current_session_id TEXT');
  const eventCols = db.prepare("PRAGMA table_info('events')").all().map(c => c.name);
  if (!eventCols.includes('staff_access_code')) db.exec("ALTER TABLE events ADD COLUMN staff_access_code TEXT");
  if (!eventCols.includes('onboarding_method')) db.exec("ALTER TABLE events ADD COLUMN onboarding_method TEXT NOT NULL DEFAULT 'approval'");
  const guestCols = db.prepare("PRAGMA table_info('guests')").all().map(c => c.name);
  if (!guestCols.includes('status')) db.exec("ALTER TABLE guests ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved', 'pending', 'rejected'))");
  if (!guestCols.includes('submitted_by')) db.exec('ALTER TABLE guests ADD COLUMN submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  // --- RaaS Phase 1: RSVP fields on guests (DEPRECATED read-model cache).
  // Source of truth is the dedicated `rsvps` table below (RSVP Ownership Rule:
  // invitation owns RSVP; event_id mandatory isolation; guest_id = responder;
  // absence of row = NO RESPONSE; check-in never overwrites RSVP).
  // guests.rsvp_* columns are kept synced on write for backward compatibility
  // with existing list/report queries and will be removed in a later phase.
  if (!guestCols.includes('rsvp_status')) db.exec("ALTER TABLE guests ADD COLUMN rsvp_status TEXT NOT NULL DEFAULT 'no_response' CHECK(rsvp_status IN ('no_response', 'confirmed', 'declined'))");
  if (!guestCols.includes('rsvp_updated_at')) db.exec('ALTER TABLE guests ADD COLUMN rsvp_updated_at TEXT');
  if (!guestCols.includes('rsvp_note')) db.exec('ALTER TABLE guests ADD COLUMN rsvp_note TEXT');
  // --- RaaS Phase 0 foundation migrations ---
  // Repair invitations table (v1 code expects columns that were never created).
  const invCols = db.prepare("PRAGMA table_info('invitations')").all().map(c => c.name);
  if (!invCols.includes('name')) db.exec('ALTER TABLE invitations ADD COLUMN name TEXT');
  if (!invCols.includes('phone')) db.exec('ALTER TABLE invitations ADD COLUMN phone TEXT');
  if (!invCols.includes('email')) db.exec('ALTER TABLE invitations ADD COLUMN email TEXT');
  if (!invCols.includes('status')) db.exec("ALTER TABLE invitations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked'))");
  if (!invCols.includes('activity_ids')) db.exec('ALTER TABLE invitations ADD COLUMN activity_ids TEXT');
  if (!invCols.includes('created_by')) db.exec('ALTER TABLE invitations ADD COLUMN created_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
  if (!invCols.includes('used_at')) db.exec('ALTER TABLE invitations ADD COLUMN used_at TEXT');
  // Phase 1: guest-scoped invitations (nullable for legacy staff invites).
  if (!invCols.includes('guest_id')) db.exec('ALTER TABLE invitations ADD COLUMN guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE');
  if (!invCols.includes('opened_at')) db.exec('ALTER TABLE invitations ADD COLUMN opened_at TEXT');
  // Events: universal engine columns (org, lifecycle, template, capacity, config).
  const evCols2 = db.prepare("PRAGMA table_info('events')").all().map(c => c.name);
  if (!evCols2.includes('org_id')) db.exec('ALTER TABLE events ADD COLUMN org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL');
  if (!evCols2.includes('lifecycle_state')) db.exec("ALTER TABLE events ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'DRAFT'");
  if (!evCols2.includes('template_key')) db.exec("ALTER TABLE events ADD COLUMN template_key TEXT NOT NULL DEFAULT 'private_celebration'");
  if (!evCols2.includes('timezone')) db.exec("ALTER TABLE events ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Africa/Kampala'");
  if (!evCols2.includes('start_time')) db.exec('ALTER TABLE events ADD COLUMN start_time TEXT');
  if (!evCols2.includes('end_time')) db.exec('ALTER TABLE events ADD COLUMN end_time TEXT');
  if (!evCols2.includes('expected_attendance')) db.exec('ALTER TABLE events ADD COLUMN expected_attendance INTEGER');
  if (!evCols2.includes('max_capacity')) db.exec('ALTER TABLE events ADD COLUMN max_capacity INTEGER');
  if (!evCols2.includes('config_json')) db.exec("ALTER TABLE events ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'");
  // Backfill lifecycle_state from legacy status for pre-Phase-0 rows.
  try {
    const legacy = db.prepare("SELECT id, status FROM events WHERE lifecycle_state IS NULL OR lifecycle_state = '' OR lifecycle_state NOT IN ('DRAFT','CONFIGURING','READY','ACTIVE','CLOSING','CLOSED','ARCHIVED')").all();
    const upd = db.prepare('UPDATE events SET lifecycle_state = ? WHERE id = ?');
    for (const e of legacy) upd.run(legacyStatusToLifecycle(e.status), e.id);
  } catch {}

  // --- RaaS Phase 2: operational modules. Every table is event-scoped with
  // ON DELETE CASCADE so event deletion removes operational data. Status
  // machines live in src/raas/ops.js; plan-vs-actual via planned_* vs actual_*.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedule_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      planned_start TEXT,
      planned_end TEXT,
      actual_start TEXT,
      actual_end TEXT,
      owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','READY','IN_PROGRESS','COMPLETED','CANCELLED','DELAYED')),
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_schedule_event ON schedule_items(event_id);

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      role_scope TEXT,
      zone TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      due_at TEXT,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ACCEPTED','IN_PROGRESS','COMPLETED','CANCELLED','BLOCKED')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      completed_at TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_event ON tasks(event_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_user_id);

    CREATE TABLE IF NOT EXISTS incidents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      category TEXT,
      severity TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(severity IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      reporter_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','CLOSED')),
      resolution TEXT,
      resolved_at TEXT,
      notes TEXT,
      escalation_level INTEGER NOT NULL DEFAULT 0,
      escalated_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_incidents_event ON incidents(event_id);

    CREATE TABLE IF NOT EXISTS service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      requester_name TEXT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      category TEXT,
      priority TEXT NOT NULL DEFAULT 'MEDIUM' CHECK(priority IN ('LOW','MEDIUM','HIGH','CRITICAL')),
      description TEXT,
      location TEXT,
      assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','ASSIGNED','IN_PROGRESS','FULFILLED','CLOSED','CANCELLED')),
      resolution TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_requests_event ON service_requests(event_id);

    CREATE TABLE IF NOT EXISTS seating_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'TABLE' CHECK(kind IN ('TABLE','ZONE','VIP','STAFF','ACCESSIBLE')),
      capacity INTEGER,
      location TEXT,
      notes TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_zones_event ON seating_zones(event_id);

    CREATE TABLE IF NOT EXISTS seat_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      zone_id INTEGER NOT NULL REFERENCES seating_zones(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (event_id, guest_id),
      UNIQUE (zone_id, guest_id)
    );
    CREATE INDEX IF NOT EXISTS idx_seats_zone ON seat_assignments(zone_id);

    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      service TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      arrival_time TEXT,
      actual_arrival TEXT,
      zone_id INTEGER REFERENCES seating_zones(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'EXPECTED' CHECK(status IN ('EXPECTED','ARRIVED','DEPARTED','CANCELLED','ISSUE')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_vendors_event ON vendors(event_id);

    CREATE TABLE IF NOT EXISTS transport_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pickup TEXT,
      destination TEXT,
      driver_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      vehicle TEXT,
      pickup_time TEXT,
      actual_pickup TEXT,
      status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN ('PLANNED','EN_ROUTE','COMPLETED','CANCELLED','DELAYED')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_transport_event ON transport_routes(event_id);

    CREATE TABLE IF NOT EXISTS transport_passengers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      route_id INTEGER NOT NULL REFERENCES transport_routes(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      UNIQUE (route_id, guest_id)
    );

    CREATE TABLE IF NOT EXISTS accommodations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      location TEXT,
      room TEXT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
      check_in TEXT,
      check_out TEXT,
      notes TEXT,
      transport_route_id INTEGER REFERENCES transport_routes(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_stays_event ON accommodations(event_id);

    CREATE TABLE IF NOT EXISTS checkin_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      checkin_id INTEGER,
      guest_id INTEGER,
      activity_id INTEGER,
      staff_id INTEGER,
      checked_in_at TEXT,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_corrections_event ON checkin_corrections(event_id);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      actor_id INTEGER,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      response_status INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alert_acks (
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (event_id, key)
    );

    -- RaaS Phase 4: managed-service delivery tables (all event-scoped CASCADE).
    CREATE TABLE IF NOT EXISTS intakes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT,
      event_type TEXT,
      event_date TEXT,
      venue TEXT,
      expected_attendance INTEGER,
      services_json TEXT NOT NULL DEFAULT '[]',
      requirements TEXT,
      status TEXT NOT NULL DEFAULT 'NEW' CHECK(status IN ('NEW','REVIEWED','CONVERTED','CANCELLED')),
      converted_event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      assignee_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operator_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      body TEXT NOT NULL,
      visibility TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(visibility IN ('INTERNAL','CUSTOMER')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notes_event ON operator_notes(event_id);

    CREATE TABLE IF NOT EXISTS break_glass_grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bg_event_user ON break_glass_grants(event_id, user_id);

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      reason TEXT,
      options_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','DECIDED','CANCELLED')),
      decision TEXT,
      decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      decided_at TEXT,
      requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_decisions_event ON decisions(event_id);

    CREATE TABLE IF NOT EXISTS runbook_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      phase TEXT NOT NULL CHECK(phase IN ('BEFORE','DURING','AFTER')),
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      done_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      done_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_runbook_event ON runbook_items(event_id);

    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'PHONE' CHECK(kind IN ('PHONE','TABLET','OTHER')),
      status TEXT NOT NULL DEFAULT 'READY' CHECK(status IN ('READY','DEPLOYED','ISSUE','RETURNED')),
      assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
      checklist_json TEXT NOT NULL DEFAULT '{}',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_devices_event ON devices(event_id);

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      recipients_text TEXT,
      channel TEXT NOT NULL DEFAULT 'OPERATOR' CHECK(channel IN ('WHATSAPP','SMS','EMAIL','IN_APP','OPERATOR')),
      message TEXT NOT NULL,
      purpose TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','QUEUED','SENT','FAILED')),
      sent_at TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_comms_event ON communications(event_id);
  `);
  // Column repair for DBs created before the notes field existed.
  try {
    const incCols = db.prepare("PRAGMA table_info('incidents')").all().map((c) => c.name);
    if (incCols.length && !incCols.includes('notes')) db.exec('ALTER TABLE incidents ADD COLUMN notes TEXT');
  } catch {}
  // Phase 5 §49: seating zones need updated_at for optimistic concurrency.
  try {
    const zCols = db.prepare("PRAGMA table_info('seating_zones')").all().map((c) => c.name);
    if (zCols.length && !zCols.includes('updated_at')) db.exec("ALTER TABLE seating_zones ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))");
  } catch {}
  // --- RSVP Ownership Rule (locked Phase 1): dedicated rsvps table. ---
  // invitation_id = primary business owner; event_id = isolation boundary;
  // guest_id = responding person. No PENDING row: absence = NO RESPONSE.
  db.exec(`
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'DECLINED')),
      responded_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_via TEXT NOT NULL DEFAULT 'GUEST_LINK' CHECK(responded_via IN ('GUEST_LINK', 'STAFF', 'ORGANIZER', 'RAAS_OPERATOR')),
      attendee_count INTEGER,
      guest_note TEXT,
      response_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (invitation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_id);
    CREATE INDEX IF NOT EXISTS idx_rsvps_guest ON rsvps(guest_id);
    CREATE INDEX IF NOT EXISTS idx_rsvps_invitation ON rsvps(invitation_id);
  `);
  // Backfill: migrate legacy guests.rsvp_status into rsvps linked to the
  // guest's latest invitation. Orphan legacy RSVPs (no invitation) get a
  // system placeholder invitation so the ownership invariant holds.
  try {
    const orphans = db.prepare(`
      SELECT id, event_id, name, rsvp_status, rsvp_note, rsvp_updated_at, guest_count
      FROM guests WHERE rsvp_status IN ('confirmed', 'declined')
    `).all();
    const findInv = db.prepare(
      "SELECT id FROM invitations WHERE guest_id = ? AND event_id = ? ORDER BY id DESC LIMIT 1"
    );
    const findRsvp = db.prepare('SELECT id FROM rsvps WHERE invitation_id = ? LIMIT 1');
    const mkInv = db.prepare(
      "INSERT INTO invitations (token, event_id, guest_id, role, status, expires_at) VALUES (?, ?, ?, 'staff', 'pending', datetime('now', '+30 days'))"
    );
    const mkRsvp = db.prepare(`
      INSERT INTO rsvps (event_id, invitation_id, guest_id, status, responded_at, responded_via, attendee_count, guest_note, response_version, created_at, updated_at)
      VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), 'STAFF', ?, ?, 1, datetime('now'), datetime('now'))
    `);
    const syncGuest = db.prepare("UPDATE guests SET rsvp_updated_at = COALESCE(rsvp_updated_at, datetime('now')) WHERE id = ?");
    for (const g of orphans) {
      let inv = findInv.get(g.id, g.event_id);
      if (!inv) {
        const raw = crypto.randomBytes(24).toString('hex');
        const ins = mkInv.run(raw, g.event_id, g.id);
        inv = { id: ins.lastInsertRowid };
      }
      if (findRsvp.get(inv.id)) continue;
      mkRsvp.run(
        g.event_id, inv.id, g.id,
        String(g.rsvp_status).toUpperCase(),
        g.rsvp_updated_at || null,
        Number.isFinite(Number(g.guest_count)) ? Number(g.guest_count) : null,
        g.rsvp_note || null,
      );
      syncGuest.run(g.id);
    }
  } catch (e) {
    console.error('RSVP backfill notice:', e.message);
  }

  // --- Phase 2 QR Access & Dual Check-in: extend check-ins, venue QR code. ---
  // checkins.method distinguishes SELF_SERVICE_QR / STAFF_QR / MANUAL.
  // checkins.invitation_id links attendance to the invitation credential used
  // (nullable: manual fallback may predate an invitation).
  // events.self_checkin_code is the opaque public venue-QR identity: it only
  // opens the self-check-in entry point, never grants access by itself.
  try {
    const ciCols = db.prepare("PRAGMA table_info('checkins')").all().map(c => c.name);
    if (!ciCols.includes('method')) db.exec("ALTER TABLE checkins ADD COLUMN method TEXT NOT NULL DEFAULT 'MANUAL' CHECK(method IN ('SELF_SERVICE_QR', 'STAFF_QR', 'MANUAL'))");
    if (!ciCols.includes('invitation_id')) db.exec('ALTER TABLE checkins ADD COLUMN invitation_id INTEGER REFERENCES invitations(id) ON DELETE SET NULL');
    db.exec('CREATE INDEX IF NOT EXISTS idx_checkins_method ON checkins(method)');
  } catch (e) {
    console.error('Phase 2 checkins migration notice:', e.message);
  }
  try {
    const evCols = db.prepare("PRAGMA table_info('events')").all().map(c => c.name);
    if (!evCols.includes('self_checkin_code')) db.exec('ALTER TABLE events ADD COLUMN self_checkin_code TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_checkin_code ON events(self_checkin_code)');
    // Backfill: every existing event gets a venue QR identity.
    const missing = db.prepare('SELECT id FROM events WHERE self_checkin_code IS NULL').all();
    const setCode = db.prepare('UPDATE events SET self_checkin_code = ? WHERE id = ?');
    for (const e of missing) setCode.run(crypto.randomBytes(16).toString('hex'), e.id);
  } catch (e) {
    console.error('Phase 2 venue-code migration notice:', e.message);
  }
}

export function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('admin', 'staff')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'suspended')),
      last_login TEXT,
      phone TEXT,
      email TEXT,
      current_session_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      venue TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'upcoming', 'completed')),
      staff_access_code TEXT,
      self_checkin_code TEXT,
      onboarding_method TEXT NOT NULL DEFAULT 'approval',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    -- NOTE: idx_events_checkin_code is created in migrate(), after the
    -- self_checkin_code column is added (init runs before migrate).

    CREATE TABLE IF NOT EXISTS user_events (
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      table_number TEXT,
      guest_count INTEGER NOT NULL DEFAULT 1,
      category TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved', 'pending', 'rejected')),
      submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      rsvp_status TEXT NOT NULL DEFAULT 'no_response' CHECK(rsvp_status IN ('no_response', 'confirmed', 'declined')),
      rsvp_updated_at TEXT,
      rsvp_note TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS checkins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
      activity_id INTEGER REFERENCES activities(id) ON DELETE CASCADE,
      staff_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      method TEXT NOT NULL DEFAULT 'MANUAL' CHECK(method IN ('SELF_SERVICE_QR', 'STAFF_QR', 'MANUAL')),
      invitation_id INTEGER REFERENCES invitations(id) ON DELETE SET NULL,
      checked_in_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_unique 
      ON checkins(guest_id, activity_id);

    CREATE INDEX IF NOT EXISTS idx_guests_event ON guests(event_id);
    CREATE INDEX IF NOT EXISTS idx_guests_name ON guests(name);
    CREATE INDEX IF NOT EXISTS idx_guests_phone ON guests(phone);
    CREATE INDEX IF NOT EXISTS idx_activities_event ON activities(event_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_activity ON checkins(activity_id);
    CREATE INDEX IF NOT EXISTS idx_checkins_guest ON checkins(guest_id);
    -- NOTE: idx_checkins_method is created in migrate(), after the method
    -- column is added (init runs before migrate).

    CREATE TABLE IF NOT EXISTS registration_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('admin', 'staff')),
      token TEXT NOT NULL UNIQUE,
      name TEXT,
      phone TEXT,
      email TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'revoked')),
      activity_ids TEXT,
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      used_at TEXT,
      guest_id INTEGER REFERENCES guests(id) ON DELETE CASCADE,
      opened_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      contact_name TEXT,
      contact_phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- RSVP Ownership Rule: RSVP belongs to invitation (event_id = isolation).
    CREATE TABLE IF NOT EXISTS rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      invitation_id INTEGER NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('CONFIRMED', 'DECLINED')),
      responded_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_via TEXT NOT NULL DEFAULT 'GUEST_LINK' CHECK(responded_via IN ('GUEST_LINK', 'STAFF', 'ORGANIZER', 'RAAS_OPERATOR')),
      attendee_count INTEGER,
      guest_note TEXT,
      response_version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (invitation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rsvps_event ON rsvps(event_id);
    CREATE INDEX IF NOT EXISTS idx_rsvps_guest ON rsvps(guest_id);
    CREATE INDEX IF NOT EXISTS idx_rsvps_invitation ON rsvps(invitation_id);

    CREATE TABLE IF NOT EXISTS organization_users (
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_role TEXT NOT NULL DEFAULT 'member' CHECK(org_role IN ('owner', 'manager', 'member')),
      PRIMARY KEY (org_id, user_id)
    );

    -- Phase 6: venues (org-scoped, reusable across the org's events).
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      address TEXT,
      capacity INTEGER,
      contact_name TEXT,
      contact_phone TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_venues_org ON venues(org_id);

    -- Phase 6: contracts ledger (commercial relationship record; no payment
    -- capture — invoicing/charging stays an explicit non-goal).
    CREATE TABLE IF NOT EXISTS contracts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      customer_name TEXT,
      package TEXT NOT NULL DEFAULT 'MANAGED' CHECK(package IN ('DIGITAL','MANAGED','FULL_RAAS','ENTERPRISE')),
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
      value_cents INTEGER,
      currency TEXT NOT NULL DEFAULT 'UGX',
      notes TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_contracts_org ON contracts(org_id);

    CREATE TABLE IF NOT EXISTS contract_events (
      contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      PRIMARY KEY (contract_id, event_id)
    );

    CREATE TABLE IF NOT EXISTS event_templates (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      default_modules_json TEXT NOT NULL DEFAULT '[]',
      default_roles_json TEXT NOT NULL DEFAULT '[]',
      terminology_json TEXT NOT NULL DEFAULT '{}',
      default_settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_key TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_key, permission)
    );

    CREATE TABLE IF NOT EXISTS event_user_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role_key TEXT NOT NULL,
      zone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE (event_id, user_id, role_key)
    );

    CREATE TABLE IF NOT EXISTS access_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      subject_type TEXT NOT NULL CHECK(subject_type IN ('guest', 'staff')),
      subject_id INTEGER,
      token_hash TEXT NOT NULL UNIQUE,
      scope_json TEXT NOT NULL DEFAULT '{}',
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      single_use INTEGER NOT NULL DEFAULT 1,
      used_at TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
      actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      metadata_json TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id);
    CREATE INDEX IF NOT EXISTS idx_access_tokens_event ON access_tokens(event_id);

    CREATE TABLE IF NOT EXISTS import_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      admin_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      total_records INTEGER NOT NULL DEFAULT 0,
      imported INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      validation_errors TEXT,
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'failed')),
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
  migrate();

  // Migrate existing guest phone numbers to Ugandan format if needed
  try {
    const unformattedGuests = db.prepare("SELECT id, phone FROM guests WHERE phone IS NOT NULL AND phone != '' AND phone NOT LIKE '+256%'").all();
    const updatePhoneStmt = db.prepare("UPDATE guests SET phone = ? WHERE id = ?");
    unformattedGuests.forEach(g => {
      const formatted = formatUgandanPhoneNumber(g.phone);
      if (formatted && formatted !== g.phone) {
        updatePhoneStmt.run(formatted, g.id);
      }
    });
  } catch (e) {
    console.error('Phone migration notice:', e.message);
  }

  // 2. Ensure at least one Admin user exists.
  // Production must NEVER silently create a default credential: bootstrapping
  // requires an explicit INITIAL_ADMIN_PIN (consumed here, never logged).
  // Local development keeps the convenient 1234 default.
  const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get().count;
  if (adminCount === 0) {
    if (process.env.NODE_ENV === 'production') {
      const initialPin = (process.env.INITIAL_ADMIN_PIN || '').trim();
      if (!initialPin) {
        console.error('FATAL: No admin user exists and INITIAL_ADMIN_PIN is not set. Refusing to create a default credential in production.');
        process.exit(1);
      }
      if (!/^\d{4,6}$/.test(initialPin)) {
        console.error('FATAL: INITIAL_ADMIN_PIN must be 4-6 digits.');
        process.exit(1);
      }
      const adminPin = bcrypt.hashSync(initialPin, 10);
      db.prepare(`
        INSERT INTO users (name, pin_hash, role, status)
        VALUES ('Admin', ?, 'admin', 'active')
      `).run(adminPin);
      console.log('Admin user created from INITIAL_ADMIN_PIN.');
    } else {
      console.log('No Admin found! Creating default Admin user (PIN: 1234)...');
      const adminPin = bcrypt.hashSync('1234', 10);
      db.prepare(`
        INSERT INTO users (name, pin_hash, role, status)
        VALUES ('Admin', ?, 'admin', 'active')
      `).run(adminPin);
    }
  }

  // 3. Seed RaaS Phase 0 foundation: templates + role permissions (idempotent).
  try {
    const upsertTemplate = db.prepare(`
      INSERT INTO event_templates (key, name, description, default_modules_json, default_roles_json, terminology_json, default_settings_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        default_modules_json = excluded.default_modules_json,
        default_roles_json = excluded.default_roles_json,
        terminology_json = excluded.terminology_json,
        default_settings_json = excluded.default_settings_json
    `);
    for (const t of EVENT_TEMPLATES) {
      upsertTemplate.run(
        t.key, t.name, t.description || null,
        JSON.stringify(t.default_modules || []),
        JSON.stringify(t.default_roles || []),
        JSON.stringify(t.terminology || {}),
        JSON.stringify(t.default_settings || {}),
      );
    }
    const upsertPerm = db.prepare('INSERT OR IGNORE INTO role_permissions (role_key, permission) VALUES (?, ?)');
    for (const [roleKey, perms] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
      for (const p of perms) upsertPerm.run(roleKey, p);
    }
  } catch (e) {
    console.error('Phase 0 seed notice:', e.message);
  }
}

export { dbPath };
export default db;
