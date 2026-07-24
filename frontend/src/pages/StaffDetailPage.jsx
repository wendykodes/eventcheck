import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import { useAuth } from '../hooks/useAuth';

export default function StaffDetailPage() {
  const { staffId } = useParams();
  const { user: currentUser } = useAuth();
  const [data, setData] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    Promise.all([
      api.getStaffStats(staffId),
      api.getStaffTimeline(staffId)
    ]).then(([d, t]) => {
      setData(d);
      setTimeline(t);
    }).catch(err => toast.error(err.message))
    .finally(() => setLoading(false));
  }, [staffId]);

  const handleUpdateStatus = async (nextStatus) => {
    setActionLoading(true);
    try {
      const updated = await api.updateUserStatus(staffId, nextStatus);
      setData(prev => ({ ...prev, user: { ...prev.user, status: updated.status } }));
      toast.success(`User status is now ${updated.status}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleResetPin = async () => {
    if (!confirm('Are you sure you want to reset this staff member\'s PIN? They will need to set a new one on their next login.')) return;
    setActionLoading(true);
    try {
      await api.resetUserPin(staffId);
      toast.success('PIN reset successfully. Temporary PIN is 1234.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={4} /><SkeletonCard lines={5} /></div>;
  if (!data) return null;

  const { user, events, lifetime, today, activity_breakdown, event_breakdown, recent_checkins } = data;

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'active': return 'badge-green';
      case 'suspended': return 'badge-orange';
      default: return 'badge-red';
    }
  };

  return (
    <div className="pt-2 space-y-5 animate-fade-in">
      <Link to="/users" className="text-[13px] text-[var(--color-text-secondary)] hover:text-primary-500 transition-colors inline-flex items-center gap-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
        Staff
      </Link>

      {/* Profile */}
      <div className="card p-5 animate-slide-up">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-500 flex items-center justify-center text-xl font-bold shrink-0">
            {user.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold tracking-tight">{user.name}</h1>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${user.role === 'admin' ? 'badge-primary' : 'badge-gray'}`}>{user.role}</span>
              <span className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${getStatusBadgeClass(user.status)}`}>{user.status}</span>
            </div>
            <p className="text-[13px] text-[var(--color-text-secondary)] mt-0.5">
              Created {new Date(user.created_at).toLocaleDateString()}
              {user.last_login && ` · Last login ${new Date(user.last_login).toLocaleDateString()}`}
            </p>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card p-4">
          <div className="text-[24px] font-bold text-primary-500"><span className="animate-count-up">{today.checkins}</span></div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Today Check-Ins</div>
          <div className="text-[11px] text-[var(--color-text-secondary)] opacity-70">{today.guests} guests · {today.attendees} attendees</div>
        </div>
        <div className="card p-4">
          <div className="text-[24px] font-bold">{lifetime.checkins}</div>
          <div className="text-[11px] text-[var(--color-text-secondary)]">Lifetime Check-Ins</div>
          <div className="text-[11px] text-[var(--color-text-secondary)] opacity-70">{lifetime.guests} guests · {lifetime.attendees} attendees</div>
        </div>
      </div>

      {/* Assigned Events */}
      {events.length > 0 && (
        <div>
          <h2 className="section-title">Assigned Events</h2>
          <div className="space-y-1.5">
            {events.map(e => (
              <Link key={e.id} to={`/events/${e.id}`} className="card p-3.5 flex items-center justify-between text-sm">
                <span className="font-medium">{e.name}</span>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                  e.status === 'active' ? 'badge-green' : e.status === 'upcoming' ? 'badge-orange' : 'badge-gray'
                }`}>{e.status}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Activity Breakdown */}
      {activity_breakdown.length > 0 && (
        <div>
          <h2 className="section-title">Activity Breakdown</h2>
          <div className="card-flat divide-y divide-[var(--color-border)] rounded-2xl overflow-hidden">
            {activity_breakdown.map((a, i) => (
              <div key={i} className="p-3.5 flex items-center justify-between text-sm bg-[var(--color-surface)]">
                <span>{a.name}</span>
                <span className="font-semibold bg-[var(--color-surface-hover)] px-3 py-0.5 rounded-full text-[12px]">{a.checkins} check-ins</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event Breakdown */}
      {event_breakdown.length > 0 && (
        <div>
          <h2 className="section-title">Event Performance</h2>
          <div className="space-y-2">
            {event_breakdown.map((e, i) => (
              <div key={i} className="card p-3.5 animate-slide-up" style={{animationDelay: `${i*50}ms`}}>
                <div className="flex items-center justify-between text-sm font-medium">{e.name}</div>
                <div className="flex gap-4 mt-1.5 text-[12px] text-[var(--color-text-secondary)]">
                  <span>{e.checkins} check-ins</span>
                  <span>{e.guests} guests</span>
                  <span>{e.attendees} attendees</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Check-Ins */}
      <div>
        <h2 className="section-title">Recent Activity</h2>
        <div className="card-flat divide-y divide-[var(--color-border)] rounded-2xl overflow-hidden">
          {recent_checkins.length === 0 ? (
            <div className="p-6 text-sm text-[var(--color-text-secondary)] text-center">No check-ins yet</div>
          ) : (
            recent_checkins.map((c, i) => (
              <div key={i} className="p-3.5 flex items-center justify-between animate-fade-in bg-[var(--color-surface)]" style={{animationDelay: `${i*30}ms`}}>
                <div className="flex items-center gap-3">
                  <div className="w-7 h-7 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-medium text-[14px]">{c.guest_name}</p>
                    <p className="text-[12px] text-[var(--color-text-secondary)]">{c.activity_name}</p>
                  </div>
                </div>
                <div className="text-right text-[11px] text-[var(--color-text-secondary)]">
                  {new Date(c.checked_in_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Timeline */}
      {timeline.length > 0 && (
        <div className="pb-6">
          <h2 className="section-title">Timeline</h2>
          <div className="card-flat divide-y divide-[var(--color-border)] rounded-2xl overflow-hidden">
            {timeline.map((t, i) => (
              <div key={i} className="p-3 flex items-center gap-3 text-sm animate-fade-in bg-[var(--color-surface)]" style={{animationDelay: `${i*20}ms`}}>
                {t.type === 'login' ? (
                  <div className="w-7 h-7 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                    </svg>
                  </div>
                ) : (
                  <div className="w-7 h-7 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  {t.type === 'login' ? (
                    <p className="font-medium text-[13px]">Logged in</p>
                  ) : (
                    <p className="font-medium text-[13px]">Checked in <span className="text-primary-500">{t.guest_name}</span> at {t.activity_name}</p>
                  )}
                  <p className="text-[11px] text-[var(--color-text-secondary)]">{new Date(t.timestamp).toLocaleString()}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Administrative Controls */}
      {currentUser?.role === 'admin' && currentUser.id !== user.id && (
        <div className="card p-5 border-red-100 dark:border-red-900/30 animate-slide-up">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-secondary)] mb-4">Administrative Controls</h2>
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <p className="font-semibold text-sm">Staff Account Status</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Suspend, activate, or deactivate this account.</p>
            </div>
            <div className="flex gap-2">
              {[
                { status: 'active', label: 'Active', color: 'btn-success bg-green-500 hover:bg-green-600 text-white' },
                { status: 'suspended', label: 'Suspend', color: 'btn-secondary border-orange-200 text-orange-500 hover:bg-orange-50 dark:border-orange-900/30 dark:hover:bg-orange-950/20' },
                { status: 'inactive', label: 'Deactivate', color: 'btn-danger' }
              ].map(btn => (
                <button
                  key={btn.status}
                  onClick={() => handleUpdateStatus(btn.status)}
                  disabled={actionLoading || user.status === btn.status}
                  className={`btn btn-sm ${btn.color} ${user.status === btn.status ? 'ring-2 ring-offset-2 ring-primary-500 opacity-100 scale-105' : 'opacity-70'}`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          
          <div className="divider" />
          
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <p className="font-semibold text-sm">Reset Security PIN</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">Resets the user's login PIN to the default '1234'.</p>
            </div>
            <button
              onClick={handleResetPin}
              disabled={actionLoading}
              className="btn btn-secondary btn-sm"
            >
              Reset PIN to 1234
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
