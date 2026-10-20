import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';

const MODULE_LABELS = {
  guests: 'Guest Management',
  invitations: 'Invitations',
  rsvp: 'RSVP',
  checkin: 'Check-In',
  seating: 'Seating',
  schedule: 'Schedule',
  announcements: 'Announcements',
  food_service: 'Food & Service',
  transport: 'Transport',
  gifts: 'Gifts',
  guestbook: 'Guestbook',
  gallery: 'Gallery',
  reporting: 'Reporting',
  command: 'Command Center',
  registration: 'Registration',
  speakers: 'Speakers',
  feedback: 'Feedback',
  donations: 'Donations',
  accommodation: 'Accommodation',
};

const ROLE_LABELS = {
  event_owner: 'Event Owner',
  event_manager: 'Event Manager',
  raas_operator: 'RaaS Operator',
  checkin_staff: 'Check-in Staff',
  security: 'Security',
  usher: 'Usher',
  waiter: 'Waiter',
  kitchen: 'Kitchen',
  bar: 'Bar',
  driver: 'Driver',
  transport_coordinator: 'Transport Coordinator',
  sound: 'Sound',
  performer: 'Performer',
  photographer: 'Photographer',
  vendor: 'Vendor',
  speaker: 'Speaker',
  vip_coordinator: 'VIP Coordinator',
};

