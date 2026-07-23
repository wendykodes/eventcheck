import { Router } from 'express';
import bcrypt from 'bcrypt';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const WEAK_PINS = new Set(['1111', '1234', '0000', '9999', '1212', '4321', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '1122', '2211', '1221', '2112', '12345', '123456']);

function isPinWeak(pin) {
  if (WEAK_PINS.has(pin)) return true;
  if (/^(\d)\1{3,}$/.test(pin)) return true;
  if (/^12(3(4(5(6)?)?)?)?$/.test(pin)) return true;
  if (/^(?:4321|54321|654321)$/.test(pin)) return true;
  return false;
}

function isPinTaken(pin) {
  const users = db.prepare('SELECT pin_hash FROM users').all();
  for (const u of users) {
    if (bcrypt.compareSync(pin, u.pin_hash)) return true;
  }
  const requests = db.prepare("SELECT pin_hash FROM registration_requests WHERE status = 'pending'").all();
  for (const r of requests) {
    if (bcrypt.compareSync(pin, r.pin_hash)) return true;
  }
  return false;
}

const router = Router();

router.use(requireAuth);

router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.name, u.role, u.status, u.created_at, u.last_login,
      (SELECT MAX(checked_in_at) FROM checkins WHERE staff_id = u.id) AS last_activity
    FROM users u ORDER BY u.name ASC
  `).all();
  const getEventIds = db.prepare('SELECT event_id FROM user_events WHERE user_id = ?');
  for (const u of users) {
    u.event_ids = getEventIds.all(u.id).map(r => r.event_id);
  }
  res.json(users);
});

router.get('/:id', requireAdmin, (req, res) => {
  const user = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM checkins WHERE staff_id = u.id) AS total_checkins,
      (SELECT MAX(checked_in_at) FROM checkins WHERE staff_id = u.id) AS last_activity
    FROM users u WHERE u.id = ?
  `).get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { pin_hash, ...safe } = user;
  safe.assigned_events = db.prepare(`
    SELECT e.id, e.name, e.status FROM events e
    JOIN user_events ue ON ue.event_id = e.id WHERE ue.user_id = ?
  `).all(req.params.id);
  res.json(safe);
});

router.post('/', requireAdmin, (req, res) => {
  const { name, pin, role, event_ids } = req.body;
  if (!name || !pin) return res.status(400).json({ error: 'Name and PIN are required' });
  if (pin.length < 4 || pin.length > 6) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
  if (isPinWeak(pin)) return res.status(400).json({ error: 'This PIN is too common. Please choose a stronger PIN.' });
  if (isPinTaken(pin)) return res.status(409).json({ error: 'This PIN is already in use. Please choose a different PIN.' });
  const pin_hash = bcrypt.hashSync(pin, 10);
  const result = db.prepare('INSERT INTO users (name, pin_hash, role, status) VALUES (?, ?, ?, ?)').run(name, pin_hash, role || 'staff', 'active');
  if (Array.isArray(event_ids) && event_ids.length > 0) {
    const insert = db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)');
    for (const eid of event_ids) insert.run(result.lastInsertRowid, eid);
  }
  const user = db.prepare('SELECT id, name, role, status, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(user);
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const { name, pin, role, status, event_ids } = req.body;

  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (role !== undefined) { updates.push('role = ?'); params.push(role); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (pin) {
    if (pin.length < 4 || pin.length > 6) return res.status(400).json({ error: 'PIN must be 4–6 digits' });
    updates.push('pin_hash = ?');
    params.push(bcrypt.hashSync(pin, 10));
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  if (Array.isArray(event_ids)) {
    db.prepare('DELETE FROM user_events WHERE user_id = ?').run(req.params.id);
    const insert = db.prepare('INSERT INTO user_events (user_id, event_id) VALUES (?, ?)');
    for (const eid of event_ids) insert.run(req.params.id, eid);
  }

  const user = db.prepare('SELECT id, name, role, status, created_at, last_login FROM users WHERE id = ?').get(req.params.id);
  res.json(user);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
  res.json({ ok: true });
});

export default router;
