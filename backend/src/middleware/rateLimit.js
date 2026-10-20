// Login brute-force guard. Staff/admin PINs are short by design (usable on
// shared entrance devices), so unauthenticated guessing must be throttled.
// In-memory sliding window per IP; auto-resets. Override the budget with
// LOGIN_RATE_LIMIT_MAX (default 60 / LOGIN_RATE_LIMIT_WINDOW_MS, default
// 15 minutes). Other endpoints need no throttle: invitation/check-in
// credentials are high-entropy bearer tokens, not guessable PINs.

import db from '../database.js';

const WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000;
const MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX) || 60;

const hits = new Map(); // ip -> { count, resetAt, logged }

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (req.ip || 'unknown').slice(0, 64);
}

export { clientIp };

function auditOnce(ip) {
  try {
    db.prepare(`
      INSERT INTO audit_log (actor_id, action, entity_type, metadata_json, ip)
      VALUES (NULL, 'auth.login.rate_limited', 'user', NULL, ?)
    `).run(ip);
  } catch {}
}

export function loginRateLimit(req, res, next) {
  const now = Date.now();
  const ip = clientIp(req);
  let slot = hits.get(ip);
  if (!slot || now >= slot.resetAt) {
    slot = { count: 0, resetAt: now + WINDOW_MS, logged: false };
    hits.set(ip, slot);
  }
  slot.count += 1;
  if (slot.count > MAX) {
    if (!slot.logged) {
      slot.logged = true;
      auditOnce(ip);
    }
    res.set('Retry-After', String(Math.ceil((slot.resetAt - now) / 1000)));
    return res.status(429).json({ error: 'Too many login attempts. Please wait and try again.' });
  }
  // Opportunistic cleanup so the map cannot grow unboundedly.
  if (hits.size > 5000 && Math.random() < 0.01) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }
  next();
}
