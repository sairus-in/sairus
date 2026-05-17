import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminAttendanceTrendPoint, AdminRouteSummary } from 'shared';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { KPIBlock, SectionCard } from '../../components/design/primitives';
import { Icon } from '../../components/design/Icon';
import { useReports } from '../../hooks/useReports';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

const filterStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
};

export const AttendanceReports: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);
  const [routeId, setRouteId] = useState('');

  const { generateReport, activeJobId, jobStatus, overview } = useReports({
    startDate,
    endDate,
    routeId: routeId || undefined,
  });

  const { data: routes = [], error: routesError, isLoading: routesLoading } = useQuery<AdminRouteSummary[]>({
    queryKey: ['admin-routes-reporting'],
    queryFn: () => api.get('/v1/routes'),
  });

  const trendData = useMemo(
    () => overview.data?.trends.map((point: AdminAttendanceTrendPoint) => ({
      label: point.label,
      expected: point.expected,
      checkedIn: point.checkedIn,
      absent: point.absent,
    })) ?? [],
    [overview.data?.trends],
  );

  const onGenerate = () => {
    generateReport.mutate({ startDate, endDate, routeId: routeId || undefined });
  };

  const isJobRunning = jobStatus?.status === 'QUEUED' || jobStatus?.status === 'PROCESSING';
  const isPageLoading = routesLoading || overview.isLoading;
  const pageError = routesError || overview.error || generateReport.error;
  const pageErrorMessage = pageError ? extractApiError(pageError).message : null;
  const attendanceRate = overview.data?.attendanceRate ?? 0;

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
            Reporting Console
          </div>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 500, letterSpacing: '-0.03em' }}>
            Attendance and Operations Reporting
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 760 }}>
            The live overview and the export job are tied to the same backend reporting pipeline, so what you review here is what gets exported.
          </div>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generateReport.isPending || isJobRunning}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 999,
            border: '1px solid var(--ink)',
            background: generateReport.isPending || isJobRunning ? 'var(--surface-2)' : 'var(--ink)',
            color: generateReport.isPending || isJobRunning ? 'var(--muted)' : 'var(--accent-ink)',
            padding: '10px 16px',
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          <Icon name="reports" size={14} />
          {isJobRunning ? 'Export Running' : 'Generate CSV Export'}
        </button>
      </div>

      {pageErrorMessage ? (
        <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
          {pageErrorMessage}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Trips Analyzed" value={overview.data?.totalTrips ?? 0} sub="Trips matched by current filter" spark={[12, 14, 13, 15, overview.data?.totalTrips ?? 0]} />
        <KPIBlock label="Expected Riders" value={overview.data?.totalExpected ?? 0} sub="Scheduled riders across range" spark={[120, 145, 132, 150, overview.data?.totalExpected ?? 0]} />
        <KPIBlock label="Checked In" value={overview.data?.totalCheckedIn ?? 0} sub="Observed boardings" accent="var(--ok)" spark={[110, 130, 122, 140, overview.data?.totalCheckedIn ?? 0]} />
        <KPIBlock label="Attendance Rate" value={`${attendanceRate}%`} sub="Overall attendance across selected period" accent={attendanceRate >= 90 ? 'var(--ok)' : 'var(--warn)'} spark={[84, 87, 89, 91, Math.max(attendanceRate, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        <SectionCard title="Report Configuration" subtitle="Change filters, then export the same dataset">
          <div style={{ display: 'grid', gap: 12 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Start Date</span>
              <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} style={filterStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>End Date</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} style={filterStyle} />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Route Scope</span>
              <select value={routeId} onChange={(event) => setRouteId(event.target.value)} style={filterStyle}>
                <option value="">All routes</option>
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>{route.name}</option>
                ))}
              </select>
            </label>
            <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
              <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>FILTER SUMMARY</div>
              <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Range</span><span>{startDate} to {endDate}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span className="muted">Route</span><span>{routeId ? routes.find((route) => route.id === routeId)?.name ?? 'Selected route' : 'All routes'}</span></div>
              </div>
            </div>
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gap: 16 }}>
          {activeJobId ? (
            <SectionCard
              title={`Export Job ${activeJobId.slice(0, 8)}`}
              subtitle={jobStatus ? `Status: ${jobStatus.status}` : 'Spawning job'}
            >
              <div style={{ display: 'grid', gap: 12 }}>
                {jobStatus?.progress !== undefined ? (
                  <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
                    <div style={{ width: `${jobStatus.progress}%`, height: '100%', background: 'var(--ink)', borderRadius: 999, transition: 'width var(--t)' }} />
                  </div>
                ) : null}
                {jobStatus?.status === 'COMPLETED' && jobStatus.resultUrl ? (
                  <a href={jobStatus.resultUrl} download style={{ textDecoration: 'none' }}>
                    <button type="button" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ok)', background: 'var(--ok)', color: '#fff', padding: '10px 16px', fontWeight: 500 }}>
                      <Icon name="arrowRight" size={12} />
                      Download CSV
                    </button>
                  </a>
                ) : null}
                {jobStatus?.status === 'FAILED' ? (
                  <div style={{ padding: '12px 14px', borderRadius: 14, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
                    {jobStatus.error || 'The export failed.'}
                  </div>
                ) : null}
                {jobStatus?.totalTripsAnalyzed ? (
                  <div style={{ color: 'var(--muted)' }}>{jobStatus.totalTripsAnalyzed} trips analyzed in this export.</div>
                ) : null}
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Attendance Trend"
            subtitle={isPageLoading ? 'Loading overview' : overview.data?.routeName ? `${overview.data.routeName} route focus` : 'All-route operational view'}
          >
            <div style={{ width: '100%', height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e2d9" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#7f7d75', fontSize: 11 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#7f7d75', fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: '1px solid #ddd8cb',
                      background: '#fffef8',
                      boxShadow: '0 8px 24px rgba(24,24,26,0.08)',
                    }}
                  />
                  <Legend verticalAlign="top" height={32} iconType="circle" />
                  <Line type="monotone" dataKey="checkedIn" name="Checked In" stroke="#3a7a5a" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                  <Line type="monotone" dataKey="expected" name="Expected" stroke="#8e8a7d" strokeWidth={1.75} strokeDasharray="4 4" dot={false} />
                  <Line type="monotone" dataKey="absent" name="Absent" stroke="#a6423a" strokeWidth={2} dot={{ r: 2.5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            {!overview.isLoading && trendData.length === 0 ? (
              <div style={{ marginTop: 8, color: 'var(--muted)' }}>No trips matched the selected filters.</div>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </div>
  );
};

export default AttendanceReports;
