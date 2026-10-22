import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
} from './cabmsLogic.ts';
import { Job, Customer } from '../types/cabms.ts';

test('validateJobCompletion: direct-to-invoice job completes without forms', () => {
  const directJob: Job = {
    id: 'JOB-2026-102',
    brandId: 'smart_home',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Emergency Inverter Service',
    jobType: 'Direct-to-Invoice Service',
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
      channel: 'SMS_AND_EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    unresolvedWarnings: [],
  };

  const result = validateJobCompletion(directJob, {});
  assert.equal(result.canComplete, true);
  assert.equal(result.missingRequirements.length, 0);
  assert.equal(result.isDirectToInvoice, true);
});

test('validateJobCompletion: documentation job fails when JSA is not signed', () => {
  const docJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: 'Solar Installation & Audit',
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
      channel: 'SMS_AND_EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    unresolvedWarnings: [],
  };

  // With no forms provided
  const result1 = validateJobCompletion(docJob, {});
  assert.equal(result1.canComplete, false);
  assert.ok(result1.missingRequirements.some(r => r.includes('JSA')));
  assert.ok(result1.missingRequirements.some(r => r.includes('Smoke Alarm')));

  // With unsigned JSA and signed smoke alarm
  const result2 = validateJobCompletion(docJob, {
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
      formRevision: 'Rev 3.1 - Oct 2026',
      issuerPlaceholder: 'Solarcell Safety Compliance',
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
      limitationsAndRentalNotes: 'All alarms tested and compliant with current Queensland smoke alarm legislation mandate.',
      signedOff: true,
      signedByTechName: 'Dave Miller',
      signedTimestamp: '2026-11-02 09:45',
      provisionalNote: 'Provisional notice: Room/model count limits and expiry wording are provisional.',
    },
  });

  assert.equal(result2.canComplete, false);
  assert.ok(result2.missingRequirements.includes('JSA / Risk Assessment requires technician DEMO sign-off'));
});

test('validateJobCompletion: succeeds once JSA is signed off', () => {
  const docJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: 'Solar Installation & Audit',
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
      channel: 'SMS_AND_EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    unresolvedWarnings: [],
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
      formRevision: 'Rev 3.1 - Oct 2026',
      issuerPlaceholder: 'Solarcell Safety Compliance',
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
    },
  });

  assert.equal(result.canComplete, true);
  assert.equal(result.missingRequirements.length, 0);
  assert.ok(result.warnings.length > 0); // Provisional warning is retained
});

test('deduplicateReviewRequest: prevents multiple dispatches', () => {
  const job: Job = {
    id: 'JOB-1',
    brandId: 'solarcell',
    customerId: 'C-1',
    title: 'Solar test',
    jobType: 'Install',
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
      channel: 'SMS_AND_EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    unresolvedWarnings: [],
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
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'SMS_AND_EMAIL_SIMULATED', history: [] },
    reminders: [
      { id: 'REM-1', scheduledFor: '2026-11-01 09:00', type: 'REMINDER_24HR', channel: 'SMS_AND_EMAIL_SIMULATED', suppressed: false, delivered: false },
      { id: 'REM-2', scheduledFor: '2026-11-02 07:00', type: 'REMINDER_2HR', channel: 'SMS_AND_EMAIL_SIMULATED', suppressed: false, delivered: false },
    ],
    unresolvedWarnings: [],
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

test('verifyPersonaAccess: technician cannot access unassigned job or tech settings', () => {
  const unassignedCheck = verifyPersonaAccess('technician', 'unassigned_job');
  assert.equal(unassignedCheck.allowed, false);

  const techSettingsCheck = verifyPersonaAccess('technician', 'technical_integrations');
  assert.equal(techSettingsCheck.allowed, false);

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
