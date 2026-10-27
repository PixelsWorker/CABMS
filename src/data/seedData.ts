/**
 * CABMS Seed Data Entrypoint
 * Re-exports sample records loaded from modular JSON fixtures in src/data/fixtures/.
 * All records strictly identified as sample preview data.
 */

import {
  BrandConfig,
  Customer,
  Job,
  JobTypeConfig,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  Tca2AuditRecord,
  SampleAttachment,
  TemplateSetting,
  WebsiteEnquiry,
} from '../types/cabms.ts';
import { INITIAL_BUSINESS_CLOCK } from '../utils/businessTime.ts';
import { getMockDataAdapter } from '../services/index.ts';

const baseline = getMockDataAdapter().getInitialBaseline();

export const INITIAL_DEMO_CLOCK = INITIAL_BUSINESS_CLOCK;

export const INITIAL_TECHNICIANS = baseline.technicians;

export const INITIAL_BRANDS: Record<string, BrandConfig> = baseline.brands;

export const INITIAL_JOB_TYPES: JobTypeConfig[] = baseline.jobTypes;

export const INITIAL_SAMPLE_ATTACHMENTS: SampleAttachment[] = baseline.sampleAttachments;

export const INITIAL_JSA_FORM: JsaFormData = baseline.complianceForms.jsa['JOB-2026-101'];

export const INITIAL_SMOKE_ALARM_CERT: SmokeAlarmCertData = baseline.complianceForms.smokeAlarm['JOB-2026-101'];

export const INITIAL_ELECTRICAL_CERT: ElectricalCertData = baseline.complianceForms.electrical['JOB-2026-103'];

export const INITIAL_TCA1_CERT: Tca1CertData = baseline.complianceForms.tca1['JOB-2026-104'];

export const INITIAL_TCA2_CERT: Tca2CertData = baseline.complianceForms.tca2['JOB-2026-104'];

export const INITIAL_TCA2_AUDIT: Record<string, Tca2AuditRecord> = baseline.tca2Audits;

export const INITIAL_CUSTOMERS: Customer[] = baseline.customers;

export const INITIAL_JOBS: Job[] = baseline.jobs;

export const INITIAL_TEMPLATES: TemplateSetting[] = baseline.templates;

export const INITIAL_WEBSITE_ENQUIRIES: WebsiteEnquiry[] = baseline.enquiries;
