/**
 * Pure business logic and validation rules for CABMS G00 Demo
 * Decoupled from UI to enable fast unit testing via node:test and tsx
 */

import {
  Customer,
  Job,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  Tca2AuditRecord,
  TemplateSetting,
  TemplateRevision,
  Persona,
} from '../types/cabms.ts';

export interface CompletionValidationResult {
  canComplete: boolean;
  missingRequirements: string[];
  warnings: string[];
  isDirectToInvoice: boolean;
}

export function validateJobCompletion(
  job: Job,
  formsState: {
    jsa?: JsaFormData;
    electrical?: ElectricalCertData;
    smokeAlarm?: SmokeAlarmCertData;
    tca1?: Tca1CertData;
    tca2?: Tca2CertData;
  },
  tca2Audit?: Tca2AuditRecord
): CompletionValidationResult {
  const missingRequirements: string[] = [];
  const warnings: string[] = [];

  // G00-014: A cancelled job cannot complete without reopening
  if (job.status === 'CANCELLED') {
    return {
      canComplete: false,
      missingRequirements: ['Job is currently CANCELLED. Operational reopening is required before completion.'],
      warnings: [],
      isDirectToInvoice: job.isDirectToInvoice,
    };
  }

  // G00-012: Direct-to-invoice only bypasses forms if formsRequired is genuinely empty
  if (job.isDirectToInvoice && job.formsRequired.length === 0) {
    return {
      canComplete: true,
      missingRequirements: [],
      warnings: ['Direct-to-invoice service: no compliance documentation required for operational completion.'],
      isDirectToInvoice: true,
    };
  }

  // If formsRequired has items, they must be validated regardless of isDirectToInvoice flag
  if (job.formsRequired.length === 0 && !job.isDirectToInvoice) {
    warnings.push('Advisory: No compliance documents registered for this work order.');
  }

  // Check each required form for this job type
  for (const formType of job.formsRequired) {
    switch (formType) {
      case 'JSA': {
        const jsa = formsState.jsa;
        if (!jsa) {
          missingRequirements.push('JSA / Risk Assessment record not started');
        } else if (!jsa.signedOff) {
          missingRequirements.push('JSA / Risk Assessment requires technician DEMO sign-off');
        } else if (!jsa.inductionCompleted || !jsa.competencyVerified) {
          missingRequirements.push('JSA requires site induction and competency verification to be confirmed');
        } else if (jsa.steps.length === 0) {
          missingRequirements.push('JSA must have at least one hazard/control task step');
        }
        break;
      }
      case 'ELECTRICAL': {
        const elec = formsState.electrical;
        if (!elec) {
          missingRequirements.push('Electrical Certificate record not started');
        } else if (!elec.signedOff) {
          missingRequirements.push('Electrical Certificate requires technician DEMO sign-off');
        }
        // Always preserve unresolved Part B warning
        warnings.push('NOTICE: Electrical Part B / sections 7-8 not supplied or unresolved. No completed live certificate can be inferred.');
        break;
      }
      case 'SMOKE_ALARM': {
        const smoke = formsState.smokeAlarm;
        if (!smoke) {
          missingRequirements.push('Smoke Alarm Certificate record not started');
        } else if (!smoke.signedOff) {
          missingRequirements.push('Smoke Alarm Certificate requires technician DEMO sign-off');
        } else {
          // Check for any failing alarm in schedule
          const failingAlarms = smoke.alarmSchedule.filter(a => a.passFail === 'Fail');
          if (failingAlarms.length > 0) {
            warnings.push(`Warning: ${failingAlarms.length} smoke alarm(s) marked Fail in schedule. Remediation required.`);
          }
        }
        warnings.push('Provisional notice: Room/model count limits and expiry wording are provisional per unapproved source variants.');
        break;
      }
      case 'TCA1': {
        const tca1 = formsState.tca1;
        if (!tca1) {
          missingRequirements.push('TCA1 Cabling Compliance Certificate not started');
        } else if (!tca1.signedOff) {
          missingRequirements.push('TCA1 Certificate requires registered cabler DEMO sign-off');
        }
        warnings.push('Notice: Cabler registration number and expiry status remain unresolved placeholders.');
        break;
      }
      case 'TCA2': {
        const tca2 = formsState.tca2;
        if (!tca2) {
          missingRequirements.push('TCA2 Cabling Non-Compliance report not started');
        } else {
          if (!tca2.signedOff) {
            missingRequirements.push('TCA2 Report requires technician DEMO sign-off');
          }
          // Authoritative audit separation: Check tca2Audit store strictly without legacy fallback
          if (!tca2Audit) {
            missingRequirements.push('TCA2 Defect Notice requires registered audit record in compliance store');
          } else {
            if (!tca2Audit.customerAcknowledged) {
              missingRequirements.push('TCA2 Defect Notice requires customer acknowledgement (must be acknowledged by customer before closing work order)');
            }
            if (!tca2Audit.officeReviewCompleted) {
              warnings.push('Advisory: TCA2 office review pending rectification quotation.');
            }
          }
        }
        warnings.push('Compliance Notice: Completing TCA2 records non-compliance; it does NOT certify the cabling as compliant.');
        break;
      }
    }
  }

  return {
    canComplete: missingRequirements.length === 0,
    missingRequirements,
    warnings,
    isDirectToInvoice: job.isDirectToInvoice,
  };
}

