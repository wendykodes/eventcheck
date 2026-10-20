import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Submit feedback for an event
router.post('/', (req, res) => {
  const { event_id, guest_id, overall_rating, service_rating, venue_rating, food_rating, comment } = req.body;
  if (!event_id || !overall_rating) {
    return res.status(400).json({ error: 'event_id and overall_rating are required' });
  }

  const result = db.prepare(`
    INSERT INTO event_feedback (event_id, guest_id, overall_rating, service_rating, venue_rating, food_rating, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(event_id, guest_id || null, overall_rating, service_rating || null, venue_rating || null, food_rating || null, comment || null);

  const feedback = db.prepare('SELECT * FROM event_feedback WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(feedback);
});

// Get feedback for an event (admin only)
router.get('/:eventId', (req, res) => {
  const feedback = db.prepare(`
    SELECT ef.*, g.name AS guest_name
    FROM event_feedback ef
    LEFT JOIN guests g ON g.id = ef.guest_id
    WHERE ef.event_id = ?
    ORDER BY ef.submitted_at DESC
  `).all(req.params.eventId);

  res.json(feedback);
});

// Get feedback summary for an event
router.get('/:eventId/summary', (req, res) => {
  const summary = db.prepare(`
    SELECT 
      COUNT(*) AS total_responses,
      AVG(overall_rating) AS avg_overall,
      AVG(service_rating) AS avg_service,
      AVG(venue_rating) AS avg_venue,
      AVG(food_rating) AS avg_food
    FROM event_feedback
    WHERE event_id = ?
  `).get(req.params.eventId);

  res.json(summary);
});

export default router;
