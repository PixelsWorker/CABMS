import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  calculateReminderDueTime,
} from './cabmsLogic.ts';
import { Job, Customer } from '../types/cabms.ts';

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

