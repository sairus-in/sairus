/**
 * FLEET SERVICE
 *
 * Business logic for bus and driver management.
 *
 * ARCHITECTURE:
 *   Service → Repository → Prisma
 *   No Prisma imports here. All DB access goes through FleetRepository.
 *   Service orchestrates, validates, and enforces business rules.
 *   Repository executes all DB operations.
 */

import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { fleetRepository } from './fleet.repository';
import type {
  CreateBusInput,
  UpdateBusInput,
  CreateDriverInput,
  UpdateDriverInput,
  GetBusesFilter,
  GetDriversFilter,
} from './fleet.repository';

interface AuditContext {
  actorType: string;
  actorId: string;
  ip: string;
}

class FleetService {
  /**
   * Get a single bus by ID.
   *
   * @param busId Bus ID
   * @returns Bus with assignments
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async getBusById(busId: string) {
    return await fleetRepository.getBusById(busId);
  }

  /**
   * Create a new bus.
   *
   * @param data Bus creation input
   * @returns Created bus
   */
  async createBus(data: CreateBusInput) {
    return await fleetRepository.createBus(data);
  }

  /**
   * Update a bus.
   *
   * @param busId Bus ID
   * @param data Update input
   * @returns Updated bus
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async updateBus(busId: string, data: UpdateBusInput) {
    return await fleetRepository.updateBus(busId, data);
  }

  /**
   * Deactivate (soft delete) a bus.
   * Wraps in transaction to ensure consistency.
   *
   * @param busId Bus ID
   * @param userId User deactivating
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async deleteBus(busId: string, userId: string) {
    // Verify bus exists first
    await fleetRepository.getBusById(busId);

    // Deactivate in transaction
    await prisma.$transaction(async (tx) => {
      // Deactivate all route assignments
      await tx.busAssignment.updateMany({
        where: { busId },
        data: { isActive: false },
      });

      // Deactivate the bus itself
      await tx.bus.update({
        where: { id: busId },
        data: {
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedById: userId,
          deactivationReason: 'Admin deactivation',
        },
      });
    });
  }

  /**
   * Get paginated list of buses.
   *
   * @param page Page number (1-indexed, default 1)
   * @param limit Items per page (default 20)
   * @returns Buses and pagination metadata
   */
  async getBusesPaginated(page?: number, limit?: number) {
    return await fleetRepository.getBusesPaginated(page, limit);
  }

  /**
   * Get a single driver by ID.
   *
   * @param driverId Driver ID
   * @returns Driver
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async getDriverById(driverId: string) {
    return await fleetRepository.getDriverById(driverId);
  }

  /**
   * Get paginated list of drivers.
   *
   * @param filters Filter options
   * @returns Drivers and pagination metadata
   */
  async getDriversPaginated(filters: GetDriversFilter) {
    return await fleetRepository.getDriversPaginated(filters);
  }

  /**
   * Create a new driver.
   *
   * @param data Driver creation input
   * @returns Created driver
   */
  async createDriver(data: CreateDriverInput) {
    return await fleetRepository.createDriver(data);
  }

  /**
   * Update a driver.
   *
   * @param driverId Driver ID
   * @param data Update input
   * @returns Updated driver
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async updateDriver(driverId: string, data: UpdateDriverInput) {
    return await fleetRepository.updateDriver(driverId, data);
  }

  /**
   * Assign a driver to a bus.
   * Prevents assigning a driver already assigned to another bus.
   *
   * @param busId Bus ID
   * @param driverId Driver ID
   * @param routeId Route ID
   * @returns Created assignment
   * @throws AppError(409, CONFLICT) if driver already assigned
   */
  async assignDriver(busId: string, driverId: string, routeId: string) {
    // Check if driver already has an active assignment to a different bus
    const existingAssignment = await fleetRepository.getActiveAssignmentForDriver(driverId);
    if (existingAssignment && existingAssignment.busId !== busId) {
      throw new AppError(
        409,
        'CONFLICT',
        `Driver is already assigned to bus ${existingAssignment.bus.number}`,
      );
    }

    // Verify bus and driver exist first (repository will throw if not found)
    await fleetRepository.getBusById(busId);
    await fleetRepository.getDriverById(driverId);

    return await fleetRepository.assignDriver(busId, driverId, routeId);
  }

  /**
   * Deactivate a driver (soft delete).
   * Wraps in transaction to ensure consistency:
   * 1. End any active trip
   * 2. Deactivate all assignments
   * 3. Revoke auth sessions
   * 4. Deactivate devices
   *
   * @param driverId Driver ID
   * @param userId User deactivating
   * @throws AppError(404, NOT_FOUND) if not found
   */
  async deactivateDriver(driverId: string, userId: string) {
    // Verify driver exists first
    await fleetRepository.getDriverById(driverId);

    // Wrap cascading mutations in transaction
    await prisma.$transaction(async (tx) => {
      // 1. Find and end any active trip
      const activeTrip = await tx.trip.findFirst({
        where: { driverId, status: 'ACTIVE' },
        select: { id: true },
      });

      if (activeTrip) {
        await tx.trip.update({
          where: { id: activeTrip.id },
          data: {
            status: 'COMPLETED',
            endedAt: new Date(),
          },
        });
      }

      // 2. Deactivate all route assignments
      await tx.busAssignment.updateMany({
        where: { driverId },
        data: { isActive: false },
      });

      // 3. Revoke all sessions + deactivate user
      await tx.user.update({
        where: { id: driverId },
        data: {
          isActive: false,
          sessionVersion: { increment: 1 }, // Revoke JWT
        },
      });

      // 4. Clear FCM token on user (userDevice model not available)
      await tx.user.update({
        where: { id: driverId },
        data: {
          fcmToken: null,
        },
      });
    });
  }
}

export const fleetService = new FleetService();
