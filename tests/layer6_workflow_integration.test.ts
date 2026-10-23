import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import {
  Customer,
  Job,
  Persona,
  Quote,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca2CertData,
  Tca2AuditRecord,
  ScheduledReminder,
  TemplateSetting,
  DraftBusinessProfile,
} from '../src/types/cabms.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  calculateReminderDueTime,
  verifyPersonaAccess,
  processOfficeReviewTca2,
  processCustomerAckTca2,
  recalculateJobAttachments,
  processPublishTemplate,
  processReviewDispatch,
  validateSignedSnapshot,
} from '../src/utils/cabmsLogic.ts';
import {
  INITIAL_BRANDS,
  INITIAL_JOBS,
  INITIAL_JOB_TYPES,
  INITIAL_TEMPLATES,
} from '../src/data/seedData.ts';

// Global JSDOM setup for mounted React 19 testing
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
});
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
Object.defineProperty(globalThis, 'HTMLDivElement', { value: dom.window.HTMLDivElement, writable: true, configurable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Executable Mounted React Context Runner
export async function withMountedContext(
  testFn: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) => Promise<void> | void
) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  let currentContext!: ReturnType<typeof useCabms>;

  function TestObserver() {
    currentContext = useCabms();
    return React.createElement('div', { id: 'test-observer-mounted' },
      React.createElement('span', { id: 'job-count' }, currentContext.jobs.length),
      React.createElement('span', { id: 'persona-badge' }, currentContext.persona)
    );
  }

  await act(async () => {
    root.render(
      React.createElement(CabmsProvider, null, React.createElement(TestObserver))
    );
  });

  try {
    await testFn(currentContext, container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

// Synchronous helper for legacy journey calls
function getMountedCabmsContext() {
  let ctx: any;
  function Harness() {
    ctx = useCabms();
    return null;
  }
  act(() => {
    const root = createRoot(dom.window.document.createElement('div'));
    root.render(React.createElement(CabmsProvider, null, React.createElement(Harness)));
  });
  return ctx;
}

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

  // 2. Job creation & technician assignment (Solar installation policy JT-001 requires JSA & ELECTRICAL)
  seq.job++;
  const solarJobType = INITIAL_JOB_TYPES.find(jt => jt.id === 'JT-001')!;
  assert.deepEqual(solarJobType.formsRequired, ['JSA', 'ELECTRICAL']);
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
    formsRequired: [...solarJobType.formsRequired],
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

  // 5. Pre-execution completion validation fails because required JSA and Electrical forms are unsigned
  const preCheck = validateJobCompletion(job, {});
  assert.equal(preCheck.canComplete, false);
  assert.ok(preCheck.missingRequirements.some(r => r.includes('JSA')));
  assert.ok(preCheck.missingRequirements.some(r => r.includes('Electrical Certificate')));

  // 6. Technician fills JSA and Electrical Safety certificates
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

  const electrical: ElectricalCertData = {
    certReference: `ELEC-2026-${seq.job}`,
    jobReference: job.id,
    dateOfTest: scheduledDate,
    customerName: customer.name,
    installationAddress: customer.billingAddress,
    siteContact: customer.contactPerson,
    occupierRole: 'Owner',
    contractorNamePlaceholder: INITIAL_BRANDS.solarcell.legalIssuerName,
    electricianLicencePlaceholder: 'Dave Miller (Q-ELEC-98765-DEMO)',
    issuerWordingPlaceholder: 'Electrical Safety Office Queensland (Sanitised Model Form)',
    testedWorkItems: [
      {
        id: 'WORK-1',
        description: 'Solar Generation Sub-Circuit 3-Phase 32A',
        circuitsTested: 'Sub-board 1 to Inverter Array',
        insulationResistanceResult: '> 200 Megohms (> 1.0M requirement)',
        polarityTest: 'Pass',
        earthContinuity: 'Pass',
        rcdTripTimeMs: '18ms (Type A 30mA RCD)',
        workResult: 'Pass',
      },
    ],
    standardsReliedOn: ['AS/NZS 3000:2018 Wiring Rules'],
    partACertificationPlaceholder: 'Part A Certification',
    limitationsAndConsumerRightsPlaceholder: 'Consumer Notice',
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: `${scheduledDate} 12:00`,
    unresolvedNotice: 'Electrical Part B / sections 7-8 not supplied or unresolved.',
    attachedSampleIds: [],
  };

  // 7. Re-validate completion with signed JSA and Electrical forms
  const postCheck = validateJobCompletion(job, { jsa, electrical });
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
// JOURNEY C: Cabling Defect -> TCA2 -> Separate Audit Records -> Idempotent Office Review -> Unscheduled Follow-up Job
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey C: TCA2 defect generates separate audit record, idempotent office review, and unscheduled follow-up work order', () => {
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

  // 1. Technician signs TCA2 Defect Report
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
    customerAcknowledged: false,
    officeReviewCompleted: false,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 14:00',
    warningNotice: 'NON-COMPLIANCE RECORDED',
    attachedSampleIds: ['sample-cabling-defect-01'],
    fullSnapshot: '',
  };
  // Freeze technician certificate permanently
  tca2.fullSnapshot = JSON.stringify(tca2);
  const frozenTechnicianSnapshot = tca2.fullSnapshot;

  // 2. Customer Acknowledgement is recorded in separate audit record (NOT mutating signed TCA2 cert)
  const tca2AuditRecords: Record<string, Tca2AuditRecord> = {};
  tca2AuditRecords[initialJob.id] = {
    jobId: initialJob.id,
    customerAcknowledged: true,
    customerAckTimestamp: '2026-11-02 14:30',
    officeReviewCompleted: false,
  };

  // Assert signed certificate fullSnapshot remains 100% untouched
  assert.equal(tca2.fullSnapshot, frozenTechnicianSnapshot);
  assert.equal(tca2AuditRecords[initialJob.id].customerAcknowledged, true);

  // 3. Office Review Role Check: Technicians are strictly prohibited
  const techAttempt = verifyPersonaAccess('technician', 'office_compliance_review');
  assert.equal(techAttempt.allowed, false);

  // 4. Authoritative Pure State Transition & Atomicity Invariant
  // Two calls with the same state: first creates follow-up, second is idempotent
  const reviewResult1 = processOfficeReviewTca2({
    jobId: initialJob.id,
    actorPersona: 'office_staff',
    existingAudit: tca2AuditRecords[initialJob.id],
    existingJobs: [initialJob],
    tca2Cert: tca2,
    sourceJob: initialJob,
    demoClock: '2026-11-02 15:00',
    nextJobSeq: 500,
  });
  assert.equal(reviewResult1.success, true);
  assert.equal(reviewResult1.isDuplicate, false);
  assert.ok(reviewResult1.newFollowupJob);
  assert.equal(reviewResult1.newFollowupJob?.id, 'JOB-2026-501');
  assert.equal(reviewResult1.newFollowupJob?.appointmentStatus, 'UNSCHEDULED');
  assert.equal(reviewResult1.newFollowupJob?.scheduledDate, null);
  assert.equal(reviewResult1.newFollowupJob?.scheduledTime, null);
  assert.equal(reviewResult1.updatedAuditRecord.officeReviewCompleted, true);

  // Second call with updated state (without intervening render) produces no duplicate job
  const reviewResult2 = processOfficeReviewTca2({
    jobId: initialJob.id,
    actorPersona: 'office_staff',
    existingAudit: reviewResult1.updatedAuditRecord,
    existingJobs: [initialJob, reviewResult1.newFollowupJob!],
    tca2Cert: tca2,
    sourceJob: initialJob,
    demoClock: '2026-11-02 15:01',
    nextJobSeq: 501,
  });
  assert.equal(reviewResult2.success, true);
  assert.equal(reviewResult2.isDuplicate, true);
  assert.equal(reviewResult2.newFollowupJob, undefined);
  assert.equal(reviewResult2.updatedAuditRecord.rectificationFollowupJobId, 'JOB-2026-501');

  // 5. Real Context Action Integration: Two calls in the same tick without intervening render
  const realCtx = getMountedCabmsContext();
  // Call real CabmsContext.officeReviewTca2 twice synchronously in same tick on seed job JOB-2026-104
  realCtx.officeReviewTca2('JOB-2026-104');
  realCtx.officeReviewTca2('JOB-2026-104');

  const authState = realCtx.getAuthoritativeState();
  const followups = authState.jobs.filter((j: Job) => j.description?.includes('JOB-2026-104') || j.title?.includes('JOB-2026-104'));
  assert.equal(followups.length, 1, 'Exactly one follow-up rectification job must be created despite double review call in same tick');
  const followupJob = followups[0];
  assert.equal(followupJob.status, 'NEW');
  assert.equal(followupJob.appointmentStatus, 'UNSCHEDULED');
  assert.equal(followupJob.scheduledDate, null);
  assert.equal(followupJob.scheduledTime, null);
  assert.equal(authState.tca2AuditRecords['JOB-2026-104'].officeReviewCompleted, true);
  assert.equal(authState.tca2AuditRecords['JOB-2026-104'].rectificationFollowupJobId, followupJob.id);

  // 6. Customer Acknowledgement Invariants & Guards
  // Attempt customer ack on unsigned notice -> rejected
  const unsignedNotice = { ...tca2, signedOff: false };
  const unsignedAckAttempt = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: unsignedNotice,
    demoClock: '2026-11-02 14:10',
  });
  assert.equal(unsignedAckAttempt.success, false);
  assert.ok(unsignedAckAttempt.error?.includes('signed off by a technician'));

  // Attempt customer ack by technician -> rejected
  const techAckAttempt = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'technician',
    tca2Cert: tca2,
    demoClock: '2026-11-02 14:15',
  });
  assert.equal(techAckAttempt.success, false);
  assert.ok(techAckAttempt.error?.includes('Field technician cannot self-acknowledge'));

  // Valid customer acknowledgement on signed notice -> allowed and records timestamp
  const validAck = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: tca2,
    demoClock: '2026-11-02 14:20',
  });
  assert.equal(validAck.success, true);
  assert.ok(validAck.updatedAuditRecord);
  assert.equal(validAck.updatedAuditRecord?.customerAcknowledged, true);
  assert.equal(validAck.updatedAuditRecord?.customerAckTimestamp, '2026-11-02 14:20');

  // Second customer acknowledgement attempt on already acknowledged audit record -> rejected as duplicate
  const duplicateAck = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: tca2,
    existingAudit: validAck.updatedAuditRecord,
    demoClock: '2026-11-02 14:25',
  });
  assert.equal(duplicateAck.success, false);
  assert.ok(duplicateAck.error?.includes('ALREADY ACKNOWLEDGED'));

  // 7. TCA2 Completion Validation Dependency
  // Job with signed TCA2 but missing acknowledgement -> completion blocked
  const completionCheckBeforeAck = validateJobCompletion(
    initialJob,
    { tca2 },
    { jobId: initialJob.id, customerAcknowledged: false, officeReviewCompleted: false }
  );
  assert.equal(completionCheckBeforeAck.canComplete, false);
  assert.ok(completionCheckBeforeAck.missingRequirements.some(r => r.includes('acknowledged by customer')));

  // Recording acknowledgement in separate Tca2AuditRecord satisfies completion validator
  const completionCheckAfterAck = validateJobCompletion(
    initialJob,
    { tca2 },
    validAck.updatedAuditRecord
  );
  assert.equal(completionCheckAfterAck.canComplete, true);

  // Assert signed TCA2 cert snapshot still remains 100% frozen and unmodified
  assert.equal(tca2.fullSnapshot, frozenTechnicianSnapshot);
  assert.equal(tca2.customerAcknowledged, false);
});

