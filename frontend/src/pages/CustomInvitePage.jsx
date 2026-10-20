import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

export default function CustomInvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showCheckinModal, setShowCheckinModal] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);

  useEffect(() => {
    loadInvite();
  }, [token]);

  const loadInvite = async () => {
    try {
      const data = await api.get(`/custom-invite/${token}`);
      setInvite(data.invite);
      setEvent(data.event);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckIn = async (e) => {
    e.preventDefault();
    if (!guestName.trim()) {
      toast.error('Please enter your name');
      return;
    }

    setCheckingIn(true);
    try {
      const result = await api.post(`/custom-invite/${token}/checkin`, {
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim() || null
      });
      toast.success('Checked in successfully!');
      setShowCheckinModal(false);
      setGuestName('');
      setGuestPhone('');
      loadInvite(); // Refresh to show updated usage count
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCheckingIn(false);
    }
  };

  if (loading) return <div className="pt-4 text-center">Loading...</div>;
  if (!invite || !event) return <EmptyState title="Invalid Invitation" message="This invitation is not valid or has expired." />;

  return (
    <div className="pt-4 space-y-4 animate-fade-in max-w-md mx-auto">
      <div className="card p-6 text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold mb-2">{invite.name}</h1>
        {invite.description && <p className="text-sm text-[var(--color-text-secondary)] mb-4">{invite.description}</p>}
        
        <div className="bg-[var(--color-bg-secondary)] rounded-lg p-4 mb-4">
          <h2 className="font-semibold text-lg mb-1">{event.name}</h2>
          {event.date && <p className="text-sm text-[var(--color-text-secondary)]">{event.date}</p>}
          {event.venue && <p className="text-sm text-[var(--color-text-secondary)]">{event.venue}</p>}
        </div>

        <div className="flex justify-between text-sm text-[var(--color-text-secondary)] mb-4">
          <span>Uses: {invite.uses_used}/{invite.max_uses}</span>
          {invite.expires_at && <span>Expires: {new Date(invite.expires_at).toLocaleDateString()}</span>}
        </div>

        <button
          onClick={() => setShowCheckinModal(true)}
          disabled={invite.uses_used >= invite.max_uses}
          className="btn btn-primary w-full"
        >
          {invite.uses_used >= invite.max_uses ? 'Maximum uses reached' : 'Check In'}
        </button>
      </div>

      {showCheckinModal && (
        <Modal
          open={showCheckinModal}
          title="Check In"
          onCancel={() => setShowCheckinModal(false)}
          hideActions={true}
        >
          <form onSubmit={handleCheckIn} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Your Name *</label>
              <input
                type="text"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone (optional)</label>
              <input
                type="tel"
                value={guestPhone}
                onChange={(e) => setGuestPhone(e.target.value)}
                placeholder="Your phone number"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={checkingIn}
                className="btn btn-primary flex-1"
              >
                {checkingIn ? 'Checking in...' : 'Check In'}
              </button>
              <button
                type="button"
                onClick={() => setShowCheckinModal(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
