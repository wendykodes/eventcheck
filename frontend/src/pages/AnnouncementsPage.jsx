import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function AnnouncementsPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showReceiptsModal, setShowReceiptsModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [receiptStats, setReceiptStats] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [createForm, setCreateForm] = useState({
    title: '',
    body: '',
    priority: 'normal',
    expires_at: '',
    zone: '',
    delivery_channels: ['in_app'],
    status: 'PUBLISHED',
    scheduled_at: ''
  });
  const [templateForm, setTemplateForm] = useState({
    name: '',
    title: '',
    body: '',
    priority: 'normal',
    delivery_channels: ['in_app']
  });

  useEffect(() => {
    loadAnnouncements();
    loadTemplates();
  }, [eventId]);

  const loadAnnouncements = async () => {
    try {
      const data = await api.get(`/announcements?event_id=${eventId}`);
      setAnnouncements(data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await api.getAnnouncementTemplates(eventId);
      setTemplates(data || []);
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post('/announcements', { ...createForm, event_id: Number(eventId) });
      toast.success('Announcement created');
      setShowCreateModal(false);
      setCreateForm({ title: '', body: '', priority: 'normal', expires_at: '', zone: '', delivery_channels: ['in_app'], status: 'PUBLISHED', scheduled_at: '' });
      loadAnnouncements();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this announcement?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      toast.success('Announcement deleted');
      loadAnnouncements();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleMarkRead = async (id) => {
    try {
      await api.post(`/announcements/${id}/read`, { guest_id: null });
      toast.success('Marked as read');
      loadAnnouncements();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleViewReceipts = async (id) => {
    try {
      const data = await api.get(`/announcements/${id}/receipts`);
      setReceipts(data.receipts);
      setReceiptStats(data.stats);
      setShowReceiptsModal(true);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    try {
      await api.createAnnouncementTemplate({ ...templateForm, event_id: Number(eventId) });
      toast.success('Template created');
      setShowTemplateModal(false);
      setTemplateForm({ name: '', title: '', body: '', priority: 'normal', delivery_channels: ['in_app'] });
      loadTemplates();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUseTemplate = (template) => {
    setCreateForm({
      title: template.title || '',
      body: template.body || '',
      priority: template.priority || 'normal',
      expires_at: '',
      zone: '',
      delivery_channels: template.delivery_channels ? JSON.parse(template.delivery_channels) : ['in_app'],
      status: 'PUBLISHED',
      scheduled_at: ''
    });
    setShowCreateModal(true);
  };

  const getPriorityBadge = (priority) => {
    switch (priority) {
      case 'urgent': return 'badge-red';
      case 'high': return 'badge-orange';
      case 'low': return 'badge-gray';
      default: return 'badge-green';
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">News & Updates</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {announcements.length} announcement{announcements.length !== 1 ? 's' : ''}
          </p>
        </div>
        {auth.user?.role === 'admin' && (
          <div className="flex gap-2">
            <button onClick={() => setShowTemplateModal(true)} className="btn btn-secondary btn-sm">
              Templates
            </button>
            <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
              Create Announcement
            </button>
          </div>
        )}
      </div>

      <EventTabs currentKey="announcements" adminOnly={true} />

      {/* Templates */}
      {templates.length > 0 && auth.user?.role === 'admin' && (
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1 mb-2">Templates</h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {templates.map((t) => (
              <button
                key={t.id}
                onClick={() => handleUseTemplate(t)}
                className="card p-3 text-left min-w-[200px] hover:bg-[var(--color-surface-hover)] transition-colors"
              >
                <div className="font-medium text-sm">{t.name}</div>
                {t.title && <div className="text-xs text-[var(--color-text-secondary)] mt-1">{t.title}</div>}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Announcements */}
      {announcements.length === 0 ? (
        <EmptyState title="No announcements" message="Create announcements to share updates with guests and staff." />
      ) : (
        <div className="space-y-2">
          {announcements.map((a, i) => (
            <div key={a.id} className="card p-4 animate-slide-up" style={{animationDelay: `${i*50}ms`}}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[15px]">{a.title}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getPriorityBadge(a.priority)}`}>
                      {a.priority}
                    </span>
                    {a.zone && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                        Zone: {a.zone}
                      </span>
                    )}
                    {a.status && (
                      <span className={`text-[10px] px-2 py-0.5 rounded ${
                        a.status === 'PUBLISHED' ? 'bg-green-100 text-green-700' : 
                        a.status === 'SCHEDULED' ? 'bg-blue-100 text-blue-700' : 
                        a.status === 'DRAFT' ? 'bg-gray-100 text-gray-700' : 
                        'bg-purple-100 text-purple-700'
                      }`}>
                        {a.status}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] text-[var(--color-text-secondary)] whitespace-pre-wrap">{a.body}</p>
                  <div className="flex gap-2 mt-2 text-[11px] text-[var(--color-text-secondary)]">
                    <span>{new Date(a.created_at).toLocaleString()}</span>
                    {a.expires_at && <span>· Expires {new Date(a.expires_at).toLocaleDateString()}</span>}
                    {a.delivery_channels && (
                      <span>· {JSON.parse(a.delivery_channels).join(', ').toUpperCase()}</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleMarkRead(a.id)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-green-500" title="Mark as read">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </button>
                  {auth.user?.role === 'admin' && (
                    <>
                      <button onClick={() => handleViewReceipts(a.id)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-blue-500" title="View receipts">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                        </svg>
                      </button>
                      <button onClick={() => handleDelete(a.id)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-red-500" title="Delete">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Create Announcement">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={createForm.title}
                onChange={e => setCreateForm({...createForm, title: e.target.value})}
                className="input-field"
                required
                placeholder="Announcement title"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Message</label>
              <textarea
                value={createForm.body}
                onChange={e => setCreateForm({...createForm, body: e.target.value})}
                className="input-field"
                rows={4}
                required
                placeholder="Your announcement message..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority</label>
              <select
                value={createForm.priority}
                onChange={e => setCreateForm({...createForm, priority: e.target.value})}
                className="input-field"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Expires at (optional)</label>
              <input
                type="datetime-local"
                value={createForm.expires_at ? new Date(createForm.expires_at).toISOString().slice(0, 16) : ''}
                onChange={e => setCreateForm({...createForm, expires_at: e.target.value})}
                className="input-field"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zone (optional)</label>
              <input
                type="text"
                value={createForm.zone}
                onChange={e => setCreateForm({...createForm, zone: e.target.value})}
                className="input-field"
                placeholder="e.g., Entrance A, Main Hall (leave empty for all zones)"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Status</label>
              <select
                value={createForm.status}
                onChange={e => setCreateForm({...createForm, status: e.target.value})}
                className="input-field"
              >
                <option value="PUBLISHED">Published Now</option>
                <option value="DRAFT">Draft</option>
                <option value="SCHEDULED">Scheduled</option>
              </select>
            </div>
            {createForm.status === 'SCHEDULED' && (
              <div>
                <label className="block text-sm font-medium mb-1">Schedule For</label>
                <input
                  type="datetime-local"
                  value={createForm.scheduled_at ? new Date(createForm.scheduled_at).toISOString().slice(0, 16) : ''}
                  onChange={e => setCreateForm({...createForm, scheduled_at: e.target.value})}
                  className="input-field"
                />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-2">Delivery Channels</label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.delivery_channels.includes('in_app')}
                    onChange={e => {
                      const channels = e.target.checked
                        ? [...createForm.delivery_channels, 'in_app']
                        : createForm.delivery_channels.filter(c => c !== 'in_app');
                      setCreateForm({...createForm, delivery_channels: channels});
                    }}
                  />
                  <span className="text-sm">In-App Notification</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.delivery_channels.includes('sms')}
                    onChange={e => {
                      const channels = e.target.checked
                        ? [...createForm.delivery_channels, 'sms']
                        : createForm.delivery_channels.filter(c => c !== 'sms');
                      setCreateForm({...createForm, delivery_channels: channels});
                    }}
                  />
                  <span className="text-sm">SMS (requires phone numbers)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.delivery_channels.includes('whatsapp')}
                    onChange={e => {
                      const channels = e.target.checked
                        ? [...createForm.delivery_channels, 'whatsapp']
                        : createForm.delivery_channels.filter(c => c !== 'whatsapp');
                      setCreateForm({...createForm, delivery_channels: channels});
                    }}
                  />
                  <span className="text-sm">WhatsApp (requires phone numbers)</span>
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Create</button>
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {showReceiptsModal && (
        <Modal onClose={() => setShowReceiptsModal(false)} title="Read Receipts">
          {receiptStats && (
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="card p-3 bg-[var(--color-surface)]">
                <div className="text-xl font-bold">{receiptStats.total_reads}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Total Reads</div>
              </div>
              <div className="card p-3 bg-green-50 dark:bg-green-900/20">
                <div className="text-xl font-bold text-green-600">{receiptStats.delivered}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Delivered</div>
              </div>
              <div className="card p-3 bg-red-50 dark:bg-red-900/20">
                <div className="text-xl font-bold text-red-600">{receiptStats.failed}</div>
                <div className="text-xs text-[var(--color-text-secondary)]">Failed</div>
              </div>
            </div>
          )}
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {receipts.length === 0 ? (
              <div className="text-center text-[var(--color-text-secondary)] py-4">No receipts yet</div>
            ) : (
              receipts.map((r) => (
                <div key={r.id} className="card p-3 bg-[var(--color-surface)] flex items-center justify-between">
                  <div>
                    <div className="font-medium text-sm">{r.user_name || r.guest_name || 'Unknown'}</div>
                    <div className="text-xs text-[var(--color-text-secondary)]">
                      {new Date(r.read_at).toLocaleString()}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    r.delivery_status === 'delivered' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {r.delivery_status}
                  </span>
                </div>
              ))
            )}
          </div>
        </Modal>
      )}

      {showTemplateModal && (
        <Modal onClose={() => setShowTemplateModal(false)} title="Announcement Templates">
          <div className="space-y-4">
            {templates.length === 0 ? (
              <div className="text-center text-[var(--color-text-secondary)] py-4">No templates yet</div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {templates.map((t) => (
                  <div key={t.id} className="card p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{t.name}</div>
                      {t.title && <div className="text-xs text-[var(--color-text-secondary)]">{t.title}</div>}
                    </div>
                    <button onClick={() => api.deleteAnnouncementTemplate(t.id).then(() => { toast.success('Template deleted'); loadTemplates(); }).catch(err => toast.error(err.message))} className="btn btn-ghost btn-icon text-red-500">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t pt-4">
              <h3 className="text-sm font-semibold mb-2">Create New Template</h3>
              <form onSubmit={handleCreateTemplate} className="space-y-3">
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={e => setTemplateForm({...templateForm, name: e.target.value})}
                  className="input-field"
                  placeholder="Template name"
                  required
                />
                <input
                  type="text"
                  value={templateForm.title}
                  onChange={e => setTemplateForm({...templateForm, title: e.target.value})}
                  className="input-field"
                  placeholder="Default title (optional)"
                />
                <textarea
                  value={templateForm.body}
                  onChange={e => setTemplateForm({...templateForm, body: e.target.value})}
                  className="input-field"
                  rows={2}
                  placeholder="Default message (optional)"
                />
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary btn-sm">Create Template</button>
                  <button type="button" onClick={() => setShowTemplateModal(false)} className="btn btn-secondary btn-sm">Close</button>
                </div>
              </form>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
