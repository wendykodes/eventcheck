import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ImageGallery from '../components/ImageGallery';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function MenuManagementPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [menuItems, setMenuItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showItemModal, setShowItemModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [itemForm, setItemForm] = useState({
    kind: 'DRINK',
    label: '',
    description: '',
    price: '',
    available: true
  });
  const [categoryForm, setCategoryForm] = useState({
    name: '',
    icon: '',
    display_order: 0
  });

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    try {
      const [itemsData, categoriesData] = await Promise.all([
        api.get(`/menus?event_id=${eventId}`),
        api.get(`/menus/categories?event_id=${eventId}`)
      ]);
      setMenuItems(itemsData.items || []);
      setCategories(categoriesData || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveItem = async (e) => {
    e.preventDefault();
    try {
      if (editingItem) {
        await api.put(`/menus/${editingItem.id}`, itemForm);
        toast.success('Menu item updated');
      } else {
        await api.post('/menus', { ...itemForm, event_id: Number(eventId) });
        toast.success('Menu item added');
      }
      setShowItemModal(false);
      setEditingItem(null);
      setItemForm({ kind: 'DRINK', label: '', description: '', price: '', available: true });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteItem = async (id) => {
    if (!confirm('Delete this menu item?')) return;
    try {
      await api.delete(`/menus/${id}`);
      toast.success('Menu item deleted');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSaveCategory = async (e) => {
    e.preventDefault();
    try {
      await api.post('/menus/categories', { ...categoryForm, event_id: Number(eventId) });
      toast.success('Category added');
      setShowCategoryModal(false);
      setCategoryForm({ name: '', icon: '', display_order: 0 });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleEditItem = (item) => {
    setEditingItem(item);
    setItemForm({
      kind: item.kind,
      label: item.label,
      description: item.description || '',
      price: item.price || '',
      available: item.available !== 0
    });
    setShowItemModal(true);
  };

  const KIND_LABEL = { DRINK: '🍹 Drinks', BITE: '🍢 Bites', ASSISTANCE: '🙋 Assistance', OTHER: '✨ More' };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Food & Drinks</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {menuItems.length} item{menuItems.length !== 1 ? 's' : ''} · {categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCategoryModal(true)} className="btn btn-secondary btn-sm">
            Add Category
          </button>
          <button onClick={() => setShowItemModal(true)} className="btn btn-primary btn-sm">
            Add Item
          </button>
        </div>
      </div>

      <EventTabs currentKey="menu" adminOnly={true} />

      {/* Menu Items by Kind */}
      {Object.keys(KIND_LABEL).map(kind => {
        const items = menuItems.filter(i => i.kind === kind);
        if (items.length === 0) return null;
        return (
          <div key={kind} className="card p-4 space-y-2">
            <p className="font-bold">{KIND_LABEL[kind]}</p>
            {items.map((item, idx) => (
              <div key={item.id} className="flex items-center justify-between p-3 bg-[var(--color-surface-hover)] rounded-lg animate-slide-up" style={{animationDelay: `${idx * 30}ms`}}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{item.label}</span>
                    {!item.available && <span className="text-[10px] px-2 py-0.5 rounded-full badge-gray">Unavailable</span>}
                  </div>
                  {item.description && <p className="text-xs text-[var(--color-text-secondary)] mt-1">{item.description}</p>}
                  {item.price && <p className="text-sm font-medium mt-1">${item.price}</p>}
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleEditItem(item)} className="btn btn-ghost btn-icon text-xs">
                    Edit
                  </button>
                  <button onClick={() => handleDeleteItem(item.id)} className="btn btn-ghost btn-icon text-red-500 text-xs">
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {menuItems.length === 0 && (
        <EmptyState title="No menu items" message="Add menu items to allow guests to request food and drinks." />
      )}

      {/* Add Item Modal */}
      {showItemModal && (
        <Modal onClose={() => { setShowItemModal(false); setEditingItem(null); setItemForm({ kind: 'DRINK', label: '', description: '', price: '', available: true }); }} title={editingItem ? 'Edit Menu Item' : 'Add Menu Item'}>
          <form onSubmit={handleSaveItem} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={itemForm.kind}
                onChange={e => setItemForm({...itemForm, kind: e.target.value})}
                className="input-field"
              >
                <option value="DRINK">🍹 Drink</option>
                <option value="BITE">🍢 Bite</option>
                <option value="ASSISTANCE">🙋 Assistance</option>
                <option value="OTHER">✨ Other</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Label</label>
              <input
                type="text"
                value={itemForm.label}
                onChange={e => setItemForm({...itemForm, label: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., Signature Cocktail"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <textarea
                value={itemForm.description}
                onChange={e => setItemForm({...itemForm, description: e.target.value})}
                className="input-field"
                rows={2}
                placeholder="Item description..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Price (optional)</label>
              <input
                type="number"
                step="0.01"
                value={itemForm.price}
                onChange={e => setItemForm({...itemForm, price: e.target.value})}
                className="input-field"
                placeholder="0.00"
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={itemForm.available}
                onChange={e => setItemForm({...itemForm, available: e.target.checked})}
                className="w-4 h-4"
              />
              <span className="text-sm">Available for guests</span>
            </label>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">{editingItem ? 'Update' : 'Add'} Item</button>
              <button type="button" onClick={() => setShowItemModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Category Modal */}
      {showCategoryModal && (
        <Modal onClose={() => { setShowCategoryModal(false); setCategoryForm({ name: '', icon: '', display_order: 0 }); }} title="Add Category">
          <form onSubmit={handleSaveCategory} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={categoryForm.name}
                onChange={e => setCategoryForm({...categoryForm, name: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., Signature Cocktails"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Icon (emoji, optional)</label>
              <input
                type="text"
                value={categoryForm.icon}
                onChange={e => setCategoryForm({...categoryForm, icon: e.target.value})}
                className="input-field"
                placeholder="🍹"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Display Order</label>
              <input
                type="number"
                value={categoryForm.display_order}
                onChange={e => setCategoryForm({...categoryForm, display_order: Number(e.target.value)})}
                className="input-field"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Add Category</button>
              <button type="button" onClick={() => setShowCategoryModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
