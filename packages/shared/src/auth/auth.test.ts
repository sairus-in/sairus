import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES,
  capabilityDomain,
  isCapability,
} from './capabilities';
import type { Capability } from './capabilities';
import {
  ALL_ACTOR_TYPES,
  emptyScope,
  isActor,
  isActorType,
  isAdminActor,
  isMobileActor,
  isSystemActor,
} from './actor';
import type { Actor } from './actor';

describe('Capability vocabulary', () => {
  it('enumerates exactly 46 capabilities (31 admin + 7 student + 8 driver)', () => {
    expect(ALL_CAPABILITIES).toHaveLength(46);
  });

  it('contains no duplicates', () => {
    const set = new Set<string>(ALL_CAPABILITIES);
    expect(set.size).toBe(ALL_CAPABILITIES.length);
  });

  it('partitions into the documented domain counts', () => {
    const counts = ALL_CAPABILITIES.reduce<Record<string, number>>((acc, cap) => {
      const domain = capabilityDomain(cap);
      acc[domain] = (acc[domain] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts).toEqual({ admin: 31, student: 7, driver: 8 });
  });

  it('every capability follows the domain.resource.action naming convention', () => {
    for (const cap of ALL_CAPABILITIES) {
      // Minimum two dots — domain.resource.action. Some legitimate capabilities
      // have more (e.g., admin.attendance_report.view, driver.trip.roster.view).
      expect(cap.split('.').length).toBeGreaterThanOrEqual(3);
    }
  });

  describe('isCapability', () => {
    it('accepts every entry in ALL_CAPABILITIES', () => {
      for (const cap of ALL_CAPABILITIES) {
        expect(isCapability(cap)).toBe(true);
      }
    });

    it('rejects legacy AdminAction names (must use new vocabulary)', () => {
      expect(isCapability('VIEW_DASHBOARD')).toBe(false);
      expect(isCapability('COORDINATOR_OVERRIDE')).toBe(false);
      expect(isCapability('VIEW_PENDING_AUTH')).toBe(false);
    });

    it('rejects non-string and malformed inputs', () => {
      expect(isCapability(null)).toBe(false);
      expect(isCapability(undefined)).toBe(false);
      expect(isCapability(42)).toBe(false);
      expect(isCapability({})).toBe(false);
      expect(isCapability('admin.unknown.action')).toBe(false);
    });
  });

  describe('capabilityDomain', () => {
    it.each([
      ['admin.dashboard.view', 'admin'],
      ['student.attendance.checkin', 'student'],
      ['driver.trip.start', 'driver'],
    ] as const)('maps %s to %s', (cap, domain) => {
      expect(capabilityDomain(cap as Capability)).toBe(domain);
    });
  });
});

describe('ActorType vocabulary', () => {
  it('contains the four documented types', () => {
    expect(ALL_ACTOR_TYPES).toEqual([
      'mobile_student',
      'mobile_driver',
      'admin',
      'system',
    ]);
  });

  describe('isActorType', () => {
    it('accepts every documented type', () => {
      for (const t of ALL_ACTOR_TYPES) {
        expect(isActorType(t)).toBe(true);
      }
    });

    it('rejects junk', () => {
      expect(isActorType('mobile')).toBe(false);
      expect(isActorType('ADMIN')).toBe(false);
      expect(isActorType(null)).toBe(false);
      expect(isActorType(undefined)).toBe(false);
    });
  });
});

describe('emptyScope', () => {
  it('returns a scope with empty arrays and nulled identifiers', () => {
    const scope = emptyScope();
    expect(scope.routeIds).toEqual([]);
    expect(scope.departmentIds).toEqual([]);
    expect(scope.busId).toBeNull();
    expect(scope.tripId).toBeNull();
  });

  it('returns a fresh object each call (no aliased mutation hazard)', () => {
    expect(emptyScope()).not.toBe(emptyScope());
  });
});

describe('Actor predicates', () => {
  const baseActor = (overrides: Partial<Actor> = {}): Actor => ({
    actorId: 'actor-1',
    actorType: 'admin',
    capabilities: new Set<Capability>(),
    scope: emptyScope(),
    sessionContext: { requestId: 'req-1' },
    ...overrides,
  });

  describe('isActor', () => {
    it('accepts a structurally valid actor', () => {
      expect(isActor(baseActor())).toBe(true);
    });

    it('rejects objects missing required fields', () => {
      expect(isActor({})).toBe(false);
      expect(isActor({ actorId: 'a' })).toBe(false);
      expect(isActor(null)).toBe(false);
    });

    it('rejects actors where capabilities is not a Set', () => {
      const bad = { ...baseActor(), capabilities: [] as unknown as ReadonlySet<Capability> };
      expect(isActor(bad)).toBe(false);
    });
  });

  describe('isMobileActor / isAdminActor / isSystemActor', () => {
    it('classifies each actor type uniquely', () => {
      const student = baseActor({ actorType: 'mobile_student' });
      const driver = baseActor({ actorType: 'mobile_driver' });
      const admin = baseActor({ actorType: 'admin' });
      const system = baseActor({ actorType: 'system' });

      expect(isMobileActor(student)).toBe(true);
      expect(isMobileActor(driver)).toBe(true);
      expect(isMobileActor(admin)).toBe(false);
      expect(isMobileActor(system)).toBe(false);

      expect(isAdminActor(admin)).toBe(true);
      expect(isAdminActor(student)).toBe(false);
      expect(isAdminActor(system)).toBe(false);

      expect(isSystemActor(system)).toBe(true);
      expect(isSystemActor(admin)).toBe(false);
      expect(isSystemActor(student)).toBe(false);
    });
  });
});