export function deduplicateReviewRequest(
  currentJob: Job,
  sendAction: () => { success: boolean; reviewUrl: string }
): { allowed: boolean; reason?: string; result?: { success: boolean; reviewUrl: string } } {
  if (currentJob.reviewRequest.status === 'SENT') {
    return {
      allowed: false,
      reason: `Review request was already sent on ${currentJob.reviewRequest.sentTimestamp}. Duplicate request prevented.`,
    };
  }

  if (currentJob.reviewRequest.status === 'PENDING') {
    return {
      allowed: false,
      reason: 'Review request is currently queued in pending state. Duplicate dispatch prevented.',
    };
  }

  if (currentJob.reviewRequest.status === 'UNCERTAIN') {
    return {
      allowed: false,
      reason: 'Previous dispatch status is UNCERTAIN. Must reconcile simulated remote status before retrying.',
    };
  }

  const result = sendAction();
  return { allowed: true, result };
}

/**
 * G00-019: Calculate reminder lead time in business format.
 * E.g., for appointment at 2026-11-02 14:00 with leadHours = 2, returns "2026-11-02 12:00".
 */
export function calculateReminderDueTime(dateStr: string, timeStr: string, leadHours: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  date.setHours(date.getHours() - leadHours);

  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());

  return `${y}-${m}-${d} ${h}:${min}`;
}

export function suppressOldReminders(
  job: Job,
  reason: string,
  nowIso: string
) {
  return job.reminders.map(r => {
    if (!r.delivered && !r.suppressed) {
      return {
        ...r,
        suppressed: true,
        suppressionReason: `${reason} at ${nowIso.slice(0, 16)}`,
      };
    }
    return r;
  });
}

export function checkCustomerDuplicate(
  candidate: { email: string; phone: string; name: string },
  existingCustomers: Customer[]
): { isDuplicate: boolean; matchedCustomer?: Customer; field?: string } {
  const normEmail = candidate.email ? candidate.email.trim().toLowerCase() : '';
  const rawPhone = candidate.phone ? candidate.phone.trim() : '';
  const normPhone = rawPhone.replace(/[^0-9]/g, '');

  for (const c of existingCustomers) {
    if (normEmail && c.email.toLowerCase() === normEmail) {
      return { isDuplicate: true, matchedCustomer: c, field: 'email' };
    }
    // FC-15: Check phone only if candidate provided a real non-placeholder phone number
    if (normPhone && normPhone !== '0400000000') {
      const existingNormPhone = c.phone ? c.phone.replace(/[^0-9]/g, '') : '';
      if (existingNormPhone && existingNormPhone !== '0400000000' && existingNormPhone === normPhone) {
        return { isDuplicate: true, matchedCustomer: c, field: 'phone' };
      }
    }
    if (candidate.name && candidate.name.trim() && candidate.name.trim().toLowerCase() === c.name.trim().toLowerCase()) {
      return { isDuplicate: true, matchedCustomer: c, field: 'name' };
    }
  }

  return { isDuplicate: false };
}

