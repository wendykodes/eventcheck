// RaaS Phase 7 — learning engine. Deterministic statistics over CLOSED
// events, merged as incremental means. No models, no black boxes: every
// baseline states its sample size, and every forecast states its basis.
//
// Fallback chain for a lookup: (org, template) → (org, '*') → (0, template)
// → (0, '*') → built-in default. Org-specific history always wins.

import db from '../database.js';

export const LEARN_METRICS = [
  'show_up_rate', // distinct checked-in guests / confirmed RSVPs
  'decline_rate', // declined / invited
  'no_response_rate', // no_response / invited
  'checkins_per_min', // peak check-in throughput (10-min buckets)
  'incidents_per_100', // incidents opened / invited * 100
  'avg_resolve_min', // mean incident created→resolved minutes
];

export const METRIC_DEFAULTS = {
  show_up_rate: 0.7,
  decline_rate: 0.15,
  no_response_rate: 0.15,
  checkins_per_min: 5,
  incidents_per_100: 3,
  avg_resolve_min: 45,
};

// Compute an event's observed metrics from source records. Returns nulls
// where the event has no data for a metric (never fabricate).
export function computeEventMetrics(eventId) {
  const invited = db.prepare("SELECT COUNT(*) AS c FROM guests WHERE event_id = ? AND status = 'approved'").get(eventId).c;
  const agg = db.prepare(`SELECT SUM(CASE WHEN r.status = 'CONFIRMED' THEN 1 ELSE 0 END) AS confirmed,
    SUM(CASE WHEN r.status = 'DECLINED' THEN 1 ELSE 0 END) AS declined FROM rsvps r WHERE r.event_id = ?`).get(eventId);
  const confirmed = agg.confirmed || 0;
  const declined = agg.declined || 0;
  const checked = db.prepare('SELECT COUNT(DISTINCT c.guest_id) AS c FROM checkins c JOIN guests g ON g.id = c.guest_id WHERE g.event_id = ?').get(eventId).c;
  const peak = db.prepare(`SELECT MAX(cnt) AS m FROM (SELECT COUNT(*) AS cnt FROM checkins c JOIN guests g ON g.id = c.guest_id
    WHERE g.event_id = ? GROUP BY strftime('%Y-%m-%d %H:%M', checked_in_at, '-9 minutes'))`).get(eventId).m;
  const incidents = db.prepare('SELECT COUNT(*) AS c FROM incidents WHERE event_id = ?').get(eventId).c;
  const avgResolve = db.prepare(`SELECT AVG((julianday(resolved_at) - julianday(created_at)) * 24 * 60) AS m FROM incidents
    WHERE event_id = ? AND resolved_at IS NOT NULL`).get(eventId).m;
  return {
    show_up_rate: confirmed > 0 ? checked / confirmed : null,
    decline_rate: invited > 0 ? declined / invited : null,
    no_response_rate: invited > 0 ? Math.max(0, invited - confirmed - declined) / invited : null,
    checkins_per_min: peak !== null && peak !== undefined ? peak / 10 : null,
    incidents_per_100: invited > 0 ? (incidents / invited) * 100 : null,
    avg_resolve_min: avgResolve !== null && avgResolve !== undefined ? avgResolve : null,
  };
}

// Merge one event's metrics into baselines (org + global), incremental mean.
// Idempotent per event unless force=true (tracked in learned_events).
export function learnEvent(eventId, { force = false } = {}) {
  const event = db.prepare('SELECT org_id, template_key FROM events WHERE id = ?').get(eventId);
  if (!event) return { learned: false, reason: 'event not found' };
  if (!force) {
    try {
      if (db.prepare('SELECT 1 FROM learned_events WHERE event_id = ?').get(eventId)) {
        return { learned: false, reason: 'already learned (use force to relearn)' };
      }
    } catch {}
  }
  const metrics = computeEventMetrics(eventId);
  const orgId = event.org_id || 0;
  const tpl = event.template_key || '*';
  const merge = db.prepare(`INSERT INTO learning_baselines (org_id, template_key, metric, n, mean, updated_at)
    VALUES (?, ?, ?, 1, ?, datetime('now'))
    ON CONFLICT(org_id, template_key, metric) DO UPDATE SET
      mean = (mean * n + excluded.mean) / (n + 1), n = n + 1, updated_at = datetime('now')`);
  let learned = 0;
  const learnedMetrics = [];
  for (const m of LEARN_METRICS) {
    const v = metrics[m];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    for (const [o, t] of [[orgId, tpl], [0, tpl], [orgId, '*'], [0, '*']]) {
      merge.run(o, t, m, v);
    }
    learned++;
    learnedMetrics.push(m);
  }
  try {
    db.prepare(`INSERT INTO audit_log (event_id, action, entity_type, entity_id, metadata_json)
      VALUES (?, 'learn.merge', 'event', ?, ?)`)
      .run(eventId, String(eventId), JSON.stringify({ metrics: learnedMetrics }));
    db.prepare('INSERT OR IGNORE INTO learned_events (event_id) VALUES (?)').run(eventId);
  } catch {}
  return { learned: learned > 0, metrics: learnedMetrics };
}

// Look up a metric with fallback chain. Returns { value, n, basis }.
export function lookupBaseline(orgId, templateKey, metric) {
  const chain = [
    [orgId || 0, templateKey || '*'],
    [orgId || 0, '*'],
    [0, templateKey || '*'],
    [0, '*'],
  ];
  for (const [o, t] of chain) {
    const row = db.prepare('SELECT n, mean FROM learning_baselines WHERE org_id = ? AND template_key = ? AND metric = ?').get(o, t, metric);
    if (row && row.n > 0) {
      const scope = o === 0 ? (t === '*' ? 'global' : `all ${t} events`) : (t === '*' ? 'this organization' : 'this organization\'s ' + t + ' events');
      return { value: row.mean, n: row.n, basis: `${row.n} past event${row.n === 1 ? '' : 's'} (${scope})` };
    }
  }
  return { value: METRIC_DEFAULTS[metric], n: 0, basis: 'default (no history yet)' };
}
