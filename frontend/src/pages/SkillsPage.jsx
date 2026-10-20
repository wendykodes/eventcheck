import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';

export default function SkillsPage() {
  const { staffId } = useParams();
  const auth = useAuth();
  
  // Admin-only check
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [skills, setSkills] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [showCertModal, setShowCertModal] = useState(false);
  const [skillForm, setSkillForm] = useState({
    user_id: staffId,
    skill_name: '',
    proficiency_level: 'beginner',
    verified_at: ''
  });
  const [certForm, setCertForm] = useState({
    user_id: staffId,
    certification_name: '',
    issuer: '',
    issue_date: '',
    expiry_date: '',
    certificate_number: ''
  });

  useEffect(() => {
    loadSkills();
    loadCertifications();
  }, [staffId]);

  const loadSkills = async () => {
    try {
      const data = await api.get(`/skills/skills/${staffId}`);
      setSkills(data || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadCertifications = async () => {
    try {
      const data = await api.get(`/skills/certifications/${staffId}`);
      setCertifications(data || []);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleAddSkill = async (e) => {
    e.preventDefault();
    try {
      await api.post('/skills/skills', skillForm);
      toast.success('Skill added');
      setShowSkillModal(false);
      setSkillForm({
        user_id: staffId,
        skill_name: '',
        proficiency_level: 'beginner',
        verified_at: ''
      });
      loadSkills();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdateSkill = async (id, updates) => {
    try {
      await api.put(`/skills/skills/${id}`, updates);
      toast.success('Skill updated');
      loadSkills();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteSkill = async (id) => {
    if (!confirm('Delete this skill?')) return;
    try {
      await api.delete(`/skills/skills/${id}`);
      toast.success('Skill deleted');
      loadSkills();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleAddCert = async (e) => {
    e.preventDefault();
    try {
      await api.post('/skills/certifications', certForm);
      toast.success('Certification added');
      setShowCertModal(false);
      setCertForm({
        user_id: staffId,
        certification_name: '',
        issuer: '',
        issue_date: '',
        expiry_date: '',
        certificate_number: ''
      });
      loadCertifications();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdateCert = async (id, updates) => {
    try {
      await api.put(`/skills/certifications/${id}`, updates);
      toast.success('Certification updated');
      loadCertifications();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteCert = async (id) => {
    if (!confirm('Delete this certification?')) return;
    try {
      await api.delete(`/skills/certifications/${id}`);
      toast.success('Certification deleted');
      loadCertifications();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const getProficiencyBadge = (level) => {
    switch (level) {
      case 'expert': return 'badge-primary';
      case 'advanced': return 'badge-green';
      case 'intermediate': return 'badge-orange';
      default: return 'badge-gray';
    }
  };

  const getCertStatusBadge = (status) => {
    switch (status) {
      case 'active': return 'badge-green';
      case 'expired': return 'badge-red';
      default: return 'badge-gray';
    }
  };

  const isExpiringSoon = (expiryDate) => {
    if (!expiryDate) return false;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Skills & Certifications</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {skills.length} skill{skills.length !== 1 ? 's' : ''} · {certifications.length} certification{certifications.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Skills */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1">Skills</h2>
          <button onClick={() => setShowSkillModal(true)} className="btn btn-primary btn-sm">
            Add Skill
          </button>
        </div>
        {skills.length === 0 ? (
          <EmptyState title="No skills recorded" message="Add skills to track staff capabilities." />
        ) : (
          <div className="space-y-2">
            {skills.map((s, i) => (
              <div key={s.id} className="card p-4 flex items-center justify-between animate-slide-up" style={{animationDelay: `${i*50}ms`}}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-[15px]">{s.skill_name}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getProficiencyBadge(s.proficiency_level)}`}>
                      {s.proficiency_level}
                    </span>
                  </div>
                  {s.verified_at && (
                    <p className="text-[11px] text-[var(--color-text-secondary)]">
                      Verified {new Date(s.verified_at).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex gap-1">
                  <select
                    value={s.proficiency_level}
                    onChange={(e) => handleUpdateSkill(s.id, { proficiency_level: e.target.value })}
                    className="input-field text-xs w-24"
                  >
                    <option value="beginner">Beginner</option>
                    <option value="intermediate">Intermediate</option>
                    <option value="advanced">Advanced</option>
                    <option value="expert">Expert</option>
                  </select>
                  <button onClick={() => handleDeleteSkill(s.id)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-red-500" title="Delete">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Certifications */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1">Certifications</h2>
          <button onClick={() => setShowCertModal(true)} className="btn btn-primary btn-sm">
            Add Certification
          </button>
        </div>
        {certifications.length === 0 ? (
          <EmptyState title="No certifications recorded" message="Add certifications to track staff qualifications." />
        ) : (
          <div className="space-y-2">
            {certifications.map((c, i) => (
              <div key={c.id} className={`card p-4 animate-slide-up ${isExpiringSoon(c.expiry_date) ? 'border-orange-300 dark:border-orange-700' : ''}`} style={{animationDelay: `${i*50}ms`}}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-[15px]">{c.certification_name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${getCertStatusBadge(c.status)}`}>
                        {c.status}
                      </span>
                      {isExpiringSoon(c.expiry_date) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold badge-orange">
                          Expiring soon
                        </span>
                      )}
                    </div>
                    {c.issuer && <p className="text-[12px] text-[var(--color-text-secondary)]">Issued by: {c.issuer}</p>}
                    <div className="flex gap-4 mt-1 text-[11px] text-[var(--color-text-secondary)]">
                      {c.issue_date && <span>Issued: {new Date(c.issue_date).toLocaleDateString()}</span>}
                      {c.expiry_date && <span>Expires: {new Date(c.expiry_date).toLocaleDateString()}</span>}
                    </div>
                    {c.certificate_number && (
                      <p className="text-[11px] text-[var(--color-text-secondary)] mt-1">#{c.certificate_number}</p>
                    )}
                  </div>
                  <button onClick={() => handleDeleteCert(c.id)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-red-500 shrink-0" title="Delete">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Skill Modal */}
      {showSkillModal && (
        <Modal onClose={() => setShowSkillModal(false)} title="Add Skill">
          <form onSubmit={handleAddSkill} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Skill Name</label>
              <input
                type="text"
                value={skillForm.skill_name}
                onChange={e => setSkillForm({...skillForm, skill_name: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., First Aid, Bartending"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Proficiency Level</label>
              <select
                value={skillForm.proficiency_level}
                onChange={e => setSkillForm({...skillForm, proficiency_level: e.target.value})}
                className="input-field"
              >
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
                <option value="expert">Expert</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Verified At (optional)</label>
              <input
                type="date"
                value={skillForm.verified_at}
                onChange={e => setSkillForm({...skillForm, verified_at: e.target.value})}
                className="input-field"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Add Skill</button>
              <button type="button" onClick={() => setShowSkillModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Certification Modal */}
      {showCertModal && (
        <Modal onClose={() => setShowCertModal(false)} title="Add Certification">
          <form onSubmit={handleAddCert} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Certification Name</label>
              <input
                type="text"
                value={certForm.certification_name}
                onChange={e => setCertForm({...certForm, certification_name: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., Food Safety Certificate"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Issuer (optional)</label>
              <input
                type="text"
                value={certForm.issuer}
                onChange={e => setCertForm({...certForm, issuer: e.target.value})}
                className="input-field"
                placeholder="e.g., Red Cross"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Issue Date (optional)</label>
                <input
                  type="date"
                  value={certForm.issue_date}
                  onChange={e => setCertForm({...certForm, issue_date: e.target.value})}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Expiry Date (optional)</label>
                <input
                  type="date"
                  value={certForm.expiry_date}
                  onChange={e => setCertForm({...certForm, expiry_date: e.target.value})}
                  className="input-field"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Certificate Number (optional)</label>
              <input
                type="text"
                value={certForm.certificate_number}
                onChange={e => setCertForm({...certForm, certificate_number: e.target.value})}
                className="input-field"
                placeholder="e.g., CERT-12345"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Add Certification</button>
              <button type="button" onClick={() => setShowCertModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
