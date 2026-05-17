import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminBusListItem } from 'shared';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

type BusFormState = {
  number: string;
  plateNumber: string;
  capacity: string;
};

const emptyForm: BusFormState = {
  number: '',
  plateNumber: '',
  capacity: '50',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
};

export const BusList: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: buses = [], isLoading, error: busesError } = useQuery<AdminBusListItem[]>({
    queryKey: ['fleet-buses'],
    queryFn: () => api.get('/v1/fleet/buses'),
  });

  const [selectedBusId, setSelectedBusId] = useState<string | null>(null);
  const [form, setForm] = useState<BusFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const selectedBus = useMemo(
    () => buses.find((bus) => bus.id === selectedBusId) ?? null,
    [buses, selectedBusId],
  );

  useEffect(() => {
    if (selectedBus) {
      setForm({
        number: selectedBus.number,
        plateNumber: selectedBus.plateNumber,
        capacity: String(selectedBus.capacity),
      });
    } else {
      setForm(emptyForm);
    }
    setFormError(null);
    setSaveSuccess(false);
  }, [selectedBus]);

  useEffect(() => {
    if (!saveSuccess) {
      return;
    }

    const timeout = window.setTimeout(() => setSaveSuccess(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [saveSuccess]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        number: form.number.trim(),
        plateNumber: form.plateNumber.trim(),
        capacity: Number(form.capacity),
      };

      return selectedBus
        ? api.put(`/v1/fleet/buses/${selectedBus.id}`, payload)
        : api.post('/v1/fleet/buses', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet-buses'] });
      setFormError(null);
      setSaveSuccess(true);
      if (!selectedBus) {
        setSelectedBusId(null);
        setForm(emptyForm);
      }
    },
    onError: (error) => {
      setFormError(extractApiError(error).message);
      setSaveSuccess(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/fleet/buses/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet-buses'] });
      if (selectedBusId) {
        setSelectedBusId(null);
      }
    },
  });

  const activeCount = buses.filter((bus) => bus.isActive).length;
  const assignedCount = buses.filter((bus) => bus.assignments?.length).length;
  const capacityTotal = buses.reduce((sum, bus) => sum + bus.capacity, 0);

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
            Fleet Registry
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            Buses
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 720 }}>
            Vehicle registration, assignment visibility, and activation state all still run through the existing fleet endpoints.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedBusId(null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontSize: 12, fontWeight: 500 }}
        >
          <Icon name="plus" size={12} />
          New Bus
        </button>
      </div>

      {busesError ? (
        <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
          {extractApiError(busesError).message}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Fleet Size" value={buses.length} sub="All vehicles in registry" spark={[1, 2, 3, 3, Math.max(buses.length, 1)]} />
        <KPIBlock label="Active" value={activeCount} sub="Currently operational vehicles" accent="var(--ok)" spark={[1, 2, 2, 3, Math.max(activeCount, 1)]} />
        <KPIBlock label="Assigned" value={assignedCount} sub="Bus has route or driver assignment" accent="var(--info)" spark={[0, 1, 1, 2, Math.max(assignedCount, 1)]} />
        <KPIBlock label="Seat Capacity" value={capacityTotal} sub="Total seats across registered buses" accent="var(--warn)" spark={[30, 60, 90, 110, Math.max(capacityTotal, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 360px', gap: 16 }}>
        <SectionCard title="Fleet Manifest" subtitle={isLoading ? 'Loading buses' : `${buses.length} vehicles registered`}>
          <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 'calc(100vh - 410px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                <tr>
                  {['Bus', 'Capacity', 'Assignment', 'Status'].map((label) => (
                    <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)' }}>Loading buses…</td></tr>
                ) : buses.map((bus) => {
                  const active = selectedBusId === bus.id;
                  const assignment = bus.assignments?.[0];
                  return (
                    <tr key={bus.id} onClick={() => setSelectedBusId(bus.id)} style={{ background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                        <div className="mono" style={{ fontWeight: 500 }}>{bus.number}</div>
                        <div style={{ marginTop: 2, color: 'var(--muted)' }}>{bus.plateNumber}</div>
                      </td>
                      <td className="mono" style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>{bus.capacity} seats</td>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                        {assignment ? (
                          <>
                            <div>{assignment.route?.name || 'Assigned route'}</div>
                            <div style={{ marginTop: 2, color: 'var(--muted)' }}>{assignment.driver?.name || 'Driver pending'}</div>
                          </>
                        ) : (
                          <span className="muted">Unassigned</span>
                        )}
                      </td>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                        <StateBadge state={bus.isActive ? 'LIVE' : 'OFFLINE'} label={bus.isActive ? 'Active' : 'Deactivated'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title={selectedBus ? 'Bus Detail' : 'Create Bus'} subtitle={selectedBus ? 'Update vehicle identity and capacity' : 'Register a new fleet vehicle'}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Bus Number</span>
              <input value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Plate Number</span>
              <input value={form.plateNumber} onChange={(event) => setForm((current) => ({ ...current, plateNumber: event.target.value }))} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Capacity</span>
              <input type="number" min={1} value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} style={fieldStyle} />
            </label>

            {selectedBus?.assignments?.[0] ? (
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>CURRENT ASSIGNMENT</div>
                <div style={{ marginTop: 8 }}>{selectedBus.assignments[0].route?.name}</div>
                <div style={{ marginTop: 2, color: 'var(--muted)' }}>{selectedBus.assignments[0].driver?.name}</div>
              </div>
            ) : null}

            {formError ? (
              <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                {formError}
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.number.trim() || !form.plateNumber.trim()}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '11px 16px', fontWeight: 500 }}
            >
              <Icon name="check" size={12} />
              {saveMutation.isPending ? 'Saving…' : selectedBus ? 'Save Changes' : 'Create Bus'}
            </button>
            {saveSuccess ? <div style={{ color: 'var(--ok)', fontSize: 12 }}>Saved</div> : null}

            {selectedBus?.isActive ? (
              <button
                type="button"
                onClick={() => deactivateMutation.mutate(selectedBus.id)}
                disabled={deactivateMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)', padding: '11px 16px', fontWeight: 500 }}
              >
                <Icon name="x" size={12} />
                Deactivate Bus
              </button>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default BusList;
