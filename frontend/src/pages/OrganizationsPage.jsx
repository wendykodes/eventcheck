// RaaS Phase 6 — Organizations workspace. An event company runs many events
// through one organization: portfolio with health, members, venues,
// contracts, org reporting, double-booking conflicts.

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

const HEALTH_DOT = { CRITICAL: 'bg-red-500', WATCH: 'bg-amber-500', OK: 'bg-green-500' };

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [portfolio, setPortfolio] = useState([]);
  const [report, setReport] = useState(null);
  const [conflicts, setConflicts] = useState([]);
  const [venues, setVenues] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', type: 'planner' });
  const [memberPick, setMemberPick] = useState('');
  const [venueForm, setVenueForm] = useState(null);
  const [contractForm, setContractForm] = useState(null);

  const loadOrgs = useCallback(async () => {
    try {
      setOrgs(await api.getOrgs());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOrgs(); }, [loadOrgs]);
  useEffect(() => { api.getUsers().then(setUsers).catch(() => {}); }, []);

  const select = async (id) => {
    setSelected(id);
    setDetail(null);
    try {
      const [d, p, r, c, v, ct] = await Promise.all([
        api.getOrg(id),
        api.getOrgPortfolio(id).catch(() => ({ events: [] })),
        api.getOrgReport(id).catch(() => null),
        api.getOrgConflicts(id).catch(() => ({ conflicts: [] })),
        api.getVenues(id).catch(() => []),
        api.getContracts(id).catch(() => []),
      ]);
      setDetail(d);
      setPortfolio(p.events || []);
      setReport(r);
      setConflicts(c.conflicts || []);
      setVenues(v);
      setContracts(ct);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return toast.error('Name is required');
    try {
      const org = await api.createOrg(form);
      toast.success('Organization created — you are its owner');
      setForm({ name: '', type: 'planner' });
      setShowForm(false);
      loadOrgs();
      select(org.id);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const addMember = async () => {
    if (!memberPick) return;
    try {
      await api.addOrgMember(selected, Number(memberPick), 'member');
      toast.success('Member added');
      setMemberPick('');
      select(selected);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={4} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Organizations</h1>
        <button onClick={() => setShowForm(!showForm)} className="btn btn-primary btn-sm">+ New</button>
      </div>

      {showForm && (
        <form onSubmit={create} className="card p-4 space-y-2 animate-scale-in">
          <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Organization name *" className="input-field" />
          <div className="flex gap-2">
            <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} className="input-field">
              <option value="planner">Event planner</option>
              <option value="venue">Venue</option>
              <option value="corporate">Corporate</option>
              <option value="ngo">NGO</option>
              <option value="other">Other</option>
            </select>
            <button type="submit" className="btn btn-primary">Create</button>
          </div>
        </form>
      )}

      {orgs.length === 0 ? (
        <EmptyState title="No organizations" message="Create one to run many events through a single company account." />
      ) : (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
          {orgs.map((o) => (
            <button key={o.id} onClick={() => select(o.id)}
              className={`btn btn-sm shrink-0 ${selected === o.id ? 'btn-primary' : 'btn-secondary'}`}>
              {o.name}
            </button>
          ))}
        </div>
      )}

      {detail && (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-[17px]">{detail.name}</p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">{detail.type || ''} · {portfolio.length} event{portfolio.length === 1 ? '' : 's'}</p>
              </div>
              <button onClick={async () => { if (!window.confirm(`Delete ${detail.name}? Events are released, not deleted.`)) return; try { await api.deleteOrg(detail.id); toast.success('Deleted'); setSelected(null); setDetail(null); loadOrgs(); } catch (err) { toast.error(err.message); } }}
                className="btn btn-ghost btn-sm text-red-500">Delete</button>
            </div>
            {report && (
              <div className="grid grid-cols-4 gap-2 mt-3 text-center">
                {[['Events', report.events], ['Guests', report.guests?.invited], ['Checked in', report.guests?.checked_in], ['Open incidents', report.incidents?.open]].map(([l, v]) => (
                  <div key={l} className="bg-[var(--color-surface-hover)]/50 rounded-xl p-2">
                    <div className="text-lg font-bold">{v ?? 0}</div>
                    <div className="text-[10px] text-[var(--color-text-secondary)] uppercase">{l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {conflicts.length > 0 && (
            <div className="card p-4 border-l-4 border-l-amber-500">
              <p className="font-semibold text-[14px] mb-1.5">Double-booked staff ({conflicts.length})</p>
              {conflicts.map((c) => (
                <p key={`${c.user_id}-${c.date}`} className="text-[13px]">• <strong>{c.user_name}</strong> on {c.date}: {c.events.map((e) => e.name).join(' + ')}</p>
              ))}
            </div>
          )}

          <div>
            <h2 className="section-title">Portfolio</h2>
            <div className="space-y-2">
              {portfolio.map((e) => (
                <Link key={e.id} to={`/events/${e.id}/command`} className="card p-3.5 flex items-center gap-2.5">
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${HEALTH_DOT[e.health] || 'bg-gray-400'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[14px] truncate">{e.name}</p>
                    <p className="text-[11px] text-[var(--color-text-secondary)]">{e.lifecycle_state}{e.date ? ` · ${e.date}` : ''}</p>
                  </div>
                </Link>
              ))}
              {portfolio.length === 0 && <p className="text-sm text-[var(--color-text-secondary)]">No events yet. Create events with this organization to see them here.</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="card p-4">
              <p className="font-semibold text-sm mb-2">Members ({detail.members?.length || 0})</p>
              <div className="space-y-1.5 mb-2">
                {(detail.members || []).map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between text-sm">
                    <span>{m.user_name} <span className="text-[var(--color-text-secondary)]">· {m.org_role}</span></span>
                    <button onClick={async () => { try { await api.removeOrgMember(detail.id, m.user_id); toast.success('Removed'); select(detail.id); } catch (err) { toast.error(err.message); } }}
                      className="btn btn-ghost btn-sm text-red-500">Remove</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <select value={memberPick} onChange={(e) => setMemberPick(e.target.value)} className="input-field flex-1">
                  <option value="">Add member…</option>
                  {users.filter((u) => !(detail.members || []).some((m) => m.user_id === u.id)).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <button onClick={addMember} className="btn btn-secondary btn-sm shrink-0">Add</button>
              </div>
            </div>

            <div className="card p-4">
              <p className="font-semibold text-sm mb-2">Venues ({venues.length})</p>
              <div className="space-y-1.5 mb-2">
                {venues.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm">
                    <span>{v.name}{v.capacity ? ` · ${v.capacity}` : ''} <span className="text-[var(--color-text-secondary)]">· {v.event_count} events</span></span>
                    <button onClick={async () => { try { await api.deleteVenue(v.id); toast.success('Deleted'); select(detail.id); } catch (err) { toast.error(err.message); } }}
                      className="btn btn-ghost btn-sm text-red-500">Delete</button>
                  </div>
                ))}
              </div>
              {!venueForm ? (
                <button onClick={() => setVenueForm({ name: '', capacity: '' })} className="btn btn-ghost btn-sm">+ Venue</button>
              ) : (
                <div className="flex gap-2">
                  <input value={venueForm.name} onChange={(e) => setVenueForm((f) => ({ ...f, name: e.target.value }))} placeholder="Venue name *" className="input-field flex-1" />
                  <input value={venueForm.capacity} type="number" min="1" onChange={(e) => setVenueForm((f) => ({ ...f, capacity: e.target.value }))} placeholder="Cap" className="input-field w-20" />
                  <button onClick={async () => { try { await api.createVenue({ org_id: detail.id, name: venueForm.name, capacity: venueForm.capacity ? Number(venueForm.capacity) : undefined }); setVenueForm(null); select(detail.id); } catch (err) { toast.error(err.message); } }}
                    className="btn btn-primary btn-sm shrink-0">Save</button>
                </div>
              )}
            </div>

            <div className="card p-4">
              <p className="font-semibold text-sm mb-2">Contracts ({contracts.length})</p>
              <div className="space-y-1.5 mb-2">
                {contracts.map((c) => (
                  <div key={c.id} className="text-sm">
                    <span className="font-medium">{c.title}</span>{' '}
                    <span className="badge badge-gray">{c.package}</span>{' '}
                    <span className="badge badge-primary">{c.status}</span>
                    {c.events?.length > 0 && <span className="text-[var(--color-text-secondary)]"> · {c.events.length} event{c.events.length === 1 ? '' : 's'}</span>}
                  </div>
                ))}
              </div>
              {!contractForm ? (
                <button onClick={() => setContractForm({ title: '', package: 'MANAGED' })} className="btn btn-ghost btn-sm">+ Contract</button>
              ) : (
                <div className="flex gap-2">
                  <input value={contractForm.title} onChange={(e) => setContractForm((f) => ({ ...f, title: e.target.value }))} placeholder="Contract title *" className="input-field flex-1" />
                  <select value={contractForm.package} onChange={(e) => setContractForm((f) => ({ ...f, package: e.target.value }))} className="input-field">
                    <option value="DIGITAL">Digital</option>
                    <option value="MANAGED">Managed</option>
                    <option value="FULL_RAAS">Full RaaS</option>
                    <option value="ENTERPRISE">Enterprise</option>
                  </select>
                  <button onClick={async () => { try { await api.createContract({ org_id: detail.id, ...contractForm }); setContractForm(null); select(detail.id); } catch (err) { toast.error(err.message); } }}
                    className="btn btn-primary btn-sm shrink-0">Save</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
