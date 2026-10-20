import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';

export default function ResourceAssignmentPage() {
  const auth = useAuth();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }
  
  const [events, setEvents] = useState([]);
  const [staff, setStaff] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignForm, setAssignForm] = useState({
    staff_id: '',
    from_event_id: '',
    to_event_id: '',
    role_key: ''
  });

  useEffect(() => {
    loadEvents();
    loadStaff();
    loadAssignments();
  }, []);

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadStaff = async () => {
    try {
      const data = await api.getUsers();
      setStaff(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadAssignments = async () => {
    try {
      const data = await api.get('/resource-assignments');
      setAssignments(data || []);
    } catch (err) {
      console.error('Failed to load assignments:', err);
    }
  };

  const handleAssign = async (e) => {
    e.preventDefault();
    try {
      await api.post('/resource-assignments', assignForm);
      toast.success('Staff assigned to event');
      setShowAssignModal(false);
      setAssignForm({ staff_id: '', from_event_id: '', to_event_id: '', role_key: '' });
      loadAssignments();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRevoke = async (id) => {
    if (!confirm('Revoke this assignment?')) return;
    try {
      await api.delete(`/resource-assignments/${id}`);
      toast.success('Assignment revoked');
      loadAssignments();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Resource Assignment</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Cross-event staff allocation
          </p>
        </div>
        <button onClick={() => setShowAssignModal(true)} className="btn btn-primary btn-sm">
          Assign Staff
        </button>
      </div>

      {assignments.length === 0 ? (
        <EmptyState
          title="No assignments"
          message="Assign staff to events across your portfolio"
        />
      ) : (
        <div className="space-y-2">
          {assignments.map((a) => (
            <div key={a.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[15px]">{a.staff_name}</div>
                <div className="text-[12px] text-[var(--color-text-secondary)]">
                  {a.from_event} → {a.to_event}
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  Role: {a.role_key}
                </div>
              </div>
              <button
                onClick={() => handleRevoke(a.id)}
                className="p-2 rounded hover:bg-red-50 text-red-500 shrink-0"
                title="Revoke assignment"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6a1 1 0 001 1v6a1 1 0 001 1v-6a1 1 0 001-1v-6a1 1 0 00-1-1H3a1 1 0 01-1-1v-6a1 1 0 011-1v6a1 1 0 001 1v-6a1 1 0 001-1H3a1 1 0 01-1-1v-6a1 1 0 011-1v-6a1 1 0 001-1v6a1 1 0 001 1v-6a1 1 0 001-1H3" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {showAssignModal && (
        <Modal onClose={() => setShowAssignModal(false)} title="Assign Staff to Event">
          <form onSubmit={handleAssign} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Staff Member</label>
              <select
                value={assignForm.staff_id}
                onChange={(e) => setAssignForm({ ...assignForm, staff_id: e.target.value })}
                className="input-field"
                required
              >
                <option value="">Select staff...</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">From Event</label>
              <select
                value={assignForm.from_event_id}
                onChange={(e) => setAssignForm({ ...assignForm, from_event_id: e.target.value })}
                className="input-field"
                required
              >
                <option value="">Select source event...</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Event</label>
              <select
                value={assignForm.to_event_id}
                onChange={(e) => setAssignForm({ ...assignForm, to_event_id: e.target.value })}
                className="input-field"
                required
              >
                <option value="">Select target event...</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>{e.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Role</label>
              <select
                value={assignForm.role_key}
                onChange={(e) => setAssignForm({ ...assignForm, role_key: e.target.value })}
                className="input-field"
                required
              >
                <option value="">Select role...</option>
                <option value="event_owner">Event Owner</option>
                <option value="event_manager">Event Manager</option>
                <option value="checkin_staff">Check-in Staff</option>
                <option value="security">Security</option>
                <option value="usher">Usher</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowAssignModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Assign
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