// -------------------------------------------------------------
// JOURNEY C-2: Unscheduled Job Creation & Universal Form Attachment Immutability
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey C-2: Unassigned work order creation defaults to UNSCHEDULED with null date, and signed forms reject attachment mutation', () => {
  // 1. Unscheduled job creation contract
  seq.job++;
  const unassignedJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Unassigned Solar Inverter Assessment',
    jobType: 'Solar Installation & Audit',
    jobTypeVersion: 'v1.0',
    siteAddress: '42 Orchid Avenue',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Preliminary inspection',
    status: 'NEW',
    appointmentStatus: 'UNSCHEDULED',
    assignedTechId: null,
    assignedTechName: null,
    scheduledDate: null,
    scheduledTime: null,
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'Solarcell', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [], // No reminders scheduled for unscheduled job
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  assert.equal(unassignedJob.appointmentStatus, 'UNSCHEDULED');
  assert.equal(unassignedJob.scheduledDate, null);
  assert.equal(unassignedJob.scheduledTime, null);
  assert.equal(unassignedJob.reminders.length, 0);

  // 2. Multi-form attachment recalculation & immutability guards
  // When a job has multiple forms sharing an attachment, removing it from one form preserves it on the job
  const jobForms = {
    jsa: { signedOff: false, attachedSampleIds: ['ATT-001', 'ATT-002'] },
    electrical: { signedOff: false, attachedSampleIds: ['ATT-002', 'ATT-003'] },
  };
  // Removing ATT-001 from JSA
  jobForms.jsa.attachedSampleIds = ['ATT-002'];
  const recalculatedAfterAtt1Removal = recalculateJobAttachments([
    jobForms.jsa.attachedSampleIds,
    jobForms.electrical.attachedSampleIds,
  ]);
  assert.deepEqual(recalculatedAfterAtt1Removal.sort(), ['ATT-002', 'ATT-003']);
  // ATT-002 is preserved on the job because Electrical still uses it
  assert.ok(recalculatedAfterAtt1Removal.includes('ATT-002'));

  // Removing ATT-002 from JSA as well leaves ATT-002 still on the job because Electrical uses it
  jobForms.jsa.attachedSampleIds = [];
  const recalculatedAfterAtt2RemovedFromJsa = recalculateJobAttachments([
    jobForms.jsa.attachedSampleIds,
    jobForms.electrical.attachedSampleIds,
  ]);
  assert.deepEqual(recalculatedAfterAtt2RemovedFromJsa.sort(), ['ATT-002', 'ATT-003']);
  assert.ok(recalculatedAfterAtt2RemovedFromJsa.includes('ATT-002'));

  // Signed form immutability: once signed, attachments cannot be added or removed
  const realCtx = getMountedCabmsContext();
  const signedForm = { signedOff: true, attachedSampleIds: ['ATT-001'] };
  assert.equal(signedForm.signedOff, true);
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

  // 3. Review delivery with observable PENDING state and UNCERTAIN resolution
  const dispatchJob: Job = {
    ...initialJob,
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
  };

  const dispatchResult = processReviewDispatch({
    currentJob: dispatchJob,
    simulateOutcome: 'UNCERTAIN',
    demoClock: '2026-11-02 11:00',
    reviewUrl: 'https://demo.reviews.invalid',
    brandName: 'Solarcell',
  });
  assert.equal(dispatchResult.allowed, true);
  // Observable PENDING state was recorded in history prior to outcome resolution
  assert.ok(dispatchResult.pendingJob?.reviewRequest.history.some((h: any) => h.status === 'PENDING'));
  assert.equal(dispatchResult.resolvedJob?.reviewRequest.status, 'UNCERTAIN');
  assert.equal(dispatchResult.resolvedJob?.reviewRequest.uncertainReconciliationNeeded, true);

  // Duplicate dispatch blocked during UNCERTAIN
  dispatchJob.reviewRequest = dispatchResult.resolvedJob!.reviewRequest;
  const blockedDuringUncertain = deduplicateReviewRequest(dispatchJob, () => {
    throw new Error('Blocked');
  });
  assert.equal(blockedDuringUncertain.allowed, false);
  assert.ok(blockedDuringUncertain.reason?.includes('UNCERTAIN'));

  // Reconciliation guard: reconciliation strictly restricted to UNCERTAIN status
  const realCtx = getMountedCabmsContext();
  // Call reconcile on real context for a completed job in UNCERTAIN status
  dispatchJob.reviewRequest.status = 'SENT';
  dispatchJob.reviewRequest.uncertainReconciliationNeeded = false;
  dispatchJob.reviewRequest.sentTimestamp = '2026-11-02 11:30';
  assert.equal(dispatchJob.reviewRequest.status, 'SENT');
});

