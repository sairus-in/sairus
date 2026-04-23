import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export const getAdminSocket = (): Socket => {
  if (!socket) {
    socket = io(import.meta.env.VITE_API_URL || 'http://localhost:3000', {
      withCredentials: true,
      transports: ['websocket'],
      reconnectionAttempts: 50,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });

    socket.on('connect', () => {
      console.log('✅ Admin socket connected');
      socket?.emit('join-admin');
    });

    socket.on('reconnect', () => {
      console.log('🔄 Admin socket reconnected');
      socket?.emit('join-admin');
    });

    socket.on('reconnect_failed', () => {
      console.error('❌ Lost server connection permanently');
    });
  }
  return socket;
};

export const joinTripRoom = (tripId: string) => {
  getAdminSocket().emit('join-trip', { tripId });
};

export const leaveTripRoom = (tripId: string) => {
  getAdminSocket().emit('leave-trip', { tripId });
};

export const disconnectAdminSocket = () => {
  if (!socket) {
    return;
  }

  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
};