export function verifyPersonaAccess(
  persona: Persona,
  resource: 'all_customers' | 'technical_integrations' | 'template_publishing' | 'template_editing' | 'financial_writes' | 'assigned_job' | 'unassigned_job' | 'office_compliance_review',
  jobAssignment?: { assignedTechId: string | null; currentTechId: string }
): { allowed: boolean; reason?: string } {
  switch (persona) {
    case 'super_admin':
      return { allowed: true };

    case 'owner_admin':
      if (resource === 'technical_integrations') {
        return {
          allowed: false,
          reason: 'Admin has operational oversight but cannot alter Super Admin technical credentials or bindings.',
        };
      }
      return { allowed: true };

    case 'office_staff':
      if (resource === 'technical_integrations') {
        return { allowed: false, reason: 'Office Staff cannot access technical integration settings.' };
      }
      if (resource === 'template_publishing' || resource === 'template_editing') {
        return { allowed: false, reason: 'Office Staff can view templates but cannot edit or publish master compliance templates.' };
      }
      return { allowed: true };

    case 'technician':
      if (resource === 'all_customers') {
        return { allowed: false, reason: 'Technician access is restricted to assigned jobs and sites only; full customer directory is not permitted.' };
      }
      if (
        resource === 'technical_integrations' ||
        resource === 'template_publishing' ||
        resource === 'template_editing' ||
        resource === 'financial_writes' ||
        resource === 'office_compliance_review'
      ) {
        return { allowed: false, reason: 'Technician role cannot access technical settings, master templates, financial writes, or office compliance reviews.' };
      }
      if (resource === 'unassigned_job') {
        return { allowed: false, reason: 'Technician can only access jobs assigned to them. Direct route to unassigned work is denied.' };
      }
      if (resource === 'assigned_job') {
        if (!jobAssignment || !jobAssignment.assignedTechId || jobAssignment.assignedTechId !== jobAssignment.currentTechId) {
          return { allowed: false, reason: 'This job is not assigned to you.' };
        }
        return { allowed: true };
      }
      return { allowed: false, reason: 'Access restricted for Technician persona.' };
  }
}

/**
 * Pure domain logic for TCA2 Office Review and rectification follow-up job creation.
 * Guaranteed idempotent and atomic: checks both existing audit record and existing jobs pool.
 */
export interface ProcessOfficeReviewParams {
  jobId: string;
  actorPersona: Persona;
  sourceJob?: Job;
  tca2Cert?: Tca2CertData;
  existingAudit?: Tca2AuditRecord;
  existingJobs: Job[];
  nextJobSeq: number;
  demoClock: string;
}

export interface ProcessOfficeReviewResult {
  success: boolean;
  error?: string;
  isDuplicate: boolean;
  newFollowupJob?: Job;
  updatedAuditRecord: Tca2AuditRecord;
  nextJobSeq: number;
}

