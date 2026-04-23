import { User, RouteAssignment, Route, Bus, BusAssignment } from '@prisma/client';
import { AuthStatus } from '@prisma/client';

export interface TransportOfficerStudentDto {
  id: string;
  name: string;
  rollNumber: string | null;
  phone: string;
  department: string | null;
  year: number | null;
  routeId?: string;
  stopId?: string;
  busNumber?: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivationReason: string | null;
  authStatus: AuthStatus;
}

export interface CoordinatorStudentDto {
  id: string;
  name: string;
  rollNumber: string | null;
  department: string | null;
  year: number | null;
  stopId?: string;
  busNumber?: string;
  isActive: boolean;
}

export interface FacultyStudentDto {
  id: string;
  name: string;
  rollNumber: string | null;
  department: string | null;
  year: number | null;
  isActive: boolean;
}

type UserWithRelations = User & {
  routeAssignment?: (RouteAssignment & {
    route?: (Route & {
      assignments?: (BusAssignment & {
        bus: Bus;
      })[];
    }) | null;
  }) | null;
};

export const toTransportOfficerStudentDto = (user: UserWithRelations): TransportOfficerStudentDto => ({
  id: user.id,
  name: user.name,
  rollNumber: user.rollNumber,
  phone: user.phone,
  department: user.department,
  year: user.year,
  routeId: user.routeAssignment?.routeId,
  stopId: user.routeAssignment?.stopId,
  busNumber: user.routeAssignment?.route?.assignments?.[0]?.bus?.number,
  isActive: user.isActive,
  deactivatedAt: user.deactivatedAt,
  deactivatedBy: user.deactivatedById,
  deactivationReason: user.deactivationReason,
  authStatus: user.authStatus,
});

export const toCoordinatorStudentDto = (user: UserWithRelations): CoordinatorStudentDto => ({
  id: user.id,
  name: user.name,
  rollNumber: user.rollNumber,
  department: user.department,
  year: user.year,
  stopId: user.routeAssignment?.stopId,
  busNumber: user.routeAssignment?.route?.assignments?.[0]?.bus?.number,
  isActive: user.isActive,
});

export const toFacultyStudentDto = (user: UserWithRelations): FacultyStudentDto => ({
  id: user.id,
  name: user.name,
  rollNumber: user.rollNumber,
  department: user.department,
  year: user.year,
  isActive: user.isActive,
});
