import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });
  let activities = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(event_id);
  if (activities.length === 0) {
    db.prepare("INSERT INTO activities (event_id, name, sort_order) VALUES (?, 'General Check-In', 0)").run(event_id);
    activities = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(event_id);
  }
  res.json(activities);
});

router.post('/', requireAdmin, (req, res) => {
  const { event_id, name } = req.body;
  if (!event_id || !name) return res.status(400).json({ error: 'event_id and name are required' });
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM activities WHERE event_id = ?').get(event_id);
  const result = db.prepare('INSERT INTO activities (event_id, name, sort_order) VALUES (?, ?, ?)').run(event_id, name, maxOrder.next);
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(activity);
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Activity not found' });
  const { name, sort_order } = req.body;
  db.prepare('UPDATE activities SET name=?, sort_order=?, updated_at=datetime(\'now\') WHERE id=?').run(
    name ?? existing.name,
    sort_order !== undefined ? sort_order : existing.sort_order,
    req.params.id
  );
  const activity = db.prepare('SELECT * FROM activities WHERE id = ?').get(req.params.id);
  res.json(activity);
});

router.put('/reorder/:event_id', requireAdmin, (req, res) => {
  const { ordered_ids } = req.body;
  if (!Array.isArray(ordered_ids)) return res.status(400).json({ error: 'ordered_ids array required' });
  const tx = db.transaction(() => {
    ordered_ids.forEach((id, i) => {
      db.prepare('UPDATE activities SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ? AND event_id = ?').run(i, id, req.params.event_id);
    });
  });
  tx();
  const activities = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(req.params.event_id);
  res.json(activities);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM activities WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Activity not found' });
  res.json({ ok: true });
});

export default router;
