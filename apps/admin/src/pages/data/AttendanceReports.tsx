import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdminAttendanceTrendPoint, AdminRouteSummary } from 'shared';
import { useReports } from '../../hooks/useReports';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { AlertOctagon, CheckCircle, DownloadCloud, FileText, Play } from 'lucide-react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const cardStyle: React.CSSProperties = {
  backgroundColor: 'white',
  border: '1px solid #E5E7EB',
  borderRadius: '0.75rem',
  padding: '1.25rem',
  boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
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

  if (isPageLoading) {
    return (
      <div style={{ padding: '2rem', color: '#94A3B8' }}>
        Loading attendance reports...
      </div>
    );
  }

  if (pageErrorMessage && !overview.data && routes.length === 0) {
    return (
      <div style={{ padding: '2rem', maxWidth: '640px' }}>
        <QueryError message={pageErrorMessage} onRetry={() => void overview.refetch()} />
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1320px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.78rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#2563EB', fontWeight: 800 }}>
            Reporting Console
          </div>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 800, margin: '0.35rem 0 0' }}>Attendance and operations reporting</h1>
          <p style={{ color: '#6B7280', marginTop: '0.45rem', maxWidth: 760 }}>
            Review live analytics for the selected date range, then generate a downloadable CSV artifact from the same backend-backed dataset.
          </p>
        </div>
      </div>

      {pageErrorMessage && (
        <div style={{ padding: '0.95rem 1rem', borderRadius: 14, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
          {pageErrorMessage}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '340px minmax(0, 1fr)', gap: '1.5rem' }}>
        <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <FileText size={18} color="#6B7280" /> Report Configuration
          </h3>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '0.5rem', fontSize: '0.875rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '0.5rem', fontSize: '0.875rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, color: '#374151', marginBottom: '0.5rem' }}>Route Scope</label>
            <select
              value={routeId}
              onChange={(event) => setRouteId(event.target.value)}
              style={{ width: '100%', padding: '0.65rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '0.5rem', fontSize: '0.875rem' }}
            >
              <option value="">All routes</option>
              {routes.map((route) => (
                <option key={route.id} value={route.id}>{route.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={onGenerate}
            disabled={generateReport.isPending || isJobRunning}
            style={{
              marginTop: '0.5rem',
              width: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.85rem 1rem',
              backgroundColor: generateReport.isPending || isJobRunning ? '#CBD5E1' : '#111827',
              color: generateReport.isPending || isJobRunning ? '#64748B' : 'white',
              border: 'none',
              borderRadius: '0.5rem',
              fontWeight: 700,
              cursor: generateReport.isPending || isJobRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <Play size={18} /> Generate CSV Export
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
            <div style={cardStyle}>
              <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>Trips analyzed</div>
              <div style={{ color: '#111827', fontWeight: 800, fontSize: '1.8rem', marginTop: '0.35rem' }}>{overview.data?.totalTrips ?? 0}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>Expected riders</div>
              <div style={{ color: '#111827', fontWeight: 800, fontSize: '1.8rem', marginTop: '0.35rem' }}>{overview.data?.totalExpected ?? 0}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>Checked in</div>
              <div style={{ color: '#059669', fontWeight: 800, fontSize: '1.8rem', marginTop: '0.35rem' }}>{overview.data?.totalCheckedIn ?? 0}</div>
            </div>
            <div style={cardStyle}>
              <div style={{ color: '#6B7280', fontSize: '0.8rem' }}>Attendance rate</div>
              <div style={{ color: '#111827', fontWeight: 800, fontSize: '1.8rem', marginTop: '0.35rem' }}>{overview.data?.attendanceRate ?? 0}%</div>
            </div>
          </div>

          {activeJobId && (
            <div style={{
              ...cardStyle,
              borderLeft: jobStatus?.status === 'COMPLETED' ? '4px solid #10B981' : jobStatus?.status === 'FAILED' ? '4px solid #EF4444' : '4px solid #3B82F6',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <div>
                  <h4 style={{ fontSize: '1.05rem', fontWeight: 700, margin: 0 }}>Export job {activeJobId.slice(0, 8)}</h4>
                  <p style={{ fontSize: '0.875rem', color: '#6B7280', margin: '0.35rem 0 0' }}>Status: {jobStatus ? jobStatus.status : 'INITIALIZING'}</p>
                </div>

                {jobStatus?.status === 'COMPLETED' && <CheckCircle size={30} color="#10B981" />}
                {jobStatus?.status === 'FAILED' && <AlertOctagon size={30} color="#EF4444" />}
                {isJobRunning && (
                  <div style={{ width: '30px', height: '30px', borderRadius: '50%', border: '3px solid #BFDBFE', borderTopColor: '#3B82F6', animation: 'spin 1s linear infinite' }} />
                )}
              </div>

              {jobStatus?.progress !== undefined && (
                <div style={{ width: '100%', backgroundColor: '#E5E7EB', borderRadius: '9999px', height: '0.55rem', marginBottom: '1rem' }}>
                  <div style={{ backgroundColor: '#3B82F6', height: '0.55rem', borderRadius: '9999px', width: `${jobStatus.progress}%`, transition: 'width 0.5s' }} />
                </div>
              )}

              {jobStatus?.status === 'COMPLETED' && jobStatus.resultUrl && (
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <a href={jobStatus.resultUrl} download style={{ textDecoration: 'none' }}>
                    <button style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1rem', backgroundColor: '#10B981', color: 'white', border: 'none', borderRadius: '0.5rem', fontWeight: 700, cursor: 'pointer' }}>
                      <DownloadCloud size={18} /> Download CSV
                    </button>
                  </a>
                  <span style={{ fontSize: '0.875rem', color: '#4B5563' }}>
                    {jobStatus.totalTripsAnalyzed} trips processed
                  </span>
                </div>
              )}

              {jobStatus?.status === 'FAILED' && (
                <div style={{ color: '#B91C1C', fontSize: '0.9rem' }}>{jobStatus.error || 'The export failed.'}</div>
              )}
            </div>
          )}

          <div style={{ ...cardStyle, minHeight: '360px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>Attendance trend</h3>
                <p style={{ color: '#6B7280', marginTop: '0.25rem', fontSize: '0.875rem' }}>
                  {overview.data?.routeName ? `${overview.data.routeName} route focus` : 'All-route operational view'}
                </p>
              </div>
            </div>

            <div style={{ width: '100%', height: '300px' }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData} margin={{ top: 5, right: 24, left: 12, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fill: '#6B7280' }} />
                  <Tooltip wrapperStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }} />
                  <Legend verticalAlign="top" height={36} iconType="circle" />
                  <Line type="monotone" dataKey="checkedIn" name="Checked In" stroke="#10B981" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="expected" name="Expected" stroke="#94A3B8" strokeWidth={2} strokeDasharray="5 5" />
                  <Line type="monotone" dataKey="absent" name="Absent" stroke="#EF4444" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {!overview.isLoading && trendData.length === 0 && (
              <div style={{ marginTop: '1rem', color: '#9CA3AF', fontSize: '0.9rem' }}>
                No trips matched the selected filters.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AttendanceReports;
