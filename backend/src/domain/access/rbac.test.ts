import assert from 'node:assert/strict';
import { test } from 'node:test';
import { can, canAll, canAny, inSiteScope, Principal } from './rbac';

const p: Principal = {
  userId: 'u1',
  tenantId: 't1',
  permissions: new Set(['trip.read', 'trip.dispatch']),
  scopeSiteIds: ['siteA'],
};

test('can / canAll / canAny', () => {
  assert.equal(can(p, 'trip.dispatch'), true);
  assert.equal(can(p, 'erp.export'), false);
  assert.equal(canAll(p, ['trip.read', 'trip.dispatch']), true);
  assert.equal(canAll(p, ['trip.read', 'erp.export']), false);
  assert.equal(canAny(p, ['erp.export', 'trip.read']), true);
});

test('ABAC site scope', () => {
  assert.equal(inSiteScope(p, 'siteA'), true);
  assert.equal(inSiteScope(p, 'siteB'), false);
  const wide: Principal = { ...p, scopeSiteIds: null };
  assert.equal(inSiteScope(wide, 'anySite'), true);
});
