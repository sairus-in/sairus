import { AsyncLocalStorage } from 'async_hooks';

type CorrelationContext = {
  requestId: string;
};

export const correlationStore = new AsyncLocalStorage<CorrelationContext>();

export function runWithRequestContext<T>(requestId: string, callback: () => T): T {
  return correlationStore.run({ requestId }, callback);
}

export function enterRequestContext(requestId: string): void {
  correlationStore.enterWith({ requestId });
}

export function getRequestId(): string | undefined {
  return correlationStore.getStore()?.requestId;
}
