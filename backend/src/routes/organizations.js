// RaaS Phase 0 — Organization model.
// Platform → Organization → Events. Supports planners, venues, enterprise.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { auditFromReq } from '../audit.js';

const router = Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  if (req.user.role === 'admin') {
    return res.json(db.prepare('SELECT * FROM organizations ORDER BY name ASC').all());
  }
  res.json(db.prepare(`
    SELECT o.* FROM organizations o
    JOIN organization_users ou ON ou.org_id = o.id
    WHERE ou.user_id = ? ORDER BY o.name ASC
  `).all(req.user.id));
});

router.post('/', requireAdmin, (req, res) => {
  const { name, type, contact_name, contact_phone } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Organization name is required' });
  const r = db.prepare('INSERT INTO organizations (name, type, contact_name, contact_phone) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), type || null, contact_name || null, contact_phone || null);
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(r.lastInsertRowid);
  auditFromReq(req, { action: 'org.create', entityType: 'organization', entityId: r.lastInsertRowid, metadata: { name } });
  res.status(201).json(org);
});

router.get('/:id', (req, res) => {
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  if (req.user.role !== 'admin') {
    const link = db.prepare('SELECT 1 FROM organization_users WHERE org_id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!link) return res.status(403).json({ error: 'No access to this organization' });
  }
  const events = db.prepare('SELECT id, name, lifecycle_state, status, date FROM events WHERE org_id = ? ORDER BY date DESC').all(req.params.id);
  const members = db.prepare(`
    SELECT ou.*, u.name AS user_name FROM organization_users ou
    JOIN users u ON u.id = ou.user_id WHERE ou.org_id = ?
  `).all(req.params.id);
  res.json({ ...org, events, members });
});

router.post('/:id/members', requireAdmin, (req, res) => {
  const { user_id, org_role } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id is required' });
  const role = ['owner', 'manager', 'member'].includes(org_role) ? org_role : 'member';
  const org = db.prepare('SELECT id FROM organizations WHERE id = ?').get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Organization not found' });
  db.prepare('INSERT OR REPLACE INTO organization_users (org_id, user_id, org_role) VALUES (?, ?, ?)').run(req.params.id, user_id, role);
  auditFromReq(req, { action: 'org.member.add', entityType: 'organization', entityId: req.params.id, metadata: { user_id, org_role: role } });
  res.status(201).json({ ok: true });
});

export default router;
