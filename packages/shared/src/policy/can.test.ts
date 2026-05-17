import { describe, expect, it } from 'vitest';
import { can, policy } from './can';
import { capabilitiesForAdminRole, capabilitiesForMobileRole } from './matrix';
import type { Actor } from '../auth/actor';
import { emptyScope } from '../auth/actor';
import type { Capability } from '../auth/capabilities';

const makeAdmin = (
  role: 'TRANSPORT_OFFICER' | 'COORDINATOR' | 'MANAGEMENT' | 'FACULTY',
  scope: Partial<{ routeIds: string[]; departmentIds: string[] }> = {},
): Actor => ({
  actorId: 'admin-1',
  actorType: 'admin',
  capabilities: capabilitiesForAdminRole(role),
  scope: {
    ...emptyScope(),
    routeIds: scope.routeIds ?? [],
    departmentIds: scope.departmentIds ?? [],
  },
  sessionContext: { requestId: 'req-1' },
});

const makeStudent = (id = 'student-1'): Actor => ({
  actorId: id,
  actorType: 'mobile_student',
  capabilities: capabilitiesForMobileRole('STUDENT'),
  scope: emptyScope(),
  sessionContext: { requestId: 'req-1' },
});

const makeDriver = (id = 'driver-1'): Actor => ({
  actorId: id,
  actorType: 'mobile_driver',
  capabilities: capabilitiesForMobileRole('DRIVER'),
  scope: emptyScope(),
  sessionContext: { requestId: 'req-1' },
});

describe('policy.can — capability holding', () => {
  it('denies when the actor lacks the capability', () => {
    const faculty = makeAdmin('FACULTY', { departmentIds: ['CSE'] });
    const decision = can(faculty, 'admin.student.manage');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('missing_capability');
  });

  it('allows when the actor has the capability and no scope rules apply', () => {
    const officer = makeAdmin('TRANSPORT_OFFICER');
    const decision = can(officer, 'admin.dashboard.view');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('ok');
  });

  it('includes capability and actor id in every decision auditPayload', () => {
    const officer = makeAdmin('TRANSPORT_OFFICER');
    const decision = can(officer, 'admin.dashboard.view');
    expect(decision.auditPayload).toMatchObject({
      actorId: 'admin-1',
      actorType: 'admin',
      capability: 'admin.dashboard.view',
    });
  });
});

describe('policy.can — admin route scope', () => {
  it('allows a coordinator within their assigned route', () => {
    const coord = makeAdmin('COORDINATOR', { routeIds: ['route_alpha'] });
    expect(can(coord, 'admin.trip.view', { routeId: 'route_alpha' }).allowed).toBe(true);
  });

  it('denies a coordinator outside their assigned route', () => {
    const coord = makeAdmin('COORDINATOR', { routeIds: ['route_alpha'] });
    const decision = can(coord, 'admin.trip.view', { routeId: 'route_beta' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('out_of_scope');
    expect(decision.auditPayload.scopeMatch).toBe('route');
  });

  it('ignores route scope for unscoped admins (empty routeIds)', () => {
    const officer = makeAdmin('TRANSPORT_OFFICER');
    expect(can(officer, 'admin.trip.view', { routeId: 'route_alpha' }).allowed).toBe(true);
  });

  it('skips route scope check for capabilities outside ROUTE_SCOPED set', () => {
    // admin.security.view is NOT route-scoped — passing routeId should not deny.
    const coord = makeAdmin('COORDINATOR', { routeIds: ['route_alpha'] });
    expect(can(coord, 'admin.security.view', { routeId: 'route_gamma' }).allowed).toBe(true);
  });
});

describe('policy.can — admin department scope', () => {
  it('allows faculty within their department', () => {
    const faculty = makeAdmin('FACULTY', { departmentIds: ['CSE'] });
    expect(can(faculty, 'admin.defaulter.view', { departmentId: 'CSE' }).allowed).toBe(true);
  });

  it('denies faculty outside their department', () => {
    const faculty = makeAdmin('FACULTY', { departmentIds: ['CSE'] });
    const decision = can(faculty, 'admin.defaulter.view', { departmentId: 'ECE' });
    expect(decision.allowed).toBe(false);
    expect(decision.auditPayload.scopeMatch).toBe('department');
  });
});

describe('policy.can — mobile student scope-self', () => {
  it('allows a student acting on their own resource', () => {
    const student = makeStudent('student-1');
    expect(can(student, 'student.history.view', { ownerId: 'student-1' }).allowed).toBe(true);
  });

  it('denies a student acting on another student\'s resource', () => {
    const student = makeStudent('student-1');
    const decision = can(student, 'student.history.view', { ownerId: 'student-2' });
    expect(decision.allowed).toBe(false);
    expect(decision.auditPayload.scopeMatch).toBe('self');
  });

  it('allows a student capability with no resource scope provided', () => {
    // Legacy pattern: handler enforces ownership via DB query.
    const student = makeStudent('student-1');
    expect(can(student, 'student.attendance.checkin').allowed).toBe(true);
  });
});

describe('policy.can — driver capabilities', () => {
  it('allows a driver with the capability (trip scope not yet enforced here)', () => {
    const driver = makeDriver();
    expect(can(driver, 'driver.trip.start').allowed).toBe(true);
    expect(can(driver, 'driver.gps.ping').allowed).toBe(true);
  });

  it('denies a student trying to use a driver capability', () => {
    const student = makeStudent();
    const decision = can(student, 'driver.trip.start' as Capability);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('missing_capability');
  });
});

describe('policy facade', () => {
  it('exposes can() as policy.can', () => {
    expect(policy.can).toBe(can);
  });
});
