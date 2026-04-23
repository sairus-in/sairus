// lib/socket.ts — Socket.io singleton with exponential backoff reconnection
import { io, Socket } from 'socket.io-client';
import { ToastAndroid, Platform } from 'react-native';
import { useAuthStore } from '../store/auth.store';
import { config } from './config';

function showToast(msg: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.LONG);
  }
}

let socket: Socket | null = null;
let authSyncSubscribed = false;
let unsubscribeAuthSync: (() => void) | null = null;

export function bindSocketHandler(
  client: Socket,
  event: string,
  handler: (...args: any[]) => void,
): void {
  client.off(event, handler);
  client.on(event, handler);
}

const ensureSocketAuthSync = () => {
  if (authSyncSubscribed) {
    return;
  }

  authSyncSubscribed = true;

  unsubscribeAuthSync = useAuthStore.subscribe((state, previousState) => {
    if (state.token === previousState.token) {
      return;
    }

    if (!socket) {
      return;
    }

    if (!state.token) {
      socket.disconnect();
      return;
    }

    if (socket.connected) {
      socket.disconnect();
    }

    socket.connect();
  });
};

export const getSocket = (): Socket => {
  ensureSocketAuthSync();

  if (!socket) {
    socket = io(config.socketUrl, {
      auth: (cb) => {
        cb({ token: useAuthStore.getState().token });
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 50,          // [FIX 6] Not Infinity — after 50, show error
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,      // [FIX 6] Max 30s between attempts
      randomizationFactor: 0.5,          // [FIX 6] Jitter — prevents reconnection storm
      timeout: 10_000,
    });

    // After 50 failed attempts, show user a message
    socket.on('reconnect_failed', () => {
      showToast("Can't connect to server. Check your internet connection.");
    });
  }
  return socket;
};

export const disconnectSocket = (): void => {
  socket?.removeAllListeners();
  socket?.disconnect();
  socket = null;
  unsubscribeAuthSync?.();
  unsubscribeAuthSync = null;
  authSyncSubscribed = false;
};
