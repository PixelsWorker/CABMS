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
} from './cabmsLogic.ts';
import { Job, Customer, TemplateSetting } from '../types/cabms.ts';
import {
  INITIAL_ELECTRICAL_CERT,
  INITIAL_JSA_FORM,
  INITIAL_SMOKE_ALARM_CERT,
  INITIAL_TCA1_CERT,
  INITIAL_TCA2_CERT,
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
      brandName: 'Gold Coast Smart Home Solutions',
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
  assert.ok(result.missingRequirements.includes('JSA / Risk Assessment requires technician DEMO sign-off'));
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
  const gst = Math.round(exSubtotal * 0.1 * 100) / 100;
  const calculatedTotal = Math.round((exSubtotal + gst) * 100) / 100;

  assert.equal(exSubtotal, 1318.18);
  assert.equal(gst, 131.82);
  assert.equal(calculatedTotal, 1450.00);
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


