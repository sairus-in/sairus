import { describe, expect, it } from 'vitest';
import { AdminAccessContext, canAdmin } from './policy';

const transportOfficer: AdminAccessContext = {
  role: 'TRANSPORT_OFFICER',
  scope: {
    routeIds: [],
    departmentIds: [],
  },
};

const coordinator: AdminAccessContext = {
  role: 'COORDINATOR',
  scope: {
    routeIds: ['route_alpha', 'route_beta'],
    departmentIds: [],
  },
};

const management: AdminAccessContext = {
  role: 'MANAGEMENT',
  scope: {
    routeIds: [],
    departmentIds: [],
  },
};

const faculty: AdminAccessContext = {
  role: 'FACULTY',
  scope: {
    routeIds: [],
    departmentIds: ['CSE'],
  },
};

const coordinatorBlockedActions = [
  'BULK_IMPORT_STUDENTS',
  'MANAGE_ROUTES',
  'MANAGE_BUSES',
  'MANAGE_DRIVERS',
  'INVITE_ADMIN',
  'VIEW_IMPORT_SESSIONS',
  'RETRY_IMPORT_ROWS',
  'VIEW_PENDING_AUTH',
] as const;

const managementBlockedActions = [
  'SEND_MESSAGE_TO_DRIVER',
  'ASSIGN_SUBSTITUTE',
  'RESOLVE_INCIDENTS',
  'COORDINATOR_OVERRIDE',
] as const;

describe('admin policy', () => {
  it('allows a transport officer to perform operational actions', () => {
    expect(canAdmin(transportOfficer, 'ASSIGN_SUBSTITUTE', { routeId: 'any_route' })).toBe(true);
  });

  it('denies management operational mutations', () => {
    expect(canAdmin(management, 'SEND_MESSAGE_TO_DRIVER')).toBe(false);
    expect(canAdmin(management, 'ASSIGN_SUBSTITUTE')).toBe(false);
  });

  it('allows management non-scoped admin operations that remain intentionally shared', () => {
    expect(canAdmin(management, 'VIEW_IMPORT_SESSIONS')).toBe(true);
    expect(canAdmin(management, 'VIEW_PENDING_AUTH')).toBe(true);
    expect(canAdmin(management, 'BULK_IMPORT_STUDENTS')).toBe(true);
  });

  it('allows a coordinator to act within an assigned route', () => {
    expect(canAdmin(coordinator, 'VIEW_TRIP_DETAIL', { routeId: 'route_alpha' })).toBe(true);
    expect(canAdmin(coordinator, 'RESOLVE_INCIDENTS', { routeId: 'route_beta' })).toBe(true);
  });

  it('denies a coordinator outside their route scope', () => {
    expect(canAdmin(coordinator, 'VIEW_TRIP_DETAIL', { routeId: 'route_gamma' })).toBe(false);
    expect(canAdmin(coordinator, 'SEND_MESSAGE_TO_DRIVER', { routeId: 'route_gamma' })).toBe(false);
  });

  it('keeps coordinator non-route actions available when explicitly allowed', () => {
    expect(canAdmin(coordinator, 'VIEW_SECURITY_SETTINGS')).toBe(true);
  });

  it('enforces faculty department scope', () => {
    expect(canAdmin(faculty, 'VIEW_DEFAULTERS', { departmentId: 'CSE' })).toBe(true);
    expect(canAdmin(faculty, 'VIEW_DEFAULTERS', { departmentId: 'ECE' })).toBe(false);
  });

  for (const action of coordinatorBlockedActions) {
    it(`denies a coordinator from admin-only action ${action}`, () => {
      expect(canAdmin(coordinator, action)).toBe(false);
    });
  }

  for (const action of managementBlockedActions) {
    it(`denies management from operational action ${action}`, () => {
      expect(canAdmin(management, action, { routeId: 'route_alpha' })).toBe(false);
    });
  }
});