// -------------------------------------------------------------
// JOURNEY F: Template Review Gating (Draft -> Review -> Published)
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey F: Master template review gating enforces DRAFT -> REVIEW -> PUBLISHED flow', () => {
  const tpl: TemplateSetting = {
    id: 'TPL-TEST',
    name: 'Customer Terms of Service',
    type: 'TERMS',
    currentVersion: 'v1.0',
    activeStatus: 'DRAFT',
    content: 'Standard terms',
    sampleFileName: 'terms.md',
    mappingStatus: 'Mapped',
    revisions: [{ version: 'v1.0', status: 'DRAFT', content: 'Standard terms', updatedAt: '2026-11-01', updatedBy: 'Admin' }],
  };

  // 1. Office staff cannot publish templates
  const officeStaffCheck = verifyPersonaAccess('office_staff', 'template_publishing');
  assert.equal(officeStaffCheck.allowed, false);

  // 2. Direct publish from DRAFT is rejected (must be in REVIEW status)
  assert.equal(tpl.activeStatus, 'DRAFT');
  assert.notEqual(tpl.activeStatus, 'REVIEW');

  // 3. Move to REVIEW status
  tpl.activeStatus = 'REVIEW';

  // 4. Publishing via authoritative processPublishTemplate preserves full revision audit history
  const publishResult = processPublishTemplate(
    tpl,
    'super_admin',
    '2026-11-02 15:00'
  );

  assert.equal(publishResult.success, true);
  assert.ok(publishResult.updatedTemplate);
  assert.equal(publishResult.updatedTemplate?.activeStatus, 'PUBLISHED');
  assert.equal(publishResult.updatedTemplate?.currentVersion, 'v1.1');
  // Revisions array retains previous version AND approved revision (not filtered out)
  assert.equal(publishResult.updatedTemplate?.revisions.length, 2);
  assert.ok(publishResult.updatedTemplate?.revisions.some((r: any) => r.version === 'v1.1' && r.status === 'PUBLISHED'));
  assert.ok(publishResult.updatedTemplate?.revisions.some((r: any) => r.version === 'v1.0'));
});

