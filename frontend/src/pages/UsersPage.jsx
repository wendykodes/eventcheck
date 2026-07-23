import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ name: '', pin: '', role: 'staff', event_ids: [] });
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({ name: '', phone: '', email: '', event_id: '', activity_ids: [], role: 'staff' });
  const [inviteResult, setInviteResult] = useState(null);
  const [eventsForInvite, setEventsForInvite] = useState([]);
  const [activitiesForInvite, setActivitiesForInvite] = useState([]);
  const [inviteLoading, setInviteLoading] = useState(false);

  const load = async () => {
    try {
      const [u, e] = await Promise.all([api.getUsers(), api.getEvents()]);
      setUsers(u);
      setEvents(e);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (showForm) {
      api.getEvents().then(setEvents).catch(() => {});
    }
  }, [showForm]);

  useEffect(() => {
    if (showInvite) {
      api.getEvents().then(setEventsForInvite).catch(() => {});
    }
  }, [showInvite]);

  useEffect(() => {
    if (inviteForm.event_id) {
      api.getActivities(inviteForm.event_id).then(setActivitiesForInvite).catch(() => setActivitiesForInvite([]));
    } else {
      setActivitiesForInvite([]);
    }
  }, [inviteForm.event_id]);

  const openCreate = () => {
    setEditTarget(null);
    setForm({ name: '', pin: '', role: 'staff', event_ids: [] });
    setShowForm(true);
  };

  const openEdit = (u) => {
    setEditTarget(u);
    setForm({
      name: u.name,
      pin: '',
      role: u.role,
      event_ids: u.event_ids || [],
      status: u.status,
    });
    setShowForm(true);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');

    if (editTarget) {
      const payload = { name: form.name, role: form.role, event_ids: form.event_ids, status: form.status || 'active' };
      if (form.pin) {
        if (form.pin.length < 4 || form.pin.length > 6) return toast.error('PIN must be 4–6 digits');
        payload.pin = form.pin;
      }
      try {
        await api.updateUser(editTarget.id, payload);
        toast.success('Staff updated');
        setShowForm(false);
        load();
      } catch (err) {
        toast.error(err.message);
      }
    } else {
      if (!form.pin || form.pin.length < 4 || form.pin.length > 6) return toast.error('PIN must be 4–6 digits');
      try {
        await api.createUser(form);
        toast.success('Staff created');
        setShowForm(false);
        load();
      } catch (err) {
        toast.error(err.message);
      }
    }
  };

  const toggleStatus = async (u) => {
    const newStatus = u.status === 'active' ? 'inactive' : 'active';
    try {
      await api.updateUser(u.id, { status: newStatus });
      toast.success(`${u.name} ${newStatus === 'active' ? 'activated' : 'deactivated'}`);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteUser(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" removed`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleEvent = (eid) => {
    setForm(f => ({
      ...f,
      event_ids: f.event_ids.includes(eid) ? f.event_ids.filter(id => id !== eid) : [...f.event_ids, eid]
    }));
  };

  const openInvite = () => {
    setInviteForm({ name: '', phone: '', email: '', event_id: '', activity_ids: [], role: 'staff' });
    setInviteResult(null);
    setShowInvite(true);
  };

  const createInvitation = async () => {
    if (!inviteForm.name.trim()) return toast.error('Name is required');
    if (!inviteForm.event_id) return toast.error('Select an event');
    setInviteLoading(true);
    try {
      const res = await api.createInvitation({
        name: inviteForm.name.trim(),
        phone: inviteForm.phone.trim() || undefined,
        email: inviteForm.email.trim() || undefined,
        event_id: Number(inviteForm.event_id),
        activity_ids: inviteForm.activity_ids.length > 0 ? inviteForm.activity_ids.map(Number) : undefined,
        role: inviteForm.role,
      });
      setInviteResult(res);
      toast.success('Invitation created!');
    } catch (err) {
      toast.error(err.message);
    }
    setInviteLoading(false);
  };

  const toggleActivityForInvite = (aid) => {
    setInviteForm(f => ({
      ...f,
      activity_ids: f.activity_ids.includes(aid) ? f.activity_ids.filter(id => id !== aid) : [...f.activity_ids, aid]
    }));
  };

  if (loading) return <div className="pt-4 space-y-3">{Array.from({length:3}).map((_,i) => <SkeletonCard key={i} />)}</div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Staff</h1>
        <div className="flex gap-2">
          <button onClick={openInvite} className="btn btn-secondary btn-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            Invite
          </button>
          <button onClick={openCreate} className="btn btn-primary btn-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Staff
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto scroll-none">
        <Link to="/leaderboard" className="btn btn-secondary btn-sm shrink-0">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.023 6.023 0 01-2.77.896m0 0a6.023 6.023 0 01-2.77-.896" />
          </svg>
          Leaderboard
        </Link>
      </div>

      {showForm && (
        <form onSubmit={submit} className="card p-5 space-y-3.5 animate-scale-in">
          <h2 className="font-semibold text-[17px]">{editTarget ? 'Edit Staff' : 'New Staff'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Name" className="input-field" />
            <input value={form.pin} onChange={e => setForm(f => ({...f, pin: e.target.value}))} placeholder={editTarget ? 'New PIN (leave blank to keep)' : '4–6 digit PIN'} maxLength={6} type="password" className="input-field" />
          </div>
          <select value={form.role} onChange={e => setForm(f => ({...f, role: e.target.value}))} className="input-field">
            <option value="staff">Staff</option>
            <option value="admin">Admin</option>
            <option value="guest">Guest</option>
          </select>
          {editTarget && (
            <select value={form.status || 'active'} onChange={e => setForm(f => ({...f, status: e.target.value}))} className="input-field">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          )}
          {events.length > 0 && (
            <div>
              <label className="text-xs text-[var(--color-text-secondary)] font-semibold block mb-2">Assign to events:</label>
              <div className="flex flex-wrap gap-2">
                {events.map(e => (
                  <label key={e.id} className="flex items-center gap-1.5 text-sm cursor-pointer px-3 py-2 rounded-xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] transition-colors">
                    <input type="checkbox" checked={form.event_ids.includes(e.id)} onChange={() => toggleEvent(e.id)} className="accent-blue-500" />
                    {e.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">{editTarget ? 'Save Changes' : 'Create Staff'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      {users.length === 0 ? (
        <EmptyState title="No Staff" message="Create staff accounts so they can check in guests." />
      ) : (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl">
          {users.map((u, i) => (
            <div key={u.id} className="p-4 flex items-center justify-between animate-fade-in bg-[var(--color-surface)]" style={{animationDelay: `${i*40}ms`}}>
              <Link to={`/staff/${u.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-500 flex items-center justify-center text-[16px] font-bold shrink-0">
                  {u.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[15px]">{u.name}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      u.role === 'admin' ? 'badge-blue' : 'badge-gray'
                    }`}>{u.role}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${
                      u.status === 'active' ? 'badge-green' : 'badge-red'
                    }`}>{u.status}</span>
                  </div>
                  {u.last_activity && (
                    <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">
                      Last: {new Date(u.last_activity).toLocaleDateString()} {new Date(u.last_activity).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}
                    </p>
                  )}
                </div>
              </Link>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => openEdit(u)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]" title="Edit">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button onClick={() => toggleStatus(u)} className="btn btn-ghost btn-icon" title={u.status === 'active' ? 'Deactivate' : 'Activate'}>
                  {u.status === 'active' ? (
                    <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                    </svg>
                  )}
                </button>
                <button onClick={() => setDeleteTarget(u)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-red-500" title="Delete">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={!!deleteTarget} title="Remove Staff Member?" message={`Delete "${deleteTarget?.name}" and all their check-in records? This cannot be undone.`}
        variant="danger" confirmLabel="Remove" onConfirm={deleteUser} onCancel={() => setDeleteTarget(null)} />

      <Modal open={showInvite} title="" onCancel={() => { setShowInvite(false); setInviteResult(null); }}
        hideActions={true}
      >
        {inviteResult ? (
          <div className="space-y-5 animate-fade-in">
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-2xl p-5 text-center">
              <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-semibold text-[15px]">Invitation Created</p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">{inviteResult.event_name}</p>
            </div>
            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Share Link</label>
              <div className="flex gap-2">
                <input readOnly value={inviteResult.link} className="input-field text-xs flex-1" onClick={e => e.target.select()} />
                <button onClick={() => { navigator.clipboard.writeText(inviteResult.link); toast.success('Link copied!'); }}
                  className="btn btn-primary btn-sm shrink-0">Copy</button>
              </div>
            </div>
            <div className="flex gap-2">
              <a href={`https://wa.me/?text=${encodeURIComponent(`Join our event staff: ${inviteResult.link}`)}`} target="_blank" rel="noopener noreferrer"
                className="btn btn-secondary btn-sm flex-1">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                WhatsApp
              </a>
              <a href={`mailto:?subject=${encodeURIComponent('Join our event staff')}&body=${encodeURIComponent(`You're invited to join event staff: ${inviteResult.link}`)}`}
                className="btn btn-secondary btn-sm flex-1">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
                Email
              </a>
            </div>
            <p className="text-xs text-[var(--color-text-secondary)] text-center">
              Invitation expires {new Date(inviteResult.expires_at).toLocaleDateString()}
            </p>
            <button onClick={() => { setShowInvite(false); setInviteResult(null); }} className="btn btn-secondary w-full">Done</button>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="text-center">
              <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </div>
              <h3 className="text-[17px] font-semibold">Invite Staff</h3>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1">Send an invitation link to join the team</p>
            </div>

            <div className="divider" />

            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Full Name *</label>
              <input value={inviteForm.name} onChange={e => setInviteForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Jane Smith" className="input-field" autoFocus />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Phone</label>
                <input value={inviteForm.phone} onChange={e => setInviteForm(f => ({...f, phone: e.target.value}))} placeholder="555-0123" className="input-field" />
              </div>
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Email</label>
                <input value={inviteForm.email} onChange={e => setInviteForm(f => ({...f, email: e.target.value}))} placeholder="jane@example.com" type="email" className="input-field" />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Role</label>
              <select value={inviteForm.role} onChange={e => setInviteForm(f => ({...f, role: e.target.value}))} className="input-field">
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-1.5">Event *</label>
              <select value={inviteForm.event_id} onChange={e => setInviteForm(f => ({...f, event_id: e.target.value, activity_ids: []}))} className="input-field">
                <option value="">Select an event</option>
                {eventsForInvite.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>

            {activitiesForInvite.length > 0 && (
              <div>
                <label className="text-xs font-semibold text-[var(--color-text-secondary)] block mb-2">Assign activities (optional)</label>
                <div className="grid grid-cols-2 gap-2">
                  {activitiesForInvite.map(a => (
                    <label key={a.id} className="flex items-center gap-2.5 text-sm cursor-pointer px-3.5 py-2.5 rounded-xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] transition-colors has-[:checked]:bg-blue-50 has-[:checked]:text-blue-600 dark:has-[:checked]:bg-blue-900/20 dark:has-[:checked]:text-blue-400 has-[:checked]:ring-1 has-[:checked]:ring-blue-500/30">
                      <input type="checkbox" checked={inviteForm.activity_ids.includes(a.id)} onChange={() => toggleActivityForInvite(a.id)} className="accent-blue-500" />
                      {a.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <button onClick={createInvitation} disabled={inviteLoading || !inviteForm.name.trim() || !inviteForm.event_id}
              className="btn btn-primary w-full">{inviteLoading ? 'Creating...' : 'Create Invitation'}</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
