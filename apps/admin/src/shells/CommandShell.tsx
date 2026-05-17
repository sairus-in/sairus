import React, { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { AdminCommandEntity } from 'shared';
import { Icon } from '../components/design/Icon';
import { CommandPalette } from '../components/ops/CommandPalette';
import { getDefaultRoute, getModeForPath, getNavItemForPath, getVisibleNavItems, isNavItemActive, ShellMode } from '../config/nav.config';
import { useAdminSocket } from '../hooks/useAdminSocket';
import { useAlerts } from '../hooks/useAlerts';
import { useCommandCenter } from '../hooks/useCommandCenter';
import { QK } from '../lib/query-keys';
import { api } from '../lib/api.client';
import { clearAdminSessionState } from '../lib/session';
import { useAuthStore } from '../store/auth.store';

const ALERT_DOT_COLOR: Record<number, string> = {
  1: 'var(--info)',
  2: 'var(--warn)',
  3: 'var(--err)',
};

const formatRole = (role?: string) =>
  role ? role.toLowerCase().split('_').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ') : 'Admin User';

const FocusOverlay = ({
  entities,
  onClose,
}: {
  entities: AdminCommandEntity[];
  onClose: () => void;
}) => {
  const navigate = useNavigate();
  const urgentEntities = entities.filter((entity) => entity.priority === 'CRITICAL' || entity.priority === 'HIGH').slice(0, 6);

  return (
    <div className="focus-overlay">
      <div className="focus-overlay__main scroll">
        <div style={{ maxWidth: 780 }}>
          <div className="focus-overlay__eyebrow">FOCUS MODE</div>
          <h2 className="focus-overlay__heading" style={{ color: 'var(--ink)', marginTop: 4 }}>
            Command only
          </h2>
          <p style={{ maxWidth: 560, color: 'var(--ink-2)', marginTop: 8 }}>
            This temporary layer strips the app back to urgent operational work. Open the relevant incident or trip directly from the live queue.
          </p>

          <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
            {urgentEntities.length === 0 ? (
              <div style={{ padding: 16, borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', background: 'var(--surface)' }}>
                No urgent entities are active right now.
              </div>
            ) : (
              urgentEntities.map((entity) => {
                const target = entity.context.tripId ? `/ops/trips/${entity.context.tripId}` : '/ops/incidents';
                return (
                  <button
                    key={entity.id}
                    type="button"
                    onClick={() => {
                      navigate(target);
                      onClose();
                    }}
                    style={{
                      display: 'grid',
                      gap: 8,
                      textAlign: 'left',
                      border: '1px solid var(--border-2)',
                      borderRadius: 16,
                      background: 'var(--surface)',
                      padding: 18,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <span className={`pill ${entity.priority === 'CRITICAL' ? 'pill--err' : 'pill--warn'}`}>{entity.priority}</span>
                      <span className="mono muted">{entity.ageMinutes ? `${entity.ageMinutes}m` : 'now'}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 500 }}>{entity.title}</div>
                    <div style={{ color: 'var(--ink-2)' }}>{entity.summary}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {entity.badges.slice(0, 4).map((badge) => (
                        <span key={badge} className="pill pill--idle">
                          {badge}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </div>

      <aside className="focus-overlay__side">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div className="focus-overlay__eyebrow">QUICK EXIT</div>
            <h3 className="focus-overlay__heading">Back to full console</h3>
          </div>
          <button type="button" className="focus-overlay__exit" onClick={onClose}>
            Exit (Esc)
          </button>
        </div>

        <div className="focus-overlay__panel">
          <div className="focus-overlay__eyebrow" style={{ marginBottom: 10 }}>
            PRIORITY NOW
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            {urgentEntities.slice(0, 3).map((entity) => (
              <div key={entity.id} style={{ paddingBottom: 10, borderBottom: '1px solid #2a2a2d' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                  <span className="mono">{entity.busNumber ?? entity.routeName ?? entity.kind}</span>
                  <span className="mono">{entity.ageMinutes ? `${entity.ageMinutes}m` : 'now'}</span>
                </div>
                <div style={{ color: '#ddd' }}>{entity.title}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="focus-overlay__panel" style={{ flex: 1 }}>
          <div className="focus-overlay__eyebrow" style={{ marginBottom: 10 }}>
            SHORTCUTS
          </div>
          <div style={{ display: 'grid', gap: 8, color: '#bbb' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Command palette</span>
              <span className="mono">Ctrl/Cmd K</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Focus toggle</span>
              <span className="mono">Ctrl/Cmd F</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Incidents</span>
              <span className="mono">Ctrl/Cmd 4</span>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

export const CommandShell: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, capabilities } = useAuthStore();
  const canSeeLiveShellData = Boolean(
    capabilities?.canViewCommandCenter
      || capabilities?.canViewDashboard
      || capabilities?.canViewFleetMap
      || capabilities?.canViewTripDetail
      || capabilities?.canViewIncidents
      || capabilities?.canReviewGPSOutage
      || capabilities?.canViewMessages
      || capabilities?.canViewAuditLog,
  );
  const { data: alerts = [] } = useAlerts(canSeeLiveShellData);
  const { data: commandCenter } = useCommandCenter(canSeeLiveShellData);
  const [mode, setMode] = useState<ShellMode>(() => getModeForPath(location.pathname));
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [focusOpen, setFocusOpen] = useState(false);

  useAdminSocket();

  useEffect(() => {
    setMode(getModeForPath(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setFocusOpen((current) => !current);
      }

      if ((event.metaKey || event.ctrlKey) && ['1', '2', '3', '4'].includes(event.key)) {
        const shortcuts = ['dashboard', 'map', 'trips', 'incidents'] as const;
        const id = shortcuts[Number(event.key) - 1];
        const item = getVisibleNavItems('live', capabilities).find((navItem) => navItem.id === id);
        if (item?.to) {
          event.preventDefault();
          navigate(item.to);
        }
      }

      if (event.key === 'Escape') {
        setFocusOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [capabilities, navigate]);

  const navItems = useMemo(() => getVisibleNavItems(mode, capabilities), [capabilities, mode]);
  const activeItem = useMemo(() => getNavItemForPath(location.pathname), [location.pathname]);

  const activeIncidents = commandCenter?.stats.unresolvedIncidents ?? 0;
  const gpsOffline = commandCenter?.stats.gpsOffline ?? 0;
  const driverIssues = alerts.filter((alert) => alert.type === 'NO_DRIVER_ALERT').length;
  const unreadAlerts = alerts.filter((alert) => alert.priority >= 2).length;
  const lastSyncLabel = commandCenter?.generatedAt
    ? `${formatDistanceToNowStrict(new Date(commandCenter.generatedAt), { addSuffix: true })}`
    : 'pending';
  const visibleAlerts = alerts.slice(0, 8);

  const primaryCrumb = mode === 'live' ? 'Fleet Operations' : 'Data Admin';
  const secondaryCrumb = activeItem?.id === 'dashboard'
    ? 'College Transport · Chennai'
    : activeItem?.label ?? (mode === 'live' ? 'Console' : 'Workspace');
  const initials = user?.name
    ?.split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') ?? 'AD';

  const handleLogout = async () => {
    if (isLoggingOut) {
      return;
    }

    setIsLoggingOut(true);
    try {
      await api.postNoContent('/v1/admin/auth/logout');
    } catch {
      // Local teardown still needs to complete if the remote session is already gone.
    } finally {
      clearAdminSessionState();
      navigate('/login', { replace: true });
      setIsLoggingOut(false);
    }
  };

  const openCommandPalette = () => {
    window.dispatchEvent(new Event('admin-command-palette:open'));
  };

  const switchMode = (nextMode: ShellMode) => {
    setMode(nextMode);
    const nextRoute = getDefaultRoute(capabilities, nextMode === 'live' ? 'live-ops' : 'data-console');
    navigate(nextRoute);
  };

  const refreshShellData = () => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: QK.commandCenter() }),
      queryClient.invalidateQueries({ queryKey: QK.dashboard() }),
      queryClient.invalidateQueries({ queryKey: QK.activeTrips() }),
      queryClient.invalidateQueries({ queryKey: QK.alerts() }),
      queryClient.invalidateQueries({ queryKey: QK.gpsOutages() }),
      queryClient.invalidateQueries({ queryKey: QK.incidents() }),
      queryClient.invalidateQueries({ queryKey: QK.messages() }),
    ]);
  };

  return (
    <>
      <div className="command-shell">
        <button
          type="button"
          className="command-shell__logo"
          style={{ cursor: 'pointer', border: 0, width: '100%', height: '100%' }}
          title="Go home"
          onClick={() => navigate(getDefaultRoute(capabilities, mode === 'live' ? 'live-ops' : 'data-console'))}
        >
          F
        </button>

        <div className={`statusbar ${activeIncidents > 0 ? 'is-alerting' : ''}`}>
          <div className="statusbar__group">
            <button
              type="button"
              className="statusbar__item statusbar__item--btn"
              onClick={() => navigate('/ops/incidents')}
              title={`${activeIncidents} active incident${activeIncidents !== 1 ? 's' : ''} — click to view`}
            >
              <span className="statusbar__dot is-pulse" style={{ background: 'var(--err)' }} />
              <span className="mono">{activeIncidents}</span>
              <span>Active Incidents</span>
            </button>
            <button
              type="button"
              className="statusbar__item statusbar__item--btn"
              onClick={() => navigate('/ops/outages')}
              title={`${gpsOffline} GPS outage${gpsOffline !== 1 ? 's' : ''} — click to view`}
            >
              <span className="statusbar__dot" style={{ background: 'var(--warn)' }} />
              <span className="mono">{gpsOffline}</span>
              <span>GPS Outages</span>
            </button>
            <button
              type="button"
              className="statusbar__item statusbar__item--btn"
              onClick={() => navigate('/ops/fleet')}
              title={`${driverIssues} unconfirmed driver assignment${driverIssues !== 1 ? 's' : ''} — click to view fleet`}
            >
              <span className="statusbar__dot" style={{ background: 'var(--info)' }} />
              <span className="mono">{driverIssues}</span>
              <span>Unconfirmed Driver</span>
            </button>
          </div>
          <div className="statusbar__meta">
            <button
              type="button"
              className="statusbar__item statusbar__item--btn"
              onClick={refreshShellData}
              title="Click to refresh all live data"
            >
              Last sync <span className="mono" style={{ marginLeft: 4 }}>{lastSyncLabel}</span>
            </button>
            <span>
              {user?.name ?? 'Admin'} · <span className="mono">{formatRole(user?.role)}</span>
            </span>
          </div>
        </div>

        <nav className="navrail" aria-label={`${mode} navigation`}>
          {navItems.map((item) => (
            <React.Fragment key={item.id}>
              {item.separatorBefore ? <div className="navrail__separator" /> : null}
              <button
                type="button"
                className={`navrail__item ${isNavItemActive(item, location.pathname) ? 'is-active' : ''}`}
                aria-label={item.label}
                onClick={() => {
                  if (item.action === 'focus') {
                    setFocusOpen(true);
                    return;
                  }

                  if (item.id === 'fleet' && capabilities?.canManageDrivers && !capabilities.canManageBuses) {
                    navigate('/drivers');
                    return;
                  }

                  if (item.to) {
                    navigate(item.to);
                  }
                }}
              >
                <Icon name={item.icon} size={16} />
                <span className="navrail__tip">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
          <div className="navrail__spacer" />
        </nav>

        <header className="topbar">
          <div className="topbar__breadcrumb">
            <button
              type="button"
              className="topbar__crumb"
              style={{ border: 0, background: 'transparent', padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', color: 'inherit' }}
              onClick={() => navigate(getDefaultRoute(capabilities, mode === 'live' ? 'live-ops' : 'data-console'))}
            >
              {primaryCrumb}
            </button>
            <span className="topbar__sep">/</span>
            <span className="topbar__crumb is-muted">{secondaryCrumb}</span>
          </div>

          <div className="topbar__center">
            <button type="button" className="searchbar is-interactive" onClick={openCommandPalette}>
              <Icon name="search" size={13} />
              <span className="searchbar__input">Search trips, buses, drivers...</span>
              <span className="searchbar__kbd">Ctrl K</span>
            </button>
          </div>

          <div className="topbar__actions">
            <div className="mode-toggle" role="tablist" aria-label="Admin mode">
              <button
                type="button"
                className={`mode-toggle__button ${mode === 'live' ? 'is-active' : ''}`}
                onClick={() => switchMode('live')}
              >
                Live Ops
              </button>
              <button
                type="button"
                className={`mode-toggle__button ${mode === 'admin' ? 'is-active' : ''}`}
                onClick={() => switchMode('admin')}
              >
                Data Admin
              </button>
            </div>

            <button type="button" className="icon-btn" aria-label="Refresh admin data" onClick={refreshShellData}>
              <Icon name="refresh" size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label="Open alerts" onClick={() => navigate('/ops/incidents')}>
              <Icon name="bell" size={15} />
              {unreadAlerts > 0 ? <span className="icon-btn__badge" /> : null}
            </button>
            <button
              type="button"
              className="avatar is-button"
              aria-label={isLoggingOut ? 'Signing out' : 'Sign out'}
              title={`${user?.name ?? 'Admin session'} (${formatRole(user?.role)})`}
              onClick={() => void handleLogout()}
            >
              {initials}
            </button>
          </div>
        </header>

        <div className="main">
          <main className={`main__content scroll ${activeItem?.id === 'dashboard' ? '' : 'is-full-bleed'}`}>
            <div className={activeItem?.id === 'dashboard' ? 'dashboard-frame' : ''}>
              <Outlet />
            </div>
          </main>

          {activeItem?.id === 'dashboard' ? (
            <aside className="right-rail">
              <section className="live-events">
                <div className="live-events__head">
                  <h3 className="live-events__title">Live Events</h3>
                  <div className="live-events__status">
                    <span className="live-events__status-dot" />
                    <span>Streaming</span>
                  </div>
                </div>

                <div className="live-events__list scroll">
                  {visibleAlerts.length === 0 ? (
                    <div style={{ padding: '18px 20px', color: 'var(--muted)' }}>No live alerts yet.</div>
                  ) : (
                    visibleAlerts.map((alert, index) => (
                      <button
                        key={`${alert.timestamp}-${index}`}
                        type="button"
                        className="live-events__item"
                        onClick={() => navigate(alert.tripId ? `/ops/trips/${alert.tripId}` : '/ops/incidents')}
                      >
                        <span className="live-events__time">{format(new Date(alert.timestamp), 'HH:mm:ss')}</span>
                        <span className="live-events__summary">{alert.summary}</span>
                        <span className="live-events__link">View →</span>
                        <span
                          className="live-events__dot"
                          style={{ background: ALERT_DOT_COLOR[Math.min(alert.priority, 3)] ?? 'var(--idle)' }}
                        />
                      </button>
                    ))
                  )}
                </div>
              </section>
            </aside>
          ) : null}
        </div>
      </div>

      <CommandPalette />
      {focusOpen ? <FocusOverlay entities={commandCenter?.entities ?? []} onClose={() => setFocusOpen(false)} /> : null}
    </>
  );
};

export default CommandShell;
