import { FastifyRequest, FastifyReply } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../lib/env';

const oauthClient = new OAuth2Client();

export const verifyCloudTask = async (req: FastifyRequest, reply: FastifyReply) => {
  const authHeader = req.headers.authorization as string | undefined;

  if (!authHeader?.startsWith('Bearer ')) {
    reply.code(403).send({ error: 'FORBIDDEN', reason: 'Missing auth token' });
    return;
  }

  try {
    const idToken = authHeader.split(' ')[1];

    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: env.BACKEND_URL,
    });

    const payload = ticket.getPayload();

    if (!payload) {
      reply.code(403).send({ error: 'FORBIDDEN', reason: 'Invalid token payload' });
      return;
    }

    if (payload.email !== env.CLOUD_TASKS_SA_EMAIL) {
      reply.code(403).send({ error: 'FORBIDDEN', reason: 'Wrong service account' });
      return;
    }

  } catch (err: any) {
    req.log.warn({ event: 'cloud_task_auth_failed', error: err.message });
    reply.code(403).send({ error: 'FORBIDDEN', reason: 'Token verification failed' });
  }
};
