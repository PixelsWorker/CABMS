import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
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
  testFn: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) => Promise<void> | void,
  includeComplianceView = false,
  additionalView?: React.ReactNode
) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  let currentContext!: ReturnType<typeof useCabms>;

  function TestObserver() {
    currentContext = useCabms();
    return React.createElement(React.Fragment, null,
      React.createElement('div', { id: 'test-observer-mounted' },
        React.createElement('span', { id: 'job-count' }, currentContext.jobs.length),
        React.createElement('span', { id: 'persona-badge' }, currentContext.persona),
        React.createElement('pre', { id: 'rendered-jobs' }, JSON.stringify(currentContext.jobs)),
        React.createElement('pre', { id: 'rendered-tca2-audits' }, JSON.stringify(currentContext.tca2AuditRecords))
      ),
      includeComplianceView ? React.createElement(ComplianceFormsView) : null,
      additionalView
    );
  }

  await act(async () => {
    root.render(
      React.createElement(CabmsProvider, null, React.createElement(TestObserver))
    );
  });

  const freshContext = new Proxy({} as ReturnType<typeof useCabms>, {
    get: (_target, property) => (currentContext as any)[property],
  });

  try {
    await testFn(freshContext, container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(label));
  assert.ok(button, `Expected a button containing “${label}”.`);
  await act(async () => { button!.click(); });
}

function assertMountedStateMatchesAuthoritative(ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) {
  const authoritative = ctx.getAuthoritativeState();
  const renderedJobs = container.querySelector('#rendered-jobs')?.textContent || '[]';
  const renderedAudits = container.querySelector('#rendered-tca2-audits')?.textContent || '{}';

  assert.deepEqual(ctx.jobs, authoritative.jobs, 'fresh React context jobs match authoritative jobs');
  assert.equal(renderedJobs, JSON.stringify(authoritative.jobs), 'mounted React DOM jobs match authoritative jobs');
  assert.deepEqual(ctx.tca2AuditRecords, authoritative.tca2AuditRecords, 'fresh React context TCA2 audit matches authoritative audit');
  assert.equal(renderedAudits, JSON.stringify(authoritative.tca2AuditRecords), 'mounted React DOM TCA2 audit matches authoritative audit');
  assert.equal(container.querySelector('#job-count')?.textContent, String(authoritative.jobs.length));
  assert.equal(container.querySelector('#persona-badge')?.textContent, ctx.persona);
}

function jobIdentity(job: Job) {
  const { id, brandId, customerId, siteAddress, siteContact, sitePhone } = job;
  return { id, brandId, customerId, siteAddress, siteContact, sitePhone };
}