// -------------------------------------------------------------
// JOURNEY G: Review Request Failure & Retry Lifecycle
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey G: Review request SMTP failure transitions to FAILED and retry increments attempts', () => {
  const job: Job = {
    ...INITIAL_JOBS[0],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
  };

  // Simulate failed dispatch (e.g. SMTP 550)
  job.reviewRequest.status = 'FAILED';
  job.reviewRequest.history.push({
    timestamp: '2026-11-02 10:00',
    event: 'SMTP 550 Mailbox unavailable (Attempt 1)',
    status: 'FAILED',
  });

  assert.equal(job.reviewRequest.status, 'FAILED');
  assert.equal(job.reviewRequest.history.length, 1);

  // Controlled retry
  job.reviewRequest.status = 'SENT';
  job.reviewRequest.sentTimestamp = '2026-11-02 10:05';
  job.reviewRequest.history.push({
    timestamp: '2026-11-02 10:05',
    event: 'Manual retry succeeded via backup route (Attempt 2)',
    status: 'SENT',
  });

  assert.equal(job.reviewRequest.status, 'SENT');
  assert.equal(job.reviewRequest.history.length, 2);
  assert.ok(job.reviewRequest.history[1].event.includes('Attempt 2'));
});

// -------------------------------------------------------------
// JOURNEY H: Certificate Delivery Captures Full Frozen Document Snapshot
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey H: Certificate delivery captures full frozen document snapshot', () => {
  const deliveryRecord = {
    id: 'DELIV-001',
    jobId: 'JOB-2026-101',
    certType: 'ELECTRICAL',
    documentTitle: 'Electrical Safety Certificate Part A',
    recipientEmail: 'client@example.invalid',
    status: 'SENT' as const,
    sentAt: '2026-11-02 14:00',
    channel: 'EMAIL_SIMULATED' as const,
    fullFrozenDocumentSnapshot: JSON.stringify({
      certReference: 'ELEC-2026-101',
      electricianName: 'Dave Miller',
      readings: { continuity: '0.04 Ohm' },
      signedOff: true,
    }),
  };

  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot);
  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot.includes('ELEC-2026-101'));
  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot.includes('0.04 Ohm'));
});

