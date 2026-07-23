import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';

export default function GuestBottomSheet({ guest, onClose, selectedActivity, onCheckIn, onUndoCheckIn, isAdmin }) {
  const sheetRef = useRef(null);
  const startY = useRef(0);
  const [checkins, setCheckins] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!guest) return;
    api.getGuestCheckins(guest.id).then(setCheckins).catch(() => {});
  }, [guest]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!guest) return null;

  const currentCi = checkins.find(c => c.activity_id === selectedActivity);
  const isCheckedIn = !!currentCi;

  const onTouchStart = (e) => { startY.current = e.touches[0].clientY; };
  const onTouchMove = (e) => {
    const dy = e.touches[0].clientY - startY.current;
    if (dy > 100) onClose();
  };

  const handleCheckInClick = async () => {
    if (!onCheckIn) return;
    setActionLoading(true);
    try {
      await onCheckIn(guest.id);
      onClose();
    } catch {} finally {
      setActionLoading(false);
    }
  };

  const handleUndoClick = async () => {
    if (!onUndoCheckIn || !currentCi) return;
    setActionLoading(true);
    try {
      await onUndoCheckIn(currentCi.id, guest.id);
      const cs = await api.getGuestCheckins(guest.id);
      setCheckins(cs);
    } catch {} finally {
      setActionLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div ref={sheetRef} onTouchStart={onTouchStart} onTouchMove={onTouchMove}
        className="relative w-full max-w-[640px] mx-auto bg-[var(--color-surface)] rounded-t-[24px] shadow-2xl animate-slide-up max-h-[85vh] overflow-y-auto"
      >
        <div className="flex justify-center pt-3 pb-1 sticky top-0 bg-[var(--color-surface)] z-10">
          <div className="w-10 h-1 rounded-full bg-[var(--color-border)]" />
        </div>

        <div className="px-5" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 24px)' }}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">{guest.name}</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">{guest.phone}</p>
            </div>
            <button onClick={onClose} className="btn btn-ghost btn-icon">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {guest.guest_count > 1 && (
              <span className="badge badge-blue">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
                </svg>
                {guest.guest_count} guests
              </span>
            )}
            {guest.table_number && <span className="badge badge-green">Table {guest.table_number}</span>}
            {guest.category && <span className="badge badge-amber">{guest.category}</span>}
            {guest.email && <span className="badge">{guest.email}</span>}
          </div>

          {guest.notes && (
            <div className="mb-4 p-3 bg-[var(--color-surface-hover)]/50 rounded-xl text-sm">
              <p className="text-[11px] text-[var(--color-text-secondary)] uppercase tracking-wider mb-0.5">Notes</p>
              {guest.notes}
            </div>
          )}

          <div className="mb-2">
            <p className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider mb-2">Activity History</p>
            {checkins.length === 0 ? (
              <p className="text-sm text-[var(--color-text-secondary)]">No check-ins yet</p>
            ) : (
              <div className="space-y-1.5">
                {checkins.map((c, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5 bg-[var(--color-surface-hover)]/50 rounded-xl text-sm">
                    <div>
                      <p className="font-medium">{c.activity_name}</p>
                      <p className="text-[12px] text-[var(--color-text-secondary)]">
                        {new Date(c.checked_in_at).toLocaleString()} · {c.staff_name}
                      </p>
                    </div>
                    <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedActivity && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border)]">
              {isCheckedIn ? (
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800/30 rounded-xl py-3.5 flex items-center justify-center gap-1.5 font-semibold text-sm">
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Checked In
                  </div>
                  {isAdmin && onUndoCheckIn && (
                    <button onClick={handleUndoClick} disabled={actionLoading} className="btn btn-secondary border-red-200 text-red-500 hover:bg-red-50 dark:border-red-950/50 dark:hover:bg-red-950/20">
                      {actionLoading ? '...' : 'Undo'}
                    </button>
                  )}
                </div>
              ) : (
                <button onClick={handleCheckInClick} disabled={actionLoading} className="btn btn-primary w-full py-3.5 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-blue-500/20">
                  {actionLoading ? (
                    <svg className="w-5 h-5 animate-spin text-white" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  )}
                  {actionLoading ? 'Checking In...' : 'Confirm Check-In'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