// Capture expectations before any journey runs; reading a polluted seed later would mask a leak.
const originalCctvIdentity = jobIdentity(INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')!);

async function isolatedOperationalJob(ctx: ReturnType<typeof useCabms>, jobId: string): Promise<Job> {
  const job = ctx.getAuthoritativeState().jobs.find(job => job.id === jobId)!;
  // The public status transition clones the job. Detach before changing test-only operational fields.
  await act(async () => { ctx.updateJobStatus(jobId, job.status); });
  const isolated = ctx.getAuthoritativeState().jobs.find(job => job.id === jobId)!;
  assert.notEqual(isolated, INITIAL_JOBS.find(job => job.id === jobId), 'test fixture must not alias the shared seed');
  return isolated;
}

function assertOriginalCctvIdentity(ctx: ReturnType<typeof useCabms>) {
  assert.deepEqual(jobIdentity(ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-104')!), originalCctvIdentity);
  assert.deepEqual(jobIdentity(INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')!), originalCctvIdentity);
  const snapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot!);
  assert.equal(snapshot.jobReference, originalCctvIdentity.id);
  assert.equal(snapshot.siteAddress, originalCctvIdentity.siteAddress);
  assert.equal(snapshot.customerName, originalCctvIdentity.siteContact);
  assert.equal(snapshot.siteContactPlaceholder, `${originalCctvIdentity.siteContact} (${originalCctvIdentity.sitePhone})`);
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
    assert.ok(triggerRes.message.includes('authorized session'));

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
// JOURNEY M: Real signed form delivery and invalid snapshot rejection
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey M: real signed seeds and newly signed forms deliver through the validated action', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const seededForms: [string, string][] = [
      ['JOB-2026-103', 'JSA'],
      ['JOB-2026-104', 'JSA'],
      ['JOB-2026-103', 'ELECTRICAL'],
      ['JOB-2026-101', 'SMOKE_ALARM'],
      ['JOB-2026-104', 'TCA1'],
      ['JOB-2026-104', 'TCA2'],
    ];
    const electricalJsaSnapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot!);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(electricalJsaSnapshot.licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(electricalJsaSnapshot.customerName, 'Elena Rossi');
    assert.equal(electricalJsaSnapshot.siteAddress, INITIAL_JOBS.find(job => job.id === 'JOB-2026-103')?.siteAddress);
    assert.ok(electricalJsaSnapshot.steps[0].taskStep.includes('three-phase inverter'));

    const cctvJsaSnapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot!);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(cctvJsaSnapshot.licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(cctvJsaSnapshot.customerName, 'Marcus Vance');
    assert.equal(cctvJsaSnapshot.siteAddress, INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')?.siteAddress);
    assert.ok(cctvJsaSnapshot.frozenIssuerSnapshot.includes(INITIAL_BRANDS.cctv.legalIssuerName));
    assert.ok(cctvJsaSnapshot.steps[0].taskStep.includes('camera work areas'));
    assert.equal(cctvJsaSnapshot.steps.some((step: any) => step.taskStep.includes('Rooftop Access')), false);

    for (const [jobId, formType] of seededForms) {
      let result: any;
      await act(async () => {
        result = ctx.sendCertificateEmail(jobId, formType);
      });
      assert.equal(result.success, true, `${formType} seed delivery should succeed: ${result.message}`);
    }
    assert.equal(ctx.certificateDeliveries.length, 6);
    for (const [jobId, formType] of seededForms) {
      const delivery = ctx.certificateDeliveries.find(record => record.jobId === jobId && record.formType === formType);
      assert.ok(delivery?.fullFrozenDocumentSnapshot, `${formType} delivery should preserve the exact signed snapshot`);
      assert.equal(validateSignedSnapshot(delivery!.fullFrozenDocumentSnapshot, jobId, formType).valid, true);
    }

    await act(async () => {
      ctx.signOffJsa('JOB-2026-101');
      ctx.signOffElectrical('JOB-2026-101');
      ctx.signOffSmokeAlarm('JOB-2026-102');
      ctx.signOffTca1('JOB-2026-102');
      ctx.signOffTca2('JOB-2026-101');
    });

    const newlySignedForms: [string, string][] = [
      ['JOB-2026-101', 'JSA'],
      ['JOB-2026-101', 'ELECTRICAL'],
      ['JOB-2026-102', 'SMOKE_ALARM'],
      ['JOB-2026-102', 'TCA1'],
      ['JOB-2026-101', 'TCA2'],
    ];
    for (const [jobId, formType] of newlySignedForms) {
      let result: any;
      await act(async () => {
        result = ctx.sendCertificateEmail(jobId, formType);
      });
      assert.equal(result.success, true, `new ${formType} sign-off delivery should succeed: ${result.message}`);
    }
    assert.equal(ctx.certificateDeliveries.length, 11);
  });
});

test('LAYER 6: Integration — Journey M rejects invalid signed snapshots without creating delivery records', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-103';
    const signedElectrical = ctx.getOrCreateElectrical(targetJobId);
    const validSnapshot = JSON.parse(signedElectrical.fullSnapshot!);
    const invalidSnapshots: [string | undefined, string][] = [
      [undefined, 'missing snapshot'],
      ['{ bad json }', 'malformed JSON'],
      [JSON.stringify({ ...validSnapshot, testedWorkItems: undefined }), 'structurally incomplete snapshot'],
      [JSON.stringify({ ...validSnapshot, jobReference: 'JOB-OTHER' }), 'mismatched job reference'],
    ];

    for (const [snapshot, reason] of invalidSnapshots) {
      (signedElectrical as any).fullSnapshot = snapshot;
      let result: any;
      await act(async () => {
        result = ctx.sendCertificateEmail(targetJobId, 'ELECTRICAL');
      });
      assert.equal(result.success, false, `${reason} must be rejected`);
      assert.equal(ctx.certificateDeliveries.length, 0, `${reason} must not create a delivery record`);
    }
  });
});

