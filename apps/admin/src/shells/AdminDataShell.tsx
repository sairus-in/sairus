import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { Database, LogOut, Shield, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.client';
import { clearAdminSessionState } from '../lib/session';
import { useAuthStore } from '../store/auth.store';
import { getNavigationItems } from '../config/routing.config';

const formatRole = (role?: string) =>
  role ? role.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') : 'Admin User';

export const AdminDataShell: React.FC = () => {
  const navigate = useNavigate();
  const { user, capabilities } = useAuthStore();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Get filtered navigation items based on user capabilities
  const navItems = getNavigationItems('data-console', capabilities);

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await api.post('/v1/admin/auth/logout');
    } catch {
      // If the server session is already invalid, local teardown still needs to happen.
    } finally {
      clearAdminSessionState();
      navigate('/login', { replace: true });
      setIsLoggingOut(false);
    }
  };

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'linear-gradient(180deg, #F8FAFC 0%, #EEF2FF 100%)', color: '#0F172A' }}>
      <nav style={{ width: 260, borderRight: '1px solid #E2E8F0', background: 'rgba(255,255,255,0.92)', backdropFilter: 'blur(14px)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1.5rem', borderBottom: '1px solid #E2E8F0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ width: 42, height: 42, borderRadius: 14, background: '#0F172A', color: '#F8FAFC', display: 'grid', placeItems: 'center' }}>
              <Database size={20} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#475569', fontWeight: 700 }}>Data Console</div>
              <h2 style={{ margin: '0.15rem 0 0', fontSize: '1.2rem' }}>Transport Admin</h2>
            </div>
          </div>
        </div>

        <div style={{ padding: '1rem', display: 'grid', gap: '0.5rem' }}>
          {navItems.length > 0 ? (
            navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                style={({ isActive }) => ({
                  textDecoration: 'none',
                  padding: '0.85rem 1rem',
                  borderRadius: 14,
                  color: isActive ? '#F8FAFC' : '#1E293B',
                  background: isActive ? '#0F172A' : 'transparent',
                  fontWeight: 600,
                  transition: 'all 0.2s ease-in-out',
                  cursor: 'pointer',
                  border: 'none',
                })}
              >
                {item.label}
              </NavLink>
            ))
          ) : (
            <div style={{ padding: '1rem', textAlign: 'center', color: '#64748B', fontSize: '0.875rem' }}>
              No accessible sections
            </div>
          )}
        </div>

        <div style={{ marginTop: 'auto', padding: '1rem', borderTop: '1px solid #E2E8F0', display: 'grid', gap: '0.75rem' }}>
          <NavLink
            to="/ops/dashboard"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '0.85rem 1rem',
              borderRadius: 14,
              background: '#E2E8F0',
              color: '#0F172A',
              textDecoration: 'none',
              fontWeight: 600,
            }}
          >
            <span>Switch to Live Ops</span>
            <ChevronRight size={16} />
          </NavLink>

          <div style={{ borderRadius: 18, background: '#FFFFFF', border: '1px solid #E2E8F0', padding: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <div style={{ width: 40, height: 40, borderRadius: 14, background: '#DBEAFE', color: '#1D4ED8', display: 'grid', placeItems: 'center' }}>
                <Shield size={18} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.95rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.name || 'Admin session'}
                </div>
                <div style={{ color: '#475569', fontSize: '0.82rem' }}>{formatRole(user?.role)}</div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleLogout}
              disabled={isLoggingOut}
              style={{
                marginTop: '0.9rem',
                width: '100%',
                border: 0,
                borderRadius: 12,
                background: isLoggingOut ? '#CBD5E1' : '#0F172A',
                color: '#F8FAFC',
                padding: '0.8rem 1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
                fontWeight: 700,
                cursor: isLoggingOut ? 'not-allowed' : 'pointer',
              }}
            >
              <LogOut size={16} />
              {isLoggingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </nav>

      <main style={{ flex: 1, padding: '2.25rem', overflow: 'auto' }}>
        <Outlet />
      </main>
    </div>
  );
};
