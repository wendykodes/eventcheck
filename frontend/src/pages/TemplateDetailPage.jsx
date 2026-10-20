import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
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

const ALL_MODULES = Object.keys(MODULE_LABELS);
const ALL_ROLES = Object.keys(ROLE_LABELS);

export default function TemplateDetailPage() {
  const auth = useAuth();
  const { key } = useParams();
  const navigate = useNavigate();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }
  
  const [template, setTemplate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({});
  const [errors, setErrors] = useState({});
  const [showCloneModal, setShowCloneModal] = useState(false);
  const [cloneForm, setCloneForm] = useState({ key: '', name: '', description: '' });

  const isCustom = key?.startsWith('custom_') || template?.key?.startsWith('custom_');

  const loadTemplate = async () => {
    try {
      const data = await api.getTemplate(key);
      setTemplate(data);
      setEditForm({
        name: data.name,
        description: data.description || '',
        default_modules: data.default_modules || [],
        default_roles: data.default_roles || [],
        terminology: data.terminology || {},
        default_settings: data.default_settings || {},
      });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const resetEditForm = () => {
    if (template) {
      setEditForm({
        name: template.name,
        description: template.description || '',
        default_modules: template.default_modules || [],
        default_roles: template.default_roles || [],
        terminology: template.terminology || {},
        default_settings: template.default_settings || {},
      });
    }
  };

  useEffect(() => {
    loadTemplate();
  }, [key]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!editForm.name.trim()) {
      setErrors({ name: 'Name is required' });
      return;
    }

    try {
      await api.updateTemplate(key, editForm);
      toast.success('Template updated');
      setEditing(false);
      setErrors({});
      loadTemplate();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this template? This cannot be undone.')) return;
    try {
      await api.deleteTemplate(key);
      toast.success('Template deleted');
      navigate('/templates');
    } catch (err) {
      if (err.status === 409) {
        toast.error('Cannot delete template: it is in use by events');
      } else {
        toast.error(err.message);
      }
    }
  };

  const handleClone = async (e) => {
    e.preventDefault();
    if (!cloneForm.key.trim() || !cloneForm.key.startsWith('custom_')) {
      toast.error('Key must start with custom_');
      return;
    }
    if (!cloneForm.name.trim()) {
      toast.error('Name is required');
      return;
    }

    try {
      const cloneData = {
        ...editForm,
        key: cloneForm.key,
        name: cloneForm.name,
        description: cloneForm.description,
      };
      await api.createTemplate(cloneData);
      toast.success('Template cloned');
      setShowCloneModal(false);
      setCloneForm({ key: '', name: '', description: '' });
      navigate(`/templates/${cloneForm.key}`);
    } catch (err) {
      if (err.status === 409) {
        toast.error('Template key already exists');
      } else {
        toast.error(err.message);
      }
    }
  };

  const toggleModule = (module) => {
    const current = editForm.default_modules || [];
    const updated = current.includes(module)
      ? current.filter(m => m !== module)
      : [...current, module];
    setEditForm({ ...editForm, default_modules: updated });
  };

  const toggleRole = (role) => {
    const current = editForm.default_roles || [];
    const updated = current.includes(role)
      ? current.filter(r => r !== role)
      : [...current, role];
    setEditForm({ ...editForm, default_roles: updated });
  };

  const updateTerminology = (termKey, value) => {
    setEditForm({
      ...editForm,
      terminology: { ...editForm.terminology, [termKey]: value },
    });
  };

  const updateSetting = (settingKey, value) => {
    setEditForm({
      ...editForm,
      default_settings: { ...editForm.default_settings, [settingKey]: value },
    });
  };

  const createEventFromTemplate = () => {
    navigate('/', { state: { templateKey: key } });
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={8} /></div>;
  if (!template) return <EmptyState title="Template not found" message="The template you're looking for doesn't exist." />;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to="/templates" className="text-[var(--color-text-secondary)] hover:text-[var(--color-text)]">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">{editForm.name}</h1>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              {isCustom ? 'Custom Template' : 'System Template'} · {key}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={createEventFromTemplate} className="btn btn-primary btn-sm">
            Create Event
          </button>
          {!isCustom && (
            <button onClick={() => {
              setCloneForm({
                key: `custom_${key}_clone`,
                name: `${editForm.name} (Copy)`,
                description: editForm.description || `Copy of ${editForm.name}`
              });
              setShowCloneModal(true);
            }} className="btn btn-secondary btn-sm">
              Clone as Custom
            </button>
          )}
          {isCustom && (
            <>
              {!editing ? (
                <button onClick={() => setEditing(true)} className="btn btn-secondary btn-sm">
                  Edit
                </button>
              ) : (
                <button onClick={() => { setEditing(false); resetEditForm(); setErrors({}); }} className="btn btn-secondary btn-sm">
                  Cancel
                </button>
              )}
              {editing && (
                <button onClick={handleSave} className="btn btn-primary btn-sm">
                  Save
                </button>
              )}
              {!editing && (
                <button onClick={handleDelete} className="btn btn-danger btn-sm">
                  Delete
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="card p-4 space-y-4">
            <h2 className="font-semibold text-[15px]">Basic Information</h2>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className={`w-full px-3 py-2 rounded-lg border ${errors.name ? 'border-red-500' : 'border-[var(--color-border)]'} bg-[var(--color-bg)] text-[var(--color-text)] text-sm`}
              />
              {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="font-semibold text-[15px]">Enabled Modules</h2>
            <div className="grid grid-cols-2 gap-2">
              {ALL_MODULES.map((m) => (
                <label key={m} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(editForm.default_modules || []).includes(m)}
                    onChange={() => toggleModule(m)}
                    className="rounded"
                  />
                  {MODULE_LABELS[m] || m}
                </label>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="font-semibold text-[15px]">Default Roles</h2>
            <div className="grid grid-cols-2 gap-2">
              {ALL_ROLES.map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(editForm.default_roles || []).includes(r)}
                    onChange={() => toggleRole(r)}
                    className="rounded"
                  />
                  {ROLE_LABELS[r] || r}
                </label>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="font-semibold text-[15px]">Terminology</h2>
            <div className="space-y-2">
              <div>
                <label className="block text-sm font-medium mb-1">Guests label</label>
                <input
                  type="text"
                  value={editForm.terminology?.guests || ''}
                  onChange={(e) => updateTerminology('guests', e.target.value)}
                  placeholder="Guests"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Check-in label</label>
                <input
                  type="text"
                  value={editForm.terminology?.checkin || ''}
                  onChange={(e) => updateTerminology('checkin', e.target.value)}
                  placeholder="Check-In"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-4">
            <h2 className="font-semibold text-[15px]">Default Settings</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">Onboarding Method</label>
                <select
                  value={editForm.default_settings?.onboarding_method || 'approval'}
                  onChange={(e) => updateSetting('onboarding_method', e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                >
                  <option value="approval">Approval Required</option>
                  <option value="auto_approve">Auto-Approve</option>
                  <option value="invitation_only">Invitation Only</option>
                  <option value="manual_only">Manual Only</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.rsvp_enabled || false}
                    onChange={(e) => updateSetting('rsvp_enabled', e.target.checked)}
                    className="rounded"
                  />
                  RSVP Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.seating_enabled || false}
                    onChange={(e) => updateSetting('seating_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Seating Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.gifts_enabled || false}
                    onChange={(e) => updateSetting('gifts_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Gifts Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.checkin_enabled !== false}
                    onChange={(e) => updateSetting('checkin_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Check-in Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.announcements_enabled || false}
                    onChange={(e) => updateSetting('announcements_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Announcements Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.transport_enabled || false}
                    onChange={(e) => updateSetting('transport_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Transport Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.accommodation_enabled || false}
                    onChange={(e) => updateSetting('accommodation_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Accommodation Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editForm.default_settings?.feedback_enabled || false}
                    onChange={(e) => updateSetting('feedback_enabled', e.target.checked)}
                    className="rounded"
                  />
                  Feedback Enabled
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Check-in Window (hours)</label>
                <input
                  type="number"
                  value={editForm.default_settings?.checkin_window_hours || 4}
                  onChange={(e) => updateSetting('checkin_window_hours', parseInt(e.target.value) || 4)}
                  min="1"
                  max="24"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => { setEditing(false); resetEditForm(); setErrors({}); }} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-[15px]">Description</h2>
            <p className="text-sm text-[var(--color-text-secondary)]">{editForm.description || 'No description'}</p>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-[15px]">Enabled Modules ({(editForm.default_modules || []).length})</h2>
            <div className="flex flex-wrap gap-2">
              {(editForm.default_modules || []).map((m) => (
                <span key={m} className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text)]">
                  {MODULE_LABELS[m] || m}
                </span>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-[15px]">Default Roles ({(editForm.default_roles || []).length})</h2>
            <div className="flex flex-wrap gap-2">
              {(editForm.default_roles || []).map((r) => (
                <span key={r} className="text-xs px-2 py-1 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text)]">
                  {ROLE_LABELS[r] || r}
                </span>
              ))}
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-[15px]">Terminology</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Guests:</span>
                <span>{editForm.terminology?.guests || 'Guests'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Check-in:</span>
                <span>{editForm.terminology?.checkin || 'Check-In'}</span>
              </div>
            </div>
          </div>

          <div className="card p-4 space-y-3">
            <h2 className="font-semibold text-[15px]">Default Settings</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Onboarding:</span>
                <span className="capitalize">{editForm.default_settings?.onboarding_method || 'approval'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">RSVP:</span>
                <span>{editForm.default_settings?.rsvp_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Seating:</span>
                <span>{editForm.default_settings?.seating_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Gifts:</span>
                <span>{editForm.default_settings?.gifts_enabled ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clone Modal */}
      <Modal open={showCloneModal} onClose={() => setShowCloneModal(false)} title="Clone Template">
          <form onSubmit={handleClone} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Template Key</label>
              <input
                type="text"
                value={cloneForm.key}
                onChange={(e) => setCloneForm({ ...cloneForm, key: e.target.value })}
                placeholder="custom_cloned_template"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
              <p className="text-xs text-[var(--color-text-secondary)] mt-1">Must start with custom_</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Template Name</label>
              <input
                type="text"
                value={cloneForm.name}
                onChange={(e) => setCloneForm({ ...cloneForm, name: e.target.value })}
                placeholder="Cloned Template"
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <textarea
                value={cloneForm.description}
                onChange={(e) => setCloneForm({ ...cloneForm, description: e.target.value })}
                placeholder="Description of cloned template..."
                rows={3}
                className="w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm resize-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCloneModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Clone Template
              </button>
            </div>
          </form>
        </Modal>
    </div>
  );
}
