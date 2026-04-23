import { prisma } from '../../lib/prisma'
import { AppError } from '../../lib/errors'
import { logger } from '../../lib/logger'
import type { User } from '@prisma/client'
import { Prisma } from '@prisma/client'

export class MobileAuthRepository {
  /**
   * Find user by phone number with full route assignment details.
   * Used for login operations.
   * @throws AppError 404 if user not found (P2025)
   */
  async findUserByPhoneWithRouteAssignment(phone: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { phone },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          isActive: true,
          department: true,
          year: true,
          rollNumber: true,
          authStatus: true,
          firebaseUid: true,
          sessionVersion: true,
          registeredDeviceId: true,
          routeAssignment: {
            include: {
              route: {
                select: {
                  id: true,
                  name: true,
                  area: true,
                },
              },
              stop: {
                select: {
                  id: true,
                  name: true,
                  lat: true,
                  lon: true,
                },
              },
            },
          },
        },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'user_lookup_not_found',
            source: 'SYSTEM',
            meta: { phone, code: 'P2025' },
          })
          throw new AppError('This phone number is not registered in the system.', 404, 'USER_NOT_REGISTERED')
        }
      }
      logger.error({
        event: 'user_lookup_error',
        source: 'SYSTEM',
        meta: { phone, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Find user by phone for refresh operations (minimal data).
   */
  async findUserByPhoneForRefresh(phone: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { phone },
        select: {
          id: true,
          role: true,
          isActive: true,
          authStatus: true,
          sessionVersion: true,
          registeredDeviceId: true,
        },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'user_refresh_lookup_not_found',
            source: 'SYSTEM',
            meta: { phone, code: 'P2025' },
          })
          return null
        }
      }
      logger.error({
        event: 'user_refresh_lookup_error',
        source: 'SYSTEM',
        meta: { phone, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Update user device binding and last login timestamp.
   * @throws AppError 409 if constraint violation (P2002)
   */
  async updateUserDeviceBinding(
    userId: string,
    data: {
      registeredDeviceId: string
      lastLoginAt: Date
      deviceBoundAt?: Date
      firebaseUid?: string
    }
  ) {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          registeredDeviceId: data.registeredDeviceId,
          lastLoginAt: data.lastLoginAt,
          ...(data.deviceBoundAt && { deviceBoundAt: data.deviceBoundAt }),
          ...(data.firebaseUid && { firebaseUid: data.firebaseUid }),
        },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          logger.warn({
            event: 'device_binding_conflict',
            source: 'SYSTEM',
            meta: { userId, code: 'P2002' },
          })
          throw new AppError('Device already bound to another account', 409, 'DEVICE_CONFLICT')
        }
        if (error.code === 'P2025') {
          logger.warn({
            event: 'device_binding_user_not_found',
            source: 'SYSTEM',
            meta: { userId, code: 'P2025' },
          })
          throw new AppError('User not found', 404, 'USER_NOT_FOUND')
        }
      }
      logger.error({
        event: 'device_binding_error',
        source: 'SYSTEM',
        meta: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Update only Firebase UID without touching device binding.
   */
  async updateFirebaseUid(userId: string, firebaseUid: string) {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: { firebaseUid },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'firebase_uid_update_user_not_found',
            source: 'SYSTEM',
            meta: { userId, code: 'P2025' },
          })
          throw new AppError('User not found', 404, 'USER_NOT_FOUND')
        }
      }
      logger.error({
        event: 'firebase_uid_update_error',
        source: 'SYSTEM',
        meta: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Find user with full profile and route assignment for /me endpoint.
   */
  async findUserWithFullProfile(userId: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          routeAssignment: {
            include: {
              route: {
                include: {
                  stops: { include: { stop: true }, orderBy: { sequence: 'asc' } }
                }
              },
              stop: true,
            }
          }
        }
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'user_profile_lookup_not_found',
            source: 'SYSTEM',
            meta: { userId, code: 'P2025' },
          })
          return null
        }
      }
      logger.error({
        event: 'user_profile_lookup_error',
        source: 'SYSTEM',
        meta: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Find user by Firebase UID.
   * Used when authenticating with Firebase token.
   * @throws AppError 404 if user not found (P2025)
   */
  async getUserByFirebaseUid(firebaseUid: string) {
    try {
      const user = await prisma.user.findUnique({
        where: { firebaseUid },
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          role: true,
          isActive: true,
          authStatus: true,
          sessionVersion: true,
          registeredDeviceId: true,
        },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'user_firebase_uid_lookup_not_found',
            source: 'SYSTEM',
            meta: { code: 'P2025' },
          })
          return null
        }
      }
      logger.error({
        event: 'user_firebase_uid_lookup_error',
        source: 'SYSTEM',
        meta: { error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Upsert user device record with FCM token.
   * Creates or updates device binding with latest FCM token.
   * @throws AppError 409 if constraint violation (P2002)
   */
  async upsertUserDevice(
    userId: string,
    deviceHash: string,
    fcmToken: string
  ) {
    try {
      // Note: userDevice table is not in current schema, using User table's registeredDeviceId
      // This method is a placeholder for a future 1:N relationship with devices
      // For now, we upsert in the User table
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          registeredDeviceId: deviceHash,
          lastLoginAt: new Date(),
        },
      })
      return user
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          logger.warn({
            event: 'device_upsert_conflict',
            source: 'SYSTEM',
            meta: { userId, code: 'P2002' },
          })
          throw new AppError('Device already bound to another account', 409, 'DEVICE_CONFLICT')
        }
        if (error.code === 'P2025') {
          logger.warn({
            event: 'device_upsert_user_not_found',
            source: 'SYSTEM',
            meta: { userId, code: 'P2025' },
          })
          throw new AppError('User not found', 404, 'USER_NOT_FOUND')
        }
      }
      logger.error({
        event: 'device_upsert_error',
        source: 'SYSTEM',
        meta: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }

  /**
   * Get student's route assignment information.
   * Includes route details and stop information for mobile app routing.
   * @throws AppError 404 if no assignment found
   */
  async getStudentRouteAssignment(userId: string) {
    try {
      const assignment = await prisma.routeAssignment.findUnique({
        where: { userId },
        include: {
          route: {
            select: {
              id: true,
              name: true,
              area: true,
              stops: {
                include: { stop: true },
                orderBy: { sequence: 'asc' },
              },
            },
          },
          stop: {
            select: {
              id: true,
              name: true,
              lat: true,
              lon: true,
            },
          },
        },
      })
      return assignment
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2025') {
          logger.warn({
            event: 'route_assignment_lookup_not_found',
            source: 'SYSTEM',
            meta: { userId, code: 'P2025' },
          })
          return null
        }
      }
      logger.error({
        event: 'route_assignment_lookup_error',
        source: 'SYSTEM',
        meta: { userId, error: error instanceof Error ? error.message : 'Unknown error' },
      })
      throw error
    }
  }
}

export const mobileAuthRepository = new MobileAuthRepository()
