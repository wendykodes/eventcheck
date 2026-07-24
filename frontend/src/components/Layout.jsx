import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function Layout({ user, onLogout, theme }) {
  const location = useLocation();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const isAdmin = user?.role === 'admin';
  const path = location.pathname;

  const activeEventId = eventId || searchParams.get('event');
  const [currentEvent, setCurrentEvent] = useState(null);

  useEffect(() => {
    if (activeEventId) {
      localStorage.setItem('last_selected_event', activeEventId);
      api.getEvent(activeEventId)
        .then(data => setCurrentEvent(data))
        .catch(err => console.error(err));
    } else {
      setCurrentEvent(null);
    }
  }, [activeEventId]);

  const lastEvent = localStorage.getItem('last_selected_event');
  const checkinTabTo = activeEventId 
    ? `/checkin?event=${activeEventId}` 
    : (lastEvent ? `/checkin?event=${lastEvent}` : '/checkin?mode=checkin');
  const eventsTabTo = isAdmin
    ? (path.startsWith('/events') && activeEventId ? `/events/${activeEventId}` : '/')
    : '/checkin';

  const bottomTabs = isAdmin
    ? [
        { to: eventsTabTo, label: 'Events', icon: 'events' },
        { to: '/pending', label: 'Requests', icon: 'requests' },
        { to: '/users', label: 'Staff', icon: 'staff' },
        { to: '/leaderboard', label: 'Leaderboard', icon: 'leaderboard' },
        { to: '/staff/me', label: 'My Stats', icon: 'mystats' },
      ]
    : [
        { to: eventsTabTo, label: 'Events', icon: 'events' },
        { to: checkinTabTo, label: 'Check-In', icon: 'checkin' },
        { to: '/staff/me', label: 'My Stats', icon: 'mystats' },
      ];

  function getAppIcon(name, isActive) {
    const strokeW = isActive ? 2.2 : 1.8;
    if (name === 'events') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-12v.75m0 3v.75m0 3v.75m0 3V18M3 8.25h1.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0118 6v.75a1.5 1.5 0 00-1.5 1.5H21a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-1.5a1.5 1.5 0 00-1.5 1.5V18a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 18v-.75a1.5 1.5 0 00-1.5-1.5H3a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 013 8.25z" />
        </svg>
      );
    }
    if (name === 'requests') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
        </svg>
      );
    }
    if (name === 'staff') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      );
    }
    if (name === 'leaderboard') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317-2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m0 0a6.023 6.023 0 01-2.77-.896" />
        </svg>
      );
    }
    if (name === 'mystats') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
        </svg>
      );
    }
    if (name === 'checkin') {
      return (
        <svg className="w-5.5 h-5.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={strokeW}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    }
    return null;
  }

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-surface-secondary)] text-[var(--color-text)]">
      <header className="sticky top-0 z-40 glass border-b border-[var(--color-border)]/50">
        <div className="max-w-[640px] mx-auto px-4 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-primary-500 flex items-center justify-center shadow-md shadow-primary-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 6v.75m0 3v.75m0 3v.75m0 3V18m-9-12v.75m0 3v.75m0 3v.75m0 3V18M3 8.25h1.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 011.5-1.5h9A1.5 1.5 0 0118 6v.75a1.5 1.5 0 00-1.5 1.5H21a1.5 1.5 0 011.5 1.5v9a1.5 1.5 0 01-1.5 1.5h-1.5a1.5 1.5 0 00-1.5 1.5V18a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 18v-.75a1.5 1.5 0 00-1.5-1.5H3a1.5 1.5 0 01-1.5-1.5v-9A1.5 1.5 0 013 8.25z" />
              </svg>
            </div>
            <span className="font-bold text-[15px] tracking-tight">{currentEvent ? currentEvent.name : 'EventCheck'}</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={theme.toggle} className="btn btn-ghost btn-icon" title={theme.dark ? 'Light' : 'Dark'}>
              {theme.dark ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
                </svg>
              )}
            </button>
            <div className="flex items-center gap-1.5 pl-1 border-l border-[var(--color-border)] ml-1">
              <span className="text-sm font-medium text-[var(--color-text-secondary)] hidden sm:inline">{user?.name}</span>
              <button onClick={onLogout} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 page-container pt-2" style={{ paddingBottom: '100px' }}>
        <Outlet />
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-[var(--color-border)]/50 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-[640px] mx-auto flex items-center justify-around h-[56px] px-2">
          {bottomTabs.map(item => {
            const modeParam = searchParams.get('mode');
            let isActive = false;
            if (item.label === 'Events') {
              isActive = isAdmin 
                ? (path === '/' || path.startsWith('/events'))
                : (path === '/checkin' && !activeEventId && modeParam !== 'checkin');
            } else if (item.label === 'Check-In') {
              isActive = path === '/checkin' && (!!activeEventId || modeParam === 'checkin');
            } else {
              isActive = path.startsWith(item.to);
            }
            return (
              <Link key={item.to} to={item.to}
                className={`flex flex-col items-center justify-center gap-0.5 px-3 py-1 rounded-xl transition-all ${
                  isActive ? 'text-primary-500' : 'text-[var(--color-text-secondary)]'
                }`}
              >
                {getAppIcon(item.icon, isActive)}
                <span className="text-[9px] font-semibold tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
