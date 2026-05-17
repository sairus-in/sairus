import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminRouteSummary, AdminStopCatalogItem } from 'shared';
import { ConfirmWithImpactModal } from '../../components/shared/ConfirmWithImpactModal';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

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

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
};

const dayPillStyle = (active: boolean): React.CSSProperties => ({
  borderRadius: 999,
  border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`,
  background: active ? 'var(--ink)' : 'var(--surface)',
  color: active ? 'var(--accent-ink)' : 'var(--muted)',
  padding: '7px 11px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
});

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

  const routesList = routes ?? [];
  const activeRoutes = routesList.filter((route) => route.isActive).length;
  const totalStops = routesList.reduce((sum, route) => sum + (route.stops?.length ?? 0), 0);

  if (!selectedRouteId) {
    return (
      <div style={{ display: 'grid', gap: 16, minHeight: '100%' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 16,
            alignItems: 'flex-start',
            padding: 20,
            border: '1px solid var(--border)',
            borderRadius: 20,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(245,245,242,0.9))',
          }}
        >
          <div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Data Console
            </div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
              Routes
            </h1>
            <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 720 }}>
              Route metadata and stop sequences are still wired to the same route contract, including optimistic concurrency on stop updates.
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <KPIBlock label="Routes" value={routesList.length} sub="All route templates" spark={[1, 2, 3, 3, Math.max(routesList.length, 1)]} />
          <KPIBlock label="Active" value={activeRoutes} sub="Currently enabled routes" accent="var(--ok)" spark={[1, 1, 2, 2, Math.max(activeRoutes, 1)]} />
          <KPIBlock label="Stops" value={totalStops} sub="Total attached stop points" accent="var(--info)" spark={[4, 8, 10, 12, Math.max(totalStops, 1)]} />
          <KPIBlock label="Catalog" value={stopCatalog.length} sub="Reusable stop definitions" accent="var(--warn)" spark={[2, 4, 6, 7, Math.max(stopCatalog.length, 1)]} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) 360px', gap: 16 }}>
          <SectionCard title="Route Templates" subtitle={loadingRoutes ? 'Loading routes' : `${routesList.length} templates available`}>
            <div className="scroll" style={{ display: 'grid', gap: 10, maxHeight: 'calc(100vh - 410px)', paddingRight: 4 }}>
              {loadingRoutes ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading routes…</div>
              ) : (
                routesList.map((route) => (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => setSelectedRouteId(route.id)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                      padding: 14,
                      borderRadius: 16,
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                      textAlign: 'left',
                    }}
                  >
                    <div>
                      <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{route.id.slice(0, 8)}</div>
                      <div style={{ fontWeight: 500 }}>{route.name}</div>
                      <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>
                        {route.area} · {route.stops?.length || 0} stops · {(route.activeDays || []).join(', ')}
                      </div>
                    </div>
                    <StateBadge state={route.isActive ? 'LIVE' : 'OFFLINE'} label={route.isActive ? 'Active' : 'Inactive'} />
                  </button>
                ))
              )}
            </div>
          </SectionCard>

          <SectionCard title="Create Route" subtitle="Define metadata first, then edit the stop sequence">
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Route Name</span>
                <input value={createRouteForm.name} onChange={(event) => setCreateRouteForm((current) => ({ ...current, name: event.target.value }))} style={fieldStyle} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Area</span>
                <input value={createRouteForm.area} onChange={(event) => setCreateRouteForm((current) => ({ ...current, area: event.target.value }))} style={fieldStyle} />
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DAY_OPTIONS.map((day) => (
                  <button key={day} type="button" onClick={() => toggleDays(day, 'create')} style={dayPillStyle(createRouteForm.activeDays.includes(day))}>
                    {day}
                  </button>
                ))}
              </div>
              {metaError ? (
                <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                  {metaError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => createRouteMutation.mutate(createRouteForm)}
                disabled={createRouteMutation.isPending || !createRouteForm.name.trim() || !createRouteForm.area.trim() || createRouteForm.activeDays.length === 0}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '11px 16px', fontWeight: 500 }}
              >
                <Icon name="plus" size={12} />
                Create Route
              </button>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 16, minHeight: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
          alignItems: 'flex-start',
          padding: 20,
          border: '1px solid var(--border)',
          borderRadius: 20,
          background: 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(245,245,242,0.9))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <button
            type="button"
            onClick={() => setSelectedRouteId(null)}
            style={{ width: 36, height: 36, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <Icon name="chevL" size={14} />
          </button>
          <div>
            <div className="mono" style={{ color: 'var(--muted)', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Route Detail
            </div>
            <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
              {routeDetail?.name || 'Loading…'}
            </h1>
            <div style={{ marginTop: 6, color: 'var(--muted)' }}>
              {routeDetail?.area || '—'} · {(routeDetail?.activeDays || []).join(', ')}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => updateRouteMutation.mutate()}
            disabled={updateRouteMutation.isPending || routeForm.activeDays.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', padding: '10px 16px', fontWeight: 500 }}
          >
            <Icon name="check" size={12} />
            Save Metadata
          </button>
          <button
            type="button"
            onClick={() => setShowConfirm(true)}
            disabled={editStops.length === 0}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontWeight: 500 }}
          >
            <Icon name="check" size={12} />
            Save Sequence
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 380px', gap: 16, minHeight: 0 }}>
        <div style={{ display: 'grid', gap: 16, minHeight: 0 }}>
          <SectionCard title="Route Metadata" subtitle="Name, area, active days, and publishing state">
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Route Name</span>
                  <input value={routeForm.name} onChange={(event) => setRouteForm((current) => ({ ...current, name: event.target.value }))} style={fieldStyle} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Area</span>
                  <input value={routeForm.area} onChange={(event) => setRouteForm((current) => ({ ...current, area: event.target.value }))} style={fieldStyle} />
                </label>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {DAY_OPTIONS.map((day) => (
                  <button key={day} type="button" onClick={() => toggleDays(day, 'edit')} style={dayPillStyle(routeForm.activeDays.includes(day))}>
                    {day}
                  </button>
                ))}
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--muted)' }}>
                <input type="checkbox" checked={routeForm.isActive} onChange={(event) => setRouteForm((current) => ({ ...current, isActive: event.target.checked }))} />
                Route is active
              </label>
              {metaError ? (
                <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                  {metaError}
                </div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Stop Sequence" subtitle="Drag to reorder, edit timing per stop">
            {saveError ? (
              <div style={{ marginBottom: 12, padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                {saveError}
              </div>
            ) : null}
            <div className="scroll" style={{ display: 'grid', gap: 8, maxHeight: 'calc(100vh - 470px)', paddingRight: 4 }}>
              {editStops.map((stop, idx) => (
                <div
                  key={stop.stopId}
                  draggable
                  onDragStart={() => setDragIdx(idx)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null && dragIdx !== idx) moveStop(dragIdx, idx);
                    setDragIdx(null);
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px 40px minmax(0, 1fr) auto auto 32px',
                    gap: 10,
                    alignItems: 'center',
                    padding: 12,
                    borderRadius: 16,
                    border: `1px solid ${dragIdx === idx ? 'var(--ink)' : 'var(--border)'}`,
                    background: dragIdx === idx ? 'var(--surface-2)' : 'var(--surface)',
                  }}
                >
                  <span style={{ color: 'var(--muted)' }}>⋮⋮</span>
                  <span className="mono" style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--surface-2)' }}>{stop.sequence}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 500 }}>{stop.stopName}</div>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ color: 'var(--muted)' }}>AM</span>
                    <input type="time" value={minutesToTime(stop.morningTime)} onChange={(event) => updateStopTime(idx, 'morningTime', event.target.value)} style={{ ...fieldStyle, width: 120 }} />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="mono" style={{ color: 'var(--muted)' }}>PM</span>
                    <input type="time" value={minutesToTime(stop.returnTime)} onChange={(event) => updateStopTime(idx, 'returnTime', event.target.value)} style={{ ...fieldStyle, width: 120 }} />
                  </label>
                  <button type="button" onClick={() => removeStop(idx)} style={{ width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)' }}>
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
              {editStops.length === 0 ? (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>No stops configured for this route yet.</div>
              ) : null}
            </div>
          </SectionCard>
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <SectionCard title="Stop Catalog" subtitle="Attach existing stops to this route">
            <div className="scroll" style={{ display: 'grid', gap: 8, maxHeight: 'calc(100vh - 530px)', paddingRight: 4 }}>
              {availableStops.map((stop) => (
                <button
                  key={stop.id}
                  type="button"
                  onClick={() => appendStop(stop)}
                  style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: 12, borderRadius: 16, border: '1px solid var(--border)', background: 'var(--surface)', textAlign: 'left' }}
                >
                  <div>
                    <div style={{ fontWeight: 500 }}>{stop.name}</div>
                    <div style={{ marginTop: 2, color: 'var(--muted)', fontSize: 12 }}>{stop.area || 'No area'} · {stop.lat}, {stop.lon}</div>
                  </div>
                  <Icon name="plus" size={12} />
                </button>
              ))}
              {availableStops.length === 0 ? (
                <div style={{ color: 'var(--muted)' }}>All known stops are already attached to this route.</div>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Create Stop" subtitle="Add a new stop to the shared catalog">
            <div style={{ display: 'grid', gap: 12 }}>
              <input placeholder="Stop name" value={stopForm.name} onChange={(event) => setStopForm((current) => ({ ...current, name: event.target.value }))} style={fieldStyle} />
              <input placeholder="Area" value={stopForm.area} onChange={(event) => setStopForm((current) => ({ ...current, area: event.target.value }))} style={fieldStyle} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <input placeholder="Latitude" value={stopForm.lat} onChange={(event) => setStopForm((current) => ({ ...current, lat: event.target.value }))} style={fieldStyle} />
                <input placeholder="Longitude" value={stopForm.lon} onChange={(event) => setStopForm((current) => ({ ...current, lon: event.target.value }))} style={fieldStyle} />
              </div>
              {catalogError ? (
                <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                  {catalogError}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => createStopMutation.mutate()}
                disabled={createStopMutation.isPending || !stopForm.name.trim() || !stopForm.lat.trim() || !stopForm.lon.trim()}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '11px 16px', fontWeight: 500 }}
              >
                <Icon name="plus" size={12} />
                Create Stop
              </button>
            </div>
          </SectionCard>
        </div>
      </div>

      {showConfirm ? (
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
      ) : null}
    </div>
  );
};

export default RouteEditor;
