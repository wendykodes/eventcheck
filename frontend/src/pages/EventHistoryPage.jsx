// RaaS Phase 6 — Event history. Dedicated view over the append-only audit
// trail + operational timeline: what happened, when, who did it.

import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

export default function EventHistoryPage() {
  const { eventId } = useParams();
  const [timeline, setTimeline] = useState(null);
  const [audit, setAudit] = useState(null);

  useEffect(() => {
    api.getTimeline(eventId)
      .then(setTimeline)
      .catch((err) => {
        toast.error(err.message);
        setTimeline([]);
      });
    // Raw audit entries (tamper-resistant record, access-controlled endpoint).
    fetch(`/api/audit/event/${eventId}?limit=200`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => (r.ok ? r.json() : []))
      .then(setAudit)
      .catch(() => setAudit([]));
  }, [eventId]);

  if (timeline === null) return <div className="pt-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)]">← Dashboard</Link>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Event history</h1>
      </div>

      {timeline.length === 0 ? (
        <EmptyState title="No history yet" message="Significant activity will appear here as the event runs." />
      ) : (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
          {timeline.map((t) => (
            <div key={t.id} className="p-3 flex items-start gap-3 text-sm">
              <span className="text-[11px] text-[var(--color-text-secondary)] shrink-0 w-14">
                {new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="min-w-0">
                <p>{t.text}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">{t.actor} · {new Date(t.at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {audit && audit.length > 0 && (
        <details className="card p-4">
          <summary className="text-sm font-semibold cursor-pointer">Raw audit record ({audit.length} entries)</summary>
          <div className="mt-2 space-y-1 max-h-64 overflow-y-auto">
            {audit.slice(0, 100).map((a) => (
              <p key={a.id} className="text-[11px] font-mono text-[var(--color-text-secondary)]">
                #{a.id} {a.created_at} · {a.action} · {a.entity_type || '-'}/{a.entity_id || '-'}
              </p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
