import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminListResponse, AdminRouteSummary, AdminStudentListItem } from 'shared';
import { BulkUploadWizard } from './BulkUploadWizard';
import { UnassignedDrawer } from './UnassignedDrawer';
import { KPIBlock, SectionCard, StateBadge } from '../../components/design/primitives';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';

type StudentFormState = {
  name: string;
  phone: string;
  rollNumber: string;
  department: string;
  year: string;
  routeId: string;
  stopId: string;
};

const emptyForm: StudentFormState = {
  name: '',
  phone: '',
  rollNumber: '',
  department: '',
  year: '',
  routeId: '',
  stopId: '',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  padding: '10px 12px',
  outline: 'none',
};

export const StudentList: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [form, setForm] = useState<StudentFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const limit = 50;

  const { data, isLoading, error, refetch } = useQuery<AdminListResponse<AdminStudentListItem>>({
    queryKey: ['students', page, search, statusFilter],
    queryFn: () => api.getList('/v1/users', {
      params: {
        role: 'STUDENT',
        page,
        limit,
        search: search || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      },
    }),
    placeholderData: (prev) => prev,
  });

  const { data: routes = [], error: routesError } = useQuery<AdminRouteSummary[]>({
    queryKey: ['routes-all-students'],
    queryFn: () => api.get('/v1/routes'),
  });

  const students = data?.data || [];
  const total = data?.pagination.total || 0;
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === selectedStudentId) ?? null,
    [students, selectedStudentId],
  );

  useEffect(() => {
    if (selectedStudent) {
      setForm({
        name: selectedStudent.name,
        phone: selectedStudent.phone || '',
        rollNumber: selectedStudent.rollNumber || '',
        department: selectedStudent.department || '',
        year: selectedStudent.year ? String(selectedStudent.year) : '',
        routeId: selectedStudent.routeId || '',
        stopId: selectedStudent.stopId || '',
      });
    } else {
      setForm(emptyForm);
    }
    setFormError(null);
  }, [selectedStudent]);

  const selectedRoute = routes.find((route) => route.id === form.routeId);
  const stopOptions = selectedRoute?.stops || [];
  const pageError = error || routesError;
  const pageErrorMessage = pageError ? extractApiError(pageError).message : null;
  const activeStudents = students.filter((student) => student.isActive).length;
  const unassignedCount = students.filter((student) => !student.routeId).length;

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedStudent) {
        throw new Error('Select a student first.');
      }

      return api.patch(`/v1/users/${selectedStudent.id}`, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        rollNumber: form.rollNumber.trim() || null,
        department: form.department.trim() || null,
        year: form.year ? Number(form.year) : null,
        routeId: form.routeId || undefined,
        stopId: form.stopId || undefined,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['students'] });
      await queryClient.invalidateQueries({ queryKey: ['students-unassigned'] });
      setFormError(null);
    },
    onError: (error) => {
      setFormError(extractApiError(error).message);
    },
  });

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
            Students
          </h1>
          <div style={{ marginTop: 6, color: 'var(--muted)', maxWidth: 760 }}>
            Search, assign, and update students against the current user contract. CSV upload and unassigned routing remain available in the same flow.
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsUploadOpen(true)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, borderRadius: 999, border: '1px solid var(--ink)', background: 'var(--ink)', color: 'var(--accent-ink)', padding: '10px 16px', fontSize: 12, fontWeight: 500 }}
        >
          Import CSV
        </button>
      </div>

      {pageErrorMessage ? (
        <div style={{ padding: '12px 14px', borderRadius: 16, border: '1px solid var(--err)', background: 'var(--err-soft)', color: 'var(--err)' }}>
          {pageErrorMessage}
          <button type="button" onClick={() => void refetch()} style={{ marginLeft: 10, border: 0, background: 'transparent', color: 'inherit', textDecoration: 'underline' }}>
            Retry
          </button>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
        <KPIBlock label="Results" value={students.length} sub={`Page ${page} of student search`} spark={[20, 28, 34, 42, Math.max(students.length, 1)]} />
        <KPIBlock label="Total Students" value={total} sub="Total matching records" accent="var(--info)" spark={[120, 140, 150, 170, Math.max(total, 1)]} />
        <KPIBlock label="Active" value={activeStudents} sub="Visible active students" accent="var(--ok)" spark={[10, 15, 17, 19, Math.max(activeStudents, 1)]} />
        <KPIBlock label="Unassigned" value={unassignedCount} sub="Visible students without routes" accent="var(--warn)" spark={[2, 3, 4, 4, Math.max(unassignedCount, 1)]} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 420px', gap: 16, minHeight: 0 }}>
        <SectionCard title="Student Registry" subtitle={`${total} results across search and status filters`}>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 180px', gap: 12 }}>
              <input
                type="text"
                placeholder="Search by name, roll, or phone"
                value={search}
                onChange={(event) => {
                  setPage(1);
                  setSearch(event.target.value);
                }}
                style={fieldStyle}
              />
              <select
                value={statusFilter}
                onChange={(event) => {
                  setPage(1);
                  setStatusFilter(event.target.value);
                }}
                style={fieldStyle}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="inactive">Deactivated</option>
              </select>
            </div>

            <div className="scroll" style={{ border: '1px solid var(--border)', borderRadius: 16, maxHeight: 'calc(100vh - 520px)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--surface)' }}>
                  <tr>
                    {['Student', 'Details', 'Assignment', 'Status'].map((label) => (
                      <th key={label} style={{ padding: '12px 14px', textAlign: 'left', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid var(--divider)' }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading && students.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: 'var(--muted)' }}>Loading students…</td></tr>
                  ) : students.map((student) => {
                    const active = selectedStudentId === student.id;
                    return (
                      <tr key={student.id} onClick={() => setSelectedStudentId(student.id)} style={{ background: active ? 'var(--surface-2)' : 'transparent', cursor: 'pointer' }}>
                        <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                          <div style={{ fontWeight: 500 }}>{student.name}</div>
                          {student.phone ? <div style={{ marginTop: 2, color: 'var(--muted)' }}>{student.phone}</div> : null}
                        </td>
                        <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                          <div>{student.rollNumber || 'No roll number'}</div>
                          <div style={{ marginTop: 2, color: 'var(--muted)' }}>{student.department || 'No department'} {student.year ? `· Y${student.year}` : ''}</div>
                        </td>
                        <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                          {student.routeId ? (
                            <>
                              <div>{routes.find((route) => route.id === student.routeId)?.name || 'Assigned route'}</div>
                              <div style={{ marginTop: 2, color: 'var(--muted)' }}>{student.busNumber || 'Bus pending'}</div>
                            </>
                          ) : (
                            <span className="muted">Unassigned</span>
                          )}
                        </td>
                        <td style={{ padding: '14px', borderBottom: '1px solid var(--divider)' }}>
                          <StateBadge state={student.isActive ? 'LIVE' : 'OFFLINE'} label={student.isActive ? 'Active' : 'Deactivated'} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <span style={{ color: 'var(--muted)' }}>Showing {students.length} of {total} results</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  style={{ borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', padding: '9px 14px', color: page === 1 ? 'var(--muted-2)' : 'var(--ink)' }}
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!data?.pagination.hasMore}
                  onClick={() => setPage((current) => current + 1)}
                  style={{ borderRadius: 999, border: '1px solid var(--border)', background: 'var(--surface)', padding: '9px 14px', color: data?.pagination.hasMore ? 'var(--ink)' : 'var(--muted-2)' }}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </SectionCard>

        <div style={{ display: 'grid', gap: 16, minHeight: 0 }}>
          <SectionCard title={selectedStudent ? 'Student Detail' : 'Student Detail'} subtitle={selectedStudent ? 'Edit profile and assignment state' : 'Select a student to edit'}>
            {!selectedStudent ? (
              <div style={{ color: 'var(--muted)' }}>Select a student from the table to edit their profile and route assignment.</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Name</span>
                  <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} style={fieldStyle} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Phone</span>
                  <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} style={fieldStyle} />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Roll Number</span>
                    <input value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: event.target.value }))} style={fieldStyle} />
                  </label>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Year</span>
                    <input type="number" min={1} max={6} value={form.year} onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))} style={fieldStyle} />
                  </label>
                </div>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Department</span>
                  <input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} style={fieldStyle} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assigned Route</span>
                  <select value={form.routeId} onChange={(event) => setForm((current) => ({ ...current, routeId: event.target.value, stopId: '' }))} style={fieldStyle}>
                    <option value="">Keep current assignment</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Assigned Stop</span>
                  <select value={form.stopId} onChange={(event) => setForm((current) => ({ ...current, stopId: event.target.value }))} style={fieldStyle} disabled={!form.routeId}>
                    <option value="">{form.routeId ? 'Select stop' : 'Select route first'}</option>
                    {stopOptions.map((routeStop) => (
                      <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
                    ))}
                  </select>
                </label>
                <div style={{ padding: 12, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                  <div className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>AUTH STATUS</div>
                  <div style={{ marginTop: 8 }}>{selectedStudent.authStatus || 'UNKNOWN'}</div>
                </div>
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
                  Save Student
                </button>
              </div>
            )}
          </SectionCard>

          <div style={{ minHeight: 0 }}>
            <UnassignedDrawer />
          </div>
        </div>
      </div>

      {isUploadOpen ? <BulkUploadWizard onClose={() => setIsUploadOpen(false)} /> : null}
    </div>
  );
};

export default StudentList;
