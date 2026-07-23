import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export default function ImportHistoryPage() {
  const { eventId } = useParams();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.getImportHistory(eventId)
      .then(setHistory)
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [eventId]);

  return (
    <div className="page-card max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Import History</h1>
        <div className="flex gap-2">
          <Link to={`/events/${eventId}/guests`} className="btn btn-ghost text-sm">Guests</Link>
          <Link to={`/events/${eventId}/import`} className="btn btn-primary text-sm">New Import</Link>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-[var(--color-surface-hover)]/50 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : history.length === 0 ? (
        <div className="text-center py-12">
          <svg className="w-12 h-12 mx-auto mb-3 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="font-medium mb-1">No imports yet</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">Import a guest list to see history here.</p>
          <Link to={`/events/${eventId}/import`} className="btn btn-primary">Import Guests</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {history.map(item => (
            <div key={item.id} className="bg-[var(--color-surface-hover)]/30 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                className="w-full flex items-center justify-between p-4 text-left hover:bg-[var(--color-surface-hover)]/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{item.file_name}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {item.admin_name} &middot; {new Date(item.created_at + 'Z').toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-4">
                  <span className={`text-xs font-semibold ${item.failed > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {item.imported + item.updated} / {item.total_records}
                  </span>
                  <svg className={`w-4 h-4 text-[var(--color-text-secondary)] transition-transform ${expanded === item.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </svg>
                </div>
              </button>
              {expanded === item.id && (
                <div className="px-4 pb-4 border-t border-[var(--color-border)]/30 pt-3">
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    {[
                      { label: 'Imported', value: item.imported, color: 'text-green-500' },
                      { label: 'Updated', value: item.updated, color: 'text-blue-500' },
                      { label: 'Skipped', value: item.skipped, color: 'text-amber-500' },
                      { label: 'Duplicates', value: item.duplicate_count, color: 'text-amber-500' },
                      { label: 'Failed', value: item.failed, color: 'text-red-500' },
                      { label: 'Total', value: item.total_records, color: '' },
                    ].map(s => (
                      <div key={s.label} className="bg-[var(--color-surface-hover)]/50 rounded-lg p-2 text-center">
                        <div className={`text-sm font-bold ${s.color}`}>{s.value}</div>
                        <div className="text-[10px] text-[var(--color-text-secondary)]">{s.label}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    File: {item.file_name} &middot; {item.status}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
