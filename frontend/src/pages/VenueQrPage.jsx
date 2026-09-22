// Phase 2 — Printable physical event/venue check-in QR (manager/RaaS operator).
// The QR encodes only the self-check-in entry URL: public, guest-independent,
// grants no access by itself. Print guidance: large, high contrast, quiet zone.
import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import QrImage from '../components/QrImage';
import { QrPrintStyle } from '../components/GuestQrCard';

export default function VenueQrPage() {
  const { eventId } = useParams();
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [qr, ev] = await Promise.all([api.getVenueQr(eventId), api.getEvent(eventId)]);
      setData(qr);
      setEvent(ev);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => { load(); }, [load]);

  const rotate = async () => {
    if (!window.confirm('Generate a new check-in QR? Previously printed posters will stop working.')) return;
    try {
      const qr = await api.rotateVenueQr(eventId);
      setData((d) => ({ ...d, ...qr }));
      toast.success('New check-in QR generated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <p className="p-4 animate-pulse">Loading check-in QR…</p>;
  if (!data) return <p className="p-4">Could not load the check-in QR.</p>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <QrPrintStyle />
      <div className="flex items-center justify-between px-1 no-print">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Entrance QR</h1>
          <Link to={`/events/${eventId}`} className="text-[13px] text-[var(--color-text-secondary)]">← Dashboard</Link>
        </div>
      </div>

      <div id="venue-qr-print" className="max-w-xl mx-auto bg-white text-black overflow-hidden rounded-2xl border-2 border-black print:border-0 print:rounded-none print:max-w-none">
        {/* Headline band */}
        <div className="bg-black text-white text-center px-6 pt-7 pb-6">
          <p className="text-xs font-bold tracking-[0.3em] uppercase opacity-80">Event check-in</p>
          <h2 className="text-5xl font-black tracking-tight leading-none mt-2">CHECK IN<br />HERE</h2>
          <p className="text-sm font-semibold mt-3 opacity-90">Scan with your phone camera — no app needed</p>
        </div>

        {/* QR */}
        <div className="flex justify-center px-6 pt-6">
          <div className="border-4 border-black rounded-xl p-3 bg-white">
            <QrImage value={data.url} size={300} />
          </div>
        </div>

        {/* Steps */}
        <div className="grid grid-cols-3 gap-2 px-6 pt-6 text-center">
          {[
            ['1', 'Scan', 'Point your camera at the code'],
            ['2', 'Identify', 'Paste your invitation link'],
            ['3', 'Enter', "You're checked in. Welcome!"],
          ].map(([n, title, sub]) => (
            <div key={n} className="space-y-1">
              <p className="w-8 h-8 mx-auto rounded-full bg-black text-white font-black flex items-center justify-center">{n}</p>
              <p className="font-black text-sm uppercase tracking-wide">{title}</p>
              <p className="text-[11px] leading-tight text-neutral-700">{sub}</p>
            </div>
          ))}
        </div>

        {/* Event identity */}
        <div className="text-center px-6 pt-6">
          <p className="text-2xl font-black leading-tight">{event?.name}</p>
          {(event?.venue || event?.date) && (
            <p className="text-sm font-semibold mt-1">{[event?.venue, event?.date].filter(Boolean).join('  ·  ')}</p>
          )}
        </div>

        {/* Footer */}
        <div className="mx-6 mt-6 mb-7 border-t-2 border-dashed border-neutral-400 pt-4 text-center">
          <p className="text-sm font-bold">No invitation link handy?</p>
          <p className="text-xs mt-1 text-neutral-700">Show your invitation QR to staff at the entrance — they&apos;ll check you in.</p>
        </div>
      </div>

      <div className="flex gap-2 justify-center no-print">
        <button onClick={() => window.print()} className="btn btn-primary">Print poster</button>
        {isAdmin && <button onClick={rotate} className="btn btn-secondary">Generate new QR</button>}
      </div>
      <p className="text-xs text-center text-[var(--color-text-secondary)] no-print">
        Status: {data.checkin_open ? 'check-in is open' : 'check-in is not open (lifecycle)'} · Print at least A5, black on white, keep margin around the code.
      </p>
    </div>
  );
}
