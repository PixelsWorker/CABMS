import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  calculateReminderDueTime,
  processOfficeReviewTca2,
  processCustomerAckTca2,
  recalculateJobAttachments,
  processPublishTemplate,
  processReviewDispatch,
  validateSignedSnapshot,
  stripAffirmativeComplianceNotes,
  DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE,
  SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE,
  STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE,
  validateQuoteInput,
  calculateQuoteTotals,
  roundedLineTotalCents,
  amountInCents,
} from './cabmsLogic.ts';
import { Job, Customer, TemplateSetting, SmokeAlarmCertData, ElectricalCertData } from '../types/cabms.ts';
import {
  INITIAL_ELECTRICAL_CERT,
  INITIAL_JSA_FORM,
  INITIAL_SMOKE_ALARM_CERT,
  INITIAL_TCA1_CERT,
  INITIAL_TCA2_CERT,
  INITIAL_JOBS,
} from '../data/seedData.ts';

test('validateSignedSnapshot accepts all five CABMS signed form schemas', () => {
  const signedJsa = {
    ...INITIAL_JSA_FORM,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 09:30',
    frozenIssuerSnapshot: 'Solarcell Pty Ltd • ABN 12 (Fictional)',
  };
  const seededTca2Snapshot = JSON.parse(INITIAL_TCA2_CERT.fullSnapshot!);
  const normalizedTca2Snapshot = JSON.stringify({
    ...seededTca2Snapshot,
    customerAcknowledged: INITIAL_TCA2_CERT.customerAcknowledged,
    officeReviewCompleted: INITIAL_TCA2_CERT.officeReviewCompleted,
  });
  const signedForms = [
    ['JSA', 'JOB-2026-101', JSON.stringify(signedJsa)],
    ['ELECTRICAL', INITIAL_ELECTRICAL_CERT.jobReference, INITIAL_ELECTRICAL_CERT.fullSnapshot],
    ['SMOKE_ALARM', INITIAL_SMOKE_ALARM_CERT.jobReference, INITIAL_SMOKE_ALARM_CERT.fullSnapshot],
    ['TCA1', INITIAL_TCA1_CERT.jobReference, INITIAL_TCA1_CERT.fullSnapshot],
    ['TCA2', INITIAL_TCA2_CERT.jobReference, normalizedTca2Snapshot],
  ] as const;

  for (const [formType, jobId, snapshot] of signedForms) {
    const result = validateSignedSnapshot(snapshot, jobId, formType);
    assert.equal(result.valid, true, `${formType} seed schema should validate: ${result.error || ''}`);
  }
});

