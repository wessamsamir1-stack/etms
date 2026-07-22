/**
 * Minimal in-process FIFO queue for the notification worker. In production this
 * is backed by Redis/SQS and drained by a separate worker process; the interface
 * (enqueue / drain) stays identical so the service code doesn't change.
 */
export class InMemoryQueue<T> {
  private readonly items: T[] = [];

  enqueue(item: T): void {
    this.items.push(item);
  }

  get size(): number {
    return this.items.length;
  }

  /** Process every queued item in order; returns how many were handled. */
  async drain(handler: (item: T) => Promise<void>): Promise<number> {
    let count = 0;
    for (let item = this.items.shift(); item !== undefined; item = this.items.shift()) {
      await handler(item);
      count += 1;
    }
    return count;
  }
}
