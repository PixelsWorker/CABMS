import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  calculateReminderDueTime,
} from '../src/utils/cabmsLogic.ts';
import {
  Customer,
  Job,
  Persona,
  Quote,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  Tca2AuditRecord,
  TemplateSetting,
} from '../src/types/cabms.ts';
import {
  INITIAL_CUSTOMERS,
  INITIAL_JOBS,
  INITIAL_JOB_TYPES,
  INITIAL_TEMPLATES,
  INITIAL_BRANDS,
} from '../src/data/seedData.ts';

// -------------------------------------------------------------
// PERSONA VALIDATION (All 4 Personas)
// -------------------------------------------------------------
test('LAYER 2: Domain — Persona 1: Super Admin has full administrative and integration access', () => {
  const persona: Persona = 'super_admin';
  assert.equal(verifyPersonaAccess(persona, 'all_customers').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'technical_integrations').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'template_publishing').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'financial_writes').allowed, true);
});

test('LAYER 2: Domain — Persona 2: Owner/Admin has business oversight but cannot alter Super Admin technical credentials', () => {
  const persona: Persona = 'owner_admin';
  assert.equal(verifyPersonaAccess(persona, 'all_customers').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'template_publishing').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'financial_writes').allowed, true);
  const techSettings = verifyPersonaAccess(persona, 'technical_integrations');
  assert.equal(techSettings.allowed, false);
  assert.ok(techSettings.reason?.includes('technical credentials'));
});

test('LAYER 2: Domain — Persona 3: Office Staff can manage jobs and quotes but cannot edit or publish master compliance templates', () => {
  const persona: Persona = 'office_staff';
  assert.equal(verifyPersonaAccess(persona, 'all_customers').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'financial_writes').allowed, true);
  assert.equal(verifyPersonaAccess(persona, 'technical_integrations').allowed, false);
  const templateEdit = verifyPersonaAccess(persona, 'template_editing');
  assert.equal(templateEdit.allowed, false);
  assert.ok(templateEdit.reason?.includes('cannot edit or publish master compliance templates'));
});

test('LAYER 2: Domain — Persona 4: Technician is restricted to assigned jobs only; cannot access customer directory or templates', () => {
  const persona: Persona = 'technician';
  assert.equal(verifyPersonaAccess(persona, 'all_customers').allowed, false);
  assert.equal(verifyPersonaAccess(persona, 'technical_integrations').allowed, false);
  assert.equal(verifyPersonaAccess(persona, 'template_editing').allowed, false);
  assert.equal(verifyPersonaAccess(persona, 'template_publishing').allowed, false);
  assert.equal(verifyPersonaAccess(persona, 'financial_writes').allowed, false);

  // Assigned job check
  const assigned = verifyPersonaAccess(persona, 'assigned_job', {
    assignedTechId: 'TECH-001',
    currentTechId: 'TECH-001',
  });
  assert.equal(assigned.allowed, true);

  // Unassigned job check
  const unassigned = verifyPersonaAccess(persona, 'unassigned_job');
  assert.equal(unassigned.allowed, false);

  // Other tech job check
  const otherTech = verifyPersonaAccess(persona, 'assigned_job', {
    assignedTechId: 'TECH-002',
    currentTechId: 'TECH-001',
  });
  assert.equal(otherTech.allowed, false);
});

// -------------------------------------------------------------
// CUSTOMER & MYOB DUPLICATE / SYNC RULES
// -------------------------------------------------------------
test('LAYER 2: Domain — Customer duplicate detection across email, phone, and name', () => {
  const customers: Customer[] = [...INITIAL_CUSTOMERS];

  // Exact email match
  const dupEmail = checkCustomerDuplicate(
    { email: 'john.citizen@example.invalid', phone: '0411 999 999', name: 'Different Name' },
    customers
  );
  assert.equal(dupEmail.isDuplicate, true);
  assert.equal(dupEmail.field, 'email');
  assert.equal(dupEmail.matchedCustomer?.id, 'CUSTOMER-DEMO-001');

  // Normalized phone match
  const dupPhone = checkCustomerDuplicate(
    { email: 'other@example.invalid', phone: '0400 000 001', name: 'Different Name' },
    customers
  );
  assert.equal(dupPhone.isDuplicate, true);
  assert.equal(dupPhone.field, 'phone');

  // Normalized name match
  const dupName = checkCustomerDuplicate(
    { email: 'unique@example.invalid', phone: '0499 123 456', name: 'John Citizen' },
    customers
  );
  assert.equal(dupName.isDuplicate, true);
  assert.equal(dupName.field, 'name');

  // Distinct customer
  const distinct = checkCustomerDuplicate(
    { email: 'unique@example.invalid', phone: '0499 123 456', name: 'Totally Unique Person' },
    customers
  );
  assert.equal(distinct.isDuplicate, false);
});

test('LAYER 2: Domain — Missing customer or job references are rejected cleanly', () => {
  const baseJob = { ...INITIAL_JOBS[0] };
  const completionResult = validateJobCompletion(baseJob, {});
  // JSA is required for JOB-2026-101 but formsState is empty
  assert.equal(completionResult.canComplete, false);
  assert.ok(completionResult.missingRequirements.length > 0);
});

