// RaaS Phase 0 — Audit trail reads (tamper-resistant: append-only, no update/delete routes).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';

const router = Router();
router.use(requireAuth);

router.get('/event/:eventId', requireEventAccess(), (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const { action_type, entity_type, actor_id, start_date, end_date, search } = req.query;
  
  let whereClauses = ['a.event_id = ?'];
  let params = [req.eventId];
  
  if (action_type) {
    whereClauses.push('a.action_type = ?');
    params.push(action_type);
  }
  if (entity_type) {
    whereClauses.push('a.entity_type = ?');
    params.push(entity_type);
  }
  if (actor_id) {
    whereClauses.push('a.actor_id = ?');
    params.push(actor_id);
  }
  if (start_date) {
    whereClauses.push('a.created_at >= ?');
    params.push(start_date);
  }
  if (end_date) {
    whereClauses.push('a.created_at <= ?');
    params.push(end_date);
  }
  if (search) {
    whereClauses.push('(a.details LIKE ? OR a.entity_id LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  
  const whereClause = whereClauses.join(' AND ');
  
  const rows = db.prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE ${whereClause} ORDER BY a.id DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);
  
  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM audit_log a
    WHERE ${whereClause}
  `).get(...params).count;
  
  res.json({ rows, total, limit, offset });
});

router.get('/event/:eventId/export', requireEventAccess(), (req, res) => {
  const { action_type, entity_type, actor_id, start_date, end_date, search } = req.query;
  
  let whereClauses = ['a.event_id = ?'];
  let params = [req.params.eventId];
  
  if (action_type) {
    whereClauses.push('a.action_type = ?');
    params.push(action_type);
  }
  if (entity_type) {
    whereClauses.push('a.entity_type = ?');
    params.push(entity_type);
  }
  if (actor_id) {
    whereClauses.push('a.actor_id = ?');
    params.push(actor_id);
  }
  if (start_date) {
    whereClauses.push('a.created_at >= ?');
    params.push(start_date);
  }
  if (end_date) {
    whereClauses.push('a.created_at <= ?');
    params.push(end_date);
  }
  if (search) {
    whereClauses.push('(a.details LIKE ? OR a.entity_id LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  
  const whereClause = whereClauses.join(' AND ');
  
  const rows = db.prepare(`
    SELECT a.id, a.created_at, a.action_type, a.entity_type, a.entity_id, a.actor_id, u.name AS actor_name, a.details
    FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE ${whereClause} ORDER BY a.id DESC
  `).all(...params);
  
  const csv = [
    'ID,Timestamp,Action,Entity Type,Entity ID,Actor,Details',
    ...rows.map(r => [
      r.id,
      r.created_at,
      r.action_type,
      r.entity_type,
      r.entity_id,
      r.actor_name || r.actor_id,
      `"${(r.details || '').replace(/"/g, '""')}"`
    ].join(','))
  ].join('\n');
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="audit-${req.params.eventId}.csv"`);
  res.send(csv);
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
