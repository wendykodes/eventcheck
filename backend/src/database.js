import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync, accessSync, constants } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
  const eventCols = db.prepare("PRAGMA table_info('events')").all().map(c => c.name);
  if (!eventCols.includes('staff_access_code')) db.exec("ALTER TABLE events ADD COLUMN staff_access_code TEXT");
  if (!eventCols.includes('onboarding_method')) db.exec("ALTER TABLE events ADD COLUMN onboarding_method TEXT NOT NULL DEFAULT 'approval'");
  const guestCols = db.prepare("PRAGMA table_info('guests')").all().map(c => c.name);
  if (!guestCols.includes('status')) db.exec("ALTER TABLE guests ADD COLUMN status TEXT NOT NULL DEFAULT 'approved' CHECK(status IN ('approved', 'pending', 'rejected'))");
  if (!guestCols.includes('submitted_by')) db.exec('ALTER TABLE guests ADD COLUMN submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL');
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
      used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

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

  // Auto-seed if database has no events
  const eventCount = db.prepare('SELECT COUNT(*) as count FROM events').get().count;
  if (eventCount === 0) {
    console.log('Database empty! Auto-seeding sample event, Admin (1234), Staff (5678), and guests...');
    
    const adminPin = bcrypt.hashSync('1234', 10);
    const staffPin = bcrypt.hashSync('5678', 10);

    const adminRes = db.prepare(`
      INSERT INTO users (name, pin_hash, role, status, last_login)
      VALUES (?, ?, 'admin', 'active', datetime('now'))
    `).run('Admin', adminPin);

    const aliceRes = db.prepare("INSERT INTO users (name, pin_hash, role, status, last_login) VALUES ('Alice', ?, 'staff', 'active', datetime('now'))").run(staffPin);
    const bobRes = db.prepare("INSERT INTO users (name, pin_hash, role, status, last_login) VALUES ('Bob', ?, 'staff', 'active', datetime('now'))").run(staffPin);

    const eventRes = db.prepare(`
      INSERT INTO events (name, date, venue, description, status, staff_access_code)
      VALUES ('Smith-Johnson Wedding Reception', '2026-08-15', 'The Grand Ballroom, 123 Main St', 'Evening wedding reception with dinner and dancing', 'active', 'WEDDING2026')
    `).run();
    const eventId = eventRes.lastInsertRowid;

    db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)').run(aliceRes.lastInsertRowid, eventId);
    db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)').run(bobRes.lastInsertRowid, eventId);

    const activityNames = ['Entrance', 'Food', 'Drinks', 'Cake', 'Gift Collection', 'Photo Booth'];
    activityNames.forEach((name, i) => {
      db.prepare('INSERT INTO activities (event_id, name, sort_order) VALUES (?, ?, ?)').run(eventId, name, i);
    });

    const guests = [
      { name: 'John Smith', phone: '555-0101', email: 'john@example.com', table: '1', count: 2, category: 'Family' },
      { name: 'Jane Doe', phone: '555-0102', email: 'jane@example.com', table: '2', count: 1, category: 'Friend' },
      { name: 'Bob Wilson', phone: '555-0103', email: 'bob@example.com', table: '1', count: 3, category: 'Family' },
      { name: 'Sarah Johnson', phone: '555-0104', email: 'sarah@example.com', table: '3', count: 2, category: 'Friend' },
      { name: 'Mike Brown', phone: '555-0105', email: 'mike@example.com', table: '2', count: 1, category: 'Coworker' }
    ];

    guests.forEach(g => {
      db.prepare('INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        eventId, g.name, g.phone, g.email, g.table, g.count, g.category
      );
    });

    console.log('Auto-seed completed successfully!');
  }
}

export default db;
