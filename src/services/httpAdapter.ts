/**
 * CABMS HTTP REST Adapter Stub
 * Reserved interface for future approved G01+ backend integration.
 * Throws UnavailableError until backend infrastructure and endpoints are provisioned.
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
  WebsiteEnquiry,
} from '../types/cabms.ts';
import {
  CabmsDataAdapter,
  CreateJobPayload,
  PaginatedResponse,
  SignOffPayload,
  UnavailableError,
  UpdateBrandLegalPayload,
  UpdateBrandOperationalPayload,
} from './types.ts';

export class HttpDataAdapter implements CabmsDataAdapter {
  constructor(private readonly baseUrl: string = '/api/v1') {}

  private unavail(feature: string): never {
    throw new UnavailableError(`Live REST API (${this.baseUrl}/${feature})`);
  }

  async getBrands(): Promise<Record<BrandId, BrandConfig>> {
    this.unavail('brands');
  }

  async updateBrandOperationalSettings(_brandId: BrandId, _payload: UpdateBrandOperationalPayload): Promise<BrandConfig> {
    this.unavail('brands/operational-settings');
  }

  async updateBrandLegalSettings(_brandId: BrandId, _payload: UpdateBrandLegalPayload): Promise<BrandConfig> {
    this.unavail('brands/legal-settings');
  }

  async addNewBrandProfile(_brand: BrandConfig): Promise<BrandConfig> {
    this.unavail('brands');
  }

  async createDraftBusiness(_profile: Omit<DraftBusinessProfile, 'id' | 'isDraft' | 'createdAt'>): Promise<DraftBusinessProfile> {
    this.unavail('businesses/draft');
  }

  async getCustomers(_params?: { brandId?: BrandId; search?: string; page?: number; limit?: number }): Promise<PaginatedResponse<Customer>> {
    this.unavail('customers');
  }

  async createCustomer(_payload: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>): Promise<Customer> {
    this.unavail('customers');
  }

  async checkCustomerDuplicate(_params: { email?: string; phone?: string; name?: string }): Promise<{ isDuplicate: boolean; matchedCustomer?: Customer }> {
    this.unavail('customers/check-duplicate');
  }

  async reconcileUncertainCustomer(_customerId: string, _confirmCreate: boolean): Promise<Customer> {
    this.unavail('customers/reconcile');
  }

  async getJobs(_params?: { brandId?: BrandId; status?: JobStatus; techId?: string; date?: string }): Promise<Job[]> {
    this.unavail('jobs');
  }

  async getJobById(_id: string): Promise<Job | null> {
    this.unavail('jobs');
  }

  async createJob(_payload: CreateJobPayload): Promise<Job> {
    this.unavail('jobs');
  }

  async updateJobStatus(_id: string, _status: JobStatus, _notes?: string): Promise<Job> {
    this.unavail('jobs/status');
  }

  async rescheduleJob(_id: string, _date: string, _time: string): Promise<Job> {
    this.unavail('jobs/schedule');
  }

  async cancelJobAppointment(_id: string, _reason: string): Promise<Job> {
    this.unavail('jobs/appointment/cancel');
  }

  async cancelWholeJob(_id: string, _reason: string): Promise<Job> {
    this.unavail('jobs/cancel');
  }

  async reopenCancelledJob(_id: string): Promise<Job> {
    this.unavail('jobs/reopen');
  }

  async getJobTypes(): Promise<JobTypeConfig[]> {
    this.unavail('job-types');
  }

  async updateJobTypeConfig(_typeId: string, _formsRequired: JobTypeConfig['formsRequired'], _isDirectToInvoice: boolean): Promise<JobTypeConfig> {
    this.unavail('job-types');
  }

  async getJsaForm(_jobId: string): Promise<JsaFormData> {
    this.unavail('compliance/jsa');
  }

  async saveJsaForm(_jobId: string, _data: Partial<JsaFormData>): Promise<JsaFormData> {
    this.unavail('compliance/jsa');
  }

  async signOffJsaForm(_jobId: string, _signer: SignOffPayload): Promise<JsaFormData> {
    this.unavail('compliance/jsa/sign');
  }

  async getElectricalForm(_jobId: string): Promise<ElectricalCertData> {
    this.unavail('compliance/electrical');
  }

  async saveElectricalForm(_jobId: string, _data: Partial<ElectricalCertData>): Promise<ElectricalCertData> {
    this.unavail('compliance/electrical');
  }

  async signOffElectricalForm(_jobId: string, _signer: SignOffPayload): Promise<ElectricalCertData> {
    this.unavail('compliance/electrical/sign');
  }

  async getSmokeAlarmForm(_jobId: string): Promise<SmokeAlarmCertData> {
    this.unavail('compliance/smoke-alarm');
  }

  async saveSmokeAlarmForm(_jobId: string, _data: Partial<SmokeAlarmCertData>): Promise<SmokeAlarmCertData> {
    this.unavail('compliance/smoke-alarm');
  }

  async signOffSmokeAlarmForm(_jobId: string, _signer: SignOffPayload): Promise<SmokeAlarmCertData> {
    this.unavail('compliance/smoke-alarm/sign');
  }

  async getTca1Form(_jobId: string): Promise<Tca1CertData> {
    this.unavail('compliance/tca1');
  }

  async saveTca1Form(_jobId: string, _data: Partial<Tca1CertData>): Promise<Tca1CertData> {
    this.unavail('compliance/tca1');
  }

  async signOffTca1Form(_jobId: string, _signer: SignOffPayload): Promise<Tca1CertData> {
    this.unavail('compliance/tca1/sign');
  }

  async getTca2Form(_jobId: string): Promise<Tca2CertData> {
    this.unavail('compliance/tca2');
  }

  async saveTca2Form(_jobId: string, _data: Partial<Tca2CertData>): Promise<Tca2CertData> {
    this.unavail('compliance/tca2');
  }

  async signOffTca2Form(_jobId: string, _signer: SignOffPayload): Promise<Tca2CertData> {
    this.unavail('compliance/tca2/sign');
  }

  async acknowledgeTca2(_jobId: string): Promise<Tca2AuditRecord> {
    this.unavail('compliance/tca2/acknowledge');
  }

  async officeReviewTca2(_jobId: string, _reviewerName: string): Promise<Tca2AuditRecord> {
    this.unavail('compliance/tca2/review');
  }

  async getTca2AuditRecord(_jobId: string): Promise<Tca2AuditRecord | undefined> {
    this.unavail('compliance/tca2/audit');
  }

  async getSampleAttachments(): Promise<SampleAttachment[]> {
    this.unavail('attachments');
  }

  async getQuoteForJob(_jobId: string): Promise<Quote | null> {
    this.unavail('quotes');
  }

  async prepareQuoteForJob(_jobId: string, _title: string, _lineItems: Quote['lineItems']): Promise<Quote> {
    this.unavail('quotes');
  }

  async recordQuoteAcceptance(_jobId: string, _scenario: string): Promise<{ success: boolean; message: string }> {
    this.unavail('quotes/accept');
  }

  async revokeQuote(_jobId: string, _reason?: string): Promise<{ success: boolean; message: string }> {
    this.unavail('quotes/revoke');
  }

  async refuseQuote(_jobId: string, _reason?: string): Promise<{ success: boolean; message: string }> {
    this.unavail('quotes/refuse');
  }

  async prepareInvoiceForJob(_jobId: string, _amount: number): Promise<Invoice> {
    this.unavail('invoices');
  }

  async getTemplates(): Promise<TemplateSetting[]> {
    this.unavail('templates');
  }

  async publishTemplateVersion(_templateId: string): Promise<TemplateSetting> {
    this.unavail('templates/publish');
  }

  async createTemplateDraftRevision(_templateId: string, _newContent: string): Promise<TemplateSetting> {
    this.unavail('templates/revision');
  }

  async submitTemplateForReview(_templateId: string): Promise<TemplateSetting> {
    this.unavail('templates/review');
  }

  async getEnquiries(_brandId?: BrandId): Promise<WebsiteEnquiry[]> {
    this.unavail('enquiries');
  }

  async convertEnquiry(_enquiryId: string, _customerId: string, _jobTypeId: string): Promise<{ jobId: string; customerId: string }> {
    this.unavail('enquiries/convert');
  }

  async dismissEnquiry(_enquiryId: string): Promise<void> {
    this.unavail('enquiries/dismiss');
  }

  async resetToBaseline(): Promise<void> {
    this.unavail('reset');
  }
}