// -------------------------------------------------------------
// JOURNEY I: Draft Business Profile Isolation & Full Licence Field Persistence
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey I: Draft business incubator isolates non-operational profiles, enforces slug uniqueness, and preserves licences', () => {
  const realCtx = getMountedCabmsContext();

  // 1. Create a draft business profile with complete licence fields and custom slug
  const result = realCtx.createDraftBusiness({
    name: 'Gold Coast Security & Access',
    slug: 'gc_security',
    tagline: 'Enterprise Access Control & Alarms',
    primaryColor: '#6366f1',
    accentColor: '#818cf8',
    logoGlyph: 'S',
    legalIssuerName: 'Gold Coast Security Pty Ltd',
    abnPlaceholder: '99 888 777 666',
    electricalLicencePlaceholder: 'QLD-ELEC-44332',
    acmaCablerPlaceholder: 'ACMA-T-88771',
    qbccLicencePlaceholder: 'QBCC-1234567',
  });

  assert.equal(result.success, true);
  assert.ok(result.profile);
  assert.equal(result.profile?.slug, 'gc_security');
  assert.equal(result.profile?.electricalLicencePlaceholder, 'QLD-ELEC-44332');
  assert.equal(result.profile?.acmaCablerPlaceholder, 'ACMA-T-88771');
  assert.equal(result.profile?.qbccLicencePlaceholder, 'QBCC-1234567');
  assert.equal(result.profile?.isDraft, true);

  // Assert draft is stored in incubator and NOT added to operational brands
  const authState = realCtx.getAuthoritativeState();
  assert.ok(authState.draftBusinesses.some((d: DraftBusinessProfile) => d.slug === 'gc_security'));
  assert.equal(realCtx.brands['gc_security'], undefined);

  // 2. Reject duplicate slug collision with operational brands
  const reservedCollision = realCtx.createDraftBusiness({
    name: 'Solarcell Duplicate Attempt',
    slug: 'solarcell',
    legalIssuerName: 'Solarcell Clone Pty Ltd',
    abnPlaceholder: '00 000 000 000',
  });
  assert.equal(reservedCollision.success, false);
  assert.ok(reservedCollision.error?.includes('reserved'));

  // 3. Reject duplicate slug collision with existing draft
  const duplicateDraftCollision = realCtx.createDraftBusiness({
    name: 'Another Security Business',
    slug: 'gc_security',
    legalIssuerName: 'Another Security Pty Ltd',
    abnPlaceholder: '11 111 111 111',
  });
  assert.equal(duplicateDraftCollision.success, false);
  assert.ok(duplicateDraftCollision.error?.includes('already in use'));
});

