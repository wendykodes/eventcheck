import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';

const router = Router();
router.use(requireAuth);

// Create menu item
router.post('/', requireAdmin, (req, res) => {
  const { event_id, category_id, kind, label, description, price, available, image_url } = req.body;
  if (!event_id || !kind || !label) {
    return res.status(400).json({ error: 'event_id, kind, and label are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO menu_items (event_id, category_id, kind, label, description, price, available, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_id, category_id || null, kind, label, description || null, price || null, available !== false ? 1 : 0, image_url || null);

    const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(item);
  } catch (err) {
    console.error('Create menu item error:', err);
    res.status(500).json({ error: 'Failed to create menu item' });
  }
});

// Get menu items for an event
router.get('/', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const items = db.prepare(`
    SELECT * FROM menu_items 
    WHERE event_id = ? AND available = 1
    ORDER BY kind, label
  `).all(event_id);

  // Group by kind
  const grouped = {};
  items.forEach(item => {
    if (!grouped[item.kind]) grouped[item.kind] = [];
    grouped[item.kind].push(item);
  });

  res.json({ items, grouped });
});

// Update menu item
router.put('/:id', requireAdmin, (req, res) => {
  const { kind, label, description, price, available, image_url } = req.body;
  
  const updates = [];
  const params = [];
  if (kind !== undefined) { updates.push('kind = ?'); params.push(kind); }
  if (label !== undefined) { updates.push('label = ?'); params.push(label); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (price !== undefined) { updates.push('price = ?'); params.push(price); }
  if (available !== undefined) { updates.push('available = ?'); params.push(available ? 1 : 0); }
  if (image_url !== undefined) { updates.push('image_url = ?'); params.push(image_url); }
  
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  
  params.push(req.params.id);
  db.prepare(`UPDATE menu_items SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(req.params.id);
  res.json(item);
});

// Delete menu item
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Create menu category
router.post('/categories', requireAdmin, (req, res) => {
  const { event_id, name, icon, display_order } = req.body;
  if (!event_id || !name) {
    return res.status(400).json({ error: 'event_id and name are required' });
  }

  const result = db.prepare(`
    INSERT INTO menu_categories (event_id, name, icon, display_order)
    VALUES (?, ?, ?, ?)
  `).run(event_id, name, icon || null, display_order || 0);

  const category = db.prepare('SELECT * FROM menu_categories WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(category);
});

// Get menu categories
router.get('/categories', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const categories = db.prepare(`
    SELECT * FROM menu_categories 
    WHERE event_id = ?
    ORDER BY display_order, name
  `).all(event_id);

  res.json(categories);
});

export default router;
