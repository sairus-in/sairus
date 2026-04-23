// lib/checkin-queue.ts — Offline check-in queue persisted to AsyncStorage (HARDENED v3)
// Hardening: dedup guard, flush lock, queue size cap, structured logging, 
// readQueueSafe integrity checks, and parallel batch flushing.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as uuid from 'uuid'; // v4 required
import { ToastAndroid, Platform } from 'react-native';
import { ApiError, api } from './api.client';
import { queryClient } from './query-client';
import { analytics } from './analytics';
import { CHECKIN_QUEUE_KEY } from './persisted-cache';

function showToast(msg: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.LONG);
  }
}

interface QueuedCheckin {
  id: string;
  qrToken: string;
  lat: number | null;
  lon: number | null;
  accuracy: number | null;
  isLowTrust: boolean;     // [NEW v3] explicit trust signal
  gpsState: string;        // [NEW v3] for backend logging
  clientTimestamp: number;
  queuedAt: number;
  retries: number;
  status: 'pending' | 'retrying' | 'failed';
}

const MAX_AGE_MS = 90 * 60 * 1000;    // 90 minutes
const MAX_RETRIES = 3;
const CONCURRENCY = 3;                // [NEW v3] max parallel flush
const MAX_QUEUE_SIZE = 5;             // Cap queue to prevent runaway accumulation

// HARDENED: Flush lock to prevent concurrent flush operations
let isFlushing = false;

// Integrity check — handles crash mid-write
const readQueueSafe = async (): Promise<QueuedCheckin[]> => {
  try {
    const raw = await AsyncStorage.getItem(CHECKIN_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      analytics.track('queue_corruption_detected');
      await AsyncStorage.removeItem(CHECKIN_QUEUE_KEY);
      return [];
    }
    return parsed.filter(item => item.id && item.qrToken && item.clientTimestamp);
  } catch {
    analytics.track('queue_read_failure');
    return [];
  }
};

async function saveQueue(queue: QueuedCheckin[]): Promise<void> {
  await AsyncStorage.setItem(CHECKIN_QUEUE_KEY, JSON.stringify(queue));
}

// Process a single queue item — returns item if it needs retry, null if done
const processQueueItem = async (item: QueuedCheckin): Promise<QueuedCheckin | null> => {
  if (Date.now() - item.queuedAt > MAX_AGE_MS) {
    analytics.track('checkin_queue_expired', { age: Date.now() - item.queuedAt });
    showToast("A check-in from earlier couldn't be synced — request a correction.");
    return null; // drop expired item
  }

  try {
    await api.post(
      '/v1/attendance/checkin',
      {
        qrToken: item.qrToken,
        lat: item.lat,
        lon: item.lon,
        accuracy: item.accuracy,
        isLowTrust: item.isLowTrust,
        gpsState: item.gpsState,
        clientTimestamp: item.clientTimestamp,
        isReplay: true,
      },
      {
        headers: {
          'Idempotency-Key': item.id,
        },
      },
    );
    showToast('Check-in synced ✓');
    analytics.track('checkin_queue_synced');
    // Invalidate queries directly since we successfully synced
    queryClient.invalidateQueries({ queryKey: ['student-home'] });
    return null; // success — drop item

  } catch (error: unknown) {
    const status = error instanceof ApiError ? error.status : undefined;
    const code = error instanceof ApiError ? error.code : 'UNKNOWN';

    if (status === 409 && code === 'ALREADY_CHECKED_IN') {
      showToast('Already marked present ✓');
      queryClient.invalidateQueries({ queryKey: ['student-home'] });
      return null; // already counted — success

    } else if (status === 410 || code === 'TRIP_EXPIRED') {
      showToast("Check-in couldn't be synced — trip has ended.");
      analytics.track('checkin_queue_trip_expired');
      return null; // unrecoverable — drop item

    } else if (item.retries < MAX_RETRIES) {
      return { ...item, retries: item.retries + 1, status: 'retrying' }; // keep for retry

    } else {
      showToast('Check-in failed after multiple attempts.');
      analytics.track('checkin_queue_max_retries', { code: code || 'UNKNOWN' });
      return null; // give up — drop item
    }
  }
};

export const checkinQueue = {
  add: async (payload: Omit<QueuedCheckin, 'id' | 'queuedAt' | 'retries' | 'status'>): Promise<void> => {
    const queue = await readQueueSafe();

    const isDuplicate = queue.some(item => item.qrToken === payload.qrToken);
    if (isDuplicate) {
      analytics.track('queue_duplicate_prevented');
      return;
    }

    if (queue.length >= MAX_QUEUE_SIZE) {
      showToast('Too many offline scans. Please reconnect.');
      return;
    }

    const item: QueuedCheckin = {
      ...payload,
      id: uuid.v4(),
      queuedAt: Date.now(),
      retries: 0,
      status: 'pending',
    };

    await saveQueue([...queue, item]);
    analytics.track('checkin_queued_offline');
  },

  // [NEW v3] Parallel flush — max CONCURRENCY concurrent requests
  flush: async (): Promise<void> => {
    if (isFlushing) return;
    isFlushing = true;

    try {
      const queue = await readQueueSafe();
      if (!queue.length) return;

      analytics.track('queue_parallel_flush_start', { count: queue.length });

      const remaining: QueuedCheckin[] = [];

      // Process in chunks of CONCURRENCY (3)
      for (let i = 0; i < queue.length; i += CONCURRENCY) {
        const chunk = queue.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(chunk.map(processQueueItem));

        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value !== null) {
            remaining.push(result.value); // item needs retry
          }
          // rejected = unexpected error — drop item, log it
          if (result.status === 'rejected') {
            analytics.track('queue_item_unexpected_error');
          }
        });
      }

      await saveQueue(remaining);
    } finally {
      isFlushing = false;
    }
  },

  // Returns count of pending items — used for home screen badge
  count: async (): Promise<number> => {
    const queue = await readQueueSafe();
    return queue.length;
  },

  init: async () => {
    const queue = await readQueueSafe();
    if (queue.length > 0) {
      analytics.track('queue_found_on_startup', { count: queue.length });
    }
    // Network verification handled via explicit hook call elsewhere
  },
};
