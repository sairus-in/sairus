import { prisma } from '../../lib/prisma';
import { firebaseAdmin } from '../../lib/firebase';
import { revokeMobileAuthState } from '../../lib/auth-state-change';
import { getTodayDateKey, type PushTokenProvider } from 'shared';

interface BulkStudentData {
  phone: string;
  name: string;
  email?: string;
  rollNumber: string;
  department: string;
  year: number;
  assignedRouteId?: string;
  assignedStopId?: string;
}

interface StudentUpdateData {
  name: string;
  phone: string;
  rollNumber?: string | null;
  department?: string | null;
  year?: number | null;
  routeId?: string;
  stopId?: string;
}

export class UsersService {
  private async ensureRouteChangeAllowed(routeIds: string[]) {
    const today = getTodayDateKey();

    const activeTrip = await prisma.trip.findFirst({
      where: {
        routeId: { in: routeIds },
        date: today,
        status: { in: ['SCHEDULED', 'ACTIVE'] },
      },
      select: { id: true },
    });

    if (activeTrip) {
      throw new Error('Cannot change assignment while a scheduled or active trip exists on the affected route.');
    }
  }

  /**
   * Bulk import students (e.g., from CSV upload in Transport Office Admin Panel).
   * Uses the flat User model — rollNumber, department, year are on User directly.
   * Runs in a transaction to ensure either all succeed or none.
   */
  async bulkImportStudents(students: BulkStudentData[]) {
    return prisma.$transaction(async (tx) => {
      const results = [];

      for (const student of students) {
        const user = await tx.user.upsert({
          where: { phone: student.phone },
          update: {
            name: student.name,
            email: student.email,
            rollNumber: student.rollNumber,
            department: student.department,
            year: student.year,
          },
          create: {
            phone: student.phone,
            name: student.name,
            email: student.email,
            role: 'STUDENT',
            rollNumber: student.rollNumber,
            department: student.department,
            year: student.year,
          },
        });

        if (student.assignedRouteId && student.assignedStopId) {
          await tx.routeAssignment.upsert({
            where: { userId: user.id },
            update: {
              routeId: student.assignedRouteId,
              stopId: student.assignedStopId,
            },
            create: {
              userId: user.id,
              routeId: student.assignedRouteId,
              stopId: student.assignedStopId,
            },
          });
        }

        results.push({ userId: user.id, rollNumber: student.rollNumber });
      }

      return results;
    });
  }

  /**
   * Assign a student to a specific route and stop.
   * Gated against active trips on either the current or target route.
   */
  async assignStudent(studentId: string, routeId: string, stopId: string) {
    const current = await prisma.routeAssignment.findUnique({ where: { userId: studentId } });

    const routesToCheck = [routeId];
    if (current && current.routeId !== routeId) routesToCheck.push(current.routeId);
    await this.ensureRouteChangeAllowed(routesToCheck);

    return prisma.routeAssignment.upsert({
      where: { userId: studentId },
      update: { routeId, stopId },
      create: { userId: studentId, routeId, stopId },
    });
  }

  async bulkAssignStudents(studentIds: string[], routeId: string, stopId: string) {
    const currentAssignments = await prisma.routeAssignment.findMany({
      where: { userId: { in: studentIds } },
      select: { routeId: true },
    });

    const routesToCheck = Array.from(new Set([routeId, ...currentAssignments.map((assignment) => assignment.routeId)]));
    await this.ensureRouteChangeAllowed(routesToCheck);

    return prisma.$transaction(async (tx) => {
      for (const studentId of studentIds) {
        await tx.routeAssignment.upsert({
          where: { userId: studentId },
          update: {
            routeId,
            stopId,
            isActive: true,
            effectiveTo: null,
            deactivationReason: null,
          },
          create: {
            userId: studentId,
            routeId,
            stopId,
          },
        });
      }

      return { assigned: studentIds.length };
    });
  }

  async updateStudent(studentId: string, data: StudentUpdateData) {
    const existingUser = await prisma.user.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        role: true,
        routeAssignment: {
          select: { routeId: true, stopId: true },
        },
      },
    });

    if (!existingUser || existingUser.role !== 'STUDENT') {
      throw new Error('Student not found');
    }

    const needsAssignmentUpdate = Boolean(data.routeId && data.stopId);

    if (needsAssignmentUpdate) {
      const routesToCheck = [data.routeId!];
      if (existingUser.routeAssignment && existingUser.routeAssignment.routeId !== data.routeId) {
        routesToCheck.push(existingUser.routeAssignment.routeId);
      }

      await this.ensureRouteChangeAllowed(routesToCheck);
    }

    return prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: studentId },
        data: {
          name: data.name,
          phone: data.phone,
          rollNumber: data.rollNumber || null,
          department: data.department || null,
          year: data.year ?? null,
        },
      });

      if (needsAssignmentUpdate) {
        await tx.routeAssignment.upsert({
          where: { userId: studentId },
          update: {
            routeId: data.routeId!,
            stopId: data.stopId!,
            isActive: true,
            effectiveTo: null,
            deactivationReason: null,
          },
          create: {
            userId: studentId,
            routeId: data.routeId!,
            stopId: data.stopId!,
          },
        });
      }

      return user;
    });
  }

  /**
   * Suspends/re-enables an account and keeps local + Firebase auth state aligned.
   */
  async toggleUserStatus(userId: string, isActive: boolean) {
    const user = await revokeMobileAuthState(userId, {
      isActive,
      authStatus: isActive ? 'ACTIVE' : 'DISABLED',
    });

    if (firebaseAdmin) {
      try {
        const fbUser = await firebaseAdmin.auth().getUserByPhoneNumber(user.phone);
        await firebaseAdmin.auth().updateUser(fbUser.uid, { disabled: !isActive });
      } catch (err) {
        console.warn(`Could not update Firebase auth state for ${user.phone}`);
      }
    }

    return user;
  }

  async updatePushToken(userId: string, pushToken: string, pushTokenProvider?: PushTokenProvider) {
    const oldUser = await prisma.user.findUnique({ where: { id: userId } });
    
    const updated = await prisma.user.update({
      where: { id: userId },
      data: { fcmToken: pushToken },
    });

    const { auditService } = await import('../../lib/audit.service');
    auditService.log({
      action: 'FCM_TOKEN_UPDATED',
      actor: { actorId: userId, actorType: 'MOBILE_USER' },
      entityType: 'user',
      entityId: userId,
      meta: {
        oldToken: oldUser?.fcmToken,
        newToken: pushToken,
        pushTokenProvider: pushTokenProvider ?? 'UNKNOWN',
      },
    });

    return updated;
  }

  async listUsers(whereClause: import('@prisma/client').Prisma.UserWhereInput, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const { usersRepository } = await import('./users.repository');
    
    const [total, users] = await Promise.all([
      usersRepository.countUsers(whereClause),
      usersRepository.findUsersWithRoutes(whereClause, skip, limit)
    ]);
    
    return { total, users };
  }
}


export const usersService = new UsersService();
