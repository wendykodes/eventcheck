// RaaS Phase 0 + Phase 6 — Templates: catalogue reads plus planner authoring.
// Seed keys are reseeded from code on every boot; custom templates MUST use
// keys starting with `custom_` so planner work is never overwritten.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { PERMISSIONS, EVENT_ROLES } from '../raas/permissions.js';
import { auditFromReq } from '../audit.js';

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

function asJsonArray(v) {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) throw Object.assign(new Error('Expected an array'), { status: 400 });
  return JSON.stringify(v);
}

function asJsonObject(v) {
  if (v === undefined) return undefined;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw Object.assign(new Error('Expected an object'), { status: 400 });
  return JSON.stringify(v);
}

// Create a custom template. Key MUST start with custom_ (seed protection).
router.post('/', requireAdmin, (req, res) => {
  const { key, name, description, default_modules, default_roles, terminology, default_settings } = req.body;
  if (!key || !String(key).startsWith('custom_')) {
    return res.status(400).json({ error: "Custom template key must start with 'custom_'" });
  }
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  try {
    db.prepare('INSERT INTO event_templates (key, name, description, default_modules_json, default_roles_json, terminology_json, default_settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(key, String(name).trim(), description || null,
        asJsonArray(default_modules) || '[]', asJsonArray(default_roles) || '[]',
        asJsonObject(terminology) || '{}', asJsonObject(default_settings) || '{}');
  } catch (e) {
    if (e.status) return res.status(e.status).json({ error: e.message });
    return res.status(409).json({ error: 'Template key already exists' });
  }
  auditFromReq(req, { action: 'template.create', entityType: 'event_templates', entityId: key });
  res.status(201).json(shape(db.prepare('SELECT * FROM event_templates WHERE key = ?').get(key)));
});

router.put('/:key', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM event_templates WHERE key = ?').get(req.params.key);
  if (!existing) return res.status(404).json({ error: 'Template not found' });
  if (!String(req.params.key).startsWith('custom_')) {
    return res.status(403).json({ error: 'Seed templates are read-only. Create a custom_ template instead.' });
  }
  const { name, description, default_modules, default_roles, terminology, default_settings } = req.body;
  try {
    db.prepare('UPDATE event_templates SET name=?, description=?, default_modules_json=?, default_roles_json=?, terminology_json=?, default_settings_json=? WHERE key=?')
      .run(name !== undefined && String(name).trim() ? String(name).trim() : existing.name,
        description !== undefined ? description : existing.description,
        default_modules !== undefined ? asJsonArray(default_modules) : existing.default_modules_json,
        default_roles !== undefined ? asJsonArray(default_roles) : existing.default_roles_json,
        terminology !== undefined ? asJsonObject(terminology) : existing.terminology_json,
        default_settings !== undefined ? asJsonObject(default_settings) : existing.default_settings_json,
        req.params.key);
  } catch (e) {
    return res.status(e.status || 400).json({ error: e.message });
  }
  auditFromReq(req, { action: 'template.update', entityType: 'event_templates', entityId: req.params.key });
  res.json(shape(db.prepare('SELECT * FROM event_templates WHERE key = ?').get(req.params.key)));
});

router.delete('/:key', requireAdmin, (req, res) => {
  if (!String(req.params.key).startsWith('custom_')) {
    return res.status(403).json({ error: 'Seed templates cannot be deleted.' });
  }
  const inUse = db.prepare('SELECT COUNT(*) AS c FROM events WHERE template_key = ?').get(req.params.key).c;
  if (inUse > 0) return res.status(409).json({ error: `Template is used by ${inUse} event(s).` });
  db.prepare('DELETE FROM event_templates WHERE key = ?').run(req.params.key);
  auditFromReq(req, { action: 'template.delete', entityType: 'event_templates', entityId: req.params.key });
  res.json({ ok: true });
});

// Snapshot a reusable template from a live event: roles actually in use,
// onboarding + config settings. People, guests and operational data are
// NEVER copied into a template.
router.post('/from-event/:id', requireAdmin, (req, res) => {
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  const { key, name, description } = req.body;
  if (!key || !String(key).startsWith('custom_')) {
    return res.status(400).json({ error: "Custom template key must start with 'custom_'" });
  }
  const roles = db.prepare('SELECT DISTINCT role_key FROM event_user_roles WHERE event_id = ?').all(req.params.id).map((r) => r.role_key);
  const base = db.prepare('SELECT * FROM event_templates WHERE key = ?').get(event.template_key);
  const baseModules = base ? JSON.parse(base.default_modules_json || '[]') : [];
  const baseTerms = base ? JSON.parse(base.terminology_json || '{}') : {};
  let config = {};
  try { config = event.config_json ? JSON.parse(event.config_json) : {}; } catch {}
  try {
    db.prepare('INSERT INTO event_templates (key, name, description, default_modules_json, default_roles_json, terminology_json, default_settings_json) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(key, name || `${event.name} template`, description || `Snapshot of event #${event.id}`,
        JSON.stringify(baseModules), JSON.stringify(roles.length ? roles : ['event_owner', 'event_manager', 'checkin_staff']),
        JSON.stringify(baseTerms),
        JSON.stringify({ onboarding_method: event.onboarding_method, ...(config.modules ? { modules: config.modules } : {}) }));
  } catch {
    return res.status(409).json({ error: 'Template key already exists' });
  }
  auditFromReq(req, { action: 'template.create', entityType: 'event_templates', entityId: key, eventId: Number(req.params.id), metadata: { from_event: Number(req.params.id) } });
  res.status(201).json(shape(db.prepare('SELECT * FROM event_templates WHERE key = ?').get(key)));
});

export default router;
