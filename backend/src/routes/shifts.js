import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { requireEventAccess } from '../middleware/authorize.js';

const router = Router();

router.use(requireAuth);

// Get shifts for an event
router.get('/', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const shifts = db.prepare(`
    SELECT s.*, u.name AS user_name, e.name AS event_name,
      (SELECT COUNT(*) FROM shift_sessions ss WHERE ss.shift_id = s.id AND ss.status = 'active') AS active_sessions
    FROM shifts s
    JOIN users u ON u.id = s.user_id
    JOIN events e ON e.id = s.event_id
    WHERE s.event_id = ?
    ORDER BY s.scheduled_start ASC
  `).all(event_id);

  res.json(shifts);
});

// Clock in to a shift
router.post('/:shiftId/clock-in', (req, res) => {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.shiftId);
  if (!shift) return res.status(404).json({ error: 'Shift not found' });

  // Check if user already has an active session for this shift
  const existing = db.prepare(`
    SELECT * FROM shift_sessions WHERE shift_id = ? AND user_id = ? AND status = 'active'
  `).get(req.params.shiftId, req.user.id);

  if (existing) return res.status(400).json({ error: 'Already clocked in for this shift' });

  const result = db.prepare(`
    INSERT INTO shift_sessions (shift_id, user_id, clocked_in_at, status)
    VALUES (?, ?, datetime('now'), 'active')
  `).run(req.params.shiftId, req.user.id);

  const session = db.prepare('SELECT * FROM shift_sessions WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(session);
});

// Clock out from a shift
router.post('/:shiftId/clock-out', (req, res) => {
  const session = db.prepare(`
    SELECT * FROM shift_sessions WHERE shift_id = ? AND user_id = ? AND status = 'active'
  `).get(req.params.shiftId, req.user.id);

  if (!session) return res.status(404).json({ error: 'No active session found' });

  db.prepare(`
    UPDATE shift_sessions SET clocked_out_at = datetime('now'), status = 'completed'
    WHERE id = ?
  `).run(session.id);

  const updated = db.prepare('SELECT * FROM shift_sessions WHERE id = ?').get(session.id);
  res.json(updated);
});

// Start break
router.post('/:shiftId/break-start', (req, res) => {
  const session = db.prepare(`
    SELECT * FROM shift_sessions WHERE shift_id = ? AND user_id = ? AND status = 'active'
  `).get(req.params.shiftId, req.user.id);

  if (!session) return res.status(404).json({ error: 'No active session found' });
  if (session.break_start) return res.status(400).json({ error: 'Already on break' });

  db.prepare(`
    UPDATE shift_sessions SET break_start = datetime('now') WHERE id = ?
  `).run(session.id);

  const updated = db.prepare('SELECT * FROM shift_sessions WHERE id = ?').get(session.id);
  res.json(updated);
});

// End break
router.post('/:shiftId/break-end', (req, res) => {
  const session = db.prepare(`
    SELECT * FROM shift_sessions WHERE shift_id = ? AND user_id = ? AND status = 'active'
  `).get(req.params.shiftId, req.user.id);

  if (!session) return res.status(404).json({ error: 'No active session found' });
  if (!session.break_start) return res.status(400).json({ error: 'Not on break' });

  const breakEnd = new Date();
  const breakStart = new Date(session.break_start);
  const breakMinutes = Math.round((breakEnd - breakStart) / 60000);

  db.prepare(`
    UPDATE shift_sessions SET break_end = datetime('now'), total_break_minutes = total_break_minutes + ?
    WHERE id = ?
  `).run(breakMinutes, session.id);

  const updated = db.prepare('SELECT * FROM shift_sessions WHERE id = ?').get(session.id);
  res.json(updated);
});

