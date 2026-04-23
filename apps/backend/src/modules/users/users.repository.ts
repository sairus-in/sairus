import { prisma } from '../../lib/prisma';
import { Prisma } from '@prisma/client';

export class UsersRepository {
  async countUsers(whereClause: Prisma.UserWhereInput) {
    return prisma.user.count({ where: whereClause });
  }

  async findUsersWithRoutes(whereClause: Prisma.UserWhereInput, skip: number, take: number) {
    return prisma.user.findMany({
      where: whereClause,
      include: {
        routeAssignment: {
          where: { isActive: true },
          include: { 
            route: { 
              include: { 
                assignments: { 
                  where: { isActive: true }, 
                  include: { bus: true },
                  take: 1
                } 
              } 
            } 
          }
        }
      },
      skip,
      take,
      orderBy: { name: 'asc' }
    });
  }
}

export const usersRepository = new UsersRepository();
