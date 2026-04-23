import { FastifyInstance } from 'fastify';
import { adminRoute } from '../../middleware/route-guards';
import { importService } from './import.service';
import { assertAdminAction, getAdminAccessContext } from '../../lib/admin-access';
import { AppError } from '../../lib/errors';
import { ok } from 'shared';
import * as z from 'zod';

const importRowSchema = z.object({
  phone: z.string().min(1),
  name: z.string().min(1),
  rollNumber: z.string().min(1),
  email: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  year: z.coerce.number().optional().nullable(),
  assignedRouteId: z.string().optional().nullable(),
  assignedStopId: z.string().optional().nullable(),
});

const validateBodySchema = z.object({
  fileChecksum: z.string(),
  rows: z.array(importRowSchema),
});

export async function importRoutes(app: FastifyInstance) {
  app.post('/validate', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const access = await getAdminAccessContext(request.user!.sub);
    assertAdminAction(access, 'BULK_IMPORT_STUDENTS');
    const parsed = validateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await importService.validateBulkStudents(request.user!.sub, parsed.data.rows, parsed.data.fileChecksum);
    return reply.send(ok(result, request.id));
  });

  app.post<{ Params: { sessionId: string } }>('/:sessionId/execute', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request) => {
    const access = await getAdminAccessContext(request.user!.sub);
    assertAdminAction(access, 'BULK_IMPORT_STUDENTS');
    const result = await importService.executeImportSession(request.params.sessionId, request.user!.sub);
    return result;
  });

  app.patch<{ Params: { sessionId: string; rowId: string } }>('/:sessionId/rows/:rowId', {
    preHandler: adminRoute(['TRANSPORT_OFFICER', 'MANAGEMENT']),
  }, async (request, reply) => {
    const access = await getAdminAccessContext(request.user!.sub);
    assertAdminAction(access, 'BULK_IMPORT_STUDENTS');
    const parsed = importRowSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', parsed.error.issues);
    }

    const result = await importService.updateImportRow(request.params.sessionId, request.params.rowId, parsed.data);
    return reply.send(ok(result, request.id));
  });
}
