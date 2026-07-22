import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateEligibility, EligibilityInput, EligibilityPolicy } from './eligibility_engine';

const policy: EligibilityPolicy = { serviceRadiusKm: 40, greenMax: 20, amberMax: 60 };

const base: EligibilityInput = {
  employeeStatus: 'active',
  eligibleFlag: true,
  employeeNumberMatches: true,
  hasActiveTransportBlock: false,
  employmentEnded: false,
  isResidenceMember: false,
  homeLocationKnown: true,
  homeDistanceKm: 10,
};

test('clean residence member is auto-approved (green)', () => {
  const r = evaluateEligibility({ ...base, isResidenceMember: true, homeDistanceKm: null }, policy);
  assert.equal(r.band, 'green');
  assert.equal(r.outcome, 'approved');
  assert.equal(r.riskScore, 0);
});

test('private home within radius, clean → green', () => {
  const r = evaluateEligibility(base, policy);
  assert.equal(r.band, 'green');
});

test('home well over the radius → amber (needs review)', () => {
  const r = evaluateEligibility({ ...base, homeDistanceKm: 45 }, policy); // 5 km over → +40
  assert.equal(r.riskScore, 40);
  assert.equal(r.band, 'amber');
  assert.equal(r.outcome, 'needs_review');
});

test('transport block is a hard reject regardless of score', () => {
  const r = evaluateEligibility({ ...base, hasActiveTransportBlock: true }, policy);
  assert.equal(r.band, 'red');
  assert.equal(r.outcome, 'rejected');
  assert.ok(r.reasons.includes('hard_gate_failed:no_transport_block'));
});

test('ended employment is a hard reject', () => {
  const r = evaluateEligibility({ ...base, employmentEnded: true }, policy);
  assert.equal(r.band, 'red');
  assert.ok(r.reasons.includes('hard_gate_failed:employment_active'));
});

test('ineligible flag / number mismatch / no pickup basis are hard rejects', () => {
  assert.equal(evaluateEligibility({ ...base, eligibleFlag: false }, policy).band, 'red');
  assert.equal(evaluateEligibility({ ...base, employeeNumberMatches: false }, policy).band, 'red');
  assert.equal(
    evaluateEligibility({ ...base, isResidenceMember: false, homeLocationKnown: false }, policy).band,
    'red',
  );
});

test('residence membership reduces risk (offsets a soft flag)', () => {
  const withoutRes = evaluateEligibility({ ...base, missingOrExpiredDoc: true }, policy); // +20 → green edge
  const withRes = evaluateEligibility({ ...base, missingOrExpiredDoc: true, isResidenceMember: true }, policy); // 20-20=0
  assert.equal(withoutRes.riskScore, 20);
  assert.equal(withRes.riskScore, 0);
});

test('multiple serious soft flags push past amber into red', () => {
  const r = evaluateEligibility(
    { ...base, homeDistanceKm: 50, aiDocumentMismatch: true, missingOrExpiredDoc: true },
    policy,
  ); // (10 over *8=80) + 25 + 20 = 125 → clamped 100
  assert.equal(r.riskScore, 100);
  assert.equal(r.band, 'red');
});