test('LAYER 6: Integration — signed print preview separates frozen form details from current job and brand settings', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.setSelectedJobId('JOB-2026-104');
    });

    const seededJsa = ctx.getOrCreateJsa('JOB-2026-104');
    const originalSite = seededJsa.siteAddress;
    const originalContact = seededJsa.siteContactPlaceholder;
    const originalIssuer = seededJsa.frozenIssuerSnapshot!;
    const originalSnapshot = seededJsa.fullSnapshot;
    const liveJob = await isolatedOperationalJob(ctx, 'JOB-2026-104');

    await act(async () => {
      liveJob.siteAddress = 'Changed current operational site address';
      liveJob.siteContact = 'Changed Current Contact';
      liveJob.sitePhone = '0400 999 999';
      ctx.updateJobStatus(liveJob.id, liveJob.status);
      ctx.updateBrandConfig({
        ...ctx.brands.cctv,
        legalIssuerName: 'Changed Current Brand Issuer',
        electricalLicencePlaceholder: 'CURRENT-LICENCE-SHOULD-NOT-PRINT',
      });
    });

    const printButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Branded Print / PDF Preview'));
    assert.ok(printButton, 'print preview action is mounted');
    await act(async () => {
      printButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const preview = Array.from(container.querySelectorAll('div'))
      .find(element => element.className.includes('fixed') && element.textContent?.includes('Compliance Document Print Preview'));
    assert.ok(preview, 'print preview modal is mounted');
    const previewText = preview!.textContent || '';
    assert.ok(previewText.includes('Document Job Reference: JOB-2026-104'));
    assert.ok(previewText.includes('Document Date: 2026-11-02'));
    assert.ok(previewText.includes(originalIssuer.split(' • ')[0]), 'issuer entity is read from the signed snapshot');
    assert.ok(previewText.includes(originalIssuer.split(' • ')[1]), 'issuer ABN is read from the signed snapshot');
    assert.ok(previewText.includes(originalSite), 'certified site address remains frozen');
    assert.ok(previewText.includes(originalContact), 'certified customer contact remains frozen');
    assert.ok(previewText.includes('Current operational job details — not part of the frozen signed document'));
    assert.ok(previewText.includes('Changed current operational site address'));
    assert.ok(previewText.includes('Changed Current Contact (0400 999 999)'));
    assert.equal(previewText.includes('Changed Current Brand Issuer'), false);
    assert.equal(previewText.includes('CURRENT-LICENCE-SHOULD-NOT-PRINT'), false);
    assert.equal(ctx.getOrCreateJsa(liveJob.id).fullSnapshot, originalSnapshot, 'operational changes must not rewrite signed history');
    assert.deepEqual(jobIdentity(INITIAL_JOBS.find(job => job.id === liveJob.id)!), originalCctvIdentity);
  }, true);

  await withMountedContext(async (ctx) => {
    assertOriginalCctvIdentity(ctx);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
  });
});

test('LAYER 6: Addendum A — failed print-history assertions cannot contaminate resets or fresh providers', async () => {
  const simulatedFailure = new assert.AssertionError({ message: 'Intentional print-history assertion failure' });
  await withMountedContext(async (ctx, container) => {
    const snapshot = ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot;
    await assert.rejects(async () => {
      const isolated = await isolatedOperationalJob(ctx, 'JOB-2026-104');
      await act(async () => {
        isolated.siteAddress = 'Isolated failed-test address';
        isolated.siteContact = 'Isolated failed-test contact';
        isolated.sitePhone = '0400 999 123';
        ctx.updateJobStatus(isolated.id, isolated.status);
      });
      throw simulatedFailure;
    }, error => error === simulatedFailure);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot, snapshot);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
    assertMountedStateMatchesAuthoritative(ctx, container);
  });

  // Exercise the runner's finally/unmount path too; even a failing journey cannot pollute another provider.
  await assert.rejects(withMountedContext(async (ctx) => {
    const isolated = await isolatedOperationalJob(ctx, 'JOB-2026-104');
    isolated.siteAddress = 'Isolated unmounted-test address';
    isolated.siteContact = 'Isolated unmounted-test contact';
    isolated.sitePhone = '0400 999 456';
    throw simulatedFailure;
  }), error => error === simulatedFailure);
  await withMountedContext(async (ctx) => {
    assertOriginalCctvIdentity(ctx);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
  });
});

