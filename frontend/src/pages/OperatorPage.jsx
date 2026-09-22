// RaaS Phase 4.3 — Operator workspace. Service-delivery view: assigned events
// with health, my open work, decisions awaiting input, team notes, and (for
// admins) workload + intake triage. Not a duplicate event-manager screen.

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { SkeletonCard } from '../components/Skeleton';

const HEALTH_DOT = { CRITICAL: 'bg-red-500', WATCH: 'bg-amber-500', OK: 'bg-green-500' };

export default function OperatorPage() {
  const { isAdmin } = useAuth();
  const [ws, setWs] = useState(null);
  const [intakes, setIntakes] = useState([]);
  const [workload, setWorkload] = useState([]);
  const [loading, setLoading] = useState(true);
  const [noteEvent, setNoteEvent] = useState('');
  const [noteBody, setNoteBody] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const [w, wl] = await Promise.all([
          api.getWorkspace(),
          isAdmin ? api.getWorkload().catch(() => []) : Promise.resolve([]),
        ]);
        setWs(w);
        setWorkload(wl || []);
        if (isAdmin) api.getIntakes().then((d) => setIntakes(d.filter((i) => i.status === 'NEW' || i.status === 'REVIEWED'))).catch(() => {});
      } catch (err) {
        toast.error(err.message);
      } finally {
        setLoading(false);
      }
    };
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const addNote = async (e) => {
    e.preventDefault();
    if (!noteEvent || !noteBody.trim()) return;
    try {
      await api.createNote(Number(noteEvent), noteBody.trim(), 'INTERNAL');
      toast.success('Note saved');
      setNoteBody('');
      setWs(await api.getWorkspace());
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;
  if (!ws) return null;

  const myLoad = ws.events.reduce((n, e) => n + e.my_tasks + e.my_incidents, 0);

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Operator</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          {ws.events.length} event{ws.events.length === 1 ? '' : 's'} · {myLoad} open item{myLoad === 1 ? '' : 's'} assigned to you
        </p>
      </div>

      {isAdmin && intakes.length > 0 && (
        <div className="card p-4 border-l-4 border-l-primary-500">
          <p className="font-semibold text-[14px] mb-2">New handovers ({intakes.length})</p>
          <div className="space-y-1.5">
            {intakes.map((i) => (
              <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{i.customer_name} · {i.event_type || 'Event'}{i.event_date ? ` · ${i.event_date}` : ''}</span>
                <button onClick={async () => { try { const r = await api.convertIntake(i.id, 'wedding'); toast.success('Event created'); setIntakes((l) => l.filter((x) => x.id !== i.id)); } catch (err) { toast.error(err.message); } }}
                  className="btn btn-primary btn-sm shrink-0">Convert</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {ws.events.map((e) => (
          <Link key={e.id} to={`/events/${e.id}/command`} className="card p-4 block">
            <div className="flex items-center gap-2.5">
              <span className={`w-3 h-3 rounded-full shrink-0 ${HEALTH_DOT[e.health] || 'bg-gray-400'}`} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[15px] truncate">{e.name}</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{e.lifecycle_state} · {e.attention_count} ⚠ · mine: {e.my_tasks + e.my_incidents}</p>
              </div>
            </div>
          </Link>
        ))}
        {ws.events.length === 0 && (
          <div className="card p-5 text-center text-sm text-[var(--color-text-secondary)]">No assigned events.</div>
        )}
      </div>

      <form onSubmit={addNote} className="card p-4 space-y-2">
        <p className="font-semibold text-sm">Shift note</p>
        <select value={noteEvent} onChange={(e) => setNoteEvent(e.target.value)} className="input-field">
          <option value="">Event…</option>
          {ws.events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <textarea value={noteBody} onChange={(e) => setNoteBody(e.target.value)} rows={2} placeholder="Handover note for the team…" className="input-field resize-none" />
        <button type="submit" className="btn btn-secondary btn-sm">Save note</button>
      </form>

      {ws.recent_notes.length > 0 && (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
          {ws.recent_notes.slice(0, 8).map((n) => (
            <div key={n.id} className="p-3 text-sm">
              <p>{n.body}</p>
              <p className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{n.event_name}</p>
            </div>
          ))}
        </div>
      )}

      {isAdmin && workload.length > 0 && (
        <div>
          <h2 className="section-title">Team load</h2>
          <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
            {workload.slice(0, 10).map((w) => (
              <div key={w.id} className="p-3 flex items-center justify-between text-sm">
                <span className="font-medium">{w.name}</span>
                <span className="text-[12px] text-[var(--color-text-secondary)]">{w.open_tasks} tasks · {w.open_incidents} incidents · {w.event_count} events</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
