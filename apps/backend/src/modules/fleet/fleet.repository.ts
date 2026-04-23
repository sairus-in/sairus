/**
 * FLEET REPOSITORY
 *
 * All Prisma access for the fleet module lives here.
 * Service layer orchestrates; repository executes.
 *
 * Error mapping: P2025 → AppError(404, NOT_FOUND)
 *                P2003 → AppError(400, INVALID_REFERENCE)
 *                P2002 → AppError(409, DUPLICATE_ENTRY)
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';

export interface CreateBusInput {
  number: string;
  plateNumber: string;
  capacity?: number;
}

export interface UpdateBusInput {
  number?: string;
  plateNumber?: string;
  capacity?: number;
}

export interface CreateDriverInput {
  name: string;
  phone: string;
  licenseNumber?: string | null;
}

export interface UpdateDriverInput {
  name?: string;
  phone?: string;
  licenseNumber?: string | null;
}

export interface GetBusesFilter {
  page?: number;
  limit?: number;
}

export interface GetDriversFilter {
  page?: number;
  limit?: number;
  isActive?: boolean;
}

class FleetRepository {
  /**
   * Get a bus by ID.
   * Maps P2025 (not found) → AppError(404, NOT_FOUND)
   *
   * @param busId Bus ID
   * @returns Bus with active assignments
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async getBusById(busId: string) {
    try {
      return await prisma.bus.findUniqueOrThrow({
        where: { id: busId },
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              route: { select: { id: true, name: true } },
              driver: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new AppError(404, 'NOT_FOUND', `Bus ${busId} not found`);
        }
      }
      throw e;
    }
  }

  /**
   * Create a new bus.
   *
   * @param data Bus creation input
   * @returns Created bus
   */
  async createBus(data: CreateBusInput) {
    return await prisma.bus.create({
      data: {
        number: data.number,
        plateNumber: data.plateNumber,
        capacity: data.capacity ?? 50,
        isActive: true,
      },
      include: { assignments: false },
    });
  }

  /**
   * Update a bus.
   * Maps P2025 (not found) → AppError(404, NOT_FOUND)
   *
   * @param busId Bus ID
   * @param data Update input
   * @returns Updated bus
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async updateBus(busId: string, data: UpdateBusInput) {
    try {
      return await prisma.bus.update({
        where: { id: busId },
        data: {
          ...(data.number !== undefined && { number: data.number }),
          ...(data.plateNumber !== undefined && { plateNumber: data.plateNumber }),
          ...(data.capacity !== undefined && { capacity: data.capacity }),
          updatedAt: new Date(),
        },
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              route: { select: { id: true, name: true } },
              driver: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new AppError(404, 'NOT_FOUND', `Bus ${busId} not found`);
        }
      }
      throw e;
    }
  }

  /**
   * Deactivate a bus (soft delete).
   * Used by service to wrap in transaction.
   *
   * @param busId Bus ID
   * @param userId User deactivating the bus
   * @returns Updated bus
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async deactivateBus(busId: string, userId: string) {
    try {
      return await prisma.bus.update({
        where: { id: busId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: userId,
          deactivationReason: 'Admin deactivation',
        },
        include: { assignments: false },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new AppError(404, 'NOT_FOUND', `Bus ${busId} not found`);
        }
      }
      throw e;
    }
  }

  /**
   * Get paginated list of all buses.
   *
   * @param page Page number (1-indexed)
   * @param limit Items per page (default 20)
   * @returns Buses and pagination metadata
   */
  async getBusesPaginated(page: number = 1, limit: number = 20) {
    const skip = (page - 1) * limit;

    const [buses, total] = await Promise.all([
      prisma.bus.findMany({
        where: { isActive: true },
        skip,
        take: limit,
        orderBy: { number: 'asc' },
        include: {
          assignments: {
            where: { isActive: true },
            include: {
              route: { select: { id: true, name: true } },
              driver: { select: { id: true, name: true, phone: true } },
            },
          },
        },
      }),
      prisma.bus.count({ where: { isActive: true } }),
    ]);

    return {
      buses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get a driver by ID.
   * Maps P2025 (not found) → AppError(404, NOT_FOUND)
   *
   * @param driverId Driver ID
   * @returns Driver with basic fields
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async getDriverById(driverId: string) {
    try {
      return await prisma.user.findUniqueOrThrow({
        where: { id: driverId },
        select: {
          id: true,
          name: true,
          phone: true,
          licenseNumber: true,
          isActive: true,
          createdAt: true,
          role: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new AppError(404, 'NOT_FOUND', `Driver ${driverId} not found`);
        }
      }
      throw e;
    }
  }

  /**
   * Get paginated list of all drivers.
   *
   * @param filters Filter options (page, limit, isActive)
   * @returns Drivers and pagination metadata
   */
  async getDriversPaginated(filters: GetDriversFilter) {
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    const skip = (page - 1) * limit;

    const [drivers, total] = await Promise.all([
      prisma.user.findMany({
        where: {
          role: 'DRIVER',
          ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        },
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          phone: true,
          licenseNumber: true,
          isActive: true,
          createdAt: true,
        },
      }),
      prisma.user.count({
        where: {
          role: 'DRIVER',
          ...(filters.isActive !== undefined && { isActive: filters.isActive }),
        },
      }),
    ]);

    return {
      drivers,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Create a new driver (user with DRIVER role).
   *
   * @param data Driver creation input
   * @returns Created driver
   */
  async createDriver(data: CreateDriverInput) {
    return await prisma.user.create({
      data: {
        name: data.name,
        phone: data.phone,
        role: 'DRIVER',
        licenseNumber: data.licenseNumber ?? null,
      },
      select: {
        id: true,
        name: true,
        phone: true,
        licenseNumber: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  /**
   * Update a driver.
   * Maps P2025 (not found) → AppError(404, NOT_FOUND)
   *
   * @param driverId Driver ID
   * @param data Update input
   * @returns Updated driver
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async updateDriver(driverId: string, data: UpdateDriverInput) {
    try {
      return await prisma.user.update({
        where: { id: driverId },
        data: {
          ...(data.name !== undefined && { name: data.name }),
          ...(data.phone !== undefined && { phone: data.phone }),
          ...(data.licenseNumber !== undefined && { licenseNumber: data.licenseNumber }),
        },
        select: {
          id: true,
          name: true,
          phone: true,
          licenseNumber: true,
          isActive: true,
          createdAt: true,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') {
          throw new AppError(404, 'NOT_FOUND', `Driver ${driverId} not found`);
        }
      }
      throw e;
    }
  }

  /**
   * Check if a driver is already assigned to a bus (active assignment).
   *
   * @param driverId Driver ID
   * @returns Bus assignment if active, null otherwise
   */
  async getActiveAssignmentForDriver(driverId: string) {
    return await prisma.busAssignment.findFirst({
      where: {
        driverId,
        isActive: true,
      },
      include: {
        bus: { select: { id: true, number: true } },
        route: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Assign a driver to a bus (create or reactivate assignment).
   * Maps P2003 (foreign key) → AppError(400, INVALID_REFERENCE)
   *
   * @param busId Bus ID
   * @param driverId Driver ID
   * @param routeId Route ID
   * @returns Created or updated assignment
   * @throws AppError(400, INVALID_REFERENCE) if bus/driver/route not found
   */
  async assignDriver(busId: string, driverId: string, routeId: string) {
    try {
      // Check for existing assignment with this driver+bus+route combination
      const existing = await prisma.busAssignment.findFirst({
        where: {
          driverId,
          busId,
          routeId,
        },
      });

      if (existing) {
        // Reactivate existing assignment
        return await prisma.busAssignment.update({
          where: { id: existing.id },
          data: { isActive: true, effectiveFrom: new Date() },
          include: {
            bus: { select: { id: true, number: true } },
            driver: { select: { id: true, name: true, phone: true } },
            route: { select: { id: true, name: true } },
          },
        });
      }

      // Create new assignment
      return await prisma.busAssignment.create({
        data: {
          driverId,
          busId,
          routeId,
          isActive: true,
          effectiveFrom: new Date(),
        },
        include: {
          bus: { select: { id: true, number: true } },
          driver: { select: { id: true, name: true, phone: true } },
          route: { select: { id: true, name: true } },
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2003') {
          throw new AppError('INVALID_REFERENCE', 400, 'Bus, driver, or route not found');
        }
      }
      throw e;
    }
  }

  /**
   * Deactivate all assignments for a driver.
   * Used by service when deactivating a driver.
   *
   * @param driverId Driver ID
   */
  async deactivateDriverAssignments(driverId: string) {
    return await prisma.busAssignment.updateMany({
      where: { driverId },
      data: { isActive: false },
    });
  }

  /**
   * Find active trip for a driver (used to prevent deactivation while driving).
   *
   * @param driverId Driver ID
   * @returns Active trip if exists, null otherwise
   */
  async findActiveTrip(driverId: string) {
    return await prisma.trip.findFirst({
      where: {
        driverId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  }

  /**
   * Deactivate a driver (soft delete).
   * Used by service; should be wrapped in transaction.
   *
   * @param driverId Driver ID
   * @param userId User performing the action
   */
  async deactivateDriver(driverId: string, userId: string) {
    return await prisma.user.update({
      where: { id: driverId },
      data: {
        isActive: false,
        sessionVersion: { increment: 1 }, // Revoke all sessions
      },
      select: { id: true },
    });
  }
}

export const fleetRepository = new FleetRepository();
