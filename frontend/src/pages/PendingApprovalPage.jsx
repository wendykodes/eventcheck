import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import toast from 'react-hot-toast';

export default function PendingApprovalPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('pending');
  const [polling, setPolling] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const poll = async () => {
      if (!mountedRef.current) return;
      try {
        const data = await api.getRegistrationStatus(requestId);
        if (!mountedRef.current) return;
        setStatus(data.status);
        if (data.status === 'approved' || data.status === 'rejected') {
          setPolling(false);
        }
      } catch {
        if (mountedRef.current) setStatus('error');
        setPolling(false);
      }
    };

    const startPolling = () => {
      poll();
      timerRef.current = setInterval(() => {
        poll();
        setElapsed(e => e + 5);
      }, 5000);
    };

    startPolling();
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [requestId]);

  useEffect(() => {
    if (status === 'approved') {
      toast.success('Your registration has been approved! You can now log in.');
    }
    if (status === 'rejected') {
      toast.error('Your registration request was declined.');
    }
  }, [status]);

  if (status === 'approved') {
    return (
      <div className="min-h-dvh flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-secondary)]">
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="w-full max-w-sm text-center animate-scale-in">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-green-400 to-green-500 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-green-500/25">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-[24px] font-bold tracking-tight mb-2">Approved!</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-2">
              Your registration has been approved by an administrator.
            </p>
            <p className="text-sm text-[var(--color-text-secondary)] mb-8">
              You can now log in with your PIN.
            </p>
            <Link to="/login" className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-blue-500/20">
              Log In Now
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'rejected') {
    return (
      <div className="min-h-dvh flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-secondary)]">
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="w-full max-w-sm text-center animate-scale-in">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-red-400 to-red-500 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-red-500/25">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-[24px] font-bold tracking-tight mb-2">Request Declined</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-8">
              Your registration request was not approved. Please contact an administrator.
            </p>
            <Link to="/login" className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-blue-500/20">
              Return to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-dvh flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-secondary)]">
        <div className="flex-1 flex items-center justify-center px-5">
          <div className="w-full max-w-sm text-center animate-fade-in">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center mx-auto mb-6 shadow-xl">
              <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <h2 className="text-[24px] font-bold tracking-tight mb-2">Unable to Check Status</h2>
            <p className="text-sm text-[var(--color-text-secondary)] mb-8">
              We couldn't retrieve your registration status. Please try again later.
            </p>
            <Link to="/login" className="btn btn-primary w-full h-13 rounded-2xl text-[17px] font-semibold shadow-lg shadow-blue-500/20">
              Return to Login
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col bg-gradient-to-b from-[var(--color-surface)] to-[var(--color-surface-secondary)]">
      <div className="flex-1 flex items-center justify-center px-5">
        <div className="w-full max-w-sm text-center animate-fade-in">
          <div className="flex justify-center mb-6">
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

          <h2 className="text-[24px] font-bold tracking-tight mb-2">Pending Approval</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-1">
            Your registration is awaiting administrator review.
          </p>
          <p className="text-sm text-[var(--color-text-secondary)] mb-8">
            We'll automatically redirect you once it's approved.
          </p>

          <div className="bg-[var(--color-surface-hover)] rounded-2xl p-5 mb-6 space-y-3">
            <div className="flex items-center justify-center gap-3">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-sm font-semibold text-amber-500">Checking for updates...</span>
            </div>
            {elapsed >= 30 && (
              <p className="text-xs text-[var(--color-text-secondary)] text-center">
                Still waiting? Make sure an administrator has been notified.
              </p>
            )}
          </div>

          <div className="space-y-3">
            <Link to="/login" className="btn btn-secondary w-full h-12 rounded-2xl text-sm font-semibold">
              Return to Login
            </Link>
            <button onClick={() => window.location.reload()}
              className="btn btn-ghost w-full text-sm text-[var(--color-text-secondary)]">
              Refresh Status
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
