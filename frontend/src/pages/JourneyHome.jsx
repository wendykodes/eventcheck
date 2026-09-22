// Guest Journey home (Event Companion). Two entries, one experience:
//   /self-checkin/:code  — generic venue QR (identify via token input/prefill)
//   /journey/:token      — invitation link (automatic recognition)
// Identity is automatic (token → server-resolved context); check-in, seating
// confirmation, and requests stay explicit taps. Accountless throughout.
import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import QrImage from '../components/QrImage';

const STATUS_LABEL = {
  received: ['Request received', 'The team has your request.'],
  preparing: ['Being prepared', "We're preparing your order."],
  delivered: ['Delivered', 'Enjoy!'],
  cancelled: ['Cancelled', 'This request was cancelled.'],
};

const KIND_LABEL = { DRINK: '🍹 Drinks', BITE: '🍢 Bites', ASSISTANCE: '🙋 Assistance', OTHER: '✨ More' };

export default function JourneyHome() {
  const { code, token: routeToken } = useParams();
  const [searchParams] = useSearchParams();
  const [token, setToken] = useState(routeToken || '');
  const [input, setInput] = useState('');
  const [ctx, setCtx] = useState(null);
  const [menu, setMenu] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState('loading'); // loading|identify|ready|working|error
  const [error, setError] = useState('');
  const [event, setEvent] = useState(null);
  const [open, setOpen] = useState(true);
  const [showWayfinding, setShowWayfinding] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [notice, setNotice] = useState('');

  const loadContext = useCallback(async (tok) => {
    const c = await api.journeyContext(tok);
    setCtx(c);
    try {
      const [m, r] = await Promise.all([
        c.state === 'SEATED' || c.state === 'DIRECTED' || c.state === 'CHECKED_IN' ? api.journeyMenu(tok).catch(() => []) : Promise.resolve([]),
        api.journeyRequests(tok).catch(() => []),
      ]);
      setMenu(m || []);
      setRequests(r || []);
    } catch {}
    return c;
  }, []);

  // Entry: venue QR → resolve event; invite link → identify immediately.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (routeToken) {
          setToken(routeToken);
          setStatus('working');
          const c = await api.journeyContext(routeToken);
          if (cancelled) return;
          setCtx(c);
          setEvent(c.event);
          const [m, r] = await Promise.all([api.journeyMenu(routeToken).catch(() => []), api.journeyRequests(routeToken).catch(() => [])]);
          if (cancelled) return;
          setMenu(m || []);
          setRequests(r || []);
          setStatus('ready');
          try { localStorage.setItem('last_invite_token', routeToken); } catch {}
          return;
        }
        const res = await api.resolveSelfCheckin(code);
        if (cancelled) return;
        setEvent(res.event);
        setOpen(!!res.checkin_open);
        const preset = searchParams.get('token');
        if (preset) {
          setToken(preset);
          setStatus('working');
          const c = await api.journeyContext(preset);
          if (cancelled) return;
          setCtx(c);
          const [m, r] = await Promise.all([api.journeyMenu(preset).catch(() => []), api.journeyRequests(preset).catch(() => [])]);
          if (cancelled) return;
          setMenu(m || []);
          setRequests(r || []);
          setStatus('ready');
        } else {
          try {
            const last = localStorage.getItem('last_invite_token');
            if (last) setInput(last);
          } catch {}
          setStatus('identify');
        }
      } catch {
        if (cancelled) return;
        setError(code ? 'This check-in point is not recognized.' : 'Invitation not recognized.');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [code, routeToken, searchParams]);

  const identify = async (e) => {
    e?.preventDefault();
    const tok = (input || '').trim();
    if (!tok) {
      setError('Paste your invitation link or enter your invitation code.');
      return;
    }
    setStatus('working');
    setError('');
    try {
      const c = await loadContext(tok);
      setToken(tok);
      setEvent(c.event);
      try { localStorage.setItem('last_invite_token', tok); } catch {}
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Invitation not recognized.');
      setStatus(code ? 'identify' : 'error');
    }
  };

  const checkIn = async () => {
    setStatus('working');
    setError('');
    setNotice('');
    try {
      await api.journeyCheckin(token);
      setNotice("You're checked in. Welcome!");
      const c = await loadContext(token);
      setStatus('ready');
      void c;
    } catch (err) {
      setError(err.message || 'Check-in failed. Please see staff.');
      setStatus('ready');
    }
  };

  const confirmSeat = async () => {
    setStatus('working');
    setError('');
    try {
      await api.journeySeatConfirm(token);
      setNotice('Enjoy the event!');
      await loadContext(token);
      setStatus('ready');
    } catch (err) {
      setError(err.message || 'Could not confirm seating.');
      setStatus('ready');
    }
  };

  const askHelp = async (category = 'SEATING_ASSISTANCE') => {
    setError('');
    try {
      const res = await api.journeyCreateRequest(token, { category });
      setRequests((prev) => [{ ...res.request, guest_status: 'received' }, ...prev]);
      setNotice(res.duplicate ? 'Help is already on the way.' : 'Help is on the way.');
      const c = await loadContext(token);
      void c;
    } catch (err) {
      setError(err.message || 'Could not send the request. Please find a staff member.');
    }
  };

  const orderItem = async (item) => {
    setError('');
    try {
      const res = await api.journeyCreateRequest(token, { menu_item_id: item.id });
      setRequests((prev) => [{ ...res.request, guest_status: 'received' }, ...prev.filter((x) => x.id !== res.request.id)]);
      setNotice(res.duplicate ? 'Already ordered — the team has it.' : 'Request received.');
    } catch (err) {
      setError(err.message || 'Could not place the request.');
    }
  };

  if (status === 'loading' || status === 'working' && !ctx) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <p className="animate-pulse font-semibold">{status === 'working' ? 'Recognizing you…' : 'Opening…'}</p>
      </div>
    );
  }

  if (status === 'error' && !ctx && !event) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="card p-6 max-w-sm w-full text-center space-y-3">
          <h1 className="text-xl font-bold">Unavailable</h1>
          <p className="text-sm text-[var(--color-text-secondary)]">{error}</p>
        </div>
      </div>
    );
  }

  const state = ctx?.state || null;
  const checkedIn = state === 'CHECKED_IN' || state === 'DIRECTED' || state === 'SEATED';
  const seated = state === 'SEATED';
  const groups = {};
  for (const item of menu) {
    (groups[item.kind] = groups[item.kind] || []).push(item);
  }

  return (
    <div className="min-h-screen flex items-start justify-center p-4 pt-8">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">
            {ctx ? `Welcome${ctx.guest?.name ? `, ${ctx.guest.name.split(' ')[0]}` : ''}!` : `Check in to`}
          </p>
          <h1 className="text-2xl font-bold tracking-tight">{(ctx?.event || event)?.name}</h1>
          {(ctx?.event || event)?.venue && <p className="text-sm text-[var(--color-text-secondary)]">{(ctx?.event || event).venue}</p>}
        </div>

        {notice && (
          <div className="card p-4 text-center bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700 border">
            <p className="font-bold text-green-700 dark:text-green-300">{notice}</p>
          </div>
        )}
        {error && <p className="text-xs text-red-500 text-center">{error}</p>}

        {/* Identify */}
        {!ctx && (
          <div className="card p-6 space-y-4">
            {!open && <p className="text-sm text-center text-amber-600 font-semibold">Check-in is not open yet. Please see staff if you need help.</p>}
            <form onSubmit={identify} className="space-y-3">
              <label className="block text-sm font-semibold" htmlFor="invite-token">Your invitation</label>
              <textarea id="invite-token" className="input w-full text-sm" rows={2}
                placeholder="Paste your invitation link here" value={input} onChange={(e) => setInput(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-lg w-full text-base" disabled={status === 'working' || !open}>
                Continue
              </button>
            </form>
            <p className="text-xs text-center text-[var(--color-text-secondary)]">No invitation handy? Show your invitation QR to staff instead.</p>
          </div>
        )}

        {/* Check-in */}
        {ctx && !checkedIn && (
          <div className="card p-6 text-center space-y-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {ctx.rsvp_status === 'confirmed' ? 'Your RSVP is confirmed.' : 'Good to see you.'}
            </p>
            <button onClick={checkIn} disabled={status === 'working' || !ctx.checkin_open} className="btn btn-success btn-lg w-full text-lg py-4">
              {status === 'working' ? 'Checking in…' : 'Check me in'}
            </button>
            {!ctx.checkin_open && <p className="text-sm text-amber-600 font-semibold">Check-in is not open yet.</p>}
          </div>
        )}

        {/* Seat */}
        {ctx && checkedIn && !seated && (
          <div className="space-y-3">
            {ctx.seat ? (
              <div className="card p-6 text-center space-y-2">
                <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">Your seat</p>
                <p className="text-3xl font-black">{ctx.seat.zone_name}</p>
                {ctx.seat.location && <p className="text-sm text-[var(--color-text-secondary)]">{ctx.seat.location}</p>}
                <div className="flex gap-2 pt-2">
                  <button onClick={() => setShowWayfinding((s) => !s)} className="btn btn-secondary flex-1">
                    {showWayfinding ? 'Hide directions' : 'Show me where'}
                  </button>
                  <button onClick={confirmSeat} disabled={status === 'working'} className="btn btn-success flex-1">
                    I&apos;m at my seat
                  </button>
                </div>
              </div>
            ) : (
              <div className="card p-6 text-center space-y-3">
                <p className="font-bold text-lg">Welcome!</p>
                <p className="text-sm text-[var(--color-text-secondary)]">A member of our team will help you find your seat.</p>
                <button onClick={() => askHelp('SEATING_ASSISTANCE')} className="btn btn-primary btn-lg w-full">
                  Request seating assistance
                </button>
              </div>
            )}
            {showWayfinding && ctx.seat && <Wayfinding zones={ctx.venue_zones || []} mine={ctx.seat.zone_name} />}
          </div>
        )}

        {/* Seated: service home */}
        {ctx && seated && (
          <div className="space-y-3">
            <div className="card p-5 text-center">
              <p className="text-xs uppercase tracking-widest text-[var(--color-text-secondary)]">You&apos;re seated</p>
              <p className="text-2xl font-black">{ctx.seat.zone_name}</p>
              {ctx.seat.location && <p className="text-xs text-[var(--color-text-secondary)] mt-1">{ctx.seat.location}</p>}
            </div>

            <p className="font-bold text-center pt-1">What can we help you with?</p>
            {Object.keys(KIND_LABEL).filter((k) => groups[k]?.length).map((kind) => (
              <div key={kind} className="card p-4 space-y-2">
                <p className="font-bold">{KIND_LABEL[kind]}</p>
                {groups[kind].map((item) => (
                  <button key={item.id} onClick={() => orderItem(item)} className="btn btn-secondary w-full justify-between">
                    <span>{item.label}</span><span aria-hidden>＋</span>
                  </button>
                ))}
              </div>
            ))}
            <button onClick={() => askHelp('ASSISTANCE')} className="btn btn-ghost w-full">🙋 Ask for help</button>

            {requests.length > 0 && (
              <div className="card p-4 space-y-2">
                <p className="font-bold">Your requests</p>
                {requests.map((rq) => {
                  const [title, sub] = STATUS_LABEL[rq.guest_status] || STATUS_LABEL.received;
                  return (
                    <div key={rq.id} className="flex items-center gap-3 py-1.5 border-t border-[var(--color-border)] first:border-0">
                      <span className="text-xl" aria-hidden>{rq.guest_status === 'delivered' ? '✅' : rq.guest_status === 'preparing' ? '👨‍🍳' : '🧾'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{rq.description}</p>
                        <p className="text-xs text-[var(--color-text-secondary)]">{title}{sub && rq.guest_status !== 'delivered' ? ` — ${sub}` : ''}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="text-center">
              <button onClick={() => setShowPass((s) => !s)} className="btn btn-ghost btn-sm">
                {showPass ? 'Hide my pass' : 'Show my pass'}
              </button>
              {showPass && (
                <div className="card p-4 mt-2 inline-block">
                  <QrImage value={inviteUrl(token)} size={180} label="Show to staff if you need help" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function inviteUrl(token) {
  if (!token) return '';
  if (/^https?:\/\//i.test(token)) {
    return token.includes('/invite/') ? token : '';
  }
  return `${window.location.origin}/invite/${token}`;
}

function Wayfinding({ zones, mine }) {
  if (!zones.length) return null;
  return (
    <div className="card p-4 space-y-2">
      <p className="font-bold">Finding your way</p>
      {zones.map((z, i) => (
        <div key={i} className={`p-3 rounded-xl border-2 ${z.mine || z.zone_name === mine ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-[var(--color-border)]'}`}>
          <p className="font-bold text-sm">
            {z.mine || z.zone_name === mine ? '📍 ' : ''}{z.zone_name}
            {(z.mine || z.zone_name === mine) && ' — YOU'}
          </p>
          {z.location && <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">{z.location}</p>}
        </div>
      ))}
      <p className="text-[11px] text-[var(--color-text-secondary)]">Follow signs to your area, or ask any staff member.</p>
    </div>
  );
}