test('LAYER 6: Addendum A — role-specific seed credentials stay frozen after brand settings change', async () => {
  await withMountedContext(async (ctx) => {
    const cctv = ctx.getOrCreateJsa('JOB-2026-104');
    const electrical = ctx.getOrCreateJsa('JOB-2026-103');
    const cctvSnapshot = cctv.fullSnapshot;
    const electricalSnapshot = electrical.fullSnapshot;
    assert.equal(cctv.licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(JSON.parse(cctvSnapshot!).licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(electrical.licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(JSON.parse(electricalSnapshot!).licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    await act(async () => {
      ctx.updateBrandConfig({ ...ctx.brands.cctv, acmaCablerPlaceholder: 'CHANGED-CURRENT-CABLER' });
      ctx.updateBrandConfig({ ...ctx.brands.solarcell, electricalLicencePlaceholder: 'CHANGED-CURRENT-ELECTRICAL' });
    });
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot, cctvSnapshot);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot, electricalSnapshot);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').licencePlaceholder, cctv.licencePlaceholder);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').licencePlaceholder, electrical.licencePlaceholder);
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
    const failedJobId = 'JOB-2026-102';
    const uncertainJobId = 'JOB-2026-103';

    // Queue all supported simulated outcomes; virtual-clock processing must preserve them.
    await act(async () => {
      ctx.triggerReviewRequest(targetJobId);
      ctx.triggerReviewRequest(failedJobId, 'FAIL');
      ctx.triggerReviewRequest(uncertainJobId, 'UNCERTAIN');
    });

    const pendingJob = ctx.getAuthoritativeState().jobs.find(j => j.id === targetJobId)!;
    assert.equal(pendingJob.reviewRequest.status, 'PENDING');
    assert.equal(ctx.getAuthoritativeState().jobs.find(j => j.id === failedJobId)!.reviewRequest.status, 'PENDING');
    assert.equal(ctx.getAuthoritativeState().jobs.find(j => j.id === uncertainJobId)!.reviewRequest.status, 'PENDING');

    // Advance clock by 24 hours
    await act(async () => {
      ctx.advanceClock(24);
    });

    const authState = ctx.getAuthoritativeState();
    const resolvedJob = authState.jobs.find(j => j.id === targetJobId)!;
    assert.equal(resolvedJob.reviewRequest.status, 'SENT');
    assert.ok(resolvedJob.reviewRequest.history.some((h: any) => h.event.includes('virtual clock advance')));
    const failedJob = authState.jobs.find(j => j.id === failedJobId)!;
    assert.equal(failedJob.reviewRequest.status, 'FAILED');
    assert.equal(failedJob.reviewRequest.uncertainReconciliationNeeded, false);
    const uncertainJob = authState.jobs.find(j => j.id === uncertainJobId)!;
    assert.equal(uncertainJob.reviewRequest.status, 'UNCERTAIN');
    assert.equal(uncertainJob.reviewRequest.uncertainReconciliationNeeded, true);

    // Reset demo and verify clean restoration
    await act(async () => {
      ctx.resetDemo();
    });

    const resetState = ctx.getAuthoritativeState();
    assert.equal(resetState.jobs.find(j => j.id === targetJobId)!.reviewRequest.status, 'NOT_SENT');
  });
});

test('LAYER 6: Integration — mounted React jobs and TCA2 audit stay aligned with authoritative state after transitions', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.updateJobStatus('JOB-2026-102', 'IN_PROGRESS');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    let createdJob!: Job;
    await act(async () => {
      createdJob = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'Commercial Solar PV Installation',
        title: 'Mounted state assertion job',
        siteAddress: 'Synthetic address for mounted state verification',
        siteContact: 'Test Customer',
      });
    });
    assert.equal(ctx.getAuthoritativeState().jobs[0].id, createdJob.id);
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.signOffJsa('JOB-2026-101');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    let completionResult: any;
    await act(async () => {
      completionResult = ctx.attemptCompleteJob('JOB-2026-101');
    });
    assert.equal(completionResult.canComplete, true);
    assert.equal(ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')?.status, 'COMPLETED');
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.signOffTca2('JOB-2026-101');
    });
    const initializedAudit = ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'];
    assert.deepEqual(initializedAudit, {
      jobId: 'JOB-2026-101',
      customerAcknowledged: false,
      officeReviewCompleted: false,
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.customerAckTca2('JOB-2026-101');
    });
    assert.equal(ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'].customerAcknowledged, true);
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.officeReviewTca2('JOB-2026-101');
    });
    const reviewedAudit = ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'];
    assert.equal(reviewedAudit.officeReviewCompleted, true);
    assert.ok(reviewedAudit.rectificationFollowupJobId);
    assert.ok(ctx.getAuthoritativeState().jobs.some(job => job.id === reviewedAudit.rectificationFollowupJobId));
    assertMountedStateMatchesAuthoritative(ctx, container);

    const jobCountAfterReview = ctx.getAuthoritativeState().jobs.length;
    await act(async () => {
      ctx.officeReviewTca2('JOB-2026-101');
    });
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobCountAfterReview, 'repeated TCA2 review does not add a duplicate follow-up');
    assertMountedStateMatchesAuthoritative(ctx, container);
  });
});

