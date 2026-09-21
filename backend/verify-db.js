// Phase 6 database integrity verification (migration recovery plan).
// READ-ONLY: opens the database with { readonly: true } so it never runs
// migrations, seeds, or phone backfills against the inspected file.
// Usage: node verify-db.js [path-to-db]
// Exit 0 + JSON report on success, exit 1 with `ok: false` on any failure.
import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath =
  process.argv[2] || process.env.DATABASE_PATH || join(__dirname, 'data.db');

const EXPECTED_TABLES = [
  'users',
  'events',
  'user_events',
  'guests',
  'activities',
  'checkins',
  'registration_requests',
  'invitations',
  'organizations',
  'rsvps',
  'organization_users',
  'event_templates',
  'role_permissions',
  'event_user_roles',
  'access_tokens',
  'audit_log',
  'import_history',
];

const COUNT_TABLES = [
  'users',
  'events',
  'guests',
  'invitations',
  'rsvps',
  'checkins',
  'activities',
  'audit_log',
  'organizations',
  'access_tokens',
  'user_events',
  'event_user_roles',
];

function fail(reason) {
  console.log(JSON.stringify({ ok: false, dbPath, reason }));
  process.exit(1);
}

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (e) {
  fail(`open failed: ${e.message}`);
}

const report = { ok: true, dbPath, tables: {}, counts: {} };
try {
  const integrity = db.prepare('PRAGMA integrity_check').get();
  report.integrity_check = integrity.integrity_check;
  if (integrity.integrity_check !== 'ok') fail(`integrity_check: ${integrity.integrity_check}`);

  const fk = db.prepare('PRAGMA foreign_key_check').all();
  report.foreign_key_violations = fk.length;
  if (fk.length > 0) fail(`${fk.length} foreign-key violations`);

  const existing = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );
  report.tables.present = [...existing].sort();
  report.tables.missing_expected = EXPECTED_TABLES.filter((t) => !existing.has(t));
  if (report.tables.missing_expected.length > 0) {
    fail(`missing tables: ${report.tables.missing_expected.join(', ')}`);
  }
  for (const t of COUNT_TABLES) {
    report.counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get().c;
  }
} catch (e) {
  fail(`verification query failed: ${e.message}`);
} finally {
  db.close();
}

console.log(JSON.stringify(report, null, 2));