// Get on-duty staff for an event
router.get('/on-duty', (req, res) => {
  const { event_id } = req.query;
  if (!event_id) return res.status(400).json({ error: 'event_id is required' });

  const onDuty = db.prepare(`
    SELECT ss.*, s.shift_type, s.zone, u.name AS user_name, u.role
    FROM shift_sessions ss
    JOIN shifts s ON s.id = ss.shift_id
    JOIN users u ON u.id = ss.user_id
    WHERE s.event_id = ? AND ss.status = 'active'
    ORDER BY ss.clocked_in_at DESC
  `).all(event_id);

  res.json(onDuty);
});

// Get user's current session
router.get('/my-session', (req, res) => {
  const session = db.prepare(`
    SELECT ss.*, s.shift_type, s.scheduled_start, s.scheduled_end, s.zone, e.name AS event_name
    FROM shift_sessions ss
    JOIN shifts s ON s.id = ss.shift_id
    JOIN events e ON e.id = s.event_id
    WHERE ss.user_id = ? AND ss.status = 'active'
  `).get(req.user.id);

  if (!session) return res.json(null);
  res.json(session);
});

// Conflict detection on shift creation
router.post('/', requireAdmin, (req, res) => {
  const { event_id, user_id, shift_type, scheduled_start, scheduled_end, zone, notes } = req.body;
  if (!event_id || !user_id || !shift_type || !scheduled_start || !scheduled_end) {
    return res.status(400).json({ error: 'event_id, user_id, shift_type, scheduled_start, and scheduled_end are required' });
  }

  // Check for overlapping shifts
  const conflict = db.prepare(`
    SELECT id FROM shifts 
    WHERE user_id = ? AND event_id = ? 
    AND status = 'CONFIRMED'
    AND ((scheduled_start <= ? AND scheduled_end >= ?) OR (scheduled_start <= ? AND scheduled_end >= ?))
  `).get(user_id, event_id, scheduled_start, scheduled_start, scheduled_end, scheduled_end);
  
  if (conflict) {
    // Log conflict
    db.prepare(`
      INSERT INTO shift_conflicts (event_id, user_id, shift_id, conflict_type)
      VALUES (?, ?, ?, 'OVERLAP')
    `).run(event_id, user_id, conflict.id);
    return res.status(409).json({ error: 'Shift conflict detected', conflict_id: conflict.id });
  }

  const result = db.prepare(`
    INSERT INTO shifts (event_id, user_id, shift_type, scheduled_start, scheduled_end, zone, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(event_id, user_id, shift_type, scheduled_start, scheduled_end, zone || null, notes || null);

  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(shift);
});

// Overtime calculation
router.get('/:shiftId/overtime', (req, res) => {
  const session = db.prepare('SELECT * FROM shift_sessions WHERE shift_id = ? AND status = \'active\'').get(req.params.shiftId);
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.shiftId);
  
  if (!session || !shift) {
    return res.status(404).json({ error: 'Shift or session not found' });
  }
  
  const scheduledMinutes = (new Date(shift.scheduled_end) - new Date(shift.scheduled_start)) / 60000;
  const actualMinutes = session.clocked_out_at 
    ? (new Date(session.clocked_out_at) - new Date(session.clocked_in_at)) / 60000
    : 0;
  
  const overtimeMinutes = Math.max(0, actualMinutes - scheduledMinutes);
  res.json({ overtime_minutes: overtimeMinutes, overtime_hours: overtimeMinutes / 60 });
});

// Template CRUD
router.get('/templates', (req, res) => {
  const templates = db.prepare('SELECT * FROM shift_templates ORDER BY name').all();
  res.json(templates);
});

router.post('/templates', requireAdmin, (req, res) => {
  const { name, shift_type, default_duration_hours, default_zone, notes } = req.body;
  if (!name || !shift_type) {
    return res.status(400).json({ error: 'name and shift_type are required' });
  }
  
  const result = db.prepare(`
    INSERT INTO shift_templates (name, shift_type, default_duration_hours, default_zone, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, shift_type, default_duration_hours || null, default_zone || null, notes || null, req.user.id);
  
  res.status(201).json(db.prepare('SELECT * FROM shift_templates WHERE id = ?').get(result.lastInsertRowid));
});

export default router;
