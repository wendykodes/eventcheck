import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import GuestBottomSheet from '../components/GuestBottomSheet';

function highlight(text, query) {
  if (!query || !text) return text;
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    re.test(p) ? <mark key={i} className="bg-blue-200 dark:bg-blue-800/40 rounded-sm text-inherit">{p}</mark> : p
  );
}

export default function CheckInPage({ user }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef(null);
  const searchTimer = useRef(null);

  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [query, setQuery] = useState('');
  const [guests, setGuests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [checkedIn, setCheckedIn] = useState({});
  const [checkingIn, setCheckingIn] = useState(null);
  const [recentGuestIds, setRecentGuestIds] = useState([]);
  const [detailGuest, setDetailGuest] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [metrics, setMetrics] = useState({ total: 0, checked: 0, attendees_total: 0, attendees_checked: 0 });

  const eventParam = searchParams.get('event');

  useEffect(() => { const o = () => setIsOnline(true); const f = () => setIsOnline(false); window.addEventListener('online', o); window.addEventListener('offline', f); return () => { window.removeEventListener('online', o); window.removeEventListener('offline', f); }; }, []);

  useEffect(() => { api.getEvents().then(setEvents).catch(() => {}); }, []);

  useEffect(() => {
    setSelectedEvent(eventParam ? Number(eventParam) : null);
  }, [eventParam]);

  useEffect(() => {
    if (selectedEvent) {
      api.getActivities(selectedEvent).then(acts => {
        setActivities(acts);
        const lastAct = localStorage.getItem(`last_selected_activity_${selectedEvent}`);
        if (lastAct && acts.some(a => a.id === Number(lastAct))) {
          setSelectedActivity(Number(lastAct));
        } else if (acts.length > 0) {
          setSelectedActivity(acts[0].id);
        }
      }).catch(() => {});
      setQuery('');
      setGuests([]);
      setCheckedIn({});
      loadMetrics(selectedEvent);
    }
  }, [selectedEvent]);

  useEffect(() => {
    if (selectedEvent && selectedActivity) {
      localStorage.setItem(`last_selected_activity_${selectedEvent}`, selectedActivity);
    }
  }, [selectedEvent, selectedActivity]);

  const loadMetrics = async (eventId) => {
    try {
      const d = await api.getDashboard(eventId);
      setMetrics({
        total: d.total_guests || 0,
        checked: d.checked_in_guests || 0,
        attendees_total: d.total_attendees || 0,
        attendees_checked: d.checked_in_attendees || 0,
      });
    } catch {}
  };

  const search = useCallback(async (q) => {
    if (!selectedEvent || !selectedActivity || q.length < 2) {
      setGuests([]);
      return;
    }
    setLoading(true);
    try {
      const guestsData = await api.getGuests(selectedEvent, q);
      const ciMap = {};
      await Promise.all(guestsData.map(async (g) => {
        try {
          const cs = await api.getGuestCheckins(g.id);
          ciMap[g.id] = cs;
        } catch {}
      }));
      setCheckedIn(ciMap);
      setGuests(guestsData);
    } catch {} finally { setLoading(false); }
  }, [selectedEvent, selectedActivity]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => search(query), 150);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, search]);

  const handleCheckIn = async (guestId) => {
    if (!selectedActivity) return;
    if (checkedIn[guestId]?.find(c => c.activity_id === selectedActivity)) return;
    setCheckingIn(guestId);
    try {
      const ci = await api.checkIn(guestId, selectedActivity);
      setCheckedIn(prev => ({ ...prev, [guestId]: [...(prev[guestId] || []), ci] }));
      setRecentGuestIds(prev => [guestId, ...prev.filter(id => id !== guestId)].slice(0, 10));
      toast.success('Checked in!');
      if (selectedEvent) loadMetrics(selectedEvent);
      setTimeout(() => searchRef.current?.focus(), 100);
    } catch (err) {
      toast.error(err.message);
      throw err;
    } finally { setCheckingIn(null); }
  };

  const handleUndoCheckIn = async (checkinId, guestId) => {
    try {
      await api.undoCheckIn(checkinId);
      setCheckedIn(prev => ({
        ...prev,
        [guestId]: (prev[guestId] || []).filter(c => c.id !== checkinId)
      }));
      toast.success('Check-in undone');
      if (selectedEvent) loadMetrics(selectedEvent);
    } catch (err) {
      toast.error(err.message);
      throw err;
    }
  };

  const getCheckinInfo = (guestId) => {
    const cs = checkedIn[guestId];
    if (!cs) return null;
    return cs.find(c => c.activity_id === selectedActivity);
  };

  const recentGuests = recentGuestIds.map(id => guests.find(g => g.id === id)).filter(Boolean);
  const remaining = metrics.total - metrics.checked;
  const remainingAttendees = metrics.attendees_total - metrics.attendees_checked;
  const eventObj = events.find(e => e.id === selectedEvent);
  const actName = activities.find(a => a.id === selectedActivity)?.name;

  if (events.length === 0 && !selectedEvent) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center animate-fade-in-up">
        <div className="w-20 h-20 rounded-full bg-[var(--color-surface-hover)] flex items-center justify-center mb-5">
          <svg className="w-9 h-9 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
          </svg>
        </div>
        <h3 className="text-xl font-bold tracking-tight">No Events Assigned</h3>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 max-w-xs">Contact an administrator to get access to an event.</p>
      </div>
    );
  }

  if (events.length > 0 && !selectedEvent) {
    if (searchParams.get('mode') === 'checkin') {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-center animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center mb-5">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-xl font-bold tracking-tight text-[var(--color-text)]">No Event Selected</h3>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 max-w-xs mb-6">
            Select an event from the Events tab to start checking in guests.
          </p>
          <button onClick={() => setSearchParams({})} className="btn btn-primary px-6 py-2.5 text-sm font-semibold rounded-xl">
            Go to Events
          </button>
        </div>
      );
    }

    return (
      <div className="pt-4 space-y-3 animate-fade-in">
        <h1 className="text-[26px] font-bold tracking-tight">Check-In</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Select an event</p>
        <div className="space-y-2.5 mt-2">
          {events.map((e, i) => (
            <button key={e.id} onClick={() => setSearchParams({ event: e.id })}
              className="card w-full p-5 text-left font-semibold text-[17px] hover:border-blue-400 active:scale-[0.98] animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center shrink-0 shadow-sm">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[17px]">{e.name}</p>
                  <p className="text-sm text-[var(--color-text-secondary)]">{e.status || 'Active'}</p>
                </div>
                <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (selectedEvent && !selectedActivity) {
    return (
      <div className="pt-4 space-y-3 animate-fade-in">
        <h1 className="text-[26px] font-bold tracking-tight">Select Station</h1>
        <p className="text-sm text-[var(--color-text-secondary)]">Choose your activity</p>
        <button onClick={() => setSearchParams({})} className="btn btn-ghost btn-sm text-[var(--color-text-secondary)]">← Change event</button>
        <div className="space-y-2.5 mt-1">
          {activities.map((a, i) => (
            <button key={a.id} onClick={() => setSelectedActivity(a.id)}
              className="card w-full p-5 text-left font-semibold text-[17px] hover:border-blue-400 active:scale-[0.98] animate-slide-up"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--color-surface-hover)] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
                  </svg>
                </div>
                <span className="flex-1">{a.name}</span>
                <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <GuestBottomSheet
        guest={detailGuest}
        onClose={() => setDetailGuest(null)}
        selectedActivity={selectedActivity}
        onCheckIn={handleCheckIn}
        onUndoCheckIn={handleUndoCheckIn}
        isAdmin={user?.role === 'admin'}
      />

      <div className="sticky top-0 z-30 -mx-4 px-4 pt-1 pb-2 bg-[var(--color-surface-secondary)]/90 backdrop-blur-xl">
        <div className="flex items-center justify-between mb-2">
          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)] shrink-0 truncate max-w-[120px]">{eventObj?.name}</span>
            <span className="text-[12px] font-medium text-[var(--color-text-secondary)] shrink-0">·</span>
            <div className="relative inline-flex items-center">
              <select
                value={selectedActivity || ''}
                onChange={e => setSelectedActivity(e.target.value ? Number(e.target.value) : null)}
                className="appearance-none bg-transparent pr-4 text-[12px] font-bold text-blue-500 dark:text-blue-400 focus:outline-none border-b border-dashed border-blue-500/50 pb-0.5 cursor-pointer max-w-[180px] truncate"
              >
                {activities.map(a => (
                  <option key={a.id} value={a.id} className="text-black dark:text-white bg-[var(--color-surface)]">
                    {a.name}
                  </option>
                ))}
              </select>
              <svg className="w-3 h-3 absolute right-0 top-1/2 -translate-y-1/2 pointer-events-none text-blue-500 dark:text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-2 shrink-0">
            <Link
              to={`/events/${selectedEvent}/guests`}
              className="inline-flex items-center gap-1 text-[12px] font-bold text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
              </svg>
              Guests
            </Link>
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
              isOnline ? 'bg-green-100 dark:bg-green-900/20 text-green-600 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-red-500'}`} />
              {isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 mb-2.5">
          <MetricBox label="Invites In" value={metrics.checked} color="text-blue-500" />
          <MetricBox label="Invites Left" value={remaining} color={remaining > 0 ? 'text-amber-500' : 'text-green-500'} />
          <MetricBox label="People In" value={metrics.attendees_checked} color="text-green-500" />
          <MetricBox label="People Left" value={remainingAttendees} color={remainingAttendees > 0 ? 'text-amber-500' : 'text-green-500'} />
        </div>

        <div className="relative">
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input ref={searchRef} type="search" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone, table…" autoFocus
            className="search-field h-[50px] text-[17px] pl-10 placeholder:text-[15px]" />
          {query && (
            <button onClick={() => { setQuery(''); searchRef.current?.focus(); }} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="space-y-2.5 mt-3">
          {[1, 2, 3].map(i => <SkeletonCard key={i} lines={2} />)}
        </div>
      )}

      {!loading && query.length > 0 && query.length < 2 && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="text-sm text-[var(--color-text-secondary)]">Type at least 2 characters to search</p>
        </div>
      )}

      {!loading && query.length >= 2 && guests.length === 0 && (
        <div className="flex flex-col items-center py-16 text-center">
          <p className="font-semibold">No Guests Found</p>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">Try a different name or phone number</p>
        </div>
      )}

      {!loading && query.length === 0 && recentGuestIds.length > 0 && (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2 px-0.5">Recently Checked In</p>
          <div className="space-y-2">
            {recentGuests.map(g => renderGuestCard(g))}
          </div>
        </div>
      )}

      <div className={`space-y-2.5 pb-28 ${query.length >= 2 ? 'mt-3' : ''}`}>
        {guests.map(g => renderGuestCard(g))}
      </div>
    </div>
  );

  function renderGuestCard(guest) {
    const ci = getCheckinInfo(guest.id);
    const checked = !!ci;
    return (
      <div key={guest.id} className={`card p-4 transition-all duration-200 active:scale-[0.99] ${
        checked ? 'border-green-300 dark:border-green-700 bg-green-50/40 dark:bg-green-900/10' : ''
      } animate-fade-in`}>
        <div className="flex items-start gap-3">
          <button onClick={() => setDetailGuest(guest)} className="flex-1 min-w-0 text-left">
            <h3 className="font-semibold text-[17px] leading-tight">
              {query.length >= 2 ? highlight(guest.name, query) : guest.name}
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
              {query.length >= 2 ? highlight(guest.phone, query) : guest.phone}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {guest.guest_count > 1 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-full px-2.5 py-0.5">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                  </svg>
                  {guest.guest_count}
                </span>
              )}
              {guest.table_number && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 rounded-full px-2.5 py-0.5">
                  T{guest.table_number}
                </span>
              )}
              {guest.category && (
                <span className="inline-flex items-center text-[11px] font-medium bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)] rounded-full px-2.5 py-0.5">
                  {guest.category}
                </span>
              )}
              {guest.notes && (
                <span className="inline-flex items-center text-[11px] text-[var(--color-text-secondary)]" title={guest.notes}>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </span>
              )}
            </div>
            {checked && ci && (
              <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-full px-3 py-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {new Date(ci.checked_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {ci.staff_name && <span className="opacity-70">· {ci.staff_name}</span>}
              </div>
            )}
          </button>
          <button onClick={() => handleCheckIn(guest.id)} disabled={checked || checkingIn === guest.id}
            className={`shrink-0 w-[72px] h-[72px] rounded-[20px] font-semibold text-sm transition-all duration-150 flex flex-col items-center justify-center ${
              checked
                ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-2 border-green-300 dark:border-green-700'
                : 'bg-blue-500 hover:bg-blue-600 active:scale-90 text-white shadow-lg shadow-blue-500/30'
            } disabled:opacity-50 disabled:shadow-none`}
          >
            {checkingIn === guest.id ? (
              <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            ) : checked ? (
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <>
                <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-[9px]">Check In</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }
}

function MetricBox({ label, value, color }) {
  return (
    <div className="bg-[var(--color-surface-hover)]/50 rounded-xl py-1.5 px-2 text-center">
      <div className={`text-[15px] font-bold leading-tight ${color || ''}`}>{value}</div>
      <div className="text-[9px] text-[var(--color-text-secondary)] uppercase tracking-wider">{label}</div>
    </div>
  );
}
