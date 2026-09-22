// Phase 2 PATH A — Guest self-check-in (public, mobile-first, low-bandwidth).
// Guest scans the physical venue QR → this page → identifies with their
// invitation link/token → server validates → checked in. The venue QR alone
// grants nothing; without a valid invitation nothing privileged is exposed.
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';

export default function SelfCheckinPage() {
  const { code } = useParams();
  const [searchParams] = useSearchParams();
  const [event, setEvent] = useState(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('loading'); // loading|ready|working|done|error
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.resolveSelfCheckin(code);
        if (cancelled) return;
        setEvent(res.event);
        setOpen(!!res.checkin_open);
        setStatus('ready');
        const preset = searchParams.get('token');
        if (preset) {
          setToken(preset);
        } else {
          try {
            const last = localStorage.getItem('last_invite_token');
            if (last) setToken(last);
          } catch {}
        }
      } catch {
        if (cancelled) return;
        setError('This check-in point is not recognized.');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, searchParams]);

  const submit = async (e) => {
    e?.preventDefault();
    if (!token.trim()) {
      setError('Paste your invitation link or enter your invitation code.');
      return;
    }
    setStatus('working');
    setError('');
    try {
      const res = await api.selfCheckin(code, token.trim());
      setResult(res);
      setStatus('done');
    } catch (err) {
      setError(err.message || 'Check-in failed. Please see staff for help.');
      setStatus('ready');
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="animate-pulse font-semibold">Opening check-in…</p>
      </div>
    );
  }

  if (status === 'error' && !event) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-sm w-full text-center space-y-3">
          <h1 className="text-xl font-bold">Check-in unavailable</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  if (status === 'done' && result) {
    return (
      <div className="min-h-screen flex items-start justify-center p-4 pt-10">
        <div className="card p-6 max-w-md w-full text-center space-y-3">
          <div className="text-5xl">{result.already ? '👋' : '✅'}</div>
          <h1 className="text-2xl font-bold">{result.already ? 'Already checked in' : "You're checked in. Welcome!"}</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {result.guest_name}{result.checked_in_at ? ` · ${new Date(result.checked_in_at.replace(' ', 'T')).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
          <p className="text-xs text-[var(--color-text-secondary)]">{event?.name}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-10">
      <div className="card p-6 max-w-md w-full space-y-5">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">Check in to</p>
          <h1 className="text-2xl font-bold tracking-tight">{event?.name}</h1>
          {event?.venue && <p className="text-sm text-[var(--color-text-secondary)]">{event.venue}</p>}
        </div>
        {!open && (
          <p className="text-sm text-center text-amber-600 font-semibold">Check-in is not open yet. Please see staff if you need help.</p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <label className="block text-sm font-semibold" htmlFor="invite-token">Your invitation</label>
          <textarea
            id="invite-token"
            className="input w-full text-sm"
            rows={2}
            placeholder="Paste your invitation link here"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button type="submit" className="btn btn-success btn-lg w-full text-base" disabled={status === 'working' || !open}>
            {status === 'working' ? 'Checking in…' : 'Check me in'}
          </button>
          {error && <p className="text-xs text-red-500 text-center">{error}</p>}
        </form>
        <p className="text-xs text-center text-[var(--color-text-secondary)]">
          No invitation handy? Show your invitation QR to staff at the entrance instead.
        </p>
      </div>
    </div>
  );
}