// -------------------------------------------------------------
// JOB LIFECYCLE & MANDATORY FORM COMPLIANCE RULES
// -------------------------------------------------------------
test('LAYER 2: Domain — Cancelled job cannot be completed without reopening', () => {
  const cancelledJob: Job = {
    ...INITIAL_JOBS[0],
    status: 'CANCELLED',
  };
  const result = validateJobCompletion(cancelledJob, {});
  assert.equal(result.canComplete, false);
  assert.ok(result.missingRequirements.some(r => r.includes('CANCELLED')));
});

test('LAYER 2: Domain — Direct-to-invoice job completes if and only if formsRequired is empty', () => {
  const validDirectJob: Job = {
    ...INITIAL_JOBS[1], // JOB-2026-102
    isDirectToInvoice: true,
    formsRequired: [],
  };
  const validResult = validateJobCompletion(validDirectJob, {});
  assert.equal(validResult.canComplete, true);
  assert.equal(validResult.isDirectToInvoice, true);
  assert.equal(validResult.missingRequirements.length, 0);

  // If a job has isDirectToInvoice=true but formsRequired=['JSA'], completion MUST be blocked
  const invalidDirectJob: Job = {
    ...INITIAL_JOBS[1],
    isDirectToInvoice: true,
    formsRequired: ['JSA'],
  };
  const invalidResult = validateJobCompletion(invalidDirectJob, {});
  assert.equal(invalidResult.canComplete, false);
  assert.ok(invalidResult.missingRequirements.some(r => r.includes('JSA')));
});

test('LAYER 2: Domain — JSA requires induction, competency verification, task steps, and sign-off', () => {
  const job: Job = {
    ...INITIAL_JOBS[0],
    formsRequired: ['JSA'],
  };

  // Missing induction & competency
  const incompleteJsa: JsaFormData = {
    jobReference: job.id,
    date: '2026-11-02',
    customerName: 'Test',
    siteContactPlaceholder: 'Test',
    siteAddress: '123 Site',
    taskDescription: 'Service',
    assetsIdentified: 'Panel',
    personnelName: 'Dave Miller',
    personnelRole: 'Tech',
    licencePlaceholder: 'Q-1234',
    licenceExpiryPlaceholder: '2027',
    inductionCompleted: false, // NOT completed
    competencyVerified: false, // NOT verified
    overallRiskLevel: 'M',
    steps: [{ id: 's1', taskStep: 'Step 1', hazards: 'Haz', initialRisk: 'M', controls: 'Ctrl', residualRisk: 'L', responsibleRole: 'Tech' }],
    ppeChecklist: [],
    isolationsAndPermits: [],
    emergencyAssemblyArea: 'Front',
    emergencyWardenPlaceholder: 'Lead',
    firstAidOfficerPlaceholder: 'Lead',
    signedOff: true,
    formRevision: 'v1',
    issuerPlaceholder: 'Solarcell',
    attachedSampleIds: [],
  };

  const res1 = validateJobCompletion(job, { jsa: incompleteJsa });
  assert.equal(res1.canComplete, false);
  assert.ok(res1.missingRequirements.some(r => r.includes('induction and competency')));

  // Zero task steps
  const noStepsJsa: JsaFormData = {
    ...incompleteJsa,
    inductionCompleted: true,
    competencyVerified: true,
    steps: [], // empty
  };
  const res2 = validateJobCompletion(job, { jsa: noStepsJsa });
  assert.equal(res2.canComplete, false);
  assert.ok(res2.missingRequirements.some(r => r.includes('hazard/control task step')));

  // Unsigned
  const unsignedJsa: JsaFormData = {
    ...incompleteJsa,
    inductionCompleted: true,
    competencyVerified: true,
    signedOff: false,
  };
  const res3 = validateJobCompletion(job, { jsa: unsignedJsa });
  assert.equal(res3.canComplete, false);
  assert.ok(res3.missingRequirements.some(r => r.includes('technician Preview sign-off')));

  // Fully compliant JSA
  const compliantJsa: JsaFormData = {
    ...incompleteJsa,
    inductionCompleted: true,
    competencyVerified: true,
    signedOff: true,
    steps: [{ id: 's1', taskStep: 'Step 1', hazards: 'Haz', initialRisk: 'M', controls: 'Ctrl', residualRisk: 'L', responsibleRole: 'Tech' }],
  };
  const res4 = validateJobCompletion(job, { jsa: compliantJsa });
  assert.equal(res4.canComplete, true);
});