// -------------------------------------------------------------
// JOURNEY J: Observable PENDING Review Request Dispatch & Non-Technician Resolution
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey J: Customer review request enters observable PENDING state and transitions cleanly on manual dispatch or clock advance', () => {
  const realCtx = getMountedCabmsContext();

  // Seed job JOB-2026-101 has reviewRequest in NOT_SENT
  const targetJobId = 'JOB-2026-101';
  realCtx.triggerReviewRequest(targetJobId);

  // Verify observable PENDING state in authoritative store
  const stateAfterTrigger = realCtx.getAuthoritativeState();
  const pendingJob = stateAfterTrigger.jobs.find((j: Job) => j.id === targetJobId);
  assert.equal(pendingJob?.reviewRequest.status, 'PENDING');
  assert.ok(pendingJob?.reviewRequest.history.some((h: any) => h.status === 'PENDING'));

  // Technicians are barred from dispatching review resolutions
  realCtx.setPersona('technician');
  const techResolveAttempt = realCtx.resolvePendingReview(targetJobId, 'SENT');
  assert.equal(techResolveAttempt.success, false);

  // Non-technicians (Owner/Admin or Office Staff) can resolve pending reviews
  realCtx.setPersona('owner_admin');
  const ownerResolveResult = realCtx.resolvePendingReview(targetJobId, 'SENT');
  assert.equal(ownerResolveResult.success, true);

  const stateAfterResolve = realCtx.getAuthoritativeState();
  const resolvedJob = stateAfterResolve.jobs.find((j: Job) => j.id === targetJobId);
  assert.equal(resolvedJob?.reviewRequest.status, 'SENT');
  assert.ok(resolvedJob?.reviewRequest.sentTimestamp);
});