export function processOfficeReviewTca2(params: ProcessOfficeReviewParams): ProcessOfficeReviewResult {
  const { jobId, actorPersona, sourceJob, tca2Cert, existingAudit, existingJobs, nextJobSeq, demoClock } = params;

  const access = verifyPersonaAccess(actorPersona, 'office_compliance_review');
  if (!access.allowed) {
    return {
      success: false,
      error: `DENIED: ${access.reason}`,
      isDuplicate: false,
      updatedAuditRecord: existingAudit || { jobId, customerAcknowledged: false, officeReviewCompleted: false },
      nextJobSeq,
    };
  }

  if (!tca2Cert?.signedOff) {
    return {
      success: false,
      error: 'CANNOT REVIEW: TCA2 Defect Report must be signed off by a technician before office review.',
      isDuplicate: false,
      updatedAuditRecord: existingAudit || { jobId, customerAcknowledged: false, officeReviewCompleted: false },
      nextJobSeq,
    };
  }

  // Idempotency check 1: Already reviewed in audit store
  if (existingAudit?.officeReviewCompleted && existingAudit?.rectificationFollowupJobId) {
    return {
      success: true,
      isDuplicate: true,
      updatedAuditRecord: existingAudit,
      nextJobSeq,
    };
  }

  // Idempotency check 2: Existing followup job in jobs pool
  const existingFollowupJob = existingJobs.find(j =>
    j.title?.includes(`Follow-up to ${jobId}`) ||
    (j.description?.includes(`reported under ${jobId}`) && j.description?.includes('TCA2'))
  );

  if (existingFollowupJob) {
    const updatedAudit: Tca2AuditRecord = {
      ...(existingAudit || { jobId, customerAcknowledged: false, officeReviewCompleted: false }),
      officeReviewCompleted: true,
      reviewedByOfficeStaff: 'Emma Wilson (Office Administrator)',
      officeReviewTimestamp: demoClock.slice(0, 16),
      rectificationFollowupJobId: existingFollowupJob.id,
    };
    return {
      success: true,
      isDuplicate: true,
      updatedAuditRecord: updatedAudit,
      nextJobSeq,
    };
  }

  // Create new follow-up job atomically
  const updatedSeq = nextJobSeq + 1;
  const followupId = `JOB-2026-${updatedSeq}`;

  const newFollowupJob: Job = {
    id: followupId,
    brandId: sourceJob?.brandId || 'cctv',
    customerId: sourceJob?.customerId || 'CUSTOMER-DEMO-001',
    title: `TCA2 Remediation: Dedicated Conduit Installation (Follow-up to ${jobId})`,
    jobType: 'Enterprise CCTV & Cabling Inspection',
    jobTypeVersion: 'v2.1',
    siteAddress: sourceJob?.siteAddress || '[Fictional] Site Address',
    siteContact: sourceJob?.siteContact || 'Site Contact',
    sitePhone: sourceJob?.sitePhone || '0400 000 000',
    description: `Rectification follow-up for Cabling Non-Compliance reported under ${jobId}. Dedicated 25mm PVC conduit separation required.`,
    status: 'NEW',
    appointmentStatus: 'UNSCHEDULED',
    assignedTechId: null,
    assignedTechName: null,
    scheduledDate: null,
    scheduledTime: null,
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'TCA1'],
    attachedSampleIds: sourceJob?.attachedSampleIds ? [...sourceJob.attachedSampleIds] : [],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: '',
      brandName: 'Gold Coast CCTV',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    unresolvedWarnings: ['Follow-up rectification work order queued from TCA2 Office Review.'],
    activityHistory: [
      {
        timestamp: demoClock.slice(0, 16),
        action: `Rectification work order #${followupId} queued from TCA2 office review of defect on ${jobId}`,
        actor: actorPersona,
      },
    ],
  };

  const updatedAudit: Tca2AuditRecord = {
    ...(existingAudit || { jobId, customerAcknowledged: false, officeReviewCompleted: false }),
    officeReviewCompleted: true,
    reviewedByOfficeStaff: 'Emma Wilson (Office Administrator)',
    officeReviewTimestamp: demoClock.slice(0, 16),
    rectificationFollowupJobId: followupId,
  };

  return {
    success: true,
    isDuplicate: false,
    newFollowupJob,
    updatedAuditRecord: updatedAudit,
    nextJobSeq: updatedSeq,
  };
}

