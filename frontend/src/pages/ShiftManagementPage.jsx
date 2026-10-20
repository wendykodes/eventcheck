import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function ShiftManagementPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  const [shifts, setShifts] = useState([]);
  const [onDuty, setOnDuty] = useState([]);
  const [mySession, setMySession] = useState(null);
  const [overtime, setOvertime] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    user_id: '',
    shift_type: 'morning',
    scheduled_start: '',
    scheduled_end: '',
    zone: '',
    notes: ''
  });
  const [users, setUsers] = useState([]);

  useEffect(() => {
    loadShifts();
    loadOnDuty();
    loadMySession();
    loadUsers();
    loadTemplates();
  }, [eventId]);

  const loadShifts = async () => {
    try {
      const data = await api.getShifts(eventId);
      setShifts(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadOnDuty = async () => {
    try {
      const data = await api.getOnDuty(eventId);
      setOnDuty(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadMySession = async () => {
    try {
      const data = await api.getMySession();
      setMySession(data);
      if (data) {
        loadOvertime(data.shift_id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadOvertime = async (shiftId) => {
    try {
      const data = await api.getShiftOvertime(shiftId);
      setOvertime(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await api.getUsers();
      setUsers(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await api.getShiftTemplates();
      setTemplates(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateShift = async (e) => {
    e.preventDefault();
    try {
      await api.createShift({ ...createForm, event_id: Number(eventId) });
      toast.success('Shift created');
      setShowCreateModal(false);
      setCreateForm({
        user_id: '',
        shift_type: 'morning',
        scheduled_start: '',
        scheduled_end: '',
        zone: '',
        notes: ''
      });
      loadShifts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleClockIn = async (shiftId) => {
    try {
      await api.clockIn(shiftId);
      toast.success('Clocked in');
      loadMySession();
      loadOnDuty();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleClockOut = async (shiftId) => {
    try {
      await api.clockOut(shiftId);
      toast.success('Clocked out');
      loadMySession();
      loadOnDuty();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleBreakStart = async (shiftId) => {
    try {
      await api.breakStart(shiftId);
      toast.success('Break started');
      loadMySession();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleBreakEnd = async (shiftId) => {
    try {
      await api.breakEnd(shiftId);
      toast.success('Break ended');
      loadMySession();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Shift Management</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {onDuty.length} staff on duty
          </p>
        </div>
        {auth.user?.role === 'admin' && (
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
            Create Shift
          </button>
        )}
      </div>

      <EventTabs currentKey="shifts" adminOnly={true} />

      {/* My Session */}
      {mySession && (
        <div className="card p-4 border-green-200 dark:border-green-900/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-sm">You are currently on duty</p>
              <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                Clocked in at {new Date(mySession.clocked_in_at).toLocaleTimeString()}
                {mySession.break_start && !mySession.break_end && ' · On break'}
              </p>
              {overtime && overtime.overtime_hours > 0 && (
                <p className="text-xs text-amber-600 mt-1">⚠️ Overtime: {overtime.overtime_hours.toFixed(1)}h</p>
              )}
            </div>
            <div className="flex gap-2">
              {mySession.break_start && !mySession.break_end ? (
                <button onClick={() => handleBreakEnd(mySession.shift_id)} className="btn btn-secondary btn-sm">
                  End Break
                </button>
              ) : (
                <button onClick={() => handleBreakStart(mySession.shift_id)} className="btn btn-secondary btn-sm">
                  Start Break
                </button>
              )}
              <button onClick={() => handleClockOut(mySession.shift_id)} className="btn btn-success btn-sm">
                Clock Out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* On-Duty Staff */}
      {onDuty.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1">On-Duty Staff</h2>
          <div className="card-flat divide-y divide-[var(--color-border)] rounded-2xl overflow-hidden">
            {onDuty.map((s, i) => (
              <div key={i} className="p-3.5 flex items-center justify-between bg-[var(--color-surface)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-green-50 dark:bg-green-900/20 text-green-500 flex items-center justify-center text-sm font-bold">
                    {s.user_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-medium text-[14px]">{s.user_name}</p>
                    <p className="text-[11px] text-[var(--color-text-secondary)] capitalize">{s.shift_type} shift</p>
                  </div>
                </div>
                {s.zone && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                    {s.zone}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Scheduled Shifts */}
      <div>
        <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1">Scheduled Shifts</h2>
        {shifts.length === 0 ? (
          <EmptyState title="No shifts scheduled" message="Create shifts to manage staff schedules." />
        ) : (
          <div className="space-y-2">
            {shifts.map((s, i) => (
              <div key={s.id} className="card p-4 flex items-center justify-between animate-slide-up" style={{animationDelay: `${i*50}ms`}}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[15px]">{s.user_name}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-500 capitalize">
                      {s.shift_type}
                    </span>
                    {s.active_sessions > 0 && (
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-500">
                        On Duty
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)]">
                    {new Date(s.scheduled_start).toLocaleString()} - {new Date(s.scheduled_end).toLocaleString()}
                  </p>
                  {s.zone && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">Zone: {s.zone}</p>
                  )}
                </div>
                {!mySession && s.user_id === auth.user?.id && (
                  <button onClick={() => handleClockIn(s.id)} className="btn btn-primary btn-sm shrink-0">
                    Clock In
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Shift Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create Shift">
          <form onSubmit={handleCreateShift} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Staff Member</label>
              <select
                value={createForm.user_id}
                onChange={e => setCreateForm({...createForm, user_id: e.target.value})}
                className="input-field"
                required
              >
                <option value="">Select staff...</option>
                {users.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Shift Type</label>
              <select
                value={createForm.shift_type}
                onChange={e => setCreateForm({...createForm, shift_type: e.target.value})}
                className="input-field"
              >
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
                <option value="night">Night</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Start Time</label>
                <input
                  type="datetime-local"
                  value={createForm.scheduled_start ? new Date(createForm.scheduled_start).toISOString().slice(0, 16) : ''}
                  onChange={e => setCreateForm({...createForm, scheduled_start: e.target.value})}
                  className="input-field"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">End Time</label>
                <input
                  type="datetime-local"
                  value={createForm.scheduled_end ? new Date(createForm.scheduled_end).toISOString().slice(0, 16) : ''}
                  onChange={e => setCreateForm({...createForm, scheduled_end: e.target.value})}
                  className="input-field"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zone (optional)</label>
              <input
                type="text"
                value={createForm.zone}
                onChange={e => setCreateForm({...createForm, zone: e.target.value})}
                className="input-field"
                placeholder="e.g., Main Hall, Entrance"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes (optional)</label>
              <textarea
                value={createForm.notes}
                onChange={e => setCreateForm({...createForm, notes: e.target.value})}
                className="input-field"
                rows={2}
                placeholder="Special instructions..."
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Create Shift</button>
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
