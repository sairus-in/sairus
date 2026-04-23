import { z } from 'zod';
import { ROLES } from '../types/user.types';

// Matches Indian phone numbers with or without +91
const phoneRegex = /^(?:(?:\+|0{0,2})91[\s-]?)?[6789]\d{9}$/;

export const phoneValidator = z
  .string()
  .regex(phoneRegex, 'Invalid Indian phone number format');

// College specific roll number format (example: 21BCE1234)
const rollNumberRegex = /^\d{2}[A-Z]{3}\d{4}$/;

export const rollNumberValidator = z
  .string()
  .regex(rollNumberRegex, 'Invalid roll number format (e.g., 21BCE1234)');

export const createUserSchema = z.object({
  phone: phoneValidator,
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  role: z.enum([
    ROLES.STUDENT,
    ROLES.STAFF,
    ROLES.DRIVER,
    ROLES.COORDINATOR,
    ROLES.TRANSPORT_OFFICER,
    ROLES.FACULTY,
    ROLES.MANAGEMENT,
    ROLES.NCC_OFFICER,
  ]),
});

export const createStudentSchema = createUserSchema.extend({
  role: z.literal(ROLES.STUDENT),
  rollNumber: rollNumberValidator,
  department: z.string().min(2),
  batch: z.string().min(4),
  assignedRouteId: z.string().uuid().nullable().optional(),
  assignedStopId: z.string().uuid().nullable().optional(),
});
