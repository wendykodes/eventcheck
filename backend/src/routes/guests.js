import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess, requireEntityEventAccess, guestEventId } from '../middleware/authorize.js';
import { getLifecycle, writePolicy } from '../raas/readiness.js';
import { auditFromReq } from '../audit.js';
import { checkFresh } from './opsCommon.js';
import { formatUgandanPhoneNumber } from '../phoneUtils.js';

const router = Router();

router.use(requireAuth);

router.get('/', requireEventAccess(), (req, res) => {
  const { event_id, q, status } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });
  // Phase 5 scale: bounded pages (default 200, max 1000) + total header.
  const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);
  let query = 'SELECT g.*, u.name AS submitted_by_name FROM guests g LEFT JOIN users u ON u.id = g.submitted_by WHERE g.event_id = ?';
  const params = [event_id];
  const s = status || 'approved';
  query += ' AND g.status = ?';
  params.push(s);
  if (q) {
    query += ' AND (g.name LIKE ? OR g.phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  const total = db.prepare(`SELECT COUNT(*) AS c FROM guests g WHERE g.event_id = ? AND g.status = ?${q ? ' AND (g.name LIKE ? OR g.phone LIKE ?)' : ''}`)
    .get(...(q ? [event_id, s, `%${q}%`, `%${q}%`] : [event_id, s])).c;
  query += ' ORDER BY g.name ASC LIMIT ?';
  params.push(limit);
  const guests = db.prepare(query).all(...params);

  // Fetch checkins only for the returned page (bounded embed).
  const ids = guests.map((g) => g.id);
  const checkinsByGuest = {};
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const checkins = db.prepare(`
      SELECT c.id, c.guest_id, c.activity_id, c.checked_in_at, c.staff_id, u.name AS staff_name
      FROM checkins c
      JOIN activities a ON a.id = c.activity_id
      LEFT JOIN users u ON u.id = c.staff_id
      WHERE c.guest_id IN (${placeholders})
    `).all(...ids);
    for (const ci of checkins) {
      if (!checkinsByGuest[ci.guest_id]) {
        checkinsByGuest[ci.guest_id] = [];
      }
      checkinsByGuest[ci.guest_id].push(ci);
    }
  }

  for (const g of guests) {
    g.checkins = checkinsByGuest[g.id] || [];
  }

  res.set('X-Total-Count', String(total));
  res.set('X-Truncated', guests.length < total ? 'true' : 'false');
  res.json(guests);
});

router.get('/pending/count', requireEventAccess(), (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });
  const count = db.prepare('SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = ?').get(event_id, 'pending');
  res.json({ count: count.c });
});

router.get('/:id', requireEntityEventAccess(guestEventId), (req, res) => {
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

router.post('/', requireEventAccess(), (req, res) => {
  try {
    const { event_id, name, phone, email, table_number, guest_count, category, notes } = req.body;
    if (Number(event_id) !== Number(req.eventId)) return res.status(400).json({ error: 'event_id mismatch' });
    const policy = writePolicy(getLifecycle(Number(event_id)), 'guest.create');
    if (!policy.ok) return res.status(409).json({ error: policy.error });
    if (!event_id || !name || !name.trim()) {
      return res.status(400).json({ error: 'event_id and name are required' });
    }
    const formattedPhone = phone && phone.trim() ? formatUgandanPhoneNumber(phone.trim()) : null;
    const status = req.body.status || (req.user.role === 'admin' ? 'approved' : 'pending');
    const result = db.prepare(`
      INSERT INTO guests (event_id, name, phone, email, table_number, guest_count, category, notes, status, submitted_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_id,
      name.trim(),
      formattedPhone,
      email && email.trim() ? email.trim() : null,
      table_number !== undefined && table_number !== null ? String(table_number).trim() : null,
      guest_count ? Number(guest_count) : 1,
      category && category.trim() ? category.trim() : null,
      notes && notes.trim() ? notes.trim() : null,
      status,
      req.user.id
    );
    const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(result.lastInsertRowid);
    auditFromReq(req, { action: 'guest.create', entityType: 'guest', entityId: result.lastInsertRowid, eventId: Number(event_id), metadata: { name: name.trim() } });
    res.status(201).json(guest);
  } catch (err) {
    console.error('Create guest error:', err);
    res.status(400).json({ error: 'Failed to create guest: ' + err.message });
  }
});

router.put('/:id/approve', requireAdmin, requireEntityEventAccess(guestEventId), (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!existing) return res.status(404).json({ error: 'Pending guest not found' });
  db.prepare("UPDATE guests SET status = 'approved', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  auditFromReq(req, { action: 'guest.approve', entityType: 'guest', entityId: req.params.id, eventId: req.eventId });
  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  res.json(guest);
});

router.put('/:id/reject', requireAdmin, requireEntityEventAccess(guestEventId), (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ? AND status = ?').get(req.params.id, 'pending');
  if (!existing) return res.status(404).json({ error: 'Pending guest not found' });
  db.prepare("UPDATE guests SET status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  auditFromReq(req, { action: 'guest.reject', entityType: 'guest', entityId: req.params.id, eventId: req.eventId });
  res.json({ ok: true });
});

router.put('/:id', requireAdmin, requireEntityEventAccess(guestEventId), (req, res) => {
  const existing = db.prepare('SELECT * FROM guests WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Guest not found' });
  if (!checkFresh(existing, req.body, res)) return;
  const { name, phone, email, table_number, guest_count, category, notes } = req.body;
  const formattedPhone = phone !== undefined ? (phone ? formatUgandanPhoneNumber(phone) : null) : existing.phone;
  db.prepare(`
    UPDATE guests SET name=?, phone=?, email=?, table_number=?, guest_count=?, category=?, notes=?, updated_at=strftime('%Y-%m-%d %H:%M:%f','now')
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

router.delete('/:id', requireAdmin, requireEntityEventAccess(guestEventId), (req, res) => {
  const result = db.prepare('DELETE FROM guests WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Guest not found' });
  auditFromReq(req, { action: 'guest.delete', entityType: 'guest', entityId: req.params.id, eventId: req.eventId });
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
