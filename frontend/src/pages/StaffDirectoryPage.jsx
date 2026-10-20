import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';

export default function StaffDirectoryPage() {
  const auth = useAuth();
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterEvent, setFilterEvent] = useState(null);
  const [filterRole, setFilterRole] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [u, e] = await Promise.all([api.getUsers(), api.getEvents()]);
        setUsers(u);
        setEvents(e);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const filteredUsers = users.filter(u => {
    const matchesSearch = !search || u.name.toLowerCase().includes(search.toLowerCase());
    const matchesEvent = !filterEvent || (u.event_ids || []).includes(filterEvent);
    const matchesRole = !filterRole || u.role === filterRole;
    return matchesSearch && matchesEvent && matchesRole;
  });

  if (loading) return <div className="pt-4 space-y-3">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} />)}</div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Team List</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {filteredUsers.length} staff member{filteredUsers.length !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          placeholder="Search by name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="input-field"
        />
        <div className="flex gap-2 flex-wrap">
          <select
            value={filterEvent || ''}
            onChange={e => setFilterEvent(e.target.value ? Number(e.target.value) : null)}
            className="input-field text-sm"
          >
            <option value="">All Events</option>
            {events.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <select
            value={filterRole || ''}
            onChange={e => setFilterRole(e.target.value || null)}
            className="input-field text-sm"
          >
            <option value="">All Roles</option>
            <option value="admin">Admin</option>
            <option value="staff">Staff</option>
          </select>
        </div>
      </div>

      {filteredUsers.length === 0 ? (
        <EmptyState title="No staff found" message="Try adjusting your search or filters." />
      ) : (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl">
          {filteredUsers.map((u, i) => (
            <div key={u.id} className="p-4 flex items-center justify-between animate-fade-in bg-[var(--color-surface)]" style={{animationDelay: `${i*40}ms`}}>
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-500 flex items-center justify-center text-[16px] font-bold shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[15px]">{u.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      u.role === 'admin' ? 'badge-primary' : 'badge-gray'
                    }`}>{u.role}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      u.status === 'active' ? 'badge-green' : 'badge-red'
                    }`}>{u.status}</span>
                  </div>
                  {u.last_activity && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                      Last active: {new Date(u.last_activity).toLocaleDateString()}
                    </p>
                  )}
                  {(u.event_ids || []).length > 0 && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                      {(u.event_ids || []).length} event{(u.event_ids || []).length !== 1 ? 's' : ''} assigned
                    </p>
                  )}
                </div>
              </div>
              <Link to={`/staff/${u.id}`} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]" title="View details">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
