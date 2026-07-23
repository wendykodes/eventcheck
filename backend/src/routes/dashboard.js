import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

router.get('/:event_id', (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.event_id);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const totalGuests = db.prepare('SELECT COUNT(*) AS c FROM guests WHERE event_id = ?').get(req.params.event_id);
  const totalAttendees = db.prepare('SELECT COALESCE(SUM(guest_count), 0) AS c FROM guests WHERE event_id = ?').get(req.params.event_id);

  const activities = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(req.params.event_id);

  const activityStats = activities.map(a => {
    const checkedIn = db.prepare(`
      SELECT COUNT(*) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
      FROM checkins c
      JOIN guests g ON g.id = c.guest_id
      WHERE c.activity_id = ?
    `).get(a.id);
    return {
      id: a.id,
      name: a.name,
      sort_order: a.sort_order,
      checked_in_guests: checkedIn.guests,
      checked_in_attendees: checkedIn.attendees,
      remaining_guests: totalGuests.c - checkedIn.guests,
      remaining_attendees: totalAttendees.c - checkedIn.attendees,
      completion_pct: totalGuests.c > 0 ? Math.round((checkedIn.guests / totalGuests.c) * 100) : 0
    };
  });

  const totalCheckedIn = activityStats.length > 0
    ? db.prepare(`
      SELECT COUNT(*) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
      FROM (
        SELECT DISTINCT c.guest_id
        FROM checkins c
        JOIN activities a ON a.id = c.activity_id
        WHERE a.event_id = ?
      ) AS d
      JOIN guests g ON g.id = d.guest_id
    `).get(req.params.event_id)
    : { guests: 0, attendees: 0 };

  const recentCheckins = db.prepare(`
    SELECT c.checked_in_at, g.name AS guest_name, g.guest_count, a.name AS activity_name, u.name AS staff_name
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    JOIN users u ON u.id = c.staff_id
    WHERE a.event_id = ?
    ORDER BY c.checked_in_at DESC
    LIMIT 20
  `).all(req.params.event_id);

  const staffSummary = db.prepare(`
    SELECT u.id, u.name, COUNT(c.id) AS checkin_count
    FROM users u
    JOIN checkins c ON c.staff_id = u.id
    JOIN activities a ON a.id = c.activity_id
    WHERE a.event_id = ?
    GROUP BY u.id, u.name
    ORDER BY checkin_count DESC
  `).all(req.params.event_id);

  res.json({
    event,
    total_guests: totalGuests.c,
    total_attendees: totalAttendees.c,
    checked_in_guests: totalCheckedIn.guests,
    checked_in_attendees: totalCheckedIn.attendees,
    attendance_pct: totalGuests.c > 0 ? Math.round((totalCheckedIn.guests / totalGuests.c) * 100) : 0,
    activities: activityStats,
    recent_checkins: recentCheckins,
    staff_summary: staffSummary
  });
});

export default router;
