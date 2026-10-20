import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function FinancesPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  const [finances, setFinances] = useState([]);
  const [summary, setSummary] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    category: 'expense',
    subcategory: '',
    description: '',
    amount: '',
    currency: 'USD',
    notes: ''
  });
  const [budgetForm, setBudgetForm] = useState({
    category: '',
    subcategory: '',
    budget_amount: '',
    currency: 'USD'
  });

  useEffect(() => {
    loadFinances();
    loadBudgets();
  }, [eventId]);

  const loadFinances = async () => {
    try {
      const data = await api.get(`/events/${eventId}/finances`);
      setFinances(data.finances || []);
      setSummary(data.summary);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const loadBudgets = async () => {
    try {
      const data = await api.getBudgets(eventId);
      setBudgets(data || []);
    } catch (err) {
      console.error('Failed to load budgets:', err);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    try {
      await api.post(`/events/${eventId}/finances`, {
        ...createForm,
        amount: parseFloat(createForm.amount)
      });
      toast.success('Record added');
      setShowCreateModal(false);
      setCreateForm({
        category: 'expense',
        subcategory: '',
        description: '',
        amount: '',
        currency: 'USD',
        notes: ''
      });
      loadFinances();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this record?')) return;
    try {
      await api.delete(`/events/${eventId}/finances/${id}`);
      toast.success('Record deleted');
      loadFinances();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleApprove = async (id) => {
    try {
      await api.approveFinance(eventId, id);
      toast.success('Record approved');
      loadFinances();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleReject = async (id) => {
    try {
      await api.rejectFinance(eventId, id);
      toast.success('Record rejected');
      loadFinances();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleCreateBudget = async (e) => {
    e.preventDefault();
    try {
      await api.createBudget(eventId, {
        ...budgetForm,
        budget_amount: parseFloat(budgetForm.budget_amount)
      });
      toast.success('Budget created');
      setShowBudgetModal(false);
      setBudgetForm({
        category: '',
        subcategory: '',
        budget_amount: '',
        currency: 'USD'
      });
      loadBudgets();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Money & Budget</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Track money coming in and going out
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreateModal(true)} className="btn btn-primary btn-sm">
            Add Record
          </button>
          <button onClick={() => setShowBudgetModal(true)} className="btn btn-secondary btn-sm">
            Add Budget
          </button>
          <button onClick={() => api.exportFinances(eventId)} className="btn btn-secondary btn-sm">
            Export CSV
          </button>
        </div>
      </div>

      <EventTabs currentKey="finances" adminOnly={true} />

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="card p-4 bg-green-50 dark:bg-green-900/20">
            <div className="text-[20px] font-bold text-green-600">${summary.revenue.toFixed(2)}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Total Revenue</div>
          </div>
          <div className="card p-4 bg-red-50 dark:bg-red-900/20">
            <div className="text-[20px] font-bold text-red-600">${summary.expenses.toFixed(2)}</div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Total Expenses</div>
          </div>
          <div className="card p-4">
            <div className={`text-[20px] font-bold ${summary.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${summary.profit.toFixed(2)}
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Net Profit</div>
          </div>
          <div className="card p-4">
            <div className={`text-[20px] font-bold ${summary.margin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {summary.margin}%
            </div>
            <div className="text-[11px] text-[var(--color-text-secondary)]">Profit Margin</div>
          </div>
        </div>
      )}

      {/* Budget Tracking */}
      {budgets.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider px-1 mb-2">Budget vs Actual</h2>
          <div className="space-y-2">
            {budgets.map((budget, i) => (
              <div key={budget.id} className="card p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-sm">{budget.category}{budget.subcategory ? ` - ${budget.subcategory}` : ''}</span>
                  <span className="text-xs text-[var(--color-text-secondary)]">{budget.currency}</span>
                </div>
                <div className="progress-bar mb-1">
                  <div 
                    className="progress-fill" 
                    style={{ 
                      width: `${Math.min((budget.spent / budget.budget_amount) * 100, 100)}%`,
                      backgroundColor: (budget.spent / budget.budget_amount) > 0.9 ? '#ef4444' : (budget.spent / budget.budget_amount) > 0.75 ? '#f59e0b' : '#22c55e'
                    }} 
                  />
                </div>
                <div className="flex justify-between text-xs text-[var(--color-text-secondary)]">
                  <span>${budget.spent.toFixed(2)} spent</span>
                  <span>${budget.budget_amount.toFixed(2)} budget</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Records */}
      {finances.length === 0 ? (
        <EmptyState
          title="No financial records"
          message="Add revenue and expense records to track event finances"
        />
      ) : (
        <div className="space-y-2">
          {finances.map((f) => (
            <div key={f.id} className="card p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-[15px]">{f.description}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                    f.category === 'revenue' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                  }`}>
                    {f.category}
                  </span>
                  {f.subcategory && (
                    <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--color-bg-secondary)] text-[var(--color-text-secondary)]">
                      {f.subcategory}
                    </span>
                  )}
                  {f.status && (
                    <span className={`text-[10px] px-2 py-0.5 rounded ${
                      f.status === 'APPROVED' ? 'bg-green-100 text-green-700' : 
                      f.status === 'REJECTED' ? 'bg-red-100 text-red-700' : 
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {f.status}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-[var(--color-text-secondary)]">
                  {new Date(f.recorded_at).toLocaleString()} · by {f.recorded_by_name}
                </div>
                {f.notes && (
                  <div className="text-[11px] text-[var(--color-text-secondary)] mt-1">{f.notes}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className={`text-[16px] font-bold ${f.category === 'revenue' ? 'text-green-600' : 'text-red-600'}`}>
                  {f.category === 'revenue' ? '+' : '-'}${f.amount.toFixed(2)}
                </div>
                <div className="flex gap-2 mt-1">
                  {f.status === 'PENDING' && auth.user?.role === 'admin' && (
                    <>
                      <button onClick={() => handleApprove(f.id)} className="text-[10px] text-green-500 hover:underline">
                        Approve
                      </button>
                      <button onClick={() => handleReject(f.id)} className="text-[10px] text-red-500 hover:underline">
                        Reject
                      </button>
                    </>
                  )}
                  <button onClick={() => handleDelete(f.id)} className="text-[10px] text-red-500 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <Modal onClose={() => setShowCreateModal(false)} title="Add Financial Record">
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={createForm.category}
                onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}
                className="input-field"
                required
              >
                <option value="expense">Expense</option>
                <option value="revenue">Revenue</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subcategory (optional)</label>
              <input
                type="text"
                value={createForm.subcategory}
                onChange={(e) => setCreateForm({ ...createForm, subcategory: e.target.value })}
                className="input-field"
                placeholder="e.g., Venue, Catering, Ticket Sales"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <input
                type="text"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                className="input-field"
                required
                placeholder="Description of the item"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Amount</label>
              <input
                type="number"
                step="0.01"
                value={createForm.amount}
                onChange={(e) => setCreateForm({ ...createForm, amount: e.target.value })}
                className="input-field"
                required
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={createForm.currency}
                onChange={(e) => setCreateForm({ ...createForm, currency: e.target.value })}
                className="input-field"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Notes (optional)</label>
              <textarea
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
                className="input-field"
                rows={2}
                placeholder="Additional notes..."
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowCreateModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Add Record
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showBudgetModal && (
        <Modal onClose={() => setShowBudgetModal(false)} title="Add Budget">
          <form onSubmit={handleCreateBudget} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Category</label>
              <select
                value={budgetForm.category}
                onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })}
                className="input-field"
                required
              >
                <option value="">Select category</option>
                <option value="venue">Venue</option>
                <option value="catering">Catering</option>
                <option value="staffing">Staffing</option>
                <option value="equipment">Equipment</option>
                <option value="marketing">Marketing</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Subcategory (optional)</label>
              <input
                type="text"
                value={budgetForm.subcategory}
                onChange={(e) => setBudgetForm({ ...budgetForm, subcategory: e.target.value })}
                className="input-field"
                placeholder="e.g., Main Hall, Drinks, Security"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Budget Amount</label>
              <input
                type="number"
                step="0.01"
                value={budgetForm.budget_amount}
                onChange={(e) => setBudgetForm({ ...budgetForm, budget_amount: e.target.value })}
                className="input-field"
                required
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Currency</label>
              <select
                value={budgetForm.currency}
                onChange={(e) => setBudgetForm({ ...budgetForm, currency: e.target.value })}
                className="input-field"
              >
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="CAD">CAD</option>
              </select>
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setShowBudgetModal(false)} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" className="btn btn-primary">
                Add Budget
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
