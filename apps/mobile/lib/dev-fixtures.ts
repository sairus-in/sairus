// DEV ONLY — fake users injected into the auth store during local development.
// Never imported from production code paths.
import type { User } from '../store/auth.store';

export const DEV_STUDENT: User = {
  id: 'dev_student_001',
  name: 'Dev Student',
  phone: '9999999999',
  email: null,
  role: 'STUDENT',
  isActive: true,
  rollNumber: 'DEV-001',
  department: 'Computer Science',
  year: 3,
  routeAssignment: {
    id: 'dev_assignment_001',
    routeId: 'dev_route_001',
    stopId: 'dev_stop_001',
    route: { id: 'dev_route_001', name: 'Route A', area: 'North Campus' },
    stop: { id: 'dev_stop_001', name: 'Main Gate', lat: 12.9716, lon: 77.5946 },
  },
  busNumber: 'KA-01-DEV-42',
};

// For testing the "pending" / unassigned-student screen
export const DEV_STUDENT_NO_ROUTE: User = {
  id: 'dev_student_002',
  name: 'Dev Student (Unassigned)',
  phone: '9999999998',
  email: null,
  role: 'STUDENT',
  isActive: true,
  rollNumber: 'DEV-002',
  department: 'Mechanical Engineering',
  year: 1,
  routeAssignment: null,
};

export const DEV_DRIVER: User = {
  id: 'dev_driver_001',
  name: 'Dev Driver',
  phone: '8888888888',
  email: null,
  role: 'DRIVER',
  isActive: true,
  busNumber: 'KA-01-DEV-42',
};

export type DevRole = 'student' | 'student-no-route' | 'driver';

export const DEV_ROLE_LABELS: Record<DevRole, string> = {
  student: 'Student (assigned)',
  'student-no-route': 'Student (pending)',
  driver: 'Driver',
};

export const DEV_FIXTURES: Record<DevRole, User> = {
  student: DEV_STUDENT,
  'student-no-route': DEV_STUDENT_NO_ROUTE,
  driver: DEV_DRIVER,
};
