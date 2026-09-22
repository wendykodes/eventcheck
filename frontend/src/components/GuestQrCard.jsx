// Organizer-side guest QR card (Phase 2). Encodes the guest's invitation link —
// the same credential the guest sees on their own phone. For printed cards,
// WhatsApp sharing, or entrance lists. Print CSS isolates the card.
import QrImage from './QrImage';

// Shared print isolation for all QR posters (guest cards + venue poster).
// Only #qr-print-area / #venue-qr-print survive printing; .no-print never does.
export function QrPrintStyle() {
  return (
    <style>{`@media print { body * { visibility: hidden; } #qr-print-area, #qr-print-area *, #venue-qr-print, #venue-qr-print * { visibility: visible; } #qr-print-area, #venue-qr-print { position: absolute; inset: 0; margin: 0 auto; } .no-print { display: none !important; } }`}</style>
  );
}

export default function GuestQrCard({ guestName, eventName, link, size = 180 }) {
  if (!link) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[var(--color-border)] bg-white text-black">
      <QrImage value={link} size={size} />
      <p className="font-bold text-sm text-center leading-tight">{guestName}</p>
      {eventName && <p className="text-[11px] text-neutral-600 text-center">{eventName}</p>}
      <p className="text-[10px] text-neutral-500 text-center">Show at entrance</p>
    </div>
  );
}
