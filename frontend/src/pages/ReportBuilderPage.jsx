import { useState } from 'react';
import toast from 'react-hot-toast';
import { api } from '../api/client';

const AVAILABLE_FIELDS = [
  { key: 'guest_name', label: 'Guest Name', type: 'text' },
  { key: 'guest_email', label: 'Guest Email', type: 'text' },
  { key: 'checkin_time', label: 'Check-in Time', type: 'datetime' },
  { key: 'checkout_time', label: 'Check-out Time', type: 'datetime' },
  { key: 'zone', label: 'Zone', type: 'text' },
  { key: 'table', label: 'Table', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  { key: 'requests_count', label: 'Requests Count', type: 'number' },
  { key: 'staff_name', label: 'Staff Name', type: 'text' },
  { key: 'shift_start', label: 'Shift Start', type: 'datetime' },
  { key: 'shift_end', label: 'Shift End', type: 'datetime' },
  { key: 'duration', label: 'Duration (min)', type: 'number' },
];

const REPORT_TYPES = [
  { key: 'checkins', label: 'Check-ins Report' },
  { key: 'staff', label: 'Staff Activity Report' },
  { key: 'shifts', label: 'Shifts Report' },
  { key: 'requests', label: 'Service Requests Report' },
];

export default function ReportBuilder() {
  const [reportType, setReportType] = useState('checkins');
  const [selectedFields, setSelectedFields] = useState(['guest_name', 'checkin_time', 'zone']);
  const [filters, setFilters] = useState({});
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const availableFields = AVAILABLE_FIELDS.filter(f => 
    reportType === 'staff' ? f.key.startsWith('staff') || f.key === 'duration' :
    reportType === 'shifts' ? f.key.startsWith('shift') || f.key === 'staff_name' :
    reportType === 'requests' ? f.key.includes('request') || f.key.startsWith('guest') :
    !f.key.startsWith('staff') && !f.key.startsWith('shift')
  );

  const toggleField = (fieldKey) => {
    setSelectedFields(prev =>
      prev.includes(fieldKey)
        ? prev.filter(f => f !== fieldKey)
        : [...prev, fieldKey]
    );
  };

  const handleFilterChange = (key, value) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      // Simulate report generation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mock data - in production, this would call the actual API
      const mockData = {
        headers: selectedFields.map(f => AVAILABLE_FIELDS.find(af => af.key === f)?.label || f),
        rows: [
          ['John Doe', '2024-01-15 10:30', 'Main Hall'],
          ['Jane Smith', '2024-01-15 10:45', 'VIP Lounge'],
          ['Bob Johnson', '2024-01-15 11:00', 'Outdoor'],
        ],
        summary: {
          total: 3,
          generatedAt: new Date().toISOString()
        }
      };
      
      setReportData(mockData);
      setShowPreview(true);
      toast.success('Report generated successfully');
    } catch (err) {
      toast.error('Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const exportCSV = () => {
    if (!reportData) return;
    
    const csv = [
      reportData.headers.join(','),
      ...reportData.rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${reportType}-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  };

  const exportPDF = () => {
    toast.info('PDF export coming soon');
  };

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1">
        <h1 className="text-[22px] font-bold tracking-tight">Report Builder</h1>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Create custom reports with your selected fields
        </p>
      </div>

      {/* Report Type Selection */}
      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">Report Type</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {REPORT_TYPES.map(type => (
            <button
              key={type.key}
              onClick={() => {
                setReportType(type.key);
                setSelectedFields([]);
              }}
              className={`p-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                reportType === type.key
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>
      </div>

      {/* Field Selection */}
      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">Select Fields</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {availableFields.map(field => (
            <button
              key={field.key}
              onClick={() => toggleField(field.key)}
              className={`p-2 rounded-lg border text-xs transition-colors ${
                selectedFields.includes(field.key)
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-600'
                  : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'
              }`}
            >
              {field.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
          {selectedFields.length} field{selectedFields.length !== 1 ? 's' : ''} selected
        </p>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <label className="block text-sm font-medium mb-2">Filters (Optional)</label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Date Range</label>
            <select
              value={filters.dateRange || ''}
              onChange={(e) => handleFilterChange('dateRange', e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All time</option>
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
              <option value="custom">Custom range</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-[var(--color-text-secondary)] mb-1">Zone</label>
            <select
              value={filters.zone || ''}
              onChange={(e) => handleFilterChange('zone', e.target.value)}
              className="input-field text-sm"
            >
              <option value="">All zones</option>
              <option value="main">Main Hall</option>
              <option value="vip">VIP Lounge</option>
              <option value="outdoor">Outdoor</option>
            </select>
          </div>
        </div>
      </div>

      {/* Generate Button */}
      <button
        onClick={generateReport}
        disabled={selectedFields.length === 0 || loading}
        className="btn btn-primary w-full py-3"
      >
        {loading ? 'Generating...' : 'Generate Report'}
      </button>

      {/* Report Preview */}
      {showPreview && reportData && (
        <div className="card p-4 space-y-4 animate-slide-up">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold">Report Preview</h2>
            <div className="flex gap-2">
              <button onClick={exportCSV} className="btn btn-secondary btn-sm">
                Export CSV
              </button>
              <button onClick={exportPDF} className="btn btn-secondary btn-sm">
                Export PDF
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-hover)]">
                <tr>
                  {reportData.headers.map((header, idx) => (
                    <th key={idx} className="px-3 py-2 text-left font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {reportData.rows.map((row, rowIdx) => (
                  <tr key={rowIdx}>
                    {row.map((cell, cellIdx) => (
                      <td key={cellIdx} className="px-3 py-2">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-[var(--color-text-secondary)]">
            Total records: {reportData.summary.total} · Generated: {new Date(reportData.summary.generatedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