export default function TemplatesPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }
  
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ key: '', name: '', description: '' });
  const [createErrors, setCreateErrors] = useState({});
  const [snapshotModal, setSnapshotModal] = useState(null);
  const [snapshotForm, setSnapshotForm] = useState({ key: '', name: '', description: '' });
  const [events, setEvents] = useState([]);

  const loadTemplates = async () => {
    try {
      const data = await api.getTemplates();
      setTemplates(data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadEvents = async () => {
    try {
      const data = await api.getEvents();
      setEvents(data || []);
    } catch (err) {
      console.error('Failed to load events:', err);
    }
  };

  useEffect(() => {
    loadTemplates();
  }, []);

  const isCustom = (key) => key.startsWith('custom_');

  const filteredTemplates = templates.filter(t => {
    const q = search.toLowerCase();
    return t.name.toLowerCase().includes(q) || (t.description && t.description.toLowerCase().includes(q));
  });

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    const errors = {};
    if (!createForm.key.trim()) errors.key = 'Key is required';
    if (!createForm.key.startsWith('custom_')) errors.key = 'Key must start with custom_';
    if (!createForm.name.trim()) errors.name = 'Name is required';
    if (Object.keys(errors).length > 0) {
      setCreateErrors(errors);
      return;
    }

    try {
      await api.createTemplate(createForm);
      toast.success('Template created');
      setShowCreateModal(false);
      setCreateForm({ key: '', name: '', description: '' });
      setCreateErrors({});
      loadTemplates();
    } catch (err) {
      if (err.status === 409) {
        setCreateErrors({ key: 'Template key already exists' });
      } else {
        toast.error(err.message);
      }
    }
  };

  const handleSnapshot = async (e) => {
    e.preventDefault();
    if (!snapshotForm.key.trim() || !snapshotForm.key.startsWith('custom_')) {
      toast.error('Key must start with custom_');
      return;
    }
    if (!snapshotForm.name.trim()) {
      toast.error('Name is required');
      return;
    }

    try {
      await api.templateFromEvent(snapshotModal, snapshotForm);
      toast.success('Template created from event');
      setSnapshotModal(null);
      setSnapshotForm({ key: '', name: '', description: '' });
      loadTemplates();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const openSnapshotModal = async (eventId = null) => {
    await loadEvents();
    if (events.length === 0) {
      toast.error('No events available to snapshot');
      return;
    }
    setSnapshotModal(eventId || events[0].id);
    const selectedEvent = events.find(e => e.id === (eventId || events[0].id));
    setSnapshotForm({
      key: `custom_${selectedEvent.name.toLowerCase().replace(/\s+/g, '_')}`,
      name: `${selectedEvent.name} Template`,
      description: `Snapshot of ${selectedEvent.name}`,
    });
  };

  const handleDeleteTemplate = async (key) => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await api.deleteTemplate(key);
      toast.success('Template deleted');
      loadTemplates();
    } catch (err) {
      if (err.status === 409) {
        toast.error('Cannot delete template: it is in use by events');
      } else {
        toast.error(err.message);
      }
    }
  };

  const createEventFromTemplate = (templateKey) => {
    navigate('/', { state: { templateKey } });
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Templates</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {templates.length} template{templates.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
            Create Custom
          </button>
          <button onClick={() => openSnapshotModal(null)} className="btn btn-secondary btn-sm">
            Snapshot from Event
          </button>
        </div>
      </div>

      <div className="px-1">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] placeholder:text-[var(--color-text-secondary)] text-sm"
        />
      </div>

      {filteredTemplates.length === 0 ? (
        <EmptyState
          title={search ? 'No matches' : 'No templates'}
          message={search ? 'Try another search' : 'Templates will appear here'}
        />
      ) : (
        <div className="space-y-2.5">
          {filteredTemplates.map((t) => (
            <div key={t.key} className="card p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-[15px] truncate">{t.name}</h3>
                    {isCustom(t.key) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-primary)] text-white font-medium">Custom</span>
                    )}
                  </div>
                  <p className="text-[12px] text-[var(--color-text-secondary)] line-clamp-2">{t.description || '—'}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => createEventFromTemplate(t.key)}
                    className="p-2 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]"
                    title="Create event from template"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  {isCustom(t.key) && (
                    <button
                      onClick={() => handleDeleteTemplate(t.key)}
                      className="p-2 rounded hover:bg-red-50 text-red-500"
                      title="Delete template"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {t.default_modules && t.default_modules.slice(0, 4).map((m) => (
                  <span key={m} className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                    {MODULE_LABELS[m] || m}
                  </span>
                ))}
                {t.default_modules && t.default_modules.length > 4 && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                    +{t.default_modules.length - 4} more
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-[var(--color-border)]">
                <Link to={`/templates/${t.key}`} className="text-[12px] text-[var(--color-primary)] hover:underline">
                  View details →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Custom Template Modal */}
      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create Custom Template">
          <form onSubmit={handleCreateTemplate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Key</label>
              <input
                type="text"
                value={createForm.key}
                onChange={(e) => setCreateForm({ ...createForm, key: e.target.value })}
                placeholder="custom_my_template"
                className={`w-full px-3 py-2 rounded-lg border ${createErrors.key ? 'border-red-500' : 'border-[var(--color-border)]'} bg-[var(--color-bg)] text-[var(--color-text)] text-sm`}
              />
              {createErrors.key && <p className="text-xs text-red-500 mt-1">{createErrors.key}</p>}
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Must start with custom_</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="My Custom Template"
                className={`w-full px-3 py-2 rounded-lg border ${createErrors.name ? 'border-red-500' : 'border-[var(--color-border)]'} bg-[var(--color-bg)] text-[var(--color-text)] text-sm`}
              />
              {createErrors.name && <p className="text-xs text-red-500 mt-1">{createErrors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Describe what this template is for..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create Template
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Snapshot from Event Modal */}
      {snapshotModal && (
        <Modal onClose={() => setSnapshotModal(null)} title="Snapshot Event to Template">
          <form onSubmit={handleSnapshot} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Source Event</label>
              <select
                value={snapshotModal}
                onChange={(e) => setSnapshotModal(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.name} ({ev.date || 'No date'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Template Key</label>
              <input
                type="text"
                value={snapshotForm.key}
                onChange={(e) => setSnapshotForm({ ...snapshotForm, key: e.target.value })}
                placeholder="custom_event_snapshot"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Must start with custom_</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Template Name</label>
              <input
                type="text"
                value={snapshotForm.name}
                onChange={(e) => setSnapshotForm({ ...snapshotForm, name: e.target.value })}
                placeholder="Event Snapshot Template"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={snapshotForm.description}
                onChange={(e) => setSnapshotForm({ ...snapshotForm, description: e.target.value })}
                placeholder="Description of this snapshot..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setSnapshotModal(null)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Create Template
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
