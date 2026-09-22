// Native-module smoke test (kept as a standalone diagnostic; not wired into
// any build). Run manually if a deploy shows native crashes: a broken
// native binary fails the build instead of crashing the server at runtime.
// Distinguishes dependency/build failure from application/database failure:
// this file touches no application code and no production database.
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec('CREATE TABLE smoke (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
db.prepare('INSERT INTO smoke (v) VALUES (?)').run('ok');
const row = db.prepare('SELECT v FROM smoke WHERE id = 1').get();
if (!row || row.v !== 'ok') {
  throw new Error('better-sqlite3 smoke query returned unexpected result');
}
const { 'sqlite_version()': sqliteVersion } = db.prepare('select sqlite_version()').get();
console.log(`native smoke OK: better-sqlite3 loaded, in-memory SQLite ${sqliteVersion} reads/writes`);
db.close();
