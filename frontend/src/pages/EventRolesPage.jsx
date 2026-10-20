import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

const ROLE_LABELS = {
  event_owner: 'Event Owner',
  event_manager: 'Event Manager',
  raas_operator: 'Helper',
  checkin_staff: 'Check-in Team',
  security: 'Security',
  usher: 'Guide',
  waiter: 'Waiter',
  kitchen: 'Kitchen',
  bar: 'Bar',
  driver: 'Driver',
  transport_coordinator: 'Transport Coordinator',
  sound: 'Sound',
  performer: 'Performer',
  photographer: 'Photographer',
  vendor: 'Vendor',
  speaker: 'Speaker',
  vip_coordinator: 'VIP Coordinator',
};

const ROLE_DESCRIPTIONS = {
  event_owner: 'Full control over event configuration and operations',
  event_manager: 'Manage event operations, guests, staff, and workflows',
  raas_operator: 'Professional operations support and advanced management',
  checkin_staff: 'Manage guest check-in and entrance operations',
  security: 'Handle security incidents and access control',
  usher: 'Guide guests to seats and provide assistance',
  waiter: 'Serve food and beverages to guests',
  kitchen: 'Manage food preparation and service',
  bar: 'Manage beverage service',
  driver: 'Handle transportation logistics',
  transport_coordinator: 'Coordinate transportation operations',
  sound: 'Manage audio and equipment',
  performer: 'Event performer or entertainer',
  photographer: 'Capture event photos and media',
  vendor: 'External service provider',
  speaker: 'Event speaker or presenter',
  vip_coordinator: 'Assist VIP guests with special needs',
};

export default function EventRolesPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  const [event, setEvent] = useState(null);
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({ user_id: '', role_key: '', zone: '' });
  const [errors, setErrors] = useState({});

  const loadEvent = async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadRoles = async () => {
    try {
      const data = await api.get(`/events/${eventId}/roles`);
      setRoles(data || []);
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

  useEffect(() => {
    loadEvent();
    loadRoles();
    loadUsers();
  }, [eventId]);

  const handleAssignRole = async (e) => {
    e.preventDefault();
    const errs = {};
    if (!assignForm.user_id) errs.user_id = 'User is required';
    if (!assignForm.role_key) errs.role_key = 'Role is required';
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    try {
      const result = await api.post(`/events/${eventId}/roles`, assignForm);
      toast.success('Role assigned');
      setShowAssignModal(false);
      setAssignForm({ user_id: '', role_key: '', zone: '' });
      setErrors({});
      loadRoles();
      if (result.warnings && result.warnings.length > 0) {
        toast.warning(`Warning: User is also assigned to ${result.warnings.length} other event(s) on the same date`);
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRevokeRole = async (roleId) => {
    if (!confirm('Revoke this role assignment?')) return;
    try {
      await api.delete(`/events/${eventId}/roles/${roleId}`);
      toast.success('Role revoked');
      loadRoles();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const unassignedUsers = users.filter(u => !roles.some(r => r.user_id === u.id));

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Event Roles</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {event?.name || 'Event'} · {roles.length} role{roles.length === 1 ? '' : 's'} assigned
          </p>
        </div>
        <button onClick={() => setShowAssignModal(true)} className="btn btn-primary btn-sm">
          Assign Role
        </button>
      </div>

      <EventTabs currentKey="roles" adminOnly={true} />

      {roles.length === 0 ? (
        <EmptyState
          title="No roles assigned"
          message="Assign staff to roles to manage this event"
        />
      ) : (
        <div className="space-y-2.5">
          {roles.map((r) => (
            <div key={r.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-[15px]">{r.user_name}</span>
                  {r.zone && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                      Zone: {r.zone}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  {ROLE_LABELS[r.role_key] || r.role_key}
                </p>
              </div>
              <button
                onClick={() => handleRevokeRole(r.id)}
                className="p-2 rounded hover:bg-red-50 text-red-500 shrink-0"
                title="Revoke role"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6a1 1 0 001 1h3a1 1 0 001 1v6a1 1 0 001 1h3a1 1 0 001 1v-6a1 1 0 00-1-1h-3a1 1 0 01-1-1v-6a1 1 0 011-1v6a1 1 0 001 1h3a1 1 0 001 1v-6a1 1 0 001-1H3a1 1 0 01-1-1v-6a1 1 0 001 1v6a1 1 0 001 1H3a1 1 0 001 1v-6a1 1 0 001-1h-3a1 1 0 01-1-1v-6a1 1 0 001-1H3a1 1 0 01-1-1v-6a1 1 0 01-1-1H3a1 1 0 001 1v-6a1 1 0 011-1-2.25V6a1 1 0 011.5-1.5h9A1.5 1.5 0 0121 6v.75a1.5 1.5 0 011.5 1.5h1.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 011.5-1.5H3" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Assign Role Modal */}
      {showAssignModal && (
        <Modal onClose={() => setShowAssignModal(false)} title="Assign Role">
          <form onSubmit={handleAssignRole} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">User</label>
              <select
                value={assignForm.user_id}
                onChange={(e) => setAssignForm({ ...assignForm, user_id: e.target.value })}
                className="input-field"
              >
                <option value="">Select user...</option>
                {unassignedUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              {errors.user_id && <p className="text-xs text-red-500 mt-1">{errors.user_id}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select
                value={assignForm.role_key}
                onChange={(e) => setAssignForm({ ...assignForm, role_key: e.target.value })}
                className="input-field"
              >
                <option value="">Select role...</option>
                {Object.entries(ROLE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              {errors.role_key && <p className="text-xs text-red-500 mt-1">{errors.role_key}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zone (optional)</label>
              <input
                type="text"
                value={assignForm.zone}
                onChange={(e) => setAssignForm({ ...assignForm, zone: e.target.value })}
                placeholder="e.g., Entrance A, Main Hall"
                className="input-field"
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                Zone limits this role's permissions to a specific area
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAssignModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Assign Role
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
