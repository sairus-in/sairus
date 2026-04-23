import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRouteSummary, AdminStopCatalogItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { ConfirmWithImpactModal } from '../../components/shared/ConfirmWithImpactModal';
import { ArrowLeft, GripVertical, Plus, Save, Trash2 } from 'lucide-react';

const DAY_OPTIONS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

const minutesToTime = (mins: number) => {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
};

const timeToMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

interface EditableStop {
  stopId: string;
  stopName: string;
  sequence: number;
  morningTime: number;
  returnTime: number;
}

interface RouteFormState {
  name: string;
  area: string;
  activeDays: string[];
  isActive: boolean;
}

interface StopFormState {
  name: string;
  area: string;
  lat: string;
  lon: string;
}

const defaultRouteForm: RouteFormState = {
  name: '',
  area: '',
  activeDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
  isActive: true,
};

const defaultStopForm: StopFormState = {
  name: '',
  area: '',
  lat: '',
  lon: '',
};

export const RouteEditor: React.FC = () => {
  const queryClient = useQueryClient();
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
  const [editStops, setEditStops] = useState<EditableStop[]>([]);
  const [showConfirm, setShowConfirm] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [createRouteForm, setCreateRouteForm] = useState<RouteFormState>(defaultRouteForm);
  const [routeForm, setRouteForm] = useState<RouteFormState>(defaultRouteForm);
  const [stopForm, setStopForm] = useState<StopFormState>(defaultStopForm);

  const { data: routes, isLoading: loadingRoutes } = useQuery<AdminRouteSummary[]>({
    queryKey: ['admin-routes'],
    queryFn: () => api.get<AdminRouteSummary[]>('/v1/routes'),
  });

  const { data: routeDetail } = useQuery<AdminRouteSummary>({
    queryKey: ['admin-route', selectedRouteId],
    queryFn: () => api.get<AdminRouteSummary>(`/v1/routes/${selectedRouteId}`),
    enabled: !!selectedRouteId,
  });

  const { data: stopCatalog = [] } = useQuery<AdminStopCatalogItem[]>({
    queryKey: ['route-stop-catalog'],
    queryFn: () => api.get<AdminStopCatalogItem[]>('/v1/routes/stops'),
  });

  useEffect(() => {
    if (routeDetail?.stops) {
      setEditStops(
        routeDetail.stops
          .sort((a, b) => a.sequence - b.sequence)
          .map((stop) => ({
            stopId: stop.stopId,
            stopName: stop.stop.name,
            sequence: stop.sequence,
            morningTime: stop.scheduledTimeMorning,
            returnTime: stop.scheduledTimeReturn,
          })),
      );
      setRouteForm({
        name: routeDetail.name,
        area: routeDetail.area,
        activeDays: routeDetail.activeDays || ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
        isActive: routeDetail.isActive,
      });
    }
  }, [routeDetail]);

  const saveMutation = useMutation({
    mutationFn: (payload: { stopId: string; sequence: number; morningTime: number; returnTime: number }[]) =>
      api.put(`/v1/routes/${selectedRouteId}/stops`, payload, {
        headers: routeDetail?.updatedAt ? { 'If-Unmodified-Since': routeDetail.updatedAt } : undefined,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-route', selectedRouteId] });
      setShowConfirm(false);
      setSaveError(null);
    },
    onError: (error) => {
      const apiError = extractApiError(error);
      setSaveError(
        apiError.status === 409
          ? 'This route changed since you opened it. Refresh the route and retry your update.'
          : apiError.message,
      );
      setShowConfirm(false);
    },
  });

  const createRouteMutation = useMutation({
    mutationFn: (payload: RouteFormState) => api.post<AdminRouteSummary>('/v1/routes', {
      name: payload.name.trim(),
      area: payload.area.trim(),
      activeDays: payload.activeDays,
    }),
    onSuccess: async (route) => {
      await queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
      setCreateRouteForm(defaultRouteForm);
      setSelectedRouteId(route.id);
      setMetaError(null);
    },
    onError: (error) => {
      setMetaError(extractApiError(error).message);
    },
  });

  const updateRouteMutation = useMutation({
    mutationFn: () => api.patch(`/v1/routes/${selectedRouteId}`, {
      name: routeForm.name.trim(),
      area: routeForm.area.trim(),
      activeDays: routeForm.activeDays,
      isActive: routeForm.isActive,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-routes'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-route', selectedRouteId] });
      setMetaError(null);
    },
    onError: (error) => {
      setMetaError(extractApiError(error).message);
    },
  });

  const createStopMutation = useMutation({
    mutationFn: () => api.post<AdminStopCatalogItem>('/v1/routes/stops', {
      name: stopForm.name.trim(),
      area: stopForm.area.trim() || undefined,
      lat: Number(stopForm.lat),
      lon: Number(stopForm.lon),
    }),
    onSuccess: async (stop) => {
      await queryClient.invalidateQueries({ queryKey: ['route-stop-catalog'] });
      setCatalogError(null);
      setStopForm(defaultStopForm);
      if (selectedRouteId) {
        appendStop(stop);
      }
    },
    onError: (error) => {
      setCatalogError(extractApiError(error).message);
    },
  });

  const availableStops = useMemo(
    () => stopCatalog.filter((stop) => !editStops.some((entry) => entry.stopId === stop.id)),
    [editStops, stopCatalog],
  );

  const appendStop = (stop: AdminStopCatalogItem) => {
    setEditStops((current) => [
      ...current,
      {
        stopId: stop.id,
        stopName: stop.name,
        sequence: current.length + 1,
        morningTime: current[current.length - 1]?.morningTime ?? 420,
        returnTime: current[current.length - 1]?.returnTime ?? 1020,
      },
    ]);
  };

  const moveStop = (fromIdx: number, toIdx: number) => {
    const updated = [...editStops];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setEditStops(updated.map((stop, index) => ({ ...stop, sequence: index + 1 })));
  };

  const removeStop = (idx: number) => {
    setEditStops((current) => current.filter((_, index) => index !== idx).map((stop, index) => ({ ...stop, sequence: index + 1 })));
  };

  const updateStopTime = (idx: number, field: 'morningTime' | 'returnTime', value: string) => {
    setEditStops((current) => current.map((stop, index) => index === idx ? { ...stop, [field]: timeToMinutes(value) } : stop));
  };

  const toggleDays = (value: string, target: 'create' | 'edit') => {
    const apply = (days: string[]) => (
      days.includes(value)
        ? days.filter((day) => day !== value)
        : [...days, value]
    );

    if (target === 'create') {
      setCreateRouteForm((current) => ({ ...current, activeDays: apply(current.activeDays) }));
    } else {
      setRouteForm((current) => ({ ...current, activeDays: apply(current.activeDays) }));
    }
  };

  const confirmSave = () => {
    saveMutation.mutate(
      editStops.map((stop) => ({
        stopId: stop.stopId,
        sequence: stop.sequence,
        morningTime: stop.morningTime,
        returnTime: stop.returnTime,
      })),
    );
  };

  if (!selectedRouteId) {
    return (
      <div style={{ height: '100%', display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) 360px', gap: '1rem' }}>
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB' }}>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Route Management</h1>
            <p style={{ margin: '0.5rem 0 0', color: '#6B7280', fontSize: '0.875rem' }}>Create routes, manage metadata, and edit stop sequences.</p>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '1rem' }}>
            {loadingRoutes ? (
              <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '2rem' }}>Loading routes...</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {(routes || []).map((route) => (
                  <button
                    key={route.id}
                    onClick={() => setSelectedRouteId(route.id)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '1rem 1.25rem', background: 'white', border: '1px solid #E5E7EB',
                      borderRadius: '8px', cursor: 'pointer', textAlign: 'left', width: '100%',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{route.name}</div>
                      <div style={{ color: '#6B7280', fontSize: '0.85rem', marginTop: '0.25rem' }}>{route.area} | {route.stops?.length || 0} stops</div>
                      <div style={{ color: '#94A3B8', fontSize: '0.78rem', marginTop: '0.2rem' }}>{(route.activeDays || []).join(', ')}</div>
                    </div>
                    <span style={{ color: route.isActive ? '#059669' : '#DC2626', fontSize: '0.8rem', fontWeight: 600 }}>
                      {route.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Create Route</h2>
            <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>Define route metadata before editing stops.</div>
          </div>
          <div style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.85rem' }}>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Route Name</span>
              <input value={createRouteForm.name} onChange={(event) => setCreateRouteForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
            </label>
            <label style={{ display: 'grid', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Area</span>
              <input value={createRouteForm.area} onChange={(event) => setCreateRouteForm((current) => ({ ...current, area: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
            </label>
            <div style={{ display: 'grid', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Active Days</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {DAY_OPTIONS.map((day) => (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDays(day, 'create')}
                    style={{
                      border: '1px solid #CBD5E1',
                      borderRadius: '9999px',
                      padding: '0.4rem 0.7rem',
                      background: createRouteForm.activeDays.includes(day) ? '#DBEAFE' : 'white',
                      color: createRouteForm.activeDays.includes(day) ? '#1D4ED8' : '#475569',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.78rem',
                    }}
                  >
                    {day}
                  </button>
                ))}
              </div>
            </div>
            {metaError && (
              <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.85rem' }}>
                {metaError}
              </div>
            )}
            <button
              type="button"
              onClick={() => createRouteMutation.mutate(createRouteForm)}
              disabled={createRouteMutation.isPending || !createRouteForm.name.trim() || !createRouteForm.area.trim() || createRouteForm.activeDays.length === 0}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', border: 'none', borderRadius: '8px', background: '#2563EB', color: 'white', padding: '0.8rem 1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Plus size={16} /> Create Route
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ padding: '1rem 1.5rem', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button onClick={() => setSelectedRouteId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#6B7280' }}>
          <ArrowLeft size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold' }}>{routeDetail?.name || 'Loading...'}</h2>
          <span style={{ color: '#6B7280', fontSize: '0.8rem' }}>{routeDetail?.area}</span>
        </div>
        <button
          onClick={() => updateRouteMutation.mutate()}
          disabled={updateRouteMutation.isPending || routeForm.activeDays.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem', background: '#111827', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Save size={16} /> Save Metadata
        </button>
        <button
          onClick={() => setShowConfirm(true)}
          disabled={editStops.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 1rem', background: '#2563EB', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: 'pointer' }}
        >
          <Save size={16} /> Save Sequence
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 380px', gap: '1rem', flex: 1, minHeight: 0 }}>
        <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'grid', gap: '0.8rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Route Name</span>
                <input value={routeForm.name} onChange={(event) => setRouteForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Area</span>
                <input value={routeForm.area} onChange={(event) => setRouteForm((current) => ({ ...current, area: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
              </label>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
              {DAY_OPTIONS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDays(day, 'edit')}
                  style={{
                    border: '1px solid #CBD5E1',
                    borderRadius: '9999px',
                    padding: '0.4rem 0.7rem',
                    background: routeForm.activeDays.includes(day) ? '#DBEAFE' : 'white',
                    color: routeForm.activeDays.includes(day) ? '#1D4ED8' : '#475569',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.78rem',
                  }}
                >
                  {day}
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#475569', fontSize: '0.84rem' }}>
              <input type="checkbox" checked={routeForm.isActive} onChange={(event) => setRouteForm((current) => ({ ...current, isActive: event.target.checked }))} />
              Route is active
            </label>
            {metaError && (
              <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.85rem' }}>
                {metaError}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: '1rem 1.5rem' }}>
            {saveError && (
              <div style={{ marginBottom: '1rem', padding: '0.85rem 1rem', borderRadius: '8px', border: '1px solid #FCA5A5', background: '#FEF2F2', color: '#B91C1C' }}>
                {saveError}
              </div>
            )}
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {editStops.map((stop, idx) => (
                <div
                  key={stop.stopId}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => { if (dragIdx !== null && dragIdx !== idx) moveStop(dragIdx, idx); setDragIdx(null); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', background: dragIdx === idx ? '#EFF6FF' : 'white', border: '1px solid #E5E7EB', borderRadius: '8px', cursor: 'grab' }}
                >
                  <GripVertical size={18} color="#9CA3AF" style={{ flexShrink: 0 }} />
                  <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: '#EFF6FF', color: '#2563EB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>
                    {stop.sequence}
                  </span>
                  <div style={{ flex: 1, fontWeight: 500 }}>{stop.stopName}</div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.85rem' }}>
                    <label style={{ color: '#6B7280' }}>AM</label>
                    <input type="time" value={minutesToTime(stop.morningTime)} onChange={(event) => updateStopTime(idx, 'morningTime', event.target.value)} style={{ padding: '0.25rem 0.5rem', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '0.85rem' }} />
                    <label style={{ color: '#6B7280' }}>PM</label>
                    <input type="time" value={minutesToTime(stop.returnTime)} onChange={(event) => updateStopTime(idx, 'returnTime', event.target.value)} style={{ padding: '0.25rem 0.5rem', border: '1px solid #D1D5DB', borderRadius: '4px', fontSize: '0.85rem' }} />
                  </div>
                  <button onClick={() => removeStop(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#EF4444' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            {editStops.length === 0 && (
              <p style={{ textAlign: 'center', color: '#9CA3AF', padding: '3rem 0' }}>No stops configured for this route yet. Add stops from the catalog.</p>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}>
          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Stop Catalog</h3>
              <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>Attach existing stops to this route.</div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: '1rem', display: 'grid', gap: '0.5rem' }}>
              {availableStops.map((stop) => (
                <button
                  key={stop.id}
                  type="button"
                  onClick={() => appendStop(stop)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #E5E7EB', borderRadius: '8px', background: 'white', padding: '0.75rem 0.9rem', cursor: 'pointer', textAlign: 'left' }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{stop.name}</div>
                    <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>{stop.area || 'No area'} | {stop.lat}, {stop.lon}</div>
                  </div>
                  <Plus size={16} color="#2563EB" />
                </button>
              ))}
              {availableStops.length === 0 && (
                <div style={{ color: '#9CA3AF', fontSize: '0.86rem' }}>All known stops are already attached to this route.</div>
              )}
            </div>
          </div>

          <div style={{ background: 'white', border: '1px solid #E5E7EB', borderRadius: '8px', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Create Stop</h3>
              <div style={{ color: '#6B7280', fontSize: '0.82rem', marginTop: '0.25rem' }}>Add a new stop to the shared catalog and this route.</div>
            </div>
            <div style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.75rem' }}>
              <input placeholder="Stop name" value={stopForm.name} onChange={(event) => setStopForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
              <input placeholder="Area" value={stopForm.area} onChange={(event) => setStopForm((current) => ({ ...current, area: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <input placeholder="Latitude" value={stopForm.lat} onChange={(event) => setStopForm((current) => ({ ...current, lat: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                <input placeholder="Longitude" value={stopForm.lon} onChange={(event) => setStopForm((current) => ({ ...current, lon: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
              </div>
              {catalogError && (
                <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.85rem' }}>
                  {catalogError}
                </div>
              )}
              <button
                type="button"
                onClick={() => createStopMutation.mutate()}
                disabled={createStopMutation.isPending || !stopForm.name.trim() || !stopForm.lat.trim() || !stopForm.lon.trim()}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', border: 'none', borderRadius: '8px', background: '#111827', color: 'white', padding: '0.8rem 1rem', fontWeight: 700, cursor: 'pointer' }}
              >
                <Plus size={16} /> Create Stop
              </button>
            </div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <ConfirmWithImpactModal
          title="Update Route Stops"
          description={`You are about to update the stop sequence for "${routeDetail?.name}". This will replace all current stop configurations.`}
          impacts={[
            `${editStops.length} stops will be saved in the new sequence`,
            'Previous sequence configuration will be archived in the change log',
            'Modification is blocked if any trip is currently active on this route',
          ]}
          confirmLabel="Apply Changes"
          isLoading={saveMutation.isPending}
          onConfirm={confirmSave}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
};

export default RouteEditor;
