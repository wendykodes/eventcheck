import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

const ONBOARDING_LABELS = {
  approval: 'Self-Register with Approval',
  auto_approve: 'Self-Register with Auto-Approval',
  invitation_only: 'Invitation Only',
  manual_only: 'Manual Only',
};

export default function EventsPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ name: '', date: '', venue: '', description: '', status: 'upcoming' });
  const [errors, setErrors] = useState({});
  const [codeModal, setCodeModal] = useState(null);
  const [newCode, setNewCode] = useState('');
  const [onboardingModal, setOnboardingModal] = useState(null);
  const [onboardingMethod, setOnboardingMethod] = useState('approval');
  const [menuOpen, setMenuOpen] = useState(null);
  const menuRef = useRef(null);

  const load = async () => {
    try {
      const evts = await api.getEvents();
      const withCodes = await Promise.all(evts.map(async (e) => {
        try {
          const [codeRes, onboardingRes] = await Promise.all([
            api.getEventAccessCode(e.id),
            api.getOnboardingSettings(e.id).catch(() => ({ onboarding_method: 'approval' }))
          ]);
          return { ...e, access_code: codeRes.access_code, onboarding_method: onboardingRes.onboarding_method };
        } catch { return { ...e, access_code: null, onboarding_method: 'approval' }; }
      }));
      setEvents(withCodes);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const generateCode = async (event) => {
    try {
      const res = await api.setEventAccessCode(event.id, newCode || undefined);
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, access_code: res.access_code } : e));
      setCodeModal(null);
      setNewCode('');
      const code = res.access_code;
      try { await navigator.clipboard.writeText(code); toast.success(`Code: ${code} (copied!)`); }
      catch { toast.success(`Code: ${code}`); }
    } catch (err) { toast.error(err.message); }
  };

  const removeCode = async (event) => {
    try {
      await api.deleteEventAccessCode(event.id);
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, access_code: null } : e));
      toast.success('Access code removed');
    } catch (err) { toast.error(err.message); }
  };

  const updateOnboarding = async () => {
    if (!onboardingModal) return;
    try {
      await api.setOnboardingSettings(onboardingModal.id, onboardingMethod);
      setEvents(prev => prev.map(e => e.id === onboardingModal.id ? { ...e, onboarding_method: onboardingMethod } : e));
      toast.success('Onboarding setting updated');
      setOnboardingModal(null);
    } catch (err) { toast.error(err.message); }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Event name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const createEvent = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      await api.createEvent(form);
      toast.success('Event created');
      setShowForm(false);
      setForm({ name: '', date: '', venue: '', description: '', status: 'upcoming' });
      setErrors({});
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteEvent = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteEvent(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="space-y-3 pt-4">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} lines={2} />)}</div>;

  const statusBadge = {
    upcoming: 'badge badge-orange',
    active: 'badge badge-green',
    completed: 'badge badge-gray',
  };

  const methodBadge = {
    approval: 'badge badge-orange',
    auto_approve: 'badge badge-green',
    invitation_only: 'badge badge-primary',
    manual_only: 'badge badge-gray',
  };

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-[26px] font-bold tracking-tight">Events</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Event
        </button>
      </div>

      {showForm && (
        <form onSubmit={createEvent} className="card p-5 space-y-3.5 animate-scale-in bg-[var(--color-surface)]">
          <div>
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Event name *"
              className={`input-field ${errors.name ? 'input-error' : ''}`} />
            {errors.name && <p className="text-xs text-red-500 mt-1.5 ml-1">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input type="date" value={form.date} onChange={e => setForm(f => ({...f, date: e.target.value}))} className="input-field" />
            <input value={form.venue} onChange={e => setForm(f => ({...f, venue: e.target.value}))} placeholder="Venue" className="input-field" />
          </div>
          <textarea value={form.description} onChange={e => setForm(f => ({...f, description: e.target.value}))} placeholder="Description" rows={2} className="input-field resize-none" />
          <div className="flex gap-2">
            <select value={form.status} onChange={e => setForm(f => ({...f, status: e.target.value}))} className="input-field w-auto">
              <option value="upcoming">Upcoming</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
            <button type="submit" className="btn btn-primary">Create Event</button>
          </div>
        </form>
      )}

      {events.length === 0 ? (
        <EmptyState
          title="No Events"
          message="Create your first event to start managing guest check-ins."
          action={<button onClick={() => setShowForm(true)} className="btn btn-primary">+ Create Event</button>}
        />
      ) : (
        <div className="space-y-3">
          {events.map((event, i) => (
            <div
              key={event.id}
              className={`card p-5 animate-slide-up stagger-${Math.min(i+1,6)}`}
              style={{ position: 'relative', zIndex: menuOpen === event.id ? 50 : 1 }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1">
                    <h3 className="font-bold text-[17px] tracking-tight">{event.name}</h3>
                    <span className={statusBadge[event.status] || statusBadge.upcoming}>{event.status}</span>
                    <span className={methodBadge[event.onboarding_method] || methodBadge.approval}>{
                      ONBOARDING_LABELS[event.onboarding_method] || 'Approval'
                    }</span>
                  </div>
                  {event.date && (
                    <p className="text-[13px] text-[var(--color-text-secondary)] flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                      </svg>
                      {event.date}{event.venue ? ` · ${event.venue}` : ''}
                    </p>
                  )}
                  {event.description && <p className="text-[13px] text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">{event.description}</p>}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[12px] text-[var(--color-text-secondary)]">Staff Code:</span>
                    {event.access_code ? (
                      <>
                        <code className="text-[12px] font-mono font-bold bg-[var(--color-surface-hover)] px-2 py-0.5 rounded-md tracking-wider">{event.access_code}</code>
                        <button onClick={() => { try { navigator.clipboard.writeText(event.access_code); toast.success('Copied!'); } catch {} }} className="btn btn-ghost btn-icon p-1" title="Copy code">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                          </svg>
                        </button>
                        <button onClick={() => setCodeModal(event)} className="btn btn-ghost btn-icon p-1" title="Regenerate code">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                          </svg>
                        </button>
                        <button onClick={() => removeCode(event)} className="btn btn-ghost btn-icon p-1 text-red-400" title="Remove code">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setCodeModal(event)} className="text-[12px] text-primary-500 hover:underline font-medium">Generate Code</button>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-4">
                <button onClick={() => navigate(`/events/${event.id}`)} className="btn btn-primary btn-sm">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                  </svg>
                  Dashboard
                </button>
                <div className="relative" ref={menuRef}>
                  <button onClick={() => setMenuOpen(menuOpen === event.id ? null : event.id)}
                    className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                    </svg>
                  </button>
                  {menuOpen === event.id && (
                    <div className="absolute right-0 top-full mt-1 w-48 bg-[var(--color-surface)] rounded-2xl shadow-xl shadow-black/10 dark:shadow-black/30 ring-1 ring-[var(--color-border)] py-1.5 z-50 animate-scale-in origin-top-right">
                      <button onClick={() => { navigate(`/events/${event.id}/guests`); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                        </svg>
                        Guests
                      </button>
                      <button onClick={() => { navigate(`/events/${event.id}/activities`); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25z" />
                        </svg>
                        Activities
                      </button>
                      <button onClick={() => { setOnboardingModal(event); setOnboardingMethod(event.onboarding_method || 'approval'); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Onboarding
                      </button>
                      <div className="h-px bg-[var(--color-border)] mx-3 my-1" />
                      <button onClick={() => { navigate(`/events/${event.id}/import`); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                        Import Guests
                      </button>
                      <button onClick={() => { navigate(`/events/${event.id}/import/history`); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-hover)] transition-colors">
                        <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Import History
                      </button>
                      <div className="h-px bg-[var(--color-border)] mx-3 my-1" />
                      <button onClick={() => { setDeleteTarget(event); setMenuOpen(null); }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-500 hover:bg-red-500/5 transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                        Delete Event
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!codeModal} title={codeModal?.access_code ? 'Regenerate Access Code' : 'Generate Access Code'}
        message={
          codeModal?.access_code
            ? `Current code: ${codeModal.access_code}. Generate a new one?`
            : 'Create a staff access code for this event. Staff will use this code to register.'
        }
        confirmLabel={codeModal?.access_code ? 'Regenerate' : 'Generate'}
        onConfirm={() => codeModal && generateCode(codeModal)}
        onCancel={() => { setCodeModal(null); setNewCode(''); }}
      >
        <input value={newCode} onChange={e => setNewCode(e.target.value.toUpperCase())}
          placeholder="Custom code or leave blank for random"
          className="input mt-3" autoFocus />
      </Modal>

      <Modal open={!!onboardingModal} title="Staff Onboarding Method"
        message="Choose how staff members can join this event."
        confirmLabel="Save" onConfirm={updateOnboarding}
        onCancel={() => setOnboardingModal(null)}
      >
        <select value={onboardingMethod} onChange={e => setOnboardingMethod(e.target.value)}
          className="input mt-3">
          <option value="approval">Self-Register with Approval</option>
          <option value="auto_approve">Self-Register with Auto-Approval</option>
          <option value="invitation_only">Invitation Only</option>
          <option value="manual_only">Manual Creation Only</option>
        </select>
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
          {onboardingMethod === 'approval' && 'Staff register with an access code, then an admin must approve their request.'}
          {onboardingMethod === 'auto_approve' && 'Staff register with an access code and are automatically approved.'}
          {onboardingMethod === 'invitation_only' && 'Staff can only join via invitation link. Access code registration is disabled.'}
          {onboardingMethod === 'manual_only' && 'Staff accounts must be created manually by an admin.'}
        </p>
      </Modal>

      <Modal open={!!deleteTarget} title="Delete Event?" message={`Permanently delete "${deleteTarget?.name}" and all associated data?`}
        variant="danger" confirmLabel="Delete Event" onConfirm={deleteEvent} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
