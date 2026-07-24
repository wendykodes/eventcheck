import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonTable, SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';

export default function GuestListPage() {
  const { user, isAdmin } = useAuth();
  const { eventId } = useParams();
  const [guests, setGuests] = useState([]);
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', table_number: '', guest_count: 1, category: '', notes: '' });
  const [errors, setErrors] = useState({});
  const [showPending, setShowPending] = useState(false);
  const [pendingGuests, setPendingGuests] = useState([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const [selected, setSelected] = useState(new Set());
  const [bulkAction, setBulkAction] = useState('');
  const [bulkValue, setBulkValue] = useState('');
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [selectAll, setSelectAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, a] = await Promise.all([api.getGuests(eventId), api.getActivities(eventId)]);
      setGuests(g);
      setActivities(a);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const loadPending = useCallback(async () => {
    if (!isAdmin) return;
    setPendingLoading(true);
    try {
      const [g, c] = await Promise.all([api.getPendingGuests(eventId), api.getPendingGuestCount(eventId)]);
      setPendingGuests(g);
      setPendingCount(c.count);
    } catch {} finally { setPendingLoading(false); }
  }, [eventId, isAdmin]);

  useEffect(() => { loadPending(); }, [loadPending]);

  const filtered = query
    ? guests.filter(g => g.name.toLowerCase().includes(query.toLowerCase()) || g.phone.includes(query))
    : guests;

  const displayActivities = activities.slice(0, 5);

  const validate = () => {
    const e = {};
    if (!form.name.trim()) e.name = 'Required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const createGuest = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      const res = await api.createGuest({ ...form, event_id: Number(eventId), guest_count: Number(form.guest_count) });
      if (res.status === 'pending') {
        toast.success('Guest submitted for admin approval');
      } else {
        toast.success('Guest added');
      }
      setForm({ name: '', phone: '', email: '', table_number: '', guest_count: 1, category: '', notes: '' });
      setErrors({});
      setShowForm(false);
      load();
      loadPending();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const approvePending = async (id) => {
    try {
      await api.approveGuest(id);
      toast.success('Guest approved');
      loadPending();
      load();
    } catch (err) { toast.error(err.message); }
  };

  const rejectPending = async (id) => {
    try {
      await api.rejectGuest(id);
      toast.success('Guest rejected');
      loadPending();
    } catch (err) { toast.error(err.message); }
  };

  const deleteGuest = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteGuest(deleteTarget.id);
      toast.success('Guest deleted');
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAll(false);
  };

  const toggleSelectAll = () => {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      setSelected(new Set(filtered.map(g => g.id)));
      setSelectAll(true);
    }
  };

  const doBulk = async () => {
    if (selected.size === 0) return;
    setShowBulkModal(false);
    try {
      const res = await api.bulkGuests(Number(eventId), Array.from(selected), bulkAction, bulkValue);
      toast.success(`${res.affected} guest(s) updated`);
      setSelected(new Set());
      setBulkValue('');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doBulkDelete = () => {
    setBulkAction('delete');
    setShowBulkModal(true);
  };

  if (loading) return <div className="pt-4"><SkeletonTable rows={6} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2 px-1">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Guests</h1>
          <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)] hover:text-blue-500 transition-colors">← Dashboard</Link>
        </div>
        <div className="flex gap-2">
          <Link to={`/events/${eventId}/import`} className="btn btn-secondary btn-sm">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            Import
          </Link>
          <Link to={`/events/${eventId}/import/history`} className="btn btn-ghost btn-sm text-[var(--color-text-secondary)]">
            History
          </Link>
          <button onClick={() => { setShowForm(!showForm); }} className="btn btn-primary btn-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={createGuest} className="card p-5 space-y-3.5 animate-scale-in">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} placeholder="Full name *" className={`input-field ${errors.name ? 'input-error' : ''}`} />
              {errors.name && <p className="text-xs text-red-500 mt-1 ml-1">{errors.name}</p>}
            </div>
            <div>
              <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} placeholder="Phone" className="input-field" />
            </div>
            <input value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} placeholder="Email" className="input-field" />
            <input value={form.table_number} onChange={e => setForm(f => ({...f, table_number: e.target.value}))} placeholder="Table" className="input-field" />
            <input type="number" min="1" value={form.guest_count} onChange={e => setForm(f => ({...f, guest_count: e.target.value}))} className="input-field" placeholder="Count" />
            <input value={form.category} onChange={e => setForm(f => ({...f, category: e.target.value}))} placeholder="Category" className="input-field" />
          </div>
          <textarea value={form.notes} onChange={e => setForm(f => ({...f, notes: e.target.value}))} placeholder="Notes" rows={2} className="input-field resize-none" />
          <button type="submit" className="btn btn-primary">{isAdmin ? 'Add Guest' : 'Suggest Guest'}</button>
        </form>
      )}

      <div className="relative">
        <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search guests…" className="search-field pl-10" />
        {query && <button onClick={() => setQuery('')} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] p-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>}
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-1 py-2 bg-blue-500/10 rounded-xl animate-scale-in">
          <span className="text-sm font-medium text-blue-500">{selected.size} selected</span>
          <div className="flex-1" />
          <select value={bulkAction} onChange={e => { setBulkAction(e.target.value); setBulkValue(''); if (e.target.value !== 'delete') setShowBulkModal(true); }}
            className="input input-sm text-xs max-w-[140px]">
            <option value="">Bulk action…</option>
            <option value="assign_category">Set Category</option>
            <option value="assign_table">Set Table</option>
            <option value="update_guest_count">Set Count</option>
            <option value="update_notes">Set Notes</option>
            <option value="delete">Delete</option>
          </select>
          <button onClick={() => { setSelected(new Set()); setSelectAll(false); }} className="btn btn-ghost btn-icon text-xs text-[var(--color-text-secondary)]">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {isAdmin && pendingCount > 0 && !showPending && (
        <button onClick={() => setShowPending(true)}
          className="w-full flex items-center gap-3 p-3.5 rounded-xl bg-amber-50 dark:bg-amber-900/15 border border-amber-200 dark:border-amber-800/30 text-left hover:bg-amber-100 dark:hover:bg-amber-900/25 transition-colors animate-fade-in"
        >
          <div className="w-9 h-9 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-semibold text-[15px]">{pendingCount} pending approval</p>
            <p className="text-sm text-[var(--color-text-secondary)]">Staff-suggested guests waiting for review</p>
          </div>
          <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
          </svg>
        </button>
      )}

      {showPending && (
        <div className="animate-scale-in">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-[17px]">Pending Approval</h2>
            <button onClick={() => setShowPending(false)} className="btn btn-ghost btn-sm text-[var(--color-text-secondary)]">Approved Guests</button>
          </div>
          {pendingLoading ? (
            <div className="space-y-2"><SkeletonCard lines={2} /><SkeletonCard lines={2} /></div>
          ) : pendingGuests.length === 0 ? (
            <EmptyState title="No Pending Guests" message="All guests have been reviewed." />
          ) : (
            <div className="space-y-2.5">
              {pendingGuests.map((g, i) => (
                <div key={g.id} className="card p-4 animate-slide-up flex items-center gap-3" style={{animationDelay: `${i*40}ms`}}>
                  <div className="w-10 h-10 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-500 flex items-center justify-center text-[16px] font-bold shrink-0">
                    {g.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[15px]">{g.name}</p>
                    <p className="text-sm text-[var(--color-text-secondary)]">{g.phone}{g.email ? ` · ${g.email}` : ''}</p>
                    {g.table_number && <p className="text-xs text-[var(--color-text-secondary)]">Table {g.table_number} · {g.guest_count} guest(s)</p>}
                    {g.submitted_by_name && <p className="text-xs text-amber-500">Submitted by {g.submitted_by_name}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => rejectPending(g.id)} className="btn btn-ghost btn-sm text-red-500">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <button onClick={() => approvePending(g.id)} className="btn btn-primary btn-sm">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                      Approve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!showPending && (filtered.length === 0 ? (
        <EmptyState title="No Guests" message={query ? 'Try a different search' : 'Add your first guest to the list.'}
          action={!query ? <button onClick={() => setShowForm(true)} className="btn btn-primary">+ Add Guest</button> : null} />
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] font-semibold text-[var(--color-text-secondary)] bg-[var(--color-surface-hover)]">
                  <th className="py-3.5 pl-4 w-10">
                    <input type="checkbox" checked={selectAll && filtered.length > 0} onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-[var(--color-border)] accent-blue-500 cursor-pointer" />
                  </th>
                  <th className="py-3.5 px-2">Name</th>
                  <th className="py-3.5 px-2">Phone</th>
                  <th className="py-3.5 px-2 text-center">#</th>
                  <th className="py-3.5 px-2">Table</th>
                  {displayActivities.map(a => <th key={a.id} className="py-3.5 px-2 text-center text-[11px]">{a.name}</th>)}
                  <th className="py-3.5 px-2 w-14"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((guest, i) => (
                  <tr key={guest.id} className="hover:bg-[var(--color-surface-hover)] transition-colors animate-fade-in" style={{animationDelay: `${i*20}ms`}}>
                    <td className="py-3 pl-4">
                      <input type="checkbox" checked={selected.has(guest.id)} onChange={() => toggleSelect(guest.id)}
                        className="w-4 h-4 rounded border-[var(--color-border)] accent-blue-500 cursor-pointer" />
                    </td>
                    <td className="py-3 px-2">
                      <Link to={`/events/${eventId}/guests/${guest.id}`} className="font-semibold text-blue-500 hover:text-blue-600 transition-colors">
                        {guest.name}
                      </Link>
                    </td>
                    <td className="py-3 px-2 text-[var(--color-text-secondary)]">{guest.phone}</td>
                    <td className="py-3 px-2 text-center font-semibold">{guest.guest_count}</td>
                    <td className="py-3 px-2 text-[var(--color-text-secondary)]">{guest.table_number || '—'}</td>
                    {displayActivities.map(a => (
                      <td key={a.id} className="py-3 px-2 text-center">
                        <CheckStatus guestId={guest.id} activityId={a.id} />
                      </td>
                    ))}
                    <td className="py-3 px-2">
                      <button onClick={() => setDeleteTarget(guest)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View */}
          <div className="space-y-3 md:hidden">
            {filtered.map((guest, i) => (
              <div key={guest.id} className="card p-4 flex flex-col gap-3 animate-slide-up" style={{animationDelay: `${i*15}ms`}}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-3 min-w-0">
                    <input type="checkbox" checked={selected.has(guest.id)} onChange={() => toggleSelect(guest.id)}
                      className="w-4 h-4 rounded border-[var(--color-border)] accent-blue-500 cursor-pointer mt-1" />
                    <div className="min-w-0">
                      <Link to={`/events/${eventId}/guests/${guest.id}`} className="font-bold text-[16px] text-blue-500 hover:text-blue-600 transition-colors block leading-tight">
                        {guest.name}
                      </Link>
                      <div className="text-xs text-[var(--color-text-secondary)] mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
                        {guest.phone && <span>{guest.phone}</span>}
                        {guest.phone && <span className="text-[var(--color-border)]">·</span>}
                        <span className="font-semibold text-[var(--color-text)]">Table {guest.table_number || '—'}</span>
                        <span className="text-[var(--color-border)]">·</span>
                        <span className="font-semibold text-[var(--color-text)]">{guest.guest_count} {guest.guest_count === 1 ? 'person' : 'people'}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setDeleteTarget(guest)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] -mt-1 -mr-1">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
                
                {/* Check-in stations indicators for mobile */}
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[var(--color-border)]/50">
                  {displayActivities.map(a => (
                    <CheckStatusBadge key={a.id} guestId={guest.id} activity={a} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ))}

      <Modal open={showBulkModal} title={bulkAction === 'delete' ? 'Delete Guests' : 'Bulk Update'}
        message={bulkAction === 'delete'
          ? `Delete ${selected.size} guest(s) and all their check-in records? This cannot be undone.`
          : `Apply to ${selected.size} guest(s).`
        }
        variant={bulkAction === 'delete' ? 'danger' : 'default'}
        confirmLabel={bulkAction === 'delete' ? 'Delete All' : 'Apply'}
        onConfirm={bulkAction === 'delete' ? doBulk : doBulk}
        onCancel={() => setShowBulkModal(false)}
      >
        {bulkAction !== 'delete' && (
          <input value={bulkValue} onChange={e => setBulkValue(e.target.value)}
            placeholder={bulkAction === 'assign_category' ? 'Category name' : bulkAction === 'assign_table' ? 'Table number' : bulkAction === 'update_guest_count' ? 'Guest count' : 'Notes'}
            className="input mt-3" autoFocus />
        )}
      </Modal>

      <Modal open={!!deleteTarget} title="Remove Guest?" message={`Delete "${deleteTarget?.name}" and all their check-in records?`}
        variant="danger" confirmLabel="Remove" onConfirm={deleteGuest} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}

function CheckStatus({ guestId, activityId }) {
  const [ci, setCi] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.getGuestCheckins(guestId).then(cs => {
      if (cancelled) return;
      const match = cs.find(c => c.activity_id === activityId);
      if (match) setCi(match);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [guestId, activityId]);
  return ci ? (
    <span className="inline-flex text-green-500" title={ci.checked_in_at}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    </span>
  ) : (
    <span className="text-[var(--color-border)]">—</span>
  );
}

function CheckStatusBadge({ guestId, activity }) {
  const [ci, setCi] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.getGuestCheckins(guestId).then(cs => {
      if (cancelled) return;
      const match = cs.find(c => c.activity_id === activity.id);
      if (match) setCi(match);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [guestId, activity.id]);
  
  if (ci) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 font-medium">
        <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
        {activity.name}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-gray-50 dark:bg-zinc-800/40 text-[var(--color-text-secondary)] border border-[var(--color-border)]/30">
      {activity.name}
    </span>
  );
}
