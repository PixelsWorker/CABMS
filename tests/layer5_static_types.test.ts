import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  BrandId,
  Persona,
  JobStatus,
  InvoiceStatus,
  SyncStatus,
  BrandConfig,
  Customer,
  Job,
  JobTypeConfig,
  Quote,
  Invoice,
  ReviewRequest,
  ScheduledReminder,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
  TemplateSetting,
  TemplateRevision,
} from '../src/types/cabms.ts';
import { CompletionValidationResult } from '../src/utils/cabmsLogic.ts';

// Compile-time static type contract assertions
type Equal<X, Y> = (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

// Type-level contract checks
type _PersonaContract = Expect<Equal<Persona, 'super_admin' | 'owner_admin' | 'office_staff' | 'technician'>>;
type _BrandIdContract = Expect<Equal<BrandId, 'solarcell' | 'smart_home' | 'cctv' | (string & {})>>;
type _JobStatusContract = Expect<Equal<JobStatus, 'NEW' | 'SCHEDULED' | 'IN_PROGRESS' | 'NEEDS_REVISIT' | 'COMPLETED' | 'CANCELLED'>>;
type _SyncStatusContract = Expect<Equal<SyncStatus, 'SYNCED' | 'PENDING_WRITE' | 'FAILED' | 'UNCERTAIN'>>;

test('LAYER 5: Static Types — Independent tsc --noEmit static analysis pass', () => {
  const result = execSync('npx tsc --noEmit', { encoding: 'utf-8' });
  assert.equal(result.trim(), '', 'Independent TypeScript compiler type-check passed without any diagnostic errors');
});

test('LAYER 5: Static Types — Persona union contract enforcement', () => {
  const validPersonas: Persona[] = ['super_admin', 'owner_admin', 'office_staff', 'technician'];
  assert.equal(validPersonas.length, 4);
  validPersonas.forEach(p => {
    assert.ok(typeof p === 'string');
  });
});

test('LAYER 5: Static Types — Customer entity contract integrity', () => {
  const sampleCustomer: Customer = {
    id: 'CUSTOMER-DEMO-001',
    myobCustomerId: 'MYOB-DEMO-001',
    name: 'John Citizen',
    contactPerson: 'John Citizen',
    email: 'john.citizen@example.invalid',
    phone: '0400 000 001',
    billingAddress: '42 Orchid Avenue, Surfers Paradise QLD 4217',
    brandAffiliations: ['solarcell', 'smart_home'],
    syncStatus: 'SYNCED',
    createdAt: '2026-10-01',
  };

  assert.equal(typeof sampleCustomer.id, 'string');
  assert.equal(typeof sampleCustomer.myobCustomerId, 'string');
  assert.ok(Array.isArray(sampleCustomer.brandAffiliations));
  assert.ok(['SYNCED', 'PENDING_WRITE', 'FAILED', 'UNCERTAIN'].includes(sampleCustomer.syncStatus));
});

test('LAYER 5: Static Types — Job and JobTypeConfig contracts', () => {
  const jobConfig: JobTypeConfig = {
    id: 'jt-solar',
    name: 'Solar Installation & Audit',
    brandId: 'solarcell',
    formsRequired: ['JSA', 'SMOKE_ALARM'],
    isDirectToInvoice: false,
    version: 'v1.0',
  };

  assert.ok(jobConfig.formsRequired.includes('JSA'));
  assert.equal(typeof jobConfig.isDirectToInvoice, 'boolean');
  assert.equal(typeof jobConfig.version, 'string');

  const sampleJob: Job = {
    id: 'JOB-2026-101',
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Solar System Maintenance',
    jobType: jobConfig.name,
    jobTypeVersion: jobConfig.version,
    siteAddress: '42 Orchid Avenue',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Maintenance inspection',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '09:00',
    estimatedDurationHours: 3,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'SMOKE_ALARM'],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  assert.equal(typeof sampleJob.id, 'string');
  assert.equal(sampleJob.formsRequired.length, 2);
  assert.equal(sampleJob.status, 'IN_PROGRESS');
});

test('LAYER 5: Static Types — Quotation & Invoice mathematical and contract schema', () => {
  const quote: Quote = {
    id: 'QUOTE-2026-042',
    jobId: 'JOB-2026-101',
    customerId: 'CUSTOMER-DEMO-001',
    brandId: 'solarcell',
    externalMyobRef: 'MYOB-Q-88204',
    title: 'Solar Inverter Replacement',
    subtotal: 1318.18,
    gst: 131.82,
    total: 1450.00,
    lineItems: [
      {
        id: 'ITEM-1',
        description: 'Inverter Unit',
        quantity: 1,
        unitPrice: 1318.18,
        total: 1318.18,
      },
    ],
    termsVersion: 'v2.4',
    termsContentSnapshot: 'Standard Terms snapshot',
    frozenIssuerSnapshot: 'Solarcell Energy Pty Ltd • ABN 51 000 000 001',
    acceptanceStatus: 'SENT',
    linkScenario: 'valid',
    acceptanceHistory: [],
  };

  assert.equal(Math.round((quote.subtotal + quote.gst) * 100) / 100, quote.total);
  assert.equal(typeof quote.frozenIssuerSnapshot, 'string');

  const invoice: Invoice = {
    id: 'INV-2026-101',
    externalMyobRef: 'MYOB-INV-77101',
    amount: 1450.00,
    status: 'SENT_TO_MYOB',
    issuedDate: '2026-11-02',
    dueDate: '2026-11-02',
    reconciliationRequired: false,
    syncStatus: 'SYNCED',
  };

  assert.equal(typeof invoice.amount, 'number');
  assert.ok(['DRAFT', 'SENT_TO_MYOB', 'UNPAID', 'PAID', 'RECONCILIATION_REQUIRED'].includes(invoice.status));
});

test('LAYER 5: Static Types — Compliance forms schema contracts (JSA, Electrical, Smoke, TCA1, TCA2)', () => {
  const jsaContractKeys: (keyof JsaFormData)[] = [
    'jobReference',
    'date',
    'customerName',
    'siteContactPlaceholder',
    'siteAddress',
    'taskDescription',
    'assetsIdentified',
    'personnelName',
    'personnelRole',
    'licencePlaceholder',
    'licenceExpiryPlaceholder',
    'inductionCompleted',
    'competencyVerified',
    'overallRiskLevel',
    'steps',
    'ppeChecklist',
    'isolationsAndPermits',
    'emergencyAssemblyArea',
    'signedOff',
    'formRevision',
    'issuerPlaceholder',
    'attachedSampleIds',
  ];

  assert.equal(jsaContractKeys.length, 22);

  const validationResult: CompletionValidationResult = {
    canComplete: false,
    missingRequirements: ['JSA required'],
    warnings: ['Electrical Part B unresolved'],
    isDirectToInvoice: false,
  };

  assert.equal(typeof validationResult.canComplete, 'boolean');
  assert.ok(Array.isArray(validationResult.missingRequirements));
  assert.ok(Array.isArray(validationResult.warnings));
});
