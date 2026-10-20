import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';

const LIFECYCLE_COLORS = {
  DRAFT: 'bg-gray-100 text-gray-700',
  CONFIGURING: 'bg-blue-100 text-blue-700',
  READY: 'bg-green-100 text-green-700',
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  CLOSING: 'bg-amber-100 text-amber-700',
  CLOSED: 'bg-slate-100 text-slate-700',
  ARCHIVED: 'bg-gray-50 text-gray-500',
};

export default function CommandCenterPage() {
  const auth = useAuth();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }
  
  const [events, setEvents] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFilter, setSelectedFilter] = useState('all'); // all, active, upcoming, past

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadAlerts = async () => {
    try {
      const data = await api.get('/command/alerts');
      setAlerts(data || []);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  useEffect(() => {
    loadEvents();
    loadAlerts();
    setLoading(false);
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadEvents();
      loadAlerts();
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const filteredEvents = events.filter(event => {
    const state = event.lifecycle_state || 'DRAFT';
    if (selectedFilter === 'active') return state === 'ACTIVE';
    if (selectedFilter === 'upcoming') return ['DRAFT', 'CONFIGURING', 'READY'].includes(state);
    if (selectedFilter === 'past') return ['CLOSING', 'CLOSED', 'ARCHIVED'].includes(state);
    return true;
  });

  const activeEvents = events.filter(e => (e.lifecycle_state || 'DRAFT') === 'ACTIVE');
  const totalGuests = events.reduce((sum, e) => sum + (e.total_guests || 0), 0);
  const totalCheckedIn = events.reduce((sum, e) => sum + (e.checked_in_guests || 0), 0);

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /><SkeletonCard lines={4} /></div>;

  return (
    <div className="pt-2 space-y-5 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Command Center</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Multi-event overview and operations
        </p>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-[24px] font-bold text-primary-500">{activeEvents.length}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Active Events</div>
        </div>
        <div className="card p-4">
          <div className="text-[24px] font-bold">{totalGuests}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Total Guests</div>
        </div>
        <div className="card p-4">
          <div className="text-[24px] font-bold text-green-500">{totalCheckedIn}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Checked In</div>
        </div>
        <div className="card p-4">
          <div className="text-[24px] font-bold text-amber-500">{alerts.length}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Active Alerts</div>
        </div>
      </div>

      {/* Event Comparison */}
      {activeEvents.length >= 2 && (
        <div className="card p-4">
          <h2 className="section-title">Event Comparison</h2>
          <div className="mt-3 space-y-3">
            {activeEvents.slice(0, 3).map((event) => (
              <div key={event.id} className="card p-3 bg-[var(--color-surface)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-[14px]">{event.name}</span>
                  <span className="text-[11px] px-2 py-0.5 rounded-full badge-green">
                    {event.lifecycle_state}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-[var(--color-text-secondary)]">
                  <div>
                    <div className="font-medium text-[var(--color-text)]">{event.total_guests || 0}</div>
                    <div>Guests</div>
                  </div>
                  <div>
                    <div className="font-medium text-[var(--color-text)]">{event.checked_in_guests || 0}</div>
                    <div>Checked In</div>
                  </div>
                  <div>
                    <div className="font-medium text-[var(--color-text)]">
                      {event.total_guests ? Math.round(((event.checked_in_guests || 0) / event.total_guests) * 100) : 0}%
                    </div>
                    <div>Attendance</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="card p-4 border-l-4 border-l-red-500">
          <h2 className="font-semibold text-[14px] mb-3">Active Alerts ({alerts.length})</h2>
          <div className="space-y-2">
            {alerts.slice(0, 5).map((alert) => (
              <div key={alert.id} className="text-[12px] p-2 bg-red-50 dark:bg-red-900/20 rounded">
                <div className="font-medium">{alert.title}</div>
                <div className="text-[var(--color-text-secondary)]">{alert.message}</div>
                <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">
                  {alert.event_name} · {new Date(alert.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resource Assignment */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-title">Staff Assignment</h2>
          <Link to="/resource-assignment" className="text-[12px] text-primary-500 hover:underline">
            Manage all →
          </Link>
        </div>
        <div className="text-[12px] text-[var(--color-text-secondary)] mb-3">
          Cross-event resource allocation
        </div>
        <div className="space-y-2">
          {events.slice(0, 5).map((event) => (
            <div key={event.id} className="card p-3 bg-[var(--color-surface)] flex items-center justify-between">
              <div>
                <div className="font-medium text-[14px]">{event.name}</div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {event.date} · {event.lifecycle_state}
                </div>
              </div>
              <Link to={`/resource-assignment?event=${event.id}`} className="btn btn-secondary btn-sm">
                Assign Staff
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {['all', 'active', 'upcoming', 'past'].map(filter => (
          <button
            key={filter}
            onClick={() => setSelectedFilter(filter)}
            className={`px-3 py-1.5 text-[12px] rounded-full whitespace-nowrap ${
              selectedFilter === filter
                ? 'bg-primary-500 text-white'
                : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]'
            }`}
          >
            {filter.charAt(0).toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      {/* Events List */}
      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No events found"
          message={`No ${selectedFilter} events`}
        />
      ) : (
        <div className="space-y-2.5">
          {filteredEvents.map((event) => (
            <Link key={event.id} to={`/events/${event.id}`} className="card p-4 block hover:bg-[var(--color-surface-hover)] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-[15px] truncate">{event.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${LIFECYCLE_COLORS[event.lifecycle_state] || LIFECYCLE_COLORS.DRAFT}`}>
                      {event.lifecycle_state || 'DRAFT'}
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    {event.date}{event.venue ? ` · ${event.venue}` : ''}
                  </p>
                  <div className="flex gap-4 mt-2 text-[11px] text-[var(--color-text-secondary)]">
                    <span>{event.total_guests || 0} guests</span>
                    <span>{event.checked_in_guests || 0} checked in</span>
                    <span>{Math.round(((event.checked_in_guests || 0) / (event.total_guests || 1)) * 100)}% attendance</span>
                  </div>
                </div>
                <div className="text-right">
                  <button className="btn btn-secondary btn-sm">Manage</button>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
