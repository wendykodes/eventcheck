import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

export default function ActivitiesPage() {
  const { eventId } = useParams();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = async () => {
    try {
      setActivities(await api.getActivities(eventId));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [eventId]);

  const create = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return toast.error('Activity name is required');
    try {
      await api.createActivity({ event_id: Number(eventId), name: newName.trim() });
      setNewName('');
      toast.success('Activity created');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const update = async (id) => {
    if (!editName.trim()) return;
    try {
      await api.updateActivity(id, { name: editName.trim() });
      setEditing(null);
      toast.success('Renamed');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteActivity(deleteTarget.id);
      toast.success(`"${deleteTarget.name}" deleted`);
      setDeleteTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const moveUp = (index) => {
    if (index === 0) return;
    const ids = activities.map(a => a.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    api.reorderActivities(eventId, ids).then(setActivities).catch(err => toast.error(err.message));
  };

  const moveDown = (index) => {
    if (index === activities.length - 1) return;
    const ids = activities.map(a => a.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    api.reorderActivities(eventId, ids).then(setActivities).catch(err => toast.error(err.message));
  };

  if (loading) return <div className="pt-4 space-y-3">{Array.from({length:4}).map((_,i) => <SkeletonCard key={i} lines={1} />)}</div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">Activities</h1>
        <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)] hover:text-primary-500 transition-colors inline-flex items-center gap-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" /></svg>
          Dashboard
        </Link>
      </div>

      <form onSubmit={create} className="flex gap-2.5">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="New activity name" className="input-field flex-1" />
        <button type="submit" className="btn btn-primary shrink-0">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add
        </button>
      </form>

      {activities.length === 0 ? (
        <EmptyState title="No Activities" message="Create stations like Entrance, Food, or Drinks." />
      ) : (
        <div className="space-y-2.5">
          {activities.map((a, i) => (
            <div key={a.id} className={`card p-4 flex items-center gap-3 animate-slide-up stagger-${Math.min(i+1,6)}`}>
              <div className="flex flex-col gap-0.5">
                <button onClick={() => moveUp(i)} disabled={i === 0}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-20 transition-colors text-xs leading-none p-0.5">▲</button>
                <button onClick={() => moveDown(i)} disabled={i === activities.length - 1}
                  className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)] disabled:opacity-20 transition-colors text-xs leading-none p-0.5">▼</button>
              </div>

              {editing === a.id ? (
                <form onSubmit={(e) => { e.preventDefault(); update(a.id); }} className="flex-1 flex gap-2 items-center">
                  <input value={editName} onChange={e => setEditName(e.target.value)} className="input-field flex-1" autoFocus />
                  <button type="submit" className="btn btn-primary btn-sm">Save</button>
                  <button type="button" onClick={() => setEditing(null)} className="btn btn-secondary btn-sm">Cancel</button>
                </form>
              ) : (
                <>
                  <span className="flex-1 font-semibold text-[15px]">{a.name}</span>
                  <span className="text-[11px] text-[var(--color-text-secondary)] bg-[var(--color-surface-hover)] px-2.5 py-1 rounded-full font-medium">#{i + 1}</span>
                  <button onClick={() => { setEditing(a.id); setEditName(a.name); }} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)]">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                    </svg>
                  </button>
                  <button onClick={() => setDeleteTarget(a)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-red-500">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!deleteTarget} title="Delete Activity?" message={`Remove "${deleteTarget?.name}" and all its check-in records?`}
        variant="danger" confirmLabel="Delete" onConfirm={remove} onCancel={() => setDeleteTarget(null)} />
    </div>
  );
}
