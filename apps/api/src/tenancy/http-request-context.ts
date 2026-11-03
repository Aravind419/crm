import { AsyncLocalStorage } from 'async_hooks';

export interface HttpRequestStore {
  requestId: string;
  path: string;
  method: string;
  ip?: string;
  timestamp: number;
}

export const httpRequestStorage = new AsyncLocalStorage<HttpRequestStore>();

/**
 * Returns true if the current execution is within an active HTTP request context.
 */
export function isHttpRequestActive(): boolean {
  return httpRequestStorage.getStore() !== undefined;
}

/**
 * Returns the active HTTP request context, or undefined if outside HTTP execution.
 */
export function getHttpRequestStore(): HttpRequestStore | undefined {
  return httpRequestStorage.getStore();
}
