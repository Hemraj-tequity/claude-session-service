// An async-iterable queue that lets a producer push items for a consumer to read via for-await-of.
export class PushQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private pendingResolve: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;

  // Enqueues an item, handing it directly to a waiting consumer if one is pending.
  push(item: T): void {
    if (this.closed) return;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve({ value: item, done: false });
    } else {
      this.buffer.push(item);
    }
  }

  // Marks the queue closed, signaling completion to any waiting consumer.
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.pendingResolve) {
      const resolve = this.pendingResolve;
      this.pendingResolve = null;
      resolve({ value: undefined, done: true });
    }
  }

  // Provides the async iterator protocol used by for-await-of consumers.
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        if (this.buffer.length > 0) {
          return Promise.resolve({
            value: this.buffer.shift() as T,
            done: false,
          });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise((resolve) => {
          this.pendingResolve = resolve;
        });
      },
    };
  }
}
