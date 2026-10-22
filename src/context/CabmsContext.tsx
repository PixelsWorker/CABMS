/**
 * CABMS Application Context & In-Memory Deterministic State
 * Implements strict isolation with resettable seed state and full workflow continuity.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  BrandConfig,
  BrandId,
  Customer,
  Job,
  JobStatus,
  Persona,
  JobTypeConfig,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  TemplateSetting,
  WebsiteEnquiry,
  SampleAttachment,
  Quote,
  Invoice,
  ScheduledReminder,
  CertificateDeliveryRecord,
} from '../types/cabms.ts';
import {
  INITIAL_BRANDS,
  INITIAL_CUSTOMERS,
  INITIAL_DEMO_CLOCK,
  INITIAL_ELECTRICAL_CERT,
  INITIAL_JOBS,
  INITIAL_JOB_TYPES,
  INITIAL_JSA_FORM,
  INITIAL_SAMPLE_ATTACHMENTS,
  INITIAL_SMOKE_ALARM_CERT,
  INITIAL_TCA1_CERT,
  INITIAL_TCA2_CERT,
  INITIAL_TECHNICIANS,
  INITIAL_TEMPLATES,
  INITIAL_WEBSITE_ENQUIRIES,
} from '../data/seedData.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  calculateReminderDueTime,
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
  technicians: typeof INITIAL_TECHNICIANS;
  updateBrandConfig: (brand: BrandConfig) => void;
  addNewBrandProfile: (brand: BrandConfig) => void;

  // Session & Demo Sign-in Simulation (G00-036)
  isSimulatedSignedIn: boolean;
  simulateSignIn: (role: Persona) => void;
  simulateSignOut: () => void;

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

  // Integrations Status (Simulated MYOB Business)
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
    simulationOutcome?: 'SUCCESS' | 'FAILURE' | 'UNCERTAIN',
    forceDistinct?: boolean
  ) => {
    success: boolean;
    customer?: Customer;
    error?: string;
    isDuplicate?: boolean;
    matchedCustomer?: Customer;
    isUncertain?: boolean;
  };
  reconcileUncertainCustomer: (customerId: string, confirmCreate: boolean) => void;
  retryFailedCustomerSync: (customerId: string) => void;

  // Job Types
  jobTypes: JobTypeConfig[];

  // Jobs
  jobs: Job[];
  createJob: (jobData: Partial<Job>) => Job;
  updateJobStatus: (jobId: string, newStatus: JobStatus) => void;
  attemptCompleteJob: (jobId: string) => CompletionValidationResult;
  rescheduleJobAppointment: (jobId: string, newDate: string, newTime: string) => void;
  cancelJobAppointment: (jobId: string, reason: string) => void;
  cancelWholeJob: (jobId: string, reason: string) => void;
  reopenCancelledJob: (jobId: string) => void;

  // Independent Form State per Job (G00-002, G00-005)
  getOrCreateJsa: (jobId: string) => JsaFormData;
  getOrCreateElectrical: (jobId: string) => ElectricalCertData;
  getOrCreateSmokeAlarm: (jobId: string) => SmokeAlarmCertData;
  getOrCreateTca1: (jobId: string) => Tca1CertData;
  getOrCreateTca2: (jobId: string) => Tca2CertData;
  updateJsaForm: (jobId: string, data: Partial<JsaFormData>) => void;
  updateElectricalForm: (jobId: string, data: Partial<ElectricalCertData>) => void;
  updateSmokeAlarmForm: (jobId: string, data: Partial<SmokeAlarmCertData>) => void;
  updateTca1Form: (jobId: string, data: Partial<Tca1CertData>) => void;
  updateTca2Form: (jobId: string, data: Partial<Tca2CertData>) => void;
  signOffJsa: (jobId: string) => void;
  signOffSmokeAlarm: (jobId: string) => void;
  signOffElectrical: (jobId: string) => void;
  signOffTca1: (jobId: string) => void;
  signOffTca2: (jobId: string) => void;
  customerAckTca2: (jobId: string) => void;
  officeReviewTca2: (jobId: string) => void;

  // Sample Attachments & Linkage (G00-027)
  sampleAttachments: SampleAttachment[];
  attachSampleToJobForm: (jobId: string, formType: string, sampleId: string) => void;
  removeSampleFromJobForm: (jobId: string, formType: string, sampleId: string) => void;

  // Quotes & Acceptance (G00-006, G00-016, G00-017)
  prepareQuoteForJob: (
    jobId: string,
    title: string,
    lineItems: { id: string; description: string; quantity: number; unitPrice: number; total: number }[]
  ) => Quote;
  simulateQuoteAcceptance: (
    jobId: string,
    scenario: 'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  ) => { success: boolean; message: string };

  // Invoices (G00-018)
  prepareInvoiceForJob: (jobId: string, amount: number) => void;
  reconcileInvoiceSync: (jobId: string, outcome: 'SUCCESS' | 'FAIL') => void;

  // Reviews & Deduplication (G00-021)
  triggerReviewRequest: (jobId: string, simulateFail?: boolean) => { success: boolean; message: string };
  reconcileReviewRequest: (jobId: string) => void;

  // Certificate Delivery Flow (G00-022)
  certificateDeliveries: CertificateDeliveryRecord[];
  sendCertificateEmail: (jobId: string, formType: string, simulateFail?: boolean) => { success: boolean; message: string };
  retryCertificateDelivery: (deliveryId: string) => void;

  // Templates & Version Lifecycle (G00-007, G00-025, G00-026)
  templates: TemplateSetting[];
  publishTemplateVersion: (templateId: string) => void;
  createTemplateDraftRevision: (templateId: string, newContent: string) => void;
  submitTemplateForReview: (templateId: string) => void;
  updateJobTypeConfig: (
    typeId: string,
    formsRequired: ('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[],
    isDirectToInvoice: boolean
  ) => void;

  // Website Handoff Queue (G00-011)
  websiteEnquiries: WebsiteEnquiry[];
  simulateWebsiteSubmission: (brandId: BrandId) => void;
  convertEnquiryToJob: (
    enquiryId: string,
    matchedCustomerId?: string,
    jobTypeId?: string
  ) => { customerId: string; jobId: string; unresolvedWarning?: string };
  dismissEnquiry: (enquiryId: string) => void;

  // UI Toast / Feedback Banner
  demoNotification: { message: string; type: 'info' | 'success' | 'warning' | 'error' } | null;
  showDemoNotification: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  clearDemoNotification: () => void;
}

const CabmsContext = createContext<CabmsContextType | undefined>(undefined);

// Deterministic sequential ID generator (G00-030)
let seqCounters = {
  customer: 10,
  job: 110,
  quote: 50,
  invoice: 100,
  reminder: 200,
  enquiry: 310,
  revision: 10,
};

export const CabmsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Navigation & Personas
  const [persona, setPersona] = useState<Persona>('owner_admin');
  const [activeBrandId, setActiveBrandId] = useState<BrandId>('solarcell');
  const [brands, setBrands] = useState<Record<string, BrandConfig>>(INITIAL_BRANDS);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<string | null>('JOB-2026-101');
  const [activeScenario, setActiveScenario] = useState<DemoScenario>('default');
  const [isSimulatedSignedIn, setIsSimulatedSignedIn] = useState(true);

  // Clock
  const [demoClock, setDemoClock] = useState<string>(INITIAL_DEMO_CLOCK);

  // Simulated MYOB Business Connection (G00-035)
  const [myobConnection, setMyobConnection] = useState<{
    status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED';
    companyFile: string;
    companyId: string;
    lastSync: string;
    errorMessage?: string;
  }>({
    status: 'CONNECTED',
    companyFile: 'MYOB Business — Client-Reported Shared Company File (Simulated)',
    companyId: 'MYOB-CO-9921',
    lastSync: '2026-11-02 08:45 UTC+10',
  });

  // State Collections
  const [customers, setCustomers] = useState<Customer[]>(INITIAL_CUSTOMERS);
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [jobTypes, setJobTypes] = useState<JobTypeConfig[]>(INITIAL_JOB_TYPES);
  const [templates, setTemplates] = useState<TemplateSetting[]>(INITIAL_TEMPLATES);
  const [websiteEnquiries, setWebsiteEnquiries] = useState<WebsiteEnquiry[]>(INITIAL_WEBSITE_ENQUIRIES);
  const [sampleAttachments] = useState<SampleAttachment[]>(INITIAL_SAMPLE_ATTACHMENTS);

  // Compliance Forms per Job (G00-005: job-owned instances)
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

  // Certificate Delivery Simulation Records (G00-022)
  const [certificateDeliveries, setCertificateDeliveries] = useState<CertificateDeliveryRecord[]>([]);

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

  // Reset entire demo to seed state (G00-030)
  const resetDemo = () => {
    seqCounters = { customer: 10, job: 110, quote: 50, invoice: 100, reminder: 200, enquiry: 310, revision: 10 };
    setPersona('owner_admin');
    setActiveBrandId('solarcell');
    setBrands(INITIAL_BRANDS);
    setJobTypes(INITIAL_JOB_TYPES);
    setDemoClock(INITIAL_DEMO_CLOCK);
    setIsSimulatedSignedIn(true);
    setMyobConnection({
      status: 'CONNECTED',
      companyFile: 'MYOB Business — Client-Reported Shared Company File (Simulated)',
      companyId: 'MYOB-CO-9921',
      lastSync: '2026-11-02 08:45 UTC+10',
    });
    setCustomers(INITIAL_CUSTOMERS);
    setJobs(INITIAL_JOBS);
    setTemplates(INITIAL_TEMPLATES);
    setWebsiteEnquiries(INITIAL_WEBSITE_ENQUIRIES);
    setCertificateDeliveries([]);
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

  // Clock Advancement with Deterministic Event Processor (G00-020)
  const advanceClock = (hours: number) => {
    const current = new Date(demoClock);
    current.setHours(current.getHours() + hours);
    const newClock = current.toISOString();
    setDemoClock(newClock);

    // Process due reminders
    let deliveredCount = 0;
    setJobs(prev =>
      prev.map(j => {
        const updatedReminders = j.reminders.map(r => {
          if (!r.delivered && !r.suppressed) {
            // Check if scheduledFor <= newClock
            const schedDate = new Date(r.scheduledFor.replace(' ', 'T') + ':00+10:00');
            if (schedDate <= current) {
              deliveredCount++;
              return {
                ...r,
                delivered: true,
                deliveredAt: newClock.slice(0, 16),
              };
            }
          }
          return r;
        });
        return { ...j, reminders: updatedReminders };
      })
    );

    showDemoNotification(
      `Demo business clock advanced by ${hours} hr(s). ${deliveredCount > 0 ? `${deliveredCount} due email reminder(s) dispatched.` : ''}`,
      'info'
    );
  };

  // Switch scenario helper (G00-030: Clean defaults restore)
  useEffect(() => {
    if (activeScenario === 'default') {
      setMyobConnection(prev => ({ ...prev, status: 'CONNECTED', errorMessage: undefined }));
    } else if (activeScenario === 'doc_missing_signoff') {
      setSelectedJobId('JOB-2026-101');
      setActiveTab('jobs');
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

  // G00-009 & G00-010: MYOB Customer Write-Through Simulation with Duplicate Prevention
  const simulateCustomerWriteThrough = (
    draft: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>,
    simulationOutcome: 'SUCCESS' | 'FAILURE' | 'UNCERTAIN' = 'SUCCESS',
    forceDistinct = false
  ) => {
    // 1. Check for duplicates unless user explicitly forces distinct
    const dupCheck = checkCustomerDuplicate(draft, customers);
    if (dupCheck.isDuplicate && !forceDistinct && dupCheck.matchedCustomer) {
      showDemoNotification(
        `DUPLICATE DETECTED: A customer with matching ${dupCheck.field} exists (${dupCheck.matchedCustomer.name} - ${dupCheck.matchedCustomer.myobCustomerId}). Choose existing or confirm distinct entry.`,
        'warning'
      );
      return {
        success: false,
        isDuplicate: true,
        matchedCustomer: dupCheck.matchedCustomer,
      };
    }

    // 2. Disconnected or failed state
    if (myobConnection.status === 'DISCONNECTED' || myobConnection.status === 'FAILED' || simulationOutcome === 'FAILURE') {
      seqCounters.customer++;
      const draftCustomer: Customer = {
        ...draft,
        id: `CUSTOMER-DRAFT-${seqCounters.customer}`,
        myobCustomerId: 'PENDING_MYOB_SYNC',
        syncStatus: 'FAILED',
        createdAt: demoClock.slice(0, 10),
        isRecoverableDraft: true,
        activityHistory: [
          { timestamp: demoClock.slice(0, 16), action: 'Draft entry saved locally (MYOB Offline)', actor: persona },
        ],
      };
      setCustomers(prev => [draftCustomer, ...prev]);
      showDemoNotification('MYOB Business offline: Customer saved as recoverable local draft.', 'error');
      return { success: false, customer: draftCustomer, error: 'Simulated MYOB API connection offline.' };
    }

    // 3. Uncertain state
    if (simulationOutcome === 'UNCERTAIN') {
      seqCounters.customer++;
      const uncertainCustomer: Customer = {
        ...draft,
        id: `CUSTOMER-UNCERTAIN-${seqCounters.customer}`,
        myobCustomerId: 'AWAITING_RECONCILIATION',
        syncStatus: 'UNCERTAIN',
        createdAt: demoClock.slice(0, 10),
        isRecoverableDraft: true,
        activityHistory: [
          { timestamp: demoClock.slice(0, 16), action: 'Uncertain response from MYOB. Reconciliation queued.', actor: persona },
        ],
      };
      setCustomers(prev => [uncertainCustomer, ...prev]);
      showDemoNotification('MYOB Write-through simulation: Uncertain response. Reconciliation required to avoid duplicate master.', 'warning');
      return { success: false, customer: uncertainCustomer, isUncertain: true };
    }

    // 4. Success outcome: assign fake MYOB reference
    seqCounters.customer++;
    const newCustomer: Customer = {
      ...draft,
      id: `CUSTOMER-DEMO-${seqCounters.customer}`,
      myobCustomerId: `MYOB-DEMO-${seqCounters.customer}`,
      syncStatus: 'SYNCED',
      createdAt: demoClock.slice(0, 10),
      isRecoverableDraft: false,
      activityHistory: [
        { timestamp: demoClock.slice(0, 16), action: `Created & acknowledged in MYOB Business (#MYOB-DEMO-${seqCounters.customer})`, actor: persona },
      ],
    };

    setCustomers(prev => [newCustomer, ...prev]);
    showDemoNotification(
      `MYOB Write-through successful: Created customer in MYOB with ID ${newCustomer.myobCustomerId}.`,
      'success'
    );
    return { success: true, customer: newCustomer, isDuplicate: false };
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
              activityHistory: [
                ...(c.activityHistory || []),
                { timestamp: demoClock.slice(0, 16), action: 'Reconciled: Confirmed created in MYOB', actor: persona },
              ],
            };
          } else {
            return {
              ...c,
              syncStatus: 'FAILED',
              notes: 'Reconciliation discarded duplicate entry.',
              activityHistory: [
                ...(c.activityHistory || []),
                { timestamp: demoClock.slice(0, 16), action: 'Reconciled: Discarded as duplicate', actor: persona },
              ],
            };
          }
        }
        return c;
      })
    );
    showDemoNotification(
      confirmCreate ? 'Customer record reconciled and linked to MYOB.' : 'Duplicate entry cancelled.',
      'info'
    );
  };

  const retryFailedCustomerSync = (customerId: string) => {
    if (myobConnection.status === 'FAILED' || myobConnection.status === 'DISCONNECTED') {
      showDemoNotification('Cannot retry sync while MYOB connection is offline.', 'error');
      return;
    }
    setCustomers(prev =>
      prev.map(c => {
        if (c.id === customerId) {
          return {
            ...c,
            myobCustomerId: `MYOB-RETRY-${c.id.slice(-4)}`,
            syncStatus: 'SYNCED',
            isRecoverableDraft: false,
            activityHistory: [
              ...(c.activityHistory || []),
              { timestamp: demoClock.slice(0, 16), action: 'Retry successful: Synced to MYOB', actor: persona },
            ],
          };
        }
        return c;
      })
    );
    showDemoNotification(`Draft ${customerId} successfully synced to MYOB Business!`, 'success');
  };

  // Job Actions (G00-012, G00-013, G00-014)
  const createJob = (jobData: Partial<Job>): Job => {
    seqCounters.job++;
    const nextId = `JOB-2026-${seqCounters.job}`;

    // Lookup job type config for form requirements and version snapshot
    const matchedJobType =
      jobTypes.find(jt => jt.id === jobData.jobType) ||
      jobTypes.find(jt => jt.name === jobData.jobType) ||
      jobTypes[0];

    // G00-012/P1: Mandatory compliance forms configured on the Job Type cannot be bypassed
    const forms = matchedJobType.formsRequired.length > 0
      ? matchedJobType.formsRequired
      : (jobData.formsRequired ?? []);
    const isDirect = forms.length === 0 ? Boolean(jobData.isDirectToInvoice) : false;

    const scheduledDate = jobData.scheduledDate || demoClock.slice(0, 10);
    const scheduledTime = jobData.scheduledTime || '09:00';
    const hasActiveAppointment = Boolean(jobData.assignedTechId && scheduledDate);

    // Calculate reminder due time only for active appointments (E/I Reminders)
    const reminders: ScheduledReminder[] = [];
    if (hasActiveAppointment) {
      seqCounters.reminder++;
      const reminderDue = calculateReminderDueTime(scheduledDate, scheduledTime, 2);
      reminders.push({
        id: `REM-${seqCounters.reminder}`,
        targetAppointmentTime: `${scheduledDate} ${scheduledTime}`,
        leadHours: 2,
        scheduledFor: reminderDue,
        type: 'REMINDER_2HR',
        channel: 'EMAIL_SIMULATED',
        suppressed: false,
        delivered: false,
      });
    }

    const newJob: Job = {
      id: nextId,
      brandId: jobData.brandId || activeBrandId,
      customerId: jobData.customerId || customers[0].id,
      title: jobData.title || `${matchedJobType.name} Request`,
      jobType: matchedJobType.name,
      jobTypeVersion: matchedJobType.version,
      siteAddress: jobData.siteAddress || '[Fictional] Site Address',
      siteContact: jobData.siteContact || 'Contact Person',
      sitePhone: jobData.sitePhone || '0400 000 000',
      description: jobData.description || 'Service call details',
      status: jobData.status || (jobData.assignedTechId ? 'SCHEDULED' : 'NEW'),
      appointmentStatus: jobData.appointmentStatus || (hasActiveAppointment ? 'SCHEDULED' : 'SCHEDULED'),
      calendarMapping: brands[jobData.brandId || activeBrandId]?.calendarMappingName || 'Primary Dispatch Calendar',
      calendarSyncStatus: hasActiveAppointment ? 'SYNCED' : 'PENDING',
      assignedTechId: jobData.assignedTechId ?? null,
      assignedTechName: jobData.assignedTechId
        ? INITIAL_TECHNICIANS.find(t => t.id === jobData.assignedTechId)?.name || 'Dave Miller'
        : null,
      scheduledDate,
      scheduledTime,
      estimatedDurationHours: jobData.estimatedDurationHours || 2,
      isDirectToInvoice: isDirect,
      formsRequired: forms,
      attachedSampleIds: [],
      reviewRequest: {
        status: 'NOT_SENT',
        reviewLink: brands[jobData.brandId || activeBrandId]?.reviewUrlPlaceholder || '',
        brandName: brands[jobData.brandId || activeBrandId]?.name || 'CABMS Brand',
        channel: 'EMAIL_SIMULATED',
        history: [],
      },
      reminders,
      unresolvedWarnings: isDirect ? ['Direct-to-invoice service: no compliance documentation required.'] : [],
      activityHistory: [
        {
          timestamp: demoClock.slice(0, 16),
          action: `Work order created (${matchedJobType.name} ${matchedJobType.version})`,
          actor: persona,
          notes: jobData.assignedTechId ? `Assigned to ${jobData.assignedTechId}` : 'Unassigned pool',
        },
      ],
    };

    setJobs(prev => [newJob, ...prev]);
    showDemoNotification(`Job ${newJob.id} created successfully.`, 'success');
    return newJob;
  };

  const updateJobStatus = (jobId: string, newStatus: JobStatus) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? {
              ...j,
              status: newStatus,
              activityHistory: [
                ...j.activityHistory,
                { timestamp: demoClock.slice(0, 16), action: `Operational status updated to ${newStatus}`, actor: persona },
              ],
            }
          : j
      )
    );
    showDemoNotification(`Job ${jobId} status updated to ${newStatus}.`, 'info');
  };

  const attemptCompleteJob = (jobId: string): CompletionValidationResult => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) {
      return { canComplete: false, missingRequirements: ['Job not found'], warnings: [], isDirectToInvoice: false };
    }

    // Pass the job's own form instances
    const forms = {
      jsa: jsaForms[jobId],
      electrical: electricalCerts[jobId],
      smokeAlarm: smokeAlarmCerts[jobId],
      tca1: tca1Certs[jobId],
      tca2: tca2Certs[jobId],
    };

    const validation = validateJobCompletion(job, forms);

    if (validation.canComplete) {
      setJobs(prev =>
        prev.map(j =>
          j.id === jobId
            ? {
                ...j,
                status: 'COMPLETED',
                completedAt: demoClock,
                completionNotes: 'All applicable synthetic demo completion requirements satisfied.',
                activityHistory: [
                  ...j.activityHistory,
                  { timestamp: demoClock.slice(0, 16), action: 'Job marked COMPLETED (requirements validated)', actor: persona },
                ],
              }
            : j
        )
      );
      showDemoNotification(`SUCCESS: Job ${jobId} marked COMPLETED. Synthetic requirements satisfied.`, 'success');
    } else {
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

          seqCounters.reminder++;
          const reminderDue = calculateReminderDueTime(newDate, newTime, 2);
          const newReminder = {
            id: `REM-${seqCounters.reminder}`,
            targetAppointmentTime: `${newDate} ${newTime}`,
            leadHours: 2,
            scheduledFor: reminderDue,
            type: 'REMINDER_2HR' as const,
            channel: 'EMAIL_SIMULATED' as const,
            suppressed: false,
            delivered: false,
          };

          return {
            ...j,
            scheduledDate: newDate,
            scheduledTime: newTime,
            status: 'SCHEDULED' as JobStatus,
            appointmentStatus: 'RESCHEDULED',
            calendarSyncStatus: 'SYNCED',
            reminders: [...updatedReminders, newReminder],
            activityHistory: [
              ...j.activityHistory,
              { timestamp: demoClock.slice(0, 16), action: `Appointment rescheduled to ${newDate} ${newTime}`, actor: persona },
            ],
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
            `Visit cancelled: ${reason}`,
            demoClock
          );
          return {
            ...j,
            appointmentStatus: 'CANCELLED',
            calendarSyncStatus: 'SYNCED',
            reminders: updatedReminders,
            activityHistory: [
              ...j.activityHistory,
              { timestamp: demoClock.slice(0, 16), action: `Visit cancelled (${reason}). Appointment status marked CANCELLED. Job remains active for rescheduling.`, actor: persona },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Appointment for Job ${jobId} cancelled. Reminders suppressed. Job remains open for rescheduling.`, 'warning');
  };

  const cancelWholeJob = (jobId: string, reason: string) => {
    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId) {
          const updatedReminders = suppressOldReminders(
            j,
            `Job cancelled: ${reason}`,
            demoClock
          );
          return {
            ...j,
            status: 'CANCELLED',
            reminders: updatedReminders,
            activityHistory: [
              ...j.activityHistory,
              { timestamp: demoClock.slice(0, 16), action: `Job CANCELLED: ${reason}`, actor: persona },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Job ${jobId} marked CANCELLED.`, 'warning');
  };

  const reopenCancelledJob = (jobId: string) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? {
              ...j,
              status: 'SCHEDULED',
              activityHistory: [
                ...j.activityHistory,
                { timestamp: demoClock.slice(0, 16), action: 'Job reopened from cancelled state', actor: persona },
              ],
            }
          : j
      )
    );
    showDemoNotification(`Job ${jobId} reopened and returned to active schedule.`, 'info');
  };

  // Pure default form builders (avoids render-phase state mutations)
  const buildDefaultJsa = (jobId: string): JsaFormData => {
    const job = jobs.find(j => j.id === jobId);
    return {
      jobReference: jobId,
      date: job?.scheduledDate || demoClock.slice(0, 10),
      customerName: job?.siteContact || 'Customer',
      siteContactPlaceholder: `${job?.siteContact || 'Customer'} (${job?.sitePhone || '0400 000 000'})`,
      siteAddress: job?.siteAddress || '[Fictional] Site Address',
      taskDescription: `${job?.title || 'Maintenance'}: Onsite Safety Risk Assessment`,
      assetsIdentified: 'Distribution Board, Cabling Infrastructure',
      personnelName: job?.assignedTechName || 'Dave Miller',
      personnelRole: 'Lead Electrician & Safety Lead',
      licencePlaceholder: 'Q-ELEC-98765-DEMO',
      licenceExpiryPlaceholder: '31/12/2027',
      inductionCompleted: false, // Starts false so technician must interact
      competencyVerified: false,
      overallRiskLevel: 'M',
      steps: [
        {
          id: 'step-init-1',
          taskStep: 'Site Arrival & Hazard Assessment',
          hazards: 'Slips, trips, vehicle movement',
          initialRisk: 'M',
          controls: 'Establish demarcated work zone with safety cones and clear access path',
          residualRisk: 'L',
          responsibleRole: 'Lead Technician',
        },
      ],
      ppeChecklist: [
        { item: 'Steel Cap Safety Boots (AS/NZS 2210.3)', status: 'Yes' },
        { item: 'High Visibility Shirt / Vest', status: 'Yes' },
        { item: 'Safety Glasses with Side Shields', status: 'Yes' },
        { item: '1000V Insulated Gloves', status: 'N/A' },
      ],
      isolationsAndPermits: [
        { item: 'Electrical Isolation Lockout', required: 'N/A', referenceOrNotes: 'Verify at sub-board' },
        { item: 'Working at Heights Permit', required: 'No', referenceOrNotes: 'Ground-level work' },
      ],
      emergencyAssemblyArea: 'Front entrance / Car park boundary',
      emergencyWardenPlaceholder: 'Lead Technician / Onsite Warden',
      firstAidOfficerPlaceholder: 'Lead Technician (Current First Aid/CPR)',
      signedOff: false, // Pristine unsigned state!
      formRevision: 'Rev 4.2 - Oct 2026',
      issuerPlaceholder: brands[job?.brandId || activeBrandId]?.legalIssuerName || 'CABMS Safety Division',
      attachedSampleIds: [],
    };
  };

  const buildDefaultElectrical = (jobId: string): ElectricalCertData => {
    const job = jobs.find(j => j.id === jobId);
    return {
      certReference: `ELEC-CERT-2026-${seqCounters.job}`,
      jobReference: jobId,
      dateOfTest: job?.scheduledDate || demoClock.slice(0, 10),
      customerName: job?.siteContact || 'Customer',
      installationAddress: job?.siteAddress || '[Fictional] Site Address',
      siteContact: `${job?.siteContact || 'Customer'} (${job?.sitePhone || '0400 000 000'})`,
      occupierRole: 'Owner',
      contractorNamePlaceholder: brands[job?.brandId || activeBrandId]?.legalIssuerName || 'Solarcell Electrical',
      electricianLicencePlaceholder: 'Dave Miller (Q-ELEC-98765-DEMO)',
      issuerWordingPlaceholder: 'Electrical Safety Office Queensland (Model Form)',
      testedWorkItems: [
        {
          id: 'work-new-1',
          description: 'Sub-Circuit Test & Earthing Verification',
          circuitsTested: 'Sub-board to End Points',
          insulationResistanceResult: '> 200 Megohms',
          polarityTest: 'Pass',
          earthContinuity: 'Pass',
          rcdTripTimeMs: '22ms (Type A RCD)',
          workResult: 'Pass',
        },
      ],
      standardsReliedOn: ['AS/NZS 3000:2018 Wiring Rules'],
      partACertificationPlaceholder: 'Part A Certification: Work inspected and tested to AS/NZS 3000 standards.',
      limitationsAndConsumerRightsPlaceholder: 'Consumer Notice: Retain this compliance test certificate for warranty and insurance.',
      signedOff: false,
      unresolvedNotice: 'CRITICAL NOTICE: Electrical Part B / sections 7-8 not supplied or unresolved. No completed live certificate can be inferred.',
      attachedSampleIds: [],
    };
  };

  const buildDefaultSmokeAlarm = (jobId: string): SmokeAlarmCertData => {
    const job = jobs.find(j => j.id === jobId);
    return {
      certReference: `SMOKE-2026-${seqCounters.job}`,
      jobReference: jobId,
      dateOfInspection: job?.scheduledDate || demoClock.slice(0, 10),
      issuedByPlaceholder: brands[job?.brandId || activeBrandId]?.legalIssuerName || 'Smart Home Solutions Safety',
      issuedToRole: 'Owner',
      propertyType: 'Detached House',
      storeys: 1,
      bedrooms: 3,
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
          id: 'alm-new-1',
          roomLocation: 'Main Hallway Outside Bedrooms',
          alarmBrandModel: 'Clipsal 755PSMA4 (Photoelectric)',
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
      attachmentsLinked: false,
      limitationsAndRentalNotes: 'Interconnected photoelectric alarms comply with current Queensland fire legislation.',
      signedOff: false,
      provisionalNote: 'PROVISIONAL NOTICE: Per-alarm Pass/Fail, room counts, and expiry wording are provisional.',
      attachedSampleIds: [],
    };
  };

  const buildDefaultTca1 = (jobId: string): Tca1CertData => {
    const job = jobs.find(j => j.id === jobId);
    return {
      certReference: `TCA1-2026-${seqCounters.job}`,
      jobReference: jobId,
      registeredCablerPlaceholder: job?.assignedTechName || 'Alex Taylor',
      cablerRegistrationNumberPlaceholder: 'ACMA-REG-44210-DEMO',
      employerDetailsPlaceholder: brands[job?.brandId || activeBrandId]?.legalIssuerName || 'Gold Coast CCTV & Cabling',
      dateOfWork: job?.scheduledDate || demoClock.slice(0, 10),
      workDescription: 'Installation of Category 6 data cabling drops',
      locationOfWork: job?.siteAddress || '[Fictional] Site Address',
      supervisionProvided: true,
      customerName: job?.siteContact || 'Customer',
      customerContact: `${job?.siteContact || 'Customer'} (${job?.sitePhone || '0400 000 000'})`,
      certificationPlaceholderText: 'I hereby certify that telecommunications cabling complies with Telecommunications Cabling Provider Rules.',
      signedOff: false,
      unresolvedRegistrationExpiryNotice: 'Unresolved Notice: Cabler registration number and expiry date remain unconfirmed demo placeholders.',
      attachedSampleIds: [],
    };
  };

  const buildDefaultTca2 = (jobId: string): Tca2CertData => {
    const job = jobs.find(j => j.id === jobId);
    return {
      reportReference: `TCA2-DEFECT-2026-${seqCounters.job}`,
      jobReference: jobId,
      inspectionDate: job?.scheduledDate || demoClock.slice(0, 10),
      businessCablerPlaceholder: job?.assignedTechName || 'Alex Taylor',
      customerName: job?.siteContact || 'Customer',
      siteAddress: job?.siteAddress || '[Fictional] Site Address',
      cablingScope: 'Existing Only',
      cablingTypes: ['Category 5e Legacy Data'],
      locationsInspected: 'Riser Cupboard B',
      nonComplianceDescription: 'Telecommunications cabling co-located in common conduit with 240V mains power without physical barrier.',
      requirementReferencePlaceholder: 'AS/CA S009:2020 Clause 5.3.1',
      riskCategory: 'High (Immediate Shock / Fire Hazard)',
      samplePhotoLinked: false,
      rectificationRecommendation: 'Install independent dedicated 25mm PVC conduit for data cabling with 50mm separation distance.',
      responsibleParty: 'Customer / Building Owner',
      urgencyLevel: 'Immediate (Within 24 Hours)',
      quotationReferencePlaceholder: 'MYOB-Q-RECTIFICATION',
      targetResolutionDate: '2026-11-05',
      customerAcknowledged: false,
      officeReviewCompleted: false,
      signedOff: false,
      warningNotice: 'NON-COMPLIANCE NOTICE: Completing TCA2 records a defect; it does NOT certify the installation as compliant.',
      attachedSampleIds: [],
    };
  };

  // Pure Form Getters (No render-phase state mutations)
  const getOrCreateJsa = (jobId: string): JsaFormData => {
    return jsaForms[jobId] || buildDefaultJsa(jobId);
  };

  const getOrCreateElectrical = (jobId: string): ElectricalCertData => {
    return electricalCerts[jobId] || buildDefaultElectrical(jobId);
  };

  const getOrCreateSmokeAlarm = (jobId: string): SmokeAlarmCertData => {
    return smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
  };

  const getOrCreateTca1 = (jobId: string): Tca1CertData => {
    return tca1Certs[jobId] || buildDefaultTca1(jobId);
  };

  const getOrCreateTca2 = (jobId: string): Tca2CertData => {
    return tca2Certs[jobId] || buildDefaultTca2(jobId);
  };

  // Form Field Updates with Immutability Guards for Signed Documents
  const updateJsaForm = (jobId: string, data: Partial<JsaFormData>) => {
    const existing = jsaForms[jobId] || buildDefaultJsa(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: JSA for Job ${jobId} is finalized and signed off. Edits are refused.`, 'error');
      return;
    }
    setJsaForms(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || buildDefaultJsa(jobId)), ...data },
    }));
  };

  const updateElectricalForm = (jobId: string, data: Partial<ElectricalCertData>) => {
    const existing = electricalCerts[jobId] || buildDefaultElectrical(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: Electrical Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    setElectricalCerts(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || buildDefaultElectrical(jobId)), ...data },
    }));
  };

  const updateSmokeAlarmForm = (jobId: string, data: Partial<SmokeAlarmCertData>) => {
    const existing = smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: Smoke Alarm Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    setSmokeAlarmCerts(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || buildDefaultSmokeAlarm(jobId)), ...data },
    }));
  };

  const updateTca1Form = (jobId: string, data: Partial<Tca1CertData>) => {
    const existing = tca1Certs[jobId] || buildDefaultTca1(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: TCA1 Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    setTca1Certs(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || buildDefaultTca1(jobId)), ...data },
    }));
  };

  const updateTca2Form = (jobId: string, data: Partial<Tca2CertData>) => {
    const existing = tca2Certs[jobId] || buildDefaultTca2(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: TCA2 Report for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    setTca2Certs(prev => ({
      ...prev,
      [jobId]: { ...(prev[jobId] || buildDefaultTca2(jobId)), ...data },
    }));
  };

  // Finalization with Frozen Issuer Snapshot and Full Document Snapshot
  const signOffJsa = (jobId: string) => {
    const current = jsaForms[jobId] || buildDefaultJsa(jobId);
    if (current.signedOff) {
      showDemoNotification('JSA is already finalized and signed off.', 'warning');
      return;
    }
    if (!current.inductionCompleted || !current.competencyVerified) {
      showDemoNotification('SIGN-OFF BLOCKED: Both Site Induction and Competencies Verified must be confirmed before sign-off.', 'error');
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.solarcell;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = demoClock.slice(0, 16);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: JsaFormData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);

    setJsaForms(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`JSA signed off with DEMO mark for Job ${jobId}. Full document snapshot frozen.`, 'success');
  };

  const signOffSmokeAlarm = (jobId: string) => {
    const current = smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
    if (current.signedOff) {
      showDemoNotification('Smoke Alarm Certificate is already signed off.', 'warning');
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.smart_home;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = demoClock.slice(0, 16);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: SmokeAlarmCertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);

    setSmokeAlarmCerts(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`Smoke Alarm Certificate signed off for Job ${jobId}. Snapshot frozen.`, 'success');
  };

  const signOffElectrical = (jobId: string) => {
    const current = electricalCerts[jobId] || buildDefaultElectrical(jobId);
    if (current.signedOff) {
      showDemoNotification('Electrical Certificate Part A is already signed off.', 'warning');
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.solarcell;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = demoClock.slice(0, 16);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: ElectricalCertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);

    setElectricalCerts(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`Electrical Certificate Part A signed off for Job ${jobId}. Snapshot frozen.`, 'warning');
  };

  const signOffTca1 = (jobId: string) => {
    const current = tca1Certs[jobId] || buildDefaultTca1(jobId);
    if (current.signedOff) {
      showDemoNotification('TCA1 Cabling Compliance Certificate is already signed off.', 'warning');
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.cctv;
    const signer = job?.assignedTechName || 'Alex Taylor';
    const timestamp = demoClock.slice(0, 16);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: Tca1CertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);

    setTca1Certs(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`TCA1 Cabling Compliance signed off for Job ${jobId}. Snapshot frozen.`, 'success');
  };

  const signOffTca2 = (jobId: string) => {
    const current = tca2Certs[jobId] || buildDefaultTca2(jobId);
    if (current.signedOff) {
      showDemoNotification('TCA2 Defect Report is already signed off.', 'warning');
      return;
    }
    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.cctv;
    const signer = job?.assignedTechName || 'Alex Taylor';
    const timestamp = demoClock.slice(0, 16);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: Tca2CertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);

    setTca2Certs(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`TCA2 Cabling Defect signed off for Job ${jobId}. Non-compliance recorded.`, 'warning');
  };

  const customerAckTca2 = (jobId: string) => {
    setTca2Certs(prev => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || buildDefaultTca2(jobId)),
        customerAcknowledged: true,
        customerAckTimestamp: demoClock.slice(0, 16),
      },
    }));
    showDemoNotification(`Customer acknowledgement captured for TCA2 Defect on Job ${jobId}.`, 'info');
  };

  const officeReviewTca2 = (jobId: string) => {
    // G00-028 & P0 Fix: Office review actually creates the follow-up work order in jobs
    seqCounters.job++;
    const followupId = `JOB-2026-${seqCounters.job}`;
    const sourceJob = jobs.find(j => j.id === jobId);

    const newFollowupJob: Job = {
      id: followupId,
      brandId: sourceJob?.brandId || 'cctv',
      customerId: sourceJob?.customerId || customers[0].id,
      title: `TCA2 Remediation: Dedicated Conduit Installation (Follow-up to ${jobId})`,
      jobType: 'Enterprise CCTV & Cabling Inspection',
      jobTypeVersion: 'v2.1',
      siteAddress: sourceJob?.siteAddress || '[Fictional] Site Address',
      siteContact: sourceJob?.siteContact || 'Site Contact',
      sitePhone: sourceJob?.sitePhone || '0400 000 000',
      description: `Rectification follow-up for Cabling Non-Compliance reported under ${jobId}. Dedicated 25mm PVC conduit separation required.`,
      status: 'NEW',
      appointmentStatus: 'SCHEDULED',
      assignedTechId: null,
      assignedTechName: null,
      scheduledDate: '2026-11-06',
      scheduledTime: '08:30',
      estimatedDurationHours: 3,
      isDirectToInvoice: false,
      formsRequired: ['JSA', 'TCA1'],
      attachedSampleIds: sourceJob?.attachedSampleIds || [],
      reviewRequest: {
        status: 'NOT_SENT',
        reviewLink: brands[sourceJob?.brandId || 'cctv']?.reviewUrlPlaceholder || '',
        brandName: brands[sourceJob?.brandId || 'cctv']?.name || 'Gold Coast CCTV',
        channel: 'EMAIL_SIMULATED',
        history: [],
      },
      reminders: [],
      unresolvedWarnings: ['Follow-up rectification work order queued from TCA2 Office Review.'],
      activityHistory: [
        {
          timestamp: demoClock.slice(0, 16),
          action: `Rectification work order #${followupId} queued from TCA2 office review of defect on ${jobId}`,
          actor: persona,
        },
      ],
    };

    setJobs(prev => [newFollowupJob, ...prev]);

    setTca2Certs(prev => ({
      ...prev,
      [jobId]: {
        ...(prev[jobId] || buildDefaultTca2(jobId)),
        officeReviewCompleted: true,
        reviewedByOfficeStaff: 'Emma Wilson (Office Administrator)',
        officeReviewTimestamp: demoClock.slice(0, 16),
        rectificationFollowupJobId: followupId,
      },
    }));

    showDemoNotification(`TCA2 Office Review completed. Rectification follow-up work order #${followupId} created in operational pool.`, 'success');
  };

  // Sample Attachment Linkage (G00-027)
  const attachSampleToJobForm = (jobId: string, formType: string, sampleId: string) => {
    // Add to job
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId && !j.attachedSampleIds.includes(sampleId)
          ? { ...j, attachedSampleIds: [...j.attachedSampleIds, sampleId] }
          : j
      )
    );

    // Add to specific form
    if (formType === 'JSA') {
      updateJsaForm(jobId, {
        attachedSampleIds: [...(jsaForms[jobId]?.attachedSampleIds || []), sampleId],
      });
    } else if (formType === 'SMOKE_ALARM') {
      updateSmokeAlarmForm(jobId, {
        attachedSampleIds: [...(smokeAlarmCerts[jobId]?.attachedSampleIds || []), sampleId],
      });
    } else if (formType === 'ELECTRICAL') {
      updateElectricalForm(jobId, {
        attachedSampleIds: [...(electricalCerts[jobId]?.attachedSampleIds || []), sampleId],
      });
    } else if (formType === 'TCA1') {
      updateTca1Form(jobId, {
        attachedSampleIds: [...(tca1Certs[jobId]?.attachedSampleIds || []), sampleId],
      });
    } else if (formType === 'TCA2') {
      updateTca2Form(jobId, {
        attachedSampleIds: [...(tca2Certs[jobId]?.attachedSampleIds || []), sampleId],
        samplePhotoLinked: true,
      });
    }

    showDemoNotification(`Sample attachment linked to Job ${jobId}.`, 'info');
  };

  const removeSampleFromJobForm = (jobId: string, formType: string, sampleId: string) => {
    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? { ...j, attachedSampleIds: j.attachedSampleIds.filter(id => id !== sampleId) }
          : j
      )
    );
    if (formType === 'JSA') {
      updateJsaForm(jobId, {
        attachedSampleIds: (jsaForms[jobId]?.attachedSampleIds || []).filter(id => id !== sampleId),
      });
    } else if (formType === 'TCA2') {
      const remaining = (tca2Certs[jobId]?.attachedSampleIds || []).filter(id => id !== sampleId);
      updateTca2Form(jobId, {
        attachedSampleIds: remaining,
        samplePhotoLinked: remaining.length > 0,
      });
    }
    showDemoNotification(`Sample attachment unlinked from Job ${jobId}.`, 'info');
  };

  // Quotes (G00-006, G00-016, G00-017)
  const prepareQuoteForJob = (
    jobId: string,
    title: string,
    lineItems: { id: string; description: string; quantity: number; unitPrice: number; total: number }[]
  ): Quote => {
    const access = verifyPersonaAccess(persona, 'financial_writes');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      throw new Error(access.reason);
    }
    seqCounters.quote++;
    // Clear subtotal (ex-GST) + GST (10%) = Total (inc-GST) convention
    const subtotal = Math.round(lineItems.reduce((acc, item) => acc + item.total, 0) * 100) / 100;
    const gst = Math.round(subtotal * 0.1 * 100) / 100;
    const total = Math.round((subtotal + gst) * 100) / 100;

    const job = jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId];
    const termsTpl = templates.find(t => t.type === 'TERMS') || templates[0];

    const newQuote: Quote = {
      id: `QUOTE-2026-${seqCounters.quote}`,
      jobId,
      customerId: job?.customerId || customers[0].id,
      brandId: job?.brandId || activeBrandId,
      externalMyobRef: `MYOB-Q-${88200 + seqCounters.quote}`,
      title,
      subtotal,
      gst,
      total,
      lineItems,
      termsVersion: termsTpl.currentVersion,
      termsContentSnapshot: termsTpl.content,
      frozenIssuerSnapshot: `${brand.legalIssuerName} • ${brand.abnPlaceholder}`,
      acceptanceStatus: 'SENT',
      linkScenario: 'valid',
      acceptanceHistory: [
        {
          timestamp: demoClock.slice(0, 16),
          action: `Quote generated & synced to MYOB Business (#MYOB-Q-${88200 + seqCounters.quote})`,
          actor: persona,
        },
        {
          timestamp: demoClock.slice(0, 16),
          action: 'Acceptance link generated and sent via email',
          actor: 'Automated Service',
        },
      ],
    };

    setJobs(prev =>
      prev.map(j => (j.id === jobId ? { ...j, quote: newQuote } : j))
    );

    showDemoNotification(`Quote ${newQuote.externalMyobRef} prepared (Subtotal: $${subtotal.toLocaleString()} + GST: $${gst.toLocaleString()} = Total: $${total.toLocaleString()}).`, 'success');
    return newQuote;
  };

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

    const acceptedTimestamp = demoClock.slice(0, 16);
    const historyEntry = {
      timestamp: acceptedTimestamp,
      action: 'Accepted via Customer Online Portal',
      actor: job.siteContact,
      notes: `Customer accepted Terms snapshot ${job.quote.termsVersion}`,
    };

    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId && j.quote) {
          return {
            ...j,
            quote: {
              ...j.quote,
              acceptanceStatus: 'ACCEPTED',
              acceptedAt: acceptedTimestamp,
              acceptedByName: job.siteContact,
              acceptanceHistory: [...j.quote.acceptanceHistory, historyEntry],
            },
            activityHistory: [
              ...j.activityHistory,
              { timestamp: acceptedTimestamp, action: `Quote ${j.quote.externalMyobRef} accepted by customer`, actor: job.siteContact },
            ],
          };
        }
        return j;
      })
    );

    showDemoNotification(`Quotation accepted by customer. Exact terms snapshot preserved.`, 'success');
    return { success: true, message: 'Quotation successfully accepted!' };
  };

  // Invoices (G00-018: Checks MYOB status for real failure/uncertain states)
  const prepareInvoiceForJob = (jobId: string, amount: number) => {
    const access = verifyPersonaAccess(persona, 'financial_writes');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }
    seqCounters.invoice++;
    const isOffline = myobConnection.status !== 'CONNECTED';
    const invoiceId = `INV-2026-${seqCounters.invoice}`;
    const myobRef = isOffline ? 'PENDING-MYOB-SYNC' : `MYOB-INV-${77100 + seqCounters.invoice}`;

    const newInvoice: Invoice = {
      id: invoiceId,
      externalMyobRef: myobRef,
      amount,
      status: isOffline ? 'DRAFT' : 'SENT_TO_MYOB',
      syncStatus: isOffline ? 'FAILED' : 'SYNCED',
      issuedDate: demoClock.slice(0, 10),
      dueDate: demoClock.slice(0, 10),
      reconciliationRequired: isOffline,
      reconciliationNotes: isOffline
        ? 'MYOB API connection offline (504 Timeout). Invoice saved locally and requires reconciliation.'
        : undefined,
      errorMessage: isOffline ? 'Simulated MYOB Connection Offline' : undefined,
    };

    setJobs(prev =>
      prev.map(j =>
        j.id === jobId
          ? {
              ...j,
              invoice: newInvoice,
              activityHistory: [
                ...j.activityHistory,
                {
                  timestamp: demoClock.slice(0, 16),
                  action: isOffline
                    ? `Invoice ${invoiceId} held in local draft (MYOB offline, reconciliation required)`
                    : `MYOB Invoice ${myobRef} prepared for $${amount}`,
                  actor: persona,
                },
              ],
            }
          : j
      )
    );

    if (isOffline) {
      showDemoNotification(`Invoice saved as local draft. MYOB connection offline — reconciliation queued.`, 'warning');
    } else {
      showDemoNotification(`Invoice ${myobRef} prepared and synced to MYOB Business for Job ${jobId}.`, 'success');
    }
  };

  const reconcileInvoiceSync = (jobId: string, outcome: 'SUCCESS' | 'FAIL') => {
    setJobs(prev =>
      prev.map(j => {
        if (j.id === jobId && j.invoice) {
          if (outcome === 'SUCCESS') {
            return {
              ...j,
              invoice: {
                ...j.invoice,
                status: 'SENT_TO_MYOB',
                syncStatus: 'SYNCED',
                externalMyobRef: `MYOB-INV-${77100 + seqCounters.invoice}`,
                reconciliationRequired: false,
                reconciliationNotes: undefined,
                errorMessage: undefined,
              },
              activityHistory: [
                ...j.activityHistory,
                { timestamp: demoClock.slice(0, 16), action: 'Invoice synced to MYOB following manual reconciliation', actor: persona },
              ],
            };
          } else {
            return {
              ...j,
              invoice: {
                ...j.invoice,
                status: 'DRAFT',
                syncStatus: 'FAILED',
                reconciliationRequired: true,
                reconciliationNotes: 'Reconciliation failed: Remote MYOB rejected document.',
                errorMessage: 'Simulated Rejection',
              },
            };
          }
        }
        return j;
      })
    );
    showDemoNotification(`Invoice reconciliation processed for Job ${jobId}.`, 'info');
  };

  // Reviews Deduplication & Full Workflow (G00-021)
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
                      timestamp: demoClock.slice(0, 16),
                      event: 'Simulated email dispatch timeout (Error 504)',
                      status: 'UNCERTAIN',
                    },
                  ],
                },
                activityHistory: [
                  ...j.activityHistory,
                  { timestamp: demoClock.slice(0, 16), action: 'Review request dispatch resulted in uncertain status', actor: 'Automated Service' },
                ],
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
                sentTimestamp: demoClock.slice(0, 16),
                reviewLink: brands[job.brandId]?.reviewUrlPlaceholder || '',
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: demoClock.slice(0, 16),
                    event: `Email invitation sent to customer for ${brands[job.brandId]?.name}`,
                    status: 'SENT',
                  },
                ],
              },
              activityHistory: [
                ...j.activityHistory,
                { timestamp: demoClock.slice(0, 16), action: `Review invitation sent to customer (${brands[job.brandId]?.name})`, actor: 'Automated Service' },
              ],
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
                sentTimestamp: demoClock.slice(0, 16),
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: demoClock.slice(0, 16),
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

  // Templates & Versioning (G00-007: DRAFT -> REVIEW -> PUBLISHED)
  const publishTemplateVersion = (templateId: string) => {
    const access = verifyPersonaAccess(persona, 'template_publishing');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }

    seqCounters.revision++;
    setTemplates(prev =>
      prev.map(t => {
        if (t.id === templateId) {
          const newVer = `v${(parseFloat(t.currentVersion.replace('v', '')) + 0.1).toFixed(1)}`;
          const publishedRev = {
            version: newVer,
            status: 'PUBLISHED' as const,
            content: t.content,
            updatedAt: demoClock.slice(0, 16),
            updatedBy: persona.toUpperCase(),
          };
          return {
            ...t,
            currentVersion: newVer,
            activeStatus: 'PUBLISHED',
            revisions: [publishedRev, ...t.revisions],
          };
        }
        return t;
      })
    );
    showDemoNotification(`Template version published. Previously finalized records retain historical snapshots.`, 'success');
  };

  const createTemplateDraftRevision = (templateId: string, newContent: string) => {
    const access = verifyPersonaAccess(persona, 'template_editing');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }

    setTemplates(prev =>
      prev.map(t => {
        if (t.id === templateId) {
          const draftRev = {
            version: `${t.currentVersion}-draft`,
            status: 'DRAFT' as const,
            content: newContent,
            updatedAt: demoClock.slice(0, 16),
            updatedBy: persona.toUpperCase(),
          };
          return {
            ...t,
            content: newContent,
            activeStatus: 'DRAFT',
            revisions: [draftRev, ...t.revisions],
          };
        }
        return t;
      })
    );
    showDemoNotification('Draft template revision saved. Ready for owner review before publishing.', 'info');
  };

  const submitTemplateForReview = (templateId: string) => {
    const access = verifyPersonaAccess(persona, 'template_editing');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }
    setTemplates(prev =>
      prev.map(t => {
        if (t.id === templateId) {
          const revs = t.revisions.map((r, idx) =>
            idx === 0 ? { ...r, status: 'REVIEW' as const, updatedAt: demoClock.slice(0, 16) } : r
          );
          return {
            ...t,
            activeStatus: 'REVIEW',
            revisions: revs,
          };
        }
        return t;
      })
    );
    showDemoNotification('Template revision submitted for Owner / Admin compliance review.', 'info');
  };

  const updateJobTypeConfig = (
    typeId: string,
    formsRequired: ('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[],
    isDirectToInvoice: boolean
  ) => {
    const access = verifyPersonaAccess(persona, 'template_editing');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }
    setJobTypes(prev =>
      prev.map(jt =>
        jt.id === typeId
          ? {
              ...jt,
              formsRequired: isDirectToInvoice ? [] : formsRequired,
              isDirectToInvoice,
            }
          : jt
      )
    );
    showDemoNotification('Job type compliance matrix policy updated.', 'success');
  };

  // Certificate Delivery Workflow (G00-022)
  const sendCertificateEmail = (jobId: string, formType: string, simulateFail = false) => {
    const job = jobs.find(j => j.id === jobId);
    if (!job) return { success: false, message: 'Job not found' };

    let docTitle = '';
    let formSnapshot = '';
    let isSigned = false;

    if (formType === 'JSA') {
      const form = getOrCreateJsa(jobId);
      docTitle = `Job Safety Analysis (JSA) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
    } else if (formType === 'ELECTRICAL') {
      const form = getOrCreateElectrical(jobId);
      docTitle = `Certificate of Electrical Safety (Part A) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
    } else if (formType === 'SMOKE_ALARM') {
      const form = getOrCreateSmokeAlarm(jobId);
      docTitle = `Smoke Alarm Compliance Certificate — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
    } else if (formType === 'TCA1') {
      const form = getOrCreateTca1(jobId);
      docTitle = `Telecommunications Cabling Advice (TCA1) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
    } else if (formType === 'TCA2') {
      const form = getOrCreateTca2(jobId);
      docTitle = `Cabling Non-Compliance Notice (TCA2) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
    }

    if (!isSigned) {
      showDemoNotification(`CANNOT SEND: ${docTitle} is not signed off. Only finalized certificates can be dispatched.`, 'error');
      return { success: false, message: 'Document unsigned' };
    }

    seqCounters.reminder++;
    const deliveryId = `CERT-DELIV-${seqCounters.reminder}`;
    const newRecord: CertificateDeliveryRecord = {
      id: deliveryId,
      jobId,
      formType,
      recipientEmail: `${job.siteContact.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.invalid`,
      status: simulateFail ? 'FAILED' : 'SENT',
      sentAt: demoClock.slice(0, 16),
      documentTitle: docTitle,
      snapshotSummary: formSnapshot,
    };

    setCertificateDeliveries(prev => [newRecord, ...prev]);

    if (simulateFail) {
      showDemoNotification(`Certificate dispatch failed (Simulated SMTP Timeout 504). Retry available.`, 'error');
      return { success: false, message: 'Simulated dispatch failure' };
    }

    showDemoNotification(`Signed certificate emailed to ${newRecord.recipientEmail}. Snapshot preserved.`, 'success');
    return { success: true, message: 'Certificate delivered successfully' };
  };

  const retryCertificateDelivery = (deliveryId: string) => {
    setCertificateDeliveries(prev =>
      prev.map(d =>
        d.id === deliveryId
          ? { ...d, status: 'SENT', sentAt: demoClock.slice(0, 16) }
          : d
      )
    );
    showDemoNotification(`Certificate delivery ${deliveryId} retried and confirmed SENT.`, 'success');
  };

  // Website Enquiry Simulation (G00-011)
  const simulateWebsiteSubmission = (brandId: BrandId) => {
    seqCounters.enquiry++;
    const brandName = brands[brandId]?.name || 'CABMS Brand';
    const newEnquiry: WebsiteEnquiry = {
      id: `ENQ-2026-${seqCounters.enquiry}`,
      submissionDate: demoClock.slice(0, 16),
      sourceWebsite: `${brandName} Public Online Form`,
      brandId,
      customerName: 'Marcus Vance',
      email: 'marcus.v@vancelogistics.example.invalid',
      phone: '0400 000 003',
      address: '[Fictional] 88 Distribution Court, Yatala QLD 4207',
      serviceRequested: 'Urgent Security Camera Cabling Remediation Quotation',
      notes: 'Customer submitted follow-up request via website contact form.',
      status: 'PENDING_REVIEW',
      matchedExistingCustomerId: 'CUSTOMER-DEMO-003',
    };

    setWebsiteEnquiries(prev => [newEnquiry, ...prev]);
    showDemoNotification(`Simulated website enquiry received for ${brandName}. Queued in pending inbox.`, 'info');
  };

  const convertEnquiryToJob = (
    enquiryId: string,
    matchedCustomerId?: string,
    jobTypeId?: string
  ) => {
    const enq = websiteEnquiries.find(e => e.id === enquiryId);
    if (!enq) return { customerId: '', jobId: '' };

    if (enq.status === 'CONVERTED_TO_JOB') {
      showDemoNotification('This enquiry has already been converted to a work order.', 'warning');
      return { customerId: enq.matchedExistingCustomerId || '', jobId: enq.convertedJobId || '' };
    }

    // Customer match resolution
    let customerId = matchedCustomerId || enq.matchedExistingCustomerId;
    let unresolvedWarning: string | undefined;

    if (!customerId) {
      const res = simulateCustomerWriteThrough({
        name: enq.customerName,
        contactPerson: enq.customerName,
        email: enq.email,
        phone: enq.phone,
        billingAddress: enq.address,
        brandAffiliations: [enq.brandId],
        notes: `Converted from website enquiry ${enquiryId}`,
      });

      if (!res.success) {
        unresolvedWarning = 'Customer saved as unresolved local draft (MYOB offline). Work order created with pending sync flag.';
      }
      customerId = res.customer?.id || 'CUSTOMER-DEMO-001';
    }

    const matchedJt = jobTypes.find(jt => jt.id === jobTypeId) || jobTypes[0];

    const newJob = createJob({
      brandId: enq.brandId,
      customerId,
      title: `${enq.serviceRequested}`,
      jobType: matchedJt.name,
      formsRequired: matchedJt.formsRequired,
      isDirectToInvoice: matchedJt.isDirectToInvoice,
      siteAddress: enq.address,
      siteContact: enq.customerName,
      sitePhone: enq.phone,
      description: `Originating from enquiry ${enquiryId}: ${enq.notes}`,
    });

    setWebsiteEnquiries(prev =>
      prev.map(e =>
        e.id === enquiryId
          ? {
              ...e,
              status: 'CONVERTED_TO_JOB',
              convertedJobId: newJob.id,
              unresolvedCustomerWarning: unresolvedWarning,
            }
          : e
      )
    );

    showDemoNotification(`Enquiry ${enquiryId} converted to Work Order ${newJob.id}.`, 'success');
    return { customerId, jobId: newJob.id, unresolvedWarning };
  };

  const dismissEnquiry = (enquiryId: string) => {
    setWebsiteEnquiries(prev =>
      prev.map(e => (e.id === enquiryId ? { ...e, status: 'DISMISSED' } : e))
    );
    showDemoNotification(`Enquiry ${enquiryId} dismissed.`, 'info');
  };

  const updateBrandConfig = (updated: BrandConfig) => {
    setBrands(prev => ({ ...prev, [updated.id]: updated }));
    showDemoNotification(`Brand profile "${updated.name}" updated.`, 'success');
  };

  const addNewBrandProfile = (newBrand: BrandConfig) => {
    setBrands(prev => ({ ...prev, [newBrand.id]: newBrand }));
    showDemoNotification(`New configurable profile "${newBrand.name}" added for demonstration.`, 'success');
  };

  const simulateSignIn = (role: Persona) => {
    setPersona(role);
    setIsSimulatedSignedIn(true);
    showDemoNotification(`Signed in as ${role.toUpperCase()} (Simulated Demo Session).`, 'info');
  };

  const simulateSignOut = () => {
    setIsSimulatedSignedIn(false);
    showDemoNotification('Signed out of demo session.', 'info');
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
        technicians: INITIAL_TECHNICIANS,
        updateBrandConfig,
        addNewBrandProfile,
        isSimulatedSignedIn,
        simulateSignIn,
        simulateSignOut,
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
        setMyobStatus: status =>
          setMyobConnection(prev => ({
            ...prev,
            status,
            errorMessage: status === 'FAILED' ? 'Simulated MYOB Connection Error 504' : undefined,
          })),
        customers,
        simulateCustomerWriteThrough,
        reconcileUncertainCustomer,
        retryFailedCustomerSync,
        jobTypes,
        jobs,
        createJob,
        updateJobStatus,
        attemptCompleteJob,
        rescheduleJobAppointment,
        cancelJobAppointment,
        cancelWholeJob,
        reopenCancelledJob,
        getOrCreateJsa,
        getOrCreateElectrical,
        getOrCreateSmokeAlarm,
        getOrCreateTca1,
        getOrCreateTca2,
        updateJsaForm,
        updateElectricalForm,
        updateSmokeAlarmForm,
        updateTca1Form,
        updateTca2Form,
        signOffJsa,
        signOffSmokeAlarm,
        signOffElectrical,
        signOffTca1,
        signOffTca2,
        customerAckTca2,
        officeReviewTca2,
        sampleAttachments,
        attachSampleToJobForm,
        removeSampleFromJobForm,
        prepareQuoteForJob,
        simulateQuoteAcceptance,
        prepareInvoiceForJob,
        reconcileInvoiceSync,
        triggerReviewRequest,
        reconcileReviewRequest,
        certificateDeliveries,
        sendCertificateEmail,
        retryCertificateDelivery,
        templates,
        publishTemplateVersion,
        createTemplateDraftRevision,
        submitTemplateForReview,
        updateJobTypeConfig,
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
