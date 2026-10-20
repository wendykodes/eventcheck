import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';

const router = Router();

router.use(requireAuth);

// Get announcements for an event
router.get('/', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const announcements = db.prepare(`
    SELECT a.*, u.name AS created_by_name
    FROM announcements a
    LEFT JOIN users u ON u.id = a.created_by
    WHERE a.event_id = ? AND (a.expires_at IS NULL OR a.expires_at > datetime('now'))
    ORDER BY a.created_at DESC
  `).all(event_id);

  res.json(announcements);
});

// Create an announcement (admin only)
router.post('/', requireAdmin, (req, res) => {
  const { event_id, title, body, priority, expires_at, zone, delivery_channels, status, scheduled_at, media_urls } = req.body;
  if (!event_id || !title || !body) {
    return res.status(400).json({ error: 'event_id, title, and body are required' });
  }

  const result = db.prepare(`
    INSERT INTO announcements (event_id, title, body, priority, created_by, expires_at, zone, delivery_channels, status, scheduled_at, media_urls)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event_id, title, body, priority || 'normal', req.user.id, expires_at || null, zone || null, 
    delivery_channels ? JSON.stringify(delivery_channels) : null, status || 'PUBLISHED', scheduled_at || null, 
    media_urls ? JSON.stringify(media_urls) : null);

  const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(announcement);
});

// Delete an announcement (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const announcement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!announcement) return res.status(404).json({ error: 'Announcement not found' });

  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Mark announcement as read
router.post('/:id/read', requireEventAccess, (req, res) => {
  const { guest_id } = req.body;
  const userId = req.user.id;
  
  const existing = db.prepare(`
    SELECT id FROM announcement_reads WHERE announcement_id = ? AND user_id = ?
  `).get(req.params.id, userId);
  
  if (existing) {
    return res.json({ ok: true, already_read: true });
  }
  
  db.prepare(`
    INSERT INTO announcement_reads (announcement_id, user_id, guest_id, read_at, delivery_status)
    VALUES (?, ?, ?, datetime('now'), 'delivered')
  `).run(req.params.id, userId, guest_id || null);
  
  res.json({ ok: true });
});

// Get read receipts for an announcement
router.get('/:id/receipts', requireEventAccess, (req, res) => {
  const receipts = db.prepare(`
    SELECT ar.*, u.name AS user_name, g.name AS guest_name
    FROM announcement_reads ar
    LEFT JOIN users u ON u.id = ar.user_id
    LEFT JOIN guests g ON g.id = ar.guest_id
    WHERE ar.announcement_id = ?
    ORDER BY ar.read_at DESC
  `).all(req.params.id);
  
  const stats = db.prepare(`
    SELECT 
      COUNT(*) AS total_reads,
      SUM(CASE WHEN delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered,
      SUM(CASE WHEN delivery_status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM announcement_reads WHERE announcement_id = ?
  `).get(req.params.id);
  
  res.json({ receipts, stats });
});

// Template CRUD
router.get('/templates', (req, res) => {
  const { event_id } = req.query;
  const templates = db.prepare('SELECT * FROM announcement_templates WHERE event_id = ? OR event_id IS NULL ORDER BY name').all(event_id || null);
  res.json(templates);
});

router.post('/templates', requireAdmin, (req, res) => {
  const { event_id, name, title, body, priority, delivery_channels } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }
  
  const result = db.prepare(`
    INSERT INTO announcement_templates (event_id, name, title, body, priority, delivery_channels, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(event_id || null, name, title || null, body || null, priority || 'normal', 
    delivery_channels ? JSON.stringify(delivery_channels) : null, req.user.id);
  
  res.status(201).json(db.prepare('SELECT * FROM announcement_templates WHERE id = ?').get(result.lastInsertRowid));
});

router.delete('/templates/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcement_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
