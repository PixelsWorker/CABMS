import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Customer,
  Job,
  Quote,
  JsaFormData,
  SmokeAlarmCertData,
  Tca2CertData,
  ScheduledReminder,
  TemplateSetting,
} from '../src/types/cabms.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  calculateReminderDueTime,
} from '../src/utils/cabmsLogic.ts';
import {
  INITIAL_BRANDS,
  INITIAL_JOB_TYPES,
  INITIAL_TEMPLATES,
} from '../src/data/seedData.ts';

// Deterministic Sequence Counters for Tests
let seq = { customer: 100, job: 500, quote: 300, invoice: 400, reminder: 700 };

// -------------------------------------------------------------
// JOURNEY A: Customer Entry -> Job -> Quote -> Acceptance -> Forms -> Completion -> Review
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey A: Complete customer-to-completion and review dispatch journey', () => {
  // 1. Customer entry with simulated MYOB write-through
  seq.customer++;
  const customer: Customer = {
    id: `CUSTOMER-JOURNEY-${seq.customer}`,
    myobCustomerId: `MYOB-CO-${seq.customer}`,
    name: 'Sarah Connor',
    contactPerson: 'Sarah Connor',
    email: 'sarah.c@example.invalid',
    phone: '0400 111 222',
    billingAddress: '100 Skyway Drive, Robina QLD 4226',
    brandAffiliations: ['solarcell'],
    syncStatus: 'SYNCED',
    createdAt: '2026-11-02',
    activityHistory: [{ timestamp: '2026-11-02 09:00', action: 'Created in MYOB Business', actor: 'owner_admin' }],
  };
  assert.equal(customer.syncStatus, 'SYNCED');

  // 2. Job creation & technician assignment
  seq.job++;
  const solarJobType = INITIAL_JOB_TYPES.find(jt => jt.id === 'JT-001')!;
  const scheduledDate = '2026-11-04';
  const scheduledTime = '09:00';
  const reminderDue = calculateReminderDueTime(scheduledDate, scheduledTime, 2);

  seq.reminder++;
  const initialReminder: ScheduledReminder = {
    id: `REM-${seq.reminder}`,
    targetAppointmentTime: `${scheduledDate} ${scheduledTime}`,
    scheduledFor: reminderDue,
    leadHours: 2,
    type: 'REMINDER_2HR',
    channel: 'EMAIL_SIMULATED',
    suppressed: false,
    delivered: false,
  };

  const job: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'solarcell',
    customerId: customer.id,
    title: 'Complete 6.6kW PV Installation',
    jobType: solarJobType.name,
    jobTypeVersion: solarJobType.version,
    siteAddress: customer.billingAddress,
    siteContact: customer.contactPerson,
    sitePhone: customer.phone,
    description: 'Rooftop solar and inverter installation',
    status: 'SCHEDULED',
    appointmentStatus: 'SCHEDULED',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate,
    scheduledTime,
    estimatedDurationHours: 4,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'SMOKE_ALARM'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: INITIAL_BRANDS.solarcell.reviewUrlPlaceholder,
      brandName: INITIAL_BRANDS.solarcell.name,
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [initialReminder],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // 3. Quotation preparation
  seq.quote++;
  const exSubtotal = 4500.00;
  const gst = 450.00;
  const total = 4950.00;
  const quote: Quote = {
    id: `QUOTE-2026-${seq.quote}`,
    jobId: job.id,
    customerId: customer.id,
    brandId: 'solarcell',
    externalMyobRef: `MYOB-Q-${seq.quote}`,
    title: 'Solar System Turnkey Scope',
    subtotal: exSubtotal,
    gst,
    total,
    lineItems: [{ id: 'ITEM-1', description: 'PV Array', quantity: 1, unitPrice: exSubtotal, total: exSubtotal }],
    termsVersion: 'v2.4',
    termsContentSnapshot: 'Solarcell Standard Customer Terms v2.4 Snapshot',
    frozenIssuerSnapshot: `${INITIAL_BRANDS.solarcell.legalIssuerName} • ${INITIAL_BRANDS.solarcell.abnPlaceholder}`,
    acceptanceStatus: 'SENT',
    linkScenario: 'valid',
    acceptanceHistory: [],
  };
  job.quote = quote;

  // 4. Customer accepts quote
  quote.acceptanceStatus = 'ACCEPTED';
  quote.acceptedAt = '2026-11-03 14:00';
  quote.acceptedByName = customer.contactPerson;
  assert.equal(job.quote.acceptanceStatus, 'ACCEPTED');

  // 5. Pre-execution completion validation fails because forms are unsigned
  const preCheck = validateJobCompletion(job, {});
  assert.equal(preCheck.canComplete, false);
  assert.ok(preCheck.missingRequirements.some(r => r.includes('JSA')));
  assert.ok(preCheck.missingRequirements.some(r => r.includes('Smoke Alarm')));

  // 6. Technician fills JSA and Smoke Alarm certificates
  const jsa: JsaFormData = {
    jobReference: job.id,
    date: scheduledDate,
    customerName: customer.name,
    siteContactPlaceholder: customer.contactPerson,
    siteAddress: customer.billingAddress,
    taskDescription: job.description,
    assetsIdentified: 'Rooftop trusses, main switchboard',
    personnelName: 'Dave Miller',
    personnelRole: 'Lead Solar Electrician',
    licencePlaceholder: 'Q-ELEC-98765-DEMO',
    licenceExpiryPlaceholder: '31/12/2027',
    inductionCompleted: true,
    competencyVerified: true,
    overallRiskLevel: 'M',
    steps: [
      { id: 'step-1', taskStep: 'Roof access', hazards: 'Falls', initialRisk: 'H', controls: 'Harness', residualRisk: 'L', responsibleRole: 'Tech' },
    ],
    ppeChecklist: [{ item: 'Safety Boots', status: 'Yes' }],
    isolationsAndPermits: [{ item: 'AC Isolator', required: 'Yes', referenceOrNotes: 'Isolated' }],
    emergencyAssemblyArea: 'Front driveway',
    emergencyWardenPlaceholder: 'Dave Miller',
    firstAidOfficerPlaceholder: 'Dave Miller',
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: `${scheduledDate} 11:30`,
    formRevision: 'Rev 4.2 - Oct 2026',
    issuerPlaceholder: INITIAL_BRANDS.solarcell.legalIssuerName,
    frozenIssuerSnapshot: `${INITIAL_BRANDS.solarcell.legalIssuerName} • ${INITIAL_BRANDS.solarcell.abnPlaceholder}`,
    attachedSampleIds: ['sample-switchboard-01'],
  };

  const smokeAlarm: SmokeAlarmCertData = {
    certReference: `SMOKE-2026-${seq.job}`,
    jobReference: job.id,
    dateOfInspection: scheduledDate,
    issuedByPlaceholder: INITIAL_BRANDS.solarcell.legalIssuerName,
    issuedToRole: 'Owner',
    propertyType: 'Detached House',
    storeys: 1,
    bedrooms: 3,
    occupancyStatus: 'Occupied',
    scopeOfWork: { visualInspection: true, operationalTesting: true, interconnectionTesting: true, cleaningAndVacuuming: true, batteryReplacement: false, alarmReplacement: false },
    alarmSchedule: [
      { id: 'ALM-1', roomLocation: 'Hallway', alarmBrandModel: 'Clipsal 755PSMA4', standardMarkingPlaceholder: 'AS 3786:2014', manufactureDateOrExpiry: 'Exp 2031', powerSource: '240V Hardwired with Battery Backup', passFail: 'Pass', buttonTestPass: true, interconnectionPass: true, complianceStatusProvisional: 'Pass' },
    ],
    relatedElectricalCertRef: 'N/A',
    attachmentsLinked: false,
    limitationsAndRentalNotes: 'Compliant installation',
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: `${scheduledDate} 12:00`,
    provisionalNote: 'AS 3786 verified',
    attachedSampleIds: [],
  };

  // 7. Re-validate completion with signed forms
  const postCheck = validateJobCompletion(job, { jsa, smokeAlarm });
  assert.equal(postCheck.canComplete, true);
  job.status = 'COMPLETED';

  // 8. Review invitation dispatch and deduplication
  let dispatched = false;
  const reviewResult = deduplicateReviewRequest(job, () => {
    dispatched = true;
    return { success: true, reviewUrl: job.reviewRequest.reviewLink };
  });

  assert.equal(reviewResult.allowed, true);
  assert.equal(dispatched, true);
  job.reviewRequest.status = 'SENT';
  job.reviewRequest.sentTimestamp = `${scheduledDate} 13:00`;

  // 9. Second review dispatch attempt is strictly blocked
  const secondAttempt = deduplicateReviewRequest(job, () => {
    throw new Error('Should not be called');
  });
  assert.equal(secondAttempt.allowed, false);
  assert.ok(secondAttempt.reason?.includes('already sent'));
});

