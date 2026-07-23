import { Router } from 'express';
import crypto from 'crypto';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  let events;
  if (req.user.role === 'admin') {
    events = db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  } else {
    events = db.prepare(`
      SELECT e.* FROM events e
      JOIN user_events ue ON ue.event_id = e.id
      WHERE ue.user_id = ?
      ORDER BY e.date DESC
    `).all(req.user.id);
  }
  res.json(events);
});

router.get('/:id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

router.post('/', requireAdmin, (req, res) => {
  const { name, date, venue, description, status } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const result = db.prepare(
    'INSERT INTO events (name, date, venue, description, status) VALUES (?, ?, ?, ?, ?)'
  ).run(name, date || null, venue || null, description || null, status || 'upcoming');
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(event);
});

router.put('/:id', requireAdmin, (req, res) => {
  const { name, date, venue, description, status } = req.body;
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  db.prepare(`
    UPDATE events SET name=?, date=?, venue=?, description=?, status=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? existing.name,
    date !== undefined ? date : existing.date,
    venue !== undefined ? venue : existing.venue,
    description !== undefined ? description : existing.description,
    status ?? existing.status,
    req.params.id
  );
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  res.json(event);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Event not found' });
  res.json({ ok: true });
});

router.get('/:id/access-code', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT id, name, staff_access_code FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json({ access_code: event.staff_access_code });
});

router.put('/:id/access-code', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const { access_code } = req.body;
  const code = access_code || crypto.randomBytes(4).toString('hex').toUpperCase();
  db.prepare('UPDATE events SET staff_access_code = ?, updated_at = datetime(\'now\') WHERE id = ?').run(code, req.params.id);
  res.json({ access_code: code });
});

router.delete('/:id/access-code', requireAdmin, (req, res) => {
  db.prepare('UPDATE events SET staff_access_code = NULL, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