test('validateSignedSnapshot rejects invalid synthetic smoke alarm test results', () => {
  const valid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  assert.ok(valid.alarmSchedule.length > 0);
  for (const [field, value] of [['passFail', null], ['buttonTestPass', 'false'], ['interconnectionPass', null]] as const) {
    const invalid = structuredClone(valid);
    invalid.alarmSchedule[0][field] = value;
    assert.equal(validateSignedSnapshot(JSON.stringify(invalid), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid, false, field);
  }
  for (const outcome of ['Pass', 'Fail'] as const) {
    const validOutcome = structuredClone(valid);
    validOutcome.alarmSchedule[0].passFail = outcome;
    validOutcome.alarmSchedule[0].buttonTestPass = outcome === 'Pass';
    validOutcome.alarmSchedule[0].interconnectionPass = outcome === 'Pass';
    validOutcome.alarmSchedule[0].complianceStatusProvisional = outcome;
    if (outcome === 'Fail') validOutcome.limitationsAndRentalNotes = STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE;
    assert.equal(
      validateSignedSnapshot(JSON.stringify(validOutcome), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid,
      true,
      `${outcome} is a valid recorded test outcome`,
    );
  }
});

test('validateSignedSnapshot rejects contradictory smoke alarm test results', () => {
  const valid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);

  const failedButton = structuredClone(valid);
  failedButton.alarmSchedule[0].passFail = 'Pass';
  failedButton.alarmSchedule[0].buttonTestPass = false;
  assert.equal(validateSignedSnapshot(JSON.stringify(failedButton), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid, false);

  const failedInterconnection = structuredClone(valid);
  failedInterconnection.alarmSchedule[0].passFail = 'Pass';
  failedInterconnection.alarmSchedule[0].interconnectionPass = false;
  assert.equal(validateSignedSnapshot(JSON.stringify(failedInterconnection), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid, false);

  const failedCompliancePass = structuredClone(valid);
  failedCompliancePass.alarmSchedule[0].passFail = 'Fail';
  failedCompliancePass.alarmSchedule[0].buttonTestPass = false;
  failedCompliancePass.alarmSchedule[0].complianceStatusProvisional = 'Pass';
  assert.equal(validateSignedSnapshot(JSON.stringify(failedCompliancePass), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid, false);
});

test('validateSignedSnapshot rejects contradictory electrical work results when tests failed', () => {
  const valid = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);

  const failedPolarity = structuredClone(valid);
  failedPolarity.testedWorkItems[0].polarityTest = 'Fail';
  failedPolarity.testedWorkItems[0].workResult = 'Pass';
  assert.equal(validateSignedSnapshot(JSON.stringify(failedPolarity), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid, false);

  const failedEarth = structuredClone(valid);
  failedEarth.testedWorkItems[0].earthContinuity = 'Fail';
  failedEarth.testedWorkItems[0].workResult = 'Pass';
  assert.equal(validateSignedSnapshot(JSON.stringify(failedEarth), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid, false);
});

test('validateSignedSnapshot accepts genuine failed smoke alarm inspection and mixed results without false positives', () => {
  const base = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);

  // Legitimate failed alarm: failure evidence preserved and consistent
  const failedAlarm = structuredClone(base);
  failedAlarm.limitationsAndRentalNotes = STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE;
  failedAlarm.alarmSchedule[0].passFail = 'Fail';
  failedAlarm.alarmSchedule[0].buttonTestPass = false;
  failedAlarm.alarmSchedule[0].interconnectionPass = false;
  failedAlarm.alarmSchedule[0].complianceStatusProvisional = 'Fail';
  const failedResult = validateSignedSnapshot(JSON.stringify(failedAlarm), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
  assert.equal(failedResult.valid, true, 'Genuine failed alarm inspection is valid to sign off');

  // Mixed schedule: ALM-1 Fail, ALM-2 Pass, ALM-3 Pass, ALM-4 Pass
  const mixedAlarm = structuredClone(base);
  mixedAlarm.limitationsAndRentalNotes = STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE;
  mixedAlarm.alarmSchedule[0].passFail = 'Fail';
  mixedAlarm.alarmSchedule[0].buttonTestPass = false;
  mixedAlarm.alarmSchedule[0].complianceStatusProvisional = 'Fail';
  // ALM-2 is Pass
  mixedAlarm.alarmSchedule[1].passFail = 'Pass';
  mixedAlarm.alarmSchedule[1].buttonTestPass = true;
  mixedAlarm.alarmSchedule[1].interconnectionPass = true;
  mixedAlarm.alarmSchedule[1].complianceStatusProvisional = 'Pass';
  const mixedResult = validateSignedSnapshot(JSON.stringify(mixedAlarm), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
  assert.equal(mixedResult.valid, true, 'Mixed pass/fail smoke alarm inspection is valid to sign off');

  // Confirm false-positive certificate result is rejected
  const falsePositive = structuredClone(base);
  falsePositive.alarmSchedule[0].passFail = 'Pass'; // Claims Pass despite failed button test
  falsePositive.alarmSchedule[0].buttonTestPass = false;
  assert.equal(validateSignedSnapshot(JSON.stringify(falsePositive), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid, false);
});

test('validateSignedSnapshot accepts genuine failed electrical tests and mixed results without false positives', () => {
  const base = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);

  // Legitimate failed polarity test
  const failedPolarity = structuredClone(base);
  failedPolarity.testedWorkItems[0].polarityTest = 'Fail';
  failedPolarity.testedWorkItems[0].workResult = 'Fail';
  const polarityResult = validateSignedSnapshot(JSON.stringify(failedPolarity), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
  assert.equal(polarityResult.valid, true, 'Genuine polarity failure with Fail workResult is valid to sign off');

  // Legitimate failed earth continuity test
  const failedEarth = structuredClone(base);
  failedEarth.testedWorkItems[0].earthContinuity = 'Fail';
  failedEarth.testedWorkItems[0].workResult = 'Fail';
  const earthResult = validateSignedSnapshot(JSON.stringify(failedEarth), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
  assert.equal(earthResult.valid, true, 'Genuine earth continuity failure with Fail workResult is valid to sign off');

  // Mixed items: WORK-1 Fail, WORK-2 Pass
  const mixedElec = structuredClone(base);
  mixedElec.testedWorkItems[0].polarityTest = 'Fail';
  mixedElec.testedWorkItems[0].workResult = 'Fail';
  mixedElec.testedWorkItems[1].polarityTest = 'Pass';
  mixedElec.testedWorkItems[1].earthContinuity = 'Pass';
  mixedElec.testedWorkItems[1].workResult = 'Pass';
  const mixedElecResult = validateSignedSnapshot(JSON.stringify(mixedElec), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
  assert.equal(mixedElecResult.valid, true, 'Mixed pass/fail electrical inspection is valid to sign off');

  // Confirm false-positive certificate result is rejected
  const falsePositiveElec = structuredClone(base);
  falsePositiveElec.testedWorkItems[0].polarityTest = 'Fail';
  falsePositiveElec.testedWorkItems[0].workResult = 'Pass'; // Falsely claims Pass
  assert.equal(validateSignedSnapshot(JSON.stringify(falsePositiveElec), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid, false);
});

test('validateJobCompletion enforces remediation restrictions on genuine failed electrical and smoke alarm certificates', () => {
  const testJob: Job = {
    ...structuredClone(INITIAL_JOBS[0]),
    id: 'JOB-2026-TEST',
    status: 'IN_PROGRESS',
    isDirectToInvoice: false,
    formsRequired: ['ELECTRICAL', 'SMOKE_ALARM'],
  };

  const failedSmoke: SmokeAlarmCertData = {
    ...INITIAL_SMOKE_ALARM_CERT,
    jobReference: 'JOB-2026-TEST',
    signedOff: true,
    alarmSchedule: [
      {
        id: 'ALM-1',
        roomLocation: 'Hallway',
        alarmBrandModel: 'Clipsal 755PSMA4',
        standardMarkingPlaceholder: 'AS 3786:2014',
        manufactureDateOrExpiry: 'Exp 2030',
        powerSource: '240V Hardwired with Battery Backup',
        passFail: 'Fail',
        buttonTestPass: false,
        interconnectionPass: false,
        complianceStatusProvisional: 'Fail',
      },
    ],
  };

  const failedElec: ElectricalCertData = {
    ...INITIAL_ELECTRICAL_CERT,
    jobReference: 'JOB-2026-TEST',
    signedOff: true,
    testedWorkItems: [
      {
        id: 'WORK-1',
        description: 'Inverter AC Feed',
        circuitsTested: 'Sub-board 1',
        insulationResistanceResult: '> 200 Megohms',
        polarityTest: 'Fail',
        earthContinuity: 'Pass',
        rcdTripTimeMs: '18ms',
        workResult: 'Fail',
      },
    ],
  };

  const completion = validateJobCompletion(testJob, { electrical: failedElec, smokeAlarm: failedSmoke });
  assert.equal(completion.canComplete, true, 'Job can complete operationally when signed documentation is present');
  assert.ok(completion.warnings.some(w => w.includes('smoke alarm(s) marked Fail in schedule. Remediation required.')));
  assert.ok(completion.warnings.some(w => w.includes('electrical test item(s) marked Fail. Rectification required.')));

  // If unsigned, completion is strictly blocked
  const unsignedElec = { ...failedElec, signedOff: false };
  const blocked = validateJobCompletion(testJob, { electrical: unsignedElec, smokeAlarm: failedSmoke });
  assert.equal(blocked.canComplete, false);
  assert.ok(blocked.missingRequirements.some(m => m.includes('Electrical Certificate requires technician Preview sign-off')));
});

test('validateSignedSnapshot rejects unsupported synthetic smoke alarm power sources', () => {
  const invalid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  invalid.alarmSchedule[0].powerSource = 'Unknown mains source';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalid), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid,
    false,
  );
});

test('validateSignedSnapshot rejects malformed synthetic smoke alarm schedule field types', () => {
  const valid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  for (const malformed of [{ value: 'Hallway' }, '', '   ']) {
    const invalid = structuredClone(valid);
    invalid.alarmSchedule[0].roomLocation = malformed;
    assert.equal(
      validateSignedSnapshot(JSON.stringify(invalid), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid,
      false,
      `roomLocation ${JSON.stringify(malformed)}`,
    );
  }
});

test('validateSignedSnapshot rejects malformed synthetic electrical work item types', () => {
  const valid = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  for (const malformed of [{ invalid: true }, '', '   ']) {
    const invalid = structuredClone(valid);
    invalid.testedWorkItems[0].circuitsTested = malformed;
    assert.equal(
      validateSignedSnapshot(JSON.stringify(invalid), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid,
      false,
      `circuitsTested ${JSON.stringify(malformed)}`,
    );
  }
});

test('validateSignedSnapshot rejects unsupported synthetic smoke alarm compliance status', () => {
  const invalid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  invalid.alarmSchedule[0].complianceStatusProvisional = 'Unknown';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalid), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid,
    false,
  );
});

test('validateSignedSnapshot rejects unsupported synthetic electrical test result values', () => {
  const valid = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  for (const field of ['polarityTest', 'earthContinuity', 'workResult'] as const) {
    const invalid = structuredClone(valid);
    invalid.testedWorkItems[0][field] = 'Unknown';
    assert.equal(
      validateSignedSnapshot(JSON.stringify(invalid), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid,
      false,
      field,
    );
  }
});

test('validateSignedSnapshot rejects electrical snapshot with empty testedWorkItems', () => {
  const invalid = structuredClone(INITIAL_ELECTRICAL_CERT);
  invalid.testedWorkItems = [];
  const res = validateSignedSnapshot(JSON.stringify(invalid), invalid.jobReference, 'ELECTRICAL');
  assert.equal(res.valid, false);
  assert.equal(res.error, 'ELECTRICAL snapshot must contain at least one tested work item.');
});

test('validateSignedSnapshot rejects smoke alarm snapshot with empty alarmSchedule', () => {
  const invalid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  invalid.alarmSchedule = [];
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalid), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM').valid,
    false,
  );
});

test('validateSignedSnapshot rejects electrical snapshot with blank rcdTripTimeMs', () => {
  const valid = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  const invalidBlank = structuredClone(valid);
  invalidBlank.testedWorkItems[0].rcdTripTimeMs = '   ';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidBlank), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid,
    false,
  );
  const invalidEmpty = structuredClone(valid);
  invalidEmpty.testedWorkItems[0].rcdTripTimeMs = '';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidEmpty), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL').valid,
    false,
  );
});

test('validateSignedSnapshot rejects JSA snapshot with missing or invalid overallRiskLevel', () => {
  const valid = { ...INITIAL_JSA_FORM, signedOff: true, signedByTechName: 'Dave Miller', signedTimestamp: '2026-11-02 09:30', frozenIssuerSnapshot: 'Solarcell Pty Ltd' };
  const invalidMissing = structuredClone(valid);
  delete (invalidMissing as any).overallRiskLevel;
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidMissing), INITIAL_JSA_FORM.jobReference, 'JSA').valid,
    false,
  );
  const invalidEnum = structuredClone(valid);
  (invalidEnum as any).overallRiskLevel = 'Unknown';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidEnum), INITIAL_JSA_FORM.jobReference, 'JSA').valid,
    false,
  );
});

