import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      sub:      string;                          // userId
      role:     'ADMIN' | 'DRIVER' | 'STUDENT' | 'COORDINATOR' | 'TRANSPORT_OFFICER' | 'MANAGEMENT'; // typed enum
      deviceId: string | undefined;
      iat:      number;
      exp:      number;
    };
    coordinatorRouteIds?: string[];
  }
}
