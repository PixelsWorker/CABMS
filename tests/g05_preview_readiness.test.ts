import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPendingPreviewForms, getInvalidPreviewForms, isValidPreviewSignOff } from '../src/utils/g05PreviewReadiness.ts';
import { INITIAL_ELECTRICAL_CERT } from '../src/data/seedData.ts';

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