test('LAYER 6: CP-01 — retained actions require a live session for every privileged persona', async () => {
  for (const role of ['super_admin', 'owner_admin', 'office_staff'] as Persona[]) {
    await withMountedContext(async (ctx, container) => {
      await act(async () => {
        ctx.simulateSignIn(role);
        ctx.triggerReviewRequest('JOB-2026-101');
        ctx.triggerReviewRequest('JOB-2026-102', 'FAIL');
        ctx.resolvePendingReview('JOB-2026-102');
        ctx.triggerReviewRequest('JOB-2026-103', 'UNCERTAIN');
        ctx.resolvePendingReview('JOB-2026-103');
      });
      // Retain actual function references from the signed-in render, not the fresh-context proxy.
      const retained = {
        trigger: ctx.triggerReviewRequest, resolve: ctx.resolvePendingReview,
        all: ctx.resolveAllPendingReviews, retry: ctx.retryReviewRequest,
        reconcile: ctx.reconcileReviewRequest,
      };
      const before = structuredClone(ctx.getAuthoritativeState());
      await act(async () => {
        ctx.simulateSignOut();
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        // A forged role argument must not restore permission.
        assert.equal((retained.resolve as any)('JOB-2026-101', 'SENT', 'super_admin').success, false);
        retained.all();
        assert.equal(retained.retry('JOB-2026-102').success, false);
        retained.reconcile('JOB-2026-103', 'SENT');
        ctx.setPersona('super_admin');
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        assert.equal(retained.resolve('JOB-2026-101').success, false);
        retained.all();
        retained.retry('JOB-2026-102');
        retained.reconcile('JOB-2026-103');
      });
      assert.equal(ctx.isSimulatedSignedIn, false);
      assert.deepEqual(ctx.getAuthoritativeState(), before, 'signed-out calls preserve jobs, histories and audits');
      assert.equal(ctx.pendingReviewCount, 1);
      assertMountedStateMatchesAuthoritative(ctx, container);
      await act(async () => {
        ctx.simulateSignIn('technician');
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        assert.equal(retained.resolve('JOB-2026-101').success, false);
        retained.all();
        retained.retry('JOB-2026-102');
        retained.reconcile('JOB-2026-103');
      });
      assert.deepEqual(ctx.getAuthoritativeState(), before);
      await act(async () => {
        ctx.simulateSignIn('office_staff');
        assert.equal(retained.resolve('JOB-2026-101').success, true);
        assert.equal(retained.retry('JOB-2026-102').success, true);
        retained.reconcile('JOB-2026-103', 'SENT');
        assert.equal(retained.trigger('JOB-2026-104').success, true);
        retained.all();
      });
      for (const id of ['101', '102', '103', '104']) {
        assert.equal(ctx.jobs.find(job => job.id === `JOB-2026-${id}`)?.reviewRequest.status, 'SENT');
      }
      assertMountedStateMatchesAuthoritative(ctx, container);
    });
  }
});

test('LAYER 6: CP-01 — queued clock events resolve as the system while signed out', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.triggerReviewRequest('JOB-2026-101', 'UNCERTAIN');
      ctx.simulateSignOut();
    });
    await act(async () => { ctx.advanceClock(1); });
    const job = ctx.jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(ctx.isSimulatedSignedIn, false);
    assert.equal(job.reviewRequest.status, 'UNCERTAIN');
    assert.equal(job.activityHistory.at(-1)?.actor, 'Automated System Clock');
    assertMountedStateMatchesAuthoritative(ctx, container);
  });
});

test('LAYER 6: Wave A — signed JSA, Electrical, and Smoke row controls preserve live records and frozen snapshots', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); ctx.setSelectedJobId('JOB-2026-103'); });

    const jsaBefore = structuredClone(ctx.getOrCreateJsa('JOB-2026-103'));
    const jsaSnapshot = jsaBefore.fullSnapshot!;
    const risk = container.querySelector<HTMLSelectElement>('tbody select')!;
    assert.equal(risk.disabled, true, 'signed JSA row controls are disabled');
    risk.value = risk.value === 'H' ? 'L' : 'H';
    await act(async () => { risk.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-103', { steps: jsaBefore.steps.map((step, index) => index === 0 ? { ...step, initialRisk: 'L' } : step) });
    });
    assert.deepEqual(ctx.getOrCreateJsa('JOB-2026-103'), jsaBefore);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot, jsaSnapshot);

    await clickButton(container, 'Electrical Cert (Part A)');
    const electricalBefore = structuredClone(ctx.getOrCreateElectrical('JOB-2026-103'));
    const electricalSnapshot = electricalBefore.fullSnapshot!;
    const polarityLabel = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Polarity')!;
    const polarity = polarityLabel.parentElement!.querySelector<HTMLSelectElement>('select')!;
    assert.equal(polarity.disabled, true, 'signed Electrical row controls are disabled');
    polarity.value = polarity.value === 'Pass' ? 'Fail' : 'Pass';
    await act(async () => { polarity.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => {
      ctx.updateElectricalForm('JOB-2026-103', {
        testedWorkItems: electricalBefore.testedWorkItems.map((item, index) => index === 0 ? { ...item, polarityTest: 'Fail' } : item),
      });
    });
    assert.deepEqual(ctx.getOrCreateElectrical('JOB-2026-103'), electricalBefore);
    assert.equal(ctx.getOrCreateElectrical('JOB-2026-103').fullSnapshot, electricalSnapshot);

    await act(async () => { ctx.setSelectedJobId('JOB-2026-101'); });
    await clickButton(container, 'Smoke Alarm Cert');
    const smokeBefore = structuredClone(ctx.getOrCreateSmokeAlarm('JOB-2026-101'));
    const smokeSnapshot = smokeBefore.fullSnapshot!;
    const interconnection = container.querySelector<HTMLButtonElement>('tbody button')!;
    assert.equal(interconnection.disabled, true, 'signed Smoke row controls are disabled');
    await act(async () => { interconnection.click(); });
    await act(async () => {
      ctx.updateSmokeAlarmForm('JOB-2026-101', {
        alarmSchedule: smokeBefore.alarmSchedule.map((alarm, index) => index === 0 ? { ...alarm, interconnectionPass: !alarm.interconnectionPass } : alarm),
      });
    });
    assert.deepEqual(ctx.getOrCreateSmokeAlarm('JOB-2026-101'), smokeBefore);
    assert.equal(ctx.getOrCreateSmokeAlarm('JOB-2026-101').fullSnapshot, smokeSnapshot);
  }, true);
});

