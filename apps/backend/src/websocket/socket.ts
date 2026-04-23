import { Server, Socket } from 'socket.io';
import { FastifyInstance } from 'fastify';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { redis } from '../lib/redis';
import { jwtConfig, resolveAllowedOrigins } from '../lib/auth-config';
import { getAuthAdminState, getAuthUserState } from '../lib/auth-cache';
import { AdminJWTPayload, MobileJWTPayload, QR } from 'shared';
import { prisma } from '../lib/prisma';
import { qrService } from '../modules/qr/qr.service';

const pubClient = redis;
let subClient: ReturnType<typeof pubClient.duplicate> | null = null;
const qrTimers = new Map<string, NodeJS.Timeout>();
const allowedOrigins = resolveAllowedOrigins();

type SocketPrincipal =
  | { type: 'ADMIN'; sub: string; role: string }
  | { type: 'MOBILE'; sub: string; role: string; deviceId: string };

export let io: Server;

const parseCookieHeader = (cookieHeader?: string) => {
  if (!cookieHeader) return {};

  return cookieHeader.split(';').reduce<Record<string, string>>((acc, part) => {
    const [rawKey, ...rest] = part.trim().split('=');
    if (!rawKey) return acc;
    acc[rawKey] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
};

const extractRoomId = (payload: unknown, key: 'tripId' | 'busId' | 'routeId'): string | null => {
  if (typeof payload === 'string' && payload.length > 0) return payload;
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<typeof key, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
};

const extractTripId = (payload: unknown) => extractRoomId(payload, 'tripId');
const extractBusId = (payload: unknown) => extractRoomId(payload, 'busId');
const extractRouteId = (payload: unknown) => extractRoomId(payload, 'routeId');

const clearQrTimer = (socketId: string) => {
  const timer = qrTimers.get(socketId);
  if (timer) {
    clearInterval(timer);
    qrTimers.delete(socketId);
  }
};

const issueQrForSocket = async (socket: Socket, tripId: string) => {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { id: true, busId: true, routeId: true, status: true, driverId: true },
  });

  if (!trip || trip.status !== 'ACTIVE') return;

  const principal = socket.data.principal as SocketPrincipal | undefined;
  if (!principal || principal.type !== 'MOBILE' || principal.role !== 'DRIVER' || principal.sub !== trip.driverId) {
    return;
  }

  const qrToken = await qrService.generateToken({
    tripId: trip.id,
    busId: trip.busId,
    routeId: trip.routeId,
  });

  socket.emit('qr:refresh', {
    tripId,
    qrToken,
    expiresAt: Date.now() + QR.JWT_EXPIRY_SECONDS * 1000,
  });
};

const startQrRotation = async (socket: Socket, tripId: string) => {
  clearQrTimer(socket.id);
  await issueQrForSocket(socket, tripId);

  const timer = setInterval(() => {
    void issueQrForSocket(socket, tripId);
  }, QR.REFRESH_PUSH_AT_SECONDS * 1000);

  qrTimers.set(socket.id, timer);
};

const authenticateSocket = async (socket: Socket): Promise<SocketPrincipal | null> => {
  const authToken = typeof socket.handshake.auth?.token === 'string'
    ? socket.handshake.auth.token
    : undefined;
  const cookies = parseCookieHeader(socket.handshake.headers.cookie);
  const cookieToken = cookies.admin_jwt;
  const token = authToken || cookieToken;

  if (!token) return null;

  const payload = jwt.verify(token, jwtConfig.secret, {
    issuer: jwtConfig.issuer,
    algorithms: [jwtConfig.algorithm],
    audience: [jwtConfig.mobileAudience, jwtConfig.adminAudience],
  }) as MobileJWTPayload | AdminJWTPayload;

  if (payload.type === 'ADMIN') {
    const authState = await getAuthAdminState(payload.sub);
    if (!authState || !authState.isActive || payload.sv !== authState.sessionVersion) {
      return null;
    }

    return {
      type: 'ADMIN',
      sub: payload.sub,
      role: payload.role,
    };
  }

  const authState = await getAuthUserState(payload.sub);
  if (
    !authState ||
    !authState.isActive ||
    payload.sv !== authState.sessionVersion ||
    payload.deviceId !== authState.registeredDeviceId
  ) {
    return null;
  }

  return {
    type: 'MOBILE',
    sub: payload.sub,
    role: payload.role,
    deviceId: payload.deviceId,
  };
};

