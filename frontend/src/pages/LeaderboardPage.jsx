import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

export default function LeaderboardPage() {
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEvents().then(setEvents).catch(() => {});
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        setLeaderboard(await api.getLeaderboard(selectedEvent || undefined));
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [selectedEvent]);

  const colors = ['#ff3b30', '#30d158', '#ff9f0a', '#ff453a', '#5e5ce6', '#ff375f'];

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Leaderboard</h1>
        <Link to="/users" className="btn btn-secondary btn-sm">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
          Staff
        </Link>
      </div>

      {events.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1">
          <button onClick={() => setSelectedEvent(null)}
            className={`btn btn-sm rounded-full text-xs px-3.5 py-1.5 transition-all ${!selectedEvent ? 'bg-[var(--color-blue-500)] text-white shadow-sm' : 'btn-secondary'}`}>All Events</button>
          {events.map(e => (
            <button key={e.id} onClick={() => setSelectedEvent(e.id)}
              className={`btn btn-sm rounded-full text-xs px-3.5 py-1.5 transition-all ${selectedEvent === e.id ? 'bg-[var(--color-blue-500)] text-white shadow-sm' : 'btn-secondary'}`}>{e.name}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} lines={1} />)}</div>
      ) : leaderboard.length === 0 ? (
        <EmptyState title="No Data" message="No check-in activity recorded yet." />
      ) : (
        <div className="space-y-2">
          {leaderboard.map((s, i) => (
            <Link key={s.id} to={`/staff/${s.id}`} className={`card p-4 flex items-center gap-4 animate-slide-up stagger-${Math.min(i+1,6)}`}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                style={{ backgroundColor: `${colors[i % colors.length]}15`, color: colors[i % colors.length] }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px]">{s.name}</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {s.guests_checked} guests · {s.attendees} attendees
                  {s.last_checkin && <> · Last {new Date(s.last_checkin).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</>}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="font-bold text-[20px]" style={{ color: colors[i % colors.length] }}>{s.checkins}</div>
                <div className="text-[10px] text-[var(--color-text-secondary)]">check-ins</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
