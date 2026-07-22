import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveWaitSeconds, manifestCounts, commuteMessages, DEFAULT_WAIT_SECONDS } from './manifest';

test('effectiveWaitSeconds: route override > tenant policy > default', () => {
  assert.equal(effectiveWaitSeconds(60, 180), 60);
  assert.equal(effectiveWaitSeconds(null, 180), 180);
  assert.equal(effectiveWaitSeconds(null, null), DEFAULT_WAIT_SECONDS);
  assert.equal(effectiveWaitSeconds(0, 180), 0); // an explicit 0 is respected
});

test('manifestCounts: attendance, not seats', () => {
  const c = manifestCounts(['expected', 'on_the_way', 'boarded', 'boarded', 'no_show', 'on_leave', 'excused', 'removed']);
  assert.equal(c.boarded, 2);
  assert.equal(c.onTheWay, 1);
  assert.equal(c.noShow, 1);
  assert.equal(c.excused, 2); // excused + on_leave
  assert.equal(c.remaining, 2); // expected(1) + on_the_way(1) still awaited
  assert.equal(c.total, 8);
});

test('bilingual commute messages', () => {
  assert.match(commuteMessages.arrival('ar'), /وصل باص/);
  assert.match(commuteMessages.arrival('en'), /has arrived/);
  assert.match(commuteMessages.preArrival(10, 'ar'), /10/);
  assert.match(commuteMessages.noShow('en'), /No-Show/);
  assert.match(commuteMessages.onTheWay('Mona', 'en'), /Mona is on the way/);
});
