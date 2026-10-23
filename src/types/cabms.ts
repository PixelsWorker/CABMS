/**
 * CABMS — Complete G00 Full-Application UI/UX Demo
 * Type definitions and domain models
 * Strict isolation: Deterministic synthetic data, no live external integrations
 */

export type BrandId = 'solarcell' | 'smart_home' | 'cctv';

export interface DraftBusinessProfile {
  id: string; // e.g. DRAFT-BIZ-001
  slug?: string;
  name: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoGlyph: string;
  legalIssuerName: string;
  abnPlaceholder: string;
  electricalLicencePlaceholder?: string;
  acmaCablerPlaceholder?: string;
  qbccLicencePlaceholder?: string;
  contactEmail?: string;
  contactPhone?: string;
  isDraft: true;
  createdAt: string;
}

export type Persona = 'super_admin' | 'owner_admin' | 'office_staff' | 'technician';

export type JobStatus = 'NEW' | 'SCHEDULED' | 'IN_PROGRESS' | 'NEEDS_REVISIT' | 'COMPLETED' | 'CANCELLED';

export type AppointmentStatus = 'UNSCHEDULED' | 'SCHEDULED' | 'RESCHEDULED' | 'CANCELLED';

export type InvoiceStatus = 'DRAFT' | 'SENT_TO_MYOB' | 'UNPAID' | 'PAID' | 'RECONCILIATION_REQUIRED';

export type SyncStatus = 'SYNCED' | 'PENDING_WRITE' | 'FAILED' | 'UNCERTAIN';

export interface BrandConfig {
  id: BrandId;
  name: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  logoGlyph: string;
  legalIssuerName: string;
  abnPlaceholder: string;
  electricalLicencePlaceholder: string;
  acmaCablerPlaceholder: string;
  qbccLicencePlaceholder: string;
  contactEmail: string;
  contactPhone: string;
  reviewUrlPlaceholder: string;
  calendarMappingName: string;
  quoteTemplateName: string;
  invoiceTemplateName: string;
}

export interface ActivityLogEntry {
  timestamp: string;
  action: string;
  actor: string;
  notes?: string;
}

export interface Customer {
  id: string; // e.g. CUSTOMER-DEMO-001
  myobCustomerId: string; // e.g. MYOB-DEMO-001
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
  brandAffiliations: BrandId[];
  syncStatus: SyncStatus;
  notes?: string;
  createdAt: string;
  isRecoverableDraft?: boolean;
  activityHistory?: ActivityLogEntry[];
}

