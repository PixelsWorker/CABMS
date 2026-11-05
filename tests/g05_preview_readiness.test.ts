import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPendingPreviewForms, getInvalidPreviewForms, isValidPreviewSignOff } from '../src/utils/g05PreviewReadiness.ts';
import { effectiveElectricalResult, effectiveSmokeAlarmResults, DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE, SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE, STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE } from '../src/utils/cabmsLogic.ts';
import { INITIAL_ELECTRICAL_CERT, INITIAL_JSA_FORM, INITIAL_SMOKE_ALARM_CERT } from '../src/data/seedData.ts';

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

  const baseElec = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  baseElec.occupierRole = 'NonExistentRole';
  const elecValid = isValidPreviewSignOff('ELECTRICAL', INITIAL_ELECTRICAL_CERT.jobReference, true, JSON.stringify(baseElec));
  assert.equal(elecValid, false, 'Invalid occupierRole is rejected by preview sign-off');
  assert.deepEqual(getInvalidPreviewForms(['ELECTRICAL'], { ELECTRICAL: true }, { ELECTRICAL: elecValid }), ['ELECTRICAL']);

  const baseSmoke = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  for (const [field, badValue] of [
    ['issuedToRole', 'Contractor'],
    ['propertyType', 'Warehouse'],
    ['occupancyStatus', 'Abandoned'],
  ] as const) {
    const invalidSmoke = structuredClone(baseSmoke);
    invalidSmoke[field] = badValue;
    const smokeValid = isValidPreviewSignOff('SMOKE_ALARM', INITIAL_SMOKE_ALARM_CERT.jobReference, true, JSON.stringify(invalidSmoke));
    assert.equal(smokeValid, false, `Invalid smoke alarm ${field} "${badValue}" is rejected by preview sign-off`);
    assert.deepEqual(getInvalidPreviewForms(['SMOKE_ALARM'], { SMOKE_ALARM: true }, { SMOKE_ALARM: smokeValid }), ['SMOKE_ALARM']);
  }
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
test('preview readiness validates signed snapshots recording legitimate failed inspection outcomes', () => {
  const baseSmoke = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  baseSmoke.alarmSchedule[0].passFail = 'Fail';
  baseSmoke.alarmSchedule[0].buttonTestPass = false;
  baseSmoke.alarmSchedule[0].interconnectionPass = false;
  baseSmoke.alarmSchedule[0].complianceStatusProvisional = 'Fail';
  baseSmoke.limitationsAndRentalNotes = STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE;
  const smokeSnapshot = JSON.stringify(baseSmoke);

  const smokeValid = isValidPreviewSignOff('SMOKE_ALARM', INITIAL_SMOKE_ALARM_CERT.jobReference, true, smokeSnapshot);
  assert.equal(smokeValid, true, 'Failed smoke alarm inspection snapshot is valid preview sign-off');
  assert.deepEqual(getInvalidPreviewForms(['SMOKE_ALARM'], { SMOKE_ALARM: true }, { SMOKE_ALARM: smokeValid }), []);

  const baseElec = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
  baseElec.testedWorkItems[0].polarityTest = 'Fail';
  baseElec.testedWorkItems[0].workResult = 'Fail';
  const elecSnapshot = JSON.stringify(baseElec);

  const elecValid = isValidPreviewSignOff('ELECTRICAL', INITIAL_ELECTRICAL_CERT.jobReference, true, elecSnapshot);
  assert.equal(elecValid, true, 'Failed electrical inspection snapshot is valid preview sign-off');
  assert.deepEqual(getInvalidPreviewForms(['ELECTRICAL'], { ELECTRICAL: true }, { ELECTRICAL: elecValid }), []);
});