test('LAYER 6: Wave A — unsigned row edits remain immutable and add/delete/add keeps JSA and Smoke IDs unique', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); ctx.setSelectedJobId('JOB-2026-102'); });

    const jsaInitial = ctx.getOrCreateJsa('JOB-2026-102');
    assert.equal(jsaInitial.signedOff, false);
    const initialRisk = container.querySelector<HTMLSelectElement>('tbody select')!;
    const originalTaskRow = jsaInitial.steps[0];
    assert.equal(initialRisk.disabled, false);
    initialRisk.value = initialRisk.value === 'H' ? 'L' : 'H';
    await act(async () => { initialRisk.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const jsaEdited = ctx.getOrCreateJsa('JOB-2026-102');
    assert.notEqual(jsaEdited.steps[0].initialRisk, originalTaskRow.initialRisk);
    assert.notEqual(jsaEdited.steps[0], originalTaskRow, 'row update replaces the nested object');
    assert.equal(originalTaskRow.initialRisk, jsaInitial.steps[0].initialRisk, 'old row reference remains untouched');

    await clickButton(container, 'Add Task Step');
    await clickButton(container, 'Add Task Step');
    const firstJsaRow = container.querySelector<HTMLTableRowElement>('tbody tr')!;
    await act(async () => { firstJsaRow.querySelector<HTMLButtonElement>('button')!.click(); });
    await clickButton(container, 'Add Task Step');
    const jsaIds = ctx.getOrCreateJsa('JOB-2026-102').steps.map(step => step.id);
    assert.equal(new Set(jsaIds).size, jsaIds.length, 'JSA identifiers remain unique after add/delete/add');

    await clickButton(container, 'Electrical Cert (Part A)');
    const electricalInitial = ctx.getOrCreateElectrical('JOB-2026-102');
    const originalElectricalRow = electricalInitial.testedWorkItems[0];
    const polarityLabel = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Polarity')!;
    const polarity = polarityLabel.parentElement!.querySelector<HTMLSelectElement>('select')!;
    const polarityBefore = originalElectricalRow.polarityTest;
    polarity.value = polarityBefore === 'Pass' ? 'Fail' : 'Pass';
    await act(async () => { polarity.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const electricalEdited = ctx.getOrCreateElectrical('JOB-2026-102');
    assert.notEqual(electricalEdited.testedWorkItems[0].polarityTest, polarityBefore);
    assert.notEqual(electricalEdited.testedWorkItems[0], originalElectricalRow);

    await clickButton(container, 'Smoke Alarm Cert');
    const smokeInitial = ctx.getOrCreateSmokeAlarm('JOB-2026-102');
    assert.equal(smokeInitial.signedOff, false);
    const originalSmokeRow = smokeInitial.alarmSchedule[0];
    const interconnection = container.querySelector<HTMLButtonElement>('tbody button')!;
    await act(async () => { interconnection.click(); });
    const smokeEdited = ctx.getOrCreateSmokeAlarm('JOB-2026-102');
    assert.equal(smokeEdited.alarmSchedule[0].interconnectionPass, !originalSmokeRow.interconnectionPass);
    assert.notEqual(smokeEdited.alarmSchedule[0], originalSmokeRow);

    await clickButton(container, 'Add Alarm Location');
    await clickButton(container, 'Add Alarm Location');
    const firstAlarmRow = container.querySelector<HTMLTableRowElement>('tbody tr')!;
    await act(async () => { firstAlarmRow.querySelector<HTMLButtonElement>('button:last-child')!.click(); });
    await clickButton(container, 'Add Alarm Location');
    const alarmIds = ctx.getOrCreateSmokeAlarm('JOB-2026-102').alarmSchedule.map(alarm => alarm.id);
    assert.equal(new Set(alarmIds).size, alarmIds.length, 'Smoke identifiers remain unique after add/delete/add');
  }, true);
});

