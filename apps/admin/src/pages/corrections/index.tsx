import React, { useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { CorrectionCard } from '../../components/ops/CorrectionCard';
import { KPIBlock, PriorityChip, SectionCard } from '../../components/design/primitives';
import { useCorrections } from '../../hooks/useCorrections';

export const Corrections: React.FC = () => {
  const { data: corrections = [], isLoading } = useCorrections();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedCorrection = useMemo(
    () => corrections.find((correction) => correction.id === selectedId) ?? corrections[0] ?? null,
    [corrections, selectedId],
  );

  const gpsRelated = corrections.filter((correction) => /gps|offline/i.test(correction.reason)).length;
  const staleQueue = corrections.filter((correction) => {
    const ageMs = Date.now() - new Date(correction.createdAt).getTime();
    return ageMs > 15 * 60 * 1000;
  }).length;

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
            Review Queue
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            Corrections
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 760 }}>
            Review attendance correction requests without changing the correction approval contract or queue polling behavior.
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Pending" value={corrections.length} sub="Requests waiting for decision" spark={[1, 2, 2, 3, Math.max(corrections.length, 1)]} />
        <KPIBlock label="GPS Related" value={gpsRelated} sub="Outage or offline evidence disputes" accent="var(--warn)" spark={[0, 1, 1, 2, Math.max(gpsRelated, 1)]} />
        <KPIBlock label="Stale Queue" value={staleQueue} sub="Waiting more than 15 minutes" accent="var(--err)" spark={[0, 0, 1, 1, Math.max(staleQueue, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '360px minmax(0, 1fr)', gap: 16, minHeight: 0 }}>
        <SectionCard title="Correction Queue" subtitle={isLoading ? 'Loading queue' : `${corrections.length} pending requests`}>
          <div className="scroll" style={{ display: 'grid', gap: 8, maxHeight: 'calc(100vh - 390px)', paddingRight: 4 }}>
            {isLoading ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>Loading correction queue…</div>
            ) : corrections.length === 0 ? (
              <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--muted)' }}>No pending corrections.</div>
            ) : (
              corrections.map((correction) => {
                const active = selectedCorrection?.id === correction.id;
                const ageMs = Date.now() - new Date(correction.createdAt).getTime();
                const isGpsRelated = /gps|offline/i.test(correction.reason);
                const priority: 'p1' | 'p2' | 'p3' = isGpsRelated
                  ? 'p1'
                  : ageMs > 15 * 60 * 1000
                    ? 'p2'
                    : 'p3';
                return (
                  <button
                    key={correction.id}
                    type="button"
                    onClick={() => setSelectedId(correction.id)}
                    style={{
                      padding: 14,
                      borderRadius: 16,
                      border: `1px solid ${active ? 'var(--ink)' : 'var(--border)'}`,
                      background: active ? 'var(--surface-2)' : 'var(--surface)',
                      textAlign: 'left',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <PriorityChip level={priority} />
                        <span style={{ fontWeight: 500 }}>{correction.attendance.user.name}</span>
                      </div>
                      <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                        {formatDistanceToNow(new Date(correction.createdAt))} ago
                      </span>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.55 }}>
                      {correction.reason}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={selectedCorrection ? 'Correction Detail' : 'Correction Detail'}
          subtitle={selectedCorrection ? 'Review evidence, then approve or reject' : 'Select a correction from the queue'}
        >
          {selectedCorrection ? (
            <CorrectionCard correction={selectedCorrection} onClose={() => setSelectedId(null)} />
          ) : (
            <div style={{ padding: '32px 0', color: 'var(--muted)' }}>Select a correction from the queue to review.</div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};

export default Corrections;
