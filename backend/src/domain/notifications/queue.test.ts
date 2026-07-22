import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InMemoryQueue } from './queue';

test('drains items in FIFO order and empties the queue', async () => {
  const q = new InMemoryQueue<number>();
  q.enqueue(1);
  q.enqueue(2);
  q.enqueue(3);
  assert.equal(q.size, 3);

  const seen: number[] = [];
  const handled = await q.drain(async (n) => {
    seen.push(n);
  });
  assert.equal(handled, 3);
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(q.size, 0);
});

test('drain on an empty queue handles nothing', async () => {
  const q = new InMemoryQueue<number>();
  assert.equal(await q.drain(async () => {}), 0);
});
