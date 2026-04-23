import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminBusListItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { Bus, Plus, Save, Trash2 } from 'lucide-react';

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

const panelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #E5E7EB',
  borderRadius: '0.75rem',
  overflow: 'hidden',
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

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) 360px', gap: '1rem', height: '100%' }}>
      <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column' }}>
        {busesError && (
          <div style={{ margin: '1rem 1rem 0', padding: '0.85rem 0.95rem', borderRadius: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
            {extractApiError(busesError).message}
          </div>
        )}

        <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Bus Fleet</h1>
            <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.875rem' }}>{buses.length} vehicles registered</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedBusId(null)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', border: 'none', borderRadius: '0.5rem', background: '#2563EB', color: 'white', padding: '0.7rem 0.95rem', cursor: 'pointer', fontWeight: 700 }}
          >
            <Plus size={16} /> New Bus
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Bus</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Capacity</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Assignment</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center' }}>Loading...</td></tr>
              ) : buses.map((bus) => (
                <tr
                  key={bus.id}
                  onClick={() => setSelectedBusId(bus.id)}
                  style={{ borderBottom: '1px solid #E5E7EB', cursor: 'pointer', background: selectedBusId === bus.id ? '#EFF6FF' : 'white' }}
                >
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 700 }}>{bus.number}</div>
                    <div style={{ color: '#6B7280', fontSize: '0.875rem' }}>{bus.plateNumber}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>{bus.capacity} seats</td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem' }}>
                    {bus.assignments?.length ? (
                      <div>
                        <div style={{ fontWeight: 600 }}>{bus.assignments[0].route?.name}</div>
                        <div style={{ color: '#6B7280' }}>{bus.assignments[0].driver?.name}</div>
                      </div>
                    ) : <span style={{ color: '#9CA3AF' }}>Unassigned</span>}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: bus.isActive ? '#ECFDF5' : '#FEF2F2', color: bus.isActive ? '#059669' : '#DC2626' }}>
                      {bus.isActive ? 'Active' : 'Deactivated'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.25rem 1.25rem 1rem', borderBottom: '1px solid #E5E7EB' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.35rem' }}>
            <Bus size={18} color="#2563EB" />
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{selectedBus ? 'Edit Bus' : 'Create Bus'}</h2>
          </div>
          <div style={{ color: '#6B7280', fontSize: '0.85rem' }}>
            {selectedBus ? 'Update vehicle identity and capacity.' : 'Register a new fleet vehicle.'}
          </div>
        </div>

        <div style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>Bus Number</span>
            <input value={form.number} onChange={(event) => setForm((current) => ({ ...current, number: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>Plate Number</span>
            <input value={form.plateNumber} onChange={(event) => setForm((current) => ({ ...current, plateNumber: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>Capacity</span>
            <input type="number" min={1} value={form.capacity} onChange={(event) => setForm((current) => ({ ...current, capacity: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          {selectedBus?.assignments?.[0] && (
            <div style={{ padding: '0.9rem', borderRadius: '0.75rem', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase' }}>Current assignment</div>
              <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>{selectedBus.assignments[0].route?.name}</div>
              <div style={{ marginTop: '0.2rem', color: '#475569', fontSize: '0.88rem' }}>{selectedBus.assignments[0].driver?.name}</div>
            </div>
          )}

          {formError && (
            <div style={{ padding: '0.85rem 0.95rem', borderRadius: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
              {formError}
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.number.trim() || !form.plateNumber.trim()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', borderRadius: '0.75rem', background: '#111827', color: 'white', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Save size={16} /> {saveMutation.isPending ? 'Saving...' : selectedBus ? 'Save Changes' : 'Create Bus'}
            </button>
            {saveSuccess && <span style={{ color: '#34D399', fontSize: '0.875rem', fontWeight: 600 }}>Saved</span>}
          </div>

          {selectedBus?.isActive && (
            <button
              type="button"
              onClick={() => deactivateMutation.mutate(selectedBus.id)}
              disabled={deactivateMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '1px solid #FCA5A5', borderRadius: '0.75rem', background: '#FFF1F2', color: '#BE123C', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Trash2 size={16} /> Deactivate Bus
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusList;
