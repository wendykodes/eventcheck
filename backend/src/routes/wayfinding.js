// Wayfinding Routes - Event navigation and venue mapping
import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { userHasEventAccess } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';

const router = Router();

router.use(requireAuth);

// Get wayfinding routes for an event
router.get('/routes', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, event_id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }

  try {
    const routes = db.prepare(`
      SELECT wr.*, 
        e.name AS event_name
      FROM wayfinding_routes wr
      LEFT JOIN events e ON e.id = wr.event_id
      WHERE wr.event_id = ?
      ORDER BY wr.from_zone, wr.to_zone
    `).all(event_id);
    res.json(routes);
  } catch (err) {
    console.error('Get wayfinding routes error:', err);
    res.status(500).json({ error: 'Failed to get wayfinding routes' });
  }
});

// Create a new wayfinding route
router.post('/routes', (req, res) => {
  const { event_id, from_zone, to_zone, description, distance_meters, estimated_minutes, instructions, accessibility } = req.body;
  if (!event_id || !from_zone || !to_zone) {
    return res.status(400).json({ error: 'event_id, from_zone, and to_zone are required' });
  }

  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, event_id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO wayfinding_routes (event_id, from_zone, to_zone, description, distance_meters, estimated_minutes, instructions, accessibility)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(event_id, from_zone, to_zone, description || null, distance_meters || null, estimated_minutes || null, instructions || null, accessibility || null);
    
    const route = db.prepare('SELECT * FROM wayfinding_routes WHERE id = ?').get(result.lastInsertRowid);
    auditFromReq(req, { action: 'wayfinding.route.create', entityType: 'wayfinding_route', entityId: result.lastInsertRowid, eventId: event_id });
    res.status(201).json(route);
  } catch (err) {
    console.error('Create wayfinding route error:', err);
    res.status(500).json({ error: 'Failed to create wayfinding route' });
  }
});

// Update a wayfinding route
router.put('/routes/:id', (req, res) => {
  const { from_zone, to_zone, description, distance_meters, estimated_minutes, instructions, accessibility } = req.body;
  const route = db.prepare('SELECT * FROM wayfinding_routes WHERE id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, route.event_id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }

  try {
    const updates = [];
    const values = [];
    if (from_zone !== undefined) { updates.push('from_zone = ?'); values.push(from_zone); }
    if (to_zone !== undefined) { updates.push('to_zone = ?'); values.push(to_zone); }
    if (description !== undefined) { updates.push('description = ?'); values.push(description); }
    if (distance_meters !== undefined) { updates.push('distance_meters = ?'); values.push(distance_meters); }
    if (estimated_minutes !== undefined) { updates.push('estimated_minutes = ?'); values.push(estimated_minutes); }
    if (instructions !== undefined) { updates.push('instructions = ?'); values.push(instructions); }
    if (accessibility !== undefined) { updates.push('accessibility = ?'); values.push(accessibility); }

    if (updates.length === 0) return res.json(route);

    values.push(req.params.id);
    db.prepare(`UPDATE wayfinding_routes SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.prepare('SELECT * FROM wayfinding_routes WHERE id = ?').get(req.params.id);
    auditFromReq(req, { action: 'wayfinding.route.update', entityType: 'wayfinding_route', entityId: req.params.id, eventId: route.event_id });
    res.json(updated);
  } catch (err) {
    console.error('Update wayfinding route error:', err);
    res.status(500).json({ error: 'Failed to update wayfinding route' });
  }
});

// Delete a wayfinding route
router.delete('/routes/:id', (req, res) => {
  const route = db.prepare('SELECT * FROM wayfinding_routes WHERE id = ?').get(req.params.id);
  if (!route) return res.status(404).json({ error: 'Route not found' });

  if (req.user.role !== 'admin' && !userHasEventAccess(req.user.id, req.user.role, route.event_id)) {
    return res.status(403).json({ error: 'No access to this event' });
  }

  try {
    db.prepare('DELETE FROM wayfinding_routes WHERE id = ?').run(req.params.id);
    auditFromReq(req, { action: 'wayfinding.route.delete', entityType: 'wayfinding_route', entityId: req.params.id, eventId: route.event_id });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete wayfinding route error:', err);
    res.status(500).json({ error: 'Failed to delete wayfinding route' });
  }
});

export default router;
