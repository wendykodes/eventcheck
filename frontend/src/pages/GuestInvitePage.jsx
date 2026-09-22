// Phase 1 — Passwordless guest invitation + RSVP (Workstreams 4/5).
// Public, mobile-first, low-data, no account. One job: show event, take response.

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import QrImage from '../components/QrImage';

export default function GuestInvitePage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | done | error
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.openGuestInvite(token);
        if (cancelled) return;
        setData(res);
        setStatus(res.rsvp_status && res.rsvp_status !== 'no_response' ? 'done' : 'ready');
        try { localStorage.setItem('last_invite_token', token); } catch {}
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Could not open this invitation.');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const respond = async (response) => {
    setSubmitting(response);
    try {
      const res = await api.submitRsvp(token, response, note || undefined);
      setData((d) => ({ ...d, rsvp_status: res.rsvp_status }));
      setStatus('done');
    } catch (err) {
      setError(err.message || 'We could not save your response. Please try again.');
      setStatus((s) => (data ? s : 'error'));
    } finally {
      setSubmitting(null);
    }
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try { await navigator.share({ title: data?.event?.name || 'Event invitation', url }); } catch {}
    } else {
      try { await navigator.clipboard.writeText(url); } catch {}
    }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="text-center">
          <div className="animate-pulse text-lg font-semibold">Opening your invitation…</div>
        </div>
      </div>
    );
  }

  if (status === 'error' && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-sm w-full text-center space-y-3">
          <h1 className="text-xl font-bold">Invitation unavailable</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">If you believe this is a mistake, please contact the event organizer.</p>
        </div>
      </div>
    );
  }

  const rsvp = data.rsvp_status;

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-10">
      <div className="card p-6 max-w-md w-full space-y-5">
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">You&apos;re invited to</p>
          <h1 className="text-2xl font-bold tracking-tight">{data.event.name}</h1>
          {data.guest?.name && <p className="text-sm text-[var(--color-text-secondary)]">Dear {data.guest.name},</p>}
        </div>

        <div className="text-sm space-y-1.5 border-y border-[var(--color-border)] py-4">
          {data.event.date && <p><span className="font-semibold">Date: </span>{data.event.date}</p>}
          {data.event.venue && <p><span className="font-semibold">Venue: </span>{data.event.venue}</p>}
          {data.event.description && <p className="text-[var(--color-text-secondary)]">{data.event.description}</p>}
        </div>

        {status === 'done' ? (
          <div className="text-center space-y-3">
            <div className={`text-lg font-bold ${rsvp === 'confirmed' ? 'text-green-600' : 'text-[var(--color-text)]'}`}>
              {rsvp === 'confirmed' ? "You're confirmed." : 'Your response has been recorded.'}
            </div>
            <p className="text-sm text-[var(--color-text-secondary)]">
              {rsvp === 'confirmed' ? 'We look forward to seeing you.' : 'Thank you for letting us know.'}
            </p>
            {rsvp === 'confirmed' && (
              <div className="pt-1 space-y-2">
                <QrImage value={window.location.href} size={200} />
                <p className="text-sm font-semibold">Show this QR code at the entrance</p>
                <p className="text-xs text-[var(--color-text-secondary)]">Staff will scan it to check you in. You can also scan the event QR at the entrance to check yourself in.</p>
              </div>
            )}
            <button className="btn btn-secondary btn-sm mx-auto" onClick={() => setStatus('ready')}>
              Change my response
            </button>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              className="input w-full text-sm"
              rows={2}
              maxLength={500}
              placeholder="Optional note for the organizer (e.g. dietary needs)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <button
              className="btn btn-success btn-lg w-full text-base"
              disabled={!!submitting}
              onClick={() => respond('confirmed')}
            >
              {submitting === 'confirmed' ? 'Confirming…' : 'Confirm Attendance'}
            </button>
            <button
              className="btn btn-secondary btn-lg w-full text-base"
              disabled={!!submitting}
              onClick={() => respond('declined')}
            >
              {submitting === 'declined' ? 'Saving…' : 'Decline'}
            </button>
            {error && <p className="text-xs text-red-500 text-center">{error}</p>}
          </div>
        )}

        <button className="btn btn-ghost btn-sm w-full text-xs" onClick={share}>
          Share this invitation
        </button>
      </div>
    </div>
  );
}
