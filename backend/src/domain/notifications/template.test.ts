import assert from 'node:assert/strict';
import { test } from 'node:test';
import { render, withinLimit } from './template';
import { NotificationDispatcher, InMemoryProvider } from './channels';

test('renders placeholders and reports missing vars', () => {
  const r = render('Hi {{name}}, pickup at {{time}} from {{stop}}', {
    name: 'Sara',
    time: '05:40',
  });
  assert.equal(r.text, 'Hi Sara, pickup at 05:40 from ');
  assert.deepEqual(r.missing, ['stop']);
});

test('enforces channel length limits', () => {
  assert.equal(withinLimit('sms', 'x'.repeat(100)), true);
  assert.equal(withinLimit('sms', 'x'.repeat(1000)), false);
});

test('dispatcher routes to the registered provider', async () => {
  const sms = new InMemoryProvider('sms');
  const dispatcher = new NotificationDispatcher().register(sms);
  const res = await dispatcher.dispatch({ channel: 'sms', to: '+96550000000', body: 'hi' });
  assert.equal(res.ok, true);
  assert.equal(sms.sent.length, 1);
  assert.equal(sms.sent[0]!.body, 'hi');
});

test('dispatcher fails cleanly when no provider is registered', async () => {
  const res = await new NotificationDispatcher().dispatch({
    channel: 'email',
    to: 'a@b.com',
    body: 'hi',
  });
  assert.equal(res.ok, false);
});