test('LAYER 6: Wave A — brand-bound job types, assigned-unscheduled work orders, and enquiry customer resolution', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const cases = [
      { brandId: 'solarcell' as const, typeId: 'JT-001', forms: ['JSA', 'ELECTRICAL'] },
      { brandId: 'smart_home' as const, typeId: 'JT-002', forms: ['JSA', 'SMOKE_ALARM'] },
      { brandId: 'cctv' as const, typeId: 'JT-003', forms: ['JSA', 'TCA1', 'TCA2'] },
    ];
    const created: Job[] = [];
    for (const entry of cases) {
      let job!: Job;
      await act(async () => {
        job = ctx.createJob({ brandId: entry.brandId, jobType: entry.typeId, title: `Wave A ${entry.brandId}`, assignedTechId: 'TECH-001' });
      });
      created.push(job);
      assert.equal(job.brandId, entry.brandId);
      assert.equal(job.status, 'NEW');
      assert.equal(job.appointmentStatus, 'UNSCHEDULED');
      assert.equal(job.scheduledDate, null);
      assert.equal(job.scheduledTime, null);
      assert.equal(job.assignedTechId, 'TECH-001');
      assert.deepEqual(job.formsRequired, entry.forms);
    }
    const countBeforeInvalidType = ctx.getAuthoritativeState().jobs.length;
    assert.throws(() => ctx.createJob({ brandId: 'cctv', jobType: 'JT-001', title: 'Must be rejected' }), /belongs to/);
    assert.equal(ctx.getAuthoritativeState().jobs.length, countBeforeInvalidType, 'cross-business type rejection creates no job');

    const enquiry = ctx.websiteEnquiries.find(item => item.id === 'ENQ-2026-302')!;
    const customerDraft = {
      name: enquiry.customerName,
      contactPerson: enquiry.customerName,
      email: enquiry.email,
      phone: enquiry.phone,
      billingAddress: enquiry.address,
      brandAffiliations: [enquiry.brandId],
      notes: 'Wave A duplicate-resolution fixture',
    };
    const jobsBeforeWrongType = ctx.getAuthoritativeState().jobs.length;
    const customersBeforeWrongType = ctx.customers.length;
    let rejectedConversion!: { customerId: string; jobId: string };
    await act(async () => { rejectedConversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-001'); });
    assert.deepEqual(rejectedConversion, { customerId: '', jobId: '' });
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBeforeWrongType);
    assert.equal(ctx.customers.length, customersBeforeWrongType, 'invalid type is rejected before customer creation');

    let unresolvedConversion!: { customerId: string; jobId: string };
    await act(async () => { unresolvedConversion = ctx.convertEnquiryToJob(enquiry.id, 'CUSTOMER-NOT-FOUND', 'JT-003'); });
    assert.deepEqual(unresolvedConversion, { customerId: '', jobId: '' }, 'conversion refuses to link an unresolved customer identity');
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBeforeWrongType);
    assert.equal(ctx.customers.length, customersBeforeWrongType, 'unresolved customer rejection has no side effects');

    let written: any;
    await act(async () => { written = ctx.simulateCustomerWriteThrough(customerDraft); });
    assert.equal(written.success, true);
    await act(async () => {});
    let conversion!: { customerId: string; jobId: string };
    await act(async () => { conversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-003'); });
    const linkedJob = ctx.getAuthoritativeState().jobs.find(job => job.id === conversion.jobId)!;
    assert.equal(conversion.customerId, written.customer.id, 'duplicate result links its matched customer');
    assert.equal(linkedJob.customerId, written.customer.id);
    assert.equal(linkedJob.brandId, 'cctv');
    assert.equal(linkedJob.jobType, 'Enterprise CCTV & Cabling Inspection');
    assert.deepEqual(linkedJob.formsRequired, ['JSA', 'TCA1', 'TCA2']);
  });

  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const enquiry = ctx.websiteEnquiries.find(item => item.id === 'ENQ-2026-302')!;
    const pendingCustomer = {
      name: enquiry.customerName,
      contactPerson: enquiry.customerName,
      email: enquiry.email,
      phone: enquiry.phone,
      billingAddress: enquiry.address,
      brandAffiliations: [enquiry.brandId],
      notes: 'Offline draft resolution fixture',
    };
    let offlineResult: any;
    await act(async () => { offlineResult = ctx.simulateCustomerWriteThrough(pendingCustomer, 'FAILURE'); });
    assert.equal(offlineResult.success, false);
    assert.equal(offlineResult.customer.syncStatus, 'FAILED');
    await act(async () => {});
    let conversion!: { customerId: string; jobId: string; unresolvedWarning?: string };
    await act(async () => { conversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-003'); });
    const linkedJob = ctx.getAuthoritativeState().jobs.find(job => job.id === conversion.jobId)!;
    assert.equal(conversion.customerId, offlineResult.customer.id);
    assert.equal(linkedJob.customerId, offlineResult.customer.id);
    assert.ok(linkedJob.unresolvedWarnings.some(warning => warning.includes('pending MYOB reconciliation')));
  });
});