export interface JobTypeConfig {
  id: string;
  name: string;
  brandId: BrandId;
  formsRequired: ('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[];
  isDirectToInvoice: boolean;
  version: string;
  revisionHistory?: {
    version: string;
    formsRequired: ('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[];
    isDirectToInvoice: boolean;
    updatedAt: string;
    updatedBy: string;
  }[];
}

export interface Job {
  id: string; // e.g. JOB-2026-101
  brandId: BrandId;
  customerId: string;
  title: string;
  jobType: string;
  jobTypeVersion: string;
  siteAddress: string;
  siteContact: string;
  sitePhone: string;
  description: string;
  status: JobStatus;
  assignedTechId: string | null;
  assignedTechName: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  estimatedDurationHours: number;
  isDirectToInvoice: boolean;
  formsRequired: ('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[];
  appointmentStatus?: AppointmentStatus;
  calendarMapping?: string;
  calendarSyncStatus?: 'SYNCED' | 'PENDING' | 'FAILED';
  quote?: Quote;
  invoice?: Invoice;
  reviewRequest: ReviewRequest;
  reminders: ScheduledReminder[];
  attachedSampleIds: string[];
  completedAt?: string;
  completionNotes?: string;
  unresolvedWarnings: string[];
  activityHistory: ActivityLogEntry[];
}

export interface Quote {
  id: string; // e.g. QUOTE-2026-042
  jobId: string;
  customerId: string;
  brandId: BrandId;
  externalMyobRef: string; // e.g. MYOB-Q-88204
  title: string;
  subtotal: number;
  gst: number;
  total: number;
  lineItems: {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }[];
  termsVersion: string;
  termsContentSnapshot: string;
  frozenIssuerSnapshot: string;
  acceptanceStatus: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  linkScenario: 'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted';
  acceptedAt?: string;
  acceptedByName?: string;
  acceptanceHistory: ActivityLogEntry[];
}

export interface Invoice {
  id: string;
  externalMyobRef: string;
  amount: number;
  status: InvoiceStatus;
  issuedDate: string;
  dueDate: string;
  paidDate?: string;
  reconciliationRequired: boolean;
  reconciliationNotes?: string;
  syncStatus?: SyncStatus;
  errorMessage?: string;
}

export interface ReviewRequest {
  status: 'NOT_SENT' | 'PENDING' | 'SENT' | 'FAILED' | 'UNCERTAIN';
  sentTimestamp?: string;
  reviewLink: string;
  brandName: string;
  channel: 'EMAIL_SIMULATED';
  uncertainReconciliationNeeded?: boolean;
  history: {
    timestamp: string;
    event: string;
    status: string;
  }[];
}

export interface ScheduledReminder {
  id: string;
  targetAppointmentTime: string;
  scheduledFor: string;
  leadHours: number;
  type: 'CONFIRMATION' | 'REMINDER_24HR' | 'REMINDER_2HR';
  channel: 'EMAIL_SIMULATED';
  suppressed: boolean;
  suppressionReason?: string;
  delivered: boolean;
  deliveredAt?: string;
}

export interface SampleAttachment {
  id: string;
  title: string;
  category: 'switchboard' | 'smoke_alarm' | 'cable_tray' | 'hazard' | 'cabling_defect';
  filename: string;
  thumbnailUrl: string;
  description: string;
  dateTaken: string;
}

// Sanitised field groups for JSA
export interface JsaFormData {
  jobReference: string;
  date: string;
  customerName: string;
  siteContactPlaceholder: string;
  siteAddress: string;
  taskDescription: string;
  assetsIdentified: string;
  personnelName: string;
  personnelRole: string;
  licencePlaceholder: string;
  licenceExpiryPlaceholder: string;
  inductionCompleted: boolean;
  competencyVerified: boolean;
  overallRiskLevel: 'L' | 'M' | 'H' | 'E';
  steps: {
    id: string;
    taskStep: string;
    hazards: string;
    initialRisk: 'L' | 'M' | 'H' | 'E';
    controls: string;
    residualRisk: 'L' | 'M' | 'H' | 'E';
    responsibleRole: string;
  }[];
  ppeChecklist: {
    item: string;
    status: 'Yes' | 'No' | 'N/A';
    notes?: string;
  }[];
  isolationsAndPermits: {
    item: string;
    required: 'Yes' | 'No' | 'N/A';
    referenceOrNotes: string;
  }[];
  emergencyAssemblyArea: string;
  emergencyWardenPlaceholder: string;
  firstAidOfficerPlaceholder: string;
  signedOff: boolean;
  signedByTechName?: string;
  signedTimestamp?: string;
  formRevision: string;
  issuerPlaceholder: string;
  frozenIssuerSnapshot?: string;
  fullSnapshot?: string;
  attachedSampleIds: string[];
}

// Sanitised field groups for Electrical Certificate
export interface ElectricalCertData {
  certReference: string;
  jobReference: string;
  dateOfTest: string;
  customerName: string;
  installationAddress: string;
  siteContact: string;
  occupierRole: 'Owner' | 'Tenant' | 'Property Manager' | 'Builder';
  contractorNamePlaceholder: string;
  electricianLicencePlaceholder: string;
  issuerWordingPlaceholder: string;
  testedWorkItems: {
    id: string;
    description: string;
    circuitsTested: string;
    insulationResistanceResult: string;
    polarityTest: 'Pass' | 'Fail';
    earthContinuity: 'Pass' | 'Fail';
    rcdTripTimeMs: string;
    workResult: 'Pass' | 'Fail';
  }[];
  standardsReliedOn: string[];
  partACertificationPlaceholder: string;
  limitationsAndConsumerRightsPlaceholder: string;
  signedOff: boolean;
  signedByTechName?: string;
  signedTimestamp?: string;
  unresolvedNotice: string; // "Electrical Part B / sections 7-8 not supplied or unresolved. No completed live certificate can be inferred."
  frozenIssuerSnapshot?: string;
  fullSnapshot?: string;
  attachedSampleIds: string[];
}

// Sanitised field groups for Smoke Alarm Certificate
export interface SmokeAlarmCertData {
  certReference: string;
  jobReference: string;
  dateOfInspection: string;
  issuedByPlaceholder: string;
  issuedToRole: 'Owner' | 'Property Manager' | 'Tenant';
  propertyType: 'Detached House' | 'Townhouse' | 'Unit / Apartment' | 'Commercial Office';
  storeys: number;
  bedrooms: number;
  occupancyStatus: 'Occupied' | 'Vacant' | 'Tenanted';
  scopeOfWork: {
    visualInspection: boolean;
    operationalTesting: boolean;
    interconnectionTesting: boolean;
    cleaningAndVacuuming: boolean;
    batteryReplacement: boolean;
    alarmReplacement: boolean;
  };
  alarmSchedule: {
    id: string;
    roomLocation: string;
    alarmBrandModel: string;
    standardMarkingPlaceholder: string;
    manufactureDateOrExpiry: string;
    powerSource: '240V Hardwired with Battery Backup' | '10-Year Sealed Lithium' | 'Replaceable 9V Alkaline';
    passFail: 'Pass' | 'Fail';
    buttonTestPass: boolean;
    interconnectionPass: boolean;
    complianceStatusProvisional: 'Pass' | 'Fail' | 'Provisional';
    correctiveNotes?: string;
  }[];
  relatedElectricalCertRef: string;
  attachmentsLinked: boolean;
  limitationsAndRentalNotes: string;
  signedOff: boolean;
  signedByTechName?: string;
  signedTimestamp?: string;
  provisionalNote: string;
  frozenIssuerSnapshot?: string;
  fullSnapshot?: string;
  attachedSampleIds: string[];
}

// Sanitised field groups for TCA1 Cabling Certificate
export interface Tca1CertData {
  certReference: string;
  jobReference: string;
  registeredCablerPlaceholder: string;
  cablerRegistrationNumberPlaceholder: string;
  employerDetailsPlaceholder: string;
  dateOfWork: string;
  workDescription: string;
  locationOfWork: string;
  supervisionProvided: boolean;
  customerName: string;
  customerContact: string;
  certificationPlaceholderText: string;
  signedOff: boolean;
  signedByTechName?: string;
  signedTimestamp?: string;
  unresolvedRegistrationExpiryNotice: string;
  frozenIssuerSnapshot?: string;
  fullSnapshot?: string;
  attachedSampleIds: string[];
}

// Sanitised field groups for TCA2 Cabling Non-Compliance
export interface Tca2CertData {
  reportReference: string;
  jobReference: string;
  inspectionDate: string;
  businessCablerPlaceholder: string;
  customerName: string;
  siteAddress: string;
  cablingScope: 'Existing Only' | 'New Only' | 'Both Existing and New';
  cablingTypes: string[];
  locationsInspected: string;
  nonComplianceDescription: string;
  requirementReferencePlaceholder: string;
  riskCategory: 'High (Immediate Shock / Fire Hazard)' | 'Medium (Degraded Performance / Mechanical Hazard)' | 'Low (Identification / Labelling Defect)';
  samplePhotoLinked: boolean;
  rectificationRecommendation: string;
  responsibleParty: 'Customer / Building Owner' | 'Original Installer' | 'Network Carrier' | 'Other Third Party';
  urgencyLevel: 'Immediate (Within 24 Hours)' | 'Urgent (Within 7 Days)' | 'Routine (Next Scheduled Maintenance)';
  quotationReferencePlaceholder: string;
  targetResolutionDate: string;
  customerAcknowledged: boolean;
  customerAckTimestamp?: string;
  officeReviewCompleted: boolean;
  reviewedByOfficeStaff?: string;
  officeReviewTimestamp?: string;
  rectificationFollowupJobId?: string;
  signedOff: boolean;
  signedByTechName?: string;
  signedTimestamp?: string;
  warningNotice: string;
  frozenIssuerSnapshot?: string;
  fullSnapshot?: string;
  attachedSampleIds: string[];
}

export interface Tca2AuditRecord {
  jobId: string;
  customerAcknowledged: boolean;
  customerAckTimestamp?: string;
  officeReviewCompleted: boolean;
  reviewedByOfficeStaff?: string;
  officeReviewTimestamp?: string;
  rectificationFollowupJobId?: string;
  history?: ActivityLogEntry[];
}

export interface CertificateDeliveryRecord {
  id: string;
  jobId: string;
  formType: string;
  recipientEmail: string;
  status: 'SENT' | 'FAILED' | 'RECONCILED';
  sentAt: string;
  documentTitle: string;
  snapshotSummary: string;
  fullFrozenDocumentSnapshot?: string;
}

export interface WebsiteEnquiry {
  id: string;
  submissionDate: string;
  sourceWebsite: string;
  brandId: BrandId;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  serviceRequested: string;
  notes: string;
  status: 'PENDING_REVIEW' | 'CONVERTED_TO_JOB' | 'DISMISSED';
  matchedExistingCustomerId?: string;
  convertedJobId?: string;
  unresolvedCustomerWarning?: string;
}

export interface TemplateRevision {
  version: string;
  status: 'DRAFT' | 'REVIEW' | 'PUBLISHED';
  content: string;
  updatedAt: string;
  updatedBy: string;
}

export interface TemplateSetting {
  id: string;
  name: string;
  type: 'TERMS' | 'JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2' | 'EMAIL_CONFIRMATION' | 'REVIEW_REQUEST';
  currentVersion: string;
  activeStatus: 'DRAFT' | 'REVIEW' | 'PUBLISHED';
  content: string;
  sampleFileName?: string;
  mappingStatus: 'Mapped' | 'Pending Review' | 'Unsupported';
  revisions: TemplateRevision[];
}
