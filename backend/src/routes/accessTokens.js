// RaaS Phase 0 — Passwordless access-token foundation (spec §20-21).
// High-entropy tokens, stored hashed (sha256), expiring, revocable,
// single-use capable, scoped. Server determines authorization.

import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditFromReq } from '../audit.js';

const router = Router();

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function publicTokenRow(row) {
  if (!row) return row;
  const { token_hash, ...rest } = row;
  return rest;
}

// Issue: POST /api/access-tokens { event_id, subject_type, subject_id?, scope?, ttl_hours?, single_use? }
router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { event_id, subject_type, subject_id, scope, ttl_hours, single_use } = req.body;
  if (!event_id || !subject_type) return res.status(400).json({ error: 'event_id and subject_type are required' });
  if (!['guest', 'staff'].includes(subject_type)) return res.status(400).json({ error: 'Invalid subject_type' });
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const raw = crypto.randomBytes(32).toString('hex'); // 256-bit entropy
  const ttl = Math.min(Math.max(Number(ttl_hours) || 72, 1), 24 * 30);
  const expiresAt = new Date(Date.now() + ttl * 3600 * 1000).toISOString().replace('T', ' ').split('.')[0];
  const r = db.prepare(`
    INSERT INTO access_tokens (event_id, subject_type, subject_id, token_hash, scope_json, expires_at, single_use, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    event_id, subject_type, subject_id || null, hashToken(raw),
    JSON.stringify(scope || {}), expiresAt, single_use === false ? 0 : 1, req.user.id,
  );
  auditFromReq(req, { action: 'token.issue', entityType: 'access_token', entityId: r.lastInsertRowid, eventId: Number(event_id), metadata: { subject_type, subject_id } });
  res.status(201).json({ id: r.lastInsertRowid, token: raw, expires_at: expiresAt });
});

// Verify (public): GET /api/access-tokens/verify/:token → scoped session info, no secrets.
router.get('/verify/:token', (req, res) => {
  const h = hashToken(req.params.token);
  const row = db.prepare(`SELECT * FROM access_tokens WHERE token_hash = ?`).get(h);
  if (!row) return res.status(404).json({ error: 'Invalid token' });
  if (row.revoked_at) return res.status(410).json({ error: 'Token revoked' });
  if (row.expires_at <= new Date().toISOString().replace('T', ' ').split('.')[0]) {
    return res.status(410).json({ error: 'Token expired' });
  }
  if (row.single_use && row.used_at) return res.status(410).json({ error: 'Token already used' });
  const event = db.prepare('SELECT id, name, lifecycle_state FROM events WHERE id = ?').get(row.event_id);
  res.json({ event, subject_type: row.subject_type, subject_id: row.subject_id, scope: JSON.parse(row.scope_json || '{}'), expires_at: row.expires_at });
});

// Consume single-use token (marks used). POST /api/access-tokens/consume { token }
router.post('/consume', (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });
  const h = hashToken(token);
  const row = db.prepare('SELECT * FROM access_tokens WHERE token_hash = ?').get(h);
  if (!row || row.revoked_at) return res.status(404).json({ error: 'Invalid token' });
  if (row.single_use) db.prepare("UPDATE access_tokens SET used_at = datetime('now') WHERE id = ?").run(row.id);
  res.json({ ok: true, event_id: row.event_id });
});

// Revoke: POST /api/access-tokens/:id/revoke
router.post('/:id/revoke', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM access_tokens WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Token not found' });
  db.prepare("UPDATE access_tokens SET revoked_at = datetime('now') WHERE id = ?").run(req.params.id);
  auditFromReq(req, { action: 'token.revoke', entityType: 'access_token', entityId: req.params.id, eventId: row.event_id });
  res.json({ ok: true });
});

router.get('/event/:eventId', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, event_id, subject_type, subject_id, scope_json, expires_at, revoked_at, used_at, created_at FROM access_tokens WHERE event_id = ? ORDER BY created_at DESC').all(req.params.eventId));
});

export default router;
