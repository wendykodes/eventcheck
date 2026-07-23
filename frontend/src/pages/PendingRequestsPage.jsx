import { useState, useEffect } from 'react';
import { api } from '../api/client';
import toast from 'react-hot-toast';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

export default function PendingRequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  const load = async () => {
    try {
      const r = await api.getRegistrationRequests();
      setRequests(r);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id) => {
    setProcessing(id);
    try {
      await api.approveRegistration(id);
      toast.success('Staff approved');
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      toast.error(err.message);
    }
    setProcessing(null);
  };

  const handleReject = async (id) => {
    setProcessing(id);
    try {
      await api.rejectRegistration(id);
      toast.success('Request rejected');
      setRequests(prev => prev.filter(r => r.id !== id));
    } catch (err) {
      toast.error(err.message);
    }
    setProcessing(null);
  };

  if (loading) return <div className="pt-4 space-y-3"><SkeletonCard lines={3} /><SkeletonCard lines={3} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <h1 className="text-[22px] font-bold tracking-tight px-1">Pending Requests</h1>

      {requests.length === 0 ? (
        <EmptyState title="No Pending Requests" message="All registration requests have been processed." />
      ) : (
        <div className="space-y-3">
          {requests.map((r, i) => (
            <div key={r.id} className="card p-4 animate-slide-up" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-[16px]">{r.name}</h3>
                  <div className="text-sm text-[var(--color-text-secondary)] space-y-0.5 mt-1">
                    {r.phone && <p>📞 {r.phone}</p>}
                    {r.email && <p>✉ {r.email}</p>}
                    <p className="text-blue-500 font-medium">{r.event_name}</p>
                    <p className="text-[12px]">{new Date(r.created_at + 'Z').toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => handleReject(r.id)} disabled={processing === r.id}
                    className="btn btn-ghost btn-sm text-red-500 disabled:opacity-50">
                    Reject
                  </button>
                  <button onClick={() => handleApprove(r.id)} disabled={processing === r.id}
                    className="btn btn-primary btn-sm disabled:opacity-50">
                    {processing === r.id ? '...' : 'Approve'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