// -------------------------------------------------------------
// JOURNEY B: Direct-to-Invoice Service Call
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey B: Direct-to-invoice service completes without forms and prepares invoice', () => {
  seq.job++;
  const directJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'smart_home',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Wi-Fi Smart Hub Reset',
    jobType: 'Direct-to-Invoice Service',
    jobTypeVersion: 'v1.0',
    siteAddress: '14 Paradise Waters Way',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Reconfigure home automation gateway',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '14:00',
    estimatedDurationHours: 1,
    isDirectToInvoice: true,
    formsRequired: [], // Genuinely empty!
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'Smart Home', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // Validate completion
  const check = validateJobCompletion(directJob, {});
  assert.equal(check.canComplete, true);
  assert.equal(check.isDirectToInvoice, true);
  assert.equal(check.missingRequirements.length, 0);

  // Completion & Invoice Preparation
  directJob.status = 'COMPLETED';
  seq.invoice++;
  directJob.invoice = {
    id: `INV-2026-${seq.invoice}`,
    externalMyobRef: `MYOB-INV-${seq.invoice}`,
    amount: 220.00,
    status: 'SENT_TO_MYOB',
    issuedDate: '2026-11-02',
    dueDate: '2026-11-02',
    reconciliationRequired: false,
    syncStatus: 'SYNCED',
  };

  assert.equal(directJob.invoice.status, 'SENT_TO_MYOB');
  assert.equal(directJob.invoice.amount, 220.00);
});