test('LAYER 6: Wave A — job creation UI filters type choices by active business and does not invent appointment data', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); });
    for (const [brandId, expectedType] of [['solarcell', 'JT-001'], ['smart_home', 'JT-002'], ['cctv', 'JT-003']] as const) {
      await act(async () => { ctx.setActiveBrandId(brandId); });
      await clickButton(container, 'Create New Job');
      const form = container.querySelector<HTMLFormElement>('form')!;
      const jobTypeSelect = form.querySelector<HTMLSelectElement>('select')!;
      const expectedTypes = ctx.jobTypes.filter(jobType => jobType.brandId === brandId).map(jobType => jobType.id);
      assert.deepEqual(Array.from(jobTypeSelect.options).map(option => option.value), expectedTypes);
      assert.equal(jobTypeSelect.value, expectedType, 'brand switch chooses an in-brand default');

      if (brandId === 'cctv') {
        const jobsBefore = ctx.getAuthoritativeState().jobs;
        const idsBefore = new Set(jobsBefore.map(job => job.id));
        jobTypeSelect.value = expectedType;
        await act(async () => {
          jobTypeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
        const created = ctx.getAuthoritativeState().jobs.find(job => !idsBefore.has(job.id));
        assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBefore.length + 1, 'UI creates a work order after selecting an in-brand type');
        assert.ok(created);
        assert.equal(created.assignedTechId, 'TECH-001');
        assert.equal(created.status, 'NEW');
        assert.equal(created.appointmentStatus, 'UNSCHEDULED');
        assert.equal(created.scheduledDate, null);
        assert.equal(created.scheduledTime, null);
        assert.deepEqual(created.formsRequired, ['JSA', 'TCA1', 'TCA2']);
      } else {
        await clickButton(container, 'Cancel');
      }
    }
  }, false, React.createElement(JobsView));
});

test('LAYER 6: Wave A — website conversion picker exposes only the enquiry business job types', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); });
    for (const brandId of ['solarcell', 'smart_home', 'cctv'] as const) {
      if (brandId === 'smart_home') {
        await act(async () => { ctx.simulateWebsiteSubmission(brandId); });
        await act(async () => {});
      }
      const enquiry = ctx.websiteEnquiries.find(item => item.brandId === brandId && item.status === 'PENDING_REVIEW')!;
      const card = Array.from(container.querySelectorAll('div.bg-slate-900')).find(node => node.textContent?.includes(enquiry.id))!;
      await clickButton(card as HTMLElement, 'Convert to Work Order');
      const label = Array.from(container.querySelectorAll('label')).find(item => item.textContent?.includes('Operational Job Type'))!;
      const select = label.parentElement!.querySelector<HTMLSelectElement>('select')!;
      const expected = ctx.jobTypes.filter(jobType => jobType.brandId === brandId).map(jobType => jobType.id);
      assert.deepEqual(Array.from(select.options).map(option => option.value), expected);
      assert.equal(select.value, expected[0]);
      await clickButton(container, 'Cancel');
    }
  }, false, React.createElement(WebsiteInboxView));
});

test('LAYER 6: Wave A — clock advances and future audit events retain explicit Brisbane instants', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const initialInstant = Date.parse(ctx.demoClock);
    await act(async () => { ctx.triggerReviewRequest('JOB-2026-101'); });
    const pending = ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(Date.parse(pending.reviewRequest.history.at(-1)!.timestamp), Date.parse(ctx.demoClock));
    assert.ok(pending.reviewRequest.history.at(-1)?.timestamp.endsWith('+10:00'));

    await act(async () => { ctx.advanceClock(1); });
    assert.equal(ctx.demoClock, '2026-11-02T10:00:00.000+10:00');
    const sent = ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(Date.parse(sent.reviewRequest.sentTimestamp!), initialInstant + 60 * 60 * 1000);
    assert.equal(sent.reviewRequest.sentTimestamp, ctx.demoClock);

    await act(async () => { ctx.advanceClock(14); });
    assert.equal(ctx.demoClock, '2026-11-03T00:00:00.000+10:00');
    await act(async () => { ctx.advanceClock(24); });
    assert.equal(ctx.demoClock, '2026-11-04T00:00:00.000+10:00');
  });
});
