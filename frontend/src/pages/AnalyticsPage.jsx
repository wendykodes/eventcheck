import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../hooks/useAuth';
import DonutChart from '../components/DonutChart';
import EventTabs from '../components/EventTabs';

export default function AnalyticsPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  const [event, setEvent] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [timeRange, setTimeRange] = useState('all'); // all, day1, day2, etc.
  const [compareEvents, setCompareEvents] = useState([]);
  const [comparisonData, setComparisonData] = useState(null);

  const getHeatmapColor = (value) => {
    if (value === 0) return '#e5e7eb';
    if (value < 5) return '#93c5fd';
    if (value < 10) return '#60a5fa';
    if (value < 20) return '#3b82f6';
    return '#1d4ed8';
  };

  useEffect(() => {
    loadEvent();
    loadAnalytics();
  }, [eventId, timeRange]);

  const loadEvent = async () => {
    try {
      const data = await api.getEvent(eventId);
      setEvent(data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const loadAnalytics = async () => {
    try {
      const data = await api.getEventAnalytics(eventId);
      setAnalytics(data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch(`/api/events/${eventId}/analytics/export`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `analytics-${eventId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Analytics exported');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCompare = async () => {
    if (compareEvents.length < 2) {
      toast.error('Select at least 2 events to compare');
      return;
    }
    try {
      const ids = [...compareEvents, eventId].join(',');
      const data = await api.compareEvents(ids);
      setComparisonData(data);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /><SkeletonCard lines={4} /></div>;

  if (!analytics) {
    return (
      <div className="pt-2">
        <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)] hover:text-primary-500 transition-colors">← Back to Event</Link>
        <EmptyState
          title="Analytics not available"
          message="This event must be closed to generate analytics"
        />
      </div>
    );
  }

  const {
    rsvp_summary,
    attendance_timeline,
    peak_arrival,
    checkin_by_activity,
    staff_performance,
    incident_summary,
  } = analytics;

  return (
    <div className="pt-2 space-y-5 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Event Results</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {event?.name || 'Event'} · {event?.lifecycle_state === 'ACTIVE' ? 'Happening Now' : event?.lifecycle_state === 'CLOSED' ? 'Finished' : event?.lifecycle_state || 'Unknown'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="btn btn-secondary btn-sm">
            Export CSV
          </button>
          <button onClick={() => setComparisonData(!comparisonData ? {} : null)} className="btn btn-secondary btn-sm">
            Compare Events
          </button>
        </div>
      </div>

      <EventTabs currentKey="analytics" adminOnly={true} />

      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {event?.name || 'Event'} · Post-event report
          </p>
        </div>
        <select
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="input-field w-40"
        >
          <option value="all">All Time</option>
          <option value="day1">Day 1</option>
          <option value="day2">Day 2</option>
          <option value="day3">Day 3</option>
        </select>
      </div>

      {/* RSVP Summary */}
      <div className="card p-4">
        <h2 className="section-title">RSVP Summary</h2>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="card p-3 bg-green-50 dark:bg-green-900/20">
            <div className="text-[20px] font-bold text-green-600">{rsvp_summary?.confirmed || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Confirmed</div>
          </div>
          <div className="card p-3 bg-red-50 dark:bg-red-900/20">
            <div className="text-[20px] font-bold text-red-600">{rsvp_summary?.declined || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Declined</div>
          </div>
          <div className="card p-3 bg-gray-50 dark:bg-gray-900/20">
            <div className="text-[20px] font-bold">{rsvp_summary?.no_response || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">No Response</div>
          </div>
          <div className="card p-3 bg-blue-50 dark:bg-blue-900/20">
            <div className="text-[20px] font-bold text-blue-600">{rsvp_summary?.response_rate || 0}%</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Response Rate</div>
          </div>
        </div>
      </div>

      {/* Attendance Timeline */}
      <div className="card p-4">
        <h2 className="section-title">Attendance Timeline</h2>
        <div className="mt-3 space-y-2">
          {attendance_timeline?.map((entry, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="text-[11px] text-[var(--color-text-secondary)] w-20">{entry.time}</div>
              <div className="flex-1 progress-bar">
                <div className="progress-fill" style={{ width: `${entry.percent}%` }} />
              </div>
              <div className="text-[11px] font-medium w-12 text-right">{entry.checked_in}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Peak Arrival */}
      {peak_arrival && (
        <div className="card p-4 border-l-4 border-l-amber-500">
          <h2 className="section-title">Peak Arrival Time</h2>
          <div className="mt-2">
            <div className="text-[24px] font-bold text-amber-600">{peak_arrival.time}</div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">
              {peak_arrival.count} guests checked in ({peak_arrival.percent}% of total)
            </div>
          </div>
        </div>
      )}

      {/* Attendance Heatmap */}
      {analytics.heatmap && (
        <div className="card p-4">
          <h2 className="section-title">Attendance Heatmap</h2>
          <div className="mt-3">
            <div className="text-[11px] text-[var(--color-text-secondary)] mb-2">
              When people arrived
            </div>
            <div className="grid grid-cols-12 gap-1">
              {analytics.heatmap.map((cell, i) => (
                <div
                  key={i}
                  className="aspect-square rounded"
                  style={{
                    backgroundColor: getHeatmapColor(cell.value),
                    opacity: cell.value > 0 ? 0.3 + (cell.value / Math.max(...analytics.heatmap.map(c => c.value))) * 0.7 : 0.1
                  }}
                  title={`${cell.hour}:00 - ${cell.value} check-ins`}
                />
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 text-[10px] text-[var(--color-text-secondary)]">
              <span>Low activity</span>
              <div className="flex gap-1">
                <div className="w-4 h-4 rounded bg-blue-100" />
                <div className="w-4 h-4 rounded bg-blue-300" />
                <div className="w-4 h-4 rounded bg-blue-500" />
                <div className="w-4 h-4 rounded bg-blue-700" />
              </div>
              <span>High activity</span>
            </div>
          </div>
        </div>
      )}

      {/* Check-in by Activity */}
      <div className="card p-4">
        <h2 className="section-title">Arrivals by Activity</h2>
        <div className="mt-3 space-y-3">
          {checkin_by_activity?.map((activity, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex-1">
                <div className="font-medium text-[14px]">{activity.name}</div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {activity.checked_in} check-ins
                </div>
              </div>
              <DonutChart value={activity.checked_in} max={activity.total} size={50} strokeWidth={4} />
            </div>
          ))}
        </div>
      </div>

      {/* Staff Performance */}
      <div className="card p-4">
        <h2 className="section-title">How Staff Did</h2>
        <div className="mt-3 space-y-2">
          {staff_performance?.map((staff, i) => (
            <div key={i} className="card p-3 bg-[var(--color-surface)]">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-[14px]">{staff.name}</span>
                <span className="text-[11px] px-2 py-0.5 rounded-full badge-green">
                  {staff.checkins} check-ins
                </span>
              </div>
              <div className="flex gap-4 text-[11px] text-[var(--color-text-secondary)]">
                <span>Peak: {staff.peak_time}</span>
                <span>Avg/hour: {staff.avg_per_hour}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Incident Summary */}
      <div className="card p-4">
        <h2 className="section-title">Incident Summary</h2>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <div className="card p-3">
            <div className="text-[20px] font-bold">{incident_summary?.total || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Total Incidents</div>
          </div>
          <div className="card p-3">
            <div className="text-[20px] font-bold text-red-600">{incident_summary?.critical || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Critical</div>
          </div>
          <div className="card p-3">
            <div className="text-[20px] font-bold text-amber-600">{incident_summary?.avg_resolution_time || '0m'}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Avg Resolution</div>
          </div>
          <div className="card p-3">
            <div className="text-[20px] font-bold text-green-600">{incident_summary?.resolved || 0}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Resolved</div>
          </div>
        </div>
      </div>

      {/* Event Comparison */}
      {comparisonData && (
        <div className="card p-4">
          <h2 className="section-title">Event Comparison</h2>
          <div className="mt-3 space-y-3">
            {comparisonData.map((item, i) => (
              <div key={i} className="p-3 bg-[var(--color-surface)] rounded">
                <div className="font-medium text-sm">Event ID: {item.event_id}</div>
                <div className="text-xs text-[var(--color-text-secondary)] mt-1">
                  RSVP: {item.analytics.rsvp_summary?.confirmed || 0} confirmed · 
                  Incidents: {item.analytics.incident_summary?.total || 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Link to={`/events/${eventId}`} className="btn btn-secondary">Back to Event</Link>
        <button onClick={() => window.print()} className="btn btn-primary">Print Report</button>
      </div>
    </div>
  );
}
