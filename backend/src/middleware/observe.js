// RaaS Phase 5 §63 — platform self-observability. In-memory rolling counters
// (no new tables, no external deps): per-endpoint volume, 4xx/5xx rates,
// auth failures, slow responses. The operator should know when the platform
// itself is becoming the problem.

const startedAt = Date.now();
const SLOW_MS = 500;

const endpoints = new Map(); // template -> { count, err4, err5, totalMs, maxMs }
const slow = []; // last 20 { at, method, path, ms, status }
let authFailures = 0;

function template(path) {
  return String(path || '')
    .replace(/\/\d+(?=\/|$)/g, '/:id')
    .replace(/\/[0-9a-f]{16,}(?=\/|$)/gi, '/:token')
    .slice(0, 120);
}

export function observe(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    try {
      const ms = Date.now() - start;
      const key = `${req.method} ${template(req.baseUrl ? req.baseUrl + req.path : req.path)}`;
      let e = endpoints.get(key);
      if (!e) { e = { count: 0, err4: 0, err5: 0, totalMs: 0, maxMs: 0 }; endpoints.set(key, e); }
      e.count++;
      e.totalMs += ms;
      if (ms > e.maxMs) e.maxMs = ms;
      if (res.statusCode === 401 || res.statusCode === 403) {
        authFailures++;
        if (res.statusCode >= 400 && res.statusCode < 500) e.err4++;
      } else if (res.statusCode >= 400 && res.statusCode < 500) {
        e.err4++;
      } else if (res.statusCode >= 500) {
        e.err5++;
      }
      if (ms >= SLOW_MS) {
        slow.push({ at: new Date().toISOString(), method: req.method, path: key, ms, status: res.statusCode });
        if (slow.length > 20) slow.shift();
      }
      // Bound cardinality: keep top 200 endpoints by count.
      if (endpoints.size > 200) {
        let minK = null, minC = Infinity;
        for (const [k, v] of endpoints) if (v.count < minC) { minC = v.count; minK = k; }
        if (minK) endpoints.delete(minK);
      }
    } catch {}
  });
  next();
}

export function platformSnapshot(db) {
  const rows = [...endpoints.entries()]
    .map(([endpoint, v]) => ({ endpoint, ...v, avgMs: v.count ? Math.round(v.totalMs / v.count) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
  let dbBytes = null;
  const tables = {};
  try {
    const pc = db.prepare('PRAGMA page_count').get();
    const ps = db.prepare('PRAGMA page_size').get();
    if (pc && ps) dbBytes = pc.page_count * ps.page_size;
    for (const t of ['users', 'events', 'guests', 'checkins', 'tasks', 'incidents', 'service_requests', 'schedule_items', 'audit_log', 'invitations', 'rsvps']) {
      try { tables[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c; } catch {}
    }
  } catch {}
  return {
    uptime_s: Math.floor((Date.now() - startedAt) / 1000),
    auth_failures: authFailures,
    endpoints: rows,
    slow_last20: [...slow].reverse(),
    db: { bytes: dbBytes, tables },
  };
}
