import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FixedWindowLimiter } from './rate_limit';

test('allows up to max within the window, then blocks', () => {
  const l = new FixedWindowLimiter(1000, 3);
  assert.equal(l.check('ip', 0).allowed, true);
  assert.equal(l.check('ip', 10).allowed, true);
  assert.equal(l.check('ip', 20).allowed, true);
  const blocked = l.check('ip', 30);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterMs > 0);
});

test('resets after the window elapses', () => {
  const l = new FixedWindowLimiter(1000, 1);
  assert.equal(l.check('ip', 0).allowed, true);
  assert.equal(l.check('ip', 500).allowed, false);
  assert.equal(l.check('ip', 1001).allowed, true); // new window
});

test('keys are independent', () => {
  const l = new FixedWindowLimiter(1000, 1);
  assert.equal(l.check('a', 0).allowed, true);
  assert.equal(l.check('b', 0).allowed, true);
  assert.equal(l.check('a', 0).allowed, false);
});