test('validateSignedSnapshot rejects TCA2 snapshot with unsupported top-level enums', () => {
  const seeded = JSON.parse(INITIAL_TCA2_CERT.fullSnapshot!);
  const valid = {
    ...seeded,
    customerAcknowledged: INITIAL_TCA2_CERT.customerAcknowledged,
    officeReviewCompleted: INITIAL_TCA2_CERT.officeReviewCompleted,
  };
  const invalidRisk = structuredClone(valid);
  invalidRisk.riskCategory = 'Critical Extreme Catastrophe';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidRisk), INITIAL_TCA2_CERT.jobReference, 'TCA2').valid,
    false,
  );
  const invalidUrgency = structuredClone(valid);
  invalidUrgency.urgencyLevel = 'Someday Eventually';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidUrgency), INITIAL_TCA2_CERT.jobReference, 'TCA2').valid,
    false,
  );
});

test('validateSignedSnapshot rejects and validates ELECTRICAL occupierRole enum values', () => {
  const valid = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  for (const validRole of ['Owner', 'Tenant', 'Property Manager', 'Builder'] as const) {
    const clone = structuredClone(valid);
    clone.occupierRole = validRole;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
    assert.equal(res.valid, true, `Valid occupierRole "${validRole}" should be accepted`);
  }
  for (const invalidRole of ['Contractor', 'Subcontractor', 'Unknown', ''] as const) {
    const clone = structuredClone(valid);
    clone.occupierRole = invalidRole;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
    assert.equal(res.valid, false, `Invalid occupierRole "${invalidRole}" should be rejected`);
    assert.match(res.error || '', /unsupported occupierRole|lacks mandatory occupierRole/);
  }
});

test('validateSignedSnapshot rejects and validates SMOKE_ALARM top-level enums', () => {
  const valid = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);

  for (const validRole of ['Owner', 'Property Manager', 'Tenant'] as const) {
    const clone = structuredClone(valid);
    clone.issuedToRole = validRole;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, true, `Valid issuedToRole "${validRole}" should be accepted`);
  }
  for (const invalidRole of ['Builder', 'Contractor', 'Unknown', ''] as const) {
    const clone = structuredClone(valid);
    clone.issuedToRole = invalidRole;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, false, `Invalid issuedToRole "${invalidRole}" should be rejected`);
    assert.match(res.error || '', /unsupported issuedToRole|lacks mandatory issuedToRole/);
  }

  for (const validType of ['Detached House', 'Townhouse', 'Unit / Apartment', 'Commercial Office'] as const) {
    const clone = structuredClone(valid);
    clone.propertyType = validType;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, true, `Valid propertyType "${validType}" should be accepted`);
  }
  for (const invalidType of ['Warehouse', 'Factory', 'InvalidType', ''] as const) {
    const clone = structuredClone(valid);
    clone.propertyType = invalidType;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, false, `Invalid propertyType "${invalidType}" should be rejected`);
    assert.match(res.error || '', /unsupported propertyType|lacks mandatory propertyType/);
  }

  for (const validStatus of ['Occupied', 'Vacant', 'Tenanted'] as const) {
    const clone = structuredClone(valid);
    clone.occupancyStatus = validStatus;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, true, `Valid occupancyStatus "${validStatus}" should be accepted`);
  }
  for (const invalidStatus of ['Abandoned', 'Under Construction', 'InvalidStatus', ''] as const) {
    const clone = structuredClone(valid);
    clone.occupancyStatus = invalidStatus;
    const res = validateSignedSnapshot(JSON.stringify(clone), INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(res.valid, false, `Invalid occupancyStatus "${invalidStatus}" should be rejected`);
    assert.match(res.error || '', /unsupported occupancyStatus|lacks mandatory occupancyStatus/);
  }
});

test('validateSignedSnapshot rejects incomplete or blank nested synthetic JSA step observations', () => {
  const valid = { ...INITIAL_JSA_FORM, signedOff: true, signedByTechName: 'Dave Miller', signedTimestamp: '2026-11-02 09:30', frozenIssuerSnapshot: 'Solarcell Pty Ltd' };
  const blankStep = structuredClone(valid);
  blankStep.steps[0].taskStep = '   ';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(blankStep), INITIAL_JSA_FORM.jobReference, 'JSA').valid,
    false,
  );
  const invalidRisk = structuredClone(valid);
  (invalidRisk.steps[0] as any).initialRisk = 'UNKNOWN';
  assert.equal(
    validateSignedSnapshot(JSON.stringify(invalidRisk), INITIAL_JSA_FORM.jobReference, 'JSA').valid,
    false,
  );
});

test('validateSignedSnapshot rejects JSA snapshot with empty steps array or unconfirmed induction competency', () => {
  const valid = { ...INITIAL_JSA_FORM, signedOff: true, signedByTechName: 'Dave Miller', signedTimestamp: '2026-11-02 09:30', frozenIssuerSnapshot: 'Solarcell Pty Ltd' };

  const emptySteps = structuredClone(valid);
  emptySteps.steps = [];
  const emptyStepsResult = validateSignedSnapshot(JSON.stringify(emptySteps), INITIAL_JSA_FORM.jobReference, 'JSA');
  assert.equal(emptyStepsResult.valid, false);
  assert.match(emptyStepsResult.error || '', /at least one step/);

  const incompleteInduction = structuredClone(valid);
  incompleteInduction.inductionCompleted = false;
  const inductionResult = validateSignedSnapshot(JSON.stringify(incompleteInduction), INITIAL_JSA_FORM.jobReference, 'JSA');
  assert.equal(inductionResult.valid, false);
  assert.match(inductionResult.error || '', /inductionCompleted/);

  const incompleteCompetency = structuredClone(valid);
  incompleteCompetency.competencyVerified = false;
  const competencyResult = validateSignedSnapshot(JSON.stringify(incompleteCompetency), INITIAL_JSA_FORM.jobReference, 'JSA');
  assert.equal(competencyResult.valid, false);
  assert.match(competencyResult.error || '', /competencyVerified/);
});