/**
 * Pure domain logic for Customer TCA2 Acknowledgement.
 * Enforces signedOff requirement, actor role boundaries, and single-acknowledgement idempotency.
 */
export function processCustomerAckTca2(params: {
  jobId: string;
  actorPersona: Persona;
  tca2Cert?: Tca2CertData;
  existingAudit?: Tca2AuditRecord;
  demoClock: string;
}): { success: boolean; error?: string; updatedAuditRecord?: Tca2AuditRecord } {
  const { jobId, actorPersona, tca2Cert, existingAudit, demoClock } = params;

  if (actorPersona === 'technician') {
    return {
      success: false,
      error: 'DENIED: Field technician cannot self-acknowledge customer defect notice on behalf of customer.',
    };
  }

  if (!tca2Cert?.signedOff) {
    return {
      success: false,
      error: 'CANNOT ACKNOWLEDGE: TCA2 Defect Report must be signed off by a technician before customer acknowledgement.',
    };
  }

  if (existingAudit?.customerAcknowledged) {
    return {
      success: false,
      error: 'ALREADY ACKNOWLEDGED: Customer acknowledgement has already been recorded for this TCA2 Defect Notice.',
    };
  }

  const timestamp = demoClock.slice(0, 16);
  const updatedAuditRecord: Tca2AuditRecord = {
    ...(existingAudit || { jobId, customerAcknowledged: false, officeReviewCompleted: false }),
    customerAcknowledged: true,
    customerAckTimestamp: timestamp,
  };

  return { success: true, updatedAuditRecord };
}

/**
 * Recalculate job-level attachment references from all active forms on that job.
 * Preserves evidence if any form still references the sample ID.
 */
export function recalculateJobAttachments(
  allFormAttachmentArrays: (string[] | undefined)[]
): string[] {
  const unionSet = new Set<string>();
  for (const arr of allFormAttachmentArrays) {
    if (Array.isArray(arr)) {
      for (const id of arr) {
        if (id) unionSet.add(id);
      }
    }
  }
  return Array.from(unionSet);
}

/**
 * Pure domain logic for master template publishing.
 * Enforces REVIEW status and retains reviewed revision history.
 */
export function processPublishTemplate(
  template: TemplateSetting,
  actorPersona: Persona,
  demoClock: string
): { success: boolean; error?: string; updatedTemplate?: TemplateSetting } {
  const access = verifyPersonaAccess(actorPersona, 'template_publishing');
  if (!access.allowed) {
    return { success: false, error: `DENIED: ${access.reason}` };
  }

  if (template.activeStatus !== 'REVIEW') {
    return {
      success: false,
      error: `CANNOT PUBLISH: Template revision must be submitted and in 'REVIEW' status before publishing. Current status: ${template.activeStatus}.`,
    };
  }

  const currentVerNum = parseFloat(template.currentVersion.replace('v', '')) || 1.0;
  const newVer = `v${(currentVerNum + 0.1).toFixed(1)}`;
  const timestamp = demoClock.slice(0, 16);

  const publishedRev: TemplateRevision = {
    version: newVer,
    status: 'PUBLISHED',
    content: template.content,
    updatedAt: timestamp,
    updatedBy: actorPersona.toUpperCase(),
  };

  // Retain ALL revisions including the reviewed revision for full audit history
  const updatedTemplate: TemplateSetting = {
    ...template,
    currentVersion: newVer,
    activeStatus: 'PUBLISHED',
    revisions: [publishedRev, ...template.revisions],
  };

  return { success: true, updatedTemplate };
}

/**
 * Pure domain logic for Review Request dispatch lifecycle.
 * Models PENDING -> SENT / FAILED / UNCERTAIN.
 */
