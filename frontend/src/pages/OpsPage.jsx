// RaaS Phase 2 — Event operations console. One mobile-first surface for
// schedule, tasks, incidents, requests, seating, vendors, transport, stays.
// Backend enforces all permissions; the UI only exposes obvious next actions.

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { RunbookPanel, CommsPanel } from './OpsPanels';

const TABS = [
  { key: 'tasks', label: 'Tasks' },
  { key: 'schedule', label: 'Schedule' },
  { key: 'incidents', label: 'Incidents' },
  { key: 'requests', label: 'Requests' },
  { key: 'seating', label: 'Seating' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'transport', label: 'Transport' },
  { key: 'stays', label: 'Stays' },
  { key: 'runbook', label: 'Runbook' },
  { key: 'devices', label: 'Devices' },
  { key: 'comms', label: 'Comms' },
];

const NEXT = {
  tasks: { OPEN: ['ACCEPTED', 'IN_PROGRESS'], ACCEPTED: ['IN_PROGRESS'], IN_PROGRESS: ['COMPLETED'], BLOCKED: ['IN_PROGRESS'] },
  schedule: { PLANNED: ['READY'], READY: ['IN_PROGRESS'], IN_PROGRESS: ['COMPLETED'], DELAYED: ['IN_PROGRESS'] },
  incidents: { OPEN: ['ASSIGNED', 'IN_PROGRESS'], ASSIGNED: ['IN_PROGRESS'], IN_PROGRESS: ['RESOLVED'], RESOLVED: ['CLOSED'] },
  requests: { OPEN: ['ASSIGNED', 'IN_PROGRESS'], ASSIGNED: ['IN_PROGRESS'], IN_PROGRESS: ['FULFILLED'], FULFILLED: ['CLOSED'] },
  vendors: { EXPECTED: ['ARRIVED'], ARRIVED: ['DEPARTED'], ISSUE: ['ARRIVED'] },
  transport: { PLANNED: ['EN_ROUTE'], EN_ROUTE: ['COMPLETED'], DELAYED: ['EN_ROUTE'] },
  devices: { READY: ['DEPLOYED'], DEPLOYED: ['RETURNED', 'ISSUE'], ISSUE: ['READY'] },
};

function pill(status) {
  const s = String(status || '');
  const color = /COMPLETED|FULFILLED|RESOLVED|CLOSED|ARRIVED|DEPARTED/.test(s) ? 'badge-green'
    : /CRITICAL|ISSUE|DELAYED|BLOCKED/.test(s) ? 'badge-red'
    : /IN_PROGRESS|EN_ROUTE|ASSIGNED/.test(s) ? 'badge-primary' : 'badge-orange';
  return <span className={`badge ${color}`}>{s.replace(/_/g, ' ')}</span>;
}

const sevColor = (p) => p === 'CRITICAL' ? 'text-red-500' : p === 'HIGH' ? 'text-orange-500' : '';

