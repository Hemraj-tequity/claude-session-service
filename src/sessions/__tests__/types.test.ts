import { describe, it, expect } from 'vitest';
import { createDeferred } from '../types.js';

describe('createDeferred', () => {
  it('returns a promise and a resolve function', () => {
    const deferred = createDeferred<number>();
    expect(deferred.promise).toBeInstanceOf(Promise);
    expect(typeof deferred.resolve).toBe('function');
  });

  it('resolves the promise with the value passed to resolve', async () => {
    const deferred = createDeferred<string>();
    deferred.resolve('done');
    await expect(deferred.promise).resolves.toBe('done');
  });

  it('resolves with undefined when used as void', async () => {
    const deferred = createDeferred();
    deferred.resolve();
    await expect(deferred.promise).resolves.toBeUndefined();
  });

  it('is independent across separate calls', async () => {
    const a = createDeferred<number>();
    const b = createDeferred<number>();
    a.resolve(1);
    b.resolve(2);
    await expect(a.promise).resolves.toBe(1);
    await expect(b.promise).resolves.toBe(2);
  });
});
