import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Self-service staff dashboard
router.get('/dashboard', (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const events = user.role === 'admin'
    ? db.prepare('SELECT id, name FROM events ORDER BY date DESC').all()
    : db.prepare(`
      SELECT e.id, e.name FROM events e
      JOIN user_events ue ON ue.event_id = e.id WHERE ue.user_id = ?
      ORDER BY e.date DESC
    `).all(req.user.id);

  const totalCheckins = db.prepare('SELECT COUNT(*) AS c FROM checkins WHERE staff_id = ?').get(req.user.id);
  const todayCheckins = db.prepare("SELECT COUNT(*) AS c FROM checkins WHERE staff_id = ? AND date(checked_in_at) = date('now')").get(req.user.id);
  const lastCheckin = db.prepare('SELECT c.*, g.name AS guest_name, g.guest_count, a.name AS activity_name FROM checkins c JOIN guests g ON g.id = c.guest_id JOIN activities a ON a.id = c.activity_id WHERE c.staff_id = ? ORDER BY c.checked_in_at DESC LIMIT 1').get(req.user.id);
  const totalGuestsChecked = db.prepare("SELECT COUNT(DISTINCT guest_id) AS c FROM checkins WHERE staff_id = ?").get(req.user.id);
  const totalAttendees = db.prepare("SELECT COALESCE(SUM(g.guest_count), 0) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE c.staff_id = ?").get(req.user.id);

  const activityBreakdown = db.prepare(`
    SELECT a.name, COUNT(c.id) AS checkins
    FROM checkins c JOIN activities a ON a.id = c.activity_id
    WHERE c.staff_id = ?
    GROUP BY a.id, a.name ORDER BY checkins DESC
  `).all(req.user.id);

  res.json({
    id: user.id,
    name: user.name,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    last_login: user.last_login,
    events,
    today_checkins: todayCheckins.c,
    total_checkins: totalCheckins.c,
    total_guests_checked: totalGuestsChecked.c,
    total_attendees: totalAttendees.c,
    last_checkin: lastCheckin || null,
    activity_breakdown: activityBreakdown,
  });
});

// Leaderboard
router.get('/leaderboard', (req, res) => {
  const { event_id } = req.query;
  let staff;
  if (event_id) {
    staff = db.prepare(`
      SELECT u.id, u.name,
        COUNT(DISTINCT c.id) AS checkins,
        COALESCE(SUM(g.guest_count), 0) AS attendees,
        COUNT(DISTINCT c.guest_id) AS guests_checked,
        MAX(c.checked_in_at) AS last_checkin
      FROM users u
      JOIN checkins c ON c.staff_id = u.id
      JOIN guests g ON g.id = c.guest_id
      JOIN activities a ON a.id = c.activity_id
      WHERE a.event_id = ?
      GROUP BY u.id, u.name
      ORDER BY checkins DESC
    `).all(event_id);
  } else {
    staff = db.prepare(`
      SELECT u.id, u.name,
        COUNT(DISTINCT c.id) AS checkins,
        COALESCE(SUM(g.guest_count), 0) AS attendees,
        COUNT(DISTINCT c.guest_id) AS guests_checked,
        MAX(c.checked_in_at) AS last_checkin
      FROM users u
      JOIN checkins c ON c.staff_id = u.id
      JOIN guests g ON g.id = c.guest_id
      GROUP BY u.id, u.name
      ORDER BY checkins DESC
    `).all();
  }
  res.json(staff);
});

// Activity performance
router.get('/activity-performance', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const totalGuests = db.prepare('SELECT COUNT(*) AS c FROM guests WHERE event_id = ?').get(event_id).c;
  const totalAttendees = db.prepare('SELECT COALESCE(SUM(guest_count), 0) AS c FROM guests WHERE event_id = ?').get(event_id).c;

  const activities = db.prepare('SELECT * FROM activities WHERE event_id = ? ORDER BY sort_order ASC').all(event_id);

  const result = activities.map(a => {
    const stats = db.prepare(`
      SELECT COUNT(*) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
      FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE c.activity_id = ?
    `).get(a.id);

    const staffList = db.prepare(`
      SELECT u.id, u.name, COUNT(c.id) AS checkins
      FROM checkins c JOIN users u ON u.id = c.staff_id
      WHERE c.activity_id = ?
      GROUP BY u.id, u.name ORDER BY checkins DESC
    `).all(a.id);

    return {
      id: a.id,
      name: a.name,
      sort_order: a.sort_order,
      total_guests: totalGuests,
      total_attendees: totalAttendees,
      checked_in_guests: stats.guests,
      checked_in_attendees: stats.attendees,
      completion_pct: totalGuests > 0 ? Math.round((stats.guests / totalGuests) * 100) : 0,
      staff: staffList,
    };
  });

  res.json(result);
});

// Staff activity timeline
router.get('/timeline', (req, res) => {
  const { user_id, limit = 50 } = req.query;
  const userId = user_id || req.user.id;

  const raw = db.prepare(`
    SELECT c.checked_in_at AS timestamp, 'checkin' AS type,
      g.name AS guest_name, a.name AS activity_name, g.guest_count
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.staff_id = ?
    UNION ALL
    SELECT last_login AS timestamp, 'login' AS type, u.name AS guest_name, NULL AS activity_name, NULL AS guest_count
    FROM users u WHERE u.id = ? AND u.last_login IS NOT NULL
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(userId, userId, Number(limit));

  res.json(raw);
});

// Staff detail stats (admin view)
router.get('/stats/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT id, name, role, status, created_at, last_login FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const events = db.prepare(`
    SELECT e.id, e.name, e.status, e.date FROM events e
    JOIN user_events ue ON ue.event_id = e.id WHERE ue.user_id = ?
  `).all(req.params.id);

  const lifetime = db.prepare(`
    SELECT COUNT(*) AS checkins, COUNT(DISTINCT c.guest_id) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
    FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE c.staff_id = ?
  `).get(req.params.id);

  const today = db.prepare(`
    SELECT COUNT(*) AS checkins, COUNT(DISTINCT c.guest_id) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
    FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE c.staff_id = ? AND date(c.checked_in_at) = date('now')
  `).get(req.params.id);

  const activityBreakdown = db.prepare(`
    SELECT a.name, COUNT(c.id) AS checkins
    FROM checkins c JOIN activities a ON a.id = c.activity_id
    WHERE c.staff_id = ?
    GROUP BY a.id, a.name ORDER BY checkins DESC
  `).all(req.params.id);

  const eventBreakdown = db.prepare(`
    SELECT e.name, COUNT(c.id) AS checkins, COUNT(DISTINCT c.guest_id) AS guests, COALESCE(SUM(g.guest_count), 0) AS attendees
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    JOIN events e ON e.id = a.event_id
    WHERE c.staff_id = ?
    GROUP BY e.id, e.name ORDER BY checkins DESC
  `).all(req.params.id);

  const recentCheckins = db.prepare(`
    SELECT c.checked_in_at, g.name AS guest_name, g.guest_count, a.name AS activity_name
    FROM checkins c
    JOIN guests g ON g.id = c.guest_id
    JOIN activities a ON a.id = c.activity_id
    WHERE c.staff_id = ?
    ORDER BY c.checked_in_at DESC LIMIT 20
  `).all(req.params.id);

  res.json({
    user,
    events,
    lifetime,
    today,
    activity_breakdown: activityBreakdown,
    event_breakdown: eventBreakdown,
    recent_checkins: recentCheckins,
  });
});

export default router;
