// lib/performance.ts — Performance utilities for mobile app

import { useEffect, useRef } from 'react';
import { InteractionManager } from 'react-native';

/**
 * Measure component render time in development
 */
export function useRenderTiming(componentName: string) {
  if (process.env.NODE_ENV !== 'development') {
    return;
  }

  const renderCount = useRef(0);
  const startTime = useRef(performance.now());

  useEffect(() => {
    renderCount.current += 1;
    const duration = performance.now() - startTime.current;

    if (renderCount.current > 1) {
      console.log(
        `[Performance] ${componentName} re-render #${renderCount.current}: ${duration.toFixed(2)}ms`
      );
    } else {
      console.log(
        `[Performance] ${componentName} initial render: ${duration.toFixed(2)}ms`
      );
    }
  });
}

/**
 * Defer expensive operations until after interactions
 */
export function useDeferredCallback(callback: () => void, delay = 0) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      if (delay > 0) {
        setTimeout(() => callbackRef.current(), delay);
      } else {
        callbackRef.current();
      }
    });

    return () => task.cancel();
  }, [delay]);
}

/**
 * Throttle function for scroll events, etc.
 */
export function throttle<T extends (...args: any[]) => void>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return function (...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

/**
 * Debounce function for search inputs, etc.
 */
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Memoize expensive calculations
 */
export function memoize<T extends (...args: any[]) => any>(
  fn: T
): (...args: Parameters<T>) => ReturnType<T> {
  const cache = new Map();

  return function (...args: Parameters<T>): ReturnType<T> {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      return cache.get(key);
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

/**
 * Performance monitoring for API calls
 */
export function measureApiCall<T>(
  name: string,
  promise: Promise<T>
): Promise<T> {
  const start = performance.now();

  return promise
    .then((result) => {
      const duration = performance.now() - start;
      console.log(`[API] ${name} completed in ${duration.toFixed(2)}ms`);
      return result;
    })
    .catch((error) => {
      const duration = performance.now() - start;
      console.log(`[API] ${name} failed after ${duration.toFixed(2)}ms`);
      throw error;
    });
}

/**
 * Use this for heavy computations that should be done off the main thread
 * Note: React Native doesn't have true web workers, but this schedules
 * work after interactions
 */
export function scheduleHeavyWork<T>(
  work: () => T,
  callback: (result: T) => void
) {
  InteractionManager.runAfterInteractions(() => {
    const result = work();
    callback(result);
  });
}
