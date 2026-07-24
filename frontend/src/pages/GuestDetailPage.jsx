import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import Modal from '../components/Modal';

export default function GuestDetailPage() {
  const { eventId, guestId } = useParams();
  const isAdmin = JSON.parse(localStorage.getItem('user') || '{}')?.role === 'admin';
  const [guest, setGuest] = useState(null);
  const [checkins, setCheckins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [undoTarget, setUndoTarget] = useState(null);
  const [form, setForm] = useState({});

  useEffect(() => {
    Promise.all([
      api.getGuest(guestId),
      api.getGuestCheckins(guestId)
    ]).then(([g, cs]) => {
      setGuest(g);
      setForm(g);
      setCheckins(cs);
    }).catch(err => toast.error(err.message))
    .finally(() => setLoading(false));
  }, [guestId]);

  const updateGuest = async (e) => {
    e.preventDefault();
    try {
      const updated = await api.updateGuest(guestId, form);
      setGuest(updated);
      setEditing(false);
      toast.success('Guest updated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const undoCheckIn = async () => {
    if (!undoTarget) return;
    try {
      await api.undoCheckIn(undoTarget.id);
      toast.success('Check-in undone');
      setUndoTarget(null);
      setCheckins(prev => prev.filter(c => c.id !== undoTarget.id));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={4} /><SkeletonCard lines={3} /></div>;
  if (!guest) return null;

  return (
    <div className="pt-2 space-y-5 animate-fade-in">
      <Link to={`/events/${eventId}/guests`} className="text-[13px] text-[var(--color-text-secondary)] hover:text-primary-500 transition-colors inline-flex items-center gap-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
        Back
      </Link>

      {!editing ? (
        <div className="card p-6 animate-slide-up">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-primary-50 dark:bg-primary-900/20 text-primary-500 flex items-center justify-center text-xl font-bold shrink-0">
                {guest.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="text-[22px] font-bold tracking-tight">{guest.name}</h1>
                <p className="text-[14px] text-[var(--color-text-secondary)]">{guest.phone}</p>
              </div>
            </div>
            <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
              Edit
            </button>
          </div>
          <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 text-[14px]">
            {guest.email && <div><span className="text-[var(--color-text-secondary)] text-[12px] block">Email</span><p>{guest.email || '—'}</p></div>}
            <div><span className="text-[var(--color-text-secondary)] text-[12px] block">Guest Count</span><p className="font-semibold">{guest.guest_count}</p></div>
            {guest.table_number && <div><span className="text-[var(--color-text-secondary)] text-[12px] block">Table</span><p>{guest.table_number}</p></div>}
            {guest.category && <div><span className="text-[var(--color-text-secondary)] text-[12px] block">Category</span><p>{guest.category}</p></div>}
            {guest.notes && <div className="col-span-full"><span className="text-[var(--color-text-secondary)] text-[12px] block">Notes</span><p className="text-[var(--color-text)]">{guest.notes}</p></div>}
          </div>
        </div>
      ) : (
        <form onSubmit={updateGuest} className="card p-5 space-y-3.5 animate-scale-in">
          <h2 className="font-semibold text-[17px]">Edit Guest</h2>
          <div className="grid grid-cols-2 gap-3">
            <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="input-field" />
            <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} className="input-field" />
            <input value={form.email || ''} onChange={e => setForm(f => ({...f, email: e.target.value}))} className="input-field" placeholder="Email" />
            <input value={form.table_number || ''} onChange={e => setForm(f => ({...f, table_number: e.target.value}))} className="input-field" placeholder="Table" />
            <input type="number" min="1" value={form.guest_count} onChange={e => setForm(f => ({...f, guest_count: e.target.value}))} className="input-field" />
            <input value={form.category || ''} onChange={e => setForm(f => ({...f, category: e.target.value}))} className="input-field" placeholder="Category" />
          </div>
          <textarea value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))} rows={2} className="input-field resize-none" placeholder="Notes" />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="btn btn-secondary">Cancel</button>
          </div>
        </form>
      )}

      <div>
        <h2 className="section-title flex items-center gap-2">
          <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Activity History
        </h2>
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl">
          {checkins.length === 0 ? (
            <div className="p-6 text-sm text-[var(--color-text-secondary)] text-center">No check-ins recorded</div>
          ) : (
            checkins.map(ci => (
              <div key={ci.id} className="p-4 flex items-center justify-between animate-fade-in">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-green-50 dark:bg-green-900/20 flex items-center justify-center shrink-0">
                    <svg className="w-4.5 h-4.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-[14px] text-gray-900 dark:text-gray-100">{ci.activity_name}</p>
                    <p className="text-[12px] text-[var(--color-text-secondary)]">by {ci.staff_name} · {new Date(ci.checked_in_at).toLocaleString()}</p>
                  </div>
                </div>
                {isAdmin && (
                  <button onClick={() => setUndoTarget(ci)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]" title="Undo">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                    </svg>
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      <Modal open={!!undoTarget} title="Undo Check-In?" message={`Remove the "${undoTarget?.activity_name}" check-in for ${guest?.name}?`}
        variant="warning" confirmLabel="Undo" onConfirm={undoCheckIn} onCancel={() => setUndoTarget(null)} />
    </div>
  );
}
