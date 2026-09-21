// RaaS Phase 0 — Templates + permission catalogue (read-only configuration).

import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { PERMISSIONS, EVENT_ROLES } from '../raas/permissions.js';

const router = Router();
router.use(requireAuth);

function shape(t) {
  return {
    key: t.key,
    name: t.name,
    description: t.description,
    default_modules: JSON.parse(t.default_modules_json || '[]'),
    default_roles: JSON.parse(t.default_roles_json || '[]'),
    terminology: JSON.parse(t.terminology_json || '{}'),
    default_settings: JSON.parse(t.default_settings_json || '{}'),
  };
}

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM event_templates ORDER BY name ASC').all().map(shape));
});

router.get('/permissions', (req, res) => {
  res.json({ permissions: PERMISSIONS, event_roles: EVENT_ROLES });
});

router.get('/:key', (req, res) => {
  const t = db.prepare('SELECT * FROM event_templates WHERE key = ?').get(req.params.key);
  if (!t) return res.status(404).json({ error: 'Template not found' });
  res.json(shape(t));
});

export default router;
