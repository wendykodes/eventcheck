// RaaS Phase 6 — Event history. Dedicated view over the append-only audit
// trail + operational timeline: what happened, when, who did it.

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useHistoryBack } from '../hooks/useHistoryBack';
import EventTabs from '../components/EventTabs';

export default function EventHistoryPage() {
  const { eventId } = useParams();
  // Retained as a legacy contextual route (read-only timeline; kept
  // intentionally rather than risking a rewrite). Back is history-aware.
  const goBack = useHistoryBack(`/events/${eventId}`);
  const [timeline, setTimeline] = useState(null);
  const [audit, setAudit] = useState(null);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditOffset, setAuditOffset] = useState(0);
  const [auditLimit] = useState(50);
  const [filters, setFilters] = useState({
    action_type: '',
    entity_type: '',
    actor_id: '',
    start_date: '',
    end_date: '',
    search: ''
  });
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    api.getTimeline(eventId)
      .then(setTimeline)
      .catch((err) => {
        toast.error(err.message);
        setTimeline([]);
      });
    loadAudit();
  }, [eventId, auditOffset, filters]);

  const loadAudit = async () => {
    const queryParams = { limit: auditLimit, offset: auditOffset, ...Object.fromEntries(Object.entries(filters).filter(([_, v]) => v)) };
    const queryString = new URLSearchParams(queryParams).toString();
    try {
      const response = await fetch(`/api/audit/event/${eventId}?${queryString}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!response.ok) throw new Error('Failed to load audit log');
      const data = await response.json();
      setAudit(data.rows || []);
      setAuditTotal(data.total || 0);
    } catch (err) {
      console.error(err);
      setAudit([]);
    }
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setAuditOffset(0);
  };

  const handleExport = async () => {
    const queryParams = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v));
    const queryString = new URLSearchParams(queryParams).toString();
    try {
      const response = await fetch(`/api/audit/event/${eventId}/export?${queryString}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${eventId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Audit log exported');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (timeline === null) return <div className="pt-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <button onClick={() => goBack()} className="text-[13px] text-[var(--color-text-secondary)]">← Back</button>
        <h1 className="text-[22px] font-bold tracking-tight mt-1">Event history</h1>
      </div>

      <EventTabs currentKey="history" adminOnly={true} />

      {/* Audit Log Filters */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Audit Log ({auditTotal} entries)</h2>
          <div className="flex gap-2">
            <button onClick={() => setShowFilters(!showFilters)} className="btn btn-secondary btn-sm">
              {showFilters ? 'Hide Filters' : 'Show Filters'}
            </button>
            <button onClick={handleExport} className="btn btn-secondary btn-sm">
              Export CSV
            </button>
          </div>
        </div>
        
        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              placeholder="Search details..."
              value={filters.search}
              onChange={e => handleFilterChange('search', e.target.value)}
              className="input-field text-sm"
            />
            <select
              value={filters.action_type}
              onChange={e => handleFilterChange('action_type', e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All Actions</option>
              <option value="CREATE">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="CHECK_IN">Check In</option>
              <option value="CLOCK_IN">Clock In</option>
            </select>
            <select
              value={filters.entity_type}
              onChange={e => handleFilterChange('entity_type', e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All Entities</option>
              <option value="guest">Guest</option>
              <option value="user">User</option>
              <option value="event">Event</option>
              <option value="activity">Activity</option>
              <option value="shift">Shift</option>
            </select>
            <input
              type="date"
              value={filters.start_date}
              onChange={e => handleFilterChange('start_date', e.target.value)}
              className="input-field text-sm"
            />
            <input
              type="date"
              value={filters.end_date}
              onChange={e => handleFilterChange('end_date', e.target.value)}
              className="input-field text-sm"
            />
            <button onClick={() => setFilters({ action_type: '', entity_type: '', actor_id: '', start_date: '', end_date: '', search: '' })} className="btn btn-secondary btn-sm">
              Clear Filters
            </button>
          </div>
        )}
        
        {audit && audit.length > 0 && (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {audit.map((a) => (
              <div key={a.id} className="p-2 bg-[var(--color-surface)] rounded text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--color-text-secondary)]">#{a.id}</span>
                  <span className="text-[var(--color-text-secondary)]">{a.created_at}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    a.action_type === 'CREATE' ? 'bg-green-100 text-green-700' :
                    a.action_type === 'DELETE' ? 'bg-red-100 text-red-700' :
                    a.action_type === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                    'bg-gray-100 text-gray-700'
                  }`}>{a.action_type}</span>
                  <span className="text-[var(--color-text-secondary)]">{a.entity_type || '-'}/{a.entity_id || '-'}</span>
                  <span className="text-[var(--color-text-secondary)]">by {a.actor_name || a.actor_id}</span>
                </div>
                {a.details && <div className="text-[var(--color-text-secondary)] mt-1 truncate">{a.details}</div>}
              </div>
            ))}
          </div>
        )}
        
        {auditTotal > auditLimit && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t">
            <span className="text-xs text-[var(--color-text-secondary)]">
              Showing {auditOffset + 1}-{Math.min(auditOffset + auditLimit, auditTotal)} of {auditTotal}
            </span>
            <div className="flex gap-2">
              <button 
                onClick={() => setAuditOffset(Math.max(0, auditOffset - auditLimit))}
                disabled={auditOffset === 0}
                className="btn btn-secondary btn-sm disabled:opacity-50"
              >
                Previous
              </button>
              <button 
                onClick={() => setAuditOffset(auditOffset + auditLimit)}
                disabled={auditOffset + auditLimit >= auditTotal}
                className="btn btn-secondary btn-sm disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {timeline.length === 0 ? (
        <EmptyState title="No history yet" message="Significant activity will appear here as the event runs." />
      ) : (
        <div className="card-flat divide-y divide-[var(--color-border)] overflow-hidden">
          {timeline.map((t) => (
            <div key={t.id} className="p-3 flex items-start gap-3 text-sm">
              <span className="text-[11px] text-[var(--color-text-secondary)] shrink-0 w-14">
                {new Date(t.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <div className="min-w-0">
                <p>{t.text}</p>
                <p className="text-[11px] text-[var(--color-text-secondary)]">{t.actor} · {new Date(t.at).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
