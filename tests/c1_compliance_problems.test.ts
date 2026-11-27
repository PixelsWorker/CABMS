import assert from 'node:assert/strict';
import { test } from 'node:test';
import { complianceProblem, complianceStorageProblem, type ComplianceProblemCode } from '../backend/modules/compliance/problems.ts';

const expected: Record<ComplianceProblemCode, number> = {
  AUTHENTICATION_REQUIRED:401, ACTION_DENIED:403, RESOURCE_NOT_FOUND:404,
  POLICY_UNAVAILABLE:409, LEGACY_MAPPING_REQUIRED:409, HISTORY_IMMUTABLE:409,
  FORM_RULE_INVALID:422, FORM_IN_USE:409, ASSIGNEE_INELIGIBLE:422,
  VISIT_ASSIGNEE_MISMATCH:422, SCHEDULED_VISIT_ASSIGNMENT_CONFLICT:409,
  FINDING_RESOLUTION_REQUIRED:409,
  JOB_STATE_CONFLICT:409, FORM_ALREADY_ASSIGNED:409, RECORD_CONFLICT:500,
  IDEMPOTENCY_KEY_REUSED:409, VERSION_REQUIRED:428, VERSION_CONFLICT:412,
  INVALID_FIELD:422, REFERENCE_INVALID:422, EXCEPTION_DENIED:403, EVIDENCE_INVALID:422,
  UPLOAD_TOO_LARGE:413, SIGNOFF_BLOCKED:409, COMPLETION_BLOCKED:409,
  TEMPORARILY_UNAVAILABLE:503, RATE_LIMITED:429, OPERATION_UNCONFIRMED:500,
  OPERATIONAL_STORAGE_NOT_READY:503,
};

for (const [key, status] of Object.entries(expected)) {
  const code = key as ComplianceProblemCode;
  test('public compliance problem ' + code, async () => {
    const response = complianceProblem(code, 'fixture-request');
    assert.equal(response.status,status);
    assert.equal(response.headers.get('Content-Type'),'application/problem+json');
    assert.equal(response.headers.get('X-Request-Id'),'fixture-request');
    const data = await response.json() as {detail:string;code:string;status:number};
    assert.equal(data.status,status);
    assert.equal(data.code,code);
    assert.ok(data.detail.length > 10);
    assert.doesNotMatch(data.detail,/SQLITE|D1_ERROR/);
  });
}

test('storage mapper recognizes exact guard messages and contains raw SQL errors', () => {
  assert.equal(complianceStorageProblem(new Error('D1_ERROR: COMPLETION_BLOCKED: SQLITE_CONSTRAINT')),'COMPLETION_BLOCKED');
  assert.equal(complianceStorageProblem(new Error('HISTORY_IMMUTABLE')),'HISTORY_IMMUTABLE');
  assert.equal(complianceStorageProblem(new Error('D1_ERROR: UNIQUE constraint failed: compliance_operations.id')),'OPERATION_UNCONFIRMED');
  assert.equal(complianceStorageProblem(new Error('arbitrary text including COMPLETION_BLOCKED')),'OPERATION_UNCONFIRMED');
});
