// RaaS Phase 5 §63 — platform status (admin-only, audited).
// Read-model over the in-memory observability counters + live DB facts.

import { Router } from 'express';
import db from '../database.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { platformSnapshot } from '../middleware/observe.js';
import { auditFromReq } from '../audit.js';

const router = Router();
router.use(requireAuth);

router.get('/platform', requireAdmin, (req, res) => {
  auditFromReq(req, { action: 'platform.view', entityType: 'platform', entityId: 'status' });
  res.json({ status: 'ok', service: 'EventCheck API', ...platformSnapshot(db) });
});

export default router;
