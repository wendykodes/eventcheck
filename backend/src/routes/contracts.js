// RaaS Phase 6 — Contracts ledger. Records the commercial relationship
// (package, status, value, linked events). Explicitly NOT invoicing or
// payment capture: no payment provider, no charging, no dunning.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth } from '../middleware/auth.js';
import { requireOrgAccess, requireOrgManager } from '../middleware/authorize.js';
import { auditFromReq } from '../audit.js';

const router = Router();
router.use(requireAuth);

const PACKAGES = ['DIGITAL', 'MANAGED', 'FULL_RAAS', 'ENTERPRISE'];
const STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'];

function contractOrgId(req) {
  const row = db.prepare('SELECT org_id FROM contracts WHERE id = ?').get(req.params.id);
  return row && row.org_id ? row.org_id : null;
}

function requireContractOrg(req, res, next) {
  const orgId = contractOrgId(req);
  if (!orgId) return res.status(404).json({ error: 'Contract not found' });
  req.params.orgId = String(orgId);
  return requireOrgAccess()(req, res, next);
}

function shape(c) {
  if (!c) return c;
  const events = db.prepare('SELECT e.id, e.name, e.date, e.lifecycle_state FROM contract_events ce JOIN events e ON e.id = ce.event_id WHERE ce.contract_id = ?').all(c.id);
  return { ...c, events };
}

router.get('/', requireOrgAccess(), (req, res) => {
  const { status } = req.query;
  let q = 'SELECT * FROM contracts WHERE org_id = ?';
  const p = [req.orgId];
  if (status) { q += ' AND status = ?'; p.push(status); }
  res.json(db.prepare(q + ' ORDER BY id DESC').all(...p).map(shape));
});

router.post('/', requireOrgAccess(), requireOrgManager(), (req, res) => {
  const { title, customer_name, package: pkg, status, value_cents, currency, notes, event_ids } = req.body;
  if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
  if (pkg && !PACKAGES.includes(pkg)) return res.status(400).json({ error: `package must be one of ${PACKAGES.join(', ')}` });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: `status must be one of ${STATUSES.join(', ')}` });
  if (value_cents !== undefined && value_cents !== null && (!Number.isInteger(Number(value_cents)) || Number(value_cents) < 0)) {
    return res.status(400).json({ error: 'value_cents must be a non-negative integer' });
  }
  const r = db.prepare('INSERT INTO contracts (org_id, title, customer_name, package, status, value_cents, currency, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.orgId, String(title).trim(), customer_name || null, pkg || 'MANAGED', status || 'DRAFT',
      value_cents ?? null, currency || 'UGX', notes || null, req.user.id);
  if (Array.isArray(event_ids)) linkEvents(req.orgId, r.lastInsertRowid, event_ids);
  auditFromReq(req, { action: 'contract.create', entityType: 'contracts', entityId: r.lastInsertRowid, metadata: { org_id: req.orgId } });
  res.status(201).json(shape(db.prepare('SELECT * FROM contracts WHERE id = ?').get(r.lastInsertRowid)));
});

function linkEvents(orgId, contractId, eventIds) {
  const link = db.prepare('INSERT OR IGNORE INTO contract_events (contract_id, event_id) VALUES (?, ?)');
  for (const eid of eventIds) {
    // Only link events belonging to the same org (cross-org linkage rejected).
    const e = db.prepare('SELECT id FROM events WHERE id = ? AND org_id = ?').get(eid, orgId);
    if (!e) throw Object.assign(new Error(`Event ${eid} not found in this organization`), { status: 400 });
    link.run(contractId, eid);
  }
}

router.get('/:id', requireContractOrg, (req, res) => {
  res.json(shape(db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)));
});

router.put('/:id', requireContractOrg, requireOrgManager(), (req, res) => {
  const row = db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id);
  const { title, customer_name, package: pkg, status, value_cents, currency, notes, event_ids } = req.body;
  if (pkg && !PACKAGES.includes(pkg)) return res.status(400).json({ error: 'Invalid package' });
  if (status && !STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare("UPDATE contracts SET title=?, customer_name=?, package=?, status=?, value_cents=?, currency=?, notes=?, updated_at=datetime('now') WHERE id=?")
    .run(title !== undefined && String(title).trim() ? String(title).trim() : row.title,
      customer_name !== undefined ? customer_name : row.customer_name, pkg ?? row.package, status ?? row.status,
      value_cents !== undefined ? value_cents : row.value_cents, currency ?? row.currency,
      notes !== undefined ? notes : row.notes, req.params.id);
  if (Array.isArray(event_ids)) {
    db.prepare('DELETE FROM contract_events WHERE contract_id = ?').run(req.params.id);
    try {
      linkEvents(req.orgId, req.params.id, event_ids);
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  auditFromReq(req, { action: 'contract.update', entityType: 'contracts', entityId: req.params.id, metadata: { org_id: req.orgId } });
  res.json(shape(db.prepare('SELECT * FROM contracts WHERE id = ?').get(req.params.id)));
});

router.delete('/:id', requireContractOrg, requireOrgManager(), (req, res) => {
  db.prepare('DELETE FROM contracts WHERE id = ?').run(req.params.id);
  auditFromReq(req, { action: 'contract.delete', entityType: 'contracts', entityId: req.params.id, metadata: { org_id: req.orgId } });
  res.json({ ok: true });
});

export default router;