test('validateSignedSnapshot rejects missing, incomplete, malformed, and mismatched snapshots', () => {
  const validElectrical = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  const invalidCases: [string | undefined, string, string, string][] = [
    [undefined, 'JOB-2026-103', 'ELECTRICAL', 'missing'],
    ['{ malformed', 'JOB-2026-103', 'ELECTRICAL', 'malformed JSON'],
    [JSON.stringify({ ...validElectrical, jobReference: undefined }), 'JOB-2026-103', 'ELECTRICAL', 'missing jobReference'],
    [JSON.stringify({ ...validElectrical, jobReference: 'JOB-OTHER' }), 'JOB-2026-103', 'ELECTRICAL', 'mismatched jobReference'],
    [JSON.stringify({ ...validElectrical, signedByTechName: '' }), 'JOB-2026-103', 'ELECTRICAL', 'missing signer'],
    [JSON.stringify({ ...validElectrical, signedTimestamp: '' }), 'JOB-2026-103', 'ELECTRICAL', 'missing signed timestamp'],
    [JSON.stringify({ ...validElectrical, frozenIssuerSnapshot: '' }), 'JOB-2026-103', 'ELECTRICAL', 'missing frozen issuer'],
    [JSON.stringify({ ...validElectrical, certReference: '' }), 'JOB-2026-103', 'ELECTRICAL', 'missing electrical certReference'],
    [JSON.stringify({ ...validElectrical, testedWorkItems: undefined }), 'JOB-2026-103', 'ELECTRICAL', 'incomplete electrical schema'],
    [JSON.stringify({ ...validElectrical, signedOff: false }), 'JOB-2026-103', 'ELECTRICAL', 'not signed off'],
  ];

  for (const [snapshot, jobId, formType, reason] of invalidCases) {
    assert.equal(validateSignedSnapshot(snapshot, jobId, formType).valid, false, reason);
  }
  assert.equal(validateSignedSnapshot(INITIAL_ELECTRICAL_CERT.fullSnapshot, undefined, 'ELECTRICAL').valid, false);
});

