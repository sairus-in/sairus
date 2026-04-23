import { z } from 'zod';
import { ROLES } from '../types/user.types';

export const RoleSchema = z.enum([
  ROLES.STUDENT,
  ROLES.STAFF,
  ROLES.DRIVER,
  ROLES.COORDINATOR,
  ROLES.TRANSPORT_OFFICER,
  ROLES.FACULTY,
  ROLES.MANAGEMENT,
  ROLES.NCC_OFFICER,
]);

export type AuthRole = z.infer<typeof RoleSchema>;

export const isStudentRole = (role: AuthRole): boolean => role === ROLES.STUDENT;
export const isDriverRole = (role: AuthRole): boolean => role === ROLES.DRIVER;
export const isPrivilegedRole = (role: AuthRole): boolean => (
  role === ROLES.COORDINATOR
  || role === ROLES.TRANSPORT_OFFICER
  || role === ROLES.FACULTY
  || role === ROLES.MANAGEMENT
  || role === ROLES.STAFF
  || role === ROLES.NCC_OFFICER
);
