/**
 * CABMS Application Context & In-Memory Deterministic State
 * Implements strict isolation with resettable seed state
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  BrandConfig,
  BrandId,
  Customer,
  Job,
  JobStatus,
  Persona,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  TemplateSetting,
  WebsiteEnquiry,
  SampleAttachment,
} from '../types/cabms.ts';
import {
  INITIAL_BRANDS,
  INITIAL_CUSTOMERS,
  INITIAL_DEMO_CLOCK,
  INITIAL_ELECTRICAL_CERT,
  INITIAL_JOBS,
  INITIAL_JSA_FORM,
  INITIAL_SAMPLE_ATTACHMENTS,
  INITIAL_SMOKE_ALARM_CERT,
  INITIAL_TCA1_CERT,
  INITIAL_TCA2_CERT,
  INITIAL_TEMPLATES,
  INITIAL_WEBSITE_ENQUIRIES,
} from '../data/seedData.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  CompletionValidationResult,
} from '../utils/cabmsLogic.ts';

export type DemoScenario =
  | 'default'
  | 'doc_missing_signoff'
  | 'direct_to_invoice'
  | 'cabling_revisit'
  | 'unassigned_denied'
  | 'myob_failed'
  | 'myob_uncertain';

interface CabmsContextType {
  // Navigation & Persona
  persona: Persona;
  setPersona: (p: Persona) => void;
  activeBrandId: BrandId;
  setActiveBrandId: (b: BrandId) => void;
  activeBrand: BrandConfig;
  brands: Record<string, BrandConfig>;
  updateBrandConfig: (brand: BrandConfig) => void;
  addNewBrandProfile: (brand: BrandConfig) => void;

  // Demo Controls & Clock
  demoClock: string; // ISO string
  advanceClock: (hours: number) => void;
  resetDemo: () => void;
  activeScenario: DemoScenario;
  setActiveScenario: (s: DemoScenario) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  selectedJobId: string | null;
  setSelectedJobId: (id: string | null) => void;

  // Integrations Status (Simulated)
  myobConnection: {
    status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
    companyFile: string;
    companyId: string;
    lastSync: string;
    errorMessage?: string;
  };
  setMyobStatus: (status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED') => void;

  // Customers (MYOB write-through simulation)
  customers: Customer[];
  simulateCustomerWriteThrough: (
    customerDraft: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>,
    simulationOutcome?: 'SUCCESS' | 'FAILURE' | 'UNCERTAIN'
  ) => { success: boolean; customer?: Customer; error?: string; isDuplicate?: boolean; isUncertain?: boolean };
  reconcileUncertainCustomer: (customerId: string, confirmCreate: boolean) => void;

  // Jobs
  jobs: Job[];
  createJob: (jobData: Partial<Job>) => Job;
  updateJobStatus: (jobId: string, newStatus: JobStatus) => void;
  attemptCompleteJob: (jobId: string) => CompletionValidationResult;
  rescheduleJobAppointment: (jobId: string, newDate: string, newTime: string) => void;
  cancelJobAppointment: (jobId: string, reason: string) => void;

  // Form State
  jsaForms: Record<string, JsaFormData>;
  electricalCerts: Record<string, ElectricalCertData>;
  smokeAlarmCerts: Record<string, SmokeAlarmCertData>;
  tca1Certs: Record<string, Tca1CertData>;
  tca2Certs: Record<string, Tca2CertData>;
  updateJsaForm: (jobId: string, data: Partial<JsaFormData>) => void;
  signOffJsa: (jobId: string) => void;
  signOffSmokeAlarm: (jobId: string) => void;
  signOffElectrical: (jobId: string) => void;
  signOffTca1: (jobId: string) => void;
  signOffTca2: (jobId: string) => void;
  customerAckTca2: (jobId: string) => void;
  officeReviewTca2: (jobId: string) => void;

  // Sample Attachments
  sampleAttachments: SampleAttachment[];

  // Quotes & Acceptance
  quotes: Record<string, Job['quote']>;
  simulateQuoteAcceptance: (
    jobId: string,
    scenario: 'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  ) => { success: boolean; message: string };

  // Reviews & Deduplication
  triggerReviewRequest: (jobId: string, simulateFail?: boolean) => { success: boolean; message: string };
  reconcileReviewRequest: (jobId: string) => void;

  // Templates & Terms
  templates: TemplateSetting[];
  publishTemplateVersion: (templateId: string) => void;
  createTemplateDraft: (templateId: string, newContent: string) => void;

  // Website Handoff Queue
  websiteEnquiries: WebsiteEnquiry[];
  simulateWebsiteSubmission: (brandId: BrandId) => void;
  convertEnquiryToJob: (enquiryId: string) => { customerId: string; jobId: string };
  dismissEnquiry: (enquiryId: string) => void;

  // UI Toast / Feedback Banner
  demoNotification: { message: string; type: 'info' | 'success' | 'warning' | 'error' } | null;
  showDemoNotification: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  clearDemoNotification: () => void;
}

const CabmsContext = createContext<CabmsContextType | undefined>(undefined);

export const CabmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation & Personas
  const [persona, setPersona] = useState<Persona>('owner_admin');
  const [activeBrandId, setActiveBrandId] = useState<BrandId>('solarcell');
  const [brands, setBrands] = useState<Record<string, BrandConfig>>(INITIAL_BRANDS);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<string | null>('JOB-2026-101');
  const [activeScenario, setActiveScenario] = useState<DemoScenario>('default');

  // Clock
  const [demoClock, setDemoClock] = useState<string>(INITIAL_DEMO_CLOCK);

  // Simulated MYOB Connection
  const [myobConnection, setMyobConnection] = useState<{
    status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
    companyFile: string;
    companyId: string;
    lastSync: string;
    errorMessage?: string;
  }>({
    status: 'CONNECTED',
    companyFile: 'CABMS Consolidated Holdings Pty Ltd (Production AccountRight File)',
    companyId: 'MYOB-CO-9921',
    lastSync: '2026-11-02 08:45 UTC+10',
  });

  // State Collections
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [templates, setTemplates] = useState<TemplateSetting[]>(INITIAL_TEMPLATES);
  const [websiteEnquiries, setWebsiteEnquiries] = useState<WebsiteEnquiry[]>(INITIAL_WEBSITE_ENQUIRIES);
  const [sampleAttachments] = useState<SampleAttachment[]>(INITIAL_SAMPLE_ATTACHMENTS);

  // Compliance Forms per Job
  const [jsaForms, setJsaForms] = useState<Record<string, JsaFormData>>({
    'JOB-2026-101': { ...INITIAL_JSA_FORM },
    'JOB-2026-103': { ...INITIAL_JSA_FORM, jobReference: 'JOB-2026-103', signedOff: true },
    'JOB-2026-104': { ...INITIAL_JSA_FORM, jobReference: 'JOB-2026-104', signedOff: true },
  });

  const [electricalCerts, setElectricalCerts] = useState<Record<string, ElectricalCertData>>({
    'JOB-2026-103': { ...INITIAL_ELECTRICAL_CERT },
  });

  const [smokeAlarmCerts, setSmokeAlarmCerts] = useState<Record<string, SmokeAlarmCertData>>({
    'JOB-2026-101': { ...INITIAL_SMOKE_ALARM_CERT },
  });

  const [tca1Certs, setTca1Certs] = useState<Record<string, Tca1CertData>>({
    'JOB-2026-104': { ...INITIAL_TCA1_CERT },
  });

  const [tca2Certs, setTca2Certs] = useState<Record<string, Tca2CertData>>({
    'JOB-2026-104': { ...INITIAL_TCA2_CERT },
  });

  // Notifications
  const [demoNotification, setDemoNotification] = useState<{
    message: string;
    type: 'info' | 'success' | 'warning' | 'error';
  } | null>(null);

  const showDemoNotification = (message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setDemoNotification({ message, type });
    setTimeout(() => {
      setDemoNotification(null);
    }, 6000);
  };

  const clearDemoNotification = () => setDemoNotification(null);

  // Reset entire demo to seed state
  const resetDemo = () => {
    setPersona('owner_admin');
    setActiveBrandId('solarcell');
    setBrands(INITIAL_BRANDS);
    setDemoClock(INITIAL_DEMO_CLOCK);
    setMyobConnection({
      status: 'CONNECTED',
      companyFile: 'CABMS Consolidated Holdings Pty Ltd (Production AccountRight File)',
      companyId: 'MYOB-CO-9921',
      lastSync: '2026-11-02 08:45 UTC+10',
    });
    setCustomers(INITIAL_CUSTOMERS);
    setJobs(INITIAL_JOBS);
    setTemplates(INITIAL_TEMPLATES);
    setWebsiteEnquiries(INITIAL_WEBSITE_ENQUIRIES);
    setJsaForms({
      'JOB-2026-101': { ...INITIAL_JSA_FORM },
      'JOB-2026-103': { ...INITIAL_JSA_FORM, jobReference: 'JOB-2026-103', signedOff: true },
      'JOB-2026-104': { ...INITIAL_JSA_FORM, jobReference: 'JOB-2026-104', signedOff: true },
    });
    setElectricalCerts({ 'JOB-2026-103': { ...INITIAL_ELECTRICAL_CERT } });
    setSmokeAlarmCerts({ 'JOB-2026-101': { ...INITIAL_SMOKE_ALARM_CERT } });
    setTca1Certs({ 'JOB-2026-104': { ...INITIAL_TCA1_CERT } });
    setTca2Certs({ 'JOB-2026-104': { ...INITIAL_TCA2_CERT } });
    setSelectedJobId('JOB-2026-101');
    setActiveTab('dashboard');
    setActiveScenario('default');
    showDemoNotification('Demo restored to clean initial seed state.', 'success');
  };

  // Clock Advancement
  const advanceClock = (hours: number) => {
    const current = new Date(demoClock);
    current.setHours(current.getHours() + hours);
    const newClock = current.toISOString();
    setDemoClock(newClock);
    showDemoNotification(`Demo business clock advanced by ${hours} hr(s) to ${current.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`, 'info');
  };

  // Switch scenario helper
  useEffect(() => {
    if (activeScenario === 'doc_missing_signoff') {
      setSelectedJobId('JOB-2026-101');
      setActiveTab('jobs');
      // Ensure JSA is unsigned
      setJsaForms(prev => ({
        ...prev,
        'JOB-2026-101': { ...prev['JOB-2026-101'], signedOff: false },
      }));
      showDemoNotification('Scenario: Documentation Job with JSA missing sign-off loaded.', 'info');
    } else if (activeScenario === 'direct_to_invoice') {
      setSelectedJobId('JOB-2026-102');
      setActiveTab('jobs');
      showDemoNotification('Scenario: Direct-to-invoice service loaded (no forms required).', 'info');
    } else if (activeScenario === 'cabling_revisit') {
      setSelectedJobId('JOB-2026-104');
      setActiveTab('jobs');
      showDemoNotification('Scenario: TCA1/TCA2 Cabling Non-Compliance & Revisit loaded.', 'warning');
    } else if (activeScenario === 'unassigned_denied') {
      setSelectedJobId('JOB-2026-105');
      setPersona('technician');
      setActiveTab('jobs');
      showDemoNotification('Scenario: Technician persona selected on unassigned job (Denied view active).', 'error');
    } else if (activeScenario === 'myob_failed') {
      setMyobConnection(prev => ({
        ...prev,
        status: 'FAILED',
        errorMessage: 'MYOB API Connection timed out: Error 504 Gateway Timeout on company file #MYOB-CO-9921.',
      }));
      showDemoNotification('Scenario: MYOB Connection Failure simulated.', 'error');
    }
  }, [activeScenario]);

  // MYOB Customer Write-Through Simulation
  const simulateCustomerWriteThrough = (
    draft: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>,
    simulationOutcome: 'SUCCESS' | 'FAILURE' | 'UNCERTAIN' = 'SUCCESS'
  ) => {
    // 1. Check for duplicates
    const dupCheck = checkCustomerDuplicate(draft, customers);
    if (dupCheck.isDuplicate && dupCheck.matchedCustomer) {
      showDemoNotification(
        `DUPLICATE WARNING: A customer with matching ${dupCheck.field} already exists (${dupCheck.matchedCustomer.name} - ${dupCheck.matchedCustomer.myobCustomerId}).`,
        'warning'
      );
    }

    if (myobConnection.status === 'FAILED' || simulationOutcome === 'FAILURE') {
      // Create recoverable draft
      const draftCustomer: Customer = {
        ...draft,
        id: `CUSTOMER-DRAFT-${Date.now().toString().slice(-4)}`,
        myobCustomerId: 'PENDING_MYOB_SYNC',
        syncStatus: 'FAILED',
        createdAt: demoClock.slice(0, 10),
        isRecoverableDraft: true,
      };
      setCustomers(prev => [draftCustomer, ...prev]);
      showDemoNotification('MYOB Write-through simulation: Connection failed. Saved as recoverable local draft.', 'error');
      return { success: false, customer: draftCustomer, error: 'Simulated MYOB API connection error.' };
    }

    if (simulationOutcome === 'UNCERTAIN') {
      const uncertainCustomer: Customer = {
        ...draft,
        id: `CUSTOMER-UNCERTAIN-${Date.now().toString().slice(-4)}`,
        myobCustomerId: 'AWAITING_RECONCILIATION',
        syncStatus: 'UNCERTAIN',
        createdAt: demoClock.slice(0, 10),
        isRecoverableDraft: true,
      };
      setCustomers(prev => [uncertainCustomer, ...prev]);
      showDemoNotification('MYOB Write-through simulation: Uncertain response. Reconciliation required to prevent duplicate master.', 'warning');
      return { success: false, customer: uncertainCustomer, isUncertain: true };
    }

    // Success outcome: assign fake MYOB reference
    const nextIdNum = customers.length + 1;
    const newCustomer: Customer = {
      ...draft,
      id: `CUSTOMER-DEMO-00${nextIdNum}`,
      myobCustomerId: `MYOB-DEMO-00${nextIdNum}`,
      syncStatus: 'SYNCED',
      createdAt: demoClock.slice(0, 10),
      isRecoverableDraft: false,
    };

    setCustomers(prev => [newCustomer, ...prev]);
    showDemoNotification(
      `MYOB Write-through successful: Created customer in MYOB with ID ${newCustomer.myobCustomerId}.`,
      'success'
    );
    return { success: true, customer: newCustomer, isDuplicate: dupCheck.isDuplicate };
  };

  const reconcileUncertainCustomer = (customerId: string, confirmCreate: boolean) => {
    setCustomers(prev =>
      prev.map(c => {
        if (c.id === customerId) {
          if (confirmCreate) {
            return {
              ...c,
              myobCustomerId: `MYOB-RECONCILED-${c.id.slice(-4)}`,
              syncStatus: 'SYNCED',
              isRecoverableDraft: false,
            };
          } else {
            return {
              ...c,
              syncStatus: 'FAILED',
              notes: 'Reconciliation discarded duplicate entry.',
            };
          }
        }
        return c;
      })
    );
    showDemoNotification(
      confirmCreate ? 'Customer record reconciled and linked to MYOB.' : 'Duplicate uncertain entry cancelled.',
      'info'
    );
  };

  // Job Actions
  const createJob = (jobData: Partial<Job>): Job => {
    const nextId = `JOB-2026-${100 + jobs.length + 1}`;
    const newJob: Job = {
      id: nextId,
      brandId: jobData.brandId || activeBrandId,
      customerId: jobData.customerId || customers[0].id,
      title: jobData.title || 'New Service Request',
      jobType: jobData.jobType || 'General Maintenance',
      siteAddress: jobData.siteAddress || '[Fictional] Site Address',
      siteContact: jobData.siteContact || 'Contact Person',
      sitePhone: jobData.sitePhone || '0400 000 000',
      description: jobData.description || 'Service call details',
      status: 'SCHEDULED',
      assignedTechId: jobData.assignedTechId || 'TECH-001',
      assignedTechName: jobData.assignedTechName || 'Dave Miller',
      scheduledDate: jobData.scheduledDate || demoClock.slice(0, 10),
      scheduledTime: jobData.scheduledTime || '09:00',
      estimatedDurationHours: jobData.estimatedDurationHours || 2,
      isDirectToInvoice: jobData.isDirectToInvoice || false,
      formsRequired: jobData.formsRequired || ['JSA'],
      invoice: {
        id: `INV-2026-${100 + jobs.length + 1}`,
        externalMyobRef: `MYOB-INV-${77100 + jobs.length + 1}`,
        amount: 350.0,
        status: 'DRAFT',
        issuedDate: demoClock.slice(0, 10),
        dueDate: demoClock.slice(0, 10),
        reconciliationRequired: false,
      },
      reviewRequest: {
        status: 'NOT_SENT',
        reviewLink: brands[jobData.brandId || activeBrandId]?.reviewUrlPlaceholder || '',
        brandName: brands[jobData.brandId || activeBrandId]?.name || 'CABMS Brand',
        channel: 'SMS_AND_EMAIL_SIMULATED',
        history: [],
      },
      reminders: [
        {
          id: `REM-${nextId}-1`,
          scheduledFor: `${jobData.scheduledDate || demoClock.slice(0, 10)} 07:00`,
          type: 'REMINDER_2HR',
          channel: 'SMS_AND_EMAIL_SIMULATED',
          suppressed: false,
          delivered: false,
        },
      ],
      unresolvedWarnings: [],
    };

    setJobs(prev => [newJob, ...prev]);
    showDemoNotification(`Job ${newJob.id} scheduled for ${newJob.assignedTechName}.`, 'success');
    return newJob;
  };

  const updateJobStatus = (jobId: string, newStatus: JobStatus) => {
    setJobs(prev =>
      prev.map(j => (j.id === jobId ? { ...j, status: newStatus } : j))
    );
    showDemoNotification(`Job ${jobId} status updated to ${newStatus}.`, 'info');
  };

  const attemptCompleteJob = (jobId: string): CompletionValidationResult => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return { canComplete: false, missingRequirements: ['Job not found'], warnings: [], isDirectToInvoice: false };
    }

    const forms = {
      jsa: jsaForms[jobId],
      electrical: electricalCerts[jobId],
      smokeAlarm: smokeAlarmCerts[jobId],
      tca1: tca1Certs[jobId],
      tca2: tca2Certs[jobId],
    };

    const validation = validateJobCompletion(job, forms);

    if (validation.canComplete) {
      // Mark completed
      setJobs(prev =>
        prev.map(j =>
          j.id === jobId
            ? {
                ...j,
                status: 'COMPLETED',
                completedAt: demoClock,
                completionNotes: 'All applicable synthetic demo completion requirements satisfied.',
              }
            : j
        )
      );
      showDemoNotification(`SUCCESS: Job ${jobId} marked COMPLETED. Synthetic requirements satisfied.`, 'success');
    } else {
      // FAILED attempt leaves status unchanged per Section G!
      showDemoNotification(
        `COMPLETION BLOCKED: ${validation.missingRequirements.length} required items missing. Status remains unchanged.`,
        'error'
      );
    }

    return validation;
  };

  const rescheduleJobAppointment = (jobId: string, newDate: string, newTime: string) => {
    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId) {
          const updatedReminders = suppressOldReminders(
            j,
            `Rescheduled from ${j.scheduledDate} ${j.scheduledTime} to ${newDate} ${newTime}`,
            demoClock
          );

          // Add new 2hr reminder
          const newReminder = {
            id: `REM-${jobId}-${Date.now().toString().slice(-4)}`,
            scheduledFor: `${newDate} ${newTime}`,
            type: 'REMINDER_2HR' as const,
            channel: 'SMS_AND_EMAIL_SIMULATED' as const,
            suppressed: false,
            delivered: false,
          };

          return {
            ...j,
            scheduledDate: newDate,
            scheduledTime: newTime,
            reminders: [...updatedReminders, newReminder],
          };
        }
        return j;
      })
    );
    showDemoNotification(
      `Appointment rescheduled to ${newDate} at ${newTime}. Stale reminders suppressed.`,
      'info'
    );
  };

  const cancelJobAppointment = (jobId: string, reason: string) => {
    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId) {
          const updatedReminders = suppressOldReminders(
            j,
            `Appointment cancelled: ${reason}`,
            demoClock
          );
          return {
            ...j,
            status: 'CANCELLED',
            reminders: updatedReminders,
          };
        }
        return j;
      })
    );
    showDemoNotification(`Appointment for Job ${jobId} cancelled. Stale reminders suppressed.`, 'warning');
  };

  // Form Updates
  const updateJsaForm = (jobId: string, data: Partial<JsaFormData>) => {
    setJsaForms(prev => ({
      ...prev,
      [jobId]: { ...prev[jobId], ...data },
    }));
  };

  const signOffJsa = (jobId: string) => {
    setJsaForms(prev => {
      const existing = prev[jobId] || { ...INITIAL_JSA_FORM, jobReference: jobId };
      return {
        ...prev,
        [jobId]: {
          ...existing,
          signedOff: true,
          signedByTechName: 'Dave Miller (Lead Electrician)',
          signedTimestamp: demoClock.replace('T', ' ').slice(0, 16),
        },
      };
    });
    showDemoNotification(`JSA signed off with DEMO signature mark for Job ${jobId}.`, 'success');
  };

  const signOffSmokeAlarm = (jobId: string) => {
    setSmokeAlarmCerts(prev => {
      const existing = prev[jobId] || { ...INITIAL_SMOKE_ALARM_CERT, jobReference: jobId };
      return {
        ...prev,
        [jobId]: {
          ...existing,
          signedOff: true,
          signedByTechName: 'Dave Miller',
          signedTimestamp: demoClock.replace('T', ' ').slice(0, 16),
        },
      };
    });
    showDemoNotification(`Smoke Alarm Certificate signed off with DEMO mark for Job ${jobId}.`, 'success');
  };

  const signOffElectrical = (jobId: string) => {
    setElectricalCerts(prev => {
      const existing = prev[jobId] || { ...INITIAL_ELECTRICAL_CERT, jobReference: jobId };
      return {
        ...prev,
        [jobId]: {
          ...existing,
          signedOff: true,
          signedByTechName: 'Dave Miller',
          signedTimestamp: demoClock.replace('T', ' ').slice(0, 16),
        },
      };
    });
    showDemoNotification(`Electrical Certificate Part A signed off for Job ${jobId}. Part B warning retained.`, 'warning');
  };

  const signOffTca1 = (jobId: string) => {
    setTca1Certs(prev => {
      const existing = prev[jobId] || { ...INITIAL_TCA1_CERT, jobReference: jobId };
      return {
        ...prev,
        [jobId]: {
          ...existing,
          signedOff: true,
          signedByTechName: 'Dave Miller',
          signedTimestamp: demoClock.replace('T', ' ').slice(0, 16),
        },
      };
    });
    showDemoNotification(`TCA1 Cabling Compliance Certificate signed off for Job ${jobId}.`, 'success');
  };

  const signOffTca2 = (jobId: string) => {
    setTca2Certs(prev => {
      const existing = prev[jobId] || { ...INITIAL_TCA2_CERT, jobReference: jobId };
      return {
        ...prev,
        [jobId]: {
          ...existing,
          signedOff: true,
          signedByTechName: 'Dave Miller',
          signedTimestamp: demoClock.replace('T', ' ').slice(0, 16),
        },
      };
    });
    showDemoNotification(`TCA2 Cabling Defect Report signed off for Job ${jobId}. Non-compliance recorded.`, 'warning');
  };

  const customerAckTca2 = (jobId: string) => {
    setTca2Certs(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        customerAcknowledged: true,
        customerAckTimestamp: demoClock.replace('T', ' ').slice(0, 16),
      },
    }));
    showDemoNotification(`Customer acknowledgement captured for TCA2 Defect on Job ${jobId}.`, 'info');
  };

  const officeReviewTca2 = (jobId: string) => {
    setTca2Certs(prev => ({
      ...prev,
      [jobId]: {
        ...prev[jobId],
        officeReviewCompleted: true,
        reviewedByOfficeStaff: 'Emma Wilson (Office Administrator)',
        officeReviewTimestamp: demoClock.replace('T', ' ').slice(0, 16),
      },
    }));
    showDemoNotification(`TCA2 Office Review completed. Rectification quote queued.`, 'success');
  };

  // Quotes & Acceptance
  const simulateQuoteAcceptance = (
    jobId: string,
    scenario: 'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  ) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job || !job.quote) {
      return { success: false, message: 'Quote not found for this job.' };
    }

    if (scenario === 'invalid') {
      return { success: false, message: 'Invalid or broken quotation acceptance token.' };
    }
    if (scenario === 'expired') {
      return { success: false, message: 'This quotation link has expired (14-day validity exceeded).' };
    }
    if (scenario === 'revoked') {
      return { success: false, message: 'This quotation has been revoked by CABMS administration.' };
    }
    if (scenario === 'superseded') {
      return { success: false, message: 'This quotation has been superseded by a newer revision.' };
    }
    if (scenario === 'already_accepted' || job.quote.acceptanceStatus === 'ACCEPTED') {
      return { success: false, message: `Quotation was already accepted on ${job.quote.acceptedAt}. Duplicate acceptance rejected.` };
    }

    // Valid acceptance
    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId && j.quote) {
          const acceptedTimestamp = demoClock.replace('T', ' ').slice(0, 16);
          const historyEntry = {
            timestamp: acceptedTimestamp,
            action: 'Accepted via Customer Online Portal',
            actor: job.siteContact,
            notes: 'Customer accepted Terms snapshot v2.4 (Simulated)',
          };

          return {
            ...j,
            quote: {
              ...j.quote,
              acceptanceStatus: 'ACCEPTED',
              acceptedAt: acceptedTimestamp,
              acceptedByName: job.siteContact,
              acceptanceHistory: [...j.quote.acceptanceHistory, historyEntry],
            },
          };
        }
        return j;
      })
    );

    showDemoNotification(`Quotation accepted by customer. Exact terms snapshot preserved.`, 'success');
    return { success: true, message: 'Quotation successfully accepted!' };
  };

  // Reviews Deduplication
  const triggerReviewRequest = (jobId: string, simulateFail = false) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return { success: false, message: 'Job not found' };
    }

    const dedup = deduplicateReviewRequest(job, () => {
      if (simulateFail) {
        return { success: false, reviewUrl: '' };
      }
      return { success: true, reviewUrl: brands[job.brandId]?.reviewUrlPlaceholder || 'https://demo.reviews.invalid' };
    });

    if (!dedup.allowed) {
      showDemoNotification(`REVIEW BLOCKED: ${dedup.reason}`, 'warning');
      return { success: false, message: dedup.reason || 'Not allowed' };
    }

    if (simulateFail) {
      setJobs(prev =>
        prev.map(j =>
          j.id === jobId
            ? {
                ...j,
                reviewRequest: {
                  ...j.reviewRequest,
                  status: 'UNCERTAIN',
                  uncertainReconciliationNeeded: true,
                  history: [
                    ...j.reviewRequest.history,
                    {
                      timestamp: demoClock.replace('T', ' ').slice(0, 16),
                      event: 'Simulated dispatch failed / timed out',
                      status: 'UNCERTAIN',
                    },
                  ],
                },
              }
            : j
        )
      );
      showDemoNotification('Review request dispatch failed (uncertain remote outcome). Reconciliation required.', 'error');
      return { success: false, message: 'Dispatch uncertain. Reconcile before retrying.' };
    }

    // Success
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? {
              ...j,
              reviewRequest: {
                ...j.reviewRequest,
                status: 'SENT',
                sentTimestamp: demoClock.replace('T', ' ').slice(0, 16),
                reviewLink: brands[job.brandId]?.reviewUrlPlaceholder || '',
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: demoClock.replace('T', ' ').slice(0, 16),
                    event: `Automated SMS/Email sent to customer for ${brands[job.brandId]?.name}`,
                    status: 'SENT',
                  },
                ],
              },
            }
          : j
      )
    );

    showDemoNotification(`Google Review request sent to ${job.siteContact} (${brands[job.brandId]?.name}).`, 'success');
    return { success: true, message: 'Review request sent!' };
  };

  const reconcileReviewRequest = (jobId: string) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? {
              ...j,
              reviewRequest: {
                ...j.reviewRequest,
                status: 'SENT',
                uncertainReconciliationNeeded: false,
                sentTimestamp: demoClock.replace('T', ' ').slice(0, 16),
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: demoClock.replace('T', ' ').slice(0, 16),
                    event: 'Reconciled manual check: delivery confirmed in mock log.',
                    status: 'RECONCILED',
                  },
                ],
              },
            }
          : j
      )
    );
    showDemoNotification(`Review status for Job ${jobId} reconciled to SENT.`, 'info');
  };

  // Templates
  const publishTemplateVersion = (templateId: string) => {
    // Check permission
    const access = verifyPersonaAccess(persona, 'template_publishing');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }

    setTemplates(prev =>
      prev.map(t =>
        t.id === templateId
          ? {
              ...t,
              status: 'PUBLISHED',
              updatedAt: demoClock.replace('T', ' ').slice(0, 16),
              updatedBy: persona.toUpperCase(),
            }
          : t
      )
    );
    showDemoNotification(`Template ${templateId} published. Existing signed documents retain historical snapshots.`, 'success');
  };

  const createTemplateDraft = (templateId: string, newContent: string) => {
    setTemplates(prev =>
      prev.map(t =>
        t.id === templateId
          ? {
              ...t,
              status: 'DRAFT',
              content: newContent,
              updatedAt: demoClock.replace('T', ' ').slice(0, 16),
            }
          : t
      )
    );
    showDemoNotification('Template draft saved. Pending review before publication.', 'info');
  };

  // Website Enquiry Simulation (Section J)
  const simulateWebsiteSubmission = (brandId: BrandId) => {
    const brandName = brands[brandId]?.name || 'CABMS Brand';
    const newEnquiry: WebsiteEnquiry = {
      id: `ENQ-2026-${300 + websiteEnquiries.length + 1}`,
      submissionDate: demoClock.replace('T', ' ').slice(0, 16),
      sourceWebsite: `${brandName} Public Online Form`,
      brandId,
      customerName: 'Marcus Vance',
      email: 'marcus.v@vancelogistics.example.invalid',
      phone: '0400 000 003',
      address: '[Fictional] 88 Distribution Court, Yatala QLD 4207',
      serviceRequested: 'Urgent Security Camera Cabling Remediation Quotation',
      notes: 'Customer submitted follow-up request via website contact form following onsite defect notice.',
      status: 'PENDING_REVIEW',
      matchedExistingCustomerId: 'CUSTOMER-DEMO-003',
    };

    setWebsiteEnquiries(prev => [newEnquiry, ...prev]);
    showDemoNotification(`Simulated website submission received for ${brandName}. Queued in pending inbox.`, 'info');
  };

  const convertEnquiryToJob = (enquiryId: string) => {
    const enq = websiteEnquiries.find(e => e.id === enquiryId);
    if (!enq) return { customerId: '', jobId: '' };

    // Check if matched customer or create draft
    let customerId = enq.matchedExistingCustomerId;
    if (!customerId) {
      const newCust = simulateCustomerWriteThrough({
        name: enq.customerName,
        contactPerson: enq.customerName,
        email: enq.email,
        phone: enq.phone,
        billingAddress: enq.address,
        brandAffiliations: [enq.brandId],
        notes: `Converted from website enquiry ${enquiryId}`,
      });
      customerId = newCust.customer?.id || 'CUSTOMER-DEMO-001';
    }

    const newJob = createJob({
      brandId: enq.brandId,
      customerId,
      title: `${enq.serviceRequested}`,
      siteAddress: enq.address,
      siteContact: enq.customerName,
      sitePhone: enq.phone,
      description: `Originating from website enquiry ${enquiryId}: ${enq.notes}`,
      formsRequired: ['JSA', 'TCA1'],
    });

    setWebsiteEnquiries(prev =>
      prev.map(e =>
        e.id === enquiryId
          ? { ...e, status: 'CONVERTED_TO_JOB', convertedJobId: newJob.id }
          : e
      )
    );

    showDemoNotification(`Enquiry ${enquiryId} converted to Job ${newJob.id}.`, 'success');
    return { customerId, jobId: newJob.id };
  };

  const dismissEnquiry = (enquiryId: string) => {
    setWebsiteEnquiries(prev =>
      prev.map(e => (e.id === enquiryId ? { ...e, status: 'DISMISSED' } : e))
    );
    showDemoNotification(`Enquiry ${enquiryId} dismissed.`, 'info');
  };

  const updateBrandConfig = (updated: BrandConfig) => {
    setBrands(prev => ({
      ...prev,
      [updated.id]: updated,
    }));
    showDemoNotification(`Brand profile "${updated.name}" updated.`, 'success');
  };

  const addNewBrandProfile = (newBrand: BrandConfig) => {
    setBrands(prev => ({
      ...prev,
      [newBrand.id]: newBrand,
    }));
    showDemoNotification(`New configurable profile "${newBrand.name}" added for demonstration.`, 'success');
  };

  return (
    <CabmsContext.Provider
      value={{
        persona,
        setPersona,
        activeBrandId,
        setActiveBrandId,
        activeBrand: brands[activeBrandId] || INITIAL_BRANDS.solarcell,
        brands,
        updateBrandConfig,
        addNewBrandProfile,
        demoClock,
        advanceClock,
        resetDemo,
        activeScenario,
        setActiveScenario,
        activeTab,
        setActiveTab,
        selectedJobId,
        setSelectedJobId,
        myobConnection,
        setMyobStatus: (status) =>
          setMyobConnection(prev => ({
            ...prev,
            status,
            errorMessage: status === 'FAILED' ? 'Simulated MYOB Connection Error 504' : undefined,
          })),
        customers,
        simulateCustomerWriteThrough,
        reconcileUncertainCustomer,
        jobs,
        createJob,
        updateJobStatus,
        attemptCompleteJob,
        rescheduleJobAppointment,
        cancelJobAppointment,
        jsaForms,
        electricalCerts,
        smokeAlarmCerts,
        tca1Certs,
        tca2Certs,
        updateJsaForm,
        signOffJsa,
        signOffSmokeAlarm,
        signOffElectrical,
        signOffTca1,
        signOffTca2,
        customerAckTca2,
        officeReviewTca2,
        sampleAttachments,
        quotes: {},
        simulateQuoteAcceptance,
        triggerReviewRequest,
        reconcileReviewRequest,
        templates,
        publishTemplateVersion,
        createTemplateDraft,
        websiteEnquiries,
        simulateWebsiteSubmission,
        convertEnquiryToJob,
        dismissEnquiry,
        demoNotification,
        showDemoNotification,
        clearDemoNotification,
      }}
    >
      {children}
    </CabmsContext.Provider>
  );
};

export const useCabms = () => {
  const context = useContext(CabmsContext);
  if (!context) {
    throw new Error('useCabms must be used within a CabmsProvider');
  }
  return context;
};