test('validateJobCompletion: direct-to-invoice job completes without forms', () => {
  const directJob: Job = {
    id: 'JOB-2026-102',
    brandId: 'smart_home',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Emergency Inverter Service',
    jobType: 'Direct-to-Invoice Service',
    jobTypeVersion: 'v1.0',
    siteAddress: '14 Paradise Waters Way, Surfers Paradise QLD 4217',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'No forms required service',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: true,
    formsRequired: [],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid/smart-home',
      brandName: 'Smart Home Solutions',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const result = validateJobCompletion(directJob, {});
  assert.equal(result.canComplete, true);
  assert.equal(result.missingRequirements.length, 0);
  assert.equal(result.isDirectToInvoice, true);
});

test('validateJobCompletion: cancelled job cannot be completed without reopening (G00-014)', () => {
  const cancelledJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: 'Solar Installation & Audit',
    jobTypeVersion: 'v1.0',
    siteAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Inspection requiring JSA',
    status: 'CANCELLED',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: '',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const result = validateJobCompletion(cancelledJob, {});
  assert.equal(result.canComplete, false);
  assert.ok(result.missingRequirements.some(r => r.includes('CANCELLED')));
});

test('calculateReminderDueTime: derives 2-hour reminder from 14:00 to 12:00 (G00-019)', () => {
  const dueTime = calculateReminderDueTime('2026-11-02', '14:00', 2);
  assert.equal(dueTime, '2026-11-02 12:00');

  const morningDue = calculateReminderDueTime('2026-11-03', '08:30', 24);
  assert.equal(morningDue, '2026-11-02 08:30');
});

test('validateJobCompletion: documentation job fails when JSA is not signed', () => {
  const docJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: 'Solar Installation & Audit',
    jobTypeVersion: 'v1.0',
    siteAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Full inspection requiring JSA and Smoke Alarm',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'SMOKE_ALARM'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid/solarcell',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // With unsigned JSA
  const result = validateJobCompletion(docJob, {
    jsa: {
      jobReference: 'JOB-2026-101',
      date: '2026-11-02',
      customerName: 'John Citizen',
      siteContactPlaceholder: 'John Citizen',
      siteAddress: '42 Orchid Avenue',
      taskDescription: 'Solar audit',
      assetsIdentified: 'Rooftop PV array',
      personnelName: 'Dave Miller',
      personnelRole: 'Lead Electrician',
      licencePlaceholder: 'Q-ELEC-98765-DEMO',
      licenceExpiryPlaceholder: '31/12/2027',
      inductionCompleted: true,
      competencyVerified: true,
      overallRiskLevel: 'M',
      steps: [
        {
          id: 'step-1',
          taskStep: 'Roof access',
          hazards: 'Working at heights',
          initialRisk: 'H',
          controls: 'Anchor point, harness, ladder bracket',
          residualRisk: 'L',
          responsibleRole: 'Lead Tech',
        },
      ],
      ppeChecklist: [{ item: 'Safety Boots', status: 'Yes' }],
      isolationsAndPermits: [{ item: 'AC Isolator Lockout', required: 'Yes', referenceOrNotes: 'Applied' }],
      emergencyAssemblyArea: 'Front driveway',
      emergencyWardenPlaceholder: 'Site Manager',
      firstAidOfficerPlaceholder: 'Lead Electrician',
      signedOff: false, // NOT signed off!
      formRevision: 'Rev 4.2 - Oct 2026',
      issuerPlaceholder: 'Solarcell Safety Compliance',
      attachedSampleIds: [],
    },
    smokeAlarm: {
      certReference: 'SMOKE-2026-001',
      jobReference: 'JOB-2026-101',
      dateOfInspection: '2026-11-02',
      issuedByPlaceholder: 'Solarcell Safety Division',
      issuedToRole: 'Owner',
      propertyType: 'Detached House',
      storeys: 2,
      bedrooms: 4,
      occupancyStatus: 'Occupied',
      scopeOfWork: {
        visualInspection: true,
        operationalTesting: true,
        interconnectionTesting: true,
        cleaningAndVacuuming: true,
        batteryReplacement: false,
        alarmReplacement: false,
      },
      alarmSchedule: [
        {
          id: 'ALARM-1',
          roomLocation: 'Hallway Level 1',
          alarmBrandModel: 'Clipsal 755PSMA4 (Demo)',
          standardMarkingPlaceholder: 'AS 3786:2014',
          manufactureDateOrExpiry: 'Exp 2031 (Provisional)',
          powerSource: '240V Hardwired with Battery Backup',
          passFail: 'Pass',
          buttonTestPass: true,
          interconnectionPass: true,
          complianceStatusProvisional: 'Pass',
        },
      ],
      relatedElectricalCertRef: 'N/A',
      attachmentsLinked: true,
      limitationsAndRentalNotes: 'All alarms tested and compliant.',
      signedOff: true,
      signedByTechName: 'Dave Miller',
      signedTimestamp: '2026-11-02 09:45',
      provisionalNote: 'Provisional notice: Room/model count limits and expiry wording are provisional.',
      attachedSampleIds: [],
    },
  });

  assert.equal(result.canComplete, false);
  assert.ok(result.missingRequirements.includes('JSA / Risk Assessment requires technician Preview sign-off'));
});

test('validateJobCompletion: succeeds once JSA is signed off', () => {
  const docJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: 'Solar Installation & Audit',
    jobTypeVersion: 'v1.0',
    siteAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Full inspection requiring JSA and Smoke Alarm',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'SMOKE_ALARM'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid/solarcell',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const result = validateJobCompletion(docJob, {
    jsa: {
      jobReference: 'JOB-2026-101',
      date: '2026-11-02',
      customerName: 'John Citizen',
      siteContactPlaceholder: 'John Citizen',
      siteAddress: '42 Orchid Avenue',
      taskDescription: 'Solar audit',
      assetsIdentified: 'Rooftop PV array',
      personnelName: 'Dave Miller',
      personnelRole: 'Lead Electrician',
      licencePlaceholder: 'Q-ELEC-98765-DEMO',
      licenceExpiryPlaceholder: '31/12/2027',
      inductionCompleted: true,
      competencyVerified: true,
      overallRiskLevel: 'M',
      steps: [
        {
          id: 'step-1',
          taskStep: 'Roof access',
          hazards: 'Working at heights',
          initialRisk: 'H',
          controls: 'Anchor point, harness, ladder bracket',
          residualRisk: 'L',
          responsibleRole: 'Lead Tech',
        },
      ],
      ppeChecklist: [{ item: 'Safety Boots', status: 'Yes' }],
      isolationsAndPermits: [{ item: 'AC Isolator Lockout', required: 'Yes', referenceOrNotes: 'Applied' }],
      emergencyAssemblyArea: 'Front driveway',
      emergencyWardenPlaceholder: 'Site Manager',
      firstAidOfficerPlaceholder: 'Lead Electrician',
      signedOff: true, // SIGNED OFF NOW
      signedByTechName: 'Dave Miller',
      signedTimestamp: '2026-11-02 09:30',
      formRevision: 'Rev 4.2 - Oct 2026',
      issuerPlaceholder: 'Solarcell Safety Compliance',
      attachedSampleIds: [],
    },
    smokeAlarm: {
      certReference: 'SMOKE-2026-001',
      jobReference: 'JOB-2026-101',
      dateOfInspection: '2026-11-02',
      issuedByPlaceholder: 'Solarcell Safety Division',
      issuedToRole: 'Owner',
      propertyType: 'Detached House',
      storeys: 2,
      bedrooms: 4,
      occupancyStatus: 'Occupied',
      scopeOfWork: {
        visualInspection: true,
        operationalTesting: true,
        interconnectionTesting: true,
        cleaningAndVacuuming: true,
        batteryReplacement: false,
        alarmReplacement: false,
      },
      alarmSchedule: [
        {
          id: 'ALARM-1',
          roomLocation: 'Hallway Level 1',
          alarmBrandModel: 'Clipsal 755PSMA4 (Demo)',
          standardMarkingPlaceholder: 'AS 3786:2014',
          manufactureDateOrExpiry: 'Exp 2031 (Provisional)',
          powerSource: '240V Hardwired with Battery Backup',
          passFail: 'Pass',
          buttonTestPass: true,
          interconnectionPass: true,
          complianceStatusProvisional: 'Pass',
        },
      ],
      relatedElectricalCertRef: 'N/A',
      attachmentsLinked: true,
      limitationsAndRentalNotes: 'All alarms tested and compliant.',
      signedOff: true,
      signedByTechName: 'Dave Miller',
      signedTimestamp: '2026-11-02 09:45',
      provisionalNote: 'Provisional notice: Room/model count limits and expiry wording are provisional.',
      attachedSampleIds: [],
    },
  });

  assert.equal(result.canComplete, true);
  assert.equal(result.missingRequirements.length, 0);
  assert.ok(result.warnings.length > 0);
});

test('deduplicateReviewRequest: prevents multiple dispatches', () => {
  const job: Job = {
    id: 'JOB-1',
    brandId: 'solarcell',
    customerId: 'C-1',
    title: 'Solar test',
    jobType: 'Install',
    jobTypeVersion: 'v1.0',
    siteAddress: '123 Test St',
    siteContact: 'Sam',
    sitePhone: '0400000000',
    description: '',
    status: 'COMPLETED',
    assignedTechId: 'T-1',
    assignedTechName: 'Dave',
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 1,
    isDirectToInvoice: false,
    formsRequired: [],
    reviewRequest: {
      status: 'SENT',
      sentTimestamp: '2026-11-02 11:30',
      reviewLink: 'https://demo.reviews.invalid/solarcell',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  let sendCalled = false;
  const outcome = deduplicateReviewRequest(job, () => {
    sendCalled = true;
    return { success: true, reviewUrl: 'mock' };
  });

  assert.equal(outcome.allowed, false);
  assert.equal(sendCalled, false);
  assert.ok(outcome.reason?.includes('already sent'));
});

test('suppressOldReminders: marks undelivered reminders as suppressed', () => {
  const job: Job = {
    id: 'JOB-1',
    brandId: 'solarcell',
    customerId: 'C-1',
    title: 'Test',
    jobType: 'Install',
    jobTypeVersion: 'v1.0',
    siteAddress: '',
    siteContact: '',
    sitePhone: '',
    description: '',
    status: 'SCHEDULED',
    assignedTechId: null,
    assignedTechName: null,
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: [],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [
      { id: 'REM-1', targetAppointmentTime: '2026-11-02 09:00', leadHours: 24, scheduledFor: '2026-11-01 09:00', type: 'REMINDER_24HR', channel: 'EMAIL_SIMULATED', suppressed: false, delivered: false },
      { id: 'REM-2', targetAppointmentTime: '2026-11-02 09:00', leadHours: 2, scheduledFor: '2026-11-02 07:00', type: 'REMINDER_2HR', channel: 'EMAIL_SIMULATED', suppressed: false, delivered: false },
    ],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const updated = suppressOldReminders(job, 'Rescheduled to 2026-11-05', '2026-11-02T09:00:00+10:00');
  assert.equal(updated.length, 2);
  assert.equal(updated[0].suppressed, true);
  assert.ok(updated[0].suppressionReason?.includes('Rescheduled to 2026-11-05'));
});

test('checkCustomerDuplicate: detects duplicate by email or phone', () => {
  const customers: Customer[] = [
    {
      id: 'CUSTOMER-DEMO-001',
      myobCustomerId: 'MYOB-DEMO-001',
      name: 'John Citizen',
      contactPerson: 'John Citizen',
      email: 'john.citizen@example.invalid',
      phone: '0400 000 001',
      billingAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
      brandAffiliations: ['solarcell', 'smart_home'],
      syncStatus: 'SYNCED',
      createdAt: '2026-10-01',
    },
  ];

  const dupCheck1 = checkCustomerDuplicate(
    { email: 'john.citizen@example.invalid', phone: '0499 999 999', name: 'Someone Else' },
    customers
  );
  assert.equal(dupCheck1.isDuplicate, true);
  assert.equal(dupCheck1.field, 'email');

  const dupCheck2 = checkCustomerDuplicate(
    { email: 'new.person@example.invalid', phone: '0400000001', name: 'New Person' },
    customers
  );
  assert.equal(dupCheck2.isDuplicate, true);
  assert.equal(dupCheck2.field, 'phone');

  const dupCheck3 = checkCustomerDuplicate(
    { email: 'unique@example.invalid', phone: '0411 222 333', name: 'Unique Person' },
    customers
  );
  assert.equal(dupCheck3.isDuplicate, false);
  const untrimmedExisting: Customer[] = [
    {
      id: 'CUSTOMER-DEMO-002',
      myobCustomerId: 'MYOB-DEMO-002',
      name: 'Untrimmed Email Customer',
      contactPerson: 'Untrimmed Email Customer',
      email: '  untrimmed@example.invalid  ',
      phone: '0422 333 444',
      billingAddress: '100 Gold Coast Hwy',
      brandAffiliations: ['solarcell'],
      syncStatus: 'SYNCED',
      createdAt: '2026-01-01',
    },
  ];
  const untrimmedDupCheck = checkCustomerDuplicate(
    { email: 'UNTRIMMED@example.invalid', phone: '', name: 'Different Name' },
    untrimmedExisting
  );
  assert.equal(untrimmedDupCheck.isDuplicate, true);
  assert.equal(untrimmedDupCheck.field, 'email');
});

test('FC-15: checkCustomerDuplicate ignores demo placeholder 0400 000 000 and empty phone, preserving real duplicates', () => {
  const customers: Customer[] = [
    {
      id: 'CUSTOMER-DEMO-001',
      myobCustomerId: 'MYOB-DEMO-001',
      name: 'John Citizen',
      contactPerson: 'John Citizen',
      email: 'john.citizen@example.invalid',
      phone: '0400 000 000', // Uses fallback demo placeholder
      billingAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
      brandAffiliations: ['solarcell'],
      syncStatus: 'SYNCED',
      createdAt: '2026-10-01',
    },
    {
      id: 'CUSTOMER-DEMO-002',
      myobCustomerId: 'MYOB-DEMO-002',
      name: 'Sarah Smith',
      contactPerson: 'Sarah Smith',
      email: 'sarah.smith@example.invalid',
      phone: '0412 345 678', // Real distinct mobile
      billingAddress: '10 Marine Parade, Southport QLD 4215',
      brandAffiliations: ['smart_home'],
      syncStatus: 'SYNCED',
      createdAt: '2026-10-02',
    },
  ];

  // 1. New customer with empty phone and different email/name: NOT a duplicate
  const emptyPhoneCheck = checkCustomerDuplicate(
    { name: 'Alice Walker', email: 'alice.walker@example.invalid', phone: '' },
    customers
  );
  assert.equal(emptyPhoneCheck.isDuplicate, false, 'Empty phone should not trigger duplicate');

  // 2. New customer explicitly using placeholder '0400 000 000': NOT a duplicate
  const placeholderCheck = checkCustomerDuplicate(
    { name: 'Bob Roberts', email: 'bob.roberts@example.invalid', phone: '0400 000 000' },
    customers
  );
  assert.equal(placeholderCheck.isDuplicate, false, 'Placeholder phone 0400 000 000 should not trigger duplicate');

  // 3. New customer with normalized '0400000000': NOT a duplicate
  const normPlaceholderCheck = checkCustomerDuplicate(
    { name: 'Charlie Clark', email: 'charlie@example.invalid', phone: '0400000000' },
    customers
  );
  assert.equal(normPlaceholderCheck.isDuplicate, false, 'Normalized placeholder phone should not trigger duplicate');

  // 4. Real phone match (different formatting: (04) 1234 5678 vs 0412 345 678): IS a duplicate
  const realPhoneCheck = checkCustomerDuplicate(
    { name: 'Different Name', email: 'different@example.invalid', phone: '(04) 1234 5678' },
    customers
  );
  assert.equal(realPhoneCheck.isDuplicate, true, 'Genuine matching phone should trigger duplicate');
  assert.equal(realPhoneCheck.field, 'phone');
  assert.equal(realPhoneCheck.matchedCustomer?.id, 'CUSTOMER-DEMO-002');

  // 5. Genuine email match: IS a duplicate
  const realEmailCheck = checkCustomerDuplicate(
    { name: 'Another Name', email: 'sarah.smith@example.invalid', phone: '0499 888 777' },
    customers
  );
  assert.equal(realEmailCheck.isDuplicate, true, 'Matching email should trigger duplicate');
  assert.equal(realEmailCheck.field, 'email');

  // 6. Genuine name match: IS a duplicate
  const realNameCheck = checkCustomerDuplicate(
    { name: 'Sarah Smith', email: 'new.sarah@example.invalid', phone: '0499 888 777' },
    customers
  );
  assert.equal(realNameCheck.isDuplicate, true, 'Matching name should trigger duplicate');
  assert.equal(realNameCheck.field, 'name');
});

test('verifyPersonaAccess: technician and office staff boundaries (G00-001)', () => {
  const unassignedCheck = verifyPersonaAccess('technician', 'unassigned_job');
  assert.equal(unassignedCheck.allowed, false);

  const techSettingsCheck = verifyPersonaAccess('technician', 'technical_integrations');
  assert.equal(techSettingsCheck.allowed, false);

  const techCustomersCheck = verifyPersonaAccess('technician', 'all_customers');
  assert.equal(techCustomersCheck.allowed, false);

  const officeEditTemplateCheck = verifyPersonaAccess('office_staff', 'template_editing');
  assert.equal(officeEditTemplateCheck.allowed, false);

  const officePublishTemplateCheck = verifyPersonaAccess('office_staff', 'template_publishing');
  assert.equal(officePublishTemplateCheck.allowed, false);

  const assignedCheck = verifyPersonaAccess('technician', 'assigned_job', {
    assignedTechId: 'TECH-001',
    currentTechId: 'TECH-001',
  });
  assert.equal(assignedCheck.allowed, true);

  const otherTechCheck = verifyPersonaAccess('technician', 'assigned_job', {
    assignedTechId: 'TECH-002',
    currentTechId: 'TECH-001',
  });
  assert.equal(otherTechCheck.allowed, false);
});

test('quotation GST math: ex-GST subtotal + 10% GST = total inc GST without double taxing', () => {
  const grossTarget = 1450;
  const exSubtotal = Math.round((grossTarget / 1.1) * 100) / 100;
  const totals = calculateQuoteTotals([{ total: exSubtotal }]);

  assert.equal(totals.subtotal, 1318.18);
  assert.equal(totals.gst, 131.82);
  assert.equal(totals.total, 1450.00);
});

test('calculateQuoteTotals: synthetic half-up integer-cent rounding across boundary cases', () => {
  // P2-2 verified rule: subtotal $0.35 -> GST $0.04 -> total $0.39
  const p2Case = calculateQuoteTotals([{ total: 0.35 }]);
  assert.equal(p2Case.subtotal, 0.35);
  assert.equal(p2Case.gst, 0.04);
  assert.equal(p2Case.total, 0.39);

  // Aggregation of multiple line items reaching $0.35
  const multiItem = calculateQuoteTotals([
    { total: 0.34 },
    { total: 0.01 },
  ]);
  assert.equal(multiItem.subtotal, 0.35);
  assert.equal(multiItem.gst, 0.04);
  assert.equal(multiItem.total, 0.39);

  // Fractional quantity line items aggregating to exact totals
  const halfUnitQty = 0.5;
  const halfUnitPrice = 0.70;
  const lineTotalCents = roundedLineTotalCents(halfUnitQty, halfUnitPrice);
  assert.equal(lineTotalCents, 35n);
  const fractionalCase = calculateQuoteTotals([{ total: Number(lineTotalCents) / 100 }]);
  assert.equal(fractionalCase.subtotal, 0.35);
  assert.equal(fractionalCase.gst, 0.04);
  assert.equal(fractionalCase.total, 0.39);

  // Exact boundary cases for 10% half-up rounding:
  // 4 cents -> 0.4c -> 0c
  assert.deepEqual(calculateQuoteTotals([{ total: 0.04 }]), { subtotal: 0.04, gst: 0.00, total: 0.04 });
  // 5 cents -> 0.5c -> 1c
  assert.deepEqual(calculateQuoteTotals([{ total: 0.05 }]), { subtotal: 0.05, gst: 0.01, total: 0.06 });
  // 14 cents -> 1.4c -> 1c
  assert.deepEqual(calculateQuoteTotals([{ total: 0.14 }]), { subtotal: 0.14, gst: 0.01, total: 0.15 });
  // 15 cents -> 1.5c -> 2c
  assert.deepEqual(calculateQuoteTotals([{ total: 0.15 }]), { subtotal: 0.15, gst: 0.02, total: 0.17 });
  // 34 cents -> 3.4c -> 3c
  assert.deepEqual(calculateQuoteTotals([{ total: 0.34 }]), { subtotal: 0.34, gst: 0.03, total: 0.37 });
});

test('validateQuoteInput: validates quote title, line items, and rejects invalid amounts', () => {
  const validItem = { id: 'item-1', description: 'Labour', quantity: 2, unitPrice: 50, total: 100 };

  // Valid inputs
  assert.equal(validateQuoteInput('Valid Quote', [validItem]).valid, true);
  assert.equal(validateQuoteInput('Quote', [{ id: 'item-2', description: 'Fractional', quantity: 1.5, unitPrice: 20, total: 30 }]).valid, true);

  // Blank or invalid title
  assert.equal(validateQuoteInput('', [validItem]).valid, false);
  assert.equal(validateQuoteInput('   ', [validItem]).valid, false);
  assert.equal(validateQuoteInput(null, [validItem]).valid, false);

  // Empty or invalid lineItems array
  assert.equal(validateQuoteInput('Quote', []).valid, false);
  assert.equal(validateQuoteInput('Quote', null).valid, false);

  // Invalid item fields
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, id: '' }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, description: '  ' }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, quantity: 0 }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, quantity: -1 }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, quantity: Number.NaN }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, unitPrice: -5 }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, total: -100 }]).valid, false);

  // Total mismatch with unitPrice * quantity
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, total: 99.99 }]).valid, false);

  // Fractional cent total and fractional cent unitPrice
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, total: 100.005 }]).valid, false);
  assert.equal(validateQuoteInput('Quote', [{ ...validItem, unitPrice: 0.001, quantity: 10, total: 0.01 }]).valid, false);

  // Non-finite overflow amounts
  assert.equal(validateQuoteInput('Quote', [
    { id: '1', description: 'Huge 1', quantity: 1, unitPrice: 1e306, total: 1e306 },
    { id: '2', description: 'Huge 2', quantity: 1, unitPrice: 1e306, total: 1e306 },
  ]).valid, false);
  assert.throws(() => calculateQuoteTotals([{ total: 1e306 }, { total: 1e306 }]), RangeError);
  assert.throws(() => calculateQuoteTotals([{ total: Number.MAX_SAFE_INTEGER }]), RangeError);

  // Line items totaling amounts that lose cent precision in double float conversion
  const precisionLossItems = [
    { id: '1', description: 'Item 1', quantity: 1, unitPrice: 40000000000000.00, total: 40000000000000.00 },
    { id: '2', description: 'Item 2', quantity: 1, unitPrice: 40000000000000.01, total: 40000000000000.01 },
  ];
  assert.equal(validateQuoteInput('Quote', precisionLossItems).valid, false);
  assert.throws(() => calculateQuoteTotals(precisionLossItems), RangeError);
});

