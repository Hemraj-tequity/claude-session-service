import { logger } from './logger.js';

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  label?: string;
}

// Pauses execution for the given number of milliseconds.
function waitBeforeRetry(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries an async operation with linear backoff until it succeeds or attempts are exhausted.
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { attempts = 3, baseDelayMs = 100, label = 'operation' } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt, attempts, label }, `${label} failed, retrying`);
      if (attempt < attempts) {
        await waitBeforeRetry(baseDelayMs * attempt);
      }
    }
  }

  throw lastError;
}