test('mock adapter smoke alarm sign-off updates limitations notice on failure and preserves existing notes and non-compliance evidence', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  const adapter = new MockDataAdapter();
  await adapter.resetToBaseline();
  const form = structuredClone(INITIAL_SMOKE_ALARM_CERT);
  form.jobReference = 'JOB-2026-102';
  form.signedOff = false;
  form.signedByTechName = undefined;
  form.signedTimestamp = undefined;
  form.fullSnapshot = undefined;
  form.limitationsAndRentalNotes = 'Bedroom 3 ceiling height requires scaffold';
  form.alarmSchedule[0].passFail = 'Pass';
  form.alarmSchedule[0].buttonTestPass = false;
  form.alarmSchedule[0].interconnectionPass = true;
  await adapter.saveSmokeAlarmForm('JOB-2026-102', form);
  const signed = await adapter.signOffSmokeAlarmForm('JOB-2026-102', {
    signed_by_name: 'Dave Miller',
    signer_role: 'technician',
    signed_timestamp: '2026-11-04T10:00:00.000Z',
  });
  assert.equal(signed.alarmSchedule[0].passFail, 'Fail', 'normalizes passFail to Fail when buttonTestPass fails');
  assert.equal(signed.alarmSchedule[0].complianceStatusProvisional, 'Fail', 'normalizes complianceStatusProvisional to Fail');
  assert.match(signed.limitationsAndRentalNotes, /^Bedroom 3 ceiling height requires scaffold • NON-COMPLIANCE NOTICE/);
});

test('smoke alarm sign-off clears untouched default compliance note and appends failure notice without duplication', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  const adapter = new MockDataAdapter();
  await adapter.resetToBaseline();
  const form = structuredClone(INITIAL_SMOKE_ALARM_CERT);
  form.jobReference = 'JOB-2026-102';
  form.signedOff = false;
  form.signedByTechName = undefined;
  form.signedTimestamp = undefined;
  form.fullSnapshot = undefined;
  // Untouched default note
  form.limitationsAndRentalNotes = DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE;
  form.alarmSchedule[0].passFail = 'Fail';
  form.alarmSchedule[0].buttonTestPass = false;
  await adapter.saveSmokeAlarmForm('JOB-2026-102', form);

  const signed = await adapter.signOffSmokeAlarmForm('JOB-2026-102', {
    signed_by_name: 'Dave Miller',
    signer_role: 'technician',
    signed_timestamp: '2026-11-04T10:00:00.000Z',
  });

  assert.equal(signed.limitationsAndRentalNotes, STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE);
  assert.ok(!signed.limitationsAndRentalNotes.includes(DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE), 'default compliance sentence removed on failure');
});

test('smoke alarm sign-off strips default compliance note from combined notes while preserving custom technician text', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  const adapter = new MockDataAdapter();
  await adapter.resetToBaseline();
  const form = structuredClone(INITIAL_SMOKE_ALARM_CERT);
  form.jobReference = 'JOB-2026-102';
  form.signedOff = false;
  form.signedByTechName = undefined;
  form.signedTimestamp = undefined;
  form.fullSnapshot = undefined;
  form.limitationsAndRentalNotes = `${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE} • Attic hatch obstructed by ductwork.`;
  form.alarmSchedule[0].passFail = 'Fail';
  form.alarmSchedule[0].buttonTestPass = false;
  await adapter.saveSmokeAlarmForm('JOB-2026-102', form);

  const signed = await adapter.signOffSmokeAlarmForm('JOB-2026-102', {
    signed_by_name: 'Dave Miller',
    signer_role: 'technician',
    signed_timestamp: '2026-11-04T10:00:00.000Z',
  });

  assert.ok(!signed.limitationsAndRentalNotes.includes(DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE), 'default compliance sentence removed from combined notes');
  assert.ok(signed.limitationsAndRentalNotes.includes('Attic hatch obstructed by ductwork.'), 'custom technician note is preserved');
  assert.ok(signed.limitationsAndRentalNotes.includes(STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE), 'failure notice is appended');
  assert.equal(signed.limitationsAndRentalNotes, `Attic hatch obstructed by ductwork. • ${STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE}`);
});

test('smoke alarm sign-off strips seeded affirmative compliance note when copied from INITIAL_SMOKE_ALARM_CERT', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  const adapter = new MockDataAdapter();
  await adapter.resetToBaseline();
  const form = structuredClone(INITIAL_SMOKE_ALARM_CERT);
  form.jobReference = 'JOB-2026-102';
  form.signedOff = false;
  form.signedByTechName = undefined;
  form.signedTimestamp = undefined;
  form.fullSnapshot = undefined;
  // INITIAL_SMOKE_ALARM_CERT has SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE
  assert.equal(form.limitationsAndRentalNotes, SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE);
  form.alarmSchedule[0].passFail = 'Fail';
  form.alarmSchedule[0].buttonTestPass = false;
  await adapter.saveSmokeAlarmForm('JOB-2026-102', form);

  const signed = await adapter.signOffSmokeAlarmForm('JOB-2026-102', {
    signed_by_name: 'Dave Miller',
    signer_role: 'technician',
    signed_timestamp: '2026-11-04T10:00:00.000Z',
  });

  assert.equal(signed.limitationsAndRentalNotes, STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE);
  assert.ok(!signed.limitationsAndRentalNotes.includes(SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE), 'seeded compliance sentence removed on failure');
});

