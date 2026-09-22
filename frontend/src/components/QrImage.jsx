// Shared QR renderer (Phase 2). High-contrast black-on-white with quiet zone
// (margin) so it scans from screens and paper under venue lighting.
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

export default function QrImage({ value, size = 220, label }) {
  const canvasRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    if (!value || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, value, {
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#ffffff' },
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [value, size]);

  if (!value) return null;
  if (failed) return <p className="text-xs text-red-500 text-center">Could not render QR code.</p>;
  return (
    <div className="flex flex-col items-center gap-1">
      <canvas ref={canvasRef} className="rounded bg-white" style={{ width: size, height: size }} role="img" aria-label={label || 'QR code'} />
      {label && <p className="text-[11px] text-[var(--color-text-secondary)] break-all text-center">{label}</p>}
    </div>
  );
}
