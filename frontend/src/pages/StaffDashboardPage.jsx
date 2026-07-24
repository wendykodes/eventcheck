import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';

export default function StaffDashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const d = await api.getStaffDashboard();
        setData(d);
      } catch {} finally { setLoading(false); }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;
  if (!data) return null;

  const { name, events, today_checkins, total_attendees, last_checkin } = data;

  return (
    <div className="pt-3 space-y-5 animate-fade-in pb-6">
      <div className="px-1">
        <p className="text-sm text-[var(--color-text-secondary)]">Welcome back,</p>
        <h1 className="text-[28px] font-bold tracking-tight">{name}</h1>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {[
          { label: 'Today', value: today_checkins, color: 'text-primary-500' },
          { label: 'Attendees', value: total_attendees, color: 'text-green-500' },
          { label: 'Last', value: last_checkin ? new Date(last_checkin.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—', color: '' },
        ].map(s => (
          <div key={s.label} className="card p-3 text-center">
            <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-[var(--color-text-secondary)] uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="text-center py-10">
          <p className="font-semibold">No Events Assigned</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Contact an administrator to get access.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1">Your Events</h2>
          {events.map((e, i) => (
            <button key={e.id} onClick={() => navigate(`/events/${e.id}`)}
              className="card w-full p-5 text-left active:scale-[0.98] transition-all animate-slide-up hover:border-primary-400"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-primary-500 flex items-center justify-center shrink-0 shadow-sm">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[17px]">{e.name}</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{e.status}</p>
                </div>
                <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      )}

      {last_checkin && (
        <div className="bg-[var(--color-surface-hover)]/50 rounded-2xl p-4">
          <p className="text-[11px] text-[var(--color-text-secondary)] uppercase tracking-wider mb-1">Last Check-In</p>
          <p className="font-semibold text-[15px]">{last_checkin.guest_name}</p>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {last_checkin.activity_name} · {new Date(last_checkin.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
      )}
    </div>
  );
}
