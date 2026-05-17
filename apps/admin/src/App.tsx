import React, { Suspense, lazy, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AdminSessionUser } from 'shared';
import { RequireCapability } from './components/shared/RequireCapability';
import { useAuthStore } from './store/auth.store';
import { queryClient } from './lib/query-client';
import { api } from './lib/api.client';
import { isAuthError } from './lib/api-error';
import { getDefaultRoute } from './config/nav.config';

const CommandShell = lazy(() => import('./shells/CommandShell').then((module) => ({ default: module.CommandShell })));
const Dashboard = lazy(() => import('./pages/ops/Dashboard').then((module) => ({ default: module.Dashboard })));
const FleetMap = lazy(() => import('./pages/ops/FleetMap').then((module) => ({ default: module.FleetMap })));
const TripDetail = lazy(() => import('./pages/ops/TripDetail').then((module) => ({ default: module.TripDetail })));
const TripsList = lazy(() => import('./pages/ops/TripsList').then((module) => ({ default: module.TripsList })));
const AttendanceReports = lazy(() => import('./pages/data/AttendanceReports').then((module) => ({ default: module.AttendanceReports })));
const Incidents = lazy(() => import('./pages/ops/Incidents').then((module) => ({ default: module.Incidents })));
const Messages = lazy(() => import('./pages/ops/Messages').then((module) => ({ default: module.Messages })));
const Corrections = lazy(() => import('./pages/corrections').then((module) => ({ default: module.Corrections })));
const StudentList = lazy(() => import('./pages/students/StudentList').then((module) => ({ default: module.StudentList })));
const RouteEditor = lazy(() => import('./pages/routes/RouteEditor').then((module) => ({ default: module.RouteEditor })));
const BusList = lazy(() => import('./pages/fleet/BusList').then((module) => ({ default: module.BusList })));
const DriverList = lazy(() => import('./pages/fleet/DriverList').then((module) => ({ default: module.DriverList })));
const OperationsCenter = lazy(() => import('./pages/ops/OperationsCenter').then((module) => ({ default: module.OperationsCenter })));
const GPSOutageQueue = lazy(() => import('./pages/ops/GPSOutageQueue').then((module) => ({ default: module.GPSOutageQueue })));
const AuditLog = lazy(() => import('./pages/ops/AuditLog').then((module) => ({ default: module.AuditLog })));
const Login = lazy(() => import('./pages/auth/Login').then((module) => ({ default: module.Login })));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword').then((module) => ({ default: module.ForgotPassword })));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword').then((module) => ({ default: module.ResetPassword })));
const AcceptInvite = lazy(() => import('./pages/auth/AcceptInvite').then((module) => ({ default: module.AcceptInvite })));
const Security = lazy(() => import('./pages/auth/Security').then((module) => ({ default: module.Security })));
const AdminUsers = lazy(() => import('./pages/auth/AdminUsers').then((module) => ({ default: module.AdminUsers })));

const RouteFallback = () => (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F8FAFC', color: '#334155' }}>
    Loading admin workspace...
  </div>
);

