// RaaS Phase 3.1 — Event command center. Attention-first: what needs action,
// what is late, what is next. Every number reconciles to source records.

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const SEV_STYLE = {
  CRITICAL: 'border-l-red-500 bg-red-50 dark:bg-red-950/20',
  HIGH: 'border-l-orange-500 bg-orange-50 dark:bg-orange-950/15',
  MEDIUM: 'border-l-amber-400 bg-amber-50/50 dark:bg-amber-950/10',
};

export default function CommandPage() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [cmd, tl] = await Promise.all([api.getCommand(eventId), api.getTimeline(eventId).catch(() => [])]);
      setData(cmd);
      setTimeline(tl);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  const ack = async (key) => {
    try {
      await api.ackAlert(eventId, key);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;
  if (!data) return null;

  const { event, health, attention, counts, upcoming_milestones, attendance, readiness } = data;
  const healthColor = health.status === 'CRITICAL' ? 'text-red-500' : health.status === 'WATCH' ? 'text-amber-500' : 'text-green-500';

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)]">← Dashboard</Link>
        <div className="flex items-center justify-between mt-1">
          <h1 className="text-[22px] font-bold tracking-tight">Command</h1>
          <span className={`text-[15px] font-bold ${healthColor}`}>{health.status}</span>
        </div>
        <p className="text-[13px] text-[var(--color-text-secondary)]">{event.name} · {event.lifecycle_state}</p>
      </div>

      {health.reasons.length > 0 && (
        <div className="card p-4">
          <p className="text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-1.5">Why {health.status.toLowerCase()}</p>
          <ul className="text-[14px] space-y-1">
            {health.reasons.map((r, i) => <li key={i}>• {r}</li>)}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Checked in', value: `${attendance.checked_in}/${attendance.invited}` },
          { label: 'Incidents', value: counts.open_incidents },
          { label: 'Tasks open', value: counts.open_tasks },
          { label: 'Requests', value: counts.open_requests },
          { label: 'Program', value: counts.schedule_open },
          { label: 'Vendors ⚠', value: counts.vendors_issue },
        ].map((s) => (
          <div key={s.label} className="card p-3 text-center">
            <div className="text-lg font-bold">{s.value}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="section-title">Needs attention ({attention.length})</h2>
        {attention.length === 0 ? (
          <div className="card p-5 text-center text-sm text-[var(--color-text-secondary)]">All clear. Nothing needs action right now.</div>
        ) : (
          <div className="space-y-2">
            {attention.map((a) => (
              <div key={a.key} className={`card p-4 border-l-4 ${SEV_STYLE[a.severity] || ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-[14px] leading-snug">{a.title}</p>
                    {a.detail && <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">{a.detail}</p>}
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">
                      {a.severity}{a.age_min !== null && a.age_min !== undefined ? ` · ${a.age_min} min` : ''}{a.escalation_due ? ' · ESCALATION DUE' : ''}
                      {a.action ? ` · ${a.action}` : ''}
                    </p>
                  </div>
                  <button onClick={() => ack(a.key)} className="btn btn-ghost btn-sm shrink-0 text-[var(--color-text-secondary)]" title="Acknowledge">
                    ✓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {upcoming_milestones.length > 0 && (
        <div>
          <h2 className="section-title">Up next</h2>
          <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
            {upcoming_milestones.map((m) => (
              <div key={m.id} className="p-3 flex items-center justify-between text-sm">
                <span className="font-medium">{m.title}</span>
                <span className="text-[12px] text-[var(--color-text-secondary)]">{m.planned_start} · {m.status.replace(/_/g, ' ')}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!readiness.ready && (
        <div className="card p-4 border-l-4 border-l-amber-500 text-sm">
          <strong>Not ready:</strong> {readiness.blocking_failed.join(', ')}
        </div>
      )}

      <div>
        <h2 className="section-title">Timeline</h2>
        {timeline.length === 0 ? (
          <EmptyState title="No activity yet" message="Significant event activity will appear here." />
        ) : (
          <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
            {timeline.slice(0, 30).map((t) => (
              <div key={t.id} className="p-3 flex items-start gap-3 text-sm">
                <span className="text-[11px] text-[var(--color-text-secondary)] shrink-0 w-14">
                  {new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <div className="min-w-0">
                  <p>{t.text}</p>
                  <p className="text-[11px] text-[var(--color-text-secondary)]">{t.actor}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Link to={`/events/${eventId}/ops`} className="btn btn-secondary btn-sm">Operations</Link>
        <Link to={`/checkin?event=${eventId}`} className="btn btn-secondary btn-sm">Check-In</Link>
      </div>
    </div>
  );
}
