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
      onboarding_method TEXT NOT NULL DEFAULT 'approval',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

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

    CREATE TABLE IF NOT EXISTS organization_users (
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_role TEXT NOT NULL DEFAULT 'member' CHECK(org_role IN ('owner', 'manager', 'member')),
      PRIMARY KEY (org_id, user_id)
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
