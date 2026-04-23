// Roles
export const ROLES = {
  STUDENT: 'STUDENT',
  STAFF: 'STAFF',
  DRIVER: 'DRIVER',
  COORDINATOR: 'COORDINATOR',
  TRANSPORT_OFFICER: 'TRANSPORT_OFFICER',
  FACULTY: 'FACULTY',
  MANAGEMENT: 'MANAGEMENT',
  NCC_OFFICER: 'NCC_OFFICER',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

// Core User Interfaces
export interface BaseUser {
  id: string; // Firebase UID
  phone: string;
  role: Role;
  name: string;
  email?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Student extends BaseUser {
  role: typeof ROLES.STUDENT;
  rollNumber: string;
  department: string;
  batch: string;
  assignedRouteId: string | null;
  assignedStopId: string | null;
  assignedBusId: string | null;
  onboardingStatus: 'PENDING' | 'COMPLETED';
}

export interface Staff extends BaseUser {
  role: typeof ROLES.STAFF;
}

export interface Driver extends BaseUser {
  role: typeof ROLES.DRIVER;
  licenseNumber: string;
  assignedBusId: string | null; // Null if substitute pool
}

export interface Coordinator extends BaseUser {
  role: typeof ROLES.COORDINATOR;
  assignedRouteIds: string[];
}

export interface TransportOfficer extends BaseUser {
  role: typeof ROLES.TRANSPORT_OFFICER;
}

export interface Faculty extends BaseUser {
  role: typeof ROLES.FACULTY;
  department: string;
}

export interface Management extends BaseUser {
  role: typeof ROLES.MANAGEMENT;
}

export interface NccOfficer extends BaseUser {
  role: typeof ROLES.NCC_OFFICER;
}

export type AnyUser =
  | Student
  | Staff
  | Driver
  | Coordinator
  | TransportOfficer
  | Faculty
  | Management
  | NccOfficer;

// JWT Claims Pattern
export interface JwtClaims {
  uid: string;
  role: Role;
  busId?: string; // For drivers
  routeIds?: string[]; // For coordinators
  deptId?: string; // For faculty
  iat?: number;
  exp?: number;
}