export function setupWebsocket(app: FastifyInstance) {
  if (!subClient) {
    subClient = pubClient.duplicate();
    subClient.on('error', (error) => {
      app.log.warn({ event: 'socket_redis_sub_error', error: String(error) });
    });
  }

  io = new Server(app.server, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : true,
      credentials: true,
      methods: ['GET', 'POST'],
    },
  });

  io.adapter(createAdapter(pubClient, subClient));

  io.use(async (socket, next) => {
    const timer = setTimeout(() => next(new Error('AUTH_TIMEOUT')), 3000);
    try {
      const principal = await authenticateSocket(socket);
      clearTimeout(timer);
      if (!principal) {
        return next(new Error('UNAUTHORIZED'));
      }

      socket.data.principal = principal;
      return next();
    } catch (error) {
      clearTimeout(timer);
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const principal = socket.data.principal as SocketPrincipal;
    app.log.info({ event: 'socket_connected', socketId: socket.id, userId: principal.sub, type: principal.type });

    socket.join(`user:${principal.sub}`);

    const joinAdminRoom = () => {
      if (principal.type === 'ADMIN') {
        socket.join('admin');
      }
    };

    socket.on('join-admin', joinAdminRoom);
    socket.on('join_admin_room', joinAdminRoom);

    const leaveAdminRoom = () => {
      socket.leave('admin');
    };

    socket.on('leave-admin', leaveAdminRoom);
    socket.on('leave_admin_room', leaveAdminRoom);

    const joinTripRoom = async (payload: unknown) => {
      const tripId = extractTripId(payload);
      if (!tripId) return;

      socket.join(`trip:${tripId}`);

      if (principal.type === 'MOBILE' && principal.role === 'DRIVER') {
        await startQrRotation(socket, tripId);
      }
    };

    socket.on('join-trip', joinTripRoom);
    socket.on('join_trip_room', joinTripRoom);

    const leaveTripRoom = (payload: unknown) => {
      const tripId = extractTripId(payload);
      if (!tripId) return;

      socket.leave(`trip:${tripId}`);
      clearQrTimer(socket.id);
    };

    socket.on('leave-trip', leaveTripRoom);
    socket.on('leave_trip_room', leaveTripRoom);

    const joinBusRoom = (payload: unknown) => {
      const busId = extractBusId(payload);
      if (!busId) return;
      socket.join(`bus:${busId}`);
    };

    socket.on('join-bus', joinBusRoom);
    socket.on('join_bus_room', joinBusRoom);

    const leaveBusRoom = (payload: unknown) => {
      const busId = extractBusId(payload);
      if (!busId) return;
      socket.leave(`bus:${busId}`);
    };

    socket.on('leave-bus', leaveBusRoom);
    socket.on('leave_bus_room', leaveBusRoom);

    const joinRouteRoom = (payload: unknown) => {
      const routeId = extractRouteId(payload);
      if (!routeId) return;
      socket.join(`route:${routeId}`);
    };

    socket.on('join-route', joinRouteRoom);
    socket.on('join_route_room', joinRouteRoom);

    const leaveRouteRoom = (payload: unknown) => {
      const routeId = extractRouteId(payload);
      if (!routeId) return;
      socket.leave(`route:${routeId}`);
    };

    socket.on('leave-route', leaveRouteRoom);
    socket.on('leave_route_room', leaveRouteRoom);

    socket.on('disconnect', () => {
      clearQrTimer(socket.id);
      app.log.info({ event: 'socket_disconnected', socketId: socket.id, userId: principal.sub, type: principal.type });
    });
  });

  return io;
}

export async function closeWebsocket() {
  for (const timer of qrTimers.values()) {
    clearInterval(timer);
  }
  qrTimers.clear();

  if (io) {
    await io.close();
  }

  if (subClient) {
    await subClient.quit();
    subClient = null;
  }
}
