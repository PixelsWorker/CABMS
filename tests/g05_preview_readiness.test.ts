import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPendingPreviewForms, getInvalidPreviewForms, isValidPreviewSignOff } from '../src/utils/g05PreviewReadiness.ts';
import { INITIAL_ELECTRICAL_CERT, INITIAL_JSA_FORM } from '../src/data/seedData.ts';

test('preview reports only required forms without inventing requirements', () => {
  assert.deepEqual(getPendingPreviewForms([], {}), []);
  assert.deepEqual(getPendingPreviewForms(['JSA', 'TCA1'], { JSA: true, TCA1: false, ELECTRICAL: false }), ['TCA1']);
  assert.deepEqual(getPendingPreviewForms(['JSA', 'JSA', 'TCA2'], { JSA: false }), ['JSA', 'TCA2']);
});


test('preview sign-off requires the expected job and an intact snapshot', () => {
  const snapshot = INITIAL_ELECTRICAL_CERT.fullSnapshot;
  assert.equal(isValidPreviewSignOff('ELECTRICAL', 'JOB-2026-103', true, snapshot), true);
  assert.equal(isValidPreviewSignOff('ELECTRICAL', 'JOB-OTHER', true, snapshot), false);
  assert.equal(isValidPreviewSignOff('ELECTRICAL', 'JOB-2026-103', true, '{bad'), false);
  assert.equal(isValidPreviewSignOff('ELECTRICAL', 'JOB-2026-103', false, snapshot), false);
});


test('invalid signed preview snapshots are distinct from unsigned forms', () => {
  const required = ['JSA', 'TCA1'] as const;
  const flags = { JSA: true, TCA1: false };
  assert.deepEqual(getPendingPreviewForms(required, flags), ['TCA1']);
  assert.deepEqual(getInvalidPreviewForms(required, flags, { JSA: false }), ['JSA']);
  assert.deepEqual(getInvalidPreviewForms(required, flags, { JSA: true }), []);
});


test('preview readiness rejects snapshots with invalid top-level classification enums', () => {
  const invalidJsa = {
    ...INITIAL_JSA_FORM,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 09:30',
    frozenIssuerSnapshot: 'Solarcell Pty Ltd',
    overallRiskLevel: 'UNKNOWN',
  };
  const valid = isValidPreviewSignOff('JSA', 'JOB-2026-101', true, JSON.stringify(invalidJsa));
  assert.equal(valid, false);
  assert.deepEqual(
    getInvalidPreviewForms(['JSA'], { JSA: true }, { JSA: valid }),
    ['JSA'],
  );
});

test('preview readiness rejects JSA snapshots with empty steps or unconfirmed induction competency', () => {
  const baseJsa = {
    ...INITIAL_JSA_FORM,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 09:30',
    frozenIssuerSnapshot: 'Solarcell Pty Ltd',
  };

  const emptyStepsJsa = { ...baseJsa, steps: [] };
  const validEmptySteps = isValidPreviewSignOff('JSA', 'JOB-2026-101', true, JSON.stringify(emptyStepsJsa));
  assert.equal(validEmptySteps, false);
  assert.deepEqual(getInvalidPreviewForms(['JSA'], { JSA: true }, { JSA: validEmptySteps }), ['JSA']);

  const unconfirmedInduction = { ...baseJsa, inductionCompleted: false };
  const validInduction = isValidPreviewSignOff('JSA', 'JOB-2026-101', true, JSON.stringify(unconfirmedInduction));
  assert.equal(validInduction, false);
  assert.deepEqual(getInvalidPreviewForms(['JSA'], { JSA: true }, { JSA: validInduction }), ['JSA']);

  const unconfirmedCompetency = { ...baseJsa, competencyVerified: false };
  const validCompetency = isValidPreviewSignOff('JSA', 'JOB-2026-101', true, JSON.stringify(unconfirmedCompetency));
  assert.equal(validCompetency, false);
  assert.deepEqual(getInvalidPreviewForms(['JSA'], { JSA: true }, { JSA: validCompetency }), ['JSA']);
});