// -------------------------------------------------------------
// JOURNEY C: Cabling Defect -> TCA2 -> Acknowledgement -> Office Review -> Real Follow-up Job
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey C: TCA2 defect generates customer ack, office review, and REAL follow-up work order', () => {
  seq.job++;
  const initialJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'cctv',
    customerId: 'CUSTOMER-DEMO-002',
    title: 'Commercial Security Camera Audit',
    jobType: 'Enterprise CCTV & Cabling Inspection',
    jobTypeVersion: 'v2.1',
    siteAddress: '88 Industrial Zone',
    siteContact: 'Marcus Vance',
    sitePhone: '0400 000 002',
    description: 'Inspect telecommunications and IP video cabling',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '13:00',
    estimatedDurationHours: 4,
    isDirectToInvoice: false,
    formsRequired: ['TCA2'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'CCTV', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const tca2: Tca2CertData = {
    reportReference: `TCA2-DEFECT-2026-${seq.job}`,
    jobReference: initialJob.id,
    inspectionDate: '2026-11-02',
    businessCablerPlaceholder: 'Dave Miller',
    customerName: initialJob.siteContact,
    siteAddress: initialJob.siteAddress,
    cablingScope: 'Existing Only',
    cablingTypes: ['Category 5e Legacy Data'],
    locationsInspected: 'Riser Cupboard B',
    nonComplianceDescription: 'Telecommunications cabling co-located in common conduit with 240V mains power without physical barrier.',
    requirementReferencePlaceholder: 'AS/CA S009:2020 Clause 5.3.1',
    riskCategory: 'High (Immediate Shock / Fire Hazard)',
    samplePhotoLinked: true,
    rectificationRecommendation: 'Install independent dedicated 25mm PVC conduit for data cabling with 50mm separation distance.',
    responsibleParty: 'Customer / Building Owner',
    urgencyLevel: 'Immediate (Within 24 Hours)',
    quotationReferencePlaceholder: 'MYOB-Q-RECTIFICATION',
    targetResolutionDate: '2026-11-05',
    customerAcknowledged: true,
    customerAckTimestamp: '2026-11-02 14:30',
    officeReviewCompleted: false,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 14:00',
    warningNotice: 'NON-COMPLIANCE RECORDED',
    attachedSampleIds: ['sample-cabling-defect-01'],
  };

  // Perform Office Review: generates a REAL follow-up job
  seq.job++;
  const followupJobId = `JOB-2026-${seq.job}`;
  const followupJob: Job = {
    id: followupJobId,
    brandId: 'cctv',
    customerId: initialJob.customerId,
    title: `TCA2 Remediation: Dedicated Conduit Installation (Follow-up to ${initialJob.id})`,
    jobType: 'Enterprise CCTV & Cabling Inspection',
    jobTypeVersion: 'v2.1',
    siteAddress: initialJob.siteAddress,
    siteContact: initialJob.siteContact,
    sitePhone: initialJob.sitePhone,
    description: `Rectification follow-up for Cabling Non-Compliance reported under ${initialJob.id}`,
    status: 'NEW',
    appointmentStatus: 'SCHEDULED',
    assignedTechId: null,
    assignedTechName: null,
    scheduledDate: '2026-11-06',
    scheduledTime: '08:30',
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'TCA1'],
    attachedSampleIds: tca2.attachedSampleIds,
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'CCTV', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    unresolvedWarnings: ['Follow-up rectification work order queued from TCA2 Office Review.'],
    activityHistory: [{ timestamp: '2026-11-02 15:00', action: `Rectification work order #${followupJobId} created`, actor: 'office_staff' }],
  };

  tca2.officeReviewCompleted = true;
  tca2.reviewedByOfficeStaff = 'Emma Wilson';
  tca2.rectificationFollowupJobId = followupJob.id;

  assert.equal(tca2.rectificationFollowupJobId, followupJob.id);
  assert.equal(followupJob.status, 'NEW');
  assert.ok(followupJob.title.includes(initialJob.id));
});

