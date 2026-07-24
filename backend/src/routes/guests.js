import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { formatUgandanPhoneNumber } from '../phoneUtils.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const { event_id, q, status } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });
  let query = 'SELECT g.*, u.name AS submitted_by_name FROM guests g LEFT JOIN users u ON u.id = g.submitted_by WHERE g.event_id = ?';
  const params = [event_id];
  const s = status || 'approved';
  query += ' AND g.status = ?';
  params.push(s);
  if (q) {
    query += ' AND (g.name LIKE ? OR g.phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  query += ' ORDER BY g.name ASC';
  const guests = db.prepare(query).all(...params);

  // Fetch checkins for this event and group them by guest_id to optimize frontend load
  const checkins = db.prepare(`
    SELECT c.id, c.guest_id, c.activity_id, c.checked_in_at, c.staff_id, u.name AS staff_name
    FROM checkins c
    JOIN activities a ON a.id = c.activity_id
    LEFT JOIN users u ON u.id = c.staff_id
    WHERE a.event_id = ?
  `).all(event_id);

  const checkinsByGuest = {};
  for (const ci of checkins) {
    if (!checkinsByGuest[ci.guest_id]) {
      checkinsByGuest[ci.guest_id] = [];
    }
    checkinsByGuest[ci.guest_id].push(ci);
  }

  for (const g of guests) {
    g.checkins = checkinsByGuest[g.id] || [];
  }

  res.json(guests);
});

router.get('/pending/count', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = ?').get(event_id, 'pending');
  res.json({ count: count.c });
});

router.get('/:id', (req, res) => {
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  if (!guest) return res.status(404).json({ error: 'Guest not found' });
  
  const checkins = db.prepare(`
    SELECT c.id, c.guest_id, c.activity_id, c.checked_in_at, c.staff_id, u.name AS staff_name
    FROM checkins c
    LEFT JOIN users u ON u.id = c.staff_id
    WHERE c.guest_id = ?
  `).all(guest.id);
  guest.checkins = checkins;

  res.json(guest);
});

router.post('/', (req, res) => {
  const { event_id, name, phone, email, table_number, guest_count, category, notes } = req.body;
  if (!event_id || !name) {
    return res.status(400).json({ error: 'event_id and name are required' });
  }
  const formattedPhone = phone ? formatUgandanPhoneNumber(phone) : null;
  const isAdmin = req.user.role === 'admin';
  const status = isAdmin ? 'approved' : 'pending';
  const result = db.prepare(`
    INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes, status, submitted_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(event_id, name, formattedPhone, email || null, table_number || null, guest_count || 1, category || null, notes || null, status, isAdmin ? null : req.user.id);
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(guest);
});

router.put('/:id/approve', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!existing) return res.status(404).json({ error: 'Pending guest not found' });
  db.prepare("UPDATE guests SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  res.json(guest);
});

router.put('/:id/reject', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!existing) return res.status(404).json({ error: 'Pending guest not found' });
  db.prepare("UPDATE guests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Guest not found' });
  const { name, phone, email, table_number, guest_count, category, notes } = req.body;
  const formattedPhone = phone !== undefined ? (phone ? formatUgandanPhoneNumber(phone) : null) : existing.phone;
  db.prepare(`
    UPDATE guests SET name=?, phone=?, email=?, table_number=?, guest_count=?, category=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(
    name ?? existing.name,
    formattedPhone,
    email !== undefined ? email : existing.email,
    table_number !== undefined ? table_number : existing.table_number,
    guest_count ?? existing.guest_count,
    category !== undefined ? category : existing.category,
    notes !== undefined ? notes : existing.notes,
    req.params.id
  );
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  res.json(guest);
});

router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM guests WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Guest not found' });
  res.json({ ok: true });
});

router.post('/bulk', requireAdmin, (req, res) => {
  const { event_id, guest_ids, action, value } = req.body;
  if (!event_id || !guest_ids || !Array.isArray(guest_ids) || guest_ids.length === 0 || !action) {
    return res.status(400).json({ error: 'event_id, guest_ids array, and action are required' });
  }

  const placeholders = guest_ids.map(() => '?').join(',');
  let query;

  switch (action) {
    case 'delete':
      query = `DELETE FROM guests WHERE id IN (${placeholders}) AND event_id = ?`;
      break;
    case 'assign_category':
      query = `UPDATE guests SET category = ?, updated_at = datetime('now') WHERE id IN (${placeholders}) AND event_id = ?`;
      break;
    case 'assign_table':
      query = `UPDATE guests SET table_number = ?, updated_at = datetime('now') WHERE id IN (${placeholders}) AND event_id = ?`;
      break;
    case 'update_guest_count': {
      const count = parseInt(value, 10);
      if (isNaN(count) || count < 1) return res.status(400).json({ error: 'Invalid guest count value' });
      query = `UPDATE guests SET guest_count = ?, updated_at = datetime('now') WHERE id IN (${placeholders}) AND event_id = ?`;
      break;
    }
    case 'update_notes':
      query = `UPDATE guests SET notes = ?, updated_at = datetime('now') WHERE id IN (${placeholders}) AND event_id = ?`;
      break;
    default:
      return res.status(400).json({ error: 'Unknown action: ' + action });
  }

  const params = action === 'delete'
    ? [...guest_ids, event_id]
    : [value, ...guest_ids, event_id];

  const result = db.prepare(query).run(...params);
  res.json({ ok: true, affected: result.changes });
});

router.post('/import', requireAdmin, (req, res) => {
  const { event_id, guests: guestList } = req.body;
  if (!event_id || !Array.isArray(guestList) || guestList.length === 0) {
    return res.status(400).json({ error: 'event_id and guests array are required' });
  }
  const insert = db.prepare(`
    INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const results = { imported: 0, skipped: 0, errors: [] };
  const tx = db.transaction(() => {
    for (const g of guestList) {
      if (!g.name || !g.phone) {
        results.errors.push({ name: g.name, reason: 'Missing name or phone' });
        continue;
      }
      const existing = db.prepare('SELECT id FROM guests WHERE event_id = ? AND phone = ?').get(event_id, g.phone);
      if (existing) {
        results.skipped++;
        continue;
      }
      insert.run(event_id, g.name, g.phone, g.email || null, g.table_number || null, g.guest_count || 1, g.category || null, g.notes || null);
      results.imported++;
    }
  });
  tx();
  res.json(results);
});

export default router;
