import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.post('/', (req, res) => {
  const { guest_id, activity_id } = req.body;
  if (!guest_id || !activity_id) {
    return res.status(400).json({ error: 'guest_id and activity_id are required' });
  }
  const guest = db.prepare('SELECT status FROM guests WHERE id = ?').get(guest_id);
  if (!guest) return res.status(404).json({ error: 'Guest not found' });
  if (guest.status !== 'approved') return res.status(403).json({ error: 'Guest is not yet approved' });
  const existing = db.prepare('SELECT * FROM checkins WHERE guest_id = ? AND activity_id = ?').get(guest_id, activity_id);
  if (existing) {
    return res.status(409).json({ error: 'Already checked in', checkin: existing });
  }
  const result = db.prepare('INSERT INTO checkins (guest_id, activity_id, staff_id) VALUES (?, ?, ?)').run(guest_id, activity_id, req.user.id);
  const checkin = db.prepare(`
    SELECT c.*, u.name AS staff_name, g.name AS guest_name, g.guest_count, a.name AS activity_name
    FROM checkins c
    JOIN users u ON u.id = c.staff_id
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(checkin);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM checkins WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Check-in not found' });
  res.json({ ok: true });
});

router.get('/guest/:guest_id', (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, a.name AS activity_name, u.name AS staff_name
    FROM checkins c
    JOIN activities a ON a.id = c.activity_id
    JOIN users u ON u.id = c.staff_id
    WHERE c.guest_id = ?
    ORDER BY c.checked_in_at DESC
  `).all(req.params.guest_id);
  res.json(checkins);
});

router.get('/activity/:activity_id', (req, res) => {
  const checkins = db.prepare(`
    SELECT c.*, g.name AS guest_name, g.phone, g.guest_count, g.table_number, u.name AS staff_name
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN users u ON u.id = c.staff_id
    WHERE c.activity_id = ?
    ORDER BY c.checked_in_at DESC
  `).all(req.params.activity_id);
  res.json(checkins);
});

export default router;
