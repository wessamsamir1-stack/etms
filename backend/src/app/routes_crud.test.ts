import assert from 'node:assert/strict';
import { test } from 'node:test';
import { siteScope } from './routes_crud';

// The branch-scope filter (ABAC). A resource with a siteColumn is limited to the
// principal's scope_site_ids; unscoped principals and non-branch resources are
// never filtered. (The effective scope itself is computed in SQL — V0025 — and
// verified live.)
const scopedR = { siteColumn: 'default_site_id' };
const plainR = {}; // no siteColumn — not branch-linked

test('a scoped principal on a branch resource yields the ANY() filter', () => {
  const s = siteScope({ scopeSiteIds: ['a', 'b'] }, scopedR, 3);
  assert.deepEqual(s, { clause: 'default_site_id = ANY($3)', value: ['a', 'b'] });
});

test('an unscoped principal (null or empty) is never filtered', () => {
  assert.equal(siteScope({ scopeSiteIds: null }, scopedR, 1), null);
  assert.equal(siteScope({ scopeSiteIds: [] }, scopedR, 1), null);
  assert.equal(siteScope({}, scopedR, 1), null);
});

test('a resource with no siteColumn is never filtered, even for a scoped principal', () => {
  assert.equal(siteScope({ scopeSiteIds: ['a'] }, plainR, 1), null);
});

test('the parameter index is threaded into the clause', () => {
  assert.equal(siteScope({ scopeSiteIds: ['x'] }, { siteColumn: 'id' }, 7)?.clause, 'id = ANY($7)');
});