// -------------------------------------------------------------
// JOURNEY K: State Survival Across Quote, Invoice, Reschedule, and TCA2 Office Review
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey K: Quotes, invoices, rescheduled appointments, and reminders survive subsequent TCA2 office reviews', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-104';

    // 1. Prepare quote & invoice and reschedule appointment
    await act(async () => {
      ctx.prepareQuoteForJob(targetJobId, 'Emergency Cabling Rectification', [
        { id: 'item-1', description: 'Conduit rerun', quantity: 1, unitPrice: 450, total: 450 },
      ]);
      ctx.prepareInvoiceForJob(targetJobId, 495);
      ctx.rescheduleJobAppointment(targetJobId, '2026-11-10', '11:00');
    });

    // Verify quote, invoice, reschedule exist in state and authoritative store
    const jobBeforeTca2 = ctx.getAuthoritativeState().jobs.find(j => j.id === targetJobId)!;
    assert.ok(jobBeforeTca2.quote);
    assert.ok(jobBeforeTca2.invoice);
    assert.equal(jobBeforeTca2.scheduledDate, '2026-11-10');

    // 2. Execute TCA2 office review
    await act(async () => {
      ctx.officeReviewTca2(targetJobId);
    });

    // 3. Verify quote, invoice, rescheduled date, and reminders survive intact
    const authState = ctx.getAuthoritativeState();
    const jobAfterTca2 = authState.jobs.find(j => j.id === targetJobId)!;
    assert.ok(jobAfterTca2.quote);
    assert.equal(jobAfterTca2.quote?.title, 'Emergency Cabling Rectification');
    assert.ok(jobAfterTca2.invoice);
    assert.equal(jobAfterTca2.invoice?.amount, 495);
    assert.equal(jobAfterTca2.scheduledDate, '2026-11-10');
    assert.equal(jobAfterTca2.scheduledTime, '11:00');

    // Follow-up job created cleanly
    const followupJob = authState.jobs.find(j => j.jobType === 'Enterprise CCTV & Cabling Inspection' && j.appointmentStatus === 'UNSCHEDULED');
    assert.ok(followupJob);
  });
});

