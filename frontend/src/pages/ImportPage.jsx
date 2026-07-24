import { useState, useRef, useCallback, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client';
import toast from 'react-hot-toast';

const STEPS = ['Upload', 'Map Columns', 'Preview', 'Import', 'Summary'];

const FIELD_OPTIONS = [
  { key: 'name', label: 'Full Name', required: true },
  { key: 'phone', label: 'Phone Number', required: false },
  { key: 'email', label: 'Email' },
  { key: 'guest_count', label: 'Guest Count' },
  { key: 'table_number', label: 'Table Number' },
  { key: 'category', label: 'Category' },
  { key: 'notes', label: 'Notes' },
];

const DUPLICATE_RULES = [
  { value: 'phone', label: 'Phone Number' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Full Name' },
  { value: 'phone_email', label: 'Phone or Email' },
  { value: 'name_phone', label: 'Name + Phone' },
  { value: 'all', label: 'Any Field' },
];

const DUPLICATE_ACTIONS = [
  { value: 'skip', label: 'Skip duplicates' },
  { value: 'update', label: 'Update existing guests' },
  { value: 'replace', label: 'Replace existing records' },
  { value: 'import_new', label: 'Import as new records' },
];

export default function ImportPage() {
  const { eventId } = useParams();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState('');

  const [sessionId, setSessionId] = useState(null);
  const [parsedColumns, setParsedColumns] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [sampleRows, setSampleRows] = useState([]);

  const [mapping, setMapping] = useState({});
  const [duplicateRule, setDuplicateRule] = useState('phone');
  const [duplicateAction, setDuplicateAction] = useState('skip');

  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (parsedColumns.length > 0) {
      const nameKeywords = ['name', 'guest name', 'fullname', 'full name', 'guest'];
      const phoneKeywords = ['phone', 'phone number', 'telephone', 'contact', 'mobile', 'tel'];
      const emailKeywords = ['email', 'e-mail', 'email address'];
      const tableKeywords = ['table', 'table number', 'table no', 'seating'];
      const countKeywords = ['count', 'guest count', 'guests', 'no of guests', 'number of guests', 'pax', 'size'];
      const categoryKeywords = ['category', 'group', 'type'];
      const notesKeywords = ['notes', 'note', 'comments', 'comment', 'description'];

      const autoMapping = {};
      parsedColumns.forEach(col => {
        const val = col.toLowerCase().trim();
        if (nameKeywords.some(k => val === k || val.includes(k)) && !autoMapping.name) {
          autoMapping.name = col;
        } else if (phoneKeywords.some(k => val === k || val.includes(k)) && !autoMapping.phone) {
          autoMapping.phone = col;
        } else if (emailKeywords.some(k => val === k || val.includes(k)) && !autoMapping.email) {
          autoMapping.email = col;
        } else if (tableKeywords.some(k => val === k || val.includes(k)) && !autoMapping.table_number) {
          autoMapping.table_number = col;
        } else if (countKeywords.some(k => val === k || val.includes(k)) && !autoMapping.guest_count) {
          autoMapping.guest_count = col;
        } else if (categoryKeywords.some(k => val === k || val.includes(k)) && !autoMapping.category) {
          autoMapping.category = col;
        } else if (notesKeywords.some(k => val === k || val.includes(k)) && !autoMapping.notes) {
          autoMapping.notes = col;
        }
      });

      // Guess by value for any columns not matched by header keywords
      if (sampleRows && sampleRows.length > 0) {
        parsedColumns.forEach(col => {
          const values = sampleRows
            .map(row => String(row[col] ?? '').trim())
            .filter(v => v !== '');

          if (values.length === 0) return;

          // Guess phone: digit counts are high, or starts with +
          const isPhoneGuess = values.every(v => {
            const digits = v.replace(/\D/g, '');
            return digits.length >= 7 || (v.startsWith('+') && digits.length >= 5);
          });

          // Guess email: has @ and .
          const isEmailGuess = values.every(v => v.includes('@') && v.includes('.'));

          // Guess name: contains letters, no numbers, length >= 2
          const isNameGuess = values.every(v => /^[a-zA-Z\s'.]+$/.test(v) && v.length >= 2);

          if (isPhoneGuess && !autoMapping.phone) {
            autoMapping.phone = col;
          } else if (isEmailGuess && !autoMapping.email) {
            autoMapping.email = col;
          } else if (isNameGuess && !autoMapping.name) {
            autoMapping.name = col;
          }
        });
      }

      setMapping(autoMapping);
    }
  }, [parsedColumns, sampleRows]);

  const handleFileSelect = useCallback(async (file) => {
    if (!file) return;
    setFileName(file.name);
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        try {
          const base64 = evt.target.result.split(',')[1];
          const res = await api.parseImportFile(base64, file.name);
          setSessionId(res.session_id);
          setParsedColumns(res.columns);
          setTotalRows(res.total_rows);
          setSampleRows(res.sample_rows);
          setLoading(false);
          setStep(1);
        } catch (err) {
          toast.error(err.message);
          setLoading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      toast.error(err.message);
      setLoading(false);
    }
  }, []);

  const onFileInput = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }, [handleFileSelect]);

  const handleDragOver = (e) => e.preventDefault();

  const updateMapping = (field, column) => {
    setMapping(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => { if (next[k] === column && k !== field) next[k] = ''; });
      next[field] = column;
      return next;
    });
  };

  const handlePreview = async () => {
    if (!mapping.name) {
      toast.error('Map at least Full Name column');
      return;
    }
    setLoading(true);
    try {
      const res = await api.previewImport(eventId, sessionId, mapping, duplicateRule);
      setPreview(res);
      setStep(2);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const handleConfirm = async () => {
    setLoading(true);
    setStep(3);
    try {
      const res = await api.confirmImport(eventId, sessionId, duplicateAction, fileName);
      setResult(res);
      setStep(4);
    } catch (err) {
      toast.error(err.message);
      setResult({ error: err.message });
      setStep(4);
    }
    setLoading(false);
  };

  const StatCard = ({ label, value, color }) => (
    <div className="bg-[var(--color-surface-hover)]/50 rounded-xl p-3 text-center">
      <div className={`text-xl font-bold ${color || ''}`}>{value}</div>
      <div className="text-[11px] text-[var(--color-text-secondary)] mt-0.5">{label}</div>
    </div>
  );

  return (
    <div className="page-card max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold">Import Guests</h1>
        <Link to={`/events/${eventId}/guests`} className="text-sm text-primary-500 hover:underline">Back to Guests</Link>
      </div>

      <div className="flex items-center gap-1 mb-6 overflow-x-auto">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center gap-1 shrink-0">
            <div className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold ${
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-primary-500 text-white' : 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
            }`}>
              {i < step ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] font-medium hidden sm:inline ${i === step ? 'text-primary-500' : 'text-[var(--color-text-secondary)]'}`}>{s}</span>
            {i < STEPS.length - 1 && <div className="w-6 h-px bg-[var(--color-border)] mx-1" />}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-[var(--color-border)] rounded-2xl p-12 text-center cursor-pointer hover:border-primary-400 transition-colors"
        >
          <svg className="w-12 h-12 mx-auto mb-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="text-lg font-medium mb-1">Upload your guest list</p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">Supports CSV, Excel (.xlsx, .xls)</p>
          <span className="btn btn-primary">Choose File</span>
          <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" onChange={onFileInput} className="hidden" />
          {loading && <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Parsing file...</p>}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-5">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Map columns from <strong>{fileName}</strong> ({totalRows} records found):
          </p>

          <div className="space-y-3">
            {FIELD_OPTIONS.map(field => (
              <div key={field.key} className="flex items-center gap-3">
                <label className="w-32 text-sm font-medium shrink-0">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-0.5">*</span>}
                </label>
                <select
                  value={mapping[field.key] || ''}
                  onChange={e => updateMapping(field.key, e.target.value)}
                  className="input flex-1"
                >
                  <option value="">-- Skip --</option>
                  {parsedColumns.map(col => (
                    <option key={col} value={col} disabled={Object.values(mapping).includes(col) && mapping[field.key] !== col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="w-32 text-sm font-medium shrink-0">Duplicate Rule</label>
            <select value={duplicateRule} onChange={e => setDuplicateRule(e.target.value)} className="input flex-1">
              {DUPLICATE_RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>

          <div className="bg-[var(--color-surface-hover)]/50 rounded-xl p-4">
            <p className="text-xs font-medium text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">Sample Data (first {sampleRows.length} rows)</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[var(--color-text-secondary)]">
                    {parsedColumns.map(col => <th key={col} className="text-left py-1 pr-3 font-medium whitespace-nowrap">{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {sampleRows.map((row, i) => (
                    <tr key={i} className="border-t border-[var(--color-border)]/30">
                      {parsedColumns.map(col => <td key={col} className="py-1 pr-3 truncate max-w-[120px]">{String(row[col] ?? '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(0)} className="btn btn-ghost flex-1">Back</button>
            <button onClick={handlePreview} className="btn btn-primary flex-1" disabled={!mapping.name || loading}>
              {loading ? 'Analyzing...' : 'Preview Import'}
            </button>
          </div>
        </div>
      )}

      {step === 2 && preview && (
        <div className="space-y-5">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Review results before importing. <strong>{preview.total}</strong> total records.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <StatCard label="Total" value={preview.total} />
            <StatCard label="Valid" value={preview.valid} color="text-green-500" />
            <StatCard label="Duplicates" value={preview.duplicates} color="text-amber-500" />
            <StatCard label="Invalid" value={preview.invalid} color="text-red-500" />
            <StatCard label="Warnings" value={preview.warnings} color="text-primary-500" />
          </div>

          {preview.invalid > 0 && (
            <div className="bg-red-500/10 rounded-xl p-4">
              <p className="text-sm font-semibold text-red-400 mb-2">Validation Errors ({preview.errors.length})</p>
              <div className="space-y-1 max-h-32 overflow-y-auto text-xs text-red-300">
                {preview.errors.map((err, i) => (
                  <p key={i}>Row {err.row}: {err.reason}</p>
                ))}
              </div>
            </div>
          )}

          <div className="bg-[var(--color-surface-hover)]/50 rounded-xl max-h-60 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--color-surface-hover)]">
                <tr className="text-[var(--color-text-secondary)]">
                  <th className="text-left py-2 px-3 font-medium">#</th>
                  <th className="text-left py-2 px-3 font-medium">Name</th>
                  <th className="text-left py-2 px-3 font-medium">Phone</th>
                  <th className="text-left py-2 px-3 font-medium hidden sm:table-cell">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row, i) => (
                  <tr key={i} className="border-t border-[var(--color-border)]/30">
                    <td className="py-1.5 px-3 text-[var(--color-text-secondary)]">{i + 1}</td>
                    <td className="py-1.5 px-3">{row.name || '-'}</td>
                    <td className="py-1.5 px-3">{row.phone || '-'}</td>
                    <td className="py-1.5 px-3 hidden sm:table-cell">
                      {row.duplicate_type
                        ? <span className="text-amber-400">Duplicate ({row.duplicate_type})</span>
                        : row.warnings?.length
                          ? <span className="text-primary-400" title={row.warnings.join(', ')}>Warning</span>
                          : <span className="text-green-400">OK</span>
                      }
                    </td>
                  </tr>
                ))}
                {preview.rows.length > 100 && (
                  <tr><td colSpan={4} className="py-3 text-center text-xs text-[var(--color-text-secondary)]">+{preview.rows.length - 100} more records</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.duplicates > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Duplicate Handling</label>
              <select value={duplicateAction} onChange={e => setDuplicateAction(e.target.value)} className="input">
                {DUPLICATE_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={() => setStep(1)} className="btn btn-ghost flex-1">Back</button>
            <button onClick={handleConfirm} className="btn btn-primary flex-1" disabled={loading}>
              {loading ? 'Importing...' : `Import ${preview.valid} Records`}
            </button>
          </div>
        </div>
      )}

      {step === 3 && loading && (
        <div className="text-center py-12">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm text-[var(--color-text-secondary)]">Importing guests...</p>
        </div>
      )}

      {step === 4 && result && (
        <div className="space-y-5">
          {result.error ? (
            <div className="text-center py-4">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <h2 className="text-lg font-bold mb-1">Import Failed</h2>
              <p className="text-sm text-[var(--color-text-secondary)] mb-4">{result.error}</p>
              <button onClick={() => setStep(0)} className="btn btn-primary">Try Again</button>
            </div>
          ) : (
            <>
              <div className="text-center py-4">
                <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                  <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <h2 className="text-lg font-bold">Import Complete</h2>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <StatCard label="Total" value={result.total} />
                <StatCard label="Imported" value={result.imported} color="text-green-500" />
                <StatCard label="Updated" value={result.updated} color="text-primary-500" />
                <StatCard label="Skipped" value={result.skipped} color="text-amber-500" />
                <StatCard label="Duplicates" value={result.duplicate_count} color="text-amber-500" />
                <StatCard label="Failed" value={result.failed} color="text-red-500" />
              </div>

              <div className="flex gap-3 pt-2">
                <Link to={`/events/${eventId}/guests`} className="btn btn-primary flex-1 text-center">View Guests</Link>
                <Link to={`/events/${eventId}/import/history`} className="btn btn-ghost flex-1 text-center">Import History</Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
