/**
 * CABMS Stateful In-Memory Mock Data Adapter
 * Hydrated from static JSON fixtures with deep-cloning.
 * Preserves local session mutations and enforces domain business rules.
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
  ForbiddenError,
  NotFoundError,
  PaginatedResponse,
  SignOffPayload,
  UpdateBrandLegalPayload,
  UpdateBrandOperationalPayload,
  ValidationError,
} from './types.ts';

import { INITIAL_BUSINESS_CLOCK, serializeBusinessInstant, calculateQuoteExpiration, calculateQuoteFollowUpDates } from '../utils/businessTime.ts';

// Direct fixture imports
import brandsFixture from '../data/fixtures/brands.json';
import techniciansFixture from '../data/fixtures/technicians.json';
import jobTypesFixture from '../data/fixtures/jobTypes.json';
import customersFixture from '../data/fixtures/customers.json';
import jobsFixture from '../data/fixtures/jobs.json';
import templatesFixture from '../data/fixtures/templates.json';
import enquiriesFixture from '../data/fixtures/enquiries.json';
import sampleAttachmentsFixture from '../data/fixtures/sampleAttachments.json';
import complianceFormsFixture from '../data/fixtures/complianceForms.json';
import tca2AuditsFixture from '../data/fixtures/tca2Audits.json';

interface ComplianceStore {
  jsa: Record<string, JsaFormData>;
  smokeAlarm: Record<string, SmokeAlarmCertData>;
  electrical: Record<string, ElectricalCertData>;
  tca1: Record<string, Tca1CertData>;
  tca2: Record<string, Tca2CertData>;
}

export class MockDataAdapter implements CabmsDataAdapter {
  private brands!: Record<BrandId, BrandConfig>;
  private technicians!: typeof techniciansFixture;
  private jobTypes!: JobTypeConfig[];
  private customers!: Customer[];
  private jobs!: Job[];
  private templates!: TemplateSetting[];
  private enquiries!: WebsiteEnquiry[];
  private sampleAttachments!: SampleAttachment[];
  private complianceForms!: ComplianceStore;
  private tca2Audits!: Record<string, Tca2AuditRecord>;
  private draftBusinesses: DraftBusinessProfile[] = [];

  constructor(private readonly clock: () => string = () => INITIAL_BUSINESS_CLOCK) {
    this.hydrateFromFixtures();
  }

  private hydrateFromFixtures(): void {
    this.brands = structuredClone(brandsFixture) as unknown as Record<BrandId, BrandConfig>;
    this.technicians = structuredClone(techniciansFixture);
    this.jobTypes = structuredClone(jobTypesFixture) as unknown as JobTypeConfig[];
    this.customers = structuredClone(customersFixture) as unknown as Customer[];
    this.jobs = structuredClone(jobsFixture) as unknown as Job[];
    this.templates = structuredClone(templatesFixture) as unknown as TemplateSetting[];
    this.enquiries = structuredClone(enquiriesFixture) as unknown as WebsiteEnquiry[];
    this.sampleAttachments = structuredClone(sampleAttachmentsFixture) as unknown as SampleAttachment[];
    this.complianceForms = structuredClone(complianceFormsFixture) as unknown as ComplianceStore;
    this.tca2Audits = structuredClone(tca2AuditsFixture) as unknown as Record<string, Tca2AuditRecord>;
    this.draftBusinesses = [];
  }

  /**
   * Provides immediate synchronous access to the baseline state for CabmsProvider.
   * Guarantees zero blank flashes or missing-record crashes on initial component mounts.
   */
  public getInitialBaseline() {
    return structuredClone({
      brands: this.brands,
      technicians: this.technicians,
      jobTypes: this.jobTypes,
      customers: this.customers,
      jobs: this.jobs,
      templates: this.templates,
      enquiries: this.enquiries,
      sampleAttachments: this.sampleAttachments,
      complianceForms: this.complianceForms,
      tca2Audits: this.tca2Audits,
      draftBusinesses: this.draftBusinesses,
    });
  }

  // Brand Configuration
  async getBrands(): Promise<Record<BrandId, BrandConfig>> {
    return structuredClone(this.brands);
  }

  async updateBrandOperationalSettings(brandId: BrandId, payload: UpdateBrandOperationalPayload): Promise<BrandConfig> {
    const brand = this.brands[brandId];
    if (!brand) throw new NotFoundError('Brand', brandId);

    const updated: BrandConfig = {
      ...brand,
      tagline: payload.tagline ?? brand.tagline,
      contactPhone: payload.contact_phone ?? brand.contactPhone,
      contactEmail: payload.contact_email ?? brand.contactEmail,
      operationalAddress: payload.operational_address ?? brand.operationalAddress,
      operatingHours: payload.operating_hours ?? brand.operatingHours,
      preferredPreset: payload.preferred_preset ?? brand.preferredPreset,
    };

    this.brands[brandId] = updated;
    return structuredClone(updated);
  }

  async updateBrandLegalSettings(brandId: BrandId, payload: UpdateBrandLegalPayload): Promise<BrandConfig> {
    const brand = this.brands[brandId];
    if (!brand) throw new NotFoundError('Brand', brandId);

    const updated: BrandConfig = {
      ...brand,
      legalIssuerName: payload.legal_issuer_name ?? brand.legalIssuerName,
      abnPlaceholder: payload.abn ?? brand.abnPlaceholder,
      electricalLicencePlaceholder: payload.electrical_licence ?? brand.electricalLicencePlaceholder,
      acmaCablerPlaceholder: payload.acma_cabler ?? brand.acmaCablerPlaceholder,
      qbccLicencePlaceholder: payload.qbcc_licence ?? brand.qbccLicencePlaceholder,
    };

    this.brands[brandId] = updated;
    return structuredClone(updated);
  }

  async addNewBrandProfile(brand: BrandConfig): Promise<BrandConfig> {
    this.brands[brand.id] = structuredClone(brand);
    return structuredClone(brand);
  }

  async createDraftBusiness(profile: Omit<DraftBusinessProfile, 'id' | 'isDraft' | 'createdAt'>): Promise<DraftBusinessProfile> {
    const newDraft: DraftBusinessProfile = {
      ...profile,
      id: `DRAFT-BIZ-${String(this.draftBusinesses.length + 1).padStart(3, '0')}`,
      isDraft: true,
      createdAt: new Date().toISOString(),
    };
    this.draftBusinesses.push(newDraft);
    return structuredClone(newDraft);
  }

  // Customer Management
  async getCustomers(params?: { brandId?: BrandId; search?: string; page?: number; limit?: number }): Promise<PaginatedResponse<Customer>> {
    let list = this.customers;
    if (params?.brandId) {
      list = list.filter(c => c.brandAffiliations.includes(params.brandId!));
    }
    if (params?.search) {
      const q = params.search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.contactPerson.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.phone.includes(q)
      );
    }
    const page = params?.page ?? 1;
    const limit = params?.limit ?? 50;
    const totalRecords = list.length;
    const totalPages = Math.ceil(totalRecords / limit) || 1;
    const paginated = list.slice((page - 1) * limit, page * limit);

    return {
      data: structuredClone(paginated),
      pagination: {
        page,
        limit,
        total_records: totalRecords,
        total_pages: totalPages,
        has_next: page < totalPages,
      },
    };
  }

  async createCustomer(payload: Omit<Customer, 'id' | 'myobCustomerId' | 'syncStatus' | 'createdAt'>): Promise<Customer> {
    const id = `CUSTOMER-DEMO-${String(this.customers.length + 1).padStart(3, '0')}`;
    const myobId = `MYOB-DEMO-${String(this.customers.length + 1).padStart(3, '0')}`;
    const newCust: Customer = {
      ...payload,
      id,
      myobCustomerId: myobId,
      syncStatus: 'SYNCED',
      createdAt: new Date().toISOString(),
    };
    this.customers.push(newCust);
    return structuredClone(newCust);
  }

  async checkCustomerDuplicate(params: { email?: string; phone?: string; name?: string }): Promise<{ isDuplicate: boolean; matchedCustomer?: Customer }> {
    const cleanPhone = (p: string) => p.replace(/\s+/g, '').replace(/[^\d+]/g, '');
    const cleanEmail = (e: string) => e.trim().toLowerCase();

    for (const c of this.customers) {
      if (params.email && cleanEmail(c.email) === cleanEmail(params.email)) {
        return { isDuplicate: true, matchedCustomer: structuredClone(c) };
      }
      if (params.phone && cleanPhone(c.phone) === cleanPhone(params.phone) && cleanPhone(params.phone).length >= 8) {
        return { isDuplicate: true, matchedCustomer: structuredClone(c) };
      }
    }
    return { isDuplicate: false };
  }

  async reconcileUncertainCustomer(customerId: string, confirmCreate: boolean): Promise<Customer> {
    const cust = this.customers.find(c => c.id === customerId);
    if (!cust) throw new NotFoundError('Customer', customerId);
    cust.syncStatus = confirmCreate ? 'SYNCED' : 'FAILED';
    return structuredClone(cust);
  }

  // Job Management
  async getJobs(params?: { brandId?: BrandId; status?: JobStatus; techId?: string; date?: string }): Promise<Job[]> {
    let list = this.jobs;
    if (params?.brandId) list = list.filter(j => j.brandId === params.brandId);
    if (params?.status) list = list.filter(j => j.status === params.status);
    if (params?.techId) list = list.filter(j => j.assignedTechId === params.techId);
    if (params?.date) list = list.filter(j => j.scheduledDate === params.date);
    return structuredClone(list);
  }

  async getJobById(id: string): Promise<Job | null> {
    const job = this.jobs.find(j => j.id === id);
    return job ? structuredClone(job) : null;
  }

  async createJob(payload: CreateJobPayload): Promise<Job> {
    const jobType = this.jobTypes.find(jt => jt.id === payload.job_type_id);
    if (!jobType || jobType.brandId !== payload.brand_id) {
      throw new ValidationError('Job type must exist and belong to the requested brand.');
    }
    const newId = `JOB-2026-${String(this.jobs.length + 101)}`;
    const newJob: Job = {
      id: newId,
      brandId: payload.brand_id,
      customerId: payload.customer_id,
      title: payload.title,
      jobType: jobType.name,
      jobTypeVersion: jobType.version,
      siteAddress: payload.site_address,
      siteContact: payload.site_contact,
      sitePhone: payload.site_phone,
      description: payload.description,
      status: payload.scheduled_date ? 'SCHEDULED' : 'NEW',
      assignedTechId: null,
      assignedTechName: null,
      scheduledDate: payload.scheduled_date ?? null,
      scheduledTime: payload.scheduled_time ?? null,
      estimatedDurationHours: payload.estimated_duration_hours ?? 2,
      isDirectToInvoice: jobType.isDirectToInvoice,
      formsRequired: jobType.formsRequired,
      appointmentStatus: payload.scheduled_date ? 'SCHEDULED' : 'UNSCHEDULED',
      attachedSampleIds: [],
      unresolvedWarnings: [],
      reminders: [],
      activityHistory: [
        { timestamp: new Date().toISOString(), action: `Job ${newId} created`, actor: 'System' },
      ],
      reviewRequest: {
        status: 'NOT_SENT',
        reviewLink: this.brands[payload.brand_id]?.reviewUrlPlaceholder || '',
        brandName: this.brands[payload.brand_id]?.name || '',
        channel: 'EMAIL_SIMULATED',
        history: [],
      },
    };

    this.jobs.push(newJob);
    return structuredClone(newJob);
  }

  async updateJobStatus(id: string, status: JobStatus, notes?: string): Promise<Job> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundError('Job', id);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new ValidationError(`Cannot modify a ${job.status.toLowerCase()} job. Use the dedicated reopening flow for cancelled jobs.`);
    }

    job.status = status;
    job.activityHistory.push({
      timestamp: new Date().toISOString(),
      action: `Status transitioned to ${status}${notes ? `: ${notes}` : ''}`,
      actor: 'System',
    });
    return structuredClone(job);
  }

  async rescheduleJob(id: string, date: string, time: string): Promise<Job> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundError('Job', id);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new ValidationError(`Cannot modify a ${job.status.toLowerCase()} job. Use the dedicated reopening flow for cancelled jobs.`);
    }

    job.scheduledDate = date;
    job.scheduledTime = time;
    job.appointmentStatus = 'RESCHEDULED';
    if (job.status === 'NEW') job.status = 'SCHEDULED';

    job.activityHistory.push({
      timestamp: new Date().toISOString(),
      action: `Appointment rescheduled to ${date} ${time}`,
      actor: 'System',
    });
    return structuredClone(job);
  }

  async cancelJobAppointment(id: string, reason: string): Promise<Job> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundError('Job', id);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new ValidationError(`Cannot cancel appointment for a ${job.status.toLowerCase()} job.`);
    }

    job.appointmentStatus = 'CANCELLED';
    job.activityHistory.push({
      timestamp: new Date().toISOString(),
      action: `Visit cancelled (${reason}). Appointment status marked CANCELLED. Job remains active for rescheduling.`,
      actor: 'System',
    });
    return structuredClone(job);
  }

  async cancelWholeJob(id: string, reason: string): Promise<Job> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundError('Job', id);
    if (job.status === 'COMPLETED' || job.status === 'CANCELLED') {
      throw new ValidationError(`Cannot modify a ${job.status.toLowerCase()} job. Use the dedicated reopening flow for cancelled jobs.`);
    }

    job.status = 'CANCELLED';
    job.activityHistory.push({
      timestamp: new Date().toISOString(),
      action: `Job CANCELLED: ${reason}`,
      actor: 'System',
    });
    return structuredClone(job);
  }

  async reopenCancelledJob(id: string): Promise<Job> {
    const job = this.jobs.find(j => j.id === id);
    if (!job) throw new NotFoundError('Job', id);
    if (job.status !== 'CANCELLED') {
      throw new ValidationError('Job is not in CANCELLED status.');
    }

    const hasAppt = Boolean(job.assignedTechId && job.scheduledDate && job.scheduledTime);
    job.status = hasAppt ? 'SCHEDULED' : 'NEW';
    job.appointmentStatus = hasAppt ? 'SCHEDULED' : 'UNSCHEDULED';

    job.activityHistory.push({
      timestamp: new Date().toISOString(),
      action: hasAppt ? 'Job reopened and returned to schedule' : 'Job reopened as unscheduled new work order',
      actor: 'System',
    });
    return structuredClone(job);
  }

  // Job Types
  async getJobTypes(): Promise<JobTypeConfig[]> {
    return structuredClone(this.jobTypes);
  }

  async updateJobTypeConfig(typeId: string, formsRequired: JobTypeConfig['formsRequired'], isDirectToInvoice: boolean): Promise<JobTypeConfig> {
    const jt = this.jobTypes.find(t => t.id === typeId);
    if (!jt) throw new NotFoundError('JobType', typeId);

    jt.formsRequired = formsRequired;
    jt.isDirectToInvoice = isDirectToInvoice;
    return structuredClone(jt);
  }

  // Compliance Forms (Preserving immutability)
  async getJsaForm(jobId: string): Promise<JsaFormData> {
    return structuredClone(this.complianceForms.jsa[jobId]);
  }

  async saveJsaForm(jobId: string, data: Partial<JsaFormData>): Promise<JsaFormData> {
    const existing = this.complianceForms.jsa[jobId];
    if (existing?.signedOff) {
      throw new ForbiddenError('Signed JSA cannot be modified. Form is immutable.');
    }
    const updated = { ...existing, ...data } as JsaFormData;
    this.complianceForms.jsa[jobId] = updated;
    return structuredClone(updated);
  }

  async signOffJsaForm(jobId: string, signer: SignOffPayload): Promise<JsaFormData> {
    const existing = this.complianceForms.jsa[jobId];
    if (!existing) throw new NotFoundError('JsaForm', jobId);
    if (existing.signedOff) {
      throw new ForbiddenError('JSA is already signed off. Snapshot is immutable.');
    }

    existing.signedOff = true;
    existing.signedByTechName = signer.signed_by_name;
    existing.signedTimestamp = signer.signed_timestamp;
    existing.fullSnapshot = JSON.stringify(existing);
    return structuredClone(existing);
  }

  async getElectricalForm(jobId: string): Promise<ElectricalCertData> {
    return structuredClone(this.complianceForms.electrical[jobId]);
  }

  async saveElectricalForm(jobId: string, data: Partial<ElectricalCertData>): Promise<ElectricalCertData> {
    const existing = this.complianceForms.electrical[jobId];
    if (existing?.signedOff) {
      throw new ForbiddenError('Signed Electrical Certificate cannot be modified.');
    }
    const updated = { ...existing, ...data } as ElectricalCertData;
    this.complianceForms.electrical[jobId] = updated;
    return structuredClone(updated);
  }

  async signOffElectricalForm(jobId: string, signer: SignOffPayload): Promise<ElectricalCertData> {
    const existing = this.complianceForms.electrical[jobId];
    if (!existing) throw new NotFoundError('ElectricalForm', jobId);
    if (existing.signedOff) {
      throw new ForbiddenError('Electrical Certificate is already signed off. Snapshot is immutable.');
    }

    existing.signedOff = true;
    existing.signedByTechName = signer.signed_by_name;
    existing.signedTimestamp = signer.signed_timestamp;
    existing.fullSnapshot = JSON.stringify(existing);
    return structuredClone(existing);
  }

  async getSmokeAlarmForm(jobId: string): Promise<SmokeAlarmCertData> {
    return structuredClone(this.complianceForms.smokeAlarm[jobId]);
  }

  async saveSmokeAlarmForm(jobId: string, data: Partial<SmokeAlarmCertData>): Promise<SmokeAlarmCertData> {
    const existing = this.complianceForms.smokeAlarm[jobId];
    if (existing?.signedOff) {
      throw new ForbiddenError('Signed Smoke Alarm Certificate cannot be modified.');
    }
    const updated = { ...existing, ...data } as SmokeAlarmCertData;
    this.complianceForms.smokeAlarm[jobId] = updated;
    return structuredClone(updated);
  }

  async signOffSmokeAlarmForm(jobId: string, signer: SignOffPayload): Promise<SmokeAlarmCertData> {
    const existing = this.complianceForms.smokeAlarm[jobId];
    if (!existing) throw new NotFoundError('SmokeAlarmForm', jobId);
    if (existing.signedOff) {
      throw new ForbiddenError('Smoke Alarm Certificate is already signed off. Snapshot is immutable.');
    }

    existing.signedOff = true;
    existing.signedByTechName = signer.signed_by_name;
    existing.signedTimestamp = signer.signed_timestamp;
    existing.fullSnapshot = JSON.stringify(existing);
    return structuredClone(existing);
  }

  async getTca1Form(jobId: string): Promise<Tca1CertData> {
    return structuredClone(this.complianceForms.tca1[jobId]);
  }

  async saveTca1Form(jobId: string, data: Partial<Tca1CertData>): Promise<Tca1CertData> {
    const existing = this.complianceForms.tca1[jobId];
    if (existing?.signedOff) {
      throw new ForbiddenError('Signed TCA1 form cannot be modified.');
    }
    const updated = { ...existing, ...data } as Tca1CertData;
    this.complianceForms.tca1[jobId] = updated;
    return structuredClone(updated);
  }

  async signOffTca1Form(jobId: string, signer: SignOffPayload): Promise<Tca1CertData> {
    const existing = this.complianceForms.tca1[jobId];
    if (!existing) throw new NotFoundError('Tca1Form', jobId);
    if (existing.signedOff) {
      throw new ForbiddenError('TCA1 form is already signed off. Snapshot is immutable.');
    }

    existing.signedOff = true;
    existing.signedByTechName = signer.signed_by_name;
    existing.signedTimestamp = signer.signed_timestamp;
    existing.fullSnapshot = JSON.stringify(existing);
    return structuredClone(existing);
  }

  async getTca2Form(jobId: string): Promise<Tca2CertData> {
    return structuredClone(this.complianceForms.tca2[jobId]);
  }

  async saveTca2Form(jobId: string, data: Partial<Tca2CertData>): Promise<Tca2CertData> {
    const existing = this.complianceForms.tca2[jobId];
    if (existing?.signedOff) {
      throw new ForbiddenError('Signed TCA2 form cannot be modified.');
    }
    const updated = { ...existing, ...data } as Tca2CertData;
    this.complianceForms.tca2[jobId] = updated;
    return structuredClone(updated);
  }

  async signOffTca2Form(jobId: string, signer: SignOffPayload): Promise<Tca2CertData> {
    const existing = this.complianceForms.tca2[jobId];
    if (!existing) throw new NotFoundError('Tca2Form', jobId);
    if (existing.signedOff) {
      throw new ForbiddenError('TCA2 form is already signed off. Snapshot is immutable.');
    }

    existing.signedOff = true;
    existing.signedByTechName = signer.signed_by_name;
    existing.signedTimestamp = signer.signed_timestamp;
    existing.fullSnapshot = JSON.stringify(existing);
    return structuredClone(existing);
  }

  async acknowledgeTca2(jobId: string): Promise<Tca2AuditRecord> {
    if (!this.tca2Audits[jobId]) {
      this.tca2Audits[jobId] = { jobId, customerAcknowledged: false, officeReviewCompleted: false };
    }
    this.tca2Audits[jobId].customerAcknowledged = true;
    this.tca2Audits[jobId].customerAckTimestamp = new Date().toISOString();
    return structuredClone(this.tca2Audits[jobId]);
  }

  async officeReviewTca2(jobId: string, reviewerName: string): Promise<Tca2AuditRecord> {
    if (!this.tca2Audits[jobId]) {
      this.tca2Audits[jobId] = { jobId, customerAcknowledged: false, officeReviewCompleted: false };
    }
    this.tca2Audits[jobId].officeReviewCompleted = true;
    this.tca2Audits[jobId].reviewedByOfficeStaff = reviewerName;
    this.tca2Audits[jobId].officeReviewTimestamp = new Date().toISOString();
    return structuredClone(this.tca2Audits[jobId]);
  }

  async getTca2AuditRecord(jobId: string): Promise<Tca2AuditRecord | undefined> {
    const rec = this.tca2Audits[jobId];
    return rec ? structuredClone(rec) : undefined;
  }

  // Sample Attachments
  async getSampleAttachments(): Promise<SampleAttachment[]> {
    return structuredClone(this.sampleAttachments);
  }

  // Quotes & Invoices
  async getQuoteForJob(jobId: string): Promise<Quote | null> {
    const job = this.jobs.find(j => j.id === jobId);
    return job?.quote ? structuredClone(job.quote) : null;
  }

  async prepareQuoteForJob(jobId: string, title: string, lineItems: Quote['lineItems']): Promise<Quote> {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    let issuedAt: string;
    let expiresAt: string;
    let dates: ReturnType<typeof calculateQuoteFollowUpDates>;
    try {
      issuedAt = serializeBusinessInstant(this.clock());
      expiresAt = calculateQuoteExpiration(issuedAt);
      dates = calculateQuoteFollowUpDates(issuedAt, this.brands[job.brandId]?.holidayRegion || 'brisbane');
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      throw new ValidationError(`Cannot prepare quote: ${error.message}`);
    }
    const subtotal = Math.round(lineItems.reduce((acc, item) => acc + item.total, 0) * 100) / 100;
    const gst = Math.round(subtotal * 0.10 * 100) / 100;
    const total = Math.round((subtotal + gst) * 100) / 100;
    const quoteId = `QUOTE-2026-${String(jobId).replace(/[^\d]/g, '')}`;

    const newQuote: Quote = {
      id: quoteId,
      jobId,
      customerId: job.customerId,
      brandId: job.brandId,
      externalMyobRef: `MYOB-Q-${String(jobId).replace(/[^\d]/g, '')}`,
      title,
      subtotal,
      gst,
      total,
      lineItems: structuredClone(lineItems),
      termsVersion: 'v2026.1',
      termsContentSnapshot: 'Standard commercial service terms.',
      frozenIssuerSnapshot: this.brands[job.brandId]?.legalIssuerName || '',
      acceptanceStatus: 'SENT',
      linkScenario: 'valid',
      issuedAt,
      expiresAt,
      followUps: [
        {
          id: `QFU-${quoteId}-1`, quoteId, stage: 'STAGE_1_COURTESY',
          scheduledDate: dates.stage1Date, status: 'SCHEDULED', channel: 'EMAIL_SIMULATED',
        },
        {
          id: `QFU-${quoteId}-2`, quoteId, stage: 'STAGE_2_EXPIRY',
          scheduledDate: dates.stage2Date, status: 'SCHEDULED', channel: 'EMAIL_SIMULATED',
        },
      ],
      acceptanceHistory: [
        { timestamp: issuedAt, action: 'Quote prepared & staged', actor: 'System' },
      ],
    };

    job.quote = newQuote;
    return structuredClone(newQuote);
  }

  async recordQuoteAcceptance(jobId: string, scenario: string): Promise<{ success: boolean; message: string }> {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job || !job.quote) throw new NotFoundError('Quote for Job', jobId);

    const timestamp = serializeBusinessInstant(this.clock());
    if (scenario !== 'valid' || job.quote.acceptanceStatus !== 'SENT' ||
      (job.quote.expiresAt && !(Date.parse(timestamp) < Date.parse(job.quote.expiresAt)))) {
      throw new ValidationError('Quote acceptance requires a valid scenario and a SENT, unexpired quote.');
    }
    job.quote.acceptanceStatus = 'ACCEPTED';
    job.quote.acceptedAt = timestamp;
    job.quote.followUps = job.quote.followUps?.map(fu => fu.status === 'SCHEDULED' ? { ...fu, status: 'CANCELLED' } : fu);
    job.quote.acceptanceHistory.push({
      timestamp,
      action: 'Quote accepted (Recorded in Preview)',
      actor: job.siteContact,
    });
    return { success: true, message: 'Quote accepted and recorded in preview.' };
  }

  async revokeQuote(jobId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job || !job.quote) throw new NotFoundError('Quote for Job', jobId);

    const timestamp = serializeBusinessInstant(this.clock());
    job.quote.acceptanceStatus = 'REVOKED';
    job.quote.acceptanceHistory.push({
      timestamp,
      action: `Quote revoked${reason ? `: ${reason}` : ''}`,
      actor: 'System',
    });
    return { success: true, message: 'Quote revoked.' };
  }

  async refuseQuote(jobId: string, reason?: string): Promise<{ success: boolean; message: string }> {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job || !job.quote) throw new NotFoundError('Quote for Job', jobId);

    const timestamp = serializeBusinessInstant(this.clock());
    job.quote.acceptanceStatus = 'REVOKED';
    job.quote.refusalReason = reason || 'Declined by customer';
    job.quote.acceptanceHistory.push({
      timestamp,
      action: `Customer declined quotation: ${job.quote.refusalReason}`,
      actor: job.siteContact,
    });
    return { success: true, message: 'Quote declined.' };
  }

  async prepareInvoiceForJob(jobId: string, amount: number): Promise<Invoice> {
    const job = this.jobs.find(j => j.id === jobId);
    if (!job) throw new NotFoundError('Job', jobId);

    const invoice: Invoice = {
      id: `INV-2026-${String(jobId).replace(/[^\d]/g, '')}`,
      externalMyobRef: `MYOB-INV-${String(jobId).replace(/[^\d]/g, '')}`,
      amount,
      status: 'DRAFT',
      issuedDate: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      reconciliationRequired: false,
      syncStatus: 'PENDING_WRITE',
    };

    job.invoice = invoice;
    return structuredClone(invoice);
  }

  // Templates
  async getTemplates(): Promise<TemplateSetting[]> {
    return structuredClone(this.templates);
  }

  async publishTemplateVersion(templateId: string): Promise<TemplateSetting> {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) throw new NotFoundError('Template', templateId);

    tpl.activeStatus = 'PUBLISHED';
    return structuredClone(tpl);
  }

  async createTemplateDraftRevision(templateId: string, newContent: string): Promise<TemplateSetting> {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) throw new NotFoundError('Template', templateId);

    tpl.content = newContent;
    tpl.activeStatus = 'DRAFT';
    return structuredClone(tpl);
  }

  async submitTemplateForReview(templateId: string): Promise<TemplateSetting> {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) throw new NotFoundError('Template', templateId);

    tpl.activeStatus = 'REVIEW';
    return structuredClone(tpl);
  }

  // Website Enquiries
  async getEnquiries(brandId?: BrandId): Promise<WebsiteEnquiry[]> {
    let list = this.enquiries;
    if (brandId) list = list.filter(e => e.brandId === brandId);
    return structuredClone(list);
  }

  async convertEnquiry(enquiryId: string, customerId: string, jobTypeId: string): Promise<{ jobId: string; customerId: string }> {
    const enq = this.enquiries.find(e => e.id === enquiryId);
    if (!enq) throw new NotFoundError('Enquiry', enquiryId);

    const createdJob = await this.createJob({
      brand_id: enq.brandId,
      customer_id: customerId,
      title: `${enq.serviceRequested} - ${enq.customerName}`,
      job_type_id: jobTypeId,
      site_address: enq.address,
      site_contact: enq.customerName,
      site_phone: enq.phone,
      description: enq.notes,
    });

    enq.status = 'CONVERTED_TO_JOB';
    enq.convertedJobId = createdJob.id;
    return { jobId: createdJob.id, customerId };
  }

  async dismissEnquiry(enquiryId: string): Promise<void> {
    const enq = this.enquiries.find(e => e.id === enquiryId);
    if (!enq) throw new NotFoundError('Enquiry', enquiryId);
    enq.status = 'DISMISSED';
  }

  // Baseline Reset
  async resetToBaseline(): Promise<void> {
    this.hydrateFromFixtures();
  }
}
