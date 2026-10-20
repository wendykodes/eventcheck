import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function RsvpReportPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // all, confirmed, declined, no_response
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    loadReport();
  }, [eventId, page, search]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const data = await api.getRsvpReport(eventId, page, 50, search);
      setReport(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    setExporting(true);
    try {
      api.exportRsvpReport(eventId);
      toast.success('Export started');
    } catch (err) {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={8} /></div>;
  if (!report) return <EmptyState title="Report unavailable" message="Could not load RSVP report." />;

  const { summary, dietary, timeline, by_channel, response_time, party_size_dist, checkin_by_status, details, pagination } = report;

  const filteredDetails = details.filter(d => {
    if (filter === 'all') return true;
    const status = d.status ? d.status.toLowerCase() : 'no_response';
    return status === filter;
  });

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">RSVP Report</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {report.event.name}{report.event.date ? ` · ${report.event.date}` : ''}{report.event.venue ? ` · ${report.event.venue}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadReport} className="btn btn-secondary btn-sm">
            Refresh
          </button>
          <button onClick={handleExport} disabled={exporting} className="btn btn-primary btn-sm">
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>

      <EventTabs currentKey="invites" adminOnly={true} />

      {/* Summary Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold">{summary.invited}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Invited</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{summary.confirmed}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Confirmed</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{summary.declined}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Declined</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-gray-600">{summary.no_response}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">No Response</p>
        </div>
      </div>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{summary.response_rate}%</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Response Rate</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{summary.acceptance_rate}%</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Acceptance Rate</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{summary.avg_party_size}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Avg Party Size</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{summary.opened}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Opened</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xl font-bold">{summary.checked_in}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Checked In</p>
        </div>
      </div>

      {/* Response Time Distribution */}
      {response_time.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Response Time Distribution</h2>
          <div className="space-y-2">
            {response_time.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-sm w-24">{item.time_bucket}</span>
                <div className="flex-1 progress-bar">
                  <div className="progress-fill" style={{ width: `${(item.count / (summary.confirmed + summary.declined)) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold w-12 text-right">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Party Size Distribution */}
      {party_size_dist.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Party Size Distribution</h2>
          <div className="space-y-2">
            {party_size_dist.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <span className="text-sm w-24">{item.size_bucket}</span>
                <div className="flex-1 progress-bar">
                  <div className="progress-fill" style={{ width: `${(item.count / summary.confirmed) * 100}%` }} />
                </div>
                <span className="text-sm font-semibold w-12 text-right">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dietary Preferences */}
      {dietary.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Dietary Preferences</h2>
          <div className="space-y-2">
            {dietary.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-[var(--color-bg-secondary)] rounded">
                <span className="text-sm">{item.dietary_preferences}</span>
                <span className="text-sm font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response Timeline */}
      {timeline.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Response Timeline</h2>
          <div className="space-y-2">
            {timeline.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-[var(--color-bg-secondary)] rounded">
                <div>
                  <span className="text-sm font-medium">{item.date}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                    ({item.confirmed} confirmed, {item.declined} declined)
                  </span>
                </div>
                <span className="text-sm font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Response by Channel */}
      {by_channel.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Response by Channel</h2>
          <div className="space-y-2">
            {by_channel.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-[var(--color-bg-secondary)] rounded">
                <div>
                  <span className="text-sm font-medium">{item.responded_via}</span>
                  <span className="text-xs text-[var(--color-text-secondary)] ml-2">
                    ({item.confirmed} confirmed)
                  </span>
                </div>
                <span className="text-sm font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Check-in by Status */}
      {checkin_by_status.length > 0 && (
        <div className="card p-4">
          <h2 className="section-title">Check-in by RSVP Status</h2>
          <div className="space-y-2">
            {checkin_by_status.map((item, idx) => (
              <div key={idx} className="flex justify-between items-center p-2 bg-[var(--color-bg-secondary)] rounded">
                <span className="text-sm font-medium">{item.status || 'No Response'}</span>
                <span className="text-sm font-semibold">{item.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Detailed Guest List */}
      <div className="card p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-3">
          <h2 className="section-title">Guest Details</h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="px-3 py-1 text-sm rounded border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
            />
            <div className="flex flex-wrap gap-1">
              {['all', 'confirmed', 'declined', 'no_response'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2 py-1 rounded ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="bg-[var(--color-surface-hover)] sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Guest</th>
                  <th className="px-3 py-2 text-left font-semibold">Status</th>
                  <th className="px-3 py-2 text-left font-semibold">Party</th>
                  <th className="px-3 py-2 text-left font-semibold">Dietary</th>
                  <th className="px-3 py-2 text-left font-semibold">Via</th>
                  <th className="px-3 py-2 text-left font-semibold">Responded</th>
                  <th className="px-3 py-2 text-left font-semibold">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filteredDetails.map((d, idx) => (
                  <tr key={d.guest_id} className="animate-slide-up" style={{animationDelay: `${idx * 10}ms`}}>
                    <td className="px-3 py-2">
                      <p className="font-medium">{d.name}</p>
                      {d.phone && <p className="text-xs text-[var(--color-text-secondary)]">{d.phone}</p>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                        d.status === 'CONFIRMED' ? 'bg-green-100 text-green-800' :
                        d.status === 'DECLINED' ? 'bg-red-100 text-red-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {d.status ? d.status.toLowerCase() : 'no response'}
                      </span>
                    </td>
                    <td className="px-3 py-2">{d.attendee_count || d.guest_count || 1}</td>
                    <td className="px-3 py-2 text-xs">{d.dietary_preferences || '-'}</td>
                    <td className="px-3 py-2 text-xs">{d.responded_via || '-'}</td>
                    <td className="px-3 py-2 text-xs">{d.responded_at ? new Date(d.responded_at).toLocaleDateString() : '-'}</td>
                    <td className="px-3 py-2 text-xs max-w-32 truncate" title={d.guest_note}>{d.guest_note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[var(--color-border)]">
            <p className="text-xs text-[var(--color-text-secondary)]">
              Showing {((page - 1) * 50) + 1}-{Math.min(page * 50, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn btn-secondary btn-sm"
              >
                Previous
              </button>
              <span className="text-sm self-center px-2">Page {page} of {pagination.totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                disabled={page === pagination.totalPages}
                className="btn btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
