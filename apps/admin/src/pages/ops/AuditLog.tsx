import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminAuditLogResponse } from 'shared';
import { ChevronDown, ChevronRight, Shield } from 'lucide-react';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QK } from '../../lib/query-keys';

type AuditLogFilters = {
  actorId: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
};

const ACTION_OPTIONS = [
  '',
  'LOGIN',
  'LOGOUT',
  'INVITE_ADMIN',
  'RETRY_IMPORT_ROWS',
  'REVIEW_CORRECTIONS',
  'COORDINATOR_OVERRIDE',
  'RESOLVE_INCIDENTS',
  'ESCALATE_INCIDENTS',
  'ASSIGN_SUBSTITUTE',
  'SEND_MESSAGE_TO_DRIVER',
  'VIEW_AUDIT_LOG',
];

const ENTITY_TYPE_OPTIONS = [
  '',
  'ADMIN_USER',
  'IMPORT_SESSION',
  'CORRECTION',
  'INCIDENT',
  'TRIP',
  'ATTENDANCE',
  'USER',
];

const panelStyle: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1F2937',
  borderRadius: 20,
  padding: '1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1rem',
  minHeight: 0,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid #334155',
  background: '#020617',
  color: '#F8FAFC',
  padding: '0.75rem 0.85rem',
};

const jsonBlockStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.85rem',
  borderRadius: 14,
  background: '#020617',
  border: '1px solid #1E293B',
  color: '#CBD5E1',
  fontSize: '0.8rem',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  overflowX: 'auto',
};

export const AuditLog: React.FC = () => {
  const [filters, setFilters] = useState<AuditLogFilters>({
    actorId: '',
    action: '',
    entityType: '',
    from: '',
    to: '',
  });
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  const params = useMemo(
    () => ({
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      page: 1,
      limit: 50,
    }),
    [filters],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: QK.auditLog(params),
    queryFn: (): Promise<AdminAuditLogResponse> => api.get<AdminAuditLogResponse>('/v1/admin/audit-log', { params }),
  });

  if (isLoading) {
    return (
      <div style={{ padding: '2rem', color: '#94A3B8' }}>
        Loading audit log...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        padding: '1rem',
        borderRadius: 12,
        background: 'rgba(127, 29, 29, 0.3)',
        border: '1px solid rgba(248, 113, 113, 0.3)',
        color: '#FCA5A5',
        margin: '1rem',
      }}>
        {extractApiError(error).message}
      </div>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: '100%' }}>
      <section style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#38BDF8', fontWeight: 800 }}>
              Governance
            </div>
            <h1 style={{ margin: '0.35rem 0 0', color: '#FFFFFF', fontSize: '2rem' }}>Audit Log</h1>
            <p style={{ margin: '0.55rem 0 0', color: '#94A3B8', maxWidth: 760 }}>
              Review privileged admin actions, scoped entities, and change payloads.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', color: '#93C5FD', fontWeight: 700 }}>
            <Shield size={18} />
            {data?.total ?? 0} entries
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '0.75rem' }}>
          <input
            type="text"
            value={filters.actorId}
            onChange={(event) => setFilters((current) => ({ ...current, actorId: event.target.value }))}
            placeholder="Actor ID"
            style={inputStyle}
          />
          <select
            value={filters.action}
            onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value }))}
            style={inputStyle}
          >
            <option value="">All actions</option>
            {ACTION_OPTIONS.filter(Boolean).map((action) => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
          <select
            value={filters.entityType}
            onChange={(event) => setFilters((current) => ({ ...current, entityType: event.target.value }))}
            style={inputStyle}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPE_OPTIONS.filter(Boolean).map((entityType) => (
              <option key={entityType} value={entityType}>{entityType}</option>
            ))}
          </select>
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            style={inputStyle}
          />
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            style={inputStyle}
          />
        </div>
      </section>

      <section style={{ ...panelStyle, overflow: 'hidden', flex: 1 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '180px 180px 180px 160px 1fr 180px 64px', gap: '0.75rem', padding: '0 0.5rem', color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <div>Timestamp</div>
          <div>Actor</div>
          <div>Action</div>
          <div>Entity Type</div>
          <div>Entity ID</div>
          <div>Route Scope</div>
          <div></div>
        </div>

        <div style={{ display: 'grid', gap: '0.75rem', overflowY: 'auto', paddingRight: '0.2rem' }}>
          {entries.length === 0 ? (
            <div style={{ color: '#94A3B8', padding: '1rem 0.5rem' }}>No audit entries match the current filters.</div>
          ) : (
            entries.map((entry) => {
              const expanded = expandedEntryId === entry.id;
              return (
                <div key={entry.id} style={{ borderRadius: 18, border: '1px solid #1F2937', background: '#0F172A', overflow: 'hidden' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedEntryId((current) => current === entry.id ? null : entry.id)}
                    style={{ width: '100%', border: 0, background: 'transparent', color: '#F8FAFC', padding: '0.95rem 1rem', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '180px 180px 180px 160px 1fr 180px 64px', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{ color: '#CBD5E1', fontSize: '0.84rem' }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      <div>
                        <div style={{ fontWeight: 700 }}>{entry.actorId}</div>
                        <div style={{ color: '#64748B', fontSize: '0.78rem' }}>{entry.actorType}</div>
                      </div>
                      <div style={{ color: '#93C5FD', fontWeight: 700 }}>{entry.action}</div>
                      <div style={{ color: '#CBD5E1' }}>{entry.entityType || 'N/A'}</div>
                      <div style={{ color: '#CBD5E1', wordBreak: 'break-word' }}>{entry.entityId || 'N/A'}</div>
                      <div style={{ color: '#CBD5E1' }}>{entry.routeIds.length > 0 ? entry.routeIds.join(', ') : 'Global'}</div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        {expanded ? <ChevronDown size={18} color="#94A3B8" /> : <ChevronRight size={18} color="#94A3B8" />}
                      </div>
                    </div>
                  </button>

                  {expanded && (
                    <div style={{ padding: '0 1rem 1rem', display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
                      <div>
                        <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                          Before
                        </div>
                        <pre style={jsonBlockStyle}>{JSON.stringify(entry.before, null, 2)}</pre>
                      </div>
                      <div>
                        <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                          After
                        </div>
                        <pre style={jsonBlockStyle}>{JSON.stringify(entry.after, null, 2)}</pre>
                      </div>
                      <div>
                        <div style={{ color: '#64748B', fontSize: '0.74rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.45rem' }}>
                          Meta
                        </div>
                        <pre style={jsonBlockStyle}>{JSON.stringify(entry.meta, null, 2)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

export default AuditLog;