export default function OpsPage() {
  const { eventId } = useParams();
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState('tasks');
  const [data, setData] = useState([]);
  const [zones, setZones] = useState([]);
  const [guests, setGuests] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({});
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (tab === 'runbook' || tab === 'comms') { setLoading(false); return; }
    setLoading(true);
    try {
      const [d, z, g] = await Promise.all([
        loadTab(tab, eventId),
        tab === 'seating' || tab === 'vendors' ? api.getZones(eventId).catch(() => []) : Promise.resolve(null),
        tab === 'seating' ? api.getGuests(eventId).catch(() => []) : Promise.resolve(null),
      ]);
      setData(d || []);
      if (z) setZones(z);
      if (g) setGuests(g);
      if (isAdmin && users.length === 0) {
        api.getUsers().then(setUsers).catch(() => {});
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, eventId]);

  useEffect(() => { load(); }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await createOp(tab, eventId, form);
      toast.success('Created');
      setForm({});
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const advance = async (id, to) => {
    try {
      await advanceOp(tab, id, to);
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const escalate = async (id) => {
    try {
      await api.escalateIncident(id);
      toast.success('Escalated');
      load();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Operations</h1>
          <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)]">← Dashboard</Link>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm" style={{ display: tab === 'runbook' || tab === 'comms' ? 'none' : undefined }}>+ New</button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setShowForm(false); setForm({}); }}
            className={`btn btn-sm shrink-0 ${tab === t.key ? 'btn-primary' : 'btn-secondary'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {showForm && tab !== 'runbook' && tab !== 'comms' && (
        <form onSubmit={submit} className="card p-4 space-y-3 animate-scale-in">
          <input value={form.title || form.name || form.description || ''} required
            onChange={(e) => setForm((f) => ({ ...f, ...(tab === 'requests' ? { description: e.target.value } : tab === 'stays' ? { name: e.target.value } : { title: e.target.value }) }))}
            placeholder={tab === 'requests' ? 'What is needed? *' : tab === 'stays' ? 'Place name *' : 'Title *'}
            className="input-field" />
          {['tasks', 'schedule', 'incidents', 'requests'].includes(tab) && (
            <div className="grid grid-cols-2 gap-2">
              <select value={form.priority || 'MEDIUM'} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))} className="input-field">
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {tab === 'incidents' && (
                <input value={form.category || ''} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category" className="input-field" />
              )}
              {tab === 'tasks' && (
                <input value={form.due_at || ''} onChange={(e) => setForm((f) => ({ ...f, due_at: e.target.value }))} placeholder="Due (YYYY-MM-DD HH:MM)" className="input-field" />
              )}
              {tab === 'schedule' && (
                <input value={form.planned_start || ''} onChange={(e) => setForm((f) => ({ ...f, planned_start: e.target.value }))} placeholder="Start (YYYY-MM-DD HH:MM)" className="input-field" />
              )}
            </div>
          )}
          {isAdmin && ['tasks', 'incidents'].includes(tab) && users.length > 0 && (
            <select value={form.assignee_user_id || ''} onChange={(e) => setForm((f) => ({ ...f, assignee_user_id: e.target.value ? Number(e.target.value) : undefined }))} className="input-field">
              <option value="">Assign to…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <textarea value={form.notes || form.location || ''} rows={1}
            onChange={(e) => setForm((f) => ({ ...f, ...(tab === 'schedule' || tab === 'incidents' ? { location: e.target.value } : { notes: e.target.value }) }))}
            placeholder={tab === 'schedule' || tab === 'incidents' ? 'Location' : 'Notes (optional)'}
            className="input-field resize-none" />
          <button type="submit" className="btn btn-primary w-full">Create</button>
        </form>
      )}

      {tab === 'runbook' ? (
        <RunbookPanel eventId={eventId} />
      ) : tab === 'comms' ? (
        <CommsPanel eventId={eventId} />
      ) : loading ? <SkeletonCard lines={4} /> : data.length === 0 ? (
        <EmptyState title={`No ${TABS.find((t) => t.key === tab).label}`} message="Nothing here yet. Create the first item." />
      ) : (
        <div className="space-y-2.5">
          {data.map((item) => (
            <div key={item.id} className="card p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-[15px] leading-snug">{item.title || item.name || item.label || item.description}</p>
                {pill(item.status)}
              </div>
              <div className="text-[12px] text-[var(--color-text-secondary)] space-x-3">
                {(item.priority || item.severity) && <span className={`font-semibold ${sevColor(item.priority || item.severity)}`}>{item.priority || item.severity}</span>}
                {item.assignee_name && <span>→ {item.assignee_name}</span>}
                {item.owner_name && <span>Owner: {item.owner_name}</span>}
                {item.location && <span>@ {item.location}</span>}
                {item.due_at && <span>Due {item.due_at}</span>}
                {item.planned_start && <span>{item.planned_start}{item.actual_start ? ` → actual ${item.actual_start}` : ''}</span>}
                {item.overdue && <span className="text-red-500 font-semibold">OVERDUE</span>}
                {item.passenger_count !== undefined && <span>{item.passenger_count} passengers</span>}
                {item.seated !== undefined && <span>{item.occupancy} seated</span>}
                {item.escalation_level > 0 && <span className="text-red-500 font-semibold">ESC L{item.escalation_level}</span>}
              </div>
              {(NEXT[tab]?.[item.status] || []).length > 0 && (
                <div className="flex gap-2 flex-wrap pt-1">
                  {(NEXT[tab][item.status] || []).map((to) => (
                    <button key={to} onClick={() => advance(item.id, to)} className="btn btn-success btn-sm">
                      Mark {to.replace(/_/g, ' ').toLowerCase()}
                    </button>
                  ))}
                  {tab === 'incidents' && !['RESOLVED', 'CLOSED'].includes(item.status) && (
                    <button onClick={() => escalate(item.id)} className="btn btn-secondary btn-sm">Escalate</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'seating' && <SeatingPanel eventId={eventId} zones={zones} guests={guests} reload={load} />}
    </div>
  );
}

function SeatingPanel({ eventId, zones, guests, reload }) {
  const [assign, setAssign] = useState({});
  const [list, setList] = useState([]);
  const [zoneForm, setZoneForm] = useState({});

  useEffect(() => {
    api.getSeatAssignments(eventId).then(setList).catch(() => {});
  }, [eventId, zones]);

  const createZone = async (e) => {
    e.preventDefault();
    try {
      await api.createZone({ event_id: Number(eventId), ...zoneForm }, crypto.randomUUID());
      toast.success('Zone created');
      setZoneForm({});
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const doAssign = async () => {
    try {
      await api.assignSeat({ event_id: Number(eventId), zone_id: Number(assign.zone_id), guest_id: Number(assign.guest_id) }, false, crypto.randomUUID());
      toast.success('Guest seated');
      setAssign({});
      api.getSeatAssignments(eventId).then(setList).catch(() => {});
      reload();
    } catch (err) {
      if (/already seated elsewhere/.test(err.message)) {
        if (window.confirm(`${err.message} Move them?`)) {
          try {
            await api.assignSeat({ event_id: Number(eventId), zone_id: Number(assign.zone_id), guest_id: Number(assign.guest_id) }, true, crypto.randomUUID());
            toast.success('Guest moved');
            api.getSeatAssignments(eventId).then(setList).catch(() => {});
            reload();
          } catch (e2) {
            toast.error(e2.message);
          }
        }
      } else {
        toast.error(err.message);
      }
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={createZone} className="card p-4 flex gap-2">
        <input value={zoneForm.name || ''} required onChange={(e) => setZoneForm((f) => ({ ...f, name: e.target.value }))} placeholder="New table/zone name *" className="input-field flex-1" />
        <input value={zoneForm.capacity || ''} type="number" min="1" onChange={(e) => setZoneForm((f) => ({ ...f, capacity: Number(e.target.value) }))} placeholder="Cap" className="input-field w-20" />
        <button type="submit" className="btn btn-secondary btn-sm shrink-0">Add</button>
      </form>
      <div className="card p-4 space-y-2">
        <p className="font-semibold text-sm">Seat a guest</p>
        <div className="flex gap-2">
          <select value={assign.guest_id || ''} onChange={(e) => setAssign((a) => ({ ...a, guest_id: e.target.value }))} className="input-field flex-1">
            <option value="">Guest…</option>
            {guests.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <select value={assign.zone_id || ''} onChange={(e) => setAssign((a) => ({ ...a, zone_id: e.target.value }))} className="input-field flex-1">
            <option value="">Table/zone…</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name} ({z.occupancy})</option>)}
          </select>
          <button onClick={doAssign} disabled={!assign.guest_id || !assign.zone_id} className="btn btn-primary btn-sm shrink-0">Seat</button>
        </div>
      </div>
      {list.length > 0 && (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
          {list.map((a) => (
            <div key={a.id} className="p-3 flex items-center justify-between text-sm">
              <span><strong>{a.guest_name}</strong> <span className="text-[var(--color-text-secondary)]">→ {a.zone_name}</span></span>
              <button onClick={async () => { try { await api.unassignSeat(eventId, a.guest_id); toast.success('Unseated'); api.getSeatAssignments(eventId).then(setList).catch(() => {}); reload(); } catch (err) { toast.error(err.message); } }}
                className="btn btn-ghost btn-sm text-red-500">Remove</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

async function loadTab(tab, eventId) {
  switch (tab) {
    case 'tasks': return api.getTasks(eventId);
    case 'schedule': return api.getSchedule(eventId);
    case 'incidents': return api.getIncidents(eventId);
    case 'requests': return api.getRequests(eventId);
    case 'seating': return api.getZones(eventId);
    case 'vendors': return api.getVendors(eventId);
    case 'transport': return api.getTransport(eventId);
    case 'stays': return api.getStays(eventId);
    case 'devices': return api.getDevices(eventId);
    default: return [];
  }
}

function createOp(tab, eventId, form) {
  const base = { event_id: Number(eventId), ...form };
  switch (tab) {
    case 'tasks': return api.createTask(base, crypto.randomUUID());
    case 'schedule': return api.createScheduleItem(base, crypto.randomUUID());
    case 'incidents': return api.createIncident(base, crypto.randomUUID());
    case 'requests': return api.createRequest(base, crypto.randomUUID());
    case 'seating': return api.createZone(base, crypto.randomUUID());
    case 'vendors': return api.createVendor(base, crypto.randomUUID());
    case 'transport': return api.createTransport(base, crypto.randomUUID());
    case 'stays': return api.createStay(base, crypto.randomUUID());
    case 'devices': return api.createDevice({ ...base, label: base.title });
    default: throw new Error('Unknown tab');
  }
}

function advanceOp(tab, id, to) {
  switch (tab) {
    case 'tasks': return to === 'COMPLETED' ? api.completeTask(id) : api.setTaskStatus(id, to);
    case 'schedule': return api.setScheduleStatus(id, to);
    case 'incidents': return api.setIncidentStatus(id, to);
    case 'requests': return api.setRequestStatus(id, to);
    case 'vendors': return api.setVendorStatus(id, to);
    case 'transport': return api.setTransportStatus(id, to);
    case 'devices': return api.setDeviceStatus(id, to);
    default: throw new Error('Unknown tab');
  }
}
