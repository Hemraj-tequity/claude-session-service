import { describe, it, expect } from 'vitest';
import { PushQueue } from '../inputQueue.js';

describe('PushQueue', () => {
  it('yields items pushed before iteration starts, in order', async () => {
    const queue = new PushQueue<number>();
    queue.push(1);
    queue.push(2);

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: 2, done: false });
  });

  it('resolves a pending next() as soon as an item is pushed', async () => {
    const queue = new PushQueue<string>();
    const iterator = queue[Symbol.asyncIterator]();

    const pending = iterator.next();
    queue.push('later');

    await expect(pending).resolves.toEqual({ value: 'later', done: false });
  });

  it('supports being consumed via for-await-of across multiple pushes', async () => {
    const queue = new PushQueue<number>();
    const seen: number[] = [];

    const consumer = (async () => {
      for await (const item of queue) {
        seen.push(item);
        if (seen.length === 3) break;
      }
    })();

    queue.push(1);
    queue.push(2);
    queue.push(3);

    await consumer;
    expect(seen).toEqual([1, 2, 3]);
  });

  it('signals done immediately once closed with an empty buffer', async () => {
    const queue = new PushQueue<number>();
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('drains any buffered items before reporting done after close', async () => {
    const queue = new PushQueue<number>();
    queue.push(1);
    queue.close();

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: 1, done: false });
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('resolves a pending next() with done when closed while waiting', async () => {
    const queue = new PushQueue<number>();
    const iterator = queue[Symbol.asyncIterator]();
    const pending = iterator.next();

    queue.close();

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  it('ignores pushes after close', async () => {
    const queue = new PushQueue<number>();
    queue.close();
    queue.push(99);

    const iterator = queue[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
  });

  it('is idempotent when closed more than once', () => {
    const queue = new PushQueue<number>();
    queue.close();
    expect(() => queue.close()).not.toThrow();
  });
});
