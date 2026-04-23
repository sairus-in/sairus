import { redis } from './redis';

/**
 * Phase 3.4: Internal Metrics Aggregator
 * Provides a lightweight Prometheus-compatible metric exposure pattern backed by Redis.
 * Tracks Counters and Gauges with label-based dimensionality.
 */
export const metrics = {
  /** Increment a monotonically increasing counter */
  inc: async (metricName: string, labels: Record<string, string> = {}, incrementBy = 1) => {
    try {
      const labelKeys = Object.keys(labels).sort();
      const labelStr = labelKeys.map(k => `${k}:${labels[k]}`).join(':');
      const key = `metric:${metricName}${labelStr ? `:${labelStr}` : ''}`;
      
      if (incrementBy === 1) {
        await redis.incr(key);
      } else {
        await redis.incrby(key, incrementBy);
      }
    } catch (e) {
      // Metrics should never crash the main application thread
    }
  },
  
  /** Directly set a gauge value (e.g. current memory, active connections) */
  gaugeSet: async (metricName: string, value: number, labels: Record<string, string> = {}) => {
    try {
      const labelKeys = Object.keys(labels).sort();
      const labelStr = labelKeys.map(k => `${k}:${labels[k]}`).join(':');
      const key = `metric:${metricName}${labelStr ? `:${labelStr}` : ''}`;
      await redis.set(key, value.toString());
    } catch (e) {}
  },

  /** Increment a gauge value (e.g. active delegations) */
  gaugeInc: async (metricName: string, labels: Record<string, string> = {}) => {
    try {
      const labelKeys = Object.keys(labels).sort();
      const labelStr = labelKeys.map(k => `${k}:${labels[k]}`).join(':');
      const key = `metric:${metricName}${labelStr ? `:${labelStr}` : ''}`;
      await redis.incr(key);
    } catch (e) {}
  },

  /** Decrement a gauge value */
  gaugeDec: async (metricName: string, labels: Record<string, string> = {}) => {
    try {
      const labelKeys = Object.keys(labels).sort();
      const labelStr = labelKeys.map(k => `${k}:${labels[k]}`).join(':');
      const key = `metric:${metricName}${labelStr ? `:${labelStr}` : ''}`;
      await redis.decr(key);
    } catch (e) {}
  },

  increment(metricName: string, labels: Record<string, string> = {}, incrementBy = 1) {
    return this.inc(metricName, labels, incrementBy);
  },

  gauge(metricName: string, value: number, labels: Record<string, string> = {}) {
    return this.gaugeSet(metricName, value, labels);
  },
};
