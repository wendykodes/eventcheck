// Phase 2 PATH B — Staff entrance scanner. Flow: scan → validate → result →
// auto-ready for the next guest. Camera denial or errors fall back to manual
// search (never a dead end). Lazy-load this component to keep it out of the
// guest bundle.
import { useEffect, useRef, useState, useCallback } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { api } from '../api/client';

const ELEMENT_ID = 'staff-qr-reader';

function classify(err) {
  const msg = String(err?.message || '');
  if (/failed to fetch|network|offline|load failed/i.test(msg)) return { state: 'NETWORK', text: 'No connection — check-in was NOT recorded. Keep the guest here and retry or use manual search.' };
  if (/Already checked in/i.test(msg)) return { state: 'ALREADY', text: msg };
  if (/revoked|expired|no longer valid/i.test(msg)) return { state: 'REVOKED', text: msg };
  if (/different events|not valid for this event/i.test(msg)) return { state: 'WRONG_EVENT', text: msg };
  if (/not available|not open|CLOSING|CLOSED|ARCHIVED/i.test(msg)) return { state: 'CLOSED', text: msg };
  return { state: 'INVALID', text: msg || 'QR code not recognized.' };
}

export default function StaffScanner({ activityId, onCheckedIn, onFallback }) {
  const scannerRef = useRef(null);
  const busyRef = useRef(false);
  const resumeTimer = useRef(null);
  const [running, setRunning] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [result, setResult] = useState(null); // {state, text, guest_name, rsvp_status, ...}
  const [stats, setStats] = useState({ ok: 0, dup: 0, rej: 0 });

  const stop = useCallback(async () => {
    try { await scannerRef.current?.stop(); } catch {}
    try { await scannerRef.current?.clear(); } catch {}
    scannerRef.current = null;
    setRunning(false);
  }, []);

  const start = useCallback(async () => {
    if (scannerRef.current || !activityId) return;
    setCameraError('');
    setResult(null);
    try {
      const scanner = new Html5Qrcode(ELEMENT_ID);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText) => {
          if (busyRef.current) return;
          busyRef.current = true;
          try { await scanner.pause(); } catch {}
          try {
            const key = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
            const ci = await api.staffQrCheckin(decodedText, activityId, key);
            setResult({ state: 'SUCCESS', text: 'Checked in', guest_name: ci.guest_name || ci.guest?.name, rsvp_status: ci.rsvp_status, time: ci.checked_in_at, seat: ci.seat || null, token: decodedText, seated: !!(ci.seat && ci.seat.seated_at) });
            setStats((s) => ({ ...s, ok: s.ok + 1 }));
            onCheckedIn?.();
          } catch (err) {
            const c = classify(err);
            const dup = c.state === 'ALREADY';
            // Already checked in: pull the seat card so staff can still
            // direct + confirm seating without rescanning.
            let seat = null;
            if (dup) {
              try {
                const look = await api.seatLookup(decodedText);
                seat = look.seat || null;
                if (look.guest_name && !err?.guest_name) c.guest_name = look.guest_name;
              } catch {}
            }
            setResult({ ...c, guest_name: err?.guest_name || c.guest_name, token: decodedText, seat, seated: !!(seat && seat.seated_at) });
            setStats((s) => ({ ...s, ...(dup ? { dup: s.dup + 1 } : { rej: s.rej + 1 }) }));
          } finally {
            // Rapid next-scan flow: auto-ready without navigation.
            resumeTimer.current = setTimeout(async () => {
              setResult(null);
              busyRef.current = false;
              try { await scanner.resume(); } catch { busyRef.current = false; }
            }, 2500);
          }
        },
        () => {},
      );
      setRunning(true);
    } catch (e) {
      scannerRef.current = null;
      const denied = /permission|denied|notallowed|notfound|no camera/i.test(String(e?.message || e || ''));
      setCameraError(denied
        ? 'Camera unavailable (permission denied or no camera). Use manual search below — nothing is lost.'
        : `Scanner failed to start: ${e?.message || e}`);
    }
  }, [activityId, onCheckedIn]);

  useEffect(() => {
    start();
    return () => { clearTimeout(resumeTimer.current); stop(); };
  }, [start, stop]);

  if (cameraError) {
    return (
      <div className="card p-4 space-y-3 text-center">
        <p className="font-semibold">📷 Scanner unavailable</p>
        <p className="text-sm text-[var(--color-text-secondary)]">{cameraError}</p>
        {onFallback && <button onClick={onFallback} className="btn btn-primary w-full">Switch to manual search</button>}
        {!onFallback && <button onClick={start} className="btn btn-secondary w-full">Retry camera</button>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card p-3 overflow-hidden">
        <div id={ELEMENT_ID} className="w-full max-w-md mx-auto" />
        {!running && <p className="text-sm text-center animate-pulse py-4">Starting camera…</p>}
      </div>

      {result && (
        <div className={`card p-4 text-center space-y-1 animate-scale-in ${
          result.state === 'SUCCESS' ? 'border-green-500 border-2' : result.state === 'ALREADY' ? 'border-amber-500 border-2' : 'border-red-500 border-2'}`}>
          <p className="text-3xl">{result.state === 'SUCCESS' ? '✅' : result.state === 'ALREADY' ? '⚠️' : '⛔'}</p>
          <p className="font-bold text-lg">
            {result.state === 'SUCCESS' ? result.guest_name || 'Checked in'
              : result.state === 'ALREADY' ? `Already checked in${result.guest_name ? `: ${result.guest_name}` : ''}`
              : result.state === 'REVOKED' ? 'Invitation revoked'
              : result.state === 'WRONG_EVENT' ? 'Wrong event'
              : result.state === 'CLOSED' ? 'Check-in closed'
              : result.state === 'NETWORK' ? 'Network failure' : 'Invalid QR'}
          </p>
          <p className="text-sm text-[var(--color-text-secondary)]">{result.text}</p>
          {result.rsvp_status && <p className="text-xs text-[var(--color-text-secondary)]">RSVP: {result.rsvp_status}</p>}
          {result.time && <p className="text-xs text-[var(--color-text-secondary)]">{result.time}</p>}
          {result.seat && (
            <p className="font-bold">
              🪑 {result.seat.zone_name}{result.seated ? ' · seated' : ''}
              {result.seat.location ? <span className="block text-xs font-normal text-[var(--color-text-secondary)]">{result.seat.location}</span> : null}
            </p>
          )}
          {(result.state === 'SUCCESS' || result.state === 'ALREADY') && result.seat && !result.seated && (
            <button
              onClick={async () => {
                try {
                  await api.staffSeatConfirm(result.token);
                  setResult((r) => ({ ...r, seated: true, text: r.state === 'SUCCESS' ? 'Checked in + seated' : r.text }));
                } catch (e) {
                  setResult((r) => ({ ...r, text: `Seating confirm failed: ${e.message}` }));
                }
              }}
              className="btn btn-success btn-sm mx-auto"
            >
              Confirm seated
            </button>
          )}
          <button
            onClick={async () => { clearTimeout(resumeTimer.current); setResult(null); busyRef.current = false; try { await scannerRef.current?.resume(); } catch {} }}
            className="btn btn-secondary btn-sm mx-auto"
          >
            Scan next now
          </button>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 text-xs text-[var(--color-text-secondary)]">
        <span>✅ {stats.ok}</span><span>⚠️ {stats.dup}</span><span>⛔ {stats.rej}</span>
        {running && <button onClick={stop} className="btn btn-ghost btn-sm">Stop camera</button>}
        {!running && !cameraError && <button onClick={start} className="btn btn-ghost btn-sm">Start camera</button>}
      </div>
    </div>
  );
}
