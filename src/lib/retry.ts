import { logger } from './logger.js';
import {
  DEFAULT_RETRY_ATTEMPTS,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_LABEL,
  ERROR_MESSAGES,
} from '../constants/index.js';

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
  const {
    attempts = DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
    label = DEFAULT_RETRY_LABEL,
  } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      logger.warn({ err, attempt, attempts, label }, ERROR_MESSAGES.retryFailed(label));
      if (attempt < attempts) {
        await waitBeforeRetry(baseDelayMs * attempt);
      }
    }
  }

  throw lastError;
}
