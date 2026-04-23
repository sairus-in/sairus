import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminDriverListItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { Plus, Save, Trash2, UserRound } from 'lucide-react';

type DriverFormState = {
  name: string;
  phone: string;
  licenseNumber: string;
};

const emptyForm: DriverFormState = {
  name: '',
  phone: '',
  licenseNumber: '',
};

const panelStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #E5E7EB',
  borderRadius: '0.75rem',
  overflow: 'hidden',
};

export const DriverList: React.FC = () => {
  const queryClient = useQueryClient();
  const { data: drivers = [], isLoading, error: driversError } = useQuery<AdminDriverListItem[]>({
    queryKey: ['fleet-drivers'],
    queryFn: () => api.get('/v1/fleet/drivers'),
  });

  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [form, setForm] = useState<DriverFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const selectedDriver = useMemo(
    () => drivers.find((driver) => driver.id === selectedDriverId) ?? null,
    [drivers, selectedDriverId],
  );

  useEffect(() => {
    if (selectedDriver) {
      setForm({
        name: selectedDriver.name,
        phone: selectedDriver.phone,
        licenseNumber: selectedDriver.licenseNumber || '',
      });
    } else {
      setForm(emptyForm);
    }
    setFormError(null);
    setSaveSuccess(false);
  }, [selectedDriver]);

  React.useEffect(() => {
    if (!saveSuccess) {
      return;
    }

    const timeout = window.setTimeout(() => setSaveSuccess(false), 3000);
    return () => window.clearTimeout(timeout);
  }, [saveSuccess]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        phone: form.phone.trim(),
        licenseNumber: form.licenseNumber.trim() || undefined,
      };

      return selectedDriver
        ? api.put(`/v1/fleet/drivers/${selectedDriver.id}`, payload)
        : api.post('/v1/fleet/drivers', payload);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet-drivers'] });
      setFormError(null);
      setSaveSuccess(true);
      if (!selectedDriver) {
        setSelectedDriverId(null);
        setForm(emptyForm);
      }
    },
    onError: (error) => {
      setFormError(extractApiError(error).message);
      setSaveSuccess(false);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/v1/fleet/drivers/${id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['fleet-drivers'] });
      if (selectedDriverId) {
        setSelectedDriverId(null);
      }
    },
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.35fr) 360px', gap: '1rem', height: '100%' }}>
      <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column' }}>
        {driversError && (
          <div style={{ margin: '1rem 1rem 0', padding: '0.85rem 0.95rem', borderRadius: '0.75rem', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
            {extractApiError(driversError).message}
          </div>
        )}

        <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 'bold' }}>Driver Management</h1>
            <p style={{ margin: '0.25rem 0 0', color: '#6B7280', fontSize: '0.875rem' }}>{drivers.length} drivers registered</p>
          </div>
          <button
            type="button"
            onClick={() => setSelectedDriverId(null)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', border: 'none', borderRadius: '0.5rem', background: '#2563EB', color: 'white', padding: '0.7rem 0.95rem', cursor: 'pointer', fontWeight: 700 }}
          >
            <Plus size={16} /> New Driver
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Name</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Phone</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>License</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center' }}>Loading...</td></tr>
              ) : drivers.map((driver) => (
                <tr
                  key={driver.id}
                  onClick={() => setSelectedDriverId(driver.id)}
                  style={{ borderBottom: '1px solid #E5E7EB', cursor: 'pointer', background: selectedDriverId === driver.id ? '#EFF6FF' : 'white' }}
                >
                  <td style={{ padding: '1rem', fontWeight: 600 }}>{driver.name}</td>
                  <td style={{ padding: '1rem', color: '#4B5563' }}>{driver.phone}</td>
                  <td style={{ padding: '1rem', color: '#4B5563' }}>{driver.licenseNumber || '-'}</td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ padding: '0.25rem 0.75rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 600, background: driver.isActive ? '#ECFDF5' : '#FEF2F2', color: driver.isActive ? '#059669' : '#DC2626' }}>
                      {driver.isActive ? 'Active' : 'Deactivated'}
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
            <UserRound size={18} color="#2563EB" />
            <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>{selectedDriver ? 'Edit Driver' : 'Create Driver'}</h2>
          </div>
          <div style={{ color: '#6B7280', fontSize: '0.85rem' }}>
            {selectedDriver ? 'Update driver identity and contact details.' : 'Register a new driver account.'}
          </div>
        </div>

        <div style={{ padding: '1.25rem', display: 'grid', gap: '0.9rem' }}>
          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>Name</span>
            <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>Phone</span>
            <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          <label style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>License Number</span>
            <input value={form.licenseNumber} onChange={(event) => setForm((current) => ({ ...current, licenseNumber: event.target.value }))} style={{ padding: '0.7rem 0.8rem', borderRadius: '0.5rem', border: '1px solid #D1D5DB' }} />
          </label>

          {selectedDriver && (
            <div style={{ padding: '0.9rem', borderRadius: '0.75rem', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
              <div style={{ fontSize: '0.78rem', color: '#64748B', textTransform: 'uppercase' }}>Driver record</div>
              <div style={{ marginTop: '0.35rem', fontWeight: 700 }}>{selectedDriver.name}</div>
              <div style={{ marginTop: '0.2rem', color: '#475569', fontSize: '0.88rem' }}>{selectedDriver.phone}</div>
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
              disabled={saveMutation.isPending || !form.name.trim() || !form.phone.trim()}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', borderRadius: '0.75rem', background: '#111827', color: 'white', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Save size={16} /> {saveMutation.isPending ? 'Saving...' : selectedDriver ? 'Save Changes' : 'Create Driver'}
            </button>
            {saveSuccess && <span style={{ color: '#34D399', fontSize: '0.875rem', fontWeight: 600 }}>Saved</span>}
          </div>

          {selectedDriver?.isActive && (
            <button
              type="button"
              onClick={() => deactivateMutation.mutate(selectedDriver.id)}
              disabled={deactivateMutation.isPending}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: '1px solid #FCA5A5', borderRadius: '0.75rem', background: '#FFF1F2', color: '#BE123C', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
            >
              <Trash2 size={16} /> Deactivate Driver
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default DriverList;