test('validateJobCompletion: blocks completion if job requires forms but forms are unsigned', () => {
  const cctvJob: Job = {
    id: 'JOB-2026-104',
    brandId: 'cctv',
    customerId: 'CUSTOMER-DEMO-002',
    title: 'CCTV Telecommunications Cabling',
    jobType: 'Enterprise CCTV & Cabling Inspection',
    jobTypeVersion: 'v2.1',
    siteAddress: 'Industrial Zone',
    siteContact: 'Marcus Vance',
    sitePhone: '0400 000 002',
    description: 'Requires TCA1 and JSA',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '13:00',
    estimatedDurationHours: 4,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'TCA1'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: '',
      brandName: 'Gold Coast CCTV',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const completionResult = validateJobCompletion(cctvJob, {
    jsa: { signedOff: true } as any,
    tca1: { signedOff: false } as any,
  });

  assert.equal(completionResult.canComplete, false);
  assert.ok(completionResult.missingRequirements.some(r => r.includes('TCA1')));
});

test('validateJobCompletion: TCA2 requires customer acknowledgement in Tca2AuditRecord without mutating certificate', () => {
  const tca2Job: Job = {
    id: 'JOB-2026-104',
    brandId: 'cctv',
    customerId: 'CUSTOMER-DEMO-002',
    title: 'Cabling Defect Job',
    jobType: 'CCTV Inspection',
    jobTypeVersion: 'v1.0',
    siteAddress: 'Warehouse',
    siteContact: 'Marcus',
    sitePhone: '0400000000',
    description: '',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: ['TCA2'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const frozenTca2 = {
    reportReference: 'TCA2-DEFECT-001',
    jobReference: 'JOB-2026-104',
    signedOff: true,
    customerAcknowledged: false, // Remains false on frozen certificate
    fullSnapshot: '{"reportReference":"TCA2-DEFECT-001","signedOff":true}',
  } as any;

  // Unacknowledged in audit record -> completion blocked
  const resBlocked = validateJobCompletion(tca2Job, { tca2: frozenTca2 }, {
    jobId: 'JOB-2026-104',
    customerAcknowledged: false,
    officeReviewCompleted: false,
  });
  assert.equal(resBlocked.canComplete, false);
  assert.ok(resBlocked.missingRequirements.some(r => r.includes('acknowledged by customer')));

  // Acknowledged in audit record -> unblocked, while certificate itself remains frozen
  const resAllowed = validateJobCompletion(tca2Job, { tca2: frozenTca2 }, {
    jobId: 'JOB-2026-104',
    customerAcknowledged: true,
    customerAckTimestamp: '2026-11-02 11:30',
    officeReviewCompleted: true,
    reviewedByOfficeStaff: 'Office Staff',
  });
  assert.equal(resAllowed.canComplete, true);
  assert.equal(frozenTca2.customerAcknowledged, false); // Frozen cert was NOT mutated
});

test('processOfficeReviewTca2: pure domain helper ensures atomic idempotency', () => {
  const currentJob: Job = {
    id: 'JOB-104',
    brandId: 'cctv',
    customerId: 'C-1',
    title: 'CCTV job',
    jobType: 'CCTV Inspection',
    jobTypeVersion: 'v1.0',
    siteAddress: '123 Site',
    siteContact: 'Sam',
    sitePhone: '0400000000',
    description: '',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: ['TCA2'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const auditRecord = {
    jobId: 'JOB-104',
    customerAcknowledged: true,
    officeReviewCompleted: false,
  };

  const tca2Cert = {
    signedOff: true,
    reportReference: 'TCA2-DEFECT-001',
    jobReference: 'JOB-104',
  } as any;

  const existingJobs = [currentJob];

  // First call creates follow-up
  const result1 = processOfficeReviewTca2({
    jobId: 'JOB-104',
    actorPersona: 'office_staff',
    existingAudit: auditRecord,
    existingJobs,
    tca2Cert,
    sourceJob: currentJob,
    demoClock: '2026-11-02 12:00',
    nextJobSeq: 500,
  });

  assert.equal(result1.success, true);
  assert.equal(result1.isDuplicate, false);
  assert.ok(result1.newFollowupJob);
  assert.equal(result1.newFollowupJob?.id, 'JOB-2026-501');
  assert.equal(result1.updatedAuditRecord.officeReviewCompleted, true);

  // Second call with updated state returns existing follow-up without creating a new one
  const updatedJobs = [...existingJobs, result1.newFollowupJob!];
  const result2 = processOfficeReviewTca2({
    jobId: 'JOB-104',
    actorPersona: 'office_staff',
    existingAudit: result1.updatedAuditRecord,
    existingJobs: updatedJobs,
    tca2Cert,
    sourceJob: currentJob,
    demoClock: '2026-11-02 12:05',
    nextJobSeq: 501,
  });

  assert.equal(result2.success, true);
  assert.equal(result2.isDuplicate, true);
  assert.equal(result2.newFollowupJob, undefined);
  assert.equal(result2.updatedAuditRecord.rectificationFollowupJobId, 'JOB-2026-501');
});

test('recalculateJobAttachments: preserves sample if used by another form', () => {
  const forms = {
    jsa: { attachedSampleIds: ['ATT-001', 'ATT-002'] },
    electrical: { attachedSampleIds: ['ATT-002', 'ATT-003'] },
  };

  // Removing ATT-001 from JSA should leave ATT-002 and ATT-003
  const updatedFormsAfterRemovingAtt1 = {
    jsa: { attachedSampleIds: ['ATT-002'] },
    electrical: { attachedSampleIds: ['ATT-002', 'ATT-003'] },
  };

  const recalculated = recalculateJobAttachments([
    updatedFormsAfterRemovingAtt1.jsa.attachedSampleIds,
    updatedFormsAfterRemovingAtt1.electrical.attachedSampleIds,
  ]);
  assert.deepEqual(recalculated.sort(), ['ATT-002', 'ATT-003']);
  // ATT-002 is still preserved because both jsa and electrical referenced it
  assert.ok(recalculated.includes('ATT-002'));
});

test('processPublishTemplate: preserves reviewed revision in complete audit history', () => {
  const currentTemplate: TemplateSetting = {
    id: 'tpl-1',
    name: 'Customer Terms Template',
    type: 'TERMS',
    currentVersion: 'v1.0',
    content: 'Original Invoice Header',
    sampleFileName: 'invoice.html',
    mappingStatus: 'Mapped',
    activeStatus: 'REVIEW',
    revisions: [
      {
        version: 'v1.0',
        content: 'Original Invoice Header',
        status: 'PUBLISHED',
        updatedBy: 'SUPER_ADMIN',
        updatedAt: '2026-10-01 10:00',
      },
    ],
  };

  const result = processPublishTemplate(
    currentTemplate,
    'super_admin',
    '2026-11-02 14:00'
  );

  assert.equal(result.success, true);
  assert.ok(result.updatedTemplate);
  assert.equal(result.updatedTemplate?.activeStatus, 'PUBLISHED');
  assert.equal(result.updatedTemplate?.currentVersion, 'v1.1');
  // Both the old v1.0 and the newly published revision are preserved in revisions array
  assert.equal(result.updatedTemplate?.revisions.length, 2);
  assert.ok(result.updatedTemplate?.revisions.some((r: any) => r.version === 'v1.1' && r.status === 'PUBLISHED'));
});

test('stripAffirmativeComplianceNotes removes every occurrence of default compliance notes while preserving custom technician text', () => {
  // Single occurrence of DEFAULT note
  assert.equal(
    stripAffirmativeComplianceNotes(DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE),
    '',
  );
  // Single occurrence of SEEDED note
  assert.equal(
    stripAffirmativeComplianceNotes(SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE),
    '',
  );
  // Multiple occurrences of both notes combined with technician notes
  const complex = `${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE} • Ceiling height in bedroom 2 requires ladder. • ${SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE} • ${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE}`;
  assert.equal(
    stripAffirmativeComplianceNotes(complex),
    'Ceiling height in bedroom 2 requires ladder.',
  );
  // Unrelated technician text untouched
  assert.equal(
    stripAffirmativeComplianceNotes('Custom technician note only'),
    'Custom technician note only',
  );
  // Embedded or quoted text in technician narrative is preserved
  const narrative = 'Previous certificate stated: Interconnected photoelectric alarms comply with current Queensland fire legislation. Inspection found otherwise.';
  assert.equal(
    stripAffirmativeComplianceNotes(narrative),
    narrative,
  );
  // Default compliance sentence followed immediately by custom text in same paragraph
  const sameParagraph = `${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE} Bedroom 3 ceiling fan requires clearance check.`;
  assert.equal(
    stripAffirmativeComplianceNotes(sameParagraph),
    'Bedroom 3 ceiling fan requires clearance check.',
  );
  // Adjacent repeats of default note are both removed
  const adjacent = `${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE} • ${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE}`;
  assert.equal(
    stripAffirmativeComplianceNotes(adjacent),
    '',
  );

  // Space-separated repeated default notes in all permutations and orders
  const D = DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE;
  const S = SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE;

  // D + space + D
  assert.equal(
    stripAffirmativeComplianceNotes(`${D} ${D}`),
    '',
    'D + space + D is completely stripped',
  );

  // S + space + S
  assert.equal(
    stripAffirmativeComplianceNotes(`${S} ${S}`),
    '',
    'S + space + S is completely stripped',
  );

  // D + space + S
  assert.equal(
    stripAffirmativeComplianceNotes(`${D} ${S}`),
    '',
    'D + space + S is completely stripped',
  );

  // S + space + D
  assert.equal(
    stripAffirmativeComplianceNotes(`${S} ${D}`),
    '',
    'S + space + D is completely stripped',
  );

  // D + space + S + space + D
  assert.equal(
    stripAffirmativeComplianceNotes(`${D} ${S} ${D}`),
    '',
    'D + space + S + space + D is completely stripped',
  );

  // S + space + D + space + S
  assert.equal(
    stripAffirmativeComplianceNotes(`${S} ${D} ${S}`),
    '',
    'S + space + D + space + S is completely stripped',
  );

  // Multiple consecutive whitespace characters (spaces, tabs, newlines) between repeated defaults
  assert.equal(
    stripAffirmativeComplianceNotes(`${D}   ${S}`),
    '',
    'Multiple spaces between defaults stripped',
  );
  assert.equal(
    stripAffirmativeComplianceNotes(`${D}\t${S}`),
    '',
    'Tab between defaults stripped',
  );

  // Technician-authored text before and after repeated defaults
  const techBeforeAndAfter = `Replaced hallway alarm • ${D} ${S} • Tested OK on master control panel`;
  assert.equal(
    stripAffirmativeComplianceNotes(techBeforeAndAfter),
    'Replaced hallway alarm • Tested OK on master control panel',
    'Preserves technician text before and after repeated defaults',
  );

  const techBeforeOnly = `Replaced hallway alarm • ${D} ${S}`;
  assert.equal(
    stripAffirmativeComplianceNotes(techBeforeOnly),
    'Replaced hallway alarm',
    'Preserves technician text before repeated defaults',
  );

  const techAfterOnly = `${D} ${S} • Tested OK on master control panel`;
  assert.equal(
    stripAffirmativeComplianceNotes(techAfterOnly),
    'Tested OK on master control panel',
    'Preserves technician text after repeated defaults',
  );

  // Narrative quotations that mention legislation but must remain intact
  const narrativeD = `Technician noted that ${D} cannot be asserted at this time.`;
  assert.equal(
    stripAffirmativeComplianceNotes(narrativeD),
    narrativeD,
    'Preserves embedded narrative quote referencing default note',
  );

  const narrativeS = `Previous owner report claimed that ${S} but testing failed.`;
  assert.equal(
    stripAffirmativeComplianceNotes(narrativeS),
    narrativeS,
    'Preserves embedded narrative quote referencing seeded note',
  );
});


