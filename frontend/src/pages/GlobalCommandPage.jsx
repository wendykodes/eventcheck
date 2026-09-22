// RaaS Phase 3.7 — Global command. Cross-event attention for RaaS operators.
// Portfolio-scoped by the backend: admins see all, staff see assigned events.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const HEALTH_DOT = { CRITICAL: 'bg-red-500', WATCH: 'bg-amber-500', OK: 'bg-green-500' };

export default function GlobalCommandPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setData(await api.getGlobalCommand());
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 20000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;
  if (!data) return null;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Command</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {data.total} event{data.total === 1 ? '' : 's'} · {data.needs_attention.length} need{data.needs_attention.length === 1 ? 's' : ''} attention
        </p>
      </div>

      {data.events.length === 0 ? (
        <EmptyState title="No events" message="Events you can access will appear here." />
      ) : (
        <div className="space-y-2.5">
          {data.events.map((e) => (
            <Link key={e.id} to={`/events/${e.id}/command`} className="card p-4 block space-y-2 active:scale-[0.99]">
              <div className="flex items-center gap-2.5">
                <span className={`w-3 h-3 rounded-full shrink-0 ${HEALTH_DOT[e.health] || 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[15px] truncate">{e.name}</p>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">{e.lifecycle_state}{e.date ? ` · ${e.date}` : ''}</p>
                </div>
                <span className="text-[12px] font-bold text-[var(--color-text-secondary)] shrink-0">
                  {e.attention_count > 0 ? `${e.attention_count} ⚠` : '✓'}
                </span>
              </div>
              {e.reasons.length > 0 && (
                <p className="text-[12px] text-[var(--color-text-secondary)] truncate">• {e.reasons[0]}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
