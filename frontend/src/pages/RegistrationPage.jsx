import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';

const WEAK_PINS = new Set(['1111', '1234', '0000', '9999', '1212', '4321', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '1122', '2211', '1221', '2112']);
const MAX_PIN_LEN = 6;

function isPinWeak(pin) {
  if (WEAK_PINS.has(pin)) return true;
  if (/^(\d)\1{3,}$/.test(pin)) return true;
  if (/^12(3(4(5(6)?)?)?)?$/.test(pin)) return true;
  return false;
}

export default function RegistrationPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [eventData, setEventData] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', access_code: '' });
  const [pin, setPin] = useState(new Array(MAX_PIN_LEN).fill(''));
  const [activeIdx, setActiveIdx] = useState(0);
  const [confirmPin, setConfirmPin] = useState(new Array(MAX_PIN_LEN).fill(''));
  const [confirmActiveIdx, setConfirmActiveIdx] = useState(0);
  const [pinError, setPinError] = useState('');
  const [result, setResult] = useState(null);
  const pinRef = useRef(null);

  useEffect(() => {
    if (step === 2) pinRef.current?.focus();
  }, [step]);

  const pinStr = pin.join('').slice(0, Math.max(4, pin.reduce((acc, d, i) => d ? i + 1 : acc, 0)));
  const confirmPinStr = confirmPin.join('').slice(0, Math.max(4, confirmPin.reduce((acc, d, i) => d ? i + 1 : acc, 0)));

  const validatePin = (val) => {
    if (val.length < 4) return 'PIN must be at least 4 digits';
    if (isPinWeak(val)) return 'This PIN is too common. Choose a stronger one.';
    return '';
  };

  const handlePinDigit = (d) => {
    if (activeIdx >= MAX_PIN_LEN) return;
    const next = [...pin];
    next[activeIdx] = d;
    setPin(next);
    const newIdx = Math.min(activeIdx + 1, MAX_PIN_LEN);
    setActiveIdx(newIdx);
    const val = next.join('').slice(0, Math.max(4, newIdx));
    setPinError(validatePin(val));
  };

  const handlePinDelete = () => {
    if (activeIdx === 0) return;
    const next = [...pin];
    const newIdx = activeIdx - 1;
    next[newIdx] = '';
    setPin(next);
    setActiveIdx(newIdx);
    const val = next.join('').slice(0, Math.max(4, newIdx));
    setPinError(val.length >= 4 ? validatePin(val) : '');
  };

  const handleConfirmDigit = (d) => {
    if (confirmActiveIdx >= MAX_PIN_LEN) return;
    const next = [...confirmPin];
    next[confirmActiveIdx] = d;
    setConfirmPin(next);
    setConfirmActiveIdx(i => Math.min(i + 1, MAX_PIN_LEN));
  };

  const handleConfirmDelete = () => {
    if (confirmActiveIdx === 0) return;
    const next = [...confirmPin];
    next[confirmActiveIdx - 1] = '';
    setConfirmPin(next);
    setConfirmActiveIdx(i => Math.max(i - 1, 0));
  };

  const lookupCode = async () => {
    if (!form.access_code.trim()) return toast.error('Enter an access code');
    setLoading(true);
    try {
      const event = await api.lookupAccessCode(form.access_code.trim());
      setEventData(event);
      setStep(1);
    } catch (err) {
      toast.error(err.message || 'Invalid access code');
    }
    setLoading(false);
  };

  const submit = async () => {
    const p = pin.join('');
    if (p.length < 4) return toast.error('PIN must be at least 4 digits');
    if (isPinWeak(p)) return toast.error('This PIN is too common. Choose a stronger one.');
    if (p !== confirmPin.join('')) return toast.error('PINs do not match');
    setLoading(true);
    try {
      const res = await api.register({
        name: form.name.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        access_code: form.access_code.trim(),
        pin: p,
      });
      setResult(res);
      setStep(4);
    } catch (err) {
      if (err.message.includes('already in use')) {
        setPinError(err.message);
        setStep(2);
        setPin(new Array(MAX_PIN_LEN).fill(''));
        setActiveIdx(0);
        setConfirmPin(new Array(MAX_PIN_LEN).fill(''));
        setConfirmActiveIdx(0);
        toast.error(err.message);
      } else {
        toast.error(err.message);
      }
    }
    setLoading(false);
  };

  const renderStepIndicator = () => {
    const steps = ['Code', 'Info', 'PIN', 'Submit'];
    return (
      <div className="flex items-center justify-center gap-1 mb-8">
        {steps.map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${
              i < step ? 'bg-green-500 text-white' : i === step ? 'bg-primary-500 text-white ring-2 ring-primary-500/30 ring-offset-2 ring-offset-[var(--color-surface-secondary)]' : 'bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]'
            }`}>
              {i < step ? (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              ) : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className={`w-8 h-0.5 rounded-full transition-colors duration-300 ${i < step ? 'bg-green-500' : 'bg-[var(--color-border)]'}`} />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-secondary)]">
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">

          {step < 4 && (
            <div className="text-center mb-6 animate-fade-in">
              <div className="w-16 h-16 rounded-[22px] bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center mx-auto mb-4 shadow-xl shadow-primary-500/25 ring-1 ring-white/10">
                <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                </svg>
              </div>
              <h1 className="text-[26px] font-bold tracking-tight text-[var(--color-text)]">Join Event Staff</h1>
              <p className="text-sm text-[var(--color-text-secondary)] mt-1.5 leading-relaxed">
                Register to get access to your event and start checking in guests.
              </p>
            </div>
          )}

          {renderStepIndicator()}

          {step === 0 && (
            <div className="card p-6 space-y-5 animate-scale-in" style={{ animationDelay: '0.05s' }}>
              <div className="bg-gradient-to-br from-primary-50 to-orange-50 dark:from-primary-900/10 dark:to-orange-900/10 rounded-2xl p-4 text-center">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  Enter the access code provided by your event organizer. Each event has a unique code.
                </p>
              </div>
              <div>
                <label className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2 block">Event Access Code</label>
                <input value={form.access_code} onChange={e => setForm(f => ({...f, access_code: e.target.value.toUpperCase()}))}
                  placeholder="e.g. WEDDING2026"
                  className="input text-center text-xl font-bold tracking-[0.3em] uppercase bg-[var(--color-surface-hover)] border-2 border-transparent focus:border-primary-500/30 h-14 rounded-2xl"
                  autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') lookupCode(); }} />
              </div>
              <button onClick={lookupCode} disabled={loading || !form.access_code.trim()}
                className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20">
                {loading ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Verifying...
                  </span>
                ) : 'Continue'}
              </button>
              <p className="text-center text-xs text-[var(--color-text-secondary)]">
                Already have an account?{' '}
                <Link to="/login" className="text-primary-500 hover:underline font-medium">Log in</Link>
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="card p-6 space-y-4 animate-scale-in" style={{ animationDelay: '0.05s' }}>
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/10 dark:to-emerald-900/10 rounded-2xl p-4 text-center border border-green-500/10">
                <div className="flex items-center justify-center gap-2 mb-1">
                  <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-semibold text-green-600 dark:text-green-400">Code Verified</span>
                </div>
                <p className="text-[17px] font-bold text-[var(--color-text)]">{eventData?.name}</p>
              </div>

              <div>
                <label className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2 block">Full Name *</label>
                <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                  placeholder="Your full name" className="input h-13 rounded-2xl bg-[var(--color-surface-hover)]" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2 block">Phone</label>
                  <input value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))}
                    placeholder="Optional" className="input h-12 rounded-2xl bg-[var(--color-surface-hover)]" />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2 block">Email</label>
                  <input value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))}
                    placeholder="Optional" type="email" className="input h-12 rounded-2xl bg-[var(--color-surface-hover)]" />
                </div>
              </div>

              <button onClick={() => { if (!form.name.trim()) return toast.error('Name is required'); setStep(2); }}
                className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20">
                Continue
              </button>
              <button onClick={() => setStep(0)} className="btn btn-ghost w-full text-sm text-[var(--color-text-secondary)]">Back</button>
            </div>
          )}

          {step === 2 && (
            <div className="card p-6 space-y-5 animate-scale-in" style={{ animationDelay: '0.05s' }}>
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <h2 className="text-[20px] font-bold tracking-tight mb-1">Create Your PIN</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">Choose a 4–6 digit PIN. Avoid common patterns.</p>
              </div>

              <div className="flex justify-center gap-2.5 mb-2">
                {Array.from({ length: MAX_PIN_LEN }).map((_, i) => (
                  <div key={i} className={`w-10 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all duration-200 border-2 ${
                    pin[i] ? 'bg-primary-500 border-primary-500 text-white scale-105 shadow-md shadow-primary-500/30' : i === activeIdx ? 'bg-[var(--color-surface)] border-primary-500' : 'bg-[var(--color-surface-hover)] border-transparent'
                  }`}>
                    {pin[i] ? '●' : ''}
                  </div>
                ))}
              </div>

              {pinError && (
                <p className="text-xs text-red-500 text-center animate-fade-in bg-red-500/5 rounded-xl py-2 px-3">
                  {pinError}
                </p>
              )}

              {pinStr.length >= 4 && !pinError && (
                <p className="text-xs text-green-500 text-center animate-fade-in bg-green-500/5 rounded-xl py-2 px-3">
                  PIN looks good!
                </p>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                {[1,2,3,4,5,6,7,8,9].map(d => (
                  <button key={d} type="button" onClick={() => handlePinDigit(String(d))}
                    className="h-[52px] text-[20px] font-bold rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[var(--color-text)] transition-all"
                  >{d}</button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <button type="button" onClick={() => { setPin(new Array(MAX_PIN_LEN).fill('')); setActiveIdx(0); setPinError(''); }}
                  className="h-[52px] rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[13px] font-semibold text-red-500 transition-all"
                >Clear</button>
                <button type="button" onClick={() => handlePinDigit('0')}
                  className="h-[52px] text-[20px] font-bold rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[var(--color-text)] transition-all"
                >0</button>
                <button type="button" onClick={handlePinDelete}
                  className="h-[52px] rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 transition-all flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                  </svg>
                </button>
              </div>

              <button onClick={() => { setStep(3); }} disabled={pinStr.length < 4 || !!pinError}
                className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20 disabled:shadow-none">
                Continue
              </button>
              <button onClick={() => setStep(1)} className="btn btn-ghost w-full text-sm text-[var(--color-text-secondary)]">Back</button>
            </div>
          )}

          {step === 3 && (
            <div className="card p-6 space-y-5 animate-scale-in" style={{ animationDelay: '0.05s' }}>
              <div className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-primary-500/10 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                  </svg>
                </div>
                <h2 className="text-[20px] font-bold tracking-tight mb-1">Confirm Your PIN</h2>
                <p className="text-sm text-[var(--color-text-secondary)]">Enter it again to make sure.</p>
              </div>

              <div className="flex justify-center gap-2.5 mb-2">
                {Array.from({ length: MAX_PIN_LEN }).map((_, i) => (
                  <div key={i} className={`w-10 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all duration-200 border-2 ${
                    confirmPin[i] ? 'bg-primary-500 border-primary-500 text-white scale-105 shadow-md shadow-primary-500/30' : i === confirmActiveIdx ? 'bg-[var(--color-surface)] border-primary-500' : 'bg-[var(--color-surface-hover)] border-transparent'
                  }`}>
                    {confirmPin[i] ? '●' : ''}
                  </div>
                ))}
              </div>

              {confirmPinStr.length >= pinStr.length && confirmPinStr !== pinStr && (
                <p className="text-xs text-red-500 text-center animate-fade-in bg-red-500/5 rounded-xl py-2 px-3">
                  PINs do not match
                </p>
              )}
              {confirmPinStr === pinStr && pinStr.length >= 4 && (
                <p className="text-xs text-green-500 text-center animate-fade-in bg-green-500/5 rounded-xl py-2 px-3">
                  PINs match!
                </p>
              )}

              <div className="grid grid-cols-3 gap-2.5">
                {[1,2,3,4,5,6,7,8,9].map(d => (
                  <button key={d} type="button" onClick={() => handleConfirmDigit(String(d))}
                    className="h-[52px] text-[20px] font-bold rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[var(--color-text)] transition-all"
                  >{d}</button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <button type="button" onClick={() => { setConfirmPin(new Array(MAX_PIN_LEN).fill('')); setConfirmActiveIdx(0); }}
                  className="h-[52px] rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[13px] font-semibold text-red-500 transition-all"
                >Clear</button>
                <button type="button" onClick={() => handleConfirmDigit('0')}
                  className="h-[52px] text-[20px] font-bold rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 text-[var(--color-text)] transition-all"
                >0</button>
                <button type="button" onClick={handleConfirmDelete}
                  className="h-[52px] rounded-2xl bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] active:scale-95 transition-all flex items-center justify-center"
                >
                  <svg className="w-5 h-5 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                  </svg>
                </button>
              </div>

              <button onClick={submit} disabled={loading || confirmPinStr !== pinStr || pinStr.length < 4}
                className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20 disabled:shadow-none">
                {loading ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Submitting...
                  </span>
                ) : 'Submit Registration'}
              </button>
              <button onClick={() => { setStep(2); setConfirmPin(new Array(MAX_PIN_LEN).fill('')); setConfirmActiveIdx(0); }}
                className="btn btn-ghost w-full text-sm text-[var(--color-text-secondary)]">Back</button>
            </div>
          )}

          {step === 4 && result && (
            <div className="animate-scale-in" style={{ animationDelay: '0.05s' }}>
              {result.auto_approved ? (
                <div className="card p-8 text-center space-y-5">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center mx-auto shadow-xl shadow-green-500/25">
                    <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-[22px] font-bold tracking-tight mb-2">Welcome!</h2>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      You're registered for <strong className="text-[var(--color-text)]">{result.event_name}</strong>.
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)] mt-1">You can now log in with your PIN.</p>
                  </div>
                  <Link to="/login" className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20">
                    Log In
                  </Link>
                </div>
              ) : (
                <div className="text-center space-y-5">
                  <div className="flex justify-center">
                    <div className="relative">
                      <div className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-xl shadow-amber-500/25">
                        <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                        </svg>
                      </div>
                      <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-white dark:bg-[var(--color-surface)] flex items-center justify-center shadow-sm">
                        <span className="w-3 h-3 rounded-full bg-amber-400 animate-ping opacity-75" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[22px] font-bold tracking-tight mb-2">Registration Submitted</h2>
                    <p className="text-sm text-[var(--color-text-secondary)] mb-1">
                      Your request to join <strong className="text-[var(--color-text)]">{result.event_name}</strong> has been submitted.
                    </p>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      An administrator will review your request shortly.
                    </p>
                  </div>
                  <div className="bg-[var(--color-surface-hover)] rounded-2xl p-4 space-y-2 text-left">
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-secondary)]">Status</span>
                      <span className="badge badge-amber">Pending Approval</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-secondary)]">Event</span>
                      <span className="font-semibold">{result.event_name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-secondary)]">Name</span>
                      <span className="font-semibold">{form.name}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-[var(--color-text-secondary)]">Time</span>
                      <span className="font-semibold">{new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span>
                    </div>
                  </div>
                  <Link to={`/pending-approval/${result.request_id}`}
                    className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-primary-500/20">
                    Track Approval Status
                  </Link>
                  <Link to="/login" className="block text-center text-sm text-primary-500 hover:underline font-medium">
                    Return to Login
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