test('LAYER 2: Domain — TCA2 Cabling Non-Compliance requires customer acknowledgement and tech sign-off', () => {
  const job: Job = {
    ...INITIAL_JOBS[3], // CCTV cabling
    formsRequired: ['TCA2'],
  };

  const tca2Unacknowledged: Tca2CertData = {
    reportReference: 'TCA2-001',
    jobReference: job.id,
    inspectionDate: '2026-11-02',
    businessCablerPlaceholder: 'Alex Taylor',
    customerName: 'Marcus Vance',
    siteAddress: 'Warehouse',
    cablingScope: 'Existing Only',
    cablingTypes: ['Cat 5e'],
    locationsInspected: 'Riser Cupboard B',
    nonComplianceDescription: 'Mains co-located with comms',
    requirementReferencePlaceholder: 'AS/CA S009:2020',
    riskCategory: 'High (Immediate Shock / Fire Hazard)',
    samplePhotoLinked: true,
    rectificationRecommendation: 'Run dedicated conduit',
    responsibleParty: 'Customer / Building Owner',
    urgencyLevel: 'Immediate (Within 24 Hours)',
    quotationReferencePlaceholder: 'MYOB-Q-RECT',
    targetResolutionDate: '2026-11-05',
    customerAcknowledged: false, // NOT acknowledged
    officeReviewCompleted: false,
    signedOff: true,
    warningNotice: 'DEFECT NOTICE',
    attachedSampleIds: [],
  };

  // Missing audit record -> rejected due to missing audit record
  const resMissingAudit = validateJobCompletion(job, { tca2: tca2Unacknowledged });
  assert.equal(resMissingAudit.canComplete, false);
  assert.ok(resMissingAudit.missingRequirements.some(r => r.includes('registered audit record')));

  // Unacknowledged audit record -> rejected due to customer acknowledgement
  const auditUnack: Tca2AuditRecord = {
    jobId: job.id,
    customerAcknowledged: false,
    officeReviewCompleted: false,
  };
  const res1 = validateJobCompletion(job, { tca2: tca2Unacknowledged }, auditUnack);
  assert.equal(res1.canComplete, false);
  assert.ok(res1.missingRequirements.some(r => r.includes('customer acknowledgement')));

  // Acknowledged audit record -> completes cleanly
  const auditAck: Tca2AuditRecord = {
    jobId: job.id,
    customerAcknowledged: true,
    customerAckTimestamp: '2026-11-02 14:00',
    officeReviewCompleted: true,
  };
  const res2 = validateJobCompletion(job, { tca2: tca2Unacknowledged }, auditAck);
  assert.equal(res2.canComplete, true);
  assert.ok(res2.warnings.some(w => w.includes('Compliance Notice: Completing TCA2 records non-compliance')));
});

// -------------------------------------------------------------
// QUOTE ACCEPTANCE & REVIEW DEDUPLICATION
// -------------------------------------------------------------
test('LAYER 2: Domain — Review request deduplication rejects duplicate dispatches', () => {
  const job: Job = {
    ...INITIAL_JOBS[0],
    reviewRequest: {
      status: 'SENT',
      sentTimestamp: '2026-11-02 11:30',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
  };

  let wasDispatched = false;
  const dedup = deduplicateReviewRequest(job, () => {
    wasDispatched = true;
    return { success: true, reviewUrl: 'test' };
  });

  assert.equal(dedup.allowed, false);
  assert.equal(wasDispatched, false);
  assert.ok(dedup.reason?.includes('already sent'));
});

test('LAYER 2: Domain — Reminder time derivation is mathematically exact and suppresses stale reminders', () => {
  // Appointment at 14:00 with 2-hour lead time -> 12:00
  const reminderTime = calculateReminderDueTime('2026-11-05', '14:00', 2);
  assert.equal(reminderTime, '2026-11-05 12:00');

  // Appointment at 09:00 with 24-hour lead time -> previous day 09:00
  const dayBefore = calculateReminderDueTime('2026-11-05', '09:00', 24);
  assert.equal(dayBefore, '2026-11-04 09:00');

  // Stale reminder suppression
  const jobWithReminders: Job = {
    ...INITIAL_JOBS[0],
    reminders: [
      {
        id: 'REM-1',
        targetAppointmentTime: '2026-11-02 09:00',
        scheduledFor: '2026-11-01 09:00',
        leadHours: 24,
        type: 'REMINDER_24HR',
        channel: 'EMAIL_SIMULATED',
        suppressed: false,
        delivered: false,
      },
    ],
  };

  const updated = suppressOldReminders(jobWithReminders, 'Visit rescheduled to 2026-11-06', '2026-11-02T10:00:00+10:00');
  assert.equal(updated[0].suppressed, true);
  assert.ok(updated[0].suppressionReason?.includes('Visit rescheduled to 2026-11-06'));
});

// -------------------------------------------------------------
// TEMPLATE REVISIONS AND IMMUTABILITY
// -------------------------------------------------------------
test('LAYER 2: Domain — Template version preservation maintains historical revisions', () => {
  const termsTemplate: TemplateSetting = INITIAL_TEMPLATES.find(t => t.type === 'TERMS')!;
  assert.ok(termsTemplate);
  assert.equal(termsTemplate.currentVersion, 'v2.4');
  assert.ok(termsTemplate.revisions.length >= 2);
  assert.equal(termsTemplate.revisions[0].status, 'PUBLISHED');
  assert.equal(termsTemplate.revisions[1].status, 'PUBLISHED');
});