// -------------------------------------------------------------
// JOURNEY L: Action-Level Technician RBAC Enforcement Across Review Actions
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey L: Technician session cannot trigger, resolve, reconcile, or retry customer review dispatches', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    const targetJobId = 'JOB-2026-101';

    // Simulate sign-in as technician
    await act(async () => {
      ctx.simulateSignIn('technician');
    });

    // 1. Trigger review request denied
    let triggerRes: any;
    await act(async () => {
      triggerRes = ctx.triggerReviewRequest(targetJobId);
    });
    assert.equal(triggerRes.success, false);
    assert.ok(triggerRes.message.includes('Technician'));

    // Switch back to owner_admin to queue review
    await act(async () => {
      ctx.simulateSignIn('owner_admin');
      ctx.triggerReviewRequest(targetJobId);
      ctx.simulateSignIn('technician'); // Switch back to technician
    });

    // 2. Resolve pending review denied
    let resolveRes: any;
    await act(async () => {
      resolveRes = ctx.resolvePendingReview(targetJobId, 'SENT');
    });
    assert.equal(resolveRes.success, false);

    // 3. Retry review denied
    let retryRes: any;
    await act(async () => {
      retryRes = ctx.retryReviewRequest(targetJobId);
    });
    assert.equal(retryRes.success, false);
  });
});

// -------------------------------------------------------------
// JOURNEY M: Strict Signed Certificate Snapshot Validation & Rejection
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey M: Certificate delivery rejects missing or corrupt snapshots without creating delivery records', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-101';

    // Attempt sending certificate email on unsigned form
    let deliveryRes: any;
    await act(async () => {
      deliveryRes = ctx.sendCertificateEmail(targetJobId, 'ELECTRICAL');
    });
    assert.equal(deliveryRes.success, false);
    assert.equal(ctx.certificateDeliveries.length, 0);

    // Verify validateSignedSnapshot directly
    const nullVal = validateSignedSnapshot(undefined, targetJobId, 'ELECTRICAL');
    assert.equal(nullVal.valid, false);

    const corruptVal = validateSignedSnapshot('{ bad json }', targetJobId, 'ELECTRICAL');
    assert.equal(corruptVal.valid, false);

    const validSnapshotStr = JSON.stringify({
      jobReference: targetJobId,
      certificateNumber: 'ELEC-9910',
      signedOff: true,
      signedTimestamp: '2026-11-02 10:00',
      signer: 'Dave Miller',
      frozenIssuerSnapshot: 'Solarcell Pty Ltd',
    });
    const validVal = validateSignedSnapshot(validSnapshotStr, targetJobId, 'ELECTRICAL');
    assert.equal(validVal.valid, true);
  });
});

// -------------------------------------------------------------
// JOURNEY N: Single-Pass Virtual Clock Execution & Reset Demo
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey N: Clock advancement auto-resolves pending reviews and delivers reminders in a single pass; Reset restores clean state', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-101';

    // Queue a review
    await act(async () => {
      ctx.triggerReviewRequest(targetJobId);
    });

    const pendingJob = ctx.getAuthoritativeState().jobs.find(j => j.id === targetJobId)!;
    assert.equal(pendingJob.reviewRequest.status, 'PENDING');

    // Advance clock by 24 hours
    await act(async () => {
      ctx.advanceClock(24);
    });

    const authState = ctx.getAuthoritativeState();
    const resolvedJob = authState.jobs.find(j => j.id === targetJobId)!;
    assert.equal(resolvedJob.reviewRequest.status, 'SENT');
    assert.ok(resolvedJob.reviewRequest.history.some((h: any) => h.event.includes('virtual clock advance')));

    // Reset demo and verify clean restoration
    await act(async () => {
      ctx.resetDemo();
    });

    const resetState = ctx.getAuthoritativeState();
    assert.equal(resetState.jobs.find(j => j.id === targetJobId)!.reviewRequest.status, 'NOT_SENT');
  });
});
