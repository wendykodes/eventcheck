// RaaS Phase 4.7 — Default runbook items per template, by phase.
// Materialized into runbook_items per event; progress is check-offs, not %.

export const RUNBOOK_DEFAULTS = {
  _common_before: [
    'Venue confirmation',
    'Guest data validation',
    'Staff briefing',
    'Vendor confirmation',
    'Device check + charging',
    'Backup paper lists printed',
    'Rehearsal / dry run',
  ],
  _common_during: [
    'Command monitoring staffed',
    'Attendance tracking live',
    'Incident triage staffed',
    'Service requests triaged',
    'Schedule monitoring',
    'Vendor coordination check-ins',
  ],
  _common_after: [
    'Attendance reconciliation',
    'Incident closure review',
    'Outstanding items review',
    'Final report generated',
    'Customer handover',
    'Event archived',
  ],
};

// Template-specific extras merged with common items (keyed by phase).
export const RUNBOOK_TEMPLATE_EXTRA = {
  wedding: { BEFORE: ['Seating plan confirmed', 'Gifts table prepared'], DURING: ['Meal service coordination'], AFTER: [] },
  conference: { BEFORE: ['Speaker confirmations', 'Badge printing'], DURING: ['Session timekeeping'], AFTER: ['Feedback collection'] },
  retreat: { BEFORE: ['Room allocation confirmed', 'Transport plan confirmed'], DURING: [], AFTER: [] },
};

export function defaultsForTemplate(templateKey) {
  const extra = RUNBOOK_TEMPLATE_EXTRA[templateKey] || { BEFORE: [], DURING: [], AFTER: [] };
  const out = [];
  const push = (phase, titles) => titles.forEach((t, i) => out.push({ phase, title: t, sort_order: i }));
  push('BEFORE', [...RUNBOOK_DEFAULTS._common_before, ...(extra.BEFORE || [])]);
  push('DURING', [...RUNBOOK_DEFAULTS._common_during, ...(extra.DURING || [])]);
  push('AFTER', [...RUNBOOK_DEFAULTS._common_after, ...(extra.AFTER || [])]);
  return out;
}