export function processReviewDispatch(params: {
  currentJob: Job;
  simulateOutcome?: 'FAIL' | 'UNCERTAIN';
  demoClock: string;
  reviewUrl: string;
  brandName: string;
}): {
  allowed: boolean;
  reason?: string;
  pendingJob?: Job;
  resolvedJob?: Job;
  outcomeStatus?: 'SENT' | 'FAILED' | 'UNCERTAIN';
} {
  const { currentJob, simulateOutcome, demoClock, reviewUrl, brandName } = params;

  const dedup = deduplicateReviewRequest(currentJob, () => ({ success: true, reviewUrl }));
  if (!dedup.allowed) {
    return { allowed: false, reason: dedup.reason };
  }

  const timestamp = demoClock.slice(0, 16);

  // Observable PENDING state
  const pendingJob: Job = {
    ...currentJob,
    reviewRequest: {
      ...currentJob.reviewRequest,
      status: 'PENDING',
      brandName,
      reviewLink: reviewUrl,
      channel: 'EMAIL_SIMULATED',
      history: [
        ...currentJob.reviewRequest.history,
        {
          timestamp,
          event: `Review request queued for dispatch (${brandName})`,
          status: 'PENDING',
        },
      ],
    },
    activityHistory: [
      ...currentJob.activityHistory,
      { timestamp, action: `Review invitation dispatch queued (PENDING) for ${brandName}`, actor: 'Automated Service' },
    ],
  };

  let resolvedJob: Job;
  let outcomeStatus: 'SENT' | 'FAILED' | 'UNCERTAIN';

  if (simulateOutcome === 'UNCERTAIN') {
    outcomeStatus = 'UNCERTAIN';
    resolvedJob = {
      ...pendingJob,
      reviewRequest: {
        ...pendingJob.reviewRequest,
        status: 'UNCERTAIN',
        uncertainReconciliationNeeded: true,
        history: [
          ...pendingJob.reviewRequest.history,
          {
            timestamp,
            event: 'Simulated dispatch gateway timeout (504 Gateway Timeout) - delivery outcome uncertain',
            status: 'UNCERTAIN',
          },
        ],
      },
      activityHistory: [
        ...pendingJob.activityHistory,
        { timestamp, action: 'Review request dispatch resulted in UNCERTAIN status (504)', actor: 'Automated Service' },
      ],
    };
  } else if (simulateOutcome === 'FAIL') {
    outcomeStatus = 'FAILED';
    resolvedJob = {
      ...pendingJob,
      reviewRequest: {
        ...pendingJob.reviewRequest,
        status: 'FAILED',
        uncertainReconciliationNeeded: false,
        history: [
          ...pendingJob.reviewRequest.history,
          {
            timestamp,
            event: 'Simulated dispatch failure: SMTP 550 delivery rejection',
            status: 'FAILED',
          },
        ],
      },
      activityHistory: [
        ...pendingJob.activityHistory,
        { timestamp, action: 'Review request dispatch failed (SMTP 550)', actor: 'Automated Service' },
      ],
    };
  } else {
    outcomeStatus = 'SENT';
    resolvedJob = {
      ...pendingJob,
      reviewRequest: {
        ...pendingJob.reviewRequest,
        status: 'SENT',
        sentTimestamp: timestamp,
        uncertainReconciliationNeeded: false,
        history: [
          ...pendingJob.reviewRequest.history,
          {
            timestamp,
            event: `Email invitation sent to customer for ${brandName}`,
            status: 'SENT',
          },
        ],
      },
      activityHistory: [
        ...pendingJob.activityHistory,
        { timestamp, action: `Review invitation sent to customer (${brandName})`, actor: 'Automated Service' },
      ],
    };
  }

  return {
    allowed: true,
    pendingJob,
    resolvedJob,
    outcomeStatus,
  };
}

export interface SnapshotValidationResult {
  valid: boolean;
  error?: string;
  parsedSnapshot?: Record<string, any>;
}

type SignedFormType = 'JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2';