test('smoke alarm sign-off strips repeated space-separated default and seeded compliance notes on failure', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  const adapter = new MockDataAdapter();
  await adapter.resetToBaseline();
  const form = structuredClone(INITIAL_SMOKE_ALARM_CERT);
  form.jobReference = 'JOB-2026-102';
  form.signedOff = false;
  form.signedByTechName = undefined;
  form.signedTimestamp = undefined;
  form.fullSnapshot = undefined;
  // Repeated notes separated only by space in mixed orders
  form.limitationsAndRentalNotes = `${DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE} ${SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE}`;
  form.alarmSchedule[0].passFail = 'Fail';
  form.alarmSchedule[0].buttonTestPass = false;
  await adapter.saveSmokeAlarmForm('JOB-2026-102', form);

  const signed = await adapter.signOffSmokeAlarmForm('JOB-2026-102', {
    signed_by_name: 'Dave Miller',
    signer_role: 'technician',
    signed_timestamp: '2026-11-04T10:00:00.000Z',
  });

  assert.equal(signed.limitationsAndRentalNotes, STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE);
  assert.ok(!signed.limitationsAndRentalNotes.includes(DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE), 'default note stripped');
  assert.ok(!signed.limitationsAndRentalNotes.includes(SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE), 'seeded note stripped');
  assert.equal(
    (signed.limitationsAndRentalNotes.match(new RegExp(STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE, 'g')) || []).length,
    1,
    'statutory non-compliance notice appears exactly once',
  );
});


test('failed imported smoke snapshots with known affirmative notes are invalid and remain unchanged', () => {
  const base = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
  for (const note of [DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE, SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE]) {
    for (const suffix of ['', ` • Technician observation • ${STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE}`]) {
      const snapshot = structuredClone(base);
      Object.assign(snapshot.alarmSchedule[0], { passFail: 'Fail', buttonTestPass: false, complianceStatusProvisional: 'Fail' });
      snapshot.limitationsAndRentalNotes = note + suffix;
      const raw = JSON.stringify(snapshot);
      assert.equal(isValidPreviewSignOff('SMOKE_ALARM', snapshot.jobReference, true, raw), false);
      assert.equal(JSON.stringify(snapshot), raw, 'frozen evidence is not rewritten');
      assert.deepEqual(getInvalidPreviewForms(['SMOKE_ALARM'], { SMOKE_ALARM: true }, { SMOKE_ALARM: false }), ['SMOKE_ALARM']);
    }
  }
  const passing = JSON.stringify(base);
  assert.equal(isValidPreviewSignOff('SMOKE_ALARM', base.jobReference, true, passing), true);
  Object.assign(base.alarmSchedule[0], { passFail: 'Fail', buttonTestPass: false, complianceStatusProvisional: 'Fail' });
  base.limitationsAndRentalNotes = `Technician observation • ${STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE}`;
  assert.equal(isValidPreviewSignOff('SMOKE_ALARM', base.jobReference, true, JSON.stringify(base)), true);
});


test('effective results preserve stored intent, Provisional values and frozen input', () => {
  const electrical = structuredClone(INITIAL_ELECTRICAL_CERT.testedWorkItems[0]);
  const smoke = structuredClone(INITIAL_SMOKE_ALARM_CERT.alarmSchedule[0]);
  for (const manual of ['Pass', 'Fail'] as const) {
    for (const firstFails of [false, true]) for (const secondFails of [false, true]) {
      const item = { ...electrical, workResult: manual, polarityTest: firstFails ? 'Fail' as const : 'Pass' as const, earthContinuity: secondFails ? 'Fail' as const : 'Pass' as const };
      const alarm = { ...smoke, passFail: manual, complianceStatusProvisional: manual, buttonTestPass: !firstFails, interconnectionPass: !secondFails };
      const before = JSON.stringify([item, alarm]);
      const expected = firstFails || secondFails ? 'Fail' : manual;
      assert.equal(effectiveElectricalResult(Object.freeze(item)), expected);
      assert.deepEqual(effectiveSmokeAlarmResults(Object.freeze(alarm)), { passFail: expected, complianceStatusProvisional: expected });
      assert.equal(JSON.stringify([item, alarm]), before);
    }
  }
  assert.deepEqual(effectiveSmokeAlarmResults({ ...smoke, passFail: 'Pass', buttonTestPass: true, interconnectionPass: true, complianceStatusProvisional: 'Provisional' }), { passFail: 'Pass', complianceStatusProvisional: 'Provisional' });
});

