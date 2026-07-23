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

  const topLinks = [
    ...(isAdmin ? [
      { to: '/', label: 'Events', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
      { to: '/pending', label: 'Requests', icon: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z' },
      { to: '/users', label: 'Staff', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
      { to: '/leaderboard', label: 'Leaderboard', icon: 'M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m0 0a6.023 6.023 0 01-2.77-.896' },
    ] : []),
    { to: '/staff/me', label: 'My Stats', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
  ];

  const bottomTabs = [
    { to: eventsTabTo, label: 'Events', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
    { to: checkinTabTo, label: 'Check-In', icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { to: '/staff/me', label: 'My Stats', icon: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z' },
    ...(isAdmin ? [{ to: '/users', label: 'Staff', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' }] : []),
  ];

  return (
    <div className="min-h-dvh flex flex-col bg-[var(--color-surface-secondary)] text-[var(--color-text)]">
      <header className="sticky top-0 z-40 glass border-b border-[var(--color-border)]/50">
        <div className="max-w-[640px] mx-auto px-4 h-[52px] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-500 flex items-center justify-center shadow-sm">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="font-semibold text-[15px] tracking-tight">{currentEvent ? currentEvent.name : 'Check-In'}</span>
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
        {topLinks.length > 0 && (
          <div className="max-w-[640px] mx-auto px-4 pb-2.5 flex gap-1 overflow-x-auto scroll-none">
            {topLinks.map(item => (
              <Link key={item.to} to={item.to}
                className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
                  path === item.to || (item.to === '/' && path.startsWith('/events'))
                    ? 'bg-blue-500 text-white shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)] bg-[var(--color-surface-hover)]/50'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </header>

      <main className="flex-1 page-container pt-2" style={{ paddingBottom: isAdmin ? '32px' : '100px' }}>
        <Outlet />
      </main>

      {!isAdmin && (
        <nav className="fixed bottom-0 left-0 right-0 z-40 glass border-t border-[var(--color-border)]/50 pb-[env(safe-area-inset-bottom)]">
          <div className="max-w-[640px] mx-auto flex items-center justify-around h-[50px] px-2">
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
                  className={`flex flex-col items-center justify-center gap-0.5 px-4 py-1 rounded-xl transition-all ${
                    isActive ? 'text-blue-500' : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  <svg className="w-5 h-5" fill={isActive ? '#0071e3' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={isActive ? 2 : 1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="text-[9px] font-semibold tracking-tight">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
