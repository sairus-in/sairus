import { reconcileDashboardStats } from './reconcile-dashboard-stats.job';

export const reconcileRedis = async () => {
  await reconcileDashboardStats();
};
