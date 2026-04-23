import { AdminLiveAlert } from 'shared';
import { redis } from './redis';

export const publishAdminAlert = async (alert: AdminLiveAlert): Promise<void> => {
  await redis.zadd('admin:alerts', alert.timestamp, JSON.stringify(alert));
};
