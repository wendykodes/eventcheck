import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

const PERMISSION_CATEGORIES = {
  'Guest Management': ['guest.view', 'guest.create', 'guest.update', 'guest.delete'],
  'Invitations': ['invite.view', 'invite.create', 'invite.revoke'],
  'RSVP': ['rsvp.view', 'rsvp.create', 'rsvp.update', 'rsvp.override', 'rsvp.export'],
  'Check-In': ['checkin.view', 'checkin.perform', 'checkin.override'],
  'Seating': ['seating.view', 'seating.assign', 'seating.update'],
  'Incidents': ['incident.view', 'incident.create', 'incident.assign', 'incident.resolve'],
  'Orders': ['order.view', 'order.create', 'order.update', 'order.fulfill'],
  'Service Requests': ['service_request.view', 'service_request.create', 'service_request.assign', 'service_request.fulfill'],
  'Vendors': ['vendor.view', 'vendor.manage'],
  'Transport': ['transport.view', 'transport.assign', 'transport.update', 'transport.manage'],
  'Accommodation': ['accommodation.view', 'accommodation.manage'],
  'Event': ['event.view', 'event.update', 'event.close', 'event.delete'],
  'Staff': ['staff.view', 'staff.assign', 'staff.update'],
  'Tasks': ['task.view', 'task.create', 'task.assign', 'task.update', 'task.complete'],
  'Schedule': ['schedule.view', 'schedule.manage'],
  'Reports': ['report.view'],
  'Audit': ['audit.view'],
  'Templates': ['template.view', 'template.manage'],
  'Venues': ['venue.view', 'venue.manage'],
  'Contracts': ['contract.view', 'contract.manage'],
  'Organizations': ['org.view', 'org.manage'],
};

export default function PermissionTestPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }
  
  const [event, setEvent] = useState(null);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userPermissions, setUserPermissions] = useState([]);
  const [loading, setLoading] = useState(true);

  const loadEvent = async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await api.getUsers();
      setUsers(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadUserPermissions = async (userId) => {
    if (!userId) {
      setUserPermissions([]);
      return;
    }
    try {
      const data = await api.get(`/events/${eventId}/users/${userId}/permissions`);
      setUserPermissions(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  useEffect(() => {
    loadEvent();
    loadUsers();
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    if (selectedUser) {
      loadUserPermissions(selectedUser);
    }
  }, [selectedUser, eventId]);

  const hasPermission = (perm) => {
    return userPermissions.includes(perm);
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Who Can Do What</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {event?.name || 'Event'} · Verify user permissions
        </p>
      </div>

      <EventTabs currentKey="permissions" adminOnly={true} />

      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">Select User</label>
        <select
          value={selectedUser || ''}
          onChange={(e) => setSelectedUser(e.target.value ? Number(e.target.value) : null)}
          className="input-field"
        >
          <option value="">Select a user...</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
          ))}
        </select>
      </div>

      {!selectedUser ? (
        <EmptyState
          title="No user selected"
          message="Select a user to view their permissions for this event"
        />
      ) : (
        <div className="space-y-4">
          <div className="card p-4 bg-primary-50 dark:bg-primary-900/10 border-l-4 border-l-primary-500">
            <p className="font-semibold text-[14px]">
              {users.find(u => u.id === selectedUser)?.name} · {userPermissions.length} permissions
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
              Platform role: {users.find(u => u.id === selectedUser)?.role}
            </p>
          </div>

          {Object.entries(PERMISSION_CATEGORIES).map(([category, perms]) => (
            <div key={category} className="card p-4">
              <h3 className="font-semibold text-[14px] mb-3">{category}</h3>
              <div className="grid grid-cols-2 gap-2">
                {perms.map((perm) => (
                  <div
                    key={perm}
                    className={`text-[11px] px-2 py-1.5 rounded ${
                      hasPermission(perm)
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
                        : 'bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {hasPermission(perm) ? '✓' : '✗'} {perm}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
