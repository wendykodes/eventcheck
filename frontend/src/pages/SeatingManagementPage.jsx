import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../api/client';
import { SkeletonCard } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { useAuth } from '../hooks/useAuth';
import EventTabs from '../components/EventTabs';

export default function SeatingManagementPage() {
  const { eventId } = useParams();
  const auth = useAuth();

  if (auth.user?.role !== 'admin') {
    return <div className="pt-4 text-center text-[var(--color-text-secondary)]">Admin access required</div>;
  }

  const [zones, setZones] = useState([]);
  const [tables, setTables] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showZoneModal, setShowZoneModal] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [selectedZone, setSelectedZone] = useState(null);
  const [zoneForm, setZoneForm] = useState({ name: '', description: '', capacity: '', color: '#6366f1' });
  const [tableForm, setTableForm] = useState({ zone_id: '', table_number: '', capacity: 4, shape: 'rectangular' });
  const [guests, setGuests] = useState([]);
  const [draggingItem, setDraggingItem] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const floorPlanRef = useRef(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [showSeatLayout, setShowSeatLayout] = useState(false);
  const [draggingGuest, setDraggingGuest] = useState(null);
  const [hoveredTable, setHoveredTable] = useState(null);
  const [assignmentForm, setAssignmentForm] = useState({ guest_id: '', table_id: '', zone_id: '', seat_number: '' });
  const [showAssignmentModal, setShowAssignmentModal] = useState(false);
  const [guestSearch, setGuestSearch] = useState('');
  const [autoAssign, setAutoAssign] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [zonesData, tablesData, assignmentsData, guestsData] = await Promise.all([
        api.get(`/seating/zones?event_id=${eventId}`),
        api.get(`/seating/tables?event_id=${eventId}`),
        api.get(`/seating/assignments?event_id=${eventId}`),
        api.get(`/guests?event_id=${eventId}`)
      ]);
      setZones(zonesData || []);
      setTables(tablesData || []);
      setAssignments(assignmentsData || []);
      setGuests(guestsData || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveZone = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...zoneForm,
        event_id: Number(eventId),
        map_x: 10,
        map_y: 10,
        capacity: zoneForm.capacity ? Number(zoneForm.capacity) : null
      };
      await api.post('/seating/zones', payload);
      toast.success('Zone added', { icon: '✨' });
      setShowZoneModal(false);
      setZoneForm({ name: '', description: '', capacity: '', color: '#6366f1' });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSaveTable = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        ...tableForm,
        event_id: Number(eventId),
        map_x: 50,
        map_y: 50,
        zone_id: tableForm.zone_id ? Number(tableForm.zone_id) : null
      };
      await api.post('/seating/tables', payload);
      toast.success('Table added', { icon: '🪑' });
      setShowTableModal(false);
      setTableForm({ zone_id: '', table_number: '', capacity: 4, shape: 'rectangular' });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdateZonePosition = async (id, map_x, map_y) => {
    try {
      await api.put(`/seating/zones/${id}`, { map_x, map_y });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleUpdateTablePosition = async (id, map_x, map_y, rotation) => {
    try {
      await api.put(`/seating/tables/${id}`, { map_x, map_y, rotation });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleMouseDown = (e, item, type) => {
    if (draggingGuest) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = floorPlanRef.current.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = 100 / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const itemX = item.map_x !== undefined && item.map_x !== null ? item.map_x : 10;
    const itemY = item.map_y !== undefined && item.map_y !== null ? item.map_y : 10;
    setDraggingItem({ ...item, type, map_x: itemX, map_y: itemY });
    setDragOffset({ x: x - itemX, y: y - itemY });
  };

  const handleMouseMove = (e) => {
    if (!draggingItem || !floorPlanRef.current) return;
    const rect = floorPlanRef.current.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = 100 / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    const newX = Math.max(0, Math.min(100, x - dragOffset.x));
    const newY = Math.max(0, Math.min(100, y - dragOffset.y));

    if (draggingItem.type === 'zone') {
      setZones(zones.map(z => z.id === draggingItem.id ? { ...z, map_x: newX, map_y: newY } : z));
      setDraggingItem({ ...draggingItem, map_x: newX, map_y: newY });
    } else {
      setTables(tables.map(t => t.id === draggingItem.id ? { ...t, map_x: newX, map_y: newY } : t));
      setDraggingItem({ ...draggingItem, map_x: newX, map_y: newY });
    }
  };

  const handleMouseUp = () => {
    if (!draggingItem) return;
    const { id, type, map_x, map_y } = draggingItem;
    if (type === 'zone') {
      handleUpdateZonePosition(id, map_x, map_y);
    } else {
      handleUpdateTablePosition(id, map_x, map_y, draggingItem.rotation);
    }
    setDraggingItem(null);
  };

  const handleTouchStart = (e, item, type) => {
    if (draggingGuest) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = floorPlanRef.current.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = 100 / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    const itemX = item.map_x !== undefined && item.map_x !== null ? item.map_x : 10;
    const itemY = item.map_y !== undefined && item.map_y !== null ? item.map_y : 10;
    setDraggingItem({ ...item, type, map_x: itemX, map_y: itemY });
    setDragOffset({ x: x - itemX, y: y - itemY });
  };

  const handleTouchMove = (e) => {
    if (!draggingItem || !floorPlanRef.current) return;
    e.preventDefault();
    const touch = e.touches[0];
    const rect = floorPlanRef.current.getBoundingClientRect();
    const scaleX = 100 / rect.width;
    const scaleY = 100 / rect.height;
    const x = (touch.clientX - rect.left) * scaleX;
    const y = (touch.clientY - rect.top) * scaleY;
    const newX = Math.max(0, Math.min(100, x - dragOffset.x));
    const newY = Math.max(0, Math.min(100, y - dragOffset.y));

    if (draggingItem.type === 'zone') {
      setZones(zones.map(z => z.id === draggingItem.id ? { ...z, map_x: newX, map_y: newY } : z));
      setDraggingItem({ ...draggingItem, map_x: newX, map_y: newY });
    } else {
      setTables(tables.map(t => t.id === draggingItem.id ? { ...t, map_x: newX, map_y: newY } : t));
      setDraggingItem({ ...draggingItem, map_x: newX, map_y: newY });
    }
  };

  const handleTouchEnd = () => {
    if (!draggingItem) return;
    const { id, type, map_x, map_y } = draggingItem;
    if (type === 'zone') {
      handleUpdateZonePosition(id, map_x, map_y);
    } else {
      handleUpdateTablePosition(id, map_x, map_y, draggingItem.rotation);
    }
    setDraggingItem(null);
  };

  const handleGuestDragStart = (guest) => {
    setDraggingGuest(guest);
  };

  const handleGuestDragEnd = () => {
    setDraggingGuest(null);
    setHoveredTable(null);
  };

  const handleTableDragOver = (e, table) => {
    e.preventDefault();
    if (draggingGuest) {
      setHoveredTable(table);
    }
  };

  const handleTableDrop = async (e, table) => {
    e.preventDefault();
    if (!draggingGuest) return;

    const existingAssignment = assignments.find(a => a.guest_id === draggingGuest.id);
    if (existingAssignment && existingAssignment.table_id !== table.id) {
      if (!confirm(`${draggingGuest.name} is already at ${existingAssignment.table_number ? 'Table ' + existingAssignment.table_number : existingAssignment.zone_name}. Move them?`)) {
        setDraggingGuest(null);
        setHoveredTable(null);
        return;
      }
    }

    setSelectedTable(table);
    setDraggingGuest(null);
    setHoveredTable(null);
    setShowSeatLayout(true);
  };

  const handleFloorPlanDrop = (e) => {
    e.preventDefault();
    if (!draggingGuest) return;
    setDraggingGuest(null);
    setHoveredTable(null);
    toast.error('Drop on a specific table to assign');
  };

  const handleSaveAssignment = async (e, customPayload = null) => {
    if (e) e.preventDefault();
    try {
      const payload = customPayload || {
        ...assignmentForm,
        event_id: Number(eventId),
        guest_id: assignmentForm.guest_id ? Number(assignmentForm.guest_id) : null,
        table_id: assignmentForm.table_id ? Number(assignmentForm.table_id) : null,
        zone_id: assignmentForm.zone_id ? Number(assignmentForm.zone_id) : null
      };
      await api.post('/seating/assignments', payload);
      toast.success('Guest assigned', { icon: '✅' });
      if (!customPayload) {
        setShowAssignmentModal(false);
        setAssignmentForm({ guest_id: '', table_id: '', zone_id: '', seat_number: '' });
      }
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleAutoAssign = async () => {
    const unassignedGuests = guests.filter(g => !assignments.find(a => a.guest_id === g.id));
    if (unassignedGuests.length === 0) {
      toast.success('All guests already assigned!', { icon: '🎉' });
      return;
    }

    if (tables.length === 0) {
      toast.error('No tables available for assignment');
      return;
    }

    let totalAssigned = 0;
    for (const guest of unassignedGuests) {
      for (const table of tables) {
        const tableAssignedCount = assignments.filter(a => a.table_id === table.id).length;
        if (tableAssignedCount < table.capacity) {
          const usedSeats = assignments.filter(a => a.table_id === table.id).map(a => a.seat_number);
          let nextSeat = 1;
          while (usedSeats.includes(nextSeat.toString())) {
            nextSeat++;
          }
          try {
            await api.post('/seating/assignments', {
              event_id: Number(eventId),
              guest_id: guest.id,
              table_id: table.id,
              seat_number: nextSeat.toString(),
              zone_id: table.zone_id
            });
            totalAssigned++;
            break;
          } catch (err) {
            console.error('Auto-assign failed for guest:', guest.name, err);
          }
        }
      }
    }

    if (totalAssigned > 0) {
      toast.success(`Auto-assigned ${totalAssigned} guests`, { icon: '🤖' });
      loadData();
    } else {
      toast.error('No available seats');
    }
  };

  const handleDeleteZone = async (id) => {
    if (!confirm('Delete this zone? This will also delete all tables in this zone.')) return;
    try {
      await api.delete(`/seating/zones/${id}`);
      toast.success('Zone deleted', { icon: '🗑️' });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteTable = async (id) => {
    const tableAssignments = assignments.filter(a => a.table_id === id);
    if (tableAssignments.length > 0) {
      if (!confirm(`Delete this table? ${tableAssignments.length} guest(s) will be unassigned.`)) return;
    } else {
      if (!confirm('Delete this table?')) return;
    }
    try {
      await api.delete(`/seating/tables/${id}`);
      toast.success('Table deleted', { icon: '🗑️' });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleDeleteAssignment = async (id) => {
    if (!confirm('Remove this guest from their seat?')) return;
    try {
      await api.delete(`/seating/assignments/${id}`);
      toast.success('Guest unassigned', { icon: '👋' });
      loadData();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="pt-4 space-y-4"><SkeletonCard lines={5} /></div>;

  return (
    <div className="pt-2 space-y-4 animate-fade-in">
      <div className="px-1 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Seat Arrangements</h1>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            {zones.length} zone{zones.length !== 1 ? 's' : ''} · {tables.length} table{tables.length !== 1 ? 's' : ''} · {assignments.length} assigned{assignments.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="btn btn-secondary btn-sm" title="Print seating chart">
            🖨️ Print
          </button>
          <button onClick={handleAutoAssign} className="btn btn-secondary btn-sm" title="Auto-assign unassigned guests">
            🤖 Auto-Assign
          </button>
          <button onClick={() => setShowAssignmentModal(true)} className="btn btn-secondary btn-sm" title="Manually assign a guest">
            ✏️ Assign
          </button>
          <button onClick={() => setShowTableModal(true)} className="btn btn-secondary btn-sm" title="Add a new table">
            ➕ Table
          </button>
          <button onClick={() => setShowZoneModal(true)} className="btn btn-primary btn-sm" title="Add a new zone">
            ➕ Zone
          </button>
        </div>
      </div>

      <EventTabs currentKey="seating" adminOnly={true} />

      {/* Visual Floor Plan */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Floor Plan</h3>
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-green-200 border border-green-500"></span>
              Occupied
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-white border border-[var(--color-border)]"></span>
              Empty
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-blue-200 border border-blue-500"></span>
              Drag target
            </span>
          </div>
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">Drag zones and tables to arrange them. Drag guests from below to tables.</p>
        <div
          ref={floorPlanRef}
          className="relative w-full h-[500px] bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-surface)] rounded-lg border-2 border-dashed border-[var(--color-border)] cursor-crosshair touch-none overflow-hidden shadow-inner"
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFloorPlanDrop}
        >
          {zones.length === 0 && tables.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-[var(--color-text-secondary)]">
              <div className="text-4xl mb-2">🪑</div>
              <p className="font-medium">Add zones and tables to create a floor plan</p>
              <p className="text-xs mt-1">Start by adding a zone, then add tables inside it</p>
            </div>
          ) : (
            <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
              {zones.map(zone => {
                const zx = zone.map_x || 10;
                const zy = zone.map_y || 10;
                const zWidth = Math.max(20, Math.min(40, (zone.capacity || 50) / 2));
                const zHeight = Math.max(20, Math.min(40, (zone.capacity || 50) / 2));
                return (
                  <g
                    key={zone.id}
                    onMouseDown={(e) => handleMouseDown(e, { ...zone, map_x: zx, map_y: zy }, 'zone')}
                    onTouchStart={(e) => handleTouchStart(e, { ...zone, map_x: zx, map_y: zy }, 'zone')}
                    style={{ cursor: 'move', touchAction: 'none' }}
                  >
                    <rect
                      x={zx}
                      y={zy}
                      width={zWidth}
                      height={zHeight}
                      fill={zone.color}
                      opacity={0.12}
                      stroke={zone.color}
                      strokeWidth="0.5"
                      rx="3"
                    />
                    <text x={zx + zWidth/2} y={zy + zHeight/2} textAnchor="middle" fontSize="2.8" fill="currentColor" opacity={0.5} fontWeight="bold">
                      {zone.name}
                    </text>
                  </g>
                );
              })}
              {tables.map(table => {
                const zone = zones.find(z => z.id === table.zone_id);
                const x = table.map_x || (zone?.map_x || 50);
                const y = table.map_y || (zone?.map_y || 50);
                const size = Math.max(6, Math.min(14, table.capacity * 1.2));
                const shape = table.shape || 'rectangular';
                const tableAssignments = assignments.filter(a => a.table_id === table.id);
                const isHovered = hoveredTable?.id === table.id;
                return (
                  <g
                    key={table.id}
                    onMouseDown={(e) => handleMouseDown(e, { ...table, map_x: x, map_y: y }, 'table')}
                    onTouchStart={(e) => handleTouchStart(e, { ...table, map_x: x, map_y: y }, 'table')}
                    onDragOver={(e) => handleTableDragOver(e, table)}
                    onDrop={(e) => handleTableDrop(e, table)}
                    style={{ cursor: 'move', touchAction: 'none' }}
                  >
                    <defs>
                      <filter id={`shadow-${table.id}`} x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0.5" stdDeviation="0.3" floodOpacity="0.2"/>
                      </filter>
                    </defs>
                    {shape === 'round' ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={size/2}
                        fill={isHovered ? '#dbeafe' : tableAssignments.length > 0 ? '#dcfce7' : '#fff'}
                        stroke={zone?.color || '#6366f1'}
                        strokeWidth={isHovered ? '1.2' : '0.7'}
                        transform={`rotate(${table.rotation || 0} ${x} ${y})`}
                        filter={`url(#shadow-${table.id})`}
                      />
                    ) : (
                      <rect
                        x={x - size/2}
                        y={y - size/2}
                        width={size}
                        height={size}
                        fill={isHovered ? '#dbeafe' : tableAssignments.length > 0 ? '#dcfce7' : '#fff'}
                        stroke={zone?.color || '#6366f1'}
                        strokeWidth={isHovered ? '1.2' : '0.7'}
                        rx={shape === 'square' ? 1 : 2}
                        transform={`rotate(${table.rotation || 0} ${x} ${y})`}
                        filter={`url(#shadow-${table.id})`}
                      />
                    )}
                    {tableAssignments.length > 0 ? (
                      <>
                        <text x={x} y={y + 0.8} textAnchor="middle" fontSize="2" fill="#166534" fontWeight="bold">
                          {tableAssignments.length}
                        </text>
                        {tableAssignments.map((assignment, idx) => {
                          const angle = (idx / tableAssignments.length) * 2 * Math.PI;
                          const guestRadius = size/2 + 2.2;
                          const gx = x + Math.cos(angle) * guestRadius;
                          const gy = y + Math.sin(angle) * guestRadius;
                          return (
                            <g key={assignment.id}>
                              <circle cx={gx} cy={gy} r="1.2" fill="#6366f1" opacity={0.85} />
                              <text x={gx} y={gy + 0.35} textAnchor="middle" fontSize="0.9" fill="white" fontWeight="bold">
                                {assignment.guest_name.split(' ')[0][0]}
                              </text>
                            </g>
                          );
                        })}
                      </>
                    ) : (
                      <text x={x} y={y + 0.8} textAnchor="middle" fontSize="1.8" fill="currentColor" fontWeight="bold">
                        {table.table_number}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Zones */}
      <div className="card p-4 space-y-2">
        <h3 className="font-semibold">Zones</h3>
        {zones.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🏗️</div>
            <p className="text-sm text-[var(--color-text-secondary)]">No zones created yet</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Create zones to organize your seating layout</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {zones.map(zone => {
              const zoneTables = tables.filter(t => t.zone_id === zone.id);
              const totalAssigned = assignments.filter(a => zoneTables.some(t => t.id === a.table_id)).length;
              return (
                <div key={zone.id} className="relative p-4 bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-surface)] rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all" style={{ borderLeftColor: zone.color }}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold">{zone.name}</p>
                      {zone.description && <p className="text-xs text-[var(--color-text-secondary)] mt-1">{zone.description}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-[var(--color-text-secondary)]">
                        {zone.capacity && <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)]">{zone.capacity} seats</span>}
                        <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)]">{zoneTables.length} tables</span>
                        <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)]">{totalAssigned} assigned</span>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteZone(zone.id)} className="btn btn-ghost btn-icon text-red-500 text-xs ml-2 hover:bg-red-50">
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tables */}
      <div className="card p-4 space-y-2">
        <h3 className="font-semibold">Tables</h3>
        {tables.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🪑</div>
            <p className="text-sm text-[var(--color-text-secondary)]">No tables created yet</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Add tables to zones to create seating</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {tables.map(table => {
              const zone = zones.find(z => z.id === table.zone_id);
              const assignedCount = assignments.filter(a => a.table_id === table.id).length;
              const isOverCapacity = assignedCount > table.capacity;
              const isFull = assignedCount >= table.capacity;
              const isHovered = hoveredTable?.id === table.id;
              return (
                <div
                  key={table.id}
                  className={`p-4 bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-surface)] rounded-lg border-2 transition-all shadow-sm hover:shadow-md ${isOverCapacity ? 'border-red-500' : isFull ? 'border-yellow-500' : isHovered ? 'border-[var(--color-primary)] border-dashed animate-pulse' : 'border-transparent'}`}
                  onDragOver={(e) => handleTableDragOver(e, table)}
                  onDrop={(e) => handleTableDrop(e, table)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold">Table {table.table_number}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-[var(--color-text-secondary)]">
                        <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)] capitalize">{table.shape}</span>
                        {zone && <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: zone.color + '20', color: zone.color }}>{zone.name}</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="text-sm">
                          <span className={isOverCapacity ? 'text-red-500 font-bold' : isFull ? 'text-yellow-500 font-bold' : 'font-medium'}>
                            {assignedCount}
                          </span>
                          <span className="text-[var(--color-text-secondary)]">/{table.capacity}</span>
                        </div>
                        <div className="flex-1 h-2 bg-[var(--color-surface)] rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${isOverCapacity ? 'bg-red-500' : isFull ? 'bg-yellow-500' : 'bg-green-500'}`}
                            style={{ width: `${Math.min(100, (assignedCount / table.capacity) * 100)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 ml-2">
                      <button onClick={() => { setSelectedTable(table); setShowSeatLayout(true); }} className="btn btn-secondary btn-xs" title="View seats">
                        🪑
                      </button>
                      <button onClick={() => handleDeleteTable(table.id)} className="btn btn-ghost btn-icon text-red-500 text-xs hover:bg-red-50" title="Delete table">
                        🗑️
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Unassigned Guests - Drag to Assign */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Unassigned Guests</h3>
          <span className="text-xs text-[var(--color-text-secondary)]">
            {guests.filter(g => !assignments.find(a => a.guest_id === g.id)).length} remaining
          </span>
        </div>
        <div className="mb-3">
          <input
            type="text"
            placeholder="Search guests..."
            value={guestSearch}
            onChange={e => setGuestSearch(e.target.value)}
            className="input-field text-sm"
          />
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mb-3">Drag guests to tables above to assign them</p>
        {guests.filter(g => !assignments.find(a => a.guest_id === g.id)).length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">🎉</div>
            <p className="text-sm font-medium text-[var(--color-text-secondary)]">All guests assigned!</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto">
            {guests
              .filter(g => !assignments.find(a => a.guest_id === g.id))
              .filter(g => guestSearch === '' || g.name.toLowerCase().includes(guestSearch.toLowerCase()))
              .map(guest => (
              <div
                key={guest.id}
                draggable
                onDragStart={() => handleGuestDragStart(guest)}
                onDragEnd={handleGuestDragEnd}
                className="px-4 py-2 bg-white rounded-lg border border-[var(--color-border)] cursor-move hover:border-[var(--color-primary)] hover:shadow-md hover:scale-105 transition-all flex items-center gap-2 select-none"
              >
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] text-white flex items-center justify-center font-bold text-sm shadow-sm">
                  {guest.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <span className="font-medium text-sm">{guest.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assignments */}
      <div className="card p-4 space-y-2">
        <h3 className="font-semibold">Who Sits Where</h3>
        {assignments.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-4xl mb-2">👥</div>
            <p className="text-sm text-[var(--color-text-secondary)]">No assignments yet</p>
            <p className="text-xs text-[var(--color-text-secondary)] mt-1">Drag guests to tables to start assigning</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {assignments.map(assignment => {
              const table = tables.find(t => t.id === assignment.table_id);
              const zone = zones.find(z => z.id === assignment.zone_id);
              return (
                <div key={assignment.id} className="p-4 bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-surface)] rounded-lg border-l-4 shadow-sm hover:shadow-md transition-all" style={{ borderLeftColor: zone?.color || '#6366f1' }}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--color-primary)] to-[var(--color-primary-dark)] text-white flex items-center justify-center font-bold text-xs">
                          {assignment.guest_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <p className="font-semibold">{assignment.guest_name}</p>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--color-text-secondary)]">
                        {table && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)]">
                            Table {table.table_number}
                          </span>
                        )}
                        {assignment.seat_number && (
                          <span className="px-2 py-0.5 rounded-full bg-[var(--color-surface)]">
                            Seat {assignment.seat_number}
                          </span>
                        )}
                        {zone && (
                          <span className="px-2 py-0.5 rounded-full" style={{ backgroundColor: zone.color + '20', color: zone.color }}>
                            {zone.name}
                          </span>
                        )}
                      </div>
                      {assignment.assigned_by_name && (
                        <p className="text-[10px] text-[var(--color-text-secondary)] mt-1">by {assignment.assigned_by_name}</p>
                      )}
                    </div>
                    <button onClick={() => handleDeleteAssignment(assignment.id)} className="btn btn-ghost btn-icon text-red-500 text-xs ml-2 hover:bg-red-50" title="Remove assignment">
                      👋
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Guest View - Your Seat */}
      <div className="card p-4">
        <h3 className="font-semibold mb-3">Find Your Seat</h3>
        <div className="relative w-full h-[300px] bg-[var(--color-surface-hover)] rounded-lg border-2 border-dashed border-[var(--color-border)] overflow-hidden">
          {zones.length === 0 && tables.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-[var(--color-text-secondary)]">
              No seating layout available
            </div>
          ) : (
            <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid slice">
              {zones.map(zone => {
                const zx = zone.map_x || 10;
                const zy = zone.map_y || 10;
                const zWidth = Math.max(20, Math.min(40, (zone.capacity || 50) / 2));
                const zHeight = Math.max(20, Math.min(40, (zone.capacity || 50) / 2));
                return (
                  <g key={zone.id}>
                    <rect
                      x={zx}
                      y={zy}
                      width={zWidth}
                      height={zHeight}
                      fill={zone.color}
                      opacity={0.15}
                      stroke={zone.color}
                      strokeWidth="0.5"
                      rx="3"
                    />
                    <text x={zx + zWidth/2} y={zy + zHeight/2} textAnchor="middle" fontSize="3" fill="currentColor" opacity={0.5}>
                      {zone.name}
                    </text>
                  </g>
                );
              })}
              {tables.map(table => {
                const zone = zones.find(z => z.id === table.zone_id);
                const x = table.map_x || (zone?.map_x || 50);
                const y = table.map_y || (zone?.map_y || 50);
                const size = Math.max(5, Math.min(12, table.capacity));
                const shape = table.shape || 'rectangular';
                const tableAssignments = assignments.filter(a => a.table_id === table.id);
                return (
                  <g key={table.id}>
                    {shape === 'round' ? (
                      <circle
                        cx={x}
                        cy={y}
                        r={size/2}
                        fill={tableAssignments.length > 0 ? '#dcfce7' : '#fff'}
                        stroke={zone?.color || '#6366f1'}
                        strokeWidth="0.5"
                        opacity={0.8}
                      />
                    ) : (
                      <rect
                        x={x - size/2}
                        y={y - size/2}
                        width={size}
                        height={size}
                        fill={tableAssignments.length > 0 ? '#dcfce7' : '#fff'}
                        stroke={zone?.color || '#6366f1'}
                        strokeWidth="0.5"
                        rx={shape === 'square' ? 1 : 2}
                        opacity={0.8}
                      />
                    )}
                    {tableAssignments.length > 0 && (
                      <text x={x} y={y + 1} textAnchor="middle" fontSize="1.5" fill="#166534" fontWeight="bold">
                        {tableAssignments.length}
                      </text>
                    )}
                  </g>
                );
              })}
              {assignments.map(assignment => {
                const table = tables.find(t => t.id === assignment.table_id);
                if (!table) return null;
                const x = table.map_x || 50;
                const y = table.map_y || 50;
                const size = Math.max(5, Math.min(12, table.capacity));
                const offsetX = (Math.random() - 0.5) * size * 0.6;
                const offsetY = (Math.random() - 0.5) * size * 0.6;
                return (
                  <g key={assignment.id}>
                    <circle
                      cx={x + offsetX}
                      cy={y + offsetY}
                      r="1.5"
                      fill="#6366f1"
                      opacity={0.9}
                    />
                    <text x={x + offsetX} y={y + offsetY + 0.5} textAnchor="middle" fontSize="1.2" fill="currentColor" fontWeight="bold">
                      {assignment.guest_name.split(' ')[0][0]}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">Green tables have guests assigned. Small dots show guest positions.</p>
      </div>

      {/* Seat Layout Modal */}
      {showSeatLayout && selectedTable && (
        <Modal onClose={() => { setShowSeatLayout(false); setDraggingGuest(null); }} title={`Table ${selectedTable.table_number} Seats`}>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-[var(--color-surface-hover)] rounded-lg">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Capacity</p>
                  <p className="font-semibold">{selectedTable.capacity} seats</p>
                </div>
                <div className="w-px h-8 bg-[var(--color-border)]"></div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Occupied</p>
                  <p className="font-semibold">{assignments.filter(a => a.table_id === selectedTable.id).length}</p>
                </div>
                <div className="w-px h-8 bg-[var(--color-border)]"></div>
                <div>
                  <p className="text-xs text-[var(--color-text-secondary)]">Available</p>
                  <p className="font-semibold text-green-600">{selectedTable.capacity - assignments.filter(a => a.table_id === selectedTable.id).length}</p>
                </div>
              </div>
            </div>

            {draggingGuest && (
              <div className="p-4 bg-gradient-to-r from-blue-50 to-blue-100 border border-blue-200 rounded-lg animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold">
                    {draggingGuest.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-blue-700">Assigning: {draggingGuest.name}</p>
                    <p className="text-xs text-blue-600">Click a seat to place them</p>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-4 gap-3">
              {Array.from({ length: selectedTable.capacity }, (_, i) => {
                const seatNum = (i + 1).toString();
                const assignment = assignments.find(a => a.table_id === selectedTable.id && a.seat_number === seatNum);
                return (
                  <div
                    key={i}
                    onClick={async () => {
                      if (assignment) {
                        if (confirm(`Remove ${assignment.guest_name} from seat ${seatNum}?`)) {
                          await handleDeleteAssignment(assignment.id);
                          if (draggingGuest) {
                            await handleSaveAssignment(null, {
                              event_id: Number(eventId),
                              guest_id: draggingGuest.id,
                              table_id: selectedTable.id,
                              seat_number: seatNum,
                              zone_id: selectedTable.zone_id ? Number(selectedTable.zone_id) : null
                            });
                            setDraggingGuest(null);
                            setShowSeatLayout(false);
                          }
                        }
                      } else if (draggingGuest) {
                        await handleSaveAssignment(null, {
                          event_id: Number(eventId),
                          guest_id: draggingGuest.id,
                          table_id: selectedTable.id,
                          seat_number: seatNum,
                          zone_id: selectedTable.zone_id ? Number(selectedTable.zone_id) : null
                        });
                        setDraggingGuest(null);
                        setShowSeatLayout(false);
                      } else {
                        setAssignmentForm({
                          guest_id: '',
                          table_id: selectedTable.id,
                          seat_number: seatNum,
                          zone_id: selectedTable.zone_id ? Number(selectedTable.zone_id) : null
                        });
                        setShowAssignmentModal(true);
                      }
                    }}
                    className={`p-4 rounded-xl border-2 text-center cursor-pointer transition-all transform hover:scale-105 ${
                      assignment
                        ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-500 text-green-700 hover:from-green-100 hover:to-green-200 shadow-sm'
                        : draggingGuest
                        ? 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-500 text-blue-700 hover:from-blue-100 hover:to-blue-200 shadow-sm'
                        : 'bg-gradient-to-br from-[var(--color-surface-hover)] to-[var(--color-surface)] border-[var(--color-border)] hover:border-[var(--color-primary)] hover:shadow-md'
                    }`}
                  >
                    <div className="font-bold text-2xl mb-1">{seatNum}</div>
                    {assignment ? (
                      <div className="text-xs font-medium truncate">{assignment.guest_name}</div>
                    ) : draggingGuest ? (
                      <div className="text-xs font-medium truncate">{draggingGuest.name}</div>
                    ) : (
                      <div className="text-xs text-[var(--color-text-secondary)]">Tap to assign</div>
                    )}
                    {assignment?.assigned_by_name && (
                      <div className="text-[10px] text-[var(--color-text-secondary)] mt-1">by {assignment.assigned_by_name}</div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => { setShowSeatLayout(false); setDraggingGuest(null); }} className="btn btn-secondary flex-1">Close</button>
            </div>
          </div>
        </Modal>
      )}

      {/* Assignment Modal */}
      {showAssignmentModal && (
        <Modal onClose={() => setShowAssignmentModal(false)} title="Assign Seat">
          <form onSubmit={handleSaveAssignment} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Guest</label>
              <select
                value={assignmentForm.guest_id}
                onChange={e => setAssignmentForm({...assignmentForm, guest_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
                required
              >
                <option value="">Select guest</option>
                {guests.map(guest => {
                  const existingAssignment = assignments.find(a => a.guest_id === guest.id);
                  return (
                    <option key={guest.id} value={guest.id}>
                      {guest.name}{existingAssignment ? ` (currently: ${existingAssignment.table_number ? 'Table ' + existingAssignment.table_number : existingAssignment.zone_name || 'Assigned'})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Table (optional)</label>
              <select
                value={assignmentForm.table_id}
                onChange={e => setAssignmentForm({...assignmentForm, table_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
              >
                <option value="">No table</option>
                {tables.map(table => {
                  const assignedCount = assignments.filter(a => a.table_id === table.id).length;
                  const isFull = assignedCount >= table.capacity;
                  return (
                    <option key={table.id} value={table.id} disabled={isFull}>
                      Table {table.table_number} ({assignedCount}/{table.capacity}){isFull ? ' - Full' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zone (optional)</label>
              <select
                value={assignmentForm.zone_id}
                onChange={e => setAssignmentForm({...assignmentForm, zone_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
              >
                <option value="">No zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Seat Number (optional)</label>
              <input
                type="text"
                value={assignmentForm.seat_number}
                onChange={e => setAssignmentForm({...assignmentForm, seat_number: e.target.value})}
                className="input-field"
                placeholder="e.g., 1"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Assign</button>
              <button type="button" onClick={() => setShowAssignmentModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Zone Modal */}
      {showZoneModal && (
        <Modal onClose={() => setShowZoneModal(false)} title="Add Zone">
          <form onSubmit={handleSaveZone} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input
                type="text"
                value={zoneForm.name}
                onChange={e => setZoneForm({...zoneForm, name: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., Main Hall"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description (optional)</label>
              <input
                type="text"
                value={zoneForm.description}
                onChange={e => setZoneForm({...zoneForm, description: e.target.value})}
                className="input-field"
                placeholder="Zone description"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Capacity (optional)</label>
              <input
                type="number"
                value={zoneForm.capacity}
                onChange={e => setZoneForm({...zoneForm, capacity: e.target.value})}
                className="input-field"
                placeholder="Number of seats"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Color</label>
              <input
                type="color"
                value={zoneForm.color}
                onChange={e => setZoneForm({...zoneForm, color: e.target.value})}
                className="w-full h-10 rounded cursor-pointer"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Add Zone</button>
              <button type="button" onClick={() => setShowZoneModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Add Table Modal */}
      {showTableModal && (
        <Modal onClose={() => setShowTableModal(false)} title="Add Table">
          <form onSubmit={handleSaveTable} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Zone</label>
              <select
                value={tableForm.zone_id}
                onChange={e => setTableForm({...tableForm, zone_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
              >
                <option value="">No zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Table Number</label>
              <input
                type="text"
                value={tableForm.table_number}
                onChange={e => setTableForm({...tableForm, table_number: e.target.value})}
                className="input-field"
                required
                placeholder="e.g., A1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Capacity</label>
              <input
                type="number"
                value={tableForm.capacity}
                onChange={e => setTableForm({...tableForm, capacity: Number(e.target.value)})}
                className="input-field"
                min="1"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Shape</label>
              <select
                value={tableForm.shape}
                onChange={e => setTableForm({...tableForm, shape: e.target.value})}
                className="input-field"
              >
                <option value="rectangular">Rectangular</option>
                <option value="round">Round</option>
                <option value="square">Square</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Add Table</button>
              <button type="button" onClick={() => setShowTableModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Assignment Modal */}
      {showAssignmentModal && (
        <Modal onClose={() => setShowAssignmentModal(false)} title="Assign Seat">
          <form onSubmit={handleSaveAssignment} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Guest</label>
              <select
                value={assignmentForm.guest_id}
                onChange={e => setAssignmentForm({...assignmentForm, guest_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
                required
              >
                <option value="">Select guest</option>
                {guests.map(guest => {
                  const existingAssignment = assignments.find(a => a.guest_id === guest.id);
                  return (
                    <option key={guest.id} value={guest.id}>
                      {guest.name}{existingAssignment ? ` (currently: ${existingAssignment.table_number ? 'Table ' + existingAssignment.table_number : existingAssignment.zone_name || 'Assigned'})` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Table (optional)</label>
              <select
                value={assignmentForm.table_id}
                onChange={e => setAssignmentForm({...assignmentForm, table_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
              >
                <option value="">No table</option>
                {tables.map(table => {
                  const assignedCount = assignments.filter(a => a.table_id === table.id).length;
                  const isFull = assignedCount >= table.capacity;
                  return (
                    <option key={table.id} value={table.id} disabled={isFull}>
                      Table {table.table_number} ({assignedCount}/{table.capacity}){isFull ? ' - Full' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Zone (optional)</label>
              <select
                value={assignmentForm.zone_id}
                onChange={e => setAssignmentForm({...assignmentForm, zone_id: e.target.value ? Number(e.target.value) : ''})}
                className="input-field"
              >
                <option value="">No zone</option>
                {zones.map(zone => (
                  <option key={zone.id} value={zone.id}>{zone.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Seat Number (optional)</label>
              <input
                type="text"
                value={assignmentForm.seat_number}
                onChange={e => setAssignmentForm({...assignmentForm, seat_number: e.target.value})}
                className="input-field"
                placeholder="e.g., 1"
              />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Assign</button>
              <button type="button" onClick={() => setShowAssignmentModal(false)} className="btn btn-secondary">Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