const signedSnapshotSchema: Record<SignedFormType, {
  strings: string[];
  booleans: string[];
  numbers: string[];
  arrays: string[];
  objects: string[];
}> = {
  JSA: {
    strings: ['date', 'customerName', 'siteContactPlaceholder', 'siteAddress', 'taskDescription', 'assetsIdentified', 'personnelName', 'personnelRole', 'licencePlaceholder', 'licenceExpiryPlaceholder', 'formRevision', 'issuerPlaceholder', 'emergencyAssemblyArea', 'emergencyWardenPlaceholder', 'firstAidOfficerPlaceholder'],
    booleans: ['inductionCompleted', 'competencyVerified'],
    numbers: [],
    arrays: ['steps', 'ppeChecklist', 'isolationsAndPermits', 'attachedSampleIds'],
    objects: [],
  },
  ELECTRICAL: {
    strings: ['certReference', 'dateOfTest', 'customerName', 'installationAddress', 'siteContact', 'occupierRole', 'contractorNamePlaceholder', 'electricianLicencePlaceholder', 'issuerWordingPlaceholder', 'partACertificationPlaceholder', 'limitationsAndConsumerRightsPlaceholder', 'unresolvedNotice'],
    booleans: [],
    numbers: [],
    arrays: ['testedWorkItems', 'standardsReliedOn', 'attachedSampleIds'],
    objects: [],
  },
  SMOKE_ALARM: {
    strings: ['certReference', 'dateOfInspection', 'issuedByPlaceholder', 'issuedToRole', 'propertyType', 'occupancyStatus', 'relatedElectricalCertRef', 'limitationsAndRentalNotes', 'provisionalNote'],
    booleans: ['attachmentsLinked'],
    numbers: ['storeys', 'bedrooms'],
    arrays: ['alarmSchedule', 'attachedSampleIds'],
    objects: ['scopeOfWork'],
  },
  TCA1: {
    strings: ['certReference', 'registeredCablerPlaceholder', 'cablerRegistrationNumberPlaceholder', 'employerDetailsPlaceholder', 'dateOfWork', 'workDescription', 'locationOfWork', 'customerName', 'customerContact', 'certificationPlaceholderText', 'unresolvedRegistrationExpiryNotice'],
    booleans: ['supervisionProvided'],
    numbers: [],
    arrays: ['attachedSampleIds'],
    objects: [],
  },
  TCA2: {
    strings: ['reportReference', 'inspectionDate', 'businessCablerPlaceholder', 'customerName', 'siteAddress', 'cablingScope', 'locationsInspected', 'nonComplianceDescription', 'requirementReferencePlaceholder', 'riskCategory', 'rectificationRecommendation', 'responsibleParty', 'urgencyLevel', 'quotationReferencePlaceholder', 'targetResolutionDate', 'warningNotice'],
    booleans: ['samplePhotoLinked', 'customerAcknowledged', 'officeReviewCompleted'],
    numbers: [],
    arrays: ['cablingTypes', 'attachedSampleIds'],
    objects: [],
  },
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateSignedSnapshot(
  snapshotRaw?: string,
  expectedJobId?: string,
  formType?: string
): SnapshotValidationResult {
  if (!snapshotRaw || typeof snapshotRaw !== 'string' || snapshotRaw.trim() === '') {
    return { valid: false, error: 'Signed document snapshot is missing or empty.' };
  }
  try {
    const parsed = JSON.parse(snapshotRaw);
    if (!isRecord(parsed)) {
      return { valid: false, error: 'Snapshot is not a valid JSON object.' };
    }
    if (!formType || !Object.prototype.hasOwnProperty.call(signedSnapshotSchema, formType)) {
      return { valid: false, error: `Unsupported signed document form type: ${formType || 'missing'}.` };
    }
    if (typeof expectedJobId !== 'string' || expectedJobId.trim() === '') {
      return { valid: false, error: 'Expected job reference is required to validate a signed snapshot.' };
    }
    if (parsed.signedOff !== true) {
      return { valid: false, error: 'Snapshot does not record finalized signedOff: true status.' };
    }
    if (typeof parsed.jobReference !== 'string' || parsed.jobReference.trim() === '') {
      return { valid: false, error: 'Snapshot lacks mandatory jobReference.' };
    }
    if (parsed.jobReference !== expectedJobId) {
      return { valid: false, error: `Snapshot job reference (${parsed.jobReference}) mismatch with expected ${expectedJobId}.` };
    }
    if (typeof parsed.signedTimestamp !== 'string' || parsed.signedTimestamp.trim() === '') {
      return { valid: false, error: 'Snapshot lacks mandatory signed timestamp.' };
    }
    if (typeof parsed.signedByTechName !== 'string' || parsed.signedByTechName.trim() === '') {
      return { valid: false, error: 'Snapshot lacks mandatory signer identity.' };
    }
    if (typeof parsed.frozenIssuerSnapshot !== 'string' || parsed.frozenIssuerSnapshot.trim() === '') {
      return { valid: false, error: 'Snapshot lacks mandatory frozenIssuerSnapshot.' };
    }

    const schema = signedSnapshotSchema[formType as SignedFormType];
    for (const field of schema.strings) {
      if (typeof parsed[field] !== 'string' || parsed[field].trim() === '') {
        return { valid: false, error: `${formType} snapshot lacks mandatory ${field}.` };
      }
    }
    for (const field of schema.booleans) {
      if (typeof parsed[field] !== 'boolean') {
        return { valid: false, error: `${formType} snapshot lacks valid ${field}.` };
      }
    }
    for (const field of schema.numbers) {
      if (typeof parsed[field] !== 'number' || !Number.isFinite(parsed[field])) {
        return { valid: false, error: `${formType} snapshot lacks valid ${field}.` };
      }
    }
    for (const field of schema.arrays) {
      if (!Array.isArray(parsed[field])) {
        return { valid: false, error: `${formType} snapshot lacks valid ${field}.` };
      }
    }
    for (const field of schema.objects) {
      if (!isRecord(parsed[field])) {
        return { valid: false, error: `${formType} snapshot lacks valid ${field}.` };
    }
    }
    if (formType === 'SMOKE_ALARM') {
      const scopeFields = ['visualInspection', 'operationalTesting', 'interconnectionTesting', 'cleaningAndVacuuming', 'batteryReplacement', 'alarmReplacement'];
      if (scopeFields.some(field => typeof parsed.scopeOfWork[field] !== 'boolean')) {
        return { valid: false, error: 'SMOKE_ALARM snapshot lacks a complete scopeOfWork object.' };
      }
    }

    const nestedRequirements: Partial<Record<SignedFormType, Record<string, string[]>>> = {
      JSA: {
        steps: ['id', 'taskStep', 'hazards', 'initialRisk', 'controls', 'residualRisk', 'responsibleRole'],
        ppeChecklist: ['item', 'status'],
        isolationsAndPermits: ['item', 'required', 'referenceOrNotes'],
      },
      ELECTRICAL: {
        testedWorkItems: ['id', 'description', 'circuitsTested', 'insulationResistanceResult', 'polarityTest', 'earthContinuity', 'rcdTripTimeMs', 'workResult'],
      },
      SMOKE_ALARM: {
        alarmSchedule: ['id', 'roomLocation', 'alarmBrandModel', 'standardMarkingPlaceholder', 'manufactureDateOrExpiry', 'powerSource', 'passFail', 'buttonTestPass', 'interconnectionPass', 'complianceStatusProvisional'],
      },
    };
    for (const [arrayField, requiredFields] of Object.entries(nestedRequirements[formType as SignedFormType] || {})) {
      if (parsed[arrayField].some((item: unknown) => !isRecord(item) || requiredFields.some(field => !(field in item)))) {
        return { valid: false, error: `${formType} snapshot contains an incomplete ${arrayField} entry.` };
      }
    }
    return { valid: true, parsedSnapshot: parsed };
  } catch (e: any) {
    return { valid: false, error: `Snapshot JSON syntax error: ${e.message}` };
  }
}


