import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function InviteManagementPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [guests, setGuests] = useState([]);
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedGuests, setSelectedGuests] = useState([]);
  const [filter, setFilter] = useState('all'); // all, confirmed, declined, no_response, sent
  const [sending, setSending] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [showCustomInviteModal, setShowCustomInviteModal] = useState(false);
  const [customInviteForm, setCustomInviteForm] = useState({ name: '', description: '', expires_hours: 720, max_uses: 1 });
  const [customInvites, setCustomInvites] = useState([]);
  const [creatingCustom, setCreatingCustom] = useState(false);

  useEffect(() => {
    loadData();
    loadCustomInvites();
  }, [eventId]);

  const loadData = async () => {
    try {
      const [guestsData, invitesData] = await Promise.all([
        api.get(`/guests?event_id=${eventId}`),
        api.get(`/guest-invites?event_id=${eventId}`)
      ]);
      setGuests(guestsData || []);
      setInvites(invitesData || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCustomInvites = async () => {
    try {
      const data = await api.get(`/custom-invites?event_id=${eventId}`);
      setCustomInvites(data || []);
    } catch (err) {
      console.error('Failed to load custom invites:', err);
    }
  };

  const handleSendInvites = async () => {
    if (selectedGuests.length === 0) {
      toast.error('Select at least one guest');
      return;
    }

    setSending(true);
    try {
      const result = await api.post('/guest-invites', {
        event_id: Number(eventId),
        guest_ids: selectedGuests,
        ttl_hours: 24 * 30 // 30 days
      });
      
      toast.success(`Invitations sent: ${result.invitations.filter(i => i.token).length}`);
      setSelectedGuests([]);
      setShowCreateModal(false);
      loadData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  const handleResend = async (inviteId) => {
    try {
      await api.post(`/guest-invites/${inviteId}/resend`);
      toast.success('Invitation resent');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRevoke = async (inviteId) => {
    if (!confirm('Revoke this invitation?')) return;
    try {
      await api.post(`/guest-invites/${inviteId}/revoke`);
      toast.success('Invitation revoked');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemind = async () => {
    if (!confirm('Send reminders to all guests who haven\'t responded?')) return;
    setReminding(true);
    try {
      const result = await api.remindGuestInvites(Number(eventId));
      toast.success(result.message || `Reminded ${result.reminded} guests`);
      loadData();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReminding(false);
    }
  };

  const handleCreateCustomInvite = async (e) => {
    e.preventDefault();
    if (!customInviteForm.name.trim()) {
      toast.error('Name is required');
      return;
    }

    setCreatingCustom(true);
    try {
      const result = await api.post('/custom-invites', {
        event_id: Number(eventId),
        name: customInviteForm.name,
        description: customInviteForm.description,
        expires_hours: Number(customInviteForm.expires_hours),
        max_uses: Number(customInviteForm.max_uses),
      });

      toast.success('Custom invitation created');
      setCustomInviteForm({ name: '', description: '', expires_hours: 720, max_uses: 1 });
      setShowCustomInviteModal(false);
      loadCustomInvites();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCreatingCustom(false);
    }
  };

  const handleRevokeCustomInvite = async (inviteId) => {
    if (!confirm('Revoke this custom invitation?')) return;
    try {
      await api.post(`/custom-invites/${inviteId}/revoke`);
      toast.success('Custom invitation revoked');
      loadCustomInvites();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyInviteLink = (link) => {
    navigator.clipboard.writeText(link);
    toast.success('Link copied to clipboard');
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'confirmed': return 'badge-green';
      case 'declined': return 'badge-red';
      case 'sent': return 'badge-blue';
      default: return 'badge-gray';
    }
  };

  const filteredGuests = guests.filter(g => {
    if (filter === 'all') return true;
    return g.rsvp_status === filter;
  });

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Guest Invites</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {invites.length} invitation{invites.length !== 1 ? 's' : ''} · {guests.length} guest{guests.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleRemind} disabled={reminding} className="btn btn-secondary btn-sm">
            {reminding ? 'Sending...' : '🔔 Remind Non-Responders'}
          </button>
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
            Send Invites
          </button>
          <button onClick={() => setShowCustomInviteModal(true)} className="btn btn-secondary btn-sm">
            Create Custom Invite
          </button>
        </div>
      </div>

      <EventTabs currentKey="invites" adminOnly={true} />

      {/* RSVP Summary */}
      <div className="grid grid-cols-4 gap-2">
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold">{invites.length}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Invited</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-green-600">{invites.filter(i => i.rsvp_status === 'confirmed').length}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Confirmed</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{invites.filter(i => i.rsvp_status === 'declined').length}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">Declined</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-2xl font-bold text-gray-600">{invites.filter(i => i.rsvp_status === 'no_response').length}</p>
          <p className="text-xs text-[var(--color-text-secondary)]">No Response</p>
        </div>
      </div>

      {/* Detailed Report Link */}
      <div className="card p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/30">
        <div className="flex items-center justify-between">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            View detailed RSVP report with analytics, dietary preferences, and response timeline
          </p>
          <Link to={`/events/${eventId}/rsvp-report`} className="btn btn-primary btn-sm">
            View Report
          </Link>
        </div>
      </div>

      {/* RSVP Deadline Warning */}
      {invites.filter(i => i.rsvp_status === 'no_response').length > 0 && (
        <div className="card p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/30">
          <p className="text-sm text-amber-800 dark:text-amber-200">
            {invites.filter(i => i.rsvp_status === 'no_response').length} guests haven't responded yet. Send them a reminder!
          </p>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {['all', 'confirmed', 'declined', 'no_response'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`btn btn-sm ${filter === f ? 'btn-primary' : 'btn-secondary'}`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1).replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Guest List */}
      {filteredGuests.length === 0 ? (
        <EmptyState title="No guests found" message="Add guests to your event to send invitations." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-surface-hover)]">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Guest</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {filteredGuests.map((guest, idx) => (
                <tr key={guest.guest_id} className="animate-slide-up" style={{animationDelay: `${idx * 30}ms`}}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{guest.name}</p>
                    {guest.phone && <p className="text-xs text-[var(--color-text-secondary)]">{guest.phone}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getStatusBadge(guest.rsvp_status)}`}>
                      {guest.rsvp_status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {guest.invitation_id && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleResend(guest.invitation_id)}
                          className="btn btn-ghost btn-icon text-xs"
                          title="Resend"
                        >
                          Resend
                        </button>
                        <button
                          onClick={() => handleRevoke(guest.invitation_id)}
                          className="btn btn-ghost btn-icon text-red-500 text-xs"
                          title="Revoke"
                        >
                          Revoke
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Custom Invitations Section */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="section-title">Custom Invitations</h2>
          <button onClick={() => setShowCustomInviteModal(true)} className="btn btn-primary btn-sm">
            + Create Custom Invite
          </button>
        </div>
        {customInvites.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No custom invitations yet</p>
        ) : (
          <div className="space-y-2">
            {customInvites.map((invite) => (
              <div key={invite.id} className="flex items-center justify-between p-3 bg-[var(--color-bg-secondary)] rounded-lg">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{invite.name}</p>
                  {invite.description && <p className="text-xs text-[var(--color-text-secondary)] truncate">{invite.description}</p>}
                  <div className="flex gap-2 mt-1 text-xs text-[var(--color-text-secondary)]">
                    <span>Uses: {invite.uses_used || 0}/{invite.max_uses}</span>
                    <span>Expires: {invite.expires_at ? new Date(invite.expires_at).toLocaleDateString() : 'Never'}</span>
                  </div>
                </div>
                <div className="flex gap-1 ml-3">
                  <button
                    onClick={() => copyInviteLink(invite.link)}
                    className="btn btn-ghost btn-icon text-xs"
                    title="Copy link"
                  >
                    Copy Link
                  </button>
                  <button
                    onClick={() => handleRevokeCustomInvite(invite.id)}
                    className="btn btn-ghost btn-icon text-red-500 text-xs"
                    title="Revoke"
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Send Invites Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Send Invitations">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Select Guests</label>
              <div className="max-h-64 overflow-y-auto space-y-2">
                {guests.map(guest => (
                  <label key={guest.guest_id} className="flex items-center gap-2 p-2 rounded hover:bg-[var(--color-surface-hover)]">
                    <input
                      type="checkbox"
                      checked={selectedGuests.includes(guest.guest_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedGuests([...selectedGuests, guest.guest_id]);
                        } else {
                          setSelectedGuests(selectedGuests.filter(id => id !== guest.guest_id));
                        }
                      }}
                      className="w-4 h-4"
                    />
                    <span className="text-sm">{guest.name}</span>
                    {guest.rsvp_status !== 'no_response' && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${getStatusBadge(guest.rsvp_status)}`}>
                        {guest.rsvp_status}
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSendInvites}
                disabled={sending || selectedGuests.length === 0}
                className="btn btn-primary flex-1"
              >
                {sending ? 'Sending...' : `Send ${selectedGuests.length} Invitations`}
              </button>
              <button onClick={() => setShowCreateModal(false)} className="btn btn-secondary">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Custom Invite Modal */}
      {showCustomInviteModal && (
        <Modal onClose={() => setShowCustomInviteModal(false)} title="Create Custom Invitation">
          <form onSubmit={handleCreateCustomInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={customInviteForm.name}
                onChange={(e) => setCustomInviteForm({ ...customInviteForm, name: e.target.value })}
                placeholder="VIP Access, Staff Pass, etc."
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                value={customInviteForm.description}
                onChange={(e) => setCustomInviteForm({ ...customInviteForm, description: e.target.value })}
                placeholder="Describe who this is for..."
                rows={2}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Expires in (hours)</label>
              <input
                type="number"
                value={customInviteForm.expires_hours}
                onChange={(e) => setCustomInviteForm({ ...customInviteForm, expires_hours: e.target.value })}
                min="1"
                max="8760"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Default: 720 hours (30 days)</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Uses</label>
              <input
                type="number"
                value={customInviteForm.max_uses}
                onChange={(e) => setCustomInviteForm({ ...customInviteForm, max_uses: e.target.value })}
                min="1"
                max="1000"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">How many times this invite can be used</p>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={creatingCustom}
                className="btn btn-primary flex-1"
              >
                {creatingCustom ? 'Creating...' : 'Create Custom Invite'}
              </button>
              <button
                type="button"
                onClick={() => setShowCustomInviteModal(false)}
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
