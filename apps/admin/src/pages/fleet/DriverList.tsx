import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminDriverListItem } from 'shared';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

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

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
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

  const activeCount = drivers.filter((driver) => driver.isActive).length;
  const licensedCount = drivers.filter((driver) => Boolean(driver.licenseNumber)).length;

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
            Drivers
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 720 }}>
            Driver identity, phone, and license records continue to use the current driver management contract.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSelectedDriverId(null)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontSize: 12, fontWeight: 500 }}
        >
          <Icon name="plus" size={12} />
          New Driver
        </button>
      </div>

      {driversError ? (
        <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
          {extractApiError(driversError).message}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Drivers" value={drivers.length} sub="All driver records" spark={[1, 2, 2, 3, Math.max(drivers.length, 1)]} />
        <KPIBlock label="Active" value={activeCount} sub="Available to operate" accent="var(--ok)" spark={[1, 1, 2, 2, Math.max(activeCount, 1)]} />
        <KPIBlock label="Licensed" value={licensedCount} sub="License number present" accent="var(--info)" spark={[1, 2, 2, 2, Math.max(licensedCount, 1)]} />
        <KPIBlock label="No License" value={Math.max(drivers.length - licensedCount, 0)} sub="Needs cleanup or onboarding" accent="var(--warn)" spark={[1, 1, 1, 2, Math.max(drivers.length - licensedCount, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 360px', gap: 16 }}>
        <SectionCard title="Driver Manifest" subtitle={isLoading ? 'Loading drivers' : `${drivers.length} driver records`}>
          <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 'calc(100vh - 410px)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                <tr>
                  {['Name', 'Phone', 'License', 'Status'].map((label) => (
                    <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)' }}>Loading drivers…</td></tr>
                ) : drivers.map((driver) => {
                  const active = selectedDriverId === driver.id;
                  return (
                    <tr key={driver.id} onClick={() => setSelectedDriverId(driver.id)} style={{ background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                        <div style={{ fontWeight: 500 }}>{driver.name}</div>
                      </td>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>{driver.phone}</td>
                      <td className="mono" style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>{driver.licenseNumber || '—'}</td>
                      <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                        <StateBadge state={driver.isActive ? 'LIVE' : 'OFFLINE'} label={driver.isActive ? 'Active' : 'Deactivated'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title={selectedDriver ? 'Driver Detail' : 'Create Driver'} subtitle={selectedDriver ? 'Update driver identity and contact data' : 'Register a new driver'}>
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</span>
              <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Phone</span>
              <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} style={fieldStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>License Number</span>
              <input value={form.licenseNumber} onChange={(event) => setForm((current) => ({ ...current, licenseNumber: event.target.value }))} style={fieldStyle} />
            </label>

            {selectedDriver ? (
              <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>DRIVER RECORD</div>
                <div style={{ marginTop: 8 }}>{selectedDriver.name}</div>
                <div style={{ marginTop: 2, color: 'var(--muted)' }}>{selectedDriver.phone}</div>
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
              disabled={saveMutation.isPending || !form.name.trim() || !form.phone.trim()}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '11px 16px', fontWeight: 500 }}
            >
              <Icon name="check" size={12} />
              {saveMutation.isPending ? 'Saving…' : selectedDriver ? 'Save Changes' : 'Create Driver'}
            </button>
            {saveSuccess ? <div style={{ color: 'var(--ok)', fontSize: 12 }}>Saved</div> : null}

            {selectedDriver?.isActive ? (
              <button
                type="button"
                onClick={() => deactivateMutation.mutate(selectedDriver.id)}
                disabled={deactivateMutation.isPending}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)', padding: '11px 16px', fontWeight: 500 }}
              >
                <Icon name="x" size={12} />
                Deactivate Driver
              </button>
            ) : null}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};

export default DriverList;
