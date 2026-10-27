/**
 * CABMS Typed Service & Data-Access Boundary
 * Defines interfaces, DTO request schemas, response envelopes, and error classes.
 */

import {
  BrandConfig,
  BrandId,
  Customer,
  DraftBusinessProfile,
  ElectricalCertData,
  Invoice,
  Job,
  JobStatus,
  JobTypeConfig,
  JsaFormData,
  Quote,
  SampleAttachment,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2AuditRecord,
  Tca2CertData,
  TemplateSetting,
  VisualPreset,
  WebsiteEnquiry,
} from '../types/cabms.ts';

// Standard API Response Envelopes
export interface ApiResponse<T> {
  data: T;
  meta?: {
    timestamp: string;
    version?: string;
  };
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total_records: number;
    total_pages: number;
    has_next: boolean;
  };
}

// Standardized Error Hierarchy
export type ApiErrorCode =
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'UNAVAILABLE';

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    public readonly statusCode: number,
    message: string,
    public readonly details?: Record<string, string[]>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super('NOT_FOUND', 404, `${resource} with id '${id}' was not found.`);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super('VALIDATION_FAILED', 422, message, fieldErrors);
  }
}

export class ForbiddenError extends ApiError {
  constructor(reason: string) {
    super('FORBIDDEN', 403, `Access denied: ${reason}`);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string, public readonly conflictingId?: string) {
    super('CONFLICT', 409, message);
  }
}

export class UnavailableError extends ApiError {
  constructor(feature: string) {
    super('UNAVAILABLE', 503, `${feature} requires backend integration.`);
  }
}

// Strict Payload Allowlists
export interface UpdateBrandOperationalPayload {
  tagline?: string;
  contact_phone?: string;
  contact_email?: string;
  operational_address?: string;
  operating_hours?: string;
  preferred_preset?: VisualPreset;
}

export interface UpdateBrandLegalPayload {
  legal_issuer_name?: string;
  abn?: string;
  electrical_licence?: string;
  acma_cabler?: string;
  qbcc_licence?: string;
}

export interface CreateJobPayload {
  brand_id: BrandId;
  customer_id: string;
  title: string;
  job_type_id: string;
  site_address: string;
  site_contact: string;
  site_phone: string;
  description: string;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  estimated_duration_hours?: number;
}

export interface SignOffPayload {
  signed_by_name: string;
  signed_timestamp: string;
  signer_role: string;
}

// Data Access Adapter Contract
export interface CabmsDataAdapter {
  // Brand Configuration
  getBrands(): Promise<Record<BrandId, BrandConfig>>;
  updateBrandOperationalSettings(brandId: BrandId, payload: UpdateBrandOperationalPayload): Promise<BrandConfig>;
  updateBrandLegalSettings(brandId: BrandId, payload: UpdateBrandLegalPayload): Promise<BrandConfig>;
  addNewBrandProfile(brand: BrandConfig): Promise<BrandConfig>;
  createDraftBusiness(profile: Omit<DraftBusinessProfile, 'id' | 'isDraft' | 'createdAt'>): Promise<DraftBusinessProfile>;

  // Customer Management
  getCustomers(params?: { brandId?: BrandId; search?: string; page?: number; limit?: number }): Promise<PaginatedResponse<Customer>>;
  createCustomer(payload: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>): Promise<Customer>;
  checkCustomerDuplicate(params: { email?: string; phone?: string; name?: string }): Promise<{ isDuplicate: boolean; matchedCustomer?: Customer }>;
  reconcileUncertainCustomer(customerId: string, confirmCreate: boolean): Promise<Customer>;

