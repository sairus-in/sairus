import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Activity, MessageSquare, AlertCircle, AlertTriangle, Map as MapIcon, ChevronRight, User, LogOut, Shield } from 'lucide-react';
import { useAdminSocket } from '../hooks/useAdminSocket';
import { AlertDropdown } from '../components/ops/AlertDropdown';
import { OpsEventRail } from '../components/ops/OpsEventRail';
import { useAuthStore } from '../store/auth.store';
import { api } from '../lib/api.client';
import { clearAdminSessionState } from '../lib/session';

export const LiveOpsShell: React.FC = () => {
  const navigate = useNavigate();
  const { user, capabilities } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useAdminSocket();

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await api.post('/v1/admin/auth/logout');
    } catch {
      // If the server session is already gone, local cleanup should still complete.
    } finally {
      clearAdminSessionState();
      navigate('/login', { replace: true });
      setIsLoggingOut(false);
    }
  };

  const roleLabel = user?.role
    ? user.role.toLowerCase().split('_').map((part: string) => part[0].toUpperCase() + part.slice(1)).join(' ')
    : 'Admin User';

  const navItems = [
    { to: '/ops/dashboard', label: 'Dashboard', icon: <Activity size={20} />, cap: 'canViewDashboard' as const },
    { to: '/ops/fleet', label: 'Fleet Map', icon: <MapIcon size={20} />, cap: 'canViewFleetMap' as const },
    { to: '/ops/messages', label: 'Active Comm Threads', icon: <MessageSquare size={20} />, cap: 'canViewMessages' as const },
    { to: '/ops/incidents', label: 'Critical Incidents', icon: <AlertCircle size={20} />, cap: 'canViewIncidents' as const },
    { to: '/ops/outages', label: 'GPS Outages', icon: <AlertTriangle size={20} />, cap: 'canReviewGPSOutage' as const },
    { to: '/ops/audit-log', label: 'Audit Log', icon: <Shield size={20} />, cap: 'canViewAuditLog' as const },
  ].filter((item) => capabilities?.[item.cap]);

  return (
    <div style={{ display: 'flex', height: '100vh', backgroundColor: '#111827', color: 'white' }}>
      
      {/* 1. Sidebar Navigation */}
      <div style={{ width: '280px', borderRight: '1px solid #374151', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #374151' }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0, letterSpacing: '-0.025em' }}>
            Live Operations
          </h2>
          <div style={{ color: '#10B981', fontSize: '0.75rem', marginTop: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#10B981', display: 'inline-block' }}></span>
            System Online
          </div>
        </div>
        
        <nav style={{ flex: 1, padding: '1rem' }}>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  borderRadius: '0.5rem',
                  textDecoration: 'none',
                  color: isActive ? 'white' : '#9CA3AF',
                  backgroundColor: isActive ? '#1F2937' : 'transparent',
                  fontWeight: isActive ? '600' : '400',
                })}>
                  {item.icon} {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        
        {/* Quick Shell Switcher */}
        <div style={{ padding: '1rem', borderTop: '1px solid #374151' }}>
          <NavLink to="/corrections" style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '0.75rem', backgroundColor: '#1F2937', borderRadius: '0.5rem',
            color: '#D1D5DB', textDecoration: 'none', fontSize: '0.875rem'
          }}>
            <span>Switch to <strong>Data Admin</strong></span>
            <ChevronRight size={16} />
          </NavLink>
        </div>
      </div>

      {/* 2. Main Work Area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        
        {/* Top Navigation / Header */}
        <header style={{ 
          height: '4rem', 
          borderBottom: '1px solid #374151', 
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center', 
          padding: '0 2rem',
          backgroundColor: '#111827'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '0.85rem', letterSpacing: '0.04em', textTransform: 'uppercase', fontWeight: 700 }}>
            Control room
          </div>

          <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
            <AlertDropdown />
            
            <div style={{ width: '1px', height: '24px', backgroundColor: '#374151' }}></div>

            {capabilities?.canViewSecuritySettings && (
              <NavLink
                to="/security"
                style={({ isActive }) => ({
                  color: isActive ? '#FFFFFF' : '#93C5FD',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                })}
              >
                Security
              </NavLink>
            )}
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', color: '#E5E7EB' }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.875rem', fontWeight: '500' }}>{user?.name || 'Admin session'}</div>
                <div style={{ fontSize: '0.75rem', color: '#9CA3AF' }}>{roleLabel}</div>
              </div>
              <div style={{ width: '36px', height: '36px', borderRadius: '50%', backgroundColor: '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <User size={18} color="#9CA3AF" />
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              style={{
                border: '1px solid #334155',
                borderRadius: '999px',
                background: 'transparent',
                color: isLoggingOut ? '#64748B' : '#E2E8F0',
                padding: '0.55rem 0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.45rem',
                cursor: isLoggingOut ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              <LogOut size={15} />
              {isLoggingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
          <Outlet />
        </div>
      </div>
      
      {/* 3. Right Rail (Ops Events) */}
      <OpsEventRail />
      
    </div>
  );
};
