import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';

export default function AcceptInvitationPage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [inv, setInv] = useState(null);
  const [error, setError] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    api.getInvitation(token)
      .then(setInv)
      .catch(err => setError(err.message));
  }, [token]);

  const accept = async () => {
    if (pin.length < 4 || pin.length > 6) return toast.error('PIN must be 4–6 digits');
    if (pin !== pin2) return toast.error('PINs do not match');
    setLoading(true);
    try {
      const res = await api.acceptInvitation(token, pin);
      setDone(true);
      toast.success('Registration complete!');
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  if (error) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-[var(--color-surface-secondary)]">
        <div className="card p-8 text-center max-w-sm w-full animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Invalid or Expired Invitation</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">{error}</p>
          <Link to="/login" className="btn btn-primary w-full">Go to Login</Link>
        </div>
      </div>
    );
  }

  if (!inv) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-[var(--color-surface-secondary)]">
        <div className="text-center animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-blue-500/20 mx-auto mb-4" />
          <p className="text-sm text-[var(--color-text-secondary)]">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6 bg-[var(--color-surface-secondary)]">
        <div className="card p-8 text-center max-w-sm w-full animate-scale-in">
          <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold mb-2">Welcome to the Team!</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-6">You can now log in with your PIN.</p>
          <Link to="/login" className="btn btn-primary w-full">Log In</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex items-center justify-center p-6 bg-[var(--color-surface-secondary)]">
      <div className="w-full max-w-sm animate-fade-in-up">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-500/25">
            <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 9h3.75M15 12h3.75M15 15h3.75M4.5 19.5h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">You're Invited!</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Join <strong>{inv.event_name}</strong></p>
        </div>

        <div className="card p-6 space-y-4">
          <div className="bg-[var(--color-surface-hover)] rounded-xl p-4 space-y-2">
            <div className="flex justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">Name</span>
              <span className="text-sm font-semibold">{inv.name}</span>
            </div>
            {inv.phone && (
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-secondary)]">Phone</span>
                <span className="text-sm font-semibold">{inv.phone}</span>
              </div>
            )}
            {inv.email && (
              <div className="flex justify-between">
                <span className="text-sm text-[var(--color-text-secondary)]">Email</span>
                <span className="text-sm font-semibold">{inv.email}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-sm text-[var(--color-text-secondary)]">Role</span>
              <span className="text-sm font-semibold capitalize">{inv.role}</span>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium mb-1 block">Create PIN (4–6 digits) *</label>
            <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password" inputMode="numeric" placeholder="····" maxLength={6}
              className="input text-center text-2xl tracking-[0.5em] font-bold" autoFocus />
          </div>
          <div>
            <label className="text-sm font-medium mb-1 block">Confirm PIN *</label>
            <input value={pin2} onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 6))}
              type="password" inputMode="numeric" placeholder="····" maxLength={6}
              className="input text-center text-2xl tracking-[0.5em] font-bold" />
            {pin2 && pin !== pin2 && <p className="text-xs text-red-400 mt-1">PINs do not match</p>}
          </div>

          <button onClick={accept} disabled={loading || !pin || pin !== pin2} className="btn btn-primary w-full">
            {loading ? 'Setting up...' : 'Accept Invitation'}
          </button>
        </div>
      </div>
    </div>
  );
}
