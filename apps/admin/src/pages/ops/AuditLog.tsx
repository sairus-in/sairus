import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminAuditLogResponse } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QK } from '../../lib/query-keys';
import { Icon } from '../../components/design/Icon';
import { KPIBlock, SectionCard, toneClass } from '../../components/design/primitives';

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

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--border-2)',
  borderRadius: 'var(--r-md)',
  background: 'var(--surface-2)',
};

const PAGE_SIZE = 50;

export const AuditLog: React.FC = () => {
  const [filters, setFilters] = useState<AuditLogFilters>({
    actorId: '',
    action: '',
    entityType: '',
    from: '',
    to: '',
  });
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const updateFilter = <K extends keyof AuditLogFilters>(key: K, value: AuditLogFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  };

  const params = useMemo(
    () => ({
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      ...(filters.entityType ? { entityType: filters.entityType } : {}),
      ...(filters.from ? { from: filters.from } : {}),
      ...(filters.to ? { to: filters.to } : {}),
      page,
      limit: PAGE_SIZE,
    }),
    [filters, page],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: QK.auditLog(params),
    queryFn: (): Promise<AdminAuditLogResponse> => api.get('/v1/admin/audit-log', { params }),
  });

  if (isLoading) {
    return <div className="muted">Loading audit log...</div>;
  }

  if (error) {
    return <div className={toneClass('err')} style={{ width: 'fit-content', textTransform: 'none' }}>{extractApiError(error).message}</div>;
  }

  const entries = data?.entries ?? [];
  const totalEntries = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalEntries / PAGE_SIZE));
  const currentPage = data?.page ?? page;
  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <div style={{ color: 'var(--info)', fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Governance</div>
        <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 500 }}>Audit Log</h1>
        <div style={{ marginTop: 4, color: 'var(--muted)', fontSize: 12 }}>
          Review privileged admin actions, scoped entities, and change payloads.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        <KPIBlock label="Total Entries" value={totalEntries} />
        <KPIBlock label="Page" value={`${currentPage} / ${totalPages}`} />
        <KPIBlock label="Page Size" value={data?.limit ?? PAGE_SIZE} />
      </div>

      <SectionCard title="Filters" subtitle="Audit query controls">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}>
          <input type="text" value={filters.actorId} onChange={(event) => updateFilter('actorId', event.target.value)} placeholder="Actor ID" style={inputStyle} />
          <select value={filters.action} onChange={(event) => updateFilter('action', event.target.value)} style={inputStyle}>
            <option value="">All actions</option>
            {ACTION_OPTIONS.filter(Boolean).map((action) => <option key={action} value={action}>{action}</option>)}
          </select>
          <select value={filters.entityType} onChange={(event) => updateFilter('entityType', event.target.value)} style={inputStyle}>
            <option value="">All entity types</option>
            {ENTITY_TYPE_OPTIONS.filter(Boolean).map((entityType) => <option key={entityType} value={entityType}>{entityType}</option>)}
          </select>
          <input type="date" value={filters.from} onChange={(event) => updateFilter('from', event.target.value)} style={inputStyle} />
          <input type="date" value={filters.to} onChange={(event) => updateFilter('to', event.target.value)} style={inputStyle} />
        </div>
      </SectionCard>

      <SectionCard
        title="Entries"
        subtitle={totalEntries > 0
          ? `Showing ${(currentPage - 1) * PAGE_SIZE + 1}–${(currentPage - 1) * PAGE_SIZE + entries.length} of ${totalEntries}`
          : `${entries.length} rows`}
        actions={(
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn sm"
              disabled={isFirstPage}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              <Icon name="chevL" size={12} /> Prev
            </button>
            <button
              type="button"
              className="btn sm"
              disabled={isLastPage}
              onClick={() => setPage((current) => current + 1)}
            >
              Next <Icon name="chevR" size={12} />
            </button>
          </div>
        )}
      >
        {entries.length === 0 ? (
          <div className="muted">No audit entries match the current filters.</div>
        ) : (
          <div className="scroll" style={{ display: 'grid', gap: 10 }}>
            {entries.map((entry) => {
              const expanded = expandedEntryId === entry.id;
              return (
                <div key={entry.id} style={{ border: '1px solid var(--divider)', borderRadius: 'var(--r-md)', background: expanded ? 'var(--surface-2)' : 'transparent' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedEntryId((current) => current === entry.id ? null : entry.id)}
                    style={{ width: '100%', padding: 14, border: 0, background: 'transparent', textAlign: 'left' }}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: '180px 180px 180px 160px 1fr 64px', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontSize: 12 }}>{new Date(entry.createdAt).toLocaleString()}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{entry.actorId}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{entry.actorType}</div>
                      </div>
                      <div><span className={toneClass('info')}>{entry.action}</span></div>
                      <div>{entry.entityType || 'N/A'}</div>
                      <div className="mono" style={{ fontSize: 11 }}>{entry.entityId || 'N/A'}</div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Icon name={expanded ? 'chev' : 'chevR'} size={14} />
                      </div>
                    </div>
                  </button>
                  {expanded ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, padding: '0 14px 14px' }}>
                      {[
                        { label: 'Before', value: entry.before },
                        { label: 'After', value: entry.after },
                        { label: 'Meta', value: entry.meta },
                      ].map((block) => (
                        <div key={block.label}>
                          <div style={{ marginBottom: 6, color: 'var(--muted)', fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{block.label}</div>
                          <pre
                            style={{
                              margin: 0,
                              padding: 12,
                              border: '1px solid var(--divider)',
                              borderRadius: 'var(--r-md)',
                              background: '#fbfbf9',
                              color: 'var(--ink-2)',
                              fontSize: 12,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                            }}
                          >
                            {JSON.stringify(block.value, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

export default AuditLog;
