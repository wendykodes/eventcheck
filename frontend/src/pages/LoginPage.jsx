import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';

export default function LoginPage({ onLogin }) {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const [needsSetup, setNeedsSetup] = useState(null);
  const [newPin, setNewPin] = useState(['', '', '', '', '', '']);
  const [newActiveIdx, setNewActiveIdx] = useState(0);
  const [confirmPin, setConfirmPin] = useState(['', '', '', '', '', '']);
  const [confirmActiveIdx, setConfirmActiveIdx] = useState(0);
  const [setupStep, setSetupStep] = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const pinStr = pin.join('');
  const newPinStr = newPin.join('');
  const confirmPinStr = confirmPin.join('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (pinStr.length < 4) {
      toast.error('Enter your PIN to continue');
      return;
    }
    setLoading(true);
    try {
      const data = await api.login(pinStr);
      if (data.needs_pin_change) {
        toast('Set up a new PIN to continue');
        setNeedsSetup(data.temp_token);
        return;
      }
      onLogin(data.token, data.user);
      toast.success(`Welcome, ${data.user.name}!`);
    } catch (err) {
      toast.error(err.message);
      setPin(['', '', '', '', '', '']);
      setActiveIdx(0);
    } finally {
      setLoading(false);
    }
  };

  const handleDigit = (d) => {
    if (activeIdx < 6) {
      const next = [...pin];
      next[activeIdx] = d;
      setPin(next);
      setActiveIdx(i => Math.min(i + 1, 6));
    }
  };

  const handleDelete = () => {
    if (activeIdx > 0) {
      const next = [...pin];
      next[activeIdx - 1] = '';
      setPin(next);
      setActiveIdx(i => Math.max(i - 1, 0));
    }
  };

  const handleSetupPin = async () => {
    if (newPinStr.length < 4) return toast.error('PIN must be 4–6 digits');
    if (newPinStr !== confirmPinStr) return toast.error('PINs do not match');
    setLoading(true);
    try {
      const data = await api.setupPin(needsSetup, newPinStr);
      onLogin(data.token, data.user);
      toast.success('PIN set up! Welcome!');
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  if (needsSetup) {
    if (setupStep === 0) {
      return (
        <div className="min-h-dvh flex items-center justify-center bg-[#f5f5f7] dark:bg-[#000] p-4">
          <div className="w-full max-w-[360px] animate-fade-in-up">
            <div className="text-center mb-10">
              <div className="w-20 h-20 rounded-[22px] bg-primary-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary-500/25">
                <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
              </div>
              <h1 className="text-[28px] font-bold tracking-tight text-[#1d1d1f] dark:text-white">Set Up PIN</h1>
              <p className="text-[15px] text-[#86868b] mt-1.5">First time logging in. Choose a new PIN.</p>
            </div>

            <form onSubmit={e => { e.preventDefault(); setSetupStep(1); }}>
              <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-lg shadow-black/5 dark:shadow-black/20 ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex justify-center gap-2.5 mb-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={`w-10 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all duration-200 border-2 ${
                    newPin[i] ? 'bg-primary-500 border-primary-500 text-white scale-105 shadow-md shadow-primary-500/30' : i === newActiveIdx ? 'bg-white dark:bg-[#2c2c2e] border-primary-500' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-transparent'
                  }`}>
                    {newPin[i] ? '●' : ''}
                  </div>
                ))}
              </div>

                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[1,2,3,4,5,6,7,8,9].map(d => (
                    <button key={d} type="button" onClick={() => {
                      if (newActiveIdx < 6) {
                        const next = [...newPin]; next[newActiveIdx] = String(d); setNewPin(next);
                        setNewActiveIdx(i => Math.min(i + 1, 6));
                      }
                    }} className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
                    >{d}</button>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <button type="button" onClick={() => { setNewPin(['','','','','','']); setNewActiveIdx(0); }}
                    className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[13px] font-semibold text-[#ff453a] transition-all"
                  >Clear</button>
                  <button type="button" onClick={() => {
                    if (newActiveIdx < 6) { const next = [...newPin]; next[newActiveIdx] = '0'; setNewPin(next); setNewActiveIdx(i => Math.min(i + 1, 6)); }
                  }} className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
                  >0</button>
                  <button type="button" onClick={() => {
                    if (newActiveIdx > 0) { const next = [...newPin]; next[newActiveIdx - 1] = ''; setNewPin(next); setNewActiveIdx(i => Math.max(i - 1, 0)); }
                  }} className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 transition-all flex items-center justify-center"
                  >
                    <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                    </svg>
                  </button>
                </div>

                 <button type="submit" disabled={newPinStr.length < 4}
                  className="w-full h-[52px] rounded-2xl bg-primary-500 hover:bg-primary-600 disabled:bg-[#d2d2d7] dark:disabled:bg-[#3a3a3c] text-white font-semibold text-[17px] mt-5 transition-all active:scale-[0.98] disabled:active:scale-100 shadow-lg shadow-primary-500/20 disabled:shadow-none"
                >
                  {loading ? 'Setting up...' : 'Continue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-dvh flex items-center justify-center bg-[#f5f5f7] dark:bg-[#000] p-4">
        <div className="w-full max-w-[360px] animate-fade-in-up">
          <div className="text-center mb-10">
            <div className="w-20 h-20 rounded-[22px] bg-primary-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary-500/25">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <h1 className="text-[28px] font-bold tracking-tight text-[#1d1d1f] dark:text-white">Confirm PIN</h1>
            <p className="text-[15px] text-[#86868b] mt-1.5">Enter it again to confirm.</p>
          </div>

          <form onSubmit={e => { e.preventDefault(); handleSetupPin(); }}>
            <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-lg shadow-black/5 dark:shadow-black/20 ring-1 ring-black/5 dark:ring-white/10">
              <div className="flex justify-center gap-2.5 mb-8">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={`w-10 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all duration-200 border-2 ${
                    confirmPin[i] ? 'bg-primary-500 border-primary-500 text-white scale-105 shadow-md shadow-primary-500/30' : i === confirmActiveIdx ? 'bg-white dark:bg-[#2c2c2e] border-primary-500' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-transparent'
                  }`}>
                    {confirmPin[i] ? '●' : ''}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 mb-5">
                {[1,2,3,4,5,6,7,8,9].map(d => (
                  <button key={d} type="button" onClick={() => {
                    if (confirmActiveIdx < 6) {
                      const next = [...confirmPin]; next[confirmActiveIdx] = String(d); setConfirmPin(next);
                      setConfirmActiveIdx(i => Math.min(i + 1, 6));
                    }
                  }} className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
                  >{d}</button>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <button type="button" onClick={() => { setConfirmPin(['','','','','','']); setConfirmActiveIdx(0); }}
                  className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[13px] font-semibold text-[#ff453a] transition-all"
                >Clear</button>
                <button type="button" onClick={() => {
                  if (confirmActiveIdx < 6) { const next = [...confirmPin]; next[confirmActiveIdx] = '0'; setConfirmPin(next); setConfirmActiveIdx(i => Math.min(i + 1, 6)); }
                }} className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
                >0</button>
                <button type="button" onClick={() => {
                  if (confirmActiveIdx > 0) { const next = [...confirmPin]; next[confirmActiveIdx - 1] = ''; setConfirmPin(next); setConfirmActiveIdx(i => Math.max(i - 1, 0)); }
                }} className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 transition-all flex items-center justify-center"
                >
                  <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                  </svg>
                </button>
              </div>

              {newPinStr !== confirmPinStr && confirmPinStr.length >= newPinStr.length && (
                <p className="text-xs text-red-500 text-center mt-3">PINs do not match</p>
              )}

              <button type="submit" disabled={loading || confirmPinStr.length < 4 || newPinStr !== confirmPinStr}
                className="w-full h-[52px] rounded-2xl bg-primary-500 hover:bg-primary-600 disabled:bg-[#d2d2d7] dark:disabled:bg-[#3a3a3c] text-white font-semibold text-[17px] mt-5 transition-all active:scale-[0.98] disabled:active:scale-100 shadow-lg shadow-primary-500/20 disabled:shadow-none"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2.5">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                    Setting up...
                  </span>
                ) : 'Finish Setup'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-[#f5f5f7] dark:bg-[#000] p-4">
      <div className="w-full max-w-[360px] animate-fade-in-up">
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-[22px] bg-primary-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-primary-500/25">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1d1d1f] dark:text-white">Event Check-In</h1>
          <p className="text-[15px] text-[#86868b] mt-1.5">Enter your staff PIN</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="bg-white dark:bg-[#1c1c1e] rounded-2xl p-8 shadow-lg shadow-black/5 dark:shadow-black/20 ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex justify-center gap-2.5 mb-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`w-10 h-12 rounded-xl flex items-center justify-center text-xl font-bold transition-all duration-200 border-2 ${
                  pin[i] ? 'bg-primary-500 border-primary-500 text-white scale-105 shadow-md shadow-primary-500/30' : i === activeIdx ? 'bg-white dark:bg-[#2c2c2e] border-primary-500' : 'bg-[#f5f5f7] dark:bg-[#2c2c2e] border-transparent'
                }`}>
                  {pin[i] ? '●' : ''}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 mb-5">
              {[1,2,3,4,5,6,7,8,9].map(d => (
                <button key={d} type="button" onClick={() => handleDigit(String(d))}
                  className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
                >{d}</button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button type="button" onClick={() => { setPin(['','','','','','']); setActiveIdx(0); }}
                className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[13px] font-semibold text-[#ff453a] dark:text-[#ff453a] transition-all"
              >Clear</button>
              <button type="button" onClick={() => handleDigit('0')}
                className="h-[58px] text-[22px] font-semibold rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 text-[#1d1d1f] dark:text-white transition-all"
              >0</button>
              <button type="button" onClick={handleDelete}
                className="h-[58px] rounded-2xl bg-[#f5f5f7] dark:bg-[#2c2c2e] hover:bg-[#e8e8ed] dark:hover:bg-[#3a3a3c] active:scale-95 transition-all flex items-center justify-center"
              >
                <svg className="w-6 h-6 text-[#86868b]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75L14.25 12m0 0l2.25 2.25M14.25 12l2.25-2.25M14.25 12L12 14.25m-2.58 4.92l-6.375-6.375a1.125 1.125 0 010-1.59L9.42 4.83c.211-.211.498-.33.796-.33H19.5a2.25 2.25 0 012.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-9.284c-.298 0-.585-.119-.796-.33z" />
                </svg>
              </button>
            </div>

            <button type="submit" disabled={loading || pinStr.length < 4}
              className="w-full h-[52px] rounded-2xl bg-primary-500 hover:bg-primary-600 disabled:bg-[#d2d2d7] dark:disabled:bg-[#3a3a3c] text-white font-semibold text-[17px] mt-5 transition-all active:scale-[0.98] disabled:active:scale-100 shadow-lg shadow-primary-500/20 disabled:shadow-none"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2.5">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                  Signing in...
                </span>
              ) : 'Sign In'}
            </button>
          </div>
        </form>

        <p className="text-center text-xs text-[#86868b] mt-6">PIN-only authentication</p>
        <Link to="/register" className="block text-center text-sm text-primary-500 hover:text-primary-600 mt-3 font-medium">
          Join Event Staff
        </Link>
      </div>
    </div>
  );
}
