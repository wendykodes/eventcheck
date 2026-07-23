import { useEffect, useRef } from 'react';

export default function Modal({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', variant = 'danger', onConfirm, onCancel, hideActions, children }) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
      const handler = (e) => { if (e.key === 'Escape') onCancel(); };
      document.addEventListener('keydown', handler);
      return () => document.removeEventListener('keydown', handler);
    }
  }, [open, onCancel]);

  if (!open) return null;

  const variants = {
    danger: { icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z', color: '#ff453a' },
    warning: { icon: 'M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z', color: '#ff9f0a' },
    info: { icon: 'M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z', color: '#0071e3' },
    success: { icon: 'M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z', color: '#30d158' },
  };
  const v = variants[variant] || variants.danger;
  const isDestructive = variant === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onCancel}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in" />
      <div
        className="relative w-full sm:max-w-sm bg-[var(--color-surface)] sm:rounded-2xl rounded-t-2xl p-6 animate-slide-up shadow-2xl max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={{ animationDelay: '0.05s' }}
      >
        <div className="flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: `${v.color}15` }}>
            <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke={v.color} strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d={v.icon} />
            </svg>
          </div>
          <div className="w-full">
            <h3 className="text-lg font-semibold text-[var(--color-text)]">{title}</h3>
            {message && <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">{message}</p>}
          </div>
          {children && <div className="w-full text-left">{children}</div>}
          {!hideActions && (
            <div className="flex flex-col gap-2 w-full mt-2">
              <button ref={confirmRef} onClick={onConfirm}
                className={`w-full py-3 rounded-2xl font-semibold text-sm transition-all active:scale-[0.98] ${
                  isDestructive ? 'bg-[#ff453a] text-white' : 'bg-blue-500 text-white'
                }`}
              >{confirmLabel}</button>
              <button onClick={onCancel}
                className="w-full py-3 rounded-2xl font-semibold text-sm bg-[var(--color-surface-hover)] text-[var(--color-text)] transition-all active:scale-[0.98]"
              >{cancelLabel}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