test('mock adapter finalization matches effective results after test corrections and retains manual failures', async () => {
  const { MockDataAdapter } = await import('../src/services/mockAdapter.ts');
  for (const manual of ['Pass', 'Fail'] as const) for (const fails of [false, true]) {
    const adapter = new MockDataAdapter();
    await adapter.resetToBaseline();
    const jobId = 'JOB-2026-102';
    const signer = { signed_by_name: 'Synthetic Technician', signer_role: 'technician' as const, signed_timestamp: '2026-11-05T09:00:00.000Z' };
    const smoke = structuredClone(INITIAL_SMOKE_ALARM_CERT);
    Object.assign(smoke, { jobReference: jobId, signedOff: false, fullSnapshot: undefined });
    smoke.alarmSchedule = smoke.alarmSchedule.map(a => ({ ...a, passFail: manual, complianceStatusProvisional: manual, buttonTestPass: true, interconnectionPass: false }));
    await adapter.saveSmokeAlarmForm(jobId, smoke);
    smoke.alarmSchedule = smoke.alarmSchedule.map(a => ({ ...a, interconnectionPass: !fails }));
    await adapter.saveSmokeAlarmForm(jobId, smoke);
    const signedSmoke = await adapter.signOffSmokeAlarmForm(jobId, signer);
    const expected = fails ? 'Fail' : manual;
    assert.equal(signedSmoke.alarmSchedule[0].passFail, expected);
    assert.equal(JSON.parse(signedSmoke.fullSnapshot!).alarmSchedule[0].passFail, expected);
    assert.equal(signedSmoke.limitationsAndRentalNotes.includes('NON-COMPLIANCE NOTICE'), expected === 'Fail');
    await assert.rejects(adapter.saveSmokeAlarmForm(jobId, { limitationsAndRentalNotes: 'replacement' }), /cannot be modified/);
    const electrical = structuredClone(INITIAL_ELECTRICAL_CERT);
    Object.assign(electrical, { jobReference: jobId, signedOff: false, fullSnapshot: undefined });
    electrical.testedWorkItems = electrical.testedWorkItems.map(a => ({ ...a, workResult: manual, polarityTest: 'Fail', earthContinuity: 'Pass' }));
    await adapter.saveElectricalForm(jobId, electrical);
    electrical.testedWorkItems = electrical.testedWorkItems.map(a => ({ ...a, polarityTest: fails ? 'Fail' : 'Pass' }));
    await adapter.saveElectricalForm(jobId, electrical);
    const signedElectrical = await adapter.signOffElectricalForm(jobId, signer);
    assert.equal(signedElectrical.testedWorkItems[0].workResult, expected);
    assert.equal(JSON.parse(signedElectrical.fullSnapshot!).testedWorkItems[0].workResult, expected);
  }
});


test('historical quotations of default smoke compliance notes remain valid evidence', () => {
  for (const note of [DEFAULT_SMOKE_ALARM_COMPLIANCE_NOTE, SEEDED_SMOKE_ALARM_COMPLIANCE_NOTE]) {
    const base = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
    Object.assign(base.alarmSchedule[0], { passFail: 'Fail', buttonTestPass: false, complianceStatusProvisional: 'Fail' });
    base.limitationsAndRentalNotes = `Previous certificate stated: ${note} Inspection found otherwise. • ${STATUTORY_SMOKE_ALARM_NON_COMPLIANCE_NOTICE}`;
    const raw = JSON.stringify(base);
    assert.equal(isValidPreviewSignOff('SMOKE_ALARM', base.jobReference, true, raw), true);
    assert.equal(JSON.stringify(base), raw);
    for (const separator of [' • ', '\n', '\r\n']) {
      base.limitationsAndRentalNotes = `Technician observations${separator}${note}`;
      assert.equal(isValidPreviewSignOff('SMOKE_ALARM', base.jobReference, true, JSON.stringify(base)), false, 'standalone assertion remains invalid');
    }
  }
});
