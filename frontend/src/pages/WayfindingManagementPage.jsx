import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function WayfindingManagementPage() {
  const { eventId } = useParams();
  const auth = useAuth();
  
  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [routes, setRoutes] = useState([]);
  const [zones, setZones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState(null);
  const [routeForm, setRouteForm] = useState({
    from_zone: '',
    to_zone: '',
    description: '',
    distance_meters: '',
    estimated_minutes: '',
    instructions: '',
    accessibility: ''
  });

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    try {
      const [routesData, zonesData] = await Promise.all([
        api.getWayfindingRoutes(eventId),
        api.get(`/seating/zones?event_id=${eventId}`)
      ]);
      setRoutes(routesData || []);
      setZones(zonesData || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveRoute = async (e) => {
    e.preventDefault();
    try {
      if (editingRoute) {
        await api.updateWayfindingRoute(editingRoute.id, routeForm);
        toast.success('Route updated');
      } else {
        await api.addWayfindingRoute({ ...routeForm, event_id: Number(eventId) });
        toast.success('Route added');
      }
      setShowRouteModal(false);
      setEditingRoute(null);
      setRouteForm({
        from_zone: '',
        to_zone: '',
        description: '',
        distance_meters: '',
        estimated_minutes: '',
        instructions: '',
        accessibility: ''
      });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteRoute = async (id) => {
    if (!confirm('Delete this route?')) return;
    try {
      await api.deleteWayfindingRoute(id);
      toast.success('Route deleted');
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleEditRoute = (route) => {
    setEditingRoute(route);
    setRouteForm({
      from_zone: route.from_zone,
      to_zone: route.to_zone,
      description: route.description || '',
      distance_meters: route.distance_meters || '',
      estimated_minutes: route.estimated_minutes || '',
      instructions: route.instructions || '',
      accessibility: route.accessibility || ''
    });
    setShowRouteModal(true);
  };

  const handleDuplicateRoute = (route) => {
    setEditingRoute(null);
    setRouteForm({
      from_zone: route.from_zone,
      to_zone: route.to_zone,
      description: route.description ? `${route.description} (Copy)` : '',
      distance_meters: route.distance_meters || '',
      estimated_minutes: route.estimated_minutes || '',
      instructions: route.instructions || '',
      accessibility: route.accessibility || ''
    });
    setShowRouteModal(true);
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Maps & Directions</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {routes.length} route{routes.length !== 1 ? 's' : ''} · {zones.length} zone{zones.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowRouteModal(true)} className="btn btn-primary btn-sm">
          Add Route
        </button>
      </div>

      <EventTabs currentKey="wayfinding" adminOnly={true} />

      {/* Routes */}
      {routes.length === 0 ? (
        <EmptyState title="No routes configured" message="Add wayfinding routes to help guests navigate the venue." />
      ) : (
        <div className="card p-4 space-y-2">
          {routes.map((route, idx) => (
            <div key={route.id} className="flex items-start justify-between p-4 bg-[var(--color-surface-hover)] rounded-lg animate-slide-up" style={{animationDelay: `${idx * 30}ms`}}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold">{route.from_zone}</span>
                  <svg className="w-4 h-4 text-[var(--color-text-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span className="font-semibold">{route.to_zone}</span>
                </div>
                {route.description && <p className="text-sm text-[var(--color-text-secondary)]">{route.description}</p>}
                {route.instructions && (
                  <div className="mt-2 p-2 bg-[var(--color-surface)] rounded text-xs">
                    <p className="font-medium mb-1">Instructions:</p>
                    <p className="whitespace-pre-wrap">{route.instructions}</p>
                  </div>
                )}
                <div className="flex gap-4 mt-2 text-xs text-[var(--color-text-secondary)]">
                  {route.distance_meters && <span>📏 {route.distance_meters}m</span>}
                  {route.estimated_minutes && <span>⏱️ {route.estimated_minutes} min</span>}
                  {route.accessibility && (
                    <span className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-600">
                      {route.accessibility}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1 ml-2">
                <button onClick={() => handleEditRoute(route)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-blue-500" title="Edit">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button onClick={() => handleDuplicateRoute(route)} className="btn btn-ghost btn-icon text-[var(--color-text-secondary)] hover:text-green-500" title="Duplicate">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                  </svg>
                </button>
                <button onClick={() => handleDeleteRoute(route.id)} className="btn btn-ghost btn-icon text-red-500" title="Delete">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Route Modal */}
      {showRouteModal && (
        <Modal onClose={() => { setShowRouteModal(false); setEditingRoute(null); }} title={editingRoute ? 'Edit Route' : 'Add New Path'}>
          <form onSubmit={handleSaveRoute} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">From Zone</label>
              <select
                value={routeForm.from_zone}
                onChange={e => setRouteForm({...routeForm, from_zone: e.target.value})}
                className="input-field"
                required
              >
                <option value="">Select starting zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.name}>{zone.name}</option>
                ))}
                <option value="Entrance">Entrance</option>
                <option value="Parking">Parking</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Zone</label>
              <select
                value={routeForm.to_zone}
                onChange={e => setRouteForm({...routeForm, to_zone: e.target.value})}
                className="input-field"
                required
              >
                <option value="">Select destination zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.name}>{zone.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <input
                type="text"
                value={routeForm.description}
                onChange={e => setRouteForm({...routeForm, description: e.target.value})}
                className="input-field"
                placeholder="e.g., Main Hall to VIP Lounge"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium mb-1">Distance (meters, optional)</label>
                <input
                  type="number"
                  value={routeForm.distance_meters}
                  onChange={e => setRouteForm({...routeForm, distance_meters: e.target.value})}
                  className="input-field"
                  placeholder="50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Est. Time (minutes, optional)</label>
                <input
                  type="number"
                  value={routeForm.estimated_minutes}
                  onChange={e => setRouteForm({...routeForm, estimated_minutes: e.target.value})}
                  className="input-field"
                  placeholder="2"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Instructions (optional)</label>
              <textarea
                value={routeForm.instructions}
                onChange={e => setRouteForm({...routeForm, instructions: e.target.value})}
                className="input-field"
                rows={3}
                placeholder="Turn left at the entrance, walk straight for 20m..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Accessibility Options (optional)</label>
              <select
                value={routeForm.accessibility}
                onChange={e => setRouteForm({...routeForm, accessibility: e.target.value})}
                className="input-field"
              >
                <option value="">Standard route</option>
                <option value="elevator">Has elevator access</option>
                <option value="ramp">Has ramp access</option>
                <option value="wheelchair">Wheelchair accessible</option>
                <option value="stairs">Stairs only</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">{editingRoute ? 'Update Route' : 'Add Route'}</button>
              <button type="button" onClick={() => { setShowRouteModal(false); setEditingRoute(null); }} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