const AuthBootstrap = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated, login, logout } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      if (isAuthenticated) {
        if (!cancelled) setReady(true);
        return;
      }

      try {
        const admin = await api.get<AdminSessionUser>('/v1/admin/auth/me');
        if (!cancelled) {
          login(admin);
          setDegraded(false);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }

        if (isAuthError(err)) {
          logout();
        } else {
          setDegraded(true);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    };

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, login, logout, retryToken]);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F8FAFC', color: '#334155' }}>
        Loading admin session...
      </div>
    );
  }

  return (
    <>
      {degraded && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          background: '#92400E',
          color: '#FEF3C7',
          padding: '0.6rem 1rem',
          fontSize: '0.875rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <span>Warning: Having trouble reaching the server. Your session is intact and retrying is safe.</span>
          <button
            type="button"
            onClick={() => {
              setDegraded(false);
              setReady(false);
              setRetryToken((current) => current + 1);
            }}
            style={{ background: 'transparent', border: '1px solid #FEF3C7', color: '#FEF3C7', borderRadius: 6, padding: '0.2rem 0.6rem', cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}
      {children}
    </>
  );
};

const RequireAdminSession = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { isAuthenticated, capabilities } = useAuthStore();
  const defaultLiveOpsRoute = '/ops/dashboard';
  const defaultDataConsoleRoute = getDefaultRoute(capabilities, 'data-console');

  return (
    <>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/accept-invite" element={<AcceptInvite />} />

          <Route element={
            <RequireAdminSession>
              <CommandShell />
            </RequireAdminSession>
          }>
            <Route path="/" element={<Navigate to={defaultDataConsoleRoute} replace />} />
            <Route path="/ops" element={<Navigate to={defaultLiveOpsRoute} replace />} />
            <Route path="/ops/dashboard" element={
              <RequireCapability capability="canViewDashboard">
                <Dashboard />
              </RequireCapability>
            } />
            <Route path="/ops/fleet" element={
              <RequireCapability capability="canViewFleetMap">
                <FleetMap />
              </RequireCapability>
            } />
            <Route path="/ops/trips" element={
              <RequireCapability capability="canViewTripDetail">
                <TripsList />
              </RequireCapability>
            } />
            <Route path="/ops/trips/:id" element={
              <RequireCapability capability="canViewTripDetail">
                <TripDetail />
              </RequireCapability>
            } />
            <Route path="/ops/incidents" element={
              <RequireCapability capability="canViewIncidents">
                <Incidents />
              </RequireCapability>
            } />
            <Route path="/ops/messages" element={
              <RequireCapability capability="canViewMessages">
                <Messages />
              </RequireCapability>
            } />
            <Route path="/ops/operations" element={
              <RequireCapability capability="canViewImportSessions">
                <OperationsCenter />
              </RequireCapability>
            } />
            <Route path="/ops/outages" element={
              <RequireCapability capability="canReviewGPSOutage">
                <GPSOutageQueue />
              </RequireCapability>
            } />
            <Route path="/ops/audit-log" element={
              <RequireCapability capability="canViewAuditLog">
                <AuditLog />
              </RequireCapability>
            } />
            <Route path="/corrections" element={
              <RequireCapability capability="canReviewCorrections">
                <Corrections />
              </RequireCapability>
            } />
            <Route path="/attendance" element={
              <RequireCapability capability="canViewAttendanceReports">
                <AttendanceReports />
              </RequireCapability>
            } />
            <Route path="/students" element={
              <RequireCapability capability="canManageStudents">
                <StudentList />
              </RequireCapability>
            } />
            <Route path="/routes" element={
              <RequireCapability capability="canManageRoutes">
                <RouteEditor />
              </RequireCapability>
            } />
            <Route path="/buses" element={
              <RequireCapability capability="canManageBuses">
                <BusList />
              </RequireCapability>
            } />
            <Route path="/drivers" element={
              <RequireCapability capability="canManageDrivers">
                <DriverList />
              </RequireCapability>
            } />
            <Route path="/security" element={
              <RequireCapability capability="canViewSecuritySettings">
                <Security />
              </RequireCapability>
            } />
            <Route path="/admin-users" element={
              <RequireCapability capability="canInviteAdmin">
                <AdminUsers />
              </RequireCapability>
            } />
            <Route path="/ops/*" element={<Navigate to={defaultLiveOpsRoute} replace />} />
            <Route path="*" element={<Navigate to={defaultDataConsoleRoute} replace />} />
          </Route>

          <Route path="*" element={<Navigate to={isAuthenticated ? defaultDataConsoleRoute : '/login'} replace />} />
        </Routes>
      </Suspense>
    </>
  );
};

export const App: React.FC = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthBootstrap>
          <AppRoutes />
        </AuthBootstrap>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
