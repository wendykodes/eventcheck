// Credential-guessing guard for public invitation/journey endpoints.
// Design constraint: an entire venue often shares one public IP (venue WiFi),
// so the throttle must NEVER block legitimate traffic. It therefore applies
// ONLY to requests that already failed credential resolution (404 invalid,
// 410 revoked/expired): successes, duplicates, lifecycle messages, and
// wrong-event guidance always pass through untouched. An IP that burns the
// failure budget gets 429s on subsequent failures only — a valid credential
// from the same IP still succeeds.
import db from '../database.js';
import { clientIp } from './rateLimit.js';

const WINDOW_MS = Number(process.env.PUBLIC_ABUSE_WINDOW_MS) || 15 * 60 * 1000;
const MAX = Number(process.env.PUBLIC_ABUSE_MAX) || 50;

const buckets = new Map(); // ip -> { failures, resetAt, logged }

function bucket(ip, now) {
  let b = buckets.get(ip);
  if (!b || now >= b.resetAt) {
    b = { failures: 0, resetAt: now + WINDOW_MS, logged: false };
    buckets.set(ip, b);
  }
  return b;
}

export function publicAbuseLimit(req, res, next) {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    try {
      if (res.statusCode === 404 || res.statusCode === 410) {
        const now = Date.now();
        const ip = clientIp(req);
        const b = bucket(ip, now);
        b.failures += 1;
        if (b.failures > MAX) {
          if (!b.logged) {
            b.logged = true;
            try {
              db.prepare(`
                INSERT INTO audit_log (actor_id, action, entity_type, metadata_json, ip)
                VALUES (NULL, 'credential.abuse_blocked', 'user', NULL, ?)
              `).run(ip);
            } catch {}
          }
          res.set('Retry-After', String(Math.ceil((b.resetAt - now) / 1000)));
          res.statusCode = 429;
          return origJson({ error: 'Too many invalid attempts. Please wait and try again.' });
        }
      }
    } catch {}
    if (buckets.size > 5000 && Math.random() < 0.01) {
      const now2 = Date.now();
      for (const [k, v] of buckets) if (v.resetAt <= now2) buckets.delete(k);
    }
    return origJson(body);
  };
  next();
}

// Used by tests/ops to observe state; not a request gate.
export function abuseStats() {
  return { ips: buckets.size, windowMs: WINDOW_MS, max: MAX };
}
