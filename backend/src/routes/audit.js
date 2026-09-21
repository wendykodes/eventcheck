// RaaS Phase 0 — Audit trail reads (tamper-resistant: append-only, no update/delete routes).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';

const router = Router();
router.use(requireAuth);

router.get('/event/:eventId', requireEventAccess(), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.event_id = ? ORDER BY a.id DESC LIMIT ?
  `).all(req.eventId, limit);
  res.json(rows);
});

router.get('/recent', requireAdmin, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json(db.prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit));
});

export default router;
