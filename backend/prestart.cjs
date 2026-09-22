// Self-healing native-module guard. Runs automatically before `npm start`
// (npm `prestart` hook) in every environment: local, Railway, Render.
// If better-sqlite3 cannot load — e.g. a stale/wrong-ABI binary restored from
// a build cache — rebuild it from source against the RUNTIME Node and verify
// before the server boots. Exits non-zero with a clear message if the rebuild
// itself fails, so the platform reports a build/startup failure instead of a
// cryptic native crash loop.
const { execSync } = require('child_process');

function loads() {
  // NB: require() alone is not enough — better-sqlite3 resolves its native
  // binding lazily on first `new Database()`, so open an in-memory DB and
  // run a query to prove the binary actually works with this Node version.
  try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE TABLE prestart_check (id INTEGER PRIMARY KEY)');
    db.close();
    return true;
  } catch (e) {
    console.log(`prestart: better-sqlite3 failed to load (${e.code || e.message})`);
    return false;
  }
}

if (loads()) {
  console.log('prestart: better-sqlite3 loads OK');
} else {
  console.log('prestart: rebuilding better-sqlite3 from source against runtime Node...');
  try {
    execSync('npm rebuild better-sqlite3', { stdio: 'inherit', cwd: __dirname });
  } catch (e) {
    console.error('FATAL: better-sqlite3 rebuild failed. Refusing to start with a broken native module.');
    process.exit(1);
  }
  if (!loads()) {
    console.error('FATAL: better-sqlite3 still fails to load after rebuild. Refusing to start.');
    process.exit(1);
  }
  console.log('prestart: rebuild OK, better-sqlite3 loads');
}
