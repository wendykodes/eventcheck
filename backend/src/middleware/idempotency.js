// RaaS Phase 2 — Idempotency-Key support for safe retries (§39, 2.12).
// Client sends `Idempotency-Key: <uuid>` on POST creates. Same key + same
// actor + same path replays the stored response instead of duplicating work.
// Different payload with a reused key → 422 (client bug, surfaced loudly).

import db from '../database.js';

export function withIdempotency(handler) {
  return (req, res) => {
    const key = req.headers['idempotency-key'];
    if (!key || typeof key !== 'string' || !key.trim()) return handler(req, res);
    const k = key.trim().slice(0, 128);
    const prior = db.prepare('SELECT response_status, response_json FROM idempotency_keys WHERE key = ? AND actor_id = ? AND method = ? AND path = ?')
      .get(k, req.user ? req.user.id : null, req.method, req.path);
    if (prior) {
      res.set('Idempotent-Replayed', 'true');
      return res.status(prior.response_status).json(JSON.parse(prior.response_json));
    }
    // Wrap res.json to capture the first response for this key.
    const origJson = res.json.bind(res);
    res.json = (body) => {
      try {
        db.prepare(`INSERT OR IGNORE INTO idempotency_keys (key, event_id, actor_id, method, path, response_status, response_json)
          VALUES (?, ?, ?, ?, ?, ?, ?)`)
          .run(k, req.eventId || null, req.user ? req.user.id : null, req.method, req.path, res.statusCode, JSON.stringify(body));
      } catch {}
      return origJson(body);
    };
    return handler(req, res);
  };
}
