import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth);

// Get skills for a user
router.get('/skills/:userId', (req, res) => {
  const skills = db.prepare(`
    SELECT * FROM staff_skills WHERE user_id = ? ORDER BY proficiency_level DESC, skill_name ASC
  `).all(req.params.userId);

  res.json(skills);
});

// Get skills for current user
router.get('/my-skills', (req, res) => {
  const skills = db.prepare(`
    SELECT * FROM staff_skills WHERE user_id = ? ORDER BY proficiency_level DESC, skill_name ASC
  `).all(req.user.id);

  res.json(skills);
});

// Add a skill (admin only)
router.post('/skills', requireAdmin, (req, res) => {
  const { user_id, skill_name, proficiency_level, verified_at } = req.body;
  if (!user_id || !skill_name) {
    return res.status(400).json({ error: 'user_id and skill_name are required' });
  }

  const result = db.prepare(`
    INSERT INTO staff_skills (user_id, skill_name, proficiency_level, verified_at)
    VALUES (?, ?, ?, ?)
  `).run(user_id, skill_name, proficiency_level || 'beginner', verified_at || null);

  const skill = db.prepare('SELECT * FROM staff_skills WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(skill);
});

// Update a skill (admin only)
router.put('/skills/:id', requireAdmin, (req, res) => {
  const { proficiency_level, verified_at } = req.body;
  
  const updates = [];
  const params = [];
  if (proficiency_level !== undefined) { updates.push('proficiency_level = ?'); params.push(proficiency_level); }
  if (verified_at !== undefined) { updates.push('verified_at = ?'); params.push(verified_at); }
  
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  
  params.push(req.params.id);
  db.prepare(`UPDATE staff_skills SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const skill = db.prepare('SELECT * FROM staff_skills WHERE id = ?').get(req.params.id);
  res.json(skill);
});

// Delete a skill (admin only)
router.delete('/skills/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM staff_skills WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Get certifications for a user
router.get('/certifications/:userId', (req, res) => {
  const certifications = db.prepare(`
    SELECT * FROM staff_certifications WHERE user_id = ? ORDER BY expiry_date ASC
  `).all(req.params.userId);

  res.json(certifications);
});

// Get certifications for current user
router.get('/my-certifications', (req, res) => {
  const certifications = db.prepare(`
    SELECT * FROM staff_certifications WHERE user_id = ? ORDER BY expiry_date ASC
  `).all(req.user.id);

  res.json(certifications);
});

// Add a certification (admin only)
router.post('/certifications', requireAdmin, (req, res) => {
  const { user_id, certification_name, issuer, issue_date, expiry_date, certificate_number } = req.body;
  if (!user_id || !certification_name) {
    return res.status(400).json({ error: 'user_id and certification_name are required' });
  }

  const result = db.prepare(`
    INSERT INTO staff_certifications (user_id, certification_name, issuer, issue_date, expiry_date, certificate_number)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(user_id, certification_name, issuer || null, issue_date || null, expiry_date || null, certificate_number || null);

  const certification = db.prepare('SELECT * FROM staff_certifications WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(certification);
});

// Update a certification (admin only)
router.put('/certifications/:id', requireAdmin, (req, res) => {
  const { certification_name, issuer, issue_date, expiry_date, certificate_number, status } = req.body;
  
  const updates = [];
  const params = [];
  if (certification_name !== undefined) { updates.push('certification_name = ?'); params.push(certification_name); }
  if (issuer !== undefined) { updates.push('issuer = ?'); params.push(issuer); }
  if (issue_date !== undefined) { updates.push('issue_date = ?'); params.push(issue_date); }
  if (expiry_date !== undefined) { updates.push('expiry_date = ?'); params.push(expiry_date); }
  if (certificate_number !== undefined) { updates.push('certificate_number = ?'); params.push(certificate_number); }
  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
  
  params.push(req.params.id);
  db.prepare(`UPDATE staff_certifications SET ${updates.join(', ')} WHERE id = ?`).run(...params);

  const certification = db.prepare('SELECT * FROM staff_certifications WHERE id = ?').get(req.params.id);
  res.json(certification);
});

// Delete a certification (admin only)
router.delete('/certifications/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM staff_certifications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