  // Job Management (Preserving 6 states & cancellation distinction)
  getJobs(params?: { brandId?: BrandId; status?: JobStatus; techId?: string; date?: string }): Promise<Job[]>;
  getJobById(id: string): Promise<Job | null>;
  createJob(payload: CreateJobPayload): Promise<Job>;
  updateJobStatus(id: string, status: JobStatus, notes?: string): Promise<Job>;
  rescheduleJob(id: string, date: string, time: string): Promise<Job>;
  cancelJobAppointment(id: string, reason: string): Promise<Job>;
  cancelWholeJob(id: string, reason: string): Promise<Job>;
  reopenCancelledJob(id: string): Promise<Job>;

  // Job Types
  getJobTypes(): Promise<JobTypeConfig[]>;
  updateJobTypeConfig(typeId: string, formsRequired: JobTypeConfig['formsRequired'], isDirectToInvoice: boolean): Promise<JobTypeConfig>;

  // Statutory Compliance Forms
  getJsaForm(jobId: string): Promise<JsaFormData>;
  saveJsaForm(jobId: string, data: Partial<JsaFormData>): Promise<JsaFormData>;
  signOffJsaForm(jobId: string, signer: SignOffPayload): Promise<JsaFormData>;

  getElectricalForm(jobId: string): Promise<ElectricalCertData>;
  saveElectricalForm(jobId: string, data: Partial<ElectricalCertData>): Promise<ElectricalCertData>;
  signOffElectricalForm(jobId: string, signer: SignOffPayload): Promise<ElectricalCertData>;

  getSmokeAlarmForm(jobId: string): Promise<SmokeAlarmCertData>;
  saveSmokeAlarmForm(jobId: string, data: Partial<SmokeAlarmCertData>): Promise<SmokeAlarmCertData>;
  signOffSmokeAlarmForm(jobId: string, signer: SignOffPayload): Promise<SmokeAlarmCertData>;

  getTca1Form(jobId: string): Promise<Tca1CertData>;
  saveTca1Form(jobId: string, data: Partial<Tca1CertData>): Promise<Tca1CertData>;
  signOffTca1Form(jobId: string, signer: SignOffPayload): Promise<Tca1CertData>;

  getTca2Form(jobId: string): Promise<Tca2CertData>;
  saveTca2Form(jobId: string, data: Partial<Tca2CertData>): Promise<Tca2CertData>;
  signOffTca2Form(jobId: string, signer: SignOffPayload): Promise<Tca2CertData>;
  acknowledgeTca2(jobId: string): Promise<Tca2AuditRecord>;
  officeReviewTca2(jobId: string, reviewerName: string): Promise<Tca2AuditRecord>;
  getTca2AuditRecord(jobId: string): Promise<Tca2AuditRecord | undefined>;

  // Sample Attachments
  getSampleAttachments(): Promise<SampleAttachment[]>;

  // Quotations & Invoices
  getQuoteForJob(jobId: string): Promise<Quote | null>;
  prepareQuoteForJob(jobId: string, title: string, lineItems: Quote['lineItems']): Promise<Quote>;
  recordQuoteAcceptance(jobId: string, scenario: string): Promise<{ success: boolean; message: string }>;
  revokeQuote(jobId: string, reason?: string): Promise<{ success: boolean; message: string }>;
  refuseQuote(jobId: string, reason?: string): Promise<{ success: boolean; message: string }>;
  prepareInvoiceForJob(jobId: string, amount: number): Promise<Invoice>;

  // Templates
  getTemplates(): Promise<TemplateSetting[]>;
  publishTemplateVersion(templateId: string): Promise<TemplateSetting>;
  createTemplateDraftRevision(templateId: string, newContent: string): Promise<TemplateSetting>;
  submitTemplateForReview(templateId: string): Promise<TemplateSetting>;

  // Website Enquiries
  getEnquiries(brandId?: BrandId): Promise<WebsiteEnquiry[]>;
  convertEnquiry(enquiryId: string, customerId: string, jobTypeId: string): Promise<{ jobId: string; customerId: string }>;
  dismissEnquiry(enquiryId: string): Promise<void>;

  // Baseline Reset
  resetToBaseline(): Promise<void>;
}