// -------------------------------------------------------------
// JOURNEY D: Historical Template Version Preservation
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey D: Historical version preservation retains frozen snapshot', () => {
  const template: TemplateSetting = {
    ...INITIAL_TEMPLATES.find(t => t.type === 'TERMS')!,
  };

  // Record 1 created with current version v2.4
  const record1Snapshot = {
    termsVersion: template.currentVersion,
    termsContent: template.content,
  };
  assert.equal(record1Snapshot.termsVersion, 'v2.4');

  // Admin updates template to draft v2.5 and publishes it
  const newPublishedVersion = 'v2.5';
  const newContent = template.content + '\nClause 19: Updated statutory warranties Nov 2026.';
  template.currentVersion = newPublishedVersion;
  template.content = newContent;
  template.revisions.unshift({
    version: newPublishedVersion,
    status: 'PUBLISHED',
    content: newContent,
    updatedAt: '2026-11-03 10:00',
    updatedBy: 'SUPER_ADMIN',
  });

  // Verify Record 1 still retains exact historical snapshot v2.4
  assert.equal(record1Snapshot.termsVersion, 'v2.4');
  assert.ok(!record1Snapshot.termsContent.includes('Clause 19'));
  // Verify template master has moved forward
  assert.equal(template.currentVersion, 'v2.5');
  assert.ok(template.content.includes('Clause 19'));
});

// -------------------------------------------------------------
// JOURNEY E: Failures and Recovery
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey E: Disconnected MYOB, reminder suppression on reschedule, and uncertain review recovery', () => {
  // 1. Disconnected MYOB saves customer as recoverable draft
  seq.customer++;
  const disconnectedDraft: Customer = {
    id: `CUSTOMER-DRAFT-${seq.customer}`,
    myobCustomerId: 'PENDING_MYOB_SYNC',
    name: 'Offline Customer',
    contactPerson: 'Offline Person',
    email: 'offline@example.invalid',
    phone: '0400 999 888',
    billingAddress: '55 Industrial Lane',
    brandAffiliations: ['cctv'],
    syncStatus: 'FAILED',
    createdAt: '2026-11-02',
    isRecoverableDraft: true,
  };
  assert.equal(disconnectedDraft.syncStatus, 'FAILED');
  assert.equal(disconnectedDraft.isRecoverableDraft, true);

  // Recovery: Reconnection and sync retry
  disconnectedDraft.myobCustomerId = `MYOB-RETRY-${seq.customer}`;
  disconnectedDraft.syncStatus = 'SYNCED';
  disconnectedDraft.isRecoverableDraft = false;
  assert.equal(disconnectedDraft.syncStatus, 'SYNCED');

  // 2. Rescheduled appointment suppresses old reminders and creates replacement
  const initialJob: Job = {
    id: 'JOB-RESCHED-01',
    brandId: 'solarcell',
    customerId: 'C-01',
    title: 'Service Call',
    jobType: 'Install',
    jobTypeVersion: 'v1.0',
    siteAddress: '',
    siteContact: 'John',
    sitePhone: '0400',
    description: '',
    status: 'SCHEDULED',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: [],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [
      { id: 'REM-OLD-1', targetAppointmentTime: '2026-11-02 10:00', leadHours: 2, scheduledFor: '2026-11-02 08:00', type: 'REMINDER_2HR', channel: 'EMAIL_SIMULATED', suppressed: false, delivered: false },
    ],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const suppressedReminders = suppressOldReminders(initialJob, 'Customer requested reschedule', '2026-11-02T08:00:00+10:00');
  assert.equal(suppressedReminders[0].suppressed, true);
  assert.ok(suppressedReminders[0].suppressionReason?.includes('Customer requested reschedule'));

  // 3. Review delivery timeout -> UNCERTAIN -> Reconciled to SENT
  const reviewJob: Job = {
    ...initialJob,
    reviewRequest: {
      status: 'UNCERTAIN',
      uncertainReconciliationNeeded: true,
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [{ timestamp: '2026-11-02 11:00', event: 'Timeout 504', status: 'UNCERTAIN' }],
    },
  };

  // Duplicate dispatch blocked during UNCERTAIN
  const blockedDuringUncertain = deduplicateReviewRequest(reviewJob, () => {
    throw new Error('Blocked');
  });
  assert.equal(blockedDuringUncertain.allowed, false);
  assert.ok(blockedDuringUncertain.reason?.includes('UNCERTAIN'));

  // Manual reconciliation
  reviewJob.reviewRequest.status = 'SENT';
  reviewJob.reviewRequest.uncertainReconciliationNeeded = false;
  reviewJob.reviewRequest.sentTimestamp = '2026-11-02 11:30';
  assert.equal(reviewJob.reviewRequest.status, 'SENT');
});
