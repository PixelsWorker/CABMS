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
  }
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
          if (!tca2.customerAcknowledged) {
            missingRequirements.push('TCA2 requires customer acknowledgement of recorded cabling non-compliance');
          }
          if (!tca2.officeReviewCompleted) {
            warnings.push('Advisory: TCA2 office review pending rectification quotation.');
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
  const normEmail = candidate.email.trim().toLowerCase();
  const normPhone = candidate.phone.replace(/[^0-9]/g, '');

  for (const c of existingCustomers) {
    if (normEmail && c.email.toLowerCase() === normEmail) {
      return { isDuplicate: true, matchedCustomer: c, field: 'email' };
    }
    if (normPhone && c.phone.replace(/[^0-9]/g, '') === normPhone) {
      return { isDuplicate: true, matchedCustomer: c, field: 'phone' };
    }
    if (candidate.name.trim().toLowerCase() === c.name.trim().toLowerCase()) {
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
          reason: 'Owner/Admin has operational oversight but cannot alter Super Admin technical credentials or bindings.',
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
