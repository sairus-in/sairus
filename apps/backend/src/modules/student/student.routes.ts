// apps/backend/src/modules/student/student.routes.ts
// BFF (Backend For Frontend) for the student mobile home screen.

import { FastifyInstance } from 'fastify';
import { mobileRoute } from '../../middleware/route-guards';
import { studentHomeService } from './student-home.service';
import { ok } from 'shared';

export async function studentRoutes(app: FastifyInstance) {
  app.get('/home', {
    preHandler: mobileRoute(['STUDENT']),
  }, async (request, reply) => {
    const data = await studentHomeService.getHome(request.user!.sub);
    return reply.send(ok(data, request.id));
  });
}
