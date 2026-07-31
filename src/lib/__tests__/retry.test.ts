import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../logger.js', () => ({
  logger: { warn: vi.fn() },
}));

import { withRetry } from '../retry.js';
import { logger } from '../logger.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns the result on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValueOnce('recovered');

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('throws the last error once all attempts are exhausted', async () => {
    const err = new Error('always fails');
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, { attempts: 3, baseDelayMs: 10, label: 'thing' });
    // Swallow the eventual rejection so it isn't reported as unhandled while timers advance.
    const assertion = expect(promise).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(20);
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err, attempt: 1, attempts: 3, label: 'thing' }),
      'thing failed, retrying',
    );
  });

  it('does not sleep after the final failed attempt', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn, { attempts: 1, baseDelayMs: 1000 });
    await expect(promise).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default options when none are provided', async () => {
    const err = new Error('boom');
    const fn = vi.fn().mockRejectedValue(err);

    const promise = withRetry(fn);
    const assertion = expect(promise).rejects.toBe(err);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    await assertion;

    expect(fn).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'operation' }),
      'operation failed, retrying',
    );
  });
});
