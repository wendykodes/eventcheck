import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonStat, SkeletonCard } from '../components/Skeleton';
import DonutChart from '../components/DonutChart';

function AnimatedValue({ value, suffix = '' }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    const start = display;
    const diff = value - start;
    if (diff === 0) return;
    const duration = 600;
    const startTime = performance.now();
    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(start + diff * eased));
      if (progress < 1) ref.current = requestAnimationFrame(animate);
    };
    ref.current = requestAnimationFrame(animate);
    return () => { if (ref.current) cancelAnimationFrame(ref.current); };
  }, [value]);
  return <>{display}{suffix}</>;
}

export default function DashboardPage() {
  const { eventId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setData(await api.getDashboard(eventId));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) return <div className="space-y-4 pt-4"><SkeletonStat /><SkeletonCard lines={4} /><SkeletonCard lines={3} /></div>;
  if (!data) return null;

  const { event, total_guests, total_attendees, checked_in_guests, checked_in_attendees, attendance_pct, activities, recent_checkins, staff_summary } = data;
  const remaining_guests = total_guests - checked_in_guests;
  const remaining_attendees = total_attendees - checked_in_attendees;

  const colors = ['#0071e3', '#30d158', '#ff9f0a', '#ff453a', '#5e5ce6', '#ff375f'];

  return (
    <div className="pt-2 space-y-5 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-2 px-1">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">{event.name}</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">
            {event.date}{event.venue ? ` · ${event.venue}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/events/${eventId}/guests`} className="btn btn-secondary btn-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
            Guests
          </Link>
          <Link to={`/checkin?event=${eventId}`} className="btn btn-success btn-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Check-In
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Total Guests" value={total_guests} sub={`${total_attendees} attendees`} />
        <StatCard label="Checked In" value={checked_in_guests} sub={`${checked_in_attendees} attendees`} accent="#30d158" />
        <StatCard label="Remaining" value={remaining_guests} sub={`${remaining_attendees} attendees`} accent="#ff9f0a" />
        <StatCard label="Attendance" chart={<DonutChart value={checked_in_guests} max={total_guests} size={60} strokeWidth={5} />} sub={`${attendance_pct}%`} />
      </div>

      <div>
        <h2 className="section-title flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
          </svg>
          Activity Stations
        </h2>
        <div className="space-y-2.5">
          {activities.map((a, i) => (
            <div key={a.id} className={`card p-4 animate-slide-up stagger-${Math.min(i+1,6)}`}>
              <div className="flex items-center justify-between mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                  <span className="font-semibold text-[15px]">{a.name}</span>
                </div>
                <span className="text-[13px] text-[var(--color-text-secondary)] font-medium">
                  {a.checked_in_guests}/{total_guests}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 progress-bar">
                  <div className="progress-fill" style={{ width: `${a.completion_pct}%`, backgroundColor: colors[i % colors.length] }} />
                </div>
                <span className="text-[12px] text-[var(--color-text-secondary)] font-medium w-12 text-right">{a.completion_pct}%</span>
              </div>
              <div className="flex gap-4 mt-2 text-[12px] text-[var(--color-text-secondary)]">
                <span>{a.checked_in_attendees} attendees</span>
                <span>{a.remaining_guests} remaining</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5">
        <div>
          <h2 className="section-title flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.954l-7.108 4.062A1.125 1.125 0 013 16.812V8.688zM12.75 8.688c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.954l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.688z" />
            </svg>
            Recent Check-Ins
          </h2>
          <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
            {recent_checkins.length === 0 ? (
              <div className="p-6 text-sm text-[var(--color-text-secondary)] text-center">No check-ins recorded yet</div>
            ) : (
              recent_checkins.slice(0, 8).map((c, i) => (
                <div key={i} className="p-3.5 flex items-center justify-between animate-fade-in" style={{animationDelay: `${i*30}ms`}}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-[14px] font-medium truncate">{c.guest_name}</p>
                      <p className="text-[12px] text-[var(--color-text-secondary)]">{c.activity_name}</p>
                    </div>
                  </div>
                  <div className="text-right text-[11px] text-[var(--color-text-secondary)] shrink-0 ml-3">
                    <div>{new Date(c.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    <div className="opacity-70">{c.staff_name}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2 className="section-title flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            Staff Summary
          </h2>
          <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
            {staff_summary.length === 0 ? (
              <div className="p-6 text-sm text-[var(--color-text-secondary)] text-center">No staff activity yet</div>
            ) : (
              staff_summary.map((s, i) => (
                <div key={s.id} className="p-3.5 flex items-center justify-between animate-fade-in" style={{animationDelay: `${i*30}ms`}}>
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center text-[14px] font-bold">
                      {s.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-[14px]">{s.name}</span>
                  </div>
                  <span className="text-[13px] font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-hover)] px-3 py-1 rounded-full">
                    {s.checkin_count}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap pt-2">
        <Link to={`/events/${eventId}/guests`} className="btn btn-secondary btn-sm">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
          Guest List
        </Link>
        <Link to={`/events/${eventId}/activities`} className="btn btn-secondary btn-sm">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
          </svg>
          Activities
        </Link>
        <Link to={`/events/${eventId}/guests?action=import`} className="btn btn-secondary btn-sm">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          Import CSV
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent, chart }) {
  return (
    <div className="card p-4 animate-slide-up">
      <div className="flex items-center gap-3">
        {chart ? (
          <div className="shrink-0">{chart}</div>
        ) : (
          <div className={`text-[28px] font-bold tracking-tight ${accent ? '' : ''}`} style={{ color: accent || 'var(--color-text)' }}>
            <AnimatedValue value={value} />
          </div>
        )}
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-[var(--color-text-secondary)]">{label}</div>
          {sub && <div className="text-[11px] text-[var(--color-text-secondary)] opacity-70">{sub}</div>}
        </div>
      </div>
    </div>
  );
}
