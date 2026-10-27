/**
 * CABMS Application Context & In-Memory Deterministic State
 * Implements strict isolation with resettable seed state and full workflow continuity.
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  AppearanceMode,
  BrandingMode,
  VisualPreset,
  QuoteFollowUp,
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
  Tca2AuditRecord,
  AppointmentStatus,
  DraftBusinessProfile,
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
  INITIAL_TCA2_AUDIT,
  INITIAL_TECHNICIANS,
  INITIAL_TEMPLATES,
  INITIAL_WEBSITE_ENQUIRIES,
} from '../data/seedData.ts';
import { getMockDataAdapter } from '../services/index.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  verifyPersonaAccess,
  calculateReminderDueTime,
  CompletionValidationResult,
  processOfficeReviewTca2,
  processCustomerAckTca2,
  recalculateJobAttachments,
  processPublishTemplate,
  processReviewDispatch,
  validateSignedSnapshot,
} from '../utils/cabmsLogic.ts';
import { advanceBusinessClock, businessCalendarDate, serializeBusinessInstant, calculateQuoteFollowUpDates, calculateQuoteExpiration } from '../utils/businessTime.ts';

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
  appearance: AppearanceMode;
  setAppearance: (mode: AppearanceMode) => void;
  brandingMode: BrandingMode;
  setBrandingMode: (mode: BrandingMode) => void;
  visualPreset: VisualPreset;
  setVisualPreset: (preset: VisualPreset) => void;
  revokeQuote: (jobId: string, reason?: string) => { success: boolean; message: string };
  refuseQuote: (jobId: string, reason?: string) => { success: boolean; message: string };
  technicians: typeof INITIAL_TECHNICIANS;
  updateBrandConfig: (brand: BrandConfig) => { success: boolean; message?: string };
  addNewBrandProfile: (brand: BrandConfig) => void;
  draftBusinesses: DraftBusinessProfile[];
  createDraftBusiness: (profile: Omit<DraftBusinessProfile, 'id' | 'isDraft' | 'createdAt'>) => {
    success: boolean;
    error?: string;
    profile?: DraftBusinessProfile;
  };

  // Session & Demo Sign-in Simulation (G00-036)
  isSimulatedSignedIn: boolean;
  simulateSignIn: (role: Persona) => void;
  simulateSignOut: () => void;

  // Demo Controls & Clock
  demoClock: string; // ISO string
  advanceClock: (hours: number) => void;
  setDemoClock: (clock: string) => void;
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
  tca2AuditRecords: Record<string, Tca2AuditRecord>;
  getTca2AuditRecord: (jobId: string) => Tca2AuditRecord | undefined;

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
  triggerReviewRequest: (jobId: string, simulateOutcome?: 'FAIL' | 'UNCERTAIN') => { success: boolean; message: string };
  reconcileReviewRequest: (jobId: string, resolution?: 'SENT' | 'FAILED') => void;
  retryReviewRequest: (jobId: string) => { success: boolean; message: string };
  pendingReviewCount: number;
  resolvePendingReview: (jobId: string, forcedOutcome?: 'SENT' | 'FAIL' | 'UNCERTAIN') => { success: boolean; message?: string };
  resolveAllPendingReviews: () => void;

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

  // Authoritative State Inspection (for Tests & Dual Integrity Assertions)
  getAuthoritativeState: () => {
    jobs: Job[];
    tca2AuditRecords: Record<string, Tca2AuditRecord>;
    draftBusinesses: DraftBusinessProfile[];
    jsaForms?: Record<string, JsaFormData>;
    electricalCerts?: Record<string, ElectricalCertData>;
    smokeAlarmCerts?: Record<string, SmokeAlarmCertData>;
    tca1Certs?: Record<string, Tca1CertData>;
    tca2Certs?: Record<string, Tca2CertData>;
  };

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
  const [activeBrandId, setActiveBrandIdState] = useState<BrandId>('solarcell');

  const handleSetActiveBrandId = (b: BrandId) => {
    setActiveBrandIdState(b);
    const targetBrand = authoritativeBrandsRef.current[b] || brands[b];
    if (targetBrand?.preferredPreset) {
      setVisualPreset(targetBrand.preferredPreset, false);
    }
  };
  const [brands, setBrands] = useState<Record<string, BrandConfig>>(INITIAL_BRANDS);
  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [selectedJobId, setSelectedJobId] = useState<string | null>('JOB-2026-101');
  const [activeScenario, setActiveScenario] = useState<DemoScenario>('default');
  const [isSimulatedSignedIn, setIsSimulatedSignedIn] = useState(true);

    // Appearance & Visual Presets (Preset 2 — Dark + Company Branding is initial)
  const [appearance, setAppearanceState] = useState<AppearanceMode>('default_dark');
  const [brandingMode, setBrandingModeState] = useState<BrandingMode>('company');
  const [visualPreset, setVisualPresetState] = useState<VisualPreset>('dark_company');

  const setBrandingMode = (mode: BrandingMode) => {
    setBrandingModeState(mode);
    if (appearance === 'high_visibility_dark') {
      setVisualPresetState('high_visibility_dark');
    } else if (appearance === 'high_visibility_light') {
      setVisualPresetState(mode === 'company' ? 'light_company' : 'light_neutral');
    } else {
      setVisualPresetState(mode === 'company' ? 'dark_company' : 'dark_neutral');
    }
  };

  const setVisualPreset = (preset: VisualPreset, syncActiveBrand: boolean = false) => {
    setVisualPresetState(preset);
    switch (preset) {
      case 'dark_neutral':
        setAppearanceState('default_dark');
        setBrandingModeState('neutral');
        break;
      case 'dark_company':
        setAppearanceState('default_dark');
        setBrandingModeState('company');
        break;
      case 'light_neutral':
        setAppearanceState('high_visibility_light');
        setBrandingModeState('neutral');
        break;
      case 'light_company':
        setAppearanceState('high_visibility_light');
        setBrandingModeState('company');
        break;
      case 'high_visibility_dark':
        setAppearanceState('high_visibility_dark');
        break;
    }
    if (syncActiveBrand && activeBrandId) {
      authoritativeBrandsRef.current = {
        ...authoritativeBrandsRef.current,
        [activeBrandId]: {
          ...(authoritativeBrandsRef.current[activeBrandId] || brands[activeBrandId]),
          preferredPreset: preset,
        },
      };
      setBrands(prev => ({
        ...prev,
        [activeBrandId]: {
          ...prev[activeBrandId],
          preferredPreset: preset,
        },
      }));
    }
  };

  const setAppearance = (mode: AppearanceMode) => {
    if (mode === 'default_dark' || mode === 'high_visibility_light' || mode === 'high_visibility_dark') {
      setAppearanceState(mode);
      if (mode === 'high_visibility_dark') {
        setVisualPresetState('high_visibility_dark');
      } else if (mode === 'high_visibility_light') {
        setVisualPresetState(brandingMode === 'company' ? 'light_company' : 'light_neutral');
      } else {
        setVisualPresetState(brandingMode === 'company' ? 'dark_company' : 'dark_neutral');
      }
    } else {
      setAppearanceState('default_dark');
      setVisualPresetState(brandingMode === 'company' ? 'dark_company' : 'dark_neutral');
    }
  };

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-appearance', appearance);
      document.documentElement.setAttribute('data-branding', brandingMode);
      document.documentElement.setAttribute('data-company-panel', activeBrandId);
    }
  }, [appearance, brandingMode, activeBrandId]);

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

  const createSignedJsaSeed = (jobId: string): JsaFormData => {
    const job = INITIAL_JOBS.find(candidate => candidate.id === jobId);
    const brand = INITIAL_BRANDS[job?.brandId || 'solarcell'];
    const technicianName = job?.assignedTechName || INITIAL_JSA_FORM.personnelName;
    const isCctvJob = job?.brandId === 'cctv';
    const jobSafetySteps: JsaFormData['steps'] = isCctvJob
      ? [
          {
            id: 'cctv-step-1',
            taskStep: 'Establish controlled access and inspect camera work areas',
            hazards: 'Ladder falls, work above occupied areas, and dropped tools',
            initialRisk: 'H',
            controls: 'Inspect access equipment, secure the work zone below, and maintain three points of contact.',
            residualRisk: 'L',
            responsibleRole: 'Cabling Technician',
          },
          {
            id: 'cctv-step-2',
            taskStep: 'Route and terminate telecommunications cabling',
            hazards: 'Contact with existing electrical services, sharp edges, and trip hazards',
            initialRisk: 'H',
            controls: 'Identify existing services, maintain separation, protect cable paths, and keep walkways clear.',
            residualRisk: 'L',
            responsibleRole: 'Cabling Technician',
          },
          {
            id: 'cctv-step-3',
            taskStep: 'Mount and test security cameras',
            hazards: 'Drilling dust, falling objects, and unexpected equipment energisation',
            initialRisk: 'M',
            controls: 'Use eye protection, secure equipment during mounting, and verify the intended power source before testing.',
            residualRisk: 'L',
            responsibleRole: 'Cabling Technician',
          },
        ]
      : [
          {
            id: 'electrical-step-1',
            taskStep: 'Isolate and verify the three-phase inverter supply',
            hazards: 'Electric shock, arc flash, and unexpected re-energisation',
            initialRisk: 'E',
            controls: 'Apply lockout/tagout, prove the tester, test for dead, and re-prove the tester before work.',
            residualRisk: 'L',
            responsibleRole: 'Electrical Technician',
          },
          {
            id: 'electrical-step-2',
            taskStep: 'Remove and position the replacement inverter',
            hazards: 'Manual handling strain, sharp enclosure edges, and unstable access equipment',
            initialRisk: 'H',
            controls: 'Use an assessed lift plan, team assistance where needed, and stable access equipment.',
            residualRisk: 'L',
            responsibleRole: 'Electrical Technician',
          },
          {
            id: 'electrical-step-3',
            taskStep: 'Reconnect, test, and commission the inverter',
            hazards: 'Electrical fault, stored energy, and inadvertent circuit energisation',
            initialRisk: 'H',
            controls: 'Inspect terminations, use suitable test equipment, and re-energise only after the work area is clear.',
            residualRisk: 'L',
            responsibleRole: 'Electrical Technician',
          },
        ];
    const jobPpeChecklist: JsaFormData['ppeChecklist'] = isCctvJob
      ? [
          { item: 'Safety Boots', status: 'Yes', notes: 'Synthetic demo check' },
          { item: 'Eye Protection', status: 'Yes', notes: 'Synthetic demo check' },
          { item: 'Fall Protection / Suitable Ladder', status: 'Yes', notes: 'Select equipment for the work area' },
        ]
      : [
          { item: 'Safety Boots', status: 'Yes', notes: 'Synthetic demo check' },
          { item: 'Electrical Insulating Gloves', status: 'Yes', notes: 'Verify rating and inspection before use' },
          { item: 'Eye Protection', status: 'Yes', notes: 'Synthetic demo check' },
        ];
    const jobPermits: JsaFormData['isolationsAndPermits'] = isCctvJob
      ? [
          { item: 'Existing Services Identification', required: 'Yes', referenceOrNotes: 'Confirm services at the site before routing cabling' },
          { item: 'Work-at-Height Controls', required: 'Yes', referenceOrNotes: 'Select and inspect suitable access equipment' },
        ]
      : [
          { item: 'Electrical Isolation / Lockout', required: 'Yes', referenceOrNotes: 'Record the site isolation reference before work' },
          { item: 'Test for Dead', required: 'Yes', referenceOrNotes: 'Record the verification step in the work record' },
        ];
    const base: JsaFormData = {
      ...INITIAL_JSA_FORM,
      jobReference: jobId,
      date: job?.scheduledDate || INITIAL_JSA_FORM.date,
      customerName: job?.siteContact || INITIAL_JSA_FORM.customerName,
      siteContactPlaceholder: job ? `${job.siteContact} (${job.sitePhone})` : INITIAL_JSA_FORM.siteContactPlaceholder,
      siteAddress: job?.siteAddress || INITIAL_JSA_FORM.siteAddress,
      taskDescription: job?.description || INITIAL_JSA_FORM.taskDescription,
      assetsIdentified: job?.title || INITIAL_JSA_FORM.assetsIdentified,
      personnelName: technicianName,
      personnelRole: isCctvJob ? 'Cabling Technician / Safety Lead' : 'Electrical Technician / Safety Lead',
      licencePlaceholder: isCctvJob
        ? brand?.acmaCablerPlaceholder || 'Cabler registration not configured (Fictional Demo)'
        : brand?.electricalLicencePlaceholder || INITIAL_JSA_FORM.licencePlaceholder,
      issuerPlaceholder: brand?.legalIssuerName || INITIAL_JSA_FORM.issuerPlaceholder,
      overallRiskLevel: 'H',
      steps: jobSafetySteps,
      ppeChecklist: jobPpeChecklist,
      isolationsAndPermits: jobPermits,
      emergencyAssemblyArea: `Confirm site-specific assembly point at ${job?.siteAddress || 'the work site'}`,
      emergencyWardenPlaceholder: `Site contact: ${job?.siteContact || 'Confirm with site representative'}`,
      firstAidOfficerPlaceholder: technicianName,
      attachedSampleIds: job?.attachedSampleIds || INITIAL_JSA_FORM.attachedSampleIds,
      signedOff: true,
      signedByTechName: technicianName,
      signedTimestamp: '2026-11-02 09:30',
      frozenIssuerSnapshot: `${brand?.legalIssuerName || 'CABMS Demo'} • ${brand?.abnPlaceholder || 'Issuer placeholder'}`,
    };
    base.fullSnapshot = JSON.stringify(base);
    return base;
  };

  const createSignedTca2Seed = (): Tca2CertData => {
    const base = { ...INITIAL_TCA2_CERT };
    const frozenSnapshot = JSON.parse(INITIAL_TCA2_CERT.fullSnapshot || '{}');
    base.fullSnapshot = JSON.stringify({
      ...frozenSnapshot,
      customerAcknowledged: INITIAL_TCA2_CERT.customerAcknowledged,
      officeReviewCompleted: INITIAL_TCA2_CERT.officeReviewCompleted,
    });
    return base;
  };

  // Compliance Forms per Job (G00-005: job-owned instances)
  const [jsaForms, setJsaForms] = useState<Record<string, JsaFormData>>({
    'JOB-2026-101': { ...INITIAL_JSA_FORM },
    'JOB-2026-103': createSignedJsaSeed('JOB-2026-103'),
    'JOB-2026-104': createSignedJsaSeed('JOB-2026-104'),
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
    'JOB-2026-104': createSignedTca2Seed(),
  });

  const [tca2AuditRecords, setTca2AuditRecords] = useState<Record<string, Tca2AuditRecord>>(INITIAL_TCA2_AUDIT);
  const getTca2AuditRecord = (jobId: string): Tca2AuditRecord | undefined => tca2AuditRecords[jobId];

  // Non-operational draft business incubator (G00 separate draft storage)
  const [draftBusinesses, setDraftBusinesses] = useState<DraftBusinessProfile[]>([]);

  // Authoritative synchronous refs for indivisible state transitions and test harnesses
  const authoritativeJobsRef = React.useRef<Job[]>(INITIAL_JOBS);
  const authoritativeBrandsRef = React.useRef<Record<string, BrandConfig>>(INITIAL_BRANDS);
  const authoritativeAuditRecordsRef = React.useRef<Record<string, Tca2AuditRecord>>({ ...INITIAL_TCA2_AUDIT });
  const authoritativeDraftBusinessesRef = React.useRef<DraftBusinessProfile[]>([]);
  const authoritativePersonaRef = React.useRef<Persona>('owner_admin');
  const authoritativeSessionRef = React.useRef(true);
  const [authoritativeJsaFormsRef] = React.useState(() => ({
    current: {
      'JOB-2026-101': { ...INITIAL_JSA_FORM },
      'JOB-2026-103': createSignedJsaSeed('JOB-2026-103'),
      'JOB-2026-104': createSignedJsaSeed('JOB-2026-104'),
    } as Record<string, JsaFormData>,
  }));
  const [authoritativeElectricalCertsRef] = React.useState(() => ({
    current: {
      'JOB-2026-103': { ...INITIAL_ELECTRICAL_CERT },
    } as Record<string, ElectricalCertData>,
  }));
  const [authoritativeSmokeAlarmCertsRef] = React.useState(() => ({
    current: {
      'JOB-2026-101': { ...INITIAL_SMOKE_ALARM_CERT },
    } as Record<string, SmokeAlarmCertData>,
  }));
  const [authoritativeTca1CertsRef] = React.useState(() => ({
    current: {
      'JOB-2026-104': { ...INITIAL_TCA1_CERT },
    } as Record<string, Tca1CertData>,
  }));
  const [authoritativeTca2CertsRef] = React.useState(() => ({
    current: {
      'JOB-2026-104': createSignedTca2Seed(),
    } as Record<string, Tca2CertData>,
  }));
  const authoritativeCertificateDeliveriesRef = React.useRef<CertificateDeliveryRecord[]>([]);

  const canManageReviews = () => authoritativeSessionRef.current
    && (['super_admin', 'owner_admin', 'office_staff'] as Persona[]).includes(authoritativePersonaRef.current);

  const handleSetPersona = (p: Persona) => {
    authoritativePersonaRef.current = p;
    setPersona(p);
  };

  /**
   * Authoritative synchronous state mutation helper.
   * Computes nextJobs synchronously from authoritativeJobsRef.current,
   * updates authoritativeJobsRef.current immediately,
   * and schedules React state update setJobs(nextJobs).
   */
  const commitJobsState = (
    mutation: (currentJobs: Job[]) => Job[],
    auditMutation?: (currentAudits: Record<string, Tca2AuditRecord>) => Record<string, Tca2AuditRecord>
  ): Job[] => {
    const nextJobs = mutation(authoritativeJobsRef.current);
    authoritativeJobsRef.current = nextJobs;
    if (auditMutation) {
      const nextAudits = auditMutation(authoritativeAuditRecordsRef.current);
      authoritativeAuditRecordsRef.current = nextAudits;
      setTca2AuditRecords(nextAudits);
    }
    setJobs(nextJobs);
    return nextJobs;
  };

  // Synchronous execution refs to prevent duplicate calls in the same tick / before re-render
  const inFlightTca2ReviewsRef = React.useRef<Set<string>>(new Set());
  const completedTca2ReviewsRef = React.useRef<Map<string, string>>(new Map());
  const pendingReviewDispatchRef = React.useRef<Set<string>>(new Set());
  const pendingReviewOutcomeRef = React.useRef<Map<string, 'SENT' | 'FAILED' | 'UNCERTAIN'>>(new Map());

  const createDraftBusiness = (profile: Omit<DraftBusinessProfile, 'id' | 'isDraft' | 'createdAt'>): {
    success: boolean;
    error?: string;
    profile?: DraftBusinessProfile;
  } => {
    const callerPersona = authoritativePersonaRef.current;
    if (callerPersona !== 'super_admin') {
      const err = 'Unauthorized: Incubating draft businesses requires Super Admin authority.';
      showDemoNotification(err, 'error');
      return { success: false, error: err };
    }
    // Slug validation: must not collide with operational brands or existing drafts
    const slug = (profile.slug || profile.name.toLowerCase().replace(/[^a-z0-9]/g, '_')).trim().toLowerCase();
    const operationalSlugs = ['solarcell', 'smart_home', 'cctv'];
    if (operationalSlugs.includes(slug)) {
      showDemoNotification(`ERROR: Slug "${slug}" is reserved for active operational brand.`, 'error');
      return { success: false, error: `Slug "${slug}" is reserved for an operational brand.` };
    }
    if (authoritativeDraftBusinessesRef.current.some(d => d.slug === slug)) {
      showDemoNotification(`ERROR: Draft slug "${slug}" already exists.`, 'error');
      return { success: false, error: `Draft business slug "${slug}" is already in use.` };
    }

    seqCounters.revision++;
    const draftId = `DRAFT-BIZ-${seqCounters.revision}`;
    const newDraft: DraftBusinessProfile = {
      ...profile,
      slug,
      id: draftId,
      isDraft: true,
      createdAt: businessCalendarDate(demoClock),
    };
    authoritativeDraftBusinessesRef.current = [...authoritativeDraftBusinessesRef.current, newDraft];
    setDraftBusinesses([...authoritativeDraftBusinessesRef.current]);
    showDemoNotification(`Draft business profile "${newDraft.name}" saved to incubator. Excluded from operational brand switcher.`, 'info');
    return { success: true, profile: newDraft };
  };

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
    inFlightTca2ReviewsRef.current.clear();
    completedTca2ReviewsRef.current.clear();
    pendingReviewDispatchRef.current.clear();
    pendingReviewOutcomeRef.current.clear();
    authoritativeJobsRef.current = INITIAL_JOBS;
    authoritativeAuditRecordsRef.current = { ...INITIAL_TCA2_AUDIT };
    authoritativeDraftBusinessesRef.current = [];
    authoritativePersonaRef.current = 'owner_admin';
    authoritativeSessionRef.current = true;
    authoritativeBrandsRef.current = INITIAL_BRANDS;
    setDraftBusinesses([]);
    setPersona('owner_admin');
    setActiveBrandIdState('solarcell');
    setVisualPreset('dark_company', false);
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
    authoritativeCertificateDeliveriesRef.current = [];
    setCertificateDeliveries([]);
    setJsaForms({
      'JOB-2026-101': { ...INITIAL_JSA_FORM },
      'JOB-2026-103': createSignedJsaSeed('JOB-2026-103'),
      'JOB-2026-104': createSignedJsaSeed('JOB-2026-104'),
    });
    authoritativeJsaFormsRef.current = {
      'JOB-2026-101': { ...INITIAL_JSA_FORM },
      'JOB-2026-103': createSignedJsaSeed('JOB-2026-103'),
      'JOB-2026-104': createSignedJsaSeed('JOB-2026-104'),
    };
    authoritativeElectricalCertsRef.current = { 'JOB-2026-103': { ...INITIAL_ELECTRICAL_CERT } };
    authoritativeSmokeAlarmCertsRef.current = { 'JOB-2026-101': { ...INITIAL_SMOKE_ALARM_CERT } };
    authoritativeTca1CertsRef.current = { 'JOB-2026-104': { ...INITIAL_TCA1_CERT } };
    authoritativeTca2CertsRef.current = { 'JOB-2026-104': createSignedTca2Seed() };
    setElectricalCerts({ 'JOB-2026-103': { ...INITIAL_ELECTRICAL_CERT } });
    setSmokeAlarmCerts({ 'JOB-2026-101': { ...INITIAL_SMOKE_ALARM_CERT } });
    setTca1Certs({ 'JOB-2026-104': { ...INITIAL_TCA1_CERT } });
    setTca2Certs({ 'JOB-2026-104': createSignedTca2Seed() });
    setTca2AuditRecords({ ...INITIAL_TCA2_AUDIT });
    setSelectedJobId('JOB-2026-101');
    setActiveTab('dashboard');
    setActiveScenario('default');
    void getMockDataAdapter().resetToBaseline();
    showDemoNotification('Preview restored to clean initial baseline state.', 'success');
  };

  const resolveReviewJob = (
    job: Job,
    outcome: 'SENT' | 'FAILED' | 'UNCERTAIN',
    timestamp: string,
    brandName: string,
    actor: string
  ): Job => {
    const message = outcome === 'SENT'
      ? actor === 'Automated System Clock'
        ? `Automated simulated dispatch completed for ${brandName} on virtual clock advance`
        : `Email invitation sent to customer for ${brandName}`
      : outcome === 'FAILED'
        ? 'Simulated dispatch failure: SMTP 550 delivery rejection'
        : 'Simulated dispatch gateway timeout (504 Gateway Timeout) - delivery outcome uncertain';
    const activity = outcome === 'SENT'
      ? `Review invitation sent to customer (${brandName})`
      : outcome === 'FAILED'
        ? 'Review request dispatch failed (SMTP 550)'
        : 'Review request dispatch resulted in UNCERTAIN status (504)';

    return {
      ...job,
      reviewRequest: {
        ...job.reviewRequest,
        status: outcome,
        sentTimestamp: outcome === 'SENT' ? timestamp : undefined,
        uncertainReconciliationNeeded: outcome === 'UNCERTAIN',
        history: [...job.reviewRequest.history, { timestamp, event: message, status: outcome }],
      },
      activityHistory: [...job.activityHistory, { timestamp, action: activity, actor }],
    };
  };

  const setDemoClockExplicit = (instant: string) => {
    setDemoClock(serializeBusinessInstant(instant));
  };

  // Clock Advancement with Deterministic Event Processor (G00-020)
  const advanceClock = (hours: number) => {
    const newClock = advanceBusinessClock(demoClock, hours);
    const current = new Date(newClock);
    setDemoClock(newClock);

    let deliveredCount = 0;
    let resolvedCount = 0;

    commitJobsState(currentJobs => {
      return currentJobs.map(j => {
        let updatedJob = { ...j };

        // 1. Process due reminders
        const updatedReminders = updatedJob.reminders.map(r => {
          if (!r.delivered && !r.suppressed) {
            const schedDate = new Date(r.scheduledFor.replace(' ', 'T') + ':00+10:00');
            if (schedDate <= current) {
              deliveredCount++;
              return {
                ...r,
                delivered: true,
                deliveredAt: newClock,
              };
            }
          }
          return r;
        });
        updatedJob.reminders = updatedReminders;

        // 2. Auto-resolve review requests in PENDING state as an automated system event
        if (updatedJob.reviewRequest?.status === 'PENDING') {
          resolvedCount++;
          const brand = brands[updatedJob.brandId] || brands.solarcell;
          const outcome = pendingReviewOutcomeRef.current.get(j.id)
            || (activeScenario === 'myob_uncertain' ? 'UNCERTAIN' : 'SENT');
          updatedJob = resolveReviewJob(updatedJob, outcome, newClock, brand.name, 'Automated System Clock');
          pendingReviewOutcomeRef.current.delete(j.id);
        }

        // 3. Process quote follow-ups and expiration (14 calendar days expiry & cap)
        if (updatedJob.quote) {
          const q = updatedJob.quote;
          const quoteCurrentDate = businessCalendarDate(newClock);
          const isQuoteExpired = q.expiresAt ? new Date(newClock) >= new Date(q.expiresAt) : false;

          let quoteUpdated = false;
          let newAcceptanceStatus = q.acceptanceStatus;
          let newAcceptanceHistory = [...q.acceptanceHistory];

          // Transition to EXPIRED if past 14 calendar days
          if (isQuoteExpired && (q.acceptanceStatus === 'SENT' || q.acceptanceStatus === 'DRAFT')) {
            newAcceptanceStatus = 'EXPIRED';
            newAcceptanceHistory.push({
              timestamp: newClock,
              action: 'Quotation expired (14-calendar-day validity period exceeded)',
              actor: 'Automated System Clock',
            });
            quoteUpdated = true;
          }

          if (q.followUps && q.followUps.length > 0) {
            let followUpsChanged = false;
            const updatedFollowUps = q.followUps.map(fu => {
              if (fu.status === 'SCHEDULED') {
                if (
                  newAcceptanceStatus === 'EXPIRED' ||
                  newAcceptanceStatus === 'ACCEPTED' ||
                  newAcceptanceStatus === 'REVOKED' ||
                  newAcceptanceStatus === 'SUPERSEDED'
                ) {
                  followUpsChanged = true;
                  return { ...fu, status: 'CANCELLED' as const };
                }

                if (fu.scheduledDate <= quoteCurrentDate && !isQuoteExpired) {
                  followUpsChanged = true;
                  deliveredCount++;
                  newAcceptanceHistory.push({
                    timestamp: newClock,
                    action: `Quotation follow-up email dispatched (${fu.stage === 'STAGE_1_COURTESY' ? 'Stage 1 Courtesy' : 'Stage 2 Expiry Warning'})`,
                    actor: 'Automated System Service',
                  });
                  return {
                    ...fu,
                    status: 'SENT' as const,
                    sentAt: newClock,
                  };
                }
              }
              return fu;
            });

            if (followUpsChanged || quoteUpdated) {
              updatedJob.quote = {
                ...q,
                acceptanceStatus: newAcceptanceStatus,
                acceptanceHistory: newAcceptanceHistory,
                followUps: updatedFollowUps,
              };
            }
          } else if (quoteUpdated) {
            updatedJob.quote = {
              ...q,
              acceptanceStatus: newAcceptanceStatus,
              acceptanceHistory: newAcceptanceHistory,
            };
          }
        }

        return updatedJob;
      });
    });

    showDemoNotification(
      `Demo business clock advanced by ${hours} hr(s). ${deliveredCount > 0 ? `${deliveredCount} due email reminder(s) dispatched.` : ''} ${resolvedCount > 0 ? `${resolvedCount} pending review(s) auto-resolved.` : ''}`,
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
      const currentAuthoritativeJsa = authoritativeJsaFormsRef.current['JOB-2026-101'];
      if (currentAuthoritativeJsa?.signedOff) {
        showDemoNotification(
          'Scenario: Job JOB-2026-101 already has a finalized signed JSA snapshot. Immutability preserved — use Reset Demo to restore initial unsigned scenario state.',
          'warning'
        );
      } else {
        const resetJsa = { ...(currentAuthoritativeJsa || INITIAL_JSA_FORM), signedOff: false };
        authoritativeJsaFormsRef.current = {
          ...authoritativeJsaFormsRef.current,
          'JOB-2026-101': resetJsa,
        };
        setJsaForms(prev => ({
          ...prev,
          'JOB-2026-101': resetJsa,
        }));
        showDemoNotification('Scenario: Documentation Job with JSA missing sign-off loaded.', 'info');
      }
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
      handleSetPersona('technician');
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
        createdAt: businessCalendarDate(demoClock),
        isRecoverableDraft: true,
        activityHistory: [
          { timestamp: serializeBusinessInstant(demoClock), action: 'Draft entry saved locally (MYOB Offline)', actor: persona },
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
        createdAt: businessCalendarDate(demoClock),
        isRecoverableDraft: true,
        activityHistory: [
          { timestamp: serializeBusinessInstant(demoClock), action: 'Uncertain response from MYOB. Reconciliation queued.', actor: persona },
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
      createdAt: businessCalendarDate(demoClock),
      isRecoverableDraft: false,
      activityHistory: [
        { timestamp: serializeBusinessInstant(demoClock), action: `Created & acknowledged in MYOB Business (#MYOB-DEMO-${seqCounters.customer})`, actor: persona },
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
                { timestamp: serializeBusinessInstant(demoClock), action: 'Reconciled: Confirmed created in MYOB', actor: persona },
              ],
            };
          } else {
            return {
              ...c,
              syncStatus: 'FAILED',
              notes: 'Reconciliation discarded duplicate entry.',
              activityHistory: [
                ...(c.activityHistory || []),
                { timestamp: serializeBusinessInstant(demoClock), action: 'Reconciled: Discarded as duplicate', actor: persona },
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
              { timestamp: serializeBusinessInstant(demoClock), action: 'Retry successful: Synced to MYOB', actor: persona },
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
    // Runtime brand isolation check: ensure brand is strictly an operational brand, never draft
    const targetBrandId: BrandId = (['solarcell', 'smart_home', 'cctv'].includes(jobData.brandId as any))
      ? (jobData.brandId as BrandId)
      : activeBrandId;

    // Known job types are business-bound; never reinterpret a foreign business type.
    const requestedJobType = jobTypes.find(jt => jt.id === jobData.jobType || jt.name === jobData.jobType);
    if (requestedJobType && requestedJobType.brandId !== targetBrandId) {
      const message = `Job type ${requestedJobType.name} belongs to ${brands[requestedJobType.brandId]?.name || requestedJobType.brandId}, not ${brands[targetBrandId]?.name || targetBrandId}.`;
      showDemoNotification(message, 'error');
      throw new Error(message);
    }

    // Preserve the legacy free-text entry path, but keep its configured fallback within this business.
    const matchedJobType = requestedJobType || jobTypes.find(jt => jt.brandId === targetBrandId);
    if (!matchedJobType) {
      const message = `No configured job type is available for ${targetBrandId}.`;
      showDemoNotification(message, 'error');
      throw new Error(message);
    }

    seqCounters.job++;
    const nextId = `JOB-2026-${seqCounters.job}`;

    // Mandatory forms configured on the Job Type plus optional user-selected forms
    const mandatory = matchedJobType.formsRequired || [];
    const requested = jobData.formsRequired || [];
    const forms = Array.from(new Set([...mandatory, ...requested]));
    const isDirect = forms.length === 0 ? Boolean(jobData.isDirectToInvoice) : false;

    // P0: Decouple technician assignment from appointment scheduling
    // A technician can be assigned to a NEW, UNSCHEDULED job.
    // Full tuple (tech, date, time) is required only for active appointment (SCHEDULED).
    const assignedTechId = jobData.assignedTechId ? (jobData.assignedTechId as string) : null;
    const assignedTechName = assignedTechId
      ? INITIAL_TECHNICIANS.find(t => t.id === assignedTechId)?.name || jobData.assignedTechName || 'Dave Miller'
      : null;

    const hasCompleteAppointment = Boolean(
      assignedTechId &&
      jobData.scheduledDate &&
      jobData.scheduledTime
    );
    const scheduledDate = hasCompleteAppointment ? (jobData.scheduledDate as string) : null;
    const scheduledTime = hasCompleteAppointment ? (jobData.scheduledTime as string) : null;
    const appointmentStatus: AppointmentStatus = hasCompleteAppointment ? 'SCHEDULED' : 'UNSCHEDULED';
    const status: JobStatus = hasCompleteAppointment ? (jobData.status || 'SCHEDULED') : (jobData.status || 'NEW');
    const calendarSyncStatus = hasCompleteAppointment ? 'SYNCED' : 'PENDING';

    // Calculate reminder due time only for complete active appointments (E/I Reminders)
    const reminders: ScheduledReminder[] = [];
    if (hasCompleteAppointment && scheduledDate && scheduledTime) {
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
      brandId: targetBrandId,
      customerId: jobData.customerId || customers[0].id,
      title: jobData.title || `${matchedJobType.name} Request`,
      jobType: matchedJobType.name,
      jobTypeVersion: matchedJobType.version,
      siteAddress: jobData.siteAddress || '[Fictional] Site Address',
      siteContact: jobData.siteContact || 'Contact Person',
      sitePhone: jobData.sitePhone || '0400 000 000',
      description: jobData.description || 'Service call details',
      status,
      appointmentStatus,
      calendarMapping: brands[targetBrandId]?.calendarMappingName || 'Primary Dispatch Calendar',
      calendarSyncStatus,
      assignedTechId,
      assignedTechName,
      scheduledDate,
      scheduledTime,
      estimatedDurationHours: jobData.estimatedDurationHours || 2,
      isDirectToInvoice: isDirect,
      formsRequired: forms,
      attachedSampleIds: [],
      reviewRequest: {
        status: 'NOT_SENT',
        reviewLink: brands[targetBrandId]?.reviewUrlPlaceholder || '',
        brandName: brands[targetBrandId]?.name || 'CABMS Brand',
        channel: 'EMAIL_SIMULATED',
        history: [],
      },
      reminders,
      unresolvedWarnings: [
        ...(jobData.unresolvedWarnings || []),
        ...(isDirect ? ['Direct-to-invoice service: no compliance documentation required.'] : []),
      ],
      activityHistory: [
        {
          timestamp: serializeBusinessInstant(demoClock),
          action: `Work order created (${matchedJobType.name} ${matchedJobType.version})`,
          actor: persona,
          notes: assignedTechId ? `Assigned to ${assignedTechId} (${assignedTechName})` : 'Unassigned pool',
        },
      ],
    };

    commitJobsState(current => [newJob, ...current]);
    showDemoNotification(`Job ${newJob.id} created successfully.`, 'success');
    return newJob;
  };

  const updateJobStatus = (jobId: string, newStatus: JobStatus) => {
    commitJobsState(current => current.map(j =>
      j.id === jobId
        ? {
            ...j,
            status: newStatus,
            activityHistory: [
              ...j.activityHistory,
              { timestamp: serializeBusinessInstant(demoClock), action: `Operational status updated to ${newStatus}`, actor: persona },
            ],
          }
        : j
    ));
    showDemoNotification(`Job ${jobId} status updated to ${newStatus}.`, 'info');
  };

  const attemptCompleteJob = (jobId: string): CompletionValidationResult => {
    const currentJobs = authoritativeJobsRef.current;
    const job = currentJobs.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) {
      return { canComplete: false, missingRequirements: ['Job not found'], warnings: [], isDirectToInvoice: false };
    }

    // Pass the job's own form instances and authoritative audit record (reading latest authoritative refs)
    const forms = {
      jsa: authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId],
      electrical: authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId],
      smokeAlarm: authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId],
      tca1: authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId],
      tca2: authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId],
    };

    const auditRecord = authoritativeAuditRecordsRef.current[jobId] || tca2AuditRecords[jobId];
    const validation = validateJobCompletion(job, forms, auditRecord);

    if (validation.canComplete) {
      commitJobsState(current => current.map(j =>
        j.id === jobId
          ? {
              ...j,
              status: 'COMPLETED',
              completedAt: serializeBusinessInstant(demoClock),
              completionNotes: 'All applicable synthetic demo completion requirements satisfied.',
              activityHistory: [
                ...j.activityHistory,
                { timestamp: serializeBusinessInstant(demoClock), action: 'Job marked COMPLETED (requirements validated)', actor: persona },
              ],
            }
          : j
      ));
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
    // FC-10: Read authoritative synchronous state to guard against same-render race conditions
    const targetJob = authoritativeJobsRef.current.find(j => j.id === jobId);
    if (!targetJob) return;

    // FC-10: Reject rescheduling on terminal jobs (COMPLETED or CANCELLED)
    if (targetJob.status === 'COMPLETED' || targetJob.status === 'CANCELLED') {
      showDemoNotification(
        `RESCHEDULE BLOCKED: Cannot reschedule a ${targetJob.status.toLowerCase()} job.`,
        'error'
      );
      return;
    }

    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId) {
          // Preserve terminal state invariant during mutation
          if (j.status === 'COMPLETED' || j.status === 'CANCELLED') {
            return j;
          }

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
            status: (j.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'SCHEDULED') as JobStatus,
            appointmentStatus: 'RESCHEDULED',
            calendarSyncStatus: 'SYNCED',
            reminders: [...updatedReminders, newReminder],
            activityHistory: [
              ...j.activityHistory,
              { timestamp: serializeBusinessInstant(demoClock), action: `Appointment rescheduled to ${newDate} ${newTime}`, actor: persona },
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
    // FC-10: Guard appointment cancellation against terminal jobs using authoritative synchronous state
    const targetJob = authoritativeJobsRef.current.find(j => j.id === jobId);
    if (!targetJob) return;

    if (targetJob.status === 'COMPLETED' || targetJob.status === 'CANCELLED') {
      showDemoNotification(
        `APPOINTMENT CANCELLATION BLOCKED: Cannot cancel appointment for a ${targetJob.status.toLowerCase()} job.`,
        'error'
      );
      return;
    }

    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId) {
          // Preserve terminal state invariant during mutation
          if (j.status === 'COMPLETED' || j.status === 'CANCELLED') {
            return j;
          }

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
              { timestamp: serializeBusinessInstant(demoClock), action: `Visit cancelled (${reason}). Appointment status marked CANCELLED. Job remains active for rescheduling.`, actor: persona },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Appointment for Job ${jobId} cancelled. Reminders suppressed. Job remains open for rescheduling.`, 'warning');
  };

  const cancelWholeJob = (jobId: string, reason: string) => {
    commitJobsState(current =>
      current.map(j => {
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
              { timestamp: serializeBusinessInstant(demoClock), action: `Job CANCELLED: ${reason}`, actor: persona },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Job ${jobId} marked CANCELLED.`, 'warning');
  };

  const reopenCancelledJob = (jobId: string) => {
    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId) {
          const hasCompleteAppointment = Boolean(j.assignedTechId && j.scheduledDate && j.scheduledTime);
          const newStatus: JobStatus = hasCompleteAppointment ? 'SCHEDULED' : 'NEW';
          const newApptStatus: AppointmentStatus = hasCompleteAppointment ? 'SCHEDULED' : 'UNSCHEDULED';
          return {
            ...j,
            status: newStatus,
            appointmentStatus: newApptStatus,
            activityHistory: [
              ...j.activityHistory,
              {
                timestamp: serializeBusinessInstant(demoClock),
                action: hasCompleteAppointment
                  ? 'Job reopened from cancelled state and returned to active schedule'
                  : 'Job reopened from cancelled state as unscheduled new work order',
                actor: persona,
              },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Job ${jobId} reopened from cancelled state.`, 'info');
  };

  // Pure default form builders (avoids render-phase state mutations)
  const buildDefaultJsa = (jobId: string): JsaFormData => {
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    return {
      jobReference: jobId,
      date: job?.scheduledDate || businessCalendarDate(demoClock),
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
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const baseSuffix = jobId.replace(/^JOB-/, '');
    let candidate = `ELEC-CERT-${baseSuffix}`;

    // FC-20: Ensure candidate does not collide with historical signed certificates or other jobs
    const existingRefs = new Set<string>();
    for (const [key, cert] of Object.entries(authoritativeElectricalCertsRef.current)) {
      if (key !== jobId && cert.certReference) existingRefs.add(cert.certReference);
    }
    if (INITIAL_ELECTRICAL_CERT.jobReference !== jobId && INITIAL_ELECTRICAL_CERT.certReference) {
      existingRefs.add(INITIAL_ELECTRICAL_CERT.certReference);
    }

    if (existingRefs.has(candidate)) {
      let counter = 1;
      while (existingRefs.has(`${candidate}-${counter}`)) {
        counter++;
      }
      candidate = `${candidate}-${counter}`;
    }

    return {
      certReference: candidate,
      jobReference: jobId,
      dateOfTest: job?.scheduledDate || businessCalendarDate(demoClock),
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
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const baseSuffix = jobId.replace(/^JOB-/, '');
    let candidate = `SMOKE-${baseSuffix}`;

    // FC-20: Ensure candidate does not collide with historical signed certificates or other jobs
    const existingRefs = new Set<string>();
    for (const [key, cert] of Object.entries(authoritativeSmokeAlarmCertsRef.current)) {
      if (key !== jobId && cert.certReference) existingRefs.add(cert.certReference);
    }
    if (INITIAL_SMOKE_ALARM_CERT.jobReference !== jobId && INITIAL_SMOKE_ALARM_CERT.certReference) {
      existingRefs.add(INITIAL_SMOKE_ALARM_CERT.certReference);
    }

    if (existingRefs.has(candidate)) {
      let counter = 1;
      while (existingRefs.has(`${candidate}-${counter}`)) {
        counter++;
      }
      candidate = `${candidate}-${counter}`;
    }

    return {
      certReference: candidate,
      jobReference: jobId,
      dateOfInspection: job?.scheduledDate || businessCalendarDate(demoClock),
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
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const baseSuffix = jobId.replace(/^JOB-/, '');
    let candidate = `TCA1-${baseSuffix}`;

    // FC-20: Ensure candidate does not collide with historical signed certificates or other jobs
    const existingRefs = new Set<string>();
    for (const [key, cert] of Object.entries(authoritativeTca1CertsRef.current)) {
      if (key !== jobId && cert.certReference) existingRefs.add(cert.certReference);
    }
    if (INITIAL_TCA1_CERT.jobReference !== jobId && INITIAL_TCA1_CERT.certReference) {
      existingRefs.add(INITIAL_TCA1_CERT.certReference);
    }

    if (existingRefs.has(candidate)) {
      let counter = 1;
      while (existingRefs.has(`${candidate}-${counter}`)) {
        counter++;
      }
      candidate = `${candidate}-${counter}`;
    }

    return {
      certReference: candidate,
      jobReference: jobId,
      registeredCablerPlaceholder: job?.assignedTechName || 'Alex Taylor',
      cablerRegistrationNumberPlaceholder: 'ACMA-REG-44210-DEMO',
      employerDetailsPlaceholder: brands[job?.brandId || activeBrandId]?.legalIssuerName || 'Gold Coast CCTV & Cabling',
      dateOfWork: job?.scheduledDate || businessCalendarDate(demoClock),
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
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const baseSuffix = jobId.replace(/^JOB-/, '');
    let candidate = `TCA2-DEFECT-${baseSuffix}`;

    // FC-20: Ensure candidate does not collide with historical signed certificates or other jobs
    const existingRefs = new Set<string>();
    for (const [key, cert] of Object.entries(authoritativeTca2CertsRef.current)) {
      if (key !== jobId && cert.reportReference) existingRefs.add(cert.reportReference);
    }
    if (INITIAL_TCA2_CERT.jobReference !== jobId && INITIAL_TCA2_CERT.reportReference) {
      existingRefs.add(INITIAL_TCA2_CERT.reportReference);
    }

    if (existingRefs.has(candidate)) {
      let counter = 1;
      while (existingRefs.has(`${candidate}-${counter}`)) {
        counter++;
      }
      candidate = `${candidate}-${counter}`;
    }

    return {
      reportReference: candidate,
      jobReference: jobId,
      inspectionDate: job?.scheduledDate || businessCalendarDate(demoClock),
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

  // Pure Read-Only Form Getters (zero render-phase mutations, state writes, or ref writes)
  const getOrCreateJsa = (jobId: string): JsaFormData => {
    return authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId] || buildDefaultJsa(jobId);
  };

  const getOrCreateElectrical = (jobId: string): ElectricalCertData => {
    return authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId] || buildDefaultElectrical(jobId);
  };

  const getOrCreateSmokeAlarm = (jobId: string): SmokeAlarmCertData => {
    return authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
  };

  const getOrCreateTca1 = (jobId: string): Tca1CertData => {
    return authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId] || buildDefaultTca1(jobId);
  };

  const getOrCreateTca2 = (jobId: string): Tca2CertData => {
    return authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId] || buildDefaultTca2(jobId);
  };

  // Form Field Updates with Immutability Guards for Signed Documents
  const updateJsaForm = (jobId: string, data: Partial<JsaFormData>) => {
    const existing = authoritativeJsaFormsRef.current[jobId] || buildDefaultJsa(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: JSA for Job ${jobId} is finalized and signed off. Edits are refused.`, 'error');
      return;
    }
    const updated = { ...existing, ...data };
    authoritativeJsaFormsRef.current[jobId] = updated;
    setJsaForms(prev => ({
      ...prev,
      [jobId]: updated,
    }));
  };

  const updateElectricalForm = (jobId: string, data: Partial<ElectricalCertData>) => {
    const existing = authoritativeElectricalCertsRef.current[jobId] || buildDefaultElectrical(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: Electrical Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    const updated = { ...existing, ...data };
    authoritativeElectricalCertsRef.current[jobId] = updated;
    setElectricalCerts(prev => ({
      ...prev,
      [jobId]: updated,
    }));
  };

  const updateSmokeAlarmForm = (jobId: string, data: Partial<SmokeAlarmCertData>) => {
    const existing = authoritativeSmokeAlarmCertsRef.current[jobId] || buildDefaultSmokeAlarm(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: Smoke Alarm Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    const updated = { ...existing, ...data };
    authoritativeSmokeAlarmCertsRef.current[jobId] = updated;
    setSmokeAlarmCerts(prev => ({
      ...prev,
      [jobId]: updated,
    }));
  };

  const updateTca1Form = (jobId: string, data: Partial<Tca1CertData>) => {
    const existing = authoritativeTca1CertsRef.current[jobId] || buildDefaultTca1(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: TCA1 Certificate for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    const updated = { ...existing, ...data };
    authoritativeTca1CertsRef.current[jobId] = updated;
    setTca1Certs(prev => ({
      ...prev,
      [jobId]: updated,
    }));
  };

  const updateTca2Form = (jobId: string, data: Partial<Tca2CertData>) => {
    const existing = authoritativeTca2CertsRef.current[jobId] || buildDefaultTca2(jobId);
    if (existing.signedOff) {
      showDemoNotification(`IMMUTABLE: TCA2 Report for Job ${jobId} is signed off. Edits are refused.`, 'error');
      return;
    }
    const updated = { ...existing, ...data };
    authoritativeTca2CertsRef.current[jobId] = updated;
    setTca2Certs(prev => ({
      ...prev,
      [jobId]: updated,
    }));
  };

  // Finalization with Frozen Issuer Snapshot and Full Document Snapshot
  const signOffJsa = (jobId: string) => {
    // Read latest authoritative state to guard against same-render stale closures
    const current = authoritativeJsaFormsRef.current[jobId] || buildDefaultJsa(jobId);
    if (current.signedOff) {
      showDemoNotification('JSA is already finalized and signed off.', 'warning');
      return;
    }
    if (!current.inductionCompleted || !current.competencyVerified) {
      showDemoNotification('SIGN-OFF BLOCKED: Both Site Induction and Competencies Verified must be confirmed before sign-off.', 'error');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.solarcell;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = serializeBusinessInstant(demoClock);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: JsaFormData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);
    const validation = validateSignedSnapshot(finalized.fullSnapshot, jobId, 'JSA');
    if (!validation.valid) {
      showDemoNotification(`SIGN-OFF BLOCKED: ${validation.error}`, 'error');
      return;
    }

    authoritativeJsaFormsRef.current[jobId] = finalized;
    setJsaForms(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`JSA signed off with DEMO mark for Job ${jobId}. Full document snapshot frozen.`, 'success');
  };

  const signOffSmokeAlarm = (jobId: string) => {
    // Read latest authoritative state to guard against same-render stale closures
    const current = authoritativeSmokeAlarmCertsRef.current[jobId] || buildDefaultSmokeAlarm(jobId);
    if (current.signedOff) {
      showDemoNotification('Smoke Alarm Certificate is already signed off.', 'warning');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.smart_home;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = serializeBusinessInstant(demoClock);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: SmokeAlarmCertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);
    const validation = validateSignedSnapshot(finalized.fullSnapshot, jobId, 'SMOKE_ALARM');
    if (!validation.valid) {
      showDemoNotification(`SIGN-OFF BLOCKED: ${validation.error}`, 'error');
      return;
    }

    authoritativeSmokeAlarmCertsRef.current[jobId] = finalized;
    setSmokeAlarmCerts(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`Smoke Alarm Certificate signed off for Job ${jobId}. Snapshot frozen.`, 'success');
  };

  const signOffElectrical = (jobId: string) => {
    // Read latest authoritative state to guard against same-render stale closures
    const current = authoritativeElectricalCertsRef.current[jobId] || buildDefaultElectrical(jobId);
    if (current.signedOff) {
      showDemoNotification('Electrical Certificate Part A is already signed off.', 'warning');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.solarcell;
    const signer = job?.assignedTechName || 'Dave Miller';
    const timestamp = serializeBusinessInstant(demoClock);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: ElectricalCertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);
    const validation = validateSignedSnapshot(finalized.fullSnapshot, jobId, 'ELECTRICAL');
    if (!validation.valid) {
      showDemoNotification(`SIGN-OFF BLOCKED: ${validation.error}`, 'error');
      return;
    }

    authoritativeElectricalCertsRef.current[jobId] = finalized;
    setElectricalCerts(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`Electrical Certificate Part A signed off for Job ${jobId}. Snapshot frozen.`, 'warning');
  };

  const signOffTca1 = (jobId: string) => {
    // Read latest authoritative state to guard against same-render stale closures
    const current = authoritativeTca1CertsRef.current[jobId] || buildDefaultTca1(jobId);
    if (current.signedOff) {
      showDemoNotification('TCA1 Cabling Compliance Certificate is already signed off.', 'warning');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.cctv;
    const signer = job?.assignedTechName || 'Alex Taylor';
    const timestamp = serializeBusinessInstant(demoClock);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: Tca1CertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);
    const validation = validateSignedSnapshot(finalized.fullSnapshot, jobId, 'TCA1');
    if (!validation.valid) {
      showDemoNotification(`SIGN-OFF BLOCKED: ${validation.error}`, 'error');
      return;
    }

    authoritativeTca1CertsRef.current[jobId] = finalized;
    setTca1Certs(prev => ({ ...prev, [jobId]: finalized }));
    showDemoNotification(`TCA1 Cabling Compliance signed off for Job ${jobId}. Snapshot frozen.`, 'success');
  };

  const signOffTca2 = (jobId: string) => {
    // Read latest authoritative state to guard against same-render stale closures
    const current = authoritativeTca2CertsRef.current[jobId] || buildDefaultTca2(jobId);
    if (current.signedOff) {
      showDemoNotification('TCA2 Defect Report is already signed off.', 'warning');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    const brand = brands[job?.brandId || activeBrandId] || brands.cctv;
    const signer = job?.assignedTechName || 'Alex Taylor';
    const timestamp = serializeBusinessInstant(demoClock);
    const frozenIssuer = `${brand.legalIssuerName} • ${brand.abnPlaceholder}`;

    const finalized: Tca2CertData = {
      ...current,
      signedOff: true,
      signedByTechName: signer,
      signedTimestamp: timestamp,
      frozenIssuerSnapshot: frozenIssuer,
    };
    finalized.fullSnapshot = JSON.stringify(finalized);
    const validation = validateSignedSnapshot(finalized.fullSnapshot, jobId, 'TCA2');
    if (!validation.valid) {
      showDemoNotification(`SIGN-OFF BLOCKED: ${validation.error}`, 'error');
      return;
    }

    authoritativeTca2CertsRef.current[jobId] = finalized;
    setTca2Certs(prev => ({ ...prev, [jobId]: finalized }));
    commitJobsState(
      currentJobs => currentJobs,
      currentAudits => currentAudits[jobId]
        ? currentAudits
        : {
            ...currentAudits,
            [jobId]: {
              jobId,
              customerAcknowledged: false,
              officeReviewCompleted: false,
            },
          }
    );
    showDemoNotification(`TCA2 Cabling Defect signed off for Job ${jobId}. Non-compliance recorded and document permanently frozen.`, 'warning');
  };

  const customerAckTca2 = (jobId: string) => {
    // 1. Authoritative check against authoritativeAuditRecordsRef.current to prevent same-render duplicates
    const existingAudit = authoritativeAuditRecordsRef.current[jobId] || tca2AuditRecords[jobId];
    if (existingAudit?.customerAcknowledged) {
      showDemoNotification('ALREADY ACKNOWLEDGED: Customer acknowledgement has already been recorded for this TCA2 Defect Notice.', 'warning');
      return;
    }

    const cert = authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId];
    const result = processCustomerAckTca2({
      jobId,
      actorPersona: persona,
      tca2Cert: cert,
      existingAudit,
      demoClock: serializeBusinessInstant(demoClock),
    });

    if (!result.success) {
      showDemoNotification(result.error || 'Customer acknowledgement failed.', 'error');
      return;
    }

    const acknowledgedAt = serializeBusinessInstant(demoClock);
    commitJobsState(
      currentJobs => currentJobs,
      currentAudits => ({
        ...currentAudits,
        [jobId]: { ...result.updatedAuditRecord!, customerAckTimestamp: acknowledgedAt },
      })
    );
    showDemoNotification(`Customer acknowledgement captured for TCA2 Defect on Job ${jobId}. Signed report remains immutable.`, 'info');
  };

  const officeReviewTca2 = (jobId: string) => {
    // Synchronous mutex guard: reject duplicate calls before state commits or within same tick
    if (inFlightTca2ReviewsRef.current.has(jobId)) {
      showDemoNotification(`TCA2 Office Review is already processing for Job ${jobId}. Duplicate follow-up generation prevented.`, 'warning');
      return;
    }

    // Stable completed-job check: check if already completed
    if (completedTca2ReviewsRef.current.has(jobId)) {
      const existingFollowupId = completedTca2ReviewsRef.current.get(jobId);
      showDemoNotification(
        `TCA2 Office Review already completed for Job ${jobId}. Rectification follow-up work order #${existingFollowupId || ''} already recorded.`,
        'warning'
      );
      return;
    }

    // Mark in-flight immediately
    inFlightTca2ReviewsRef.current.add(jobId);

    try {
      const currentJobs = authoritativeJobsRef.current;
      const currentAudits = authoritativeAuditRecordsRef.current;
      const sourceJob = currentJobs.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
      const cert = authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId];
      const existingAudit = currentAudits[jobId] || tca2AuditRecords[jobId];

      const result = processOfficeReviewTca2({
        jobId,
        actorPersona: persona,
        sourceJob,
        tca2Cert: cert,
        existingAudit,
        existingJobs: currentJobs,
        nextJobSeq: seqCounters.job,
        demoClock: serializeBusinessInstant(demoClock),
      });

      if (!result.success) {
        showDemoNotification(result.error || 'Office review failed.', 'error');
        inFlightTca2ReviewsRef.current.delete(jobId);
        return;
      }

      if (result.isDuplicate) {
        const existingFollowupId = result.updatedAuditRecord.rectificationFollowupJobId;
        if (existingFollowupId) {
          completedTca2ReviewsRef.current.set(jobId, existingFollowupId);
        }
        showDemoNotification(
          `TCA2 Office Review already completed for Job ${jobId}. Rectification follow-up work order #${existingFollowupId || ''} already recorded.`,
          'warning'
        );
        inFlightTca2ReviewsRef.current.delete(jobId);
        return;
      }

      // Single authoritative coupled state transition
      seqCounters.job = result.nextJobSeq;
      const eventTimestamp = serializeBusinessInstant(demoClock);
      const rawFollowupJob = result.newFollowupJob!;
      const followupJob = {
        ...rawFollowupJob,
        activityHistory: rawFollowupJob.activityHistory.map((event, index) => index === rawFollowupJob.activityHistory.length - 1
          ? { ...event, timestamp: eventTimestamp }
          : event),
      };
      const updatedAudit = { ...result.updatedAuditRecord, officeReviewTimestamp: eventTimestamp };

      // Record stable completion mapping & clear in-flight status
      completedTca2ReviewsRef.current.set(jobId, followupJob.id);
      inFlightTca2ReviewsRef.current.delete(jobId);

      commitJobsState(
        currentJobs => [followupJob, ...currentJobs.filter(j => j.id !== followupJob.id)],
        currentAudits => ({ ...currentAudits, [jobId]: updatedAudit })
      );

      showDemoNotification(
        `TCA2 Office Review completed. Rectification follow-up work order #${followupJob.id} created in operational pool.`,
        'success'
      );
    } catch (err) {
      inFlightTca2ReviewsRef.current.delete(jobId);
      throw err;
    }
  };

  // Helper: Verify whether target form is signed off before modifying attachments (reading authoritative refs)
  const isFormSigned = (jobId: string, formType: string): boolean => {
    if (formType === 'JSA') return Boolean((authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId])?.signedOff);
    if (formType === 'ELECTRICAL') return Boolean((authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId])?.signedOff);
    if (formType === 'SMOKE_ALARM') return Boolean((authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId])?.signedOff);
    if (formType === 'TCA1') return Boolean((authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId])?.signedOff);
    if (formType === 'TCA2') return Boolean((authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId])?.signedOff);
    return false;
  };

  // Sample Attachment Linkage (G00-027) with universal immutability guards & authoritative ref consistency
  const attachSampleToJobForm = (jobId: string, formType: string, sampleId: string) => {
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) {
      showDemoNotification(`Cannot attach sample: Job ${jobId} not found.`, 'error');
      return;
    }

    if (!['JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2'].includes(formType)) {
      showDemoNotification(`Cannot attach sample: Unsupported form type "${formType}".`, 'error');
      return;
    }

    if (isFormSigned(jobId, formType)) {
      showDemoNotification(`CANNOT ATTACH: ${formType} form is signed and locked. Attachments cannot be altered on finalized documents.`, 'error');
      return;
    }

    // Add to specific form reading from latest authoritative refs
    if (formType === 'JSA') {
      const current = authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId] || buildDefaultJsa(jobId);
      if (current.signedOff) return;
      const nextSamples = Array.from(new Set([...(current.attachedSampleIds || []), sampleId]));
      updateJsaForm(jobId, { attachedSampleIds: nextSamples });
    } else if (formType === 'SMOKE_ALARM') {
      const current = authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
      if (current.signedOff) return;
      const nextSamples = Array.from(new Set([...(current.attachedSampleIds || []), sampleId]));
      updateSmokeAlarmForm(jobId, { attachedSampleIds: nextSamples });
    } else if (formType === 'ELECTRICAL') {
      const current = authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId] || buildDefaultElectrical(jobId);
      if (current.signedOff) return;
      const nextSamples = Array.from(new Set([...(current.attachedSampleIds || []), sampleId]));
      updateElectricalForm(jobId, { attachedSampleIds: nextSamples });
    } else if (formType === 'TCA1') {
      const current = authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId] || buildDefaultTca1(jobId);
      if (current.signedOff) return;
      const nextSamples = Array.from(new Set([...(current.attachedSampleIds || []), sampleId]));
      updateTca1Form(jobId, { attachedSampleIds: nextSamples });
    } else if (formType === 'TCA2') {
      const current = authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId] || buildDefaultTca2(jobId);
      if (current.signedOff) return;
      const nextSamples = Array.from(new Set([...(current.attachedSampleIds || []), sampleId]));
      updateTca2Form(jobId, {
        attachedSampleIds: nextSamples,
        samplePhotoLinked: true,
      });
    }

    // Recalculate job-level attachments from all forms using authoritative refs
    const jsaSamples = (authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId])?.attachedSampleIds || [];
    const smokeSamples = (authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId])?.attachedSampleIds || [];
    const elecSamples = (authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId])?.attachedSampleIds || [];
    const tca1Samples = (authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId])?.attachedSampleIds || [];
    const tca2Samples = (authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId])?.attachedSampleIds || [];

    const updatedJobAttachments = recalculateJobAttachments([
      jsaSamples,
      smokeSamples,
      elecSamples,
      tca1Samples,
      tca2Samples,
    ]);

    commitJobsState(current =>
      current.map(j =>
        j.id === jobId
          ? { ...j, attachedSampleIds: updatedJobAttachments }
          : j
      )
    );

    showDemoNotification(`Sample attachment linked to Job ${jobId}.`, 'info');
  };

  const removeSampleFromJobForm = (jobId: string, formType: string, sampleId: string) => {
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) {
      showDemoNotification(`Cannot remove sample: Job ${jobId} not found.`, 'error');
      return;
    }

    if (!['JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2'].includes(formType)) {
      showDemoNotification(`Cannot remove sample: Unsupported form type "${formType}".`, 'error');
      return;
    }

    if (isFormSigned(jobId, formType)) {
      showDemoNotification(`CANNOT REMOVE: ${formType} form is signed and locked. Attachments cannot be removed from finalized documents.`, 'error');
      return;
    }

    if (formType === 'JSA') {
      const current = authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId] || buildDefaultJsa(jobId);
      if (current.signedOff) return;
      updateJsaForm(jobId, {
        attachedSampleIds: (current.attachedSampleIds || []).filter(id => id !== sampleId),
      });
    } else if (formType === 'SMOKE_ALARM') {
      const current = authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId] || buildDefaultSmokeAlarm(jobId);
      if (current.signedOff) return;
      updateSmokeAlarmForm(jobId, {
        attachedSampleIds: (current.attachedSampleIds || []).filter(id => id !== sampleId),
      });
    } else if (formType === 'ELECTRICAL') {
      const current = authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId] || buildDefaultElectrical(jobId);
      if (current.signedOff) return;
      updateElectricalForm(jobId, {
        attachedSampleIds: (current.attachedSampleIds || []).filter(id => id !== sampleId),
      });
    } else if (formType === 'TCA1') {
      const current = authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId] || buildDefaultTca1(jobId);
      if (current.signedOff) return;
      updateTca1Form(jobId, {
        attachedSampleIds: (current.attachedSampleIds || []).filter(id => id !== sampleId),
      });
    } else if (formType === 'TCA2') {
      const current = authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId] || buildDefaultTca2(jobId);
      if (current.signedOff) return;
      const remaining = (current.attachedSampleIds || []).filter(id => id !== sampleId);
      updateTca2Form(jobId, {
        attachedSampleIds: remaining,
        samplePhotoLinked: remaining.length > 0,
      });
    }

    // Recalculate job-level attachments from all forms on this job to preserve shared references
    const jsaSamples = (authoritativeJsaFormsRef.current[jobId] || jsaForms[jobId])?.attachedSampleIds || [];
    const smokeSamples = (authoritativeSmokeAlarmCertsRef.current[jobId] || smokeAlarmCerts[jobId])?.attachedSampleIds || [];
    const elecSamples = (authoritativeElectricalCertsRef.current[jobId] || electricalCerts[jobId])?.attachedSampleIds || [];
    const tca1Samples = (authoritativeTca1CertsRef.current[jobId] || tca1Certs[jobId])?.attachedSampleIds || [];
    const tca2Samples = (authoritativeTca2CertsRef.current[jobId] || tca2Certs[jobId])?.attachedSampleIds || [];

    const updatedJobAttachments = recalculateJobAttachments([
      jsaSamples,
      smokeSamples,
      elecSamples,
      tca1Samples,
      tca2Samples,
    ]);

    commitJobsState(current =>
      current.map(j =>
        j.id === jobId
          ? { ...j, attachedSampleIds: updatedJobAttachments }
          : j
      )
    );
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
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) {
      const message = 'Cannot prepare quote: work order not found.';
      showDemoNotification(message, 'error');
      throw new Error(message);
    }

    seqCounters.quote++;
    // Clear subtotal (ex-GST) + GST (10%) = Total (inc-GST) convention
    const subtotal = Math.round(lineItems.reduce((acc, item) => acc + item.total, 0) * 100) / 100;
    const gst = Math.round(subtotal * 0.1 * 100) / 100;
    const total = Math.round((subtotal + gst) * 100) / 100;

    const brand = brands[job.brandId || activeBrandId];
    const termsTpl = templates.find(t => t.type === 'TERMS') || templates[0];
    const quoteId = `QUOTE-2026-${seqCounters.quote}`;
    const issuedAt = serializeBusinessInstant(demoClock);
    const expiresAt = calculateQuoteExpiration(demoClock);
    const region = brand?.holidayRegion || 'brisbane';

    let stage1Date: string;
    let stage2Date: string;
    try {
      const dates = calculateQuoteFollowUpDates(demoClock, region);
      stage1Date = dates.stage1Date;
      stage2Date = dates.stage2Date;
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : 'Date is outside the supported business calendar.';
      const message = `Cannot prepare quote: ${errMessage}`;
      showDemoNotification(message, 'error');
      throw new Error(message);
    }

    const followUps: QuoteFollowUp[] = [
      {
        id: `QFU-${quoteId}-1`,
        quoteId,
        stage: 'STAGE_1_COURTESY',
        scheduledDate: stage1Date,
        status: 'SCHEDULED',
        channel: 'EMAIL_SIMULATED',
      },
      {
        id: `QFU-${quoteId}-2`,
        quoteId,
        stage: 'STAGE_2_EXPIRY',
        scheduledDate: stage2Date,
        status: 'SCHEDULED',
        channel: 'EMAIL_SIMULATED',
      },
    ];

    const newQuote: Quote = {
      id: quoteId,
      jobId,
      customerId: job.customerId || customers[0].id,
      brandId: job.brandId || activeBrandId,
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
      issuedAt,
      expiresAt,
      followUps,
      acceptanceHistory: [
        {
          timestamp: issuedAt,
          action: `Quote generated & synced to MYOB Business (#MYOB-Q-${88200 + seqCounters.quote})`,
          actor: persona,
        },
        {
          timestamp: issuedAt,
          action: 'Acceptance link generated and sent via email',
          actor: 'Automated Service',
        },
      ],
    };

    commitJobsState(current =>
      current.map(j => (j.id === jobId ? { ...j, quote: newQuote } : j))
    );

    showDemoNotification(`Quote ${newQuote.externalMyobRef} prepared (Subtotal: $${subtotal.toLocaleString()} + GST: $${gst.toLocaleString()} = Total: $${total.toLocaleString()}).`, 'success');
    return newQuote;
  };

  const simulateQuoteAcceptance = (
    jobId: string,
    scenario: 'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  ) => {
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job || !job.quote) {
      return { success: false, message: 'Quote not found for this job.' };
    }

    if (scenario === 'invalid') {
      return { success: false, message: 'Invalid or broken quotation acceptance token.' };
    }
    const isPastExpiry = Boolean(job.quote.expiresAt)
      && new Date(demoClock).getTime() >= new Date(job.quote.expiresAt!).getTime();
    if (scenario === 'expired' || job.quote.acceptanceStatus === 'EXPIRED' || isPastExpiry) {
      return { success: false, message: 'This quotation link has expired (14-day validity exceeded).' };
    }
    if (scenario === 'revoked' || job.quote.acceptanceStatus === 'REVOKED') {
      return { success: false, message: 'This quotation has been revoked or declined.' };
    }
    if (scenario === 'superseded' || job.quote.acceptanceStatus === 'SUPERSEDED') {
      return { success: false, message: 'This quotation has been superseded by a newer revision.' };
    }
    if (scenario === 'already_accepted' || job.quote.acceptanceStatus === 'ACCEPTED') {
      return { success: false, message: `Quotation was already accepted on ${job.quote.acceptedAt}. Duplicate acceptance rejected.` };
    }

    const acceptedTimestamp = serializeBusinessInstant(demoClock);
    const historyEntry = {
      timestamp: acceptedTimestamp,
      action: 'Accepted via Customer Online Portal',
      actor: job.siteContact,
      notes: `Customer accepted Terms snapshot ${job.quote.termsVersion}`,
    };

    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId && j.quote) {
          const updatedFollowUps = j.quote.followUps?.map(fu =>
            fu.status === 'SCHEDULED' ? { ...fu, status: 'CANCELLED' as const } : fu
          );
          return {
            ...j,
            quote: {
              ...j.quote,
              acceptanceStatus: 'ACCEPTED',
              acceptedAt: acceptedTimestamp,
              acceptedByName: job.siteContact,
              acceptanceHistory: [...j.quote.acceptanceHistory, historyEntry],
              followUps: updatedFollowUps,
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

  const revokeQuote = (jobId: string, reason: string = 'Revoked by CABMS administration'): { success: boolean; message: string } => {
    const access = verifyPersonaAccess(authoritativePersonaRef.current, 'financial_writes');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return { success: false, message: access.reason || 'Unauthorized' };
    }
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job || !job.quote) {
      showDemoNotification('Cannot revoke quote: work order or quote not found.', 'error');
      return { success: false, message: 'Quote not found.' };
    }
    if (job.quote.acceptanceStatus !== 'SENT' && job.quote.acceptanceStatus !== 'DRAFT') {
      const message = `Cannot revoke quote in ${job.quote.acceptanceStatus} state.`;
      showDemoNotification(message, 'error');
      return { success: false, message };
    }
    const timestamp = serializeBusinessInstant(demoClock);
    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId && j.quote) {
          const updatedFollowUps = j.quote.followUps?.map(fu =>
            fu.status === 'SCHEDULED' ? { ...fu, status: 'CANCELLED' as const } : fu
          );
          return {
            ...j,
            quote: {
              ...j.quote,
              acceptanceStatus: 'REVOKED',
              refusalReason: reason,
              followUps: updatedFollowUps,
              acceptanceHistory: [
                ...j.quote.acceptanceHistory,
                { timestamp, action: `Quotation revoked: ${reason}`, actor: persona },
              ],
            },
            activityHistory: [
              ...j.activityHistory,
              { timestamp, action: `Quote ${j.quote.externalMyobRef} revoked (${reason})`, actor: persona },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Quote ${job.quote.externalMyobRef} revoked. Pending follow-ups cancelled.`, 'warning');
    return { success: true, message: 'Quote successfully revoked.' };
  };

  const refuseQuote = (jobId: string, reason: string = 'Declined by customer'): { success: boolean; message: string } => {
    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job || !job.quote) {
      showDemoNotification('Cannot decline quote: work order or quote not found.', 'error');
      return { success: false, message: 'Quote not found.' };
    }
    if (job.quote.acceptanceStatus !== 'SENT' && job.quote.acceptanceStatus !== 'DRAFT') {
      const message = `Cannot decline quote in ${job.quote.acceptanceStatus} state.`;
      showDemoNotification(message, 'error');
      return { success: false, message };
    }
    const timestamp = serializeBusinessInstant(demoClock);
    commitJobsState(current =>
      current.map(j => {
        if (j.id === jobId && j.quote) {
          const updatedFollowUps = j.quote.followUps?.map(fu =>
            fu.status === 'SCHEDULED' ? { ...fu, status: 'CANCELLED' as const } : fu
          );
          return {
            ...j,
            quote: {
              ...j.quote,
              acceptanceStatus: 'REVOKED',
              refusalReason: reason,
              followUps: updatedFollowUps,
              acceptanceHistory: [
                ...j.quote.acceptanceHistory,
                { timestamp, action: `Customer declined quotation: ${reason}`, actor: job.siteContact },
              ],
            },
            activityHistory: [
              ...j.activityHistory,
              { timestamp, action: `Quote ${j.quote.externalMyobRef} declined by customer (${reason})`, actor: job.siteContact },
            ],
          };
        }
        return j;
      })
    );
    showDemoNotification(`Customer declined quote ${job.quote.externalMyobRef}. Follow-ups cancelled.`, 'info');
    return { success: true, message: 'Quote declined.' };
  };

  const prepareInvoiceForJob = (jobId: string, amount: number) => {
    const access = verifyPersonaAccess(persona, 'financial_writes');
    if (!access.allowed) {
      showDemoNotification(`DENIED: ${access.reason}`, 'error');
      return;
    }
    seqCounters.invoice++;
    const isOffline = myobConnection.status !== 'CONNECTED';
    const invoiceId = `INV-2026-${seqCounters.invoice}`;
    let myobRef = 'PENDING-MYOB-SYNC';
    if (!isOffline) {
      let candidateRef = `MYOB-INV-${77100 + seqCounters.invoice}`;
      const existingAssignedRefs = new Set(
        authoritativeJobsRef.current
          .filter(j => j.invoice?.externalMyobRef && j.invoice.externalMyobRef !== 'PENDING-MYOB-SYNC')
          .map(j => j.invoice!.externalMyobRef)
      );
      while (existingAssignedRefs.has(candidateRef)) {
        seqCounters.invoice++;
        candidateRef = `MYOB-INV-${77100 + seqCounters.invoice}`;
      }
      myobRef = candidateRef;
    }

    const newInvoice: Invoice = {
      id: invoiceId,
      externalMyobRef: myobRef,
      amount,
      status: isOffline ? 'DRAFT' : 'SENT_TO_MYOB',
      syncStatus: isOffline ? 'FAILED' : 'SYNCED',
      issuedDate: businessCalendarDate(demoClock),
      dueDate: businessCalendarDate(demoClock),
      reconciliationRequired: isOffline,
      reconciliationNotes: isOffline
        ? 'MYOB API connection offline (504 Timeout). Invoice saved locally and requires reconciliation.'
        : undefined,
      errorMessage: isOffline ? 'Simulated MYOB Connection Offline' : undefined,
    };

    commitJobsState(current =>
      current.map(j =>
        j.id === jobId
          ? {
              ...j,
              invoice: newInvoice,
              activityHistory: [
                ...j.activityHistory,
                {
                  timestamp: serializeBusinessInstant(demoClock),
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
    // FC-18: Read authoritative synchronous state to guard against same-render race conditions
    const targetJob = authoritativeJobsRef.current.find(j => j.id === jobId);
    if (!targetJob || !targetJob.invoice) return;

    if (outcome === 'SUCCESS') {
      // FC-18: Stable MYOB external reference algorithm
      let resolvedMyobRef = targetJob.invoice.externalMyobRef;

      // If pending or missing, derive deterministically from invoice ID sequence suffix (e.g. INV-2026-101 -> 101 -> MYOB-INV-77201)
      if (!resolvedMyobRef || resolvedMyobRef === 'PENDING-MYOB-SYNC') {
        const suffixMatch = targetJob.invoice.id.match(/-(\d+)$/);
        if (!suffixMatch) {
          showDemoNotification(
            `RECONCILIATION BLOCKED: Invoice ${targetJob.invoice.id} has malformed identifier. Cannot derive stable MYOB reference.`,
            'error'
          );
          return;
        }
        let invSeq = parseInt(suffixMatch[1], 10);
        let candidateRef = `MYOB-INV-${77100 + invSeq}`;

        // Verify that candidateRef does not duplicate any already assigned external reference across the system
        const otherAssignedRefs = new Set(
          authoritativeJobsRef.current
            .filter(j => j.id !== jobId && j.invoice?.externalMyobRef && j.invoice.externalMyobRef !== 'PENDING-MYOB-SYNC')
            .map(j => j.invoice!.externalMyobRef)
        );
        while (otherAssignedRefs.has(candidateRef)) {
          invSeq++;
          candidateRef = `MYOB-INV-${77100 + invSeq}`;
        }
        resolvedMyobRef = candidateRef;
      }

      commitJobsState(current =>
        current.map(j => {
          if (j.id === jobId && j.invoice) {
            return {
              ...j,
              invoice: {
                ...j.invoice,
                status: 'SENT_TO_MYOB',
                syncStatus: 'SYNCED',
                externalMyobRef: resolvedMyobRef,
                reconciliationRequired: false,
                reconciliationNotes: undefined,
                errorMessage: undefined,
              },
              activityHistory: [
                ...j.activityHistory,
                { timestamp: serializeBusinessInstant(demoClock), action: 'Invoice synced to MYOB following manual reconciliation', actor: persona },
              ],
            };
          }
          return j;
        })
      );
      showDemoNotification(`Invoice ${targetJob.invoice.id} reconciled and synced to MYOB Business (#${resolvedMyobRef}).`, 'success');
    } else {
      commitJobsState(current =>
        current.map(j => {
          if (j.id === jobId && j.invoice) {
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
              activityHistory: [
                ...j.activityHistory,
                { timestamp: serializeBusinessInstant(demoClock), action: 'Invoice reconciliation failed — marked for office review', actor: persona },
              ],
            };
          }
          return j;
        })
      );
      showDemoNotification(`Invoice ${targetJob.invoice.id} reconciliation failed. Marked for office review.`, 'error');
    }
  };

  // Reviews Deduplication & Full Workflow (G00-021: PENDING -> SENT / FAILED / UNCERTAIN)
  const triggerReviewRequest = (jobId: string, simulateOutcome?: 'FAIL' | 'UNCERTAIN') => {
    if (!canManageReviews()) {
      showDemoNotification('DENIED: An active authorized session is required to dispatch review invitations.', 'error');
      return { success: false, message: 'An active authorized session is required for review dispatch.' };
    }

    const currentJobs = authoritativeJobsRef.current;
    const job = currentJobs.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) {
      return { success: false, message: 'Job not found' };
    }

    const brand = brands[job.brandId] || brands.solarcell;
    const intendedOutcome = simulateOutcome || (activeScenario === 'myob_uncertain' ? 'UNCERTAIN' : undefined);
    const dispatchRes = processReviewDispatch({
      currentJob: job,
      simulateOutcome: intendedOutcome,
      demoClock: serializeBusinessInstant(demoClock),
      reviewUrl: brand.reviewUrlPlaceholder || 'https://demo.reviews.invalid',
      brandName: brand.name,
    });

    if (!dispatchRes.allowed) {
      showDemoNotification(`REVIEW BLOCKED: ${dispatchRes.reason}`, 'warning');
      return { success: false, message: dispatchRes.reason || 'Not allowed' };
    }

    // Persist PENDING job into authoritative state & React state
    const rawPendingJob = dispatchRes.pendingJob!;
    const eventTimestamp = serializeBusinessInstant(demoClock);
    const pendingJob: Job = {
      ...rawPendingJob,
      reviewRequest: {
        ...rawPendingJob.reviewRequest,
        history: rawPendingJob.reviewRequest.history.map((event, index) => index === rawPendingJob.reviewRequest.history.length - 1
          ? { ...event, timestamp: eventTimestamp }
          : event),
      },
      activityHistory: rawPendingJob.activityHistory.map((event, index) => index === rawPendingJob.activityHistory.length - 1
        ? { ...event, timestamp: eventTimestamp }
        : event),
    };
    pendingReviewOutcomeRef.current.set(jobId, dispatchRes.outcomeStatus || 'SENT');
    commitJobsState(current => current.map(j => (j.id === jobId ? pendingJob : j)));

    showDemoNotification(`Review invitation for Job ${jobId} queued in PENDING state (${brand.name}).`, 'info');
    return { success: true, message: 'Review request queued in PENDING state.' };
  };

  const resolvePendingReview = (jobId: string, forcedOutcome?: 'SENT' | 'FAIL' | 'UNCERTAIN'): { success: boolean; message?: string } => {
    if (!canManageReviews()) {
      showDemoNotification('DENIED: An active authorized session is required to resolve review invitations.', 'error');
      return { success: false, message: 'An active authorized session is required for review resolution.' };
    }

    const currentJobs = authoritativeJobsRef.current;
    const targetJob = currentJobs.find(j => j.id === jobId);
    if (!targetJob || targetJob.reviewRequest?.status !== 'PENDING') {
      return { success: false, message: 'Job not found or not in PENDING state.' };
    }

    // Atomic dispatch lock prevents duplicate execution
    if (pendingReviewDispatchRef.current.has(jobId)) {
      return { success: false, message: 'Dispatch already in flight.' };
    }
    pendingReviewDispatchRef.current.add(jobId);

    const brand = brands[targetJob.brandId] || brands.solarcell;
    const queuedOutcome = pendingReviewOutcomeRef.current.get(jobId);
    const outcome: 'SENT' | 'FAILED' | 'UNCERTAIN' = forcedOutcome
      ? forcedOutcome === 'FAIL' ? 'FAILED' : forcedOutcome
      : queuedOutcome || (activeScenario === 'myob_uncertain' ? 'UNCERTAIN' : 'SENT');
    const timestamp = serializeBusinessInstant(demoClock);
    const resolvedJob = resolveReviewJob(targetJob, outcome, timestamp, brand.name, authoritativePersonaRef.current);
    if (outcome === 'UNCERTAIN') {
      showDemoNotification('Review request dispatch uncertain (504 gateway timeout). Manual reconciliation required.', 'warning');
    } else if (outcome === 'FAILED') {
      showDemoNotification('Review request failed to dispatch (SMTP 550). Controlled retry available.', 'error');
    } else {
      showDemoNotification(`Review request dispatched to ${targetJob.siteContact} (${brand.name}).`, 'success');
    }

    commitJobsState(current => current.map(j => (j.id === jobId ? resolvedJob : j)));
    pendingReviewDispatchRef.current.delete(jobId);
    pendingReviewOutcomeRef.current.delete(jobId);
    return { success: true, message: `Review resolved to ${resolvedJob.reviewRequest.status}` };
  };

  const resolveAllPendingReviews = () => {
    if (!canManageReviews()) {
      showDemoNotification('DENIED: An active authorized session is required to dispatch review invitations.', 'error');
      return;
    }
    const pendingJobs = authoritativeJobsRef.current.filter(j => j.reviewRequest?.status === 'PENDING');
    if (pendingJobs.length === 0) {
      showDemoNotification('No reviews currently pending dispatch.', 'info');
      return;
    }
    pendingJobs.forEach(j => resolvePendingReview(j.id));
  };

  const pendingReviewCount = jobs.filter(j => j.reviewRequest?.status === 'PENDING').length;

  const reconcileReviewRequest = (jobId: string, resolution: 'SENT' | 'FAILED' = 'SENT') => {
    if (!canManageReviews()) {
      showDemoNotification('DENIED: An active authorized session is required to reconcile review requests.', 'error');
      return;
    }

    const currentJobs = authoritativeJobsRef.current;
    const job = currentJobs.find(j => j.id === jobId);
    if (!job) return;

    if (job.reviewRequest.status !== 'UNCERTAIN') {
      showDemoNotification(`RECONCILE BLOCKED: Only UNCERTAIN review requests can be reconciled. Current status: ${job.reviewRequest.status}`, 'warning');
      return;
    }

    commitJobsState(current =>
      current.map(j =>
        j.id === jobId
          ? {
              ...j,
              reviewRequest: {
                ...j.reviewRequest,
                status: resolution,
                uncertainReconciliationNeeded: false,
                sentTimestamp: resolution === 'SENT' ? serializeBusinessInstant(demoClock) : undefined,
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: serializeBusinessInstant(demoClock),
                    event: resolution === 'SENT'
                      ? 'Reconciled manual check: delivery confirmed in gateway dispatch log.'
                      : 'Reconciled manual check: delivery confirmed failed. Marked FAILED for retry.',
                    status: resolution === 'SENT' ? 'RECONCILED_SENT' : 'RECONCILED_FAILED',
                  },
                ],
              },
            }
          : j
      )
    );
    showDemoNotification(`Review status for Job ${jobId} reconciled to ${resolution}.`, 'info');
  };

  const retryReviewRequest = (jobId: string) => {
    if (!canManageReviews()) {
      showDemoNotification('DENIED: An active authorized session is required to retry review requests.', 'error');
      return { success: false, message: 'An active authorized session is required.' };
    }

    const currentJobs = authoritativeJobsRef.current;
    const job = currentJobs.find(j => j.id === jobId);
    if (!job) return { success: false, message: 'Job not found' };
    if (job.reviewRequest.status !== 'FAILED') {
      showDemoNotification(`Only FAILED review requests can be retried. Current status: ${job.reviewRequest.status}`, 'warning');
      return { success: false, message: 'Not in FAILED state' };
    }
    commitJobsState(current =>
      current.map(j =>
        j.id === jobId
          ? {
              ...j,
              reviewRequest: {
                ...j.reviewRequest,
                status: 'SENT',
                sentTimestamp: serializeBusinessInstant(demoClock),
                reviewLink: brands[job.brandId]?.reviewUrlPlaceholder || '',
                uncertainReconciliationNeeded: false,
                history: [
                  ...j.reviewRequest.history,
                  {
                    timestamp: serializeBusinessInstant(demoClock),
                    event: 'Controlled retry successful: email dispatched and confirmed.',
                    status: 'SENT',
                  },
                ],
              },
            }
          : j
      )
    );
    showDemoNotification(`Review request for Job ${jobId} retried successfully and sent.`, 'success');
    return { success: true, message: 'Review request retried and sent.' };
  };

  // Templates & Versioning (G00-007: DRAFT -> REVIEW -> PUBLISHED)
  const publishTemplateVersion = (templateId: string) => {
    const tpl = templates.find(t => t.id === templateId);
    if (!tpl) return;

    const res = processPublishTemplate(tpl, persona, demoClock);
    if (!res.success) {
      showDemoNotification(res.error || 'Cannot publish template.', 'error');
      return;
    }

    seqCounters.revision++;
    setTemplates(prev =>
      prev.map(t => (t.id === templateId ? res.updatedTemplate! : t))
    );
    showDemoNotification(`Template version published. Full revision and review audit history retained.`, 'success');
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
            updatedAt: serializeBusinessInstant(demoClock),
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
            idx === 0 ? { ...r, status: 'REVIEW' as const, updatedAt: serializeBusinessInstant(demoClock) } : r
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
    showDemoNotification('Template revision submitted for Admin compliance review.', 'info');
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
      prev.map(jt => {
        if (jt.id === typeId) {
          const currentVerNum = parseFloat(jt.version.replace('v', '')) || 1.0;
          const nextVer = `v${(currentVerNum + 0.1).toFixed(1)}`;
          const historyEntry = {
            version: jt.version,
            formsRequired: jt.formsRequired,
            isDirectToInvoice: jt.isDirectToInvoice,
            updatedAt: serializeBusinessInstant(demoClock),
            updatedBy: persona.toUpperCase(),
          };
          return {
            ...jt,
            version: nextVer,
            formsRequired: isDirectToInvoice ? [] : formsRequired,
            isDirectToInvoice,
            revisionHistory: [historyEntry, ...(jt.revisionHistory || [])],
          };
        }
        return jt;
      })
    );
    showDemoNotification('Job type compliance matrix policy updated to new version. Existing in-flight jobs retain historical requirement snapshots.', 'success');
  };

  // Certificate Delivery Workflow (G00-022) & Certificate Policy A & MAN-SEC-01 Permission Guard
  const sendCertificateEmail = (jobId: string, formType: string, simulateFail = false) => {
    // MAN-SEC-01: Session authentication & persona role guard
    if (!authoritativeSessionRef.current) {
      showDemoNotification('ACCESS DENIED: Session signed out. Sign in to dispatch certificates.', 'error');
      return { success: false, message: 'Session signed out' };
    }
    const currentPersona = authoritativePersonaRef.current || persona;
    if (!(['super_admin', 'owner_admin', 'office_staff'] as Persona[]).includes(currentPersona)) {
      showDemoNotification('ACCESS DENIED: Technicians are not authorized to dispatch compliance certificates.', 'error');
      return { success: false, message: 'Unauthorized persona' };
    }

    const job = authoritativeJobsRef.current.find(j => j.id === jobId) || jobs.find(j => j.id === jobId);
    if (!job) return { success: false, message: 'Job not found' };

    // FC-01 & Certificate Policy A: A certificate is eligible for dispatch ONLY if it is required by the job contract
    if (!(job.formsRequired as string[]).includes(formType)) {
      showDemoNotification(`DISPATCH BLOCKED: ${formType} certificate is not required by work order contract for ${jobId}.`, 'error');
      return { success: false, message: 'Certificate not required by work order contract' };
    }

    let docTitle = '';
    let formSnapshot = '';
    let isSigned = false;
    let rawSnapshot: string | undefined = undefined;

    if (formType === 'JSA') {
      const form = getOrCreateJsa(jobId);
      docTitle = `Job Safety Analysis (JSA) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (formType === 'ELECTRICAL') {
      const form = getOrCreateElectrical(jobId);
      docTitle = `Certificate of Electrical Safety (Part A) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (formType === 'SMOKE_ALARM') {
      const form = getOrCreateSmokeAlarm(jobId);
      docTitle = `Smoke Alarm Compliance Certificate — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (formType === 'TCA1') {
      const form = getOrCreateTca1(jobId);
      docTitle = `Telecommunications Cabling Advice (TCA1) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (formType === 'TCA2') {
      const form = getOrCreateTca2(jobId);
      docTitle = `Cabling Non-Compliance Notice (TCA2) — ${jobId}`;
      formSnapshot = form.frozenIssuerSnapshot || 'Unsigned';
      isSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    }

    if (!isSigned) {
      showDemoNotification(`CANNOT SEND: ${docTitle} is not signed off. Only finalized certificates can be dispatched.`, 'error');
      return { success: false, message: 'Document unsigned' };
    }

    const valRes = validateSignedSnapshot(rawSnapshot, jobId, formType);
    if (!valRes.valid) {
      showDemoNotification(`CANNOT SEND: ${docTitle} snapshot is missing or corrupt: ${valRes.error}`, 'error');
      return { success: false, message: valRes.error || 'Corrupt or missing signed document snapshot' };
    }
    const fullDocSnapshot = rawSnapshot!;

    seqCounters.reminder++;
    const deliveryId = `CERT-DELIV-${seqCounters.reminder}`;
    const newRecord: CertificateDeliveryRecord = {
      id: deliveryId,
      jobId,
      formType,
      recipientEmail: `${job.siteContact.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.invalid`,
      status: simulateFail ? 'FAILED' : 'SENT',
      sentAt: serializeBusinessInstant(demoClock),
      documentTitle: docTitle,
      snapshotSummary: formSnapshot,
      fullFrozenDocumentSnapshot: fullDocSnapshot,
    };

    authoritativeCertificateDeliveriesRef.current = [newRecord, ...authoritativeCertificateDeliveriesRef.current];
    setCertificateDeliveries(authoritativeCertificateDeliveriesRef.current);

    if (simulateFail) {
      showDemoNotification(`Certificate dispatch failed (Simulated SMTP Timeout 504). Retry available.`, 'error');
      return { success: false, message: 'Simulated dispatch failure' };
    }

    showDemoNotification(`Signed certificate emailed to ${newRecord.recipientEmail}. Complete snapshot preserved.`, 'success');
    return { success: true, message: 'Certificate delivered successfully' };
  };

  const retryCertificateDelivery = (deliveryId: string) => {
    // MAN-SEC-01: Session authentication & persona role guard
    if (!authoritativeSessionRef.current) {
      showDemoNotification('ACCESS DENIED: Session signed out. Sign in to retry certificate delivery.', 'error');
      return;
    }
    const currentPersona = authoritativePersonaRef.current || persona;
    if (!(['super_admin', 'owner_admin', 'office_staff'] as Persona[]).includes(currentPersona)) {
      showDemoNotification('ACCESS DENIED: Technicians are not authorized to retry certificate delivery.', 'error');
      return;
    }

    const record = authoritativeCertificateDeliveriesRef.current.find(d => d.id === deliveryId) || certificateDeliveries.find(d => d.id === deliveryId);
    if (!record) {
      showDemoNotification(`Cannot retry delivery ${deliveryId}: Record not found.`, 'error');
      return;
    }
    if (record.status !== 'FAILED') {
      showDemoNotification(`Cannot retry delivery ${deliveryId}: Only FAILED deliveries can be retried.`, 'error');
      return;
    }
    const job = authoritativeJobsRef.current.find(j => j.id === record.jobId) || jobs.find(j => j.id === record.jobId);
    if (!job) {
      showDemoNotification(`RETRY BLOCKED: Job ${record.jobId} not found.`, 'error');
      return;
    }
    if (!(job.formsRequired as string[]).includes(record.formType)) {
      showDemoNotification(`RETRY BLOCKED: ${record.formType} is not required by work order contract for ${record.jobId}.`, 'error');
      return;
    }
    const valRes = validateSignedSnapshot(record.fullFrozenDocumentSnapshot, record.jobId, record.formType);
    if (!valRes.valid) {
      showDemoNotification(`RETRY BLOCKED: Snapshot invalid or corrupt for ${record.formType}: ${valRes.error}`, 'error');
      return;
    }
    const nextDeliveries = authoritativeCertificateDeliveriesRef.current.map(d =>
      d.id === deliveryId && d.status === 'FAILED'
        ? { ...d, status: 'SENT' as const, sentAt: serializeBusinessInstant(demoClock) }
        : d
    );
    authoritativeCertificateDeliveriesRef.current = nextDeliveries;
    setCertificateDeliveries(nextDeliveries);
    showDemoNotification(`Certificate delivery ${deliveryId} retried and confirmed SENT.`, 'success');
  };

  // Website Enquiry Simulation (G00-011)
  const simulateWebsiteSubmission = (brandId: BrandId) => {
    seqCounters.enquiry++;
    const brandName = brands[brandId]?.name || 'CABMS Brand';
    const newEnquiry: WebsiteEnquiry = {
      id: `ENQ-2026-${seqCounters.enquiry}`,
      submissionDate: serializeBusinessInstant(demoClock),
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

    const matchedJt = jobTypes.find(jt => jt.id === jobTypeId);
    if (!matchedJt || matchedJt.brandId !== enq.brandId) {
      showDemoNotification('Enquiry conversion blocked: choose a configured job type for the enquiry business.', 'error');
      return { customerId: '', jobId: '' };
    }

    // Customer match resolution
    let customerId = matchedCustomerId || enq.matchedExistingCustomerId;
    let unresolvedWarning: string | undefined;

    if (customerId && !customers.some(customer => customer.id === customerId)) {
      showDemoNotification('Enquiry conversion blocked: the selected customer record no longer exists.', 'error');
      return { customerId: '', jobId: '' };
    }

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

      if ('matchedCustomer' in res && res.matchedCustomer) {
        customerId = res.matchedCustomer.id;
        if (res.matchedCustomer.syncStatus !== 'SYNCED' || res.matchedCustomer.isRecoverableDraft) {
          unresolvedWarning = 'Matched customer is a recoverable local draft with pending MYOB reconciliation.';
        }
      } else if ('customer' in res && res.customer) {
        customerId = res.customer.id;
        if (!res.success) {
          unresolvedWarning = 'Customer saved as a recoverable local draft (MYOB unavailable). Work order linked to that pending customer record.';
        }
      } else {
        showDemoNotification('Enquiry conversion blocked: no valid customer record could be resolved.', 'error');
        return { customerId: '', jobId: '' };
      }
    }

    const newJob = createJob({
      brandId: enq.brandId,
      customerId,
      title: `${enq.serviceRequested}`,
      jobType: matchedJt.id,
      formsRequired: matchedJt.formsRequired,
      isDirectToInvoice: matchedJt.isDirectToInvoice,
      siteAddress: enq.address,
      siteContact: enq.customerName,
      sitePhone: enq.phone,
      description: `Originating from enquiry ${enquiryId}: ${enq.notes}`,
      unresolvedWarnings: unresolvedWarning ? [unresolvedWarning] : [],
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

  const updateBrandConfig = (updated: BrandConfig): { success: boolean; message?: string } => {
    const callerPersona = authoritativePersonaRef.current;
    if (callerPersona !== 'super_admin' && callerPersona !== 'owner_admin') {
      showDemoNotification('Unauthorized: Brand configuration edits require Admin authority.', 'error');
      return { success: false, message: 'Unauthorized' };
    }

    if (callerPersona === 'owner_admin') {
      if (updated.id !== activeBrandId) {
        showDemoNotification('Unauthorized: Admins may only modify the active workspace brand.', 'error');
        return { success: false, message: 'Unauthorized' };
      }
      const existing = brands[updated.id];
      if (existing) {
        if (
          existing.legalIssuerName !== updated.legalIssuerName ||
          existing.abnPlaceholder !== updated.abnPlaceholder ||
          existing.electricalLicencePlaceholder !== updated.electricalLicencePlaceholder ||
          existing.acmaCablerPlaceholder !== updated.acmaCablerPlaceholder ||
          existing.qbccLicencePlaceholder !== updated.qbccLicencePlaceholder ||
          existing.quoteTemplateName !== updated.quoteTemplateName ||
          existing.invoiceTemplateName !== updated.invoiceTemplateName ||
          existing.calendarMappingName !== updated.calendarMappingName ||
          existing.holidayRegion !== updated.holidayRegion
        ) {
          showDemoNotification('Unauthorized: Legal entity edits require Super Admin authority.', 'error');
          return { success: false, message: 'Unauthorized' };
        }
      }
    }

    authoritativeBrandsRef.current = { ...authoritativeBrandsRef.current, [updated.id]: updated };
    setBrands(prev => ({ ...prev, [updated.id]: updated }));
    showDemoNotification(`Brand profile "${updated.name}" updated.`, 'success');
    return { success: true };
  };

  const addNewBrandProfile = (newBrand: BrandConfig) => {
    const callerPersona = authoritativePersonaRef.current;
    if (callerPersona !== 'super_admin') {
      showDemoNotification('Unauthorized: Adding new brand profiles requires Super Admin authority.', 'error');
      return;
    }
    setBrands(prev => ({ ...prev, [newBrand.id]: newBrand }));
    showDemoNotification(`New configurable profile "${newBrand.name}" added for demonstration.`, 'success');
  };

  const setMyobStatus = (status: 'CONNECTED' | 'DISCONNECTED' | 'FAILED') => {
    const callerPersona = authoritativePersonaRef.current;
    if (callerPersona !== 'super_admin') {
      showDemoNotification('Unauthorized: Modifying technical integration settings requires Super Admin authority.', 'error');
      return;
    }
    setMyobConnection(prev => ({
      ...prev,
      status,
      errorMessage: status === 'FAILED' ? 'Simulated MYOB Connection Error 504' : undefined,
    }));
  };

  const simulateSignIn = (role: Persona) => {
    authoritativeSessionRef.current = true;
    authoritativePersonaRef.current = role;
    setPersona(role);
    setIsSimulatedSignedIn(true);
    const roleLabel = ({ super_admin: 'SUPER ADMIN', owner_admin: 'ADMIN', office_staff: 'OFFICE STAFF', technician: 'FIELD TECHNICIAN' } as Record<string, string>)[role] || role.toUpperCase();
    showDemoNotification(`Signed in as ${roleLabel} (Simulated Demo Session).`, 'info');
  };

  const simulateSignOut = () => {
    authoritativeSessionRef.current = false;
    setIsSimulatedSignedIn(false);
    showDemoNotification('Signed out of demo session.', 'info');
  };

  return (
    <CabmsContext.Provider
      value={{
        persona,
        setPersona: handleSetPersona,
        activeBrandId,
        setActiveBrandId: handleSetActiveBrandId,
        activeBrand: brands[activeBrandId] || INITIAL_BRANDS.solarcell,
        brands,
        appearance,
        setAppearance,
        brandingMode,
        setBrandingMode,
        visualPreset,
        setVisualPreset,
        technicians: INITIAL_TECHNICIANS,
        updateBrandConfig,
        addNewBrandProfile,
        draftBusinesses,
        createDraftBusiness,
        isSimulatedSignedIn,
        simulateSignIn,
        simulateSignOut,
        demoClock,
        advanceClock,
        setDemoClock: setDemoClockExplicit,
        resetDemo,
        activeScenario,
        setActiveScenario,
        activeTab,
        setActiveTab,
        selectedJobId,
        setSelectedJobId,
        myobConnection,
        setMyobStatus,
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
        tca2AuditRecords,
        getTca2AuditRecord,
        sampleAttachments,
        attachSampleToJobForm,
        removeSampleFromJobForm,
        prepareQuoteForJob,
        simulateQuoteAcceptance,
        revokeQuote,
        refuseQuote,
        prepareInvoiceForJob,
        reconcileInvoiceSync,
        triggerReviewRequest,
        reconcileReviewRequest,
        retryReviewRequest,
        pendingReviewCount,
        resolvePendingReview,
        resolveAllPendingReviews,
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
        getAuthoritativeState: () => ({
          jobs: authoritativeJobsRef.current,
          tca2AuditRecords: authoritativeAuditRecordsRef.current,
          draftBusinesses: authoritativeDraftBusinessesRef.current,
          jsaForms: authoritativeJsaFormsRef.current,
          electricalCerts: authoritativeElectricalCertsRef.current,
          smokeAlarmCerts: authoritativeSmokeAlarmCertsRef.current,
          tca1Certs: authoritativeTca1CertsRef.current,
          tca2Certs: authoritativeTca2CertsRef.current,
        }),
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
