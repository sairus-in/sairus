import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AdminListResponse, AdminRouteSummary, AdminStudentListItem } from 'shared';
import { api } from '../../lib/api.client';
import { extractApiError } from '../../lib/api-error';
import { QueryError } from '../../components/shared/QueryError';
import { StatusBadge } from '../../lib/status';
import { UnassignedDrawer } from './UnassignedDrawer';
import { BulkUploadWizard } from './BulkUploadWizard';
import { Save, UserRound } from 'lucide-react';

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
    <div style={{ display: 'flex', height: '100%', gap: '1rem' }}>
      {pageError && (
        <div style={{ position: 'fixed', top: '5rem', right: '2rem', zIndex: 20, width: 360 }}>
          <QueryError message={extractApiError(pageError).message} onRetry={() => void refetch()} />
        </div>
      )}
      <div style={{ flex: 1, backgroundColor: 'white', display: 'flex', flexDirection: 'column', borderRadius: '8px', overflow: 'hidden', border: '1px solid #E5E7EB' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #E5E7EB', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, flex: 1 }}>Student Management</h1>

          <button
            onClick={() => setIsUploadOpen(true)}
            style={{ padding: '0.5rem 1rem', border: '1px solid #2563EB', borderRadius: '4px', background: '#2563EB', color: 'white', fontWeight: 500, cursor: 'pointer' }}
          >
            Import CSV
          </button>

          <input
            type="text"
            placeholder="Search name, roll..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            style={{ padding: '0.5rem 1rem', border: '1px solid #D1D5DB', borderRadius: '4px', width: '250px' }}
          />

          <select
            value={statusFilter}
            onChange={event => setStatusFilter(event.target.value)}
            style={{ padding: '0.5rem 1rem', border: '1px solid #D1D5DB', borderRadius: '4px' }}
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Deactivated</option>
          </select>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead style={{ position: 'sticky', top: 0, backgroundColor: '#F9FAFB', zIndex: 1 }}>
              <tr>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: '600' }}>Student</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: '600' }}>Details</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: '600' }}>Assignment</th>
                <th style={{ padding: '1rem', borderBottom: '1px solid #E5E7EB', fontWeight: '600' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && students.length === 0 ? (
                <tr><td colSpan={4} style={{ padding: '2rem', textAlign: 'center' }}>Loading...</td></tr>
              ) : students.map((student) => (
                <tr
                  key={student.id}
                  onClick={() => setSelectedStudentId(student.id)}
                  style={{ borderBottom: '1px solid #E5E7EB', cursor: 'pointer', background: selectedStudentId === student.id ? '#EFF6FF' : 'white' }}
                >
                  <td style={{ padding: '1rem' }}>
                    <div style={{ fontWeight: 500 }}>{student.name}</div>
                    {student.phone && <div style={{ fontSize: '0.875rem', color: '#6B7280' }}>{student.phone}</div>}
                  </td>
                  <td style={{ padding: '1rem', fontSize: '0.875rem', color: '#4B5563' }}>
                    <div>{student.rollNumber || '-'}</div>
                    <div>{student.department || 'No department'} {student.year ? `Y${student.year}` : ''}</div>
                  </td>
                  <td style={{ padding: '1rem' }}>
                    {student.routeId ? (
                      <div>
                        {student.busNumber && <span style={{ fontWeight: 600 }}>{student.busNumber}</span>}
                        <div style={{ fontSize: '0.8rem', color: '#64748B' }}>{routes.find((route) => route.id === student.routeId)?.name || 'Assigned route'}</div>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.875rem', color: '#EF4444', fontWeight: 500 }}>Unassigned</span>
                    )}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <StatusBadge status={student.isActive ? 'RESOLVED' : 'OFFLINE'} label={student.isActive ? 'Active' : 'Deactivated'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid #E5E7EB', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F9FAFB' }}>
          <span style={{ fontSize: '0.875rem', color: '#4B5563' }}>
            Showing {students.length} of {total} results
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              disabled={page === 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              style={{ padding: '0.375rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '4px', background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer' }}
            >
              Previous
            </button>
            <button
              disabled={!data?.pagination.hasMore}
              onClick={() => setPage((current) => current + 1)}
              style={{ padding: '0.375rem 0.75rem', border: '1px solid #D1D5DB', borderRadius: '4px', background: 'white', cursor: data?.pagination.hasMore ? 'pointer' : 'not-allowed' }}
            >
              Next
            </button>
          </div>
        </div>
      </div>

      <div style={{ width: '420px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ backgroundColor: 'white', borderRadius: '8px', border: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <UserRound size={18} color="#2563EB" />
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700 }}>Student Detail</div>
              <div style={{ fontSize: '0.8rem', color: '#6B7280' }}>Edit profile and route assignment</div>
            </div>
          </div>

          <div style={{ padding: '1rem 1.25rem', display: 'grid', gap: '0.85rem' }}>
            {!selectedStudent ? (
              <div style={{ color: '#6B7280', fontSize: '0.9rem' }}>Select a student from the table to edit their record.</div>
            ) : (
              <>
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Name</span>
                  <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                </label>

                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Phone</span>
                  <input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <label style={{ display: 'grid', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Roll Number</span>
                    <input value={form.rollNumber} onChange={(event) => setForm((current) => ({ ...current, rollNumber: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                  </label>
                  <label style={{ display: 'grid', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Year</span>
                    <input type="number" min={1} max={6} value={form.year} onChange={(event) => setForm((current) => ({ ...current, year: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                  </label>
                </div>

                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Department</span>
                  <input value={form.department} onChange={(event) => setForm((current) => ({ ...current, department: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} />
                </label>

                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Assigned Route</span>
                  <select value={form.routeId} onChange={(event) => setForm((current) => ({ ...current, routeId: event.target.value, stopId: '' }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }}>
                    <option value="">Keep current assignment</option>
                    {routes.map((route) => (
                      <option key={route.id} value={route.id}>{route.name}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Assigned Stop</span>
                  <select value={form.stopId} onChange={(event) => setForm((current) => ({ ...current, stopId: event.target.value }))} style={{ padding: '0.65rem 0.75rem', borderRadius: '6px', border: '1px solid #D1D5DB' }} disabled={!form.routeId}>
                    <option value="">{form.routeId ? 'Select stop' : 'Select route first'}</option>
                    {stopOptions.map((routeStop) => (
                      <option key={routeStop.stop.id} value={routeStop.stop.id}>{routeStop.stop.name}</option>
                    ))}
                  </select>
                </label>

                <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#F8FAFC', border: '1px solid #E2E8F0', fontSize: '0.82rem', color: '#475569' }}>
                  Auth status: <strong>{selectedStudent.authStatus || 'UNKNOWN'}</strong>
                </div>

                {formError && (
                  <div style={{ padding: '0.8rem', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: '0.85rem' }}>
                    {formError}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending || !form.name.trim() || !form.phone.trim()}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', borderRadius: '8px', background: '#111827', color: 'white', padding: '0.85rem 1rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  <Save size={16} /> Save Student
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, backgroundColor: 'white', borderRadius: '8px', border: '1px solid #E5E7EB', overflow: 'hidden' }}>
          <UnassignedDrawer />
        </div>
      </div>

      {isUploadOpen && <BulkUploadWizard onClose={() => setIsUploadOpen(false)} />}
    </div>
  );
};

export default StudentList;
