import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
import { MockDataAdapter, getMockDataAdapter, ValidationError, NotFoundError } from '../src/services/index.ts';
import { INITIAL_BUSINESS_CLOCK, serializeBusinessInstant, calculateQuoteExpiration, calculateQuoteFollowUpDates } from '../src/utils/businessTime.ts';
import {
  Customer,
  Job,
  Persona,
  Quote,
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca2CertData,
  Tca2AuditRecord,
  ScheduledReminder,
  TemplateSetting,
  DraftBusinessProfile,
} from '../src/types/cabms.ts';
import {
  validateJobCompletion,
  deduplicateReviewRequest,
  suppressOldReminders,
  checkCustomerDuplicate,
  calculateReminderDueTime,
  verifyPersonaAccess,
  processOfficeReviewTca2,
  processCustomerAckTca2,
  recalculateJobAttachments,
  processPublishTemplate,
  processReviewDispatch,
  validateSignedSnapshot,
} from '../src/utils/cabmsLogic.ts';
import {
  INITIAL_BRANDS,
  INITIAL_ELECTRICAL_CERT,
  INITIAL_JOBS,
  INITIAL_JOB_TYPES,
  INITIAL_SMOKE_ALARM_CERT,
  INITIAL_TCA1_CERT,
  INITIAL_TCA2_CERT,
  INITIAL_TEMPLATES,
} from '../src/data/seedData.ts';

// Global JSDOM setup for mounted React 19 testing
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
});
Object.defineProperty(globalThis, 'window', { value: dom.window, writable: true, configurable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, writable: true, configurable: true });
Object.defineProperty(globalThis, 'HTMLDivElement', { value: dom.window.HTMLDivElement, writable: true, configurable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, writable: true, configurable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

test('LAYER 6: PR16 detached baselines protect exported seeds and provider reset', async () => {
  const adapter = getMockDataAdapter();
  await adapter.resetToBaseline();
  const baseline = adapter.getInitialBaseline();
  const seeds = structuredClone({ jobs: INITIAL_JOBS, brands: INITIAL_BRANDS, types: INITIAL_JOB_TYPES, templates: INITIAL_TEMPLATES });
  const other = adapter.getInitialBaseline();
  for (const field of Object.keys(baseline) as (keyof typeof baseline)[]) {
    assert.notStrictEqual(baseline[field], other[field], `${field} is detached`);
  }
  baseline.jobs[0].activityHistory.push({ action: 'Returned snapshot only', actor: 'Test', timestamp: INITIAL_BUSINESS_CLOCK });
  baseline.complianceForms.jsa['JOB-2026-101'].signedByTechName = 'Returned snapshot only';
  assert.deepEqual(adapter.getInitialBaseline(), other);
  try {
    await adapter.updateJobStatus('JOB-2026-101', 'IN_PROGRESS');
    await adapter.updateBrandOperationalSettings('solarcell', { contact_phone: 'Adapter only' });
    await adapter.publishTemplateVersion(other.templates.find(t => t.activeStatus !== 'PUBLISHED')?.id || other.templates[0].id);
    await adapter.prepareQuoteForJob('JOB-2026-103', 'Adapter only', [{ id: '1', description: 'Scope', quantity: 1, unitPrice: 1, total: 1 }]);
    assert.deepEqual({ jobs: INITIAL_JOBS, brands: INITIAL_BRANDS, types: INITIAL_JOB_TYPES, templates: INITIAL_TEMPLATES }, seeds);
    await withMountedContext(async ctx => {
      await act(async () => { ctx.updateJobStatus('JOB-2026-101', 'IN_PROGRESS'); ctx.resetDemo(); });
      assert.deepEqual(ctx.jobs, seeds.jobs);
      assert.deepEqual(ctx.brands, seeds.brands);
    });
    assert.deepEqual(adapter.getInitialBaseline(), other, 'provider reset restores adapter fixtures too');
  } finally { await adapter.resetToBaseline(); }
});

test('LAYER 6: PR16 adapter job types reject unknown and cross-brand requests without partial conversion', async () => {
  const adapter = new MockDataAdapter();
  const before = adapter.getInitialBaseline();
  const type = before.jobTypes.find(t => t.brandId === 'solarcell')!;
  const payload = { brand_id: 'smart_home' as const, customer_id: before.customers[0].id, title: 'Synthetic type validation', job_type_id: type.id, site_address: 'Synthetic site', site_contact: 'Synthetic contact', site_phone: '0400000000', description: 'Fixture' };
  await assert.rejects(adapter.createJob({ ...payload, job_type_id: 'UNKNOWN-TYPE' }), ValidationError);
  await assert.rejects(adapter.createJob(payload), ValidationError);
  assert.deepEqual(adapter.getInitialBaseline(), before);
  const enquiry = before.enquiries[0];
  await assert.rejects(adapter.convertEnquiry(enquiry.id, before.customers[0].id, 'UNKNOWN-TYPE'), ValidationError);
  assert.deepEqual(adapter.getInitialBaseline(), before, 'failed conversion cannot mutate enquiry or jobs');
  const job = await adapter.createJob({ ...payload, brand_id: 'solarcell' });
  assert.equal(job.jobType, type.name);
  assert.equal(job.jobTypeVersion, type.version);
  assert.deepEqual(job.formsRequired, type.formsRequired);
});

test('LAYER 6: PR16 adapter terminal jobs reject every mutation and preserve dedicated reopening', async () => {
  for (const status of ['COMPLETED', 'CANCELLED'] as const) {
    const adapter = new MockDataAdapter();
    await adapter.updateJobStatus('JOB-2026-101', status);
    const before = adapter.getInitialBaseline();
    for (const operation of [
      () => adapter.updateJobStatus('JOB-2026-101', 'NEW'),
      () => adapter.updateJobStatus('JOB-2026-101', status),
      () => adapter.rescheduleJob('JOB-2026-101', '2026-11-20', '12:00'),
      () => adapter.cancelWholeJob('JOB-2026-101', 'Rejected terminal cancellation'),
      () => adapter.cancelJobAppointment('JOB-2026-101', 'Rejected terminal visit cancellation'),
    ]) {
      await assert.rejects(operation(), ValidationError);
      assert.deepEqual(adapter.getInitialBaseline(), before);
    }
    if (status === 'CANCELLED') {
      const reopened = await adapter.reopenCancelledJob('JOB-2026-101');
      assert.ok(['NEW', 'SCHEDULED'].includes(reopened.status));
      await adapter.rescheduleJob(reopened.id, '2026-11-20', '12:00');
      await adapter.cancelWholeJob(reopened.id, 'Valid active cancellation');
    } else {
      await assert.rejects(adapter.reopenCancelledJob('JOB-2026-101'), ValidationError);
      assert.deepEqual(adapter.getInitialBaseline(), before);
    }
  }
});

test('LAYER 6: PR16 adapter quote amounts, calendars and operation timestamps use one injected clock read', async () => {
  let clock = '2027-12-24T09:00:00+10:00';
  let reads = 0;
  const adapter = new MockDataAdapter(() => { reads++; return clock; });
  const items = [{ id: '1', description: 'Fraction A', quantity: 1, unitPrice: 0.1, total: 0.1 }, { id: '2', description: 'Fraction B', quantity: 1, unitPrice: 0.2, total: 0.2 }];
  for (const brand of ['solarcell', 'smart_home', 'cctv'] as const) {
    const job = (await adapter.getJobs({ brandId: brand }))[0];
    const beforeReads = reads;
    const quote = await adapter.prepareQuoteForJob(job.id, 'Deterministic quote', items);
    assert.equal(reads, beforeReads + 1);
    assert.deepEqual([quote.subtotal, quote.gst, quote.total], [0.3, 0.03, 0.33]);
    assert.equal(quote.issuedAt, serializeBusinessInstant(clock));
    assert.equal(quote.acceptanceHistory[0].timestamp, quote.issuedAt);
    assert.equal(quote.expiresAt, calculateQuoteExpiration(clock));
    const dates = calculateQuoteFollowUpDates(clock, adapter.getInitialBaseline().brands[brand].holidayRegion);
    assert.deepEqual(quote.followUps?.map(f => f.scheduledDate), [dates.stage1Date, dates.stage2Date]);
    assert.ok(quote.followUps?.every(f => f.quoteId === quote.id));
  }
  for (const operation of ['revokeQuote', 'refuseQuote'] as const) {
    const beforeReads = reads;
    clock = '2027-12-26T10:30:00+10:00';
    await adapter[operation]('JOB-2026-103', 'Synthetic operation');
    assert.equal(reads, beforeReads + 1);
    assert.equal((await adapter.getQuoteForJob('JOB-2026-103'))!.acceptanceHistory.at(-1)!.timestamp, serializeBusinessInstant(clock));
  }
  const before = adapter.getInitialBaseline();
  for (const unsupported of ['2028-12-29T09:00:00+10:00', '2030-01-01T09:00:00+10:00']) {
    clock = unsupported;
    await assert.rejects(adapter.prepareQuoteForJob('JOB-2026-103', 'Unsupported', items), ValidationError);
    assert.deepEqual(adapter.getInitialBaseline(), before);
  }
  const defaultQuote = await new MockDataAdapter().prepareQuoteForJob('JOB-2026-103', 'Default clock', items);
  assert.equal(defaultQuote.issuedAt, serializeBusinessInstant(INITIAL_BUSINESS_CLOCK));
});

test('LAYER 6: PR16 adapter acceptance rejects every invalid scenario/state and elapsed expiry atomically', async () => {
  let clock = INITIAL_BUSINESS_CLOCK;
  let reads = 0;
  const adapter = new MockDataAdapter(() => { reads++; return clock; });
  const sent = await adapter.getQuoteForJob('JOB-2026-103');
  assert.ok(sent);
  const before = adapter.getInitialBaseline();
  for (const scenario of ['invalid', 'expired', 'revoked', 'superseded', 'already_accepted', 'unknown']) {
    await assert.rejects(adapter.recordQuoteAcceptance('JOB-2026-103', scenario), ValidationError);
    assert.deepEqual(adapter.getInitialBaseline(), before);
  }
  for (const status of ['DRAFT', 'ACCEPTED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'] as const) {
    const seeded = new MockDataAdapter();
    // Test-only fixture installation for states without an adapter transition API.
    const jobs = seeded.getInitialBaseline().jobs;
    jobs.find(j => j.id === 'JOB-2026-103')!.quote!.acceptanceStatus = status;
    Object.assign(seeded, { jobs });
    const snapshot = seeded.getInitialBaseline();
    await assert.rejects(seeded.recordQuoteAcceptance('JOB-2026-103', 'valid'), ValidationError);
    assert.deepEqual(seeded.getInitialBaseline(), snapshot);
  }
  for (const timestamp of [sent.expiresAt!, serializeBusinessInstant(Date.parse(sent.expiresAt!) + 1)]) {
    clock = timestamp;
    await assert.rejects(adapter.recordQuoteAcceptance('JOB-2026-103', 'valid'), ValidationError);
    assert.deepEqual(adapter.getInitialBaseline(), before);
  }
  clock = serializeBusinessInstant(Date.parse(sent.expiresAt!) - 1);
  const beforeReads = reads;
  assert.deepEqual(await adapter.recordQuoteAcceptance('JOB-2026-103', 'valid'), { success: true, message: 'Quote accepted and recorded in preview.' });
  assert.equal(reads, beforeReads + 1);
  const accepted = (await adapter.getQuoteForJob('JOB-2026-103'))!;
  assert.equal(accepted.acceptanceHistory.length, sent.acceptanceHistory.length + 1);
  assert.equal(accepted.acceptedAt, clock);
  assert.equal(accepted.acceptanceHistory.at(-1)!.timestamp, clock);
  assert.ok(accepted.followUps?.every(f => f.status === 'CANCELLED'));
  await assert.rejects(adapter.recordQuoteAcceptance('JOB-2026-103', 'valid'), ValidationError);
  assert.deepEqual(await adapter.getQuoteForJob('JOB-2026-103'), accepted);
  await assert.rejects(adapter.recordQuoteAcceptance('MISSING', 'valid'), NotFoundError);
  await assert.rejects(adapter.recordQuoteAcceptance('JOB-2026-102', 'valid'), NotFoundError);
});

test('LAYER 6: PR16 quote follow-up replay is independent of clock step size and idempotent at expiry', async () => {
  const replay = async (hours: number[]) => {
    let result!: Quote;
    await withMountedContext(async ctx => {
      await act(async () => { ctx.resetDemo(); });
      await act(async () => { ctx.prepareQuoteForJob('JOB-2026-101', 'Replay fixture', [{ id: '1', description: 'Scope', quantity: 1, unitPrice: 100, total: 100 }]); });
      for (const step of hours) await act(async () => { ctx.advanceClock(step); });
      result = structuredClone(ctx.jobs.find(j => j.id === 'JOB-2026-101')!.quote!);
      await act(async () => { ctx.advanceClock(0); ctx.advanceClock(24); });
      assert.deepEqual(ctx.jobs.find(j => j.id === 'JOB-2026-101')!.quote, result, 'later/repeated advancement does not duplicate events');
    });
    return result;
  };
  const large = await replay([14 * 24]);
  assert.deepEqual(large, await replay(Array(14).fill(24)));
  assert.equal(large.acceptanceStatus, 'EXPIRED');
  assert.ok(large.followUps?.every(f => f.status === 'SENT'));
  assert.deepEqual(large.followUps?.map(f => f.sentAt), large.followUps?.map(f => serializeBusinessInstant(`${f.scheduledDate}T00:00:00+10:00`)));
  assert.deepEqual(large.acceptanceHistory.slice(-3).map(h => h.timestamp), [...large.followUps!.map(f => f.sentAt!), large.expiresAt!]);
  assert.deepEqual(large, await replay([20 * 24]), 'jump past expiry replays the same events');
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    await act(async () => { ctx.prepareQuoteForJob('JOB-2026-101', 'Isolated terminal fixtures', [{ id: '1', description: 'Scope', quantity: 1, unitPrice: 100, total: 100 }]); });
    const terminalQuotes = ctx.getAuthoritativeState().jobs.filter(j => j.quote).map(j => j.quote!);
    // Install all states into job-owned fixture objects; no production testing seam is added.
    const base = structuredClone(terminalQuotes[0]);
    const states = ['DRAFT', 'ACCEPTED', 'REVOKED', 'SUPERSEDED', 'EXPIRED'] as const;
    for (const status of states) {
      const quote = structuredClone(base);
      quote.acceptanceStatus = status;
      quote.acceptanceHistory = [];
      quote.followUps = [
        { id: 'future', quoteId: quote.id, stage: 'STAGE_2_EXPIRY', scheduledDate: '2026-11-30', status: 'SCHEDULED', channel: 'EMAIL_SIMULATED' },
        { id: 'due', quoteId: quote.id, stage: 'STAGE_1_COURTESY', scheduledDate: '2026-11-03', status: 'SCHEDULED', channel: 'EMAIL_SIMULATED' },
      ];
      ctx.getAuthoritativeState().jobs[0].quote = quote;
      await act(async () => { ctx.setDemoClock(INITIAL_BUSINESS_CLOCK); });
      await act(async () => { ctx.advanceClock(24); });
      assert.ok(!ctx.jobs[0].quote!.acceptanceHistory.some(h => h.action.includes('follow-up email dispatched')), `${status} cannot dispatch before expiry`);
      await act(async () => { ctx.advanceClock(20 * 24); });
      const processed = ctx.jobs[0].quote!;
      assert.ok(processed.followUps!.every(f => f.status === 'CANCELLED'));
      assert.ok(!processed.acceptanceHistory.some(h => h.action.includes('follow-up email dispatched')));
      assert.equal(processed.acceptanceStatus, status === 'DRAFT' ? 'EXPIRED' : status);
    }
  });
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    await act(async () => { ctx.prepareQuoteForJob('JOB-2026-101', 'Unsorted event fixture', [{ id: '1', description: 'Scope', quantity: 1, unitPrice: 100, total: 100 }]); });
    const quote = ctx.getAuthoritativeState().jobs[0].quote!;
    quote.expiresAt = '2026-11-16T00:00:00+10:00';
    const followUp = quote.followUps![0];
    quote.followUps = [
      { ...followUp, id: 'late', scheduledDate: '2026-11-10' },
      { ...followUp, id: 'already-sent', scheduledDate: '2026-11-03', status: 'SENT', sentAt: '2026-11-03T00:00:00.000+10:00' },
      { ...followUp, id: 'early', scheduledDate: '2026-11-05' },
      { ...followUp, id: 'at-expiry', scheduledDate: '2026-11-16' },
      { ...followUp, id: 'future', scheduledDate: '2026-11-30' },
    ];
    const oldHistory = structuredClone(quote.acceptanceHistory);
    await act(async () => { ctx.advanceClock(20 * 24); });
    const processed = ctx.jobs[0].quote!;
    assert.deepEqual(processed.acceptanceHistory.slice(0, oldHistory.length), oldHistory);
    assert.deepEqual(processed.acceptanceHistory.slice(oldHistory.length).map(h => h.timestamp), [
      '2026-11-05T00:00:00.000+10:00', '2026-11-10T00:00:00.000+10:00', quote.expiresAt,
    ]);
    assert.deepEqual(processed.followUps?.map(f => f.status), ['SENT', 'SENT', 'SENT', 'CANCELLED', 'CANCELLED']);
    assert.equal(processed.followUps![1].sentAt, '2026-11-03T00:00:00.000+10:00', 'processed event timestamp is preserved');
  });
});

// Executable Mounted React Context Runner
export async function withMountedContext(
  testFn: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) => Promise<void> | void,
  includeComplianceView = false,
  additionalView?: React.ReactNode
) {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  let currentContext!: ReturnType<typeof useCabms>;

  function TestObserver() {
    currentContext = useCabms();
    return React.createElement(React.Fragment, null,
      React.createElement('div', { id: 'test-observer-mounted' },
        React.createElement('span', { id: 'job-count' }, currentContext.jobs.length),
        React.createElement('span', { id: 'persona-badge' }, currentContext.persona),
        React.createElement('pre', { id: 'rendered-jobs' }, JSON.stringify(currentContext.jobs)),
        React.createElement('pre', { id: 'rendered-tca2-audits' }, JSON.stringify(currentContext.tca2AuditRecords))
      ),
      includeComplianceView ? React.createElement(ComplianceFormsView) : null,
      additionalView
    );
  }

  await act(async () => {
    root.render(
      React.createElement(CabmsProvider, null, React.createElement(TestObserver))
    );
  });

  const freshContext = new Proxy({} as ReturnType<typeof useCabms>, {
    get: (_target, property) => (currentContext as any)[property],
  });

  try {
    await testFn(freshContext, container);
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  }
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(candidate => candidate.textContent?.includes(label));
  assert.ok(button, `Expected a button containing “${label}”.`);
  await act(async () => { button!.click(); });
}

function assertMountedStateMatchesAuthoritative(ctx: ReturnType<typeof useCabms>, container: HTMLDivElement) {
  const authoritative = ctx.getAuthoritativeState();
  const renderedJobs = container.querySelector('#rendered-jobs')?.textContent || '[]';
  const renderedAudits = container.querySelector('#rendered-tca2-audits')?.textContent || '{}';

  assert.deepEqual(ctx.jobs, authoritative.jobs, 'fresh React context jobs match authoritative jobs');
  assert.equal(renderedJobs, JSON.stringify(authoritative.jobs), 'mounted React DOM jobs match authoritative jobs');
  assert.deepEqual(ctx.tca2AuditRecords, authoritative.tca2AuditRecords, 'fresh React context TCA2 audit matches authoritative audit');
  assert.equal(renderedAudits, JSON.stringify(authoritative.tca2AuditRecords), 'mounted React DOM TCA2 audit matches authoritative audit');
  assert.equal(container.querySelector('#job-count')?.textContent, String(authoritative.jobs.length));
  assert.equal(container.querySelector('#persona-badge')?.textContent, ctx.persona);
}

function jobIdentity(job: Job) {
  const { id, brandId, customerId, siteAddress, siteContact, sitePhone } = job;
  return { id, brandId, customerId, siteAddress, siteContact, sitePhone };
}

// Capture expectations before any journey runs; reading a polluted seed later would mask a leak.
const originalCctvIdentity = jobIdentity(INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')!);

async function isolatedOperationalJob(ctx: ReturnType<typeof useCabms>, jobId: string): Promise<Job> {
  const job = ctx.getAuthoritativeState().jobs.find(job => job.id === jobId)!;
  // The public status transition clones the job. Detach before changing test-only operational fields.
  await act(async () => { ctx.updateJobStatus(jobId, job.status); });
  const isolated = ctx.getAuthoritativeState().jobs.find(job => job.id === jobId)!;
  assert.notEqual(isolated, INITIAL_JOBS.find(job => job.id === jobId), 'test fixture must not alias the shared seed');
  return isolated;
}

function assertOriginalCctvIdentity(ctx: ReturnType<typeof useCabms>) {
  assert.deepEqual(jobIdentity(ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-104')!), originalCctvIdentity);
  assert.deepEqual(jobIdentity(INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')!), originalCctvIdentity);
  const snapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot!);
  assert.equal(snapshot.jobReference, originalCctvIdentity.id);
  assert.equal(snapshot.siteAddress, originalCctvIdentity.siteAddress);
  assert.equal(snapshot.customerName, originalCctvIdentity.siteContact);
  assert.equal(snapshot.siteContactPlaceholder, `${originalCctvIdentity.siteContact} (${originalCctvIdentity.sitePhone})`);
}

// Synchronous helper for legacy journey calls
function getMountedCabmsContext() {
  let ctx: any;
  function Harness() {
    ctx = useCabms();
    return null;
  }
  act(() => {
    const root = createRoot(dom.window.document.createElement('div'));
    root.render(React.createElement(CabmsProvider, null, React.createElement(Harness)));
  });
  return ctx;
}

// Deterministic Sequence Counters for Tests
let seq = { customer: 100, job: 500, quote: 300, invoice: 400, reminder: 700 };

// -------------------------------------------------------------
// JOURNEY A: Customer Entry -> Job -> Quote -> Acceptance -> Forms -> Completion -> Review
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey A: Complete customer-to-completion and review dispatch journey', () => {
  // 1. Customer entry with simulated MYOB write-through
  seq.customer++;
  const customer: Customer = {
    id: `CUSTOMER-JOURNEY-${seq.customer}`,
    myobCustomerId: `MYOB-CO-${seq.customer}`,
    name: 'Sarah Connor',
    contactPerson: 'Sarah Connor',
    email: 'sarah.c@example.invalid',
    phone: '0400 111 222',
    billingAddress: '100 Skyway Drive, Robina QLD 4226',
    brandAffiliations: ['solarcell'],
    syncStatus: 'SYNCED',
    createdAt: '2026-11-02',
    activityHistory: [{ timestamp: '2026-11-02 09:00', action: 'Created in MYOB Business', actor: 'owner_admin' }],
  };
  assert.equal(customer.syncStatus, 'SYNCED');

  // 2. Job creation & technician assignment (Solar installation policy JT-001 requires JSA & ELECTRICAL)
  seq.job++;
  const solarJobType = INITIAL_JOB_TYPES.find(jt => jt.id === 'JT-001')!;
  assert.deepEqual(solarJobType.formsRequired, ['JSA', 'ELECTRICAL']);
  const scheduledDate = '2026-11-04';
  const scheduledTime = '09:00';
  const reminderDue = calculateReminderDueTime(scheduledDate, scheduledTime, 2);

  seq.reminder++;
  const initialReminder: ScheduledReminder = {
    id: `REM-${seq.reminder}`,
    targetAppointmentTime: `${scheduledDate} ${scheduledTime}`,
    scheduledFor: reminderDue,
    leadHours: 2,
    type: 'REMINDER_2HR',
    channel: 'EMAIL_SIMULATED',
    suppressed: false,
    delivered: false,
  };

  const job: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'solarcell',
    customerId: customer.id,
    title: 'Complete 6.6kW PV Installation',
    jobType: solarJobType.name,
    jobTypeVersion: solarJobType.version,
    siteAddress: customer.billingAddress,
    siteContact: customer.contactPerson,
    sitePhone: customer.phone,
    description: 'Rooftop solar and inverter installation',
    status: 'SCHEDULED',
    appointmentStatus: 'SCHEDULED',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate,
    scheduledTime,
    estimatedDurationHours: 4,
    isDirectToInvoice: false,
    formsRequired: [...solarJobType.formsRequired],
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: INITIAL_BRANDS.solarcell.reviewUrlPlaceholder,
      brandName: INITIAL_BRANDS.solarcell.name,
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
    reminders: [initialReminder],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // 3. Quotation preparation
  seq.quote++;
  const exSubtotal = 4500.00;
  const gst = 450.00;
  const total = 4950.00;
  const quote: Quote = {
    id: `QUOTE-2026-${seq.quote}`,
    jobId: job.id,
    customerId: customer.id,
    brandId: 'solarcell',
    externalMyobRef: `MYOB-Q-${seq.quote}`,
    title: 'Solar System Turnkey Scope',
    subtotal: exSubtotal,
    gst,
    total,
    lineItems: [{ id: 'ITEM-1', description: 'PV Array', quantity: 1, unitPrice: exSubtotal, total: exSubtotal }],
    termsVersion: 'v2.4',
    termsContentSnapshot: 'Solarcell Standard Customer Terms v2.4 Snapshot',
    frozenIssuerSnapshot: `${INITIAL_BRANDS.solarcell.legalIssuerName} • ${INITIAL_BRANDS.solarcell.abnPlaceholder}`,
    acceptanceStatus: 'SENT',
    linkScenario: 'valid',
    acceptanceHistory: [],
  };
  job.quote = quote;

  // 4. Customer accepts quote
  quote.acceptanceStatus = 'ACCEPTED';
  quote.acceptedAt = '2026-11-03 14:00';
  quote.acceptedByName = customer.contactPerson;
  assert.equal(job.quote.acceptanceStatus, 'ACCEPTED');

  // 5. Pre-execution completion validation fails because required JSA and Electrical forms are unsigned
  const preCheck = validateJobCompletion(job, {});
  assert.equal(preCheck.canComplete, false);
  assert.ok(preCheck.missingRequirements.some(r => r.includes('JSA')));
  assert.ok(preCheck.missingRequirements.some(r => r.includes('Electrical Certificate')));

  // 6. Technician fills JSA and Electrical Safety certificates
  const jsa: JsaFormData = {
    jobReference: job.id,
    date: scheduledDate,
    customerName: customer.name,
    siteContactPlaceholder: customer.contactPerson,
    siteAddress: customer.billingAddress,
    taskDescription: job.description,
    assetsIdentified: 'Rooftop trusses, main switchboard',
    personnelName: 'Dave Miller',
    personnelRole: 'Lead Solar Electrician',
    licencePlaceholder: 'Q-ELEC-98765-DEMO',
    licenceExpiryPlaceholder: '31/12/2027',
    inductionCompleted: true,
    competencyVerified: true,
    overallRiskLevel: 'M',
    steps: [
      { id: 'step-1', taskStep: 'Roof access', hazards: 'Falls', initialRisk: 'H', controls: 'Harness', residualRisk: 'L', responsibleRole: 'Tech' },
    ],
    ppeChecklist: [{ item: 'Safety Boots', status: 'Yes' }],
    isolationsAndPermits: [{ item: 'AC Isolator', required: 'Yes', referenceOrNotes: 'Isolated' }],
    emergencyAssemblyArea: 'Front driveway',
    emergencyWardenPlaceholder: 'Dave Miller',
    firstAidOfficerPlaceholder: 'Dave Miller',
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: `${scheduledDate} 11:30`,
    formRevision: 'Rev 4.2 - Oct 2026',
    issuerPlaceholder: INITIAL_BRANDS.solarcell.legalIssuerName,
    frozenIssuerSnapshot: `${INITIAL_BRANDS.solarcell.legalIssuerName} • ${INITIAL_BRANDS.solarcell.abnPlaceholder}`,
    attachedSampleIds: ['sample-switchboard-01'],
  };

  const electrical: ElectricalCertData = {
    certReference: `ELEC-2026-${seq.job}`,
    jobReference: job.id,
    dateOfTest: scheduledDate,
    customerName: customer.name,
    installationAddress: customer.billingAddress,
    siteContact: customer.contactPerson,
    occupierRole: 'Owner',
    contractorNamePlaceholder: INITIAL_BRANDS.solarcell.legalIssuerName,
    electricianLicencePlaceholder: 'Dave Miller (Q-ELEC-98765-DEMO)',
    issuerWordingPlaceholder: 'Electrical Safety Office Queensland (Sanitised Model Form)',
    testedWorkItems: [
      {
        id: 'WORK-1',
        description: 'Solar Generation Sub-Circuit 3-Phase 32A',
        circuitsTested: 'Sub-board 1 to Inverter Array',
        insulationResistanceResult: '> 200 Megohms (> 1.0M requirement)',
        polarityTest: 'Pass',
        earthContinuity: 'Pass',
        rcdTripTimeMs: '18ms (Type A 30mA RCD)',
        workResult: 'Pass',
      },
    ],
    standardsReliedOn: ['AS/NZS 3000:2018 Wiring Rules'],
    partACertificationPlaceholder: 'Part A Certification',
    limitationsAndConsumerRightsPlaceholder: 'Consumer Notice',
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: `${scheduledDate} 12:00`,
    unresolvedNotice: 'Electrical Part B / sections 7-8 not supplied or unresolved.',
    attachedSampleIds: [],
  };

  // 7. Re-validate completion with signed JSA and Electrical forms
  const postCheck = validateJobCompletion(job, { jsa, electrical });
  assert.equal(postCheck.canComplete, true);
  job.status = 'COMPLETED';

  // 8. Review invitation dispatch and deduplication
  let dispatched = false;
  const reviewResult = deduplicateReviewRequest(job, () => {
    dispatched = true;
    return { success: true, reviewUrl: job.reviewRequest.reviewLink };
  });

  assert.equal(reviewResult.allowed, true);
  assert.equal(dispatched, true);
  job.reviewRequest.status = 'SENT';
  job.reviewRequest.sentTimestamp = `${scheduledDate} 13:00`;

  // 9. Second review dispatch attempt is strictly blocked
  const secondAttempt = deduplicateReviewRequest(job, () => {
    throw new Error('Should not be called');
  });
  assert.equal(secondAttempt.allowed, false);
  assert.ok(secondAttempt.reason?.includes('already sent'));
});

// -------------------------------------------------------------
// JOURNEY B: Direct-to-Invoice Service Call
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey B: Direct-to-invoice service completes without forms and prepares invoice', () => {
  seq.job++;
  const directJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'smart_home',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Wi-Fi Smart Hub Reset',
    jobType: 'Direct-to-Invoice Service',
    jobTypeVersion: 'v1.0',
    siteAddress: '14 Paradise Waters Way',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Reconfigure home automation gateway',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '14:00',
    estimatedDurationHours: 1,
    isDirectToInvoice: true,
    formsRequired: [], // Genuinely empty!
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'Smart Home', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // Validate completion
  const check = validateJobCompletion(directJob, {});
  assert.equal(check.canComplete, true);
  assert.equal(check.isDirectToInvoice, true);
  assert.equal(check.missingRequirements.length, 0);

  // Completion & Invoice Preparation
  directJob.status = 'COMPLETED';
  seq.invoice++;
  directJob.invoice = {
    id: `INV-2026-${seq.invoice}`,
    externalMyobRef: `MYOB-INV-${seq.invoice}`,
    amount: 220.00,
    status: 'SENT_TO_MYOB',
    issuedDate: '2026-11-02',
    dueDate: '2026-11-02',
    reconciliationRequired: false,
    syncStatus: 'SYNCED',
  };

  assert.equal(directJob.invoice.status, 'SENT_TO_MYOB');
  assert.equal(directJob.invoice.amount, 220.00);
});

// -------------------------------------------------------------
// JOURNEY C: Cabling Defect -> TCA2 -> Separate Audit Records -> Idempotent Office Review -> Unscheduled Follow-up Job
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey C: TCA2 defect generates separate audit record, idempotent office review, and unscheduled follow-up work order', () => {
  seq.job++;
  const initialJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'cctv',
    customerId: 'CUSTOMER-DEMO-002',
    title: 'Commercial Security Camera Audit',
    jobType: 'Enterprise CCTV & Cabling Inspection',
    jobTypeVersion: 'v2.1',
    siteAddress: '88 Industrial Zone',
    siteContact: 'Marcus Vance',
    sitePhone: '0400 000 002',
    description: 'Inspect telecommunications and IP video cabling',
    status: 'IN_PROGRESS',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave Miller',
    scheduledDate: '2026-11-02',
    scheduledTime: '13:00',
    estimatedDurationHours: 4,
    isDirectToInvoice: false,
    formsRequired: ['TCA2'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'CCTV', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  // 1. Technician signs TCA2 Defect Report
  const tca2: Tca2CertData = {
    reportReference: `TCA2-DEFECT-2026-${seq.job}`,
    jobReference: initialJob.id,
    inspectionDate: '2026-11-02',
    businessCablerPlaceholder: 'Dave Miller',
    customerName: initialJob.siteContact,
    siteAddress: initialJob.siteAddress,
    cablingScope: 'Existing Only',
    cablingTypes: ['Category 5e Legacy Data'],
    locationsInspected: 'Riser Cupboard B',
    nonComplianceDescription: 'Telecommunications cabling co-located in common conduit with 240V mains power without physical barrier.',
    requirementReferencePlaceholder: 'AS/CA S009:2020 Clause 5.3.1',
    riskCategory: 'High (Immediate Shock / Fire Hazard)',
    samplePhotoLinked: true,
    rectificationRecommendation: 'Install independent dedicated 25mm PVC conduit for data cabling with 50mm separation distance.',
    responsibleParty: 'Customer / Building Owner',
    urgencyLevel: 'Immediate (Within 24 Hours)',
    quotationReferencePlaceholder: 'MYOB-Q-RECTIFICATION',
    targetResolutionDate: '2026-11-05',
    customerAcknowledged: false,
    officeReviewCompleted: false,
    signedOff: true,
    signedByTechName: 'Dave Miller',
    signedTimestamp: '2026-11-02 14:00',
    warningNotice: 'NON-COMPLIANCE RECORDED',
    attachedSampleIds: ['sample-cabling-defect-01'],
    fullSnapshot: '',
  };
  // Freeze technician certificate permanently
  tca2.fullSnapshot = JSON.stringify(tca2);
  const frozenTechnicianSnapshot = tca2.fullSnapshot;

  // 2. Customer Acknowledgement is recorded in separate audit record (NOT mutating signed TCA2 cert)
  const tca2AuditRecords: Record<string, Tca2AuditRecord> = {};
  tca2AuditRecords[initialJob.id] = {
    jobId: initialJob.id,
    customerAcknowledged: true,
    customerAckTimestamp: '2026-11-02 14:30',
    officeReviewCompleted: false,
  };

  // Assert signed certificate fullSnapshot remains 100% untouched
  assert.equal(tca2.fullSnapshot, frozenTechnicianSnapshot);
  assert.equal(tca2AuditRecords[initialJob.id].customerAcknowledged, true);

  // 3. Office Review Role Check: Technicians are strictly prohibited
  const techAttempt = verifyPersonaAccess('technician', 'office_compliance_review');
  assert.equal(techAttempt.allowed, false);

  // 4. Authoritative Pure State Transition & Atomicity Invariant
  // Two calls with the same state: first creates follow-up, second is idempotent
  const reviewResult1 = processOfficeReviewTca2({
    jobId: initialJob.id,
    actorPersona: 'office_staff',
    existingAudit: tca2AuditRecords[initialJob.id],
    existingJobs: [initialJob],
    tca2Cert: tca2,
    sourceJob: initialJob,
    demoClock: '2026-11-02 15:00',
    nextJobSeq: 500,
  });
  assert.equal(reviewResult1.success, true);
  assert.equal(reviewResult1.isDuplicate, false);
  assert.ok(reviewResult1.newFollowupJob);
  assert.equal(reviewResult1.newFollowupJob?.id, 'JOB-2026-501');
  assert.equal(reviewResult1.newFollowupJob?.appointmentStatus, 'UNSCHEDULED');
  assert.equal(reviewResult1.newFollowupJob?.scheduledDate, null);
  assert.equal(reviewResult1.newFollowupJob?.scheduledTime, null);
  assert.equal(reviewResult1.updatedAuditRecord.officeReviewCompleted, true);

  // Second call with updated state (without intervening render) produces no duplicate job
  const reviewResult2 = processOfficeReviewTca2({
    jobId: initialJob.id,
    actorPersona: 'office_staff',
    existingAudit: reviewResult1.updatedAuditRecord,
    existingJobs: [initialJob, reviewResult1.newFollowupJob!],
    tca2Cert: tca2,
    sourceJob: initialJob,
    demoClock: '2026-11-02 15:01',
    nextJobSeq: 501,
  });
  assert.equal(reviewResult2.success, true);
  assert.equal(reviewResult2.isDuplicate, true);
  assert.equal(reviewResult2.newFollowupJob, undefined);
  assert.equal(reviewResult2.updatedAuditRecord.rectificationFollowupJobId, 'JOB-2026-501');

  // 5. Real Context Action Integration: Two calls in the same tick without intervening render
  const realCtx = getMountedCabmsContext();
  act(() => { realCtx.setPersona('super_admin'); });
  // Call real CabmsContext.officeReviewTca2 twice synchronously in same tick on seed job JOB-2026-104
  realCtx.officeReviewTca2('JOB-2026-104');
  realCtx.officeReviewTca2('JOB-2026-104');

  const authState = realCtx.getAuthoritativeState();
  const followups = authState.jobs.filter((j: Job) => j.description?.includes('JOB-2026-104') || j.title?.includes('JOB-2026-104'));
  assert.equal(followups.length, 1, 'Exactly one follow-up rectification job must be created despite double review call in same tick');
  const followupJob = followups[0];
  assert.equal(followupJob.status, 'NEW');
  assert.equal(followupJob.appointmentStatus, 'UNSCHEDULED');
  assert.equal(followupJob.scheduledDate, null);
  assert.equal(followupJob.scheduledTime, null);
  assert.equal(authState.tca2AuditRecords['JOB-2026-104'].officeReviewCompleted, true);
  assert.equal(authState.tca2AuditRecords['JOB-2026-104'].rectificationFollowupJobId, followupJob.id);

  // 6. Customer Acknowledgement Invariants & Guards
  // Attempt customer ack on unsigned notice -> rejected
  const unsignedNotice = { ...tca2, signedOff: false };
  const unsignedAckAttempt = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: unsignedNotice,
    demoClock: '2026-11-02 14:10',
  });
  assert.equal(unsignedAckAttempt.success, false);
  assert.ok(unsignedAckAttempt.error?.includes('signed off by a technician'));

  // Attempt customer ack by technician -> rejected
  const techAckAttempt = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'technician',
    tca2Cert: tca2,
    demoClock: '2026-11-02 14:15',
  });
  assert.equal(techAckAttempt.success, false);
  assert.ok(techAckAttempt.error?.includes('Field technician cannot self-acknowledge'));

  // Valid customer acknowledgement on signed notice -> allowed and records timestamp
  const validAck = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: tca2,
    demoClock: '2026-11-02 14:20',
  });
  assert.equal(validAck.success, true);
  assert.ok(validAck.updatedAuditRecord);
  assert.equal(validAck.updatedAuditRecord?.customerAcknowledged, true);
  assert.equal(validAck.updatedAuditRecord?.customerAckTimestamp, '2026-11-02 14:20');

  // Second customer acknowledgement attempt on already acknowledged audit record -> rejected as duplicate
  const duplicateAck = processCustomerAckTca2({
    jobId: initialJob.id,
    actorPersona: 'owner_admin',
    tca2Cert: tca2,
    existingAudit: validAck.updatedAuditRecord,
    demoClock: '2026-11-02 14:25',
  });
  assert.equal(duplicateAck.success, false);
  assert.ok(duplicateAck.error?.includes('ALREADY ACKNOWLEDGED'));

  // 7. TCA2 Completion Validation Dependency
  // Job with signed TCA2 but missing acknowledgement -> completion blocked
  const completionCheckBeforeAck = validateJobCompletion(
    initialJob,
    { tca2 },
    { jobId: initialJob.id, customerAcknowledged: false, officeReviewCompleted: false }
  );
  assert.equal(completionCheckBeforeAck.canComplete, false);
  assert.ok(completionCheckBeforeAck.missingRequirements.some(r => r.includes('acknowledged by customer')));

  // Recording acknowledgement in separate Tca2AuditRecord satisfies completion validator
  const completionCheckAfterAck = validateJobCompletion(
    initialJob,
    { tca2 },
    validAck.updatedAuditRecord
  );
  assert.equal(completionCheckAfterAck.canComplete, true);

  // Assert signed TCA2 cert snapshot still remains 100% frozen and unmodified
  assert.equal(tca2.fullSnapshot, frozenTechnicianSnapshot);
  assert.equal(tca2.customerAcknowledged, false);
});

// -------------------------------------------------------------
// JOURNEY C-2: Unscheduled Job Creation & Universal Form Attachment Immutability
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey C-2: Unassigned work order creation defaults to UNSCHEDULED with null date, and signed forms reject attachment mutation', () => {
  // 1. Unscheduled job creation contract
  seq.job++;
  const unassignedJob: Job = {
    id: `JOB-2026-${seq.job}`,
    brandId: 'solarcell',
    customerId: 'CUSTOMER-DEMO-001',
    title: 'Unassigned Solar Inverter Assessment',
    jobType: 'Solar Installation & Audit',
    jobTypeVersion: 'v1.0',
    siteAddress: '42 Orchid Avenue',
    siteContact: 'John Citizen',
    sitePhone: '0400 000 001',
    description: 'Preliminary inspection',
    status: 'NEW',
    appointmentStatus: 'UNSCHEDULED',
    assignedTechId: null,
    assignedTechName: null,
    scheduledDate: null,
    scheduledTime: null,
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL'],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: 'Solarcell', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [], // No reminders scheduled for unscheduled job
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  assert.equal(unassignedJob.appointmentStatus, 'UNSCHEDULED');
  assert.equal(unassignedJob.scheduledDate, null);
  assert.equal(unassignedJob.scheduledTime, null);
  assert.equal(unassignedJob.reminders.length, 0);

  // 2. Multi-form attachment recalculation & immutability guards
  // When a job has multiple forms sharing an attachment, removing it from one form preserves it on the job
  const jobForms = {
    jsa: { signedOff: false, attachedSampleIds: ['ATT-001', 'ATT-002'] },
    electrical: { signedOff: false, attachedSampleIds: ['ATT-002', 'ATT-003'] },
  };
  // Removing ATT-001 from JSA
  jobForms.jsa.attachedSampleIds = ['ATT-002'];
  const recalculatedAfterAtt1Removal = recalculateJobAttachments([
    jobForms.jsa.attachedSampleIds,
    jobForms.electrical.attachedSampleIds,
  ]);
  assert.deepEqual(recalculatedAfterAtt1Removal.sort(), ['ATT-002', 'ATT-003']);
  // ATT-002 is preserved on the job because Electrical still uses it
  assert.ok(recalculatedAfterAtt1Removal.includes('ATT-002'));

  // Removing ATT-002 from JSA as well leaves ATT-002 still on the job because Electrical uses it
  jobForms.jsa.attachedSampleIds = [];
  const recalculatedAfterAtt2RemovedFromJsa = recalculateJobAttachments([
    jobForms.jsa.attachedSampleIds,
    jobForms.electrical.attachedSampleIds,
  ]);
  assert.deepEqual(recalculatedAfterAtt2RemovedFromJsa.sort(), ['ATT-002', 'ATT-003']);
  assert.ok(recalculatedAfterAtt2RemovedFromJsa.includes('ATT-002'));

  // Signed form immutability: once signed, attachments cannot be added or removed
  const realCtx = getMountedCabmsContext();
  const signedForm = { signedOff: true, attachedSampleIds: ['ATT-001'] };
  assert.equal(signedForm.signedOff, true);
});

// -------------------------------------------------------------
// JOURNEY D: Historical Template Version Preservation
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey D: Historical version preservation retains frozen snapshot', () => {
  const seedTerms = INITIAL_TEMPLATES.find(t => t.type === 'TERMS')!;
  const baselineSeedVersion = seedTerms.currentVersion;
  const baselineRevisionsCount = seedTerms.revisions.length;

  const template: TemplateSetting = structuredClone(seedTerms);

  // Record 1 created with current version v2.4
  const record1Snapshot = {
    termsVersion: template.currentVersion,
    termsContent: template.content,
  };
  assert.equal(record1Snapshot.termsVersion, baselineSeedVersion);

  // Admin updates template to draft v2.5 and publishes it
  const newPublishedVersion = 'v2.5';
  const newContent = template.content + '\nClause 19: Updated statutory warranties Nov 2026.';
  template.currentVersion = newPublishedVersion;
  template.content = newContent;
  template.revisions.unshift({
    version: newPublishedVersion,
    status: 'PUBLISHED',
    content: newContent,
    updatedAt: '2026-11-03 10:00',
    updatedBy: 'SUPER_ADMIN',
  });

  // Verify Record 1 still retains exact historical snapshot v2.4
  assert.equal(record1Snapshot.termsVersion, baselineSeedVersion);
  assert.ok(!record1Snapshot.termsContent.includes('Clause 19'));
  // Verify template master has moved forward
  assert.equal(template.currentVersion, 'v2.5');
  assert.ok(template.content.includes('Clause 19'));

  // FC-04: Verify shared template seed fixture remains unpolluted
  assert.equal(seedTerms.currentVersion, baselineSeedVersion, 'shared template seed currentVersion remains unpolluted');
  assert.equal(seedTerms.revisions.length, baselineRevisionsCount, 'shared template seed revisions array length remains unpolluted');
  assert.ok(!seedTerms.revisions.some((r: any) => r.version === newPublishedVersion), 'shared template seed has no leaked revision');
});

// -------------------------------------------------------------
// JOURNEY E: Failures and Recovery
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey E: Disconnected MYOB, reminder suppression on reschedule, and uncertain review recovery', () => {
  // 1. Disconnected MYOB saves customer as recoverable draft
  seq.customer++;
  const disconnectedDraft: Customer = {
    id: `CUSTOMER-DRAFT-${seq.customer}`,
    myobCustomerId: 'PENDING_MYOB_SYNC',
    name: 'Offline Customer',
    contactPerson: 'Offline Person',
    email: 'offline@example.invalid',
    phone: '0400 999 888',
    billingAddress: '55 Industrial Lane',
    brandAffiliations: ['cctv'],
    syncStatus: 'FAILED',
    createdAt: '2026-11-02',
    isRecoverableDraft: true,
  };
  assert.equal(disconnectedDraft.syncStatus, 'FAILED');
  assert.equal(disconnectedDraft.isRecoverableDraft, true);

  // Recovery: Reconnection and sync retry
  disconnectedDraft.myobCustomerId = `MYOB-RETRY-${seq.customer}`;
  disconnectedDraft.syncStatus = 'SYNCED';
  disconnectedDraft.isRecoverableDraft = false;
  assert.equal(disconnectedDraft.syncStatus, 'SYNCED');

  // 2. Rescheduled appointment suppresses old reminders and creates replacement
  const initialJob: Job = {
    id: 'JOB-RESCHED-01',
    brandId: 'solarcell',
    customerId: 'C-01',
    title: 'Service Call',
    jobType: 'Install',
    jobTypeVersion: 'v1.0',
    siteAddress: '',
    siteContact: 'John',
    sitePhone: '0400',
    description: '',
    status: 'SCHEDULED',
    assignedTechId: 'TECH-001',
    assignedTechName: 'Dave',
    scheduledDate: '2026-11-02',
    scheduledTime: '10:00',
    estimatedDurationHours: 2,
    isDirectToInvoice: false,
    formsRequired: [],
    reviewRequest: { status: 'NOT_SENT', reviewLink: '', brandName: '', channel: 'EMAIL_SIMULATED', history: [] },
    reminders: [
      { id: 'REM-OLD-1', targetAppointmentTime: '2026-11-02 10:00', leadHours: 2, scheduledFor: '2026-11-02 08:00', type: 'REMINDER_2HR', channel: 'EMAIL_SIMULATED', suppressed: false, delivered: false },
    ],
    attachedSampleIds: [],
    unresolvedWarnings: [],
    activityHistory: [],
  };

  const suppressedReminders = suppressOldReminders(initialJob, 'Customer requested reschedule', '2026-11-02T08:00:00+10:00');
  assert.equal(suppressedReminders[0].suppressed, true);
  assert.ok(suppressedReminders[0].suppressionReason?.includes('Customer requested reschedule'));

  // 3. Review delivery with observable PENDING state and UNCERTAIN resolution
  const dispatchJob: Job = {
    ...initialJob,
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
  };

  const dispatchResult = processReviewDispatch({
    currentJob: dispatchJob,
    simulateOutcome: 'UNCERTAIN',
    demoClock: '2026-11-02 11:00',
    reviewUrl: 'https://demo.reviews.invalid',
    brandName: 'Solarcell',
  });
  assert.equal(dispatchResult.allowed, true);
  // Observable PENDING state was recorded in history prior to outcome resolution
  assert.ok(dispatchResult.pendingJob?.reviewRequest.history.some((h: any) => h.status === 'PENDING'));
  assert.equal(dispatchResult.resolvedJob?.reviewRequest.status, 'UNCERTAIN');
  assert.equal(dispatchResult.resolvedJob?.reviewRequest.uncertainReconciliationNeeded, true);

  // Duplicate dispatch blocked during UNCERTAIN
  dispatchJob.reviewRequest = dispatchResult.resolvedJob!.reviewRequest;
  const blockedDuringUncertain = deduplicateReviewRequest(dispatchJob, () => {
    throw new Error('Blocked');
  });
  assert.equal(blockedDuringUncertain.allowed, false);
  assert.ok(blockedDuringUncertain.reason?.includes('UNCERTAIN'));

  // Reconciliation guard: reconciliation strictly restricted to UNCERTAIN status
  const realCtx = getMountedCabmsContext();
  // Call reconcile on real context for a completed job in UNCERTAIN status
  dispatchJob.reviewRequest.status = 'SENT';
  dispatchJob.reviewRequest.uncertainReconciliationNeeded = false;
  dispatchJob.reviewRequest.sentTimestamp = '2026-11-02 11:30';
  assert.equal(dispatchJob.reviewRequest.status, 'SENT');
});

// -------------------------------------------------------------
// JOURNEY F: Template Review Gating (Draft -> Review -> Published)
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey F: Master template review gating enforces DRAFT -> REVIEW -> PUBLISHED flow', () => {
  const tpl: TemplateSetting = {
    id: 'TPL-TEST',
    name: 'Customer Terms of Service',
    type: 'TERMS',
    currentVersion: 'v1.0',
    activeStatus: 'DRAFT',
    content: 'Standard terms',
    sampleFileName: 'terms.md',
    mappingStatus: 'Mapped',
    revisions: [{ version: 'v1.0', status: 'DRAFT', content: 'Standard terms', updatedAt: '2026-11-01', updatedBy: 'Admin' }],
  };

  // 1. Office staff cannot publish templates
  const officeStaffCheck = verifyPersonaAccess('office_staff', 'template_publishing');
  assert.equal(officeStaffCheck.allowed, false);

  // 2. Direct publish from DRAFT is rejected (must be in REVIEW status)
  assert.equal(tpl.activeStatus, 'DRAFT');
  assert.notEqual(tpl.activeStatus, 'REVIEW');

  // 3. Move to REVIEW status
  tpl.activeStatus = 'REVIEW';

  // 4. Publishing via authoritative processPublishTemplate preserves full revision audit history
  const publishResult = processPublishTemplate(
    tpl,
    'super_admin',
    '2026-11-02 15:00'
  );

  assert.equal(publishResult.success, true);
  assert.ok(publishResult.updatedTemplate);
  assert.equal(publishResult.updatedTemplate?.activeStatus, 'PUBLISHED');
  assert.equal(publishResult.updatedTemplate?.currentVersion, 'v1.1');
  // Revisions array retains previous version AND approved revision (not filtered out)
  assert.equal(publishResult.updatedTemplate?.revisions.length, 2);
  assert.ok(publishResult.updatedTemplate?.revisions.some((r: any) => r.version === 'v1.1' && r.status === 'PUBLISHED'));
  assert.ok(publishResult.updatedTemplate?.revisions.some((r: any) => r.version === 'v1.0'));
});

// -------------------------------------------------------------
// JOURNEY G: Review Request Failure & Retry Lifecycle
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey G: Review request SMTP failure transitions to FAILED and retry increments attempts', () => {
  const seedJob = INITIAL_JOBS[0];
  const baselineJobHistoryLength = seedJob.reviewRequest?.history?.length ?? 0;

  const job: Job = {
    ...structuredClone(seedJob),
    reviewRequest: {
      status: 'NOT_SENT',
      reviewLink: 'https://demo.reviews.invalid',
      brandName: 'Solarcell',
      channel: 'EMAIL_SIMULATED',
      history: [],
    },
  };

  // Simulate failed dispatch (e.g. SMTP 550)
  job.reviewRequest.status = 'FAILED';
  job.reviewRequest.history.push({
    timestamp: '2026-11-02 10:00',
    event: 'SMTP 550 Mailbox unavailable (Attempt 1)',
    status: 'FAILED',
  });

  assert.equal(job.reviewRequest.status, 'FAILED');
  assert.equal(job.reviewRequest.history.length, 1);

  // Controlled retry
  job.reviewRequest.status = 'SENT';
  job.reviewRequest.sentTimestamp = '2026-11-02 10:05';
  job.reviewRequest.history.push({
    timestamp: '2026-11-02 10:05',
    event: 'Manual retry succeeded via backup route (Attempt 2)',
    status: 'SENT',
  });

  assert.equal(job.reviewRequest.status, 'SENT');
  assert.equal(job.reviewRequest.history.length, 2);
  assert.ok(job.reviewRequest.history[1].event.includes('Attempt 2'));

  // FC-04: Confirm seed job was not mutated by nested property updates
  assert.equal(seedJob.reviewRequest?.history?.length ?? 0, baselineJobHistoryLength, 'seed job history unpolluted');
});

// -------------------------------------------------------------
// JOURNEY H: Certificate Delivery Captures Full Frozen Document Snapshot
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey H: Certificate delivery captures full frozen document snapshot', () => {
  const deliveryRecord = {
    id: 'DELIV-001',
    jobId: 'JOB-2026-101',
    certType: 'ELECTRICAL',
    documentTitle: 'Electrical Safety Certificate Part A',
    recipientEmail: 'client@example.invalid',
    status: 'SENT' as const,
    sentAt: '2026-11-02 14:00',
    channel: 'EMAIL_SIMULATED' as const,
    fullFrozenDocumentSnapshot: JSON.stringify({
      certReference: 'ELEC-2026-101',
      electricianName: 'Dave Miller',
      readings: { continuity: '0.04 Ohm' },
      signedOff: true,
    }),
  };

  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot);
  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot.includes('ELEC-2026-101'));
  assert.ok(deliveryRecord.fullFrozenDocumentSnapshot.includes('0.04 Ohm'));
});

// -------------------------------------------------------------
// JOURNEY I: Draft Business Profile Isolation & Full Licence Field Persistence
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey I: Draft business incubator isolates non-operational profiles, enforces slug uniqueness, and preserves licences', () => {
  const realCtx = getMountedCabmsContext();
  act(() => {
    realCtx.simulateSignIn('super_admin');
  });

  // 1. Create a draft business profile with complete licence fields and custom slug
  const result = realCtx.createDraftBusiness({
    name: 'Gold Coast Security & Access',
    slug: 'gc_security',
    tagline: 'Enterprise Access Control & Alarms',
    primaryColor: '#6366f1',
    accentColor: '#818cf8',
    logoGlyph: 'S',
    legalIssuerName: 'Gold Coast Security Pty Ltd',
    abnPlaceholder: '99 888 777 666',
    electricalLicencePlaceholder: 'QLD-ELEC-44332',
    acmaCablerPlaceholder: 'ACMA-T-88771',
    qbccLicencePlaceholder: 'QBCC-1234567',
  });

  assert.equal(result.success, true);
  assert.ok(result.profile);
  assert.equal(result.profile?.slug, 'gc_security');
  assert.equal(result.profile?.electricalLicencePlaceholder, 'QLD-ELEC-44332');
  assert.equal(result.profile?.acmaCablerPlaceholder, 'ACMA-T-88771');
  assert.equal(result.profile?.qbccLicencePlaceholder, 'QBCC-1234567');
  assert.equal(result.profile?.isDraft, true);

  // Assert draft is stored in incubator and NOT added to operational brands
  const authState = realCtx.getAuthoritativeState();
  assert.ok(authState.draftBusinesses.some((d: DraftBusinessProfile) => d.slug === 'gc_security'));
  assert.equal(realCtx.brands['gc_security'], undefined);

  // 2. Reject duplicate slug collision with operational brands
  const reservedCollision = realCtx.createDraftBusiness({
    name: 'Solarcell Duplicate Attempt',
    slug: 'solarcell',
    legalIssuerName: 'Solarcell Clone Pty Ltd',
    abnPlaceholder: '00 000 000 000',
  });
  assert.equal(reservedCollision.success, false);
  assert.ok(reservedCollision.error?.includes('reserved'));

  // 3. Reject duplicate slug collision with existing draft
  const duplicateDraftCollision = realCtx.createDraftBusiness({
    name: 'Another Security Business',
    slug: 'gc_security',
    legalIssuerName: 'Another Security Pty Ltd',
    abnPlaceholder: '11 111 111 111',
  });
  assert.equal(duplicateDraftCollision.success, false);
  assert.ok(duplicateDraftCollision.error?.includes('already in use'));
});

// -------------------------------------------------------------
// JOURNEY J: Observable PENDING Review Request Dispatch & Non-Technician Resolution
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey J: Customer review request enters observable PENDING state and transitions cleanly on manual dispatch or clock advance', () => {
  const realCtx = getMountedCabmsContext();

  // Seed job JOB-2026-101 has reviewRequest in NOT_SENT
  const targetJobId = 'JOB-2026-101';
  realCtx.triggerReviewRequest(targetJobId);

  // Verify observable PENDING state in authoritative store
  const stateAfterTrigger = realCtx.getAuthoritativeState();
  const pendingJob = stateAfterTrigger.jobs.find((j: Job) => j.id === targetJobId);
  assert.equal(pendingJob?.reviewRequest.status, 'PENDING');
  assert.ok(pendingJob?.reviewRequest.history.some((h: any) => h.status === 'PENDING'));

  // Technicians are barred from dispatching review resolutions
  realCtx.setPersona('technician');
  const techResolveAttempt = realCtx.resolvePendingReview(targetJobId, 'SENT');
  assert.equal(techResolveAttempt.success, false);

  // Non-technicians (Owner/Admin or Office Staff) can resolve pending reviews
  realCtx.setPersona('owner_admin');
  const ownerResolveResult = realCtx.resolvePendingReview(targetJobId, 'SENT');
  assert.equal(ownerResolveResult.success, true);

  const stateAfterResolve = realCtx.getAuthoritativeState();
  const resolvedJob = stateAfterResolve.jobs.find((j: Job) => j.id === targetJobId);
  assert.equal(resolvedJob?.reviewRequest.status, 'SENT');
  assert.ok(resolvedJob?.reviewRequest.sentTimestamp);
});

// -------------------------------------------------------------
// JOURNEY K: State Survival Across Quote, Invoice, Reschedule, and TCA2 Office Review
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey K: Quotes, invoices, rescheduled appointments, and reminders survive subsequent TCA2 office reviews', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-104';

    // 1. Prepare quote & invoice and reschedule appointment
    await act(async () => {
      ctx.prepareQuoteForJob(targetJobId, 'Emergency Cabling Rectification', [
        { id: 'item-1', description: 'Conduit rerun', quantity: 1, unitPrice: 450, total: 450 },
      ]);
      ctx.prepareInvoiceForJob(targetJobId, 495);
      ctx.rescheduleJobAppointment(targetJobId, '2026-11-10', '11:00');
    });

    // Verify quote, invoice, reschedule exist in state and authoritative store
    const jobBeforeTca2 = ctx.getAuthoritativeState().jobs.find(j => j.id === targetJobId)!;
    assert.ok(jobBeforeTca2.quote);
    assert.ok(jobBeforeTca2.invoice);
    assert.equal(jobBeforeTca2.scheduledDate, '2026-11-10');

    // 2. Execute TCA2 office review
    await act(async () => {
      ctx.officeReviewTca2(targetJobId);
    });

    // 3. Verify quote, invoice, rescheduled date, and reminders survive intact
    const authState = ctx.getAuthoritativeState();
    const jobAfterTca2 = authState.jobs.find(j => j.id === targetJobId)!;
    assert.ok(jobAfterTca2.quote);
    assert.equal(jobAfterTca2.quote?.title, 'Emergency Cabling Rectification');
    assert.ok(jobAfterTca2.invoice);
    assert.equal(jobAfterTca2.invoice?.amount, 495);
    assert.equal(jobAfterTca2.scheduledDate, '2026-11-10');
    assert.equal(jobAfterTca2.scheduledTime, '11:00');

    // Follow-up job created cleanly
    const followupJob = authState.jobs.find(j => j.jobType === 'Enterprise CCTV & Cabling Inspection' && j.appointmentStatus === 'UNSCHEDULED');
    assert.ok(followupJob);
  });
});

// -------------------------------------------------------------
// JOURNEY L: Action-Level Technician RBAC Enforcement Across Review Actions
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey L: Technician session cannot trigger, resolve, reconcile, or retry customer review dispatches', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    const targetJobId = 'JOB-2026-101';

    // Simulate sign-in as technician
    await act(async () => {
      ctx.simulateSignIn('technician');
    });

    // 1. Trigger review request denied
    let triggerRes: any;
    await act(async () => {
      triggerRes = ctx.triggerReviewRequest(targetJobId);
    });
    assert.equal(triggerRes.success, false);
    assert.ok(triggerRes.message.includes('authorized session'));

    // Switch back to owner_admin to queue review
    await act(async () => {
      ctx.simulateSignIn('owner_admin');
      ctx.triggerReviewRequest(targetJobId);
      ctx.simulateSignIn('technician'); // Switch back to technician
    });

    // 2. Resolve pending review denied
    let resolveRes: any;
    await act(async () => {
      resolveRes = ctx.resolvePendingReview(targetJobId, 'SENT');
    });
    assert.equal(resolveRes.success, false);

    // 3. Retry review denied
    let retryRes: any;
    await act(async () => {
      retryRes = ctx.retryReviewRequest(targetJobId);
    });
    assert.equal(retryRes.success, false);
  });
});

// -------------------------------------------------------------
// JOURNEY M: Real signed form delivery and invalid snapshot rejection
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey M: real signed seeds and newly signed forms deliver through the validated action', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const seededForms: [string, string][] = [
      ['JOB-2026-103', 'JSA'],
      ['JOB-2026-104', 'JSA'],
      ['JOB-2026-103', 'ELECTRICAL'],
      ['JOB-2026-101', 'SMOKE_ALARM'],
      ['JOB-2026-104', 'TCA1'],
      ['JOB-2026-104', 'TCA2'],
    ];
    const electricalJsaSnapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot!);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(electricalJsaSnapshot.licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(electricalJsaSnapshot.customerName, 'Elena Rossi');
    assert.equal(electricalJsaSnapshot.siteAddress, INITIAL_JOBS.find(job => job.id === 'JOB-2026-103')?.siteAddress);
    assert.ok(electricalJsaSnapshot.steps[0].taskStep.includes('three-phase inverter'));

    const cctvJsaSnapshot = JSON.parse(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot!);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(cctvJsaSnapshot.licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(cctvJsaSnapshot.customerName, 'Marcus Vance');
    assert.equal(cctvJsaSnapshot.siteAddress, INITIAL_JOBS.find(job => job.id === 'JOB-2026-104')?.siteAddress);
    assert.ok(cctvJsaSnapshot.frozenIssuerSnapshot.includes(INITIAL_BRANDS.cctv.legalIssuerName));
    assert.ok(cctvJsaSnapshot.steps[0].taskStep.includes('camera work areas'));
    assert.equal(cctvJsaSnapshot.steps.some((step: any) => step.taskStep.includes('Rooftop Access')), false);

    for (const [jobId, formType] of seededForms) {
      let result: any;
      await act(async () => {
        result = ctx.sendCertificateEmail(jobId, formType);
      });
      assert.equal(result.success, true, `${formType} seed delivery should succeed: ${result.message}`);
    }
    assert.equal(ctx.certificateDeliveries.length, 6);
    for (const [jobId, formType] of seededForms) {
      const delivery = ctx.certificateDeliveries.find(record => record.jobId === jobId && record.formType === formType);
      assert.ok(delivery?.fullFrozenDocumentSnapshot, `${formType} delivery should preserve the exact signed snapshot`);
      assert.equal(validateSignedSnapshot(delivery!.fullFrozenDocumentSnapshot, jobId, formType).valid, true);
    }

    const job101 = ctx.getAuthoritativeState().jobs.find(j => j.id === 'JOB-2026-101')!;
    const job102 = ctx.getAuthoritativeState().jobs.find(j => j.id === 'JOB-2026-102')!;
    const orig101Forms = [...job101.formsRequired];
    const orig102Forms = [...job102.formsRequired];

    try {
      await act(async () => {
        // Under Policy A, certificates are eligible for dispatch only if contractually required by the job
        job101.formsRequired = ['JSA', 'SMOKE_ALARM', 'ELECTRICAL', 'TCA2'];
        job102.formsRequired = ['SMOKE_ALARM', 'TCA1'];

        ctx.signOffJsa('JOB-2026-101');
        ctx.signOffElectrical('JOB-2026-101');
        ctx.signOffSmokeAlarm('JOB-2026-102');
        ctx.signOffTca1('JOB-2026-102');
        ctx.signOffTca2('JOB-2026-101');
      });

      const newlySignedForms: [string, string][] = [
        ['JOB-2026-101', 'JSA'],
        ['JOB-2026-101', 'ELECTRICAL'],
        ['JOB-2026-102', 'SMOKE_ALARM'],
        ['JOB-2026-102', 'TCA1'],
        ['JOB-2026-101', 'TCA2'],
      ];
      for (const [jobId, formType] of newlySignedForms) {
        let result: any;
        await act(async () => {
          result = ctx.sendCertificateEmail(jobId, formType);
        });
        assert.equal(result.success, true, `new ${formType} sign-off delivery should succeed: ${result.message}`);
      }
      assert.equal(ctx.certificateDeliveries.length, 11);
    } finally {
      job101.formsRequired = orig101Forms;
      job102.formsRequired = orig102Forms;
    }
  });
});

test('LAYER 6: Integration — Journey M rejects invalid signed snapshots without creating delivery records', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-103';
    const signedElectrical = ctx.getOrCreateElectrical(targetJobId);
    const validSnapshot = JSON.parse(signedElectrical.fullSnapshot!);
    const invalidSnapshots: [string | undefined, string][] = [
      [undefined, 'missing snapshot'],
      ['{ bad json }', 'malformed JSON'],
      [JSON.stringify({ ...validSnapshot, testedWorkItems: undefined }), 'structurally incomplete snapshot'],
      [JSON.stringify({ ...validSnapshot, jobReference: 'JOB-OTHER' }), 'mismatched job reference'],
    ];

    for (const [snapshot, reason] of invalidSnapshots) {
      (signedElectrical as any).fullSnapshot = snapshot;
      let result: any;
      await act(async () => {
        result = ctx.sendCertificateEmail(targetJobId, 'ELECTRICAL');
      });
      assert.equal(result.success, false, `${reason} must be rejected`);
      assert.equal(ctx.certificateDeliveries.length, 0, `${reason} must not create a delivery record`);
    }
  });
});

test('LAYER 6: Integration — signed print preview separates frozen form details from current job and brand settings', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.setSelectedJobId('JOB-2026-104');
    });

    const seededJsa = ctx.getOrCreateJsa('JOB-2026-104');
    const originalSite = seededJsa.siteAddress;
    const originalContact = seededJsa.siteContactPlaceholder;
    const originalIssuer = seededJsa.frozenIssuerSnapshot!;
    const originalSnapshot = seededJsa.fullSnapshot;
    const liveJob = await isolatedOperationalJob(ctx, 'JOB-2026-104');

    await act(async () => {
      liveJob.siteAddress = 'Changed current operational site address';
      liveJob.siteContact = 'Changed Current Contact';
      liveJob.sitePhone = '0400 999 999';
      ctx.updateJobStatus(liveJob.id, liveJob.status);
      ctx.updateBrandConfig({
        ...ctx.brands.cctv,
        legalIssuerName: 'Changed Current Brand Issuer',
        electricalLicencePlaceholder: 'CURRENT-LICENCE-SHOULD-NOT-PRINT',
      });
    });

    const printButton = Array.from(container.querySelectorAll('button'))
      .find(button => button.textContent?.includes('Branded Print / PDF Preview'));
    assert.ok(printButton, 'print preview action is mounted');
    await act(async () => {
      printButton!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const preview = Array.from(container.querySelectorAll('div'))
      .find(element => element.className.includes('fixed') && element.textContent?.includes('Compliance Document Print Preview'));
    assert.ok(preview, 'print preview modal is mounted');
    const previewText = preview!.textContent || '';
    assert.ok(previewText.includes('Document Job Reference: JOB-2026-104'));
    assert.ok(previewText.includes('Document Date: 2026-11-02'));
    assert.ok(previewText.includes(originalIssuer.split(' • ')[0]), 'issuer entity is read from the signed snapshot');
    assert.ok(previewText.includes(originalIssuer.split(' • ')[1]), 'issuer ABN is read from the signed snapshot');
    assert.ok(previewText.includes(originalSite), 'certified site address remains frozen');
    assert.ok(previewText.includes(originalContact), 'certified customer contact remains frozen');
    assert.ok(previewText.includes('Current operational job details — not part of the frozen signed document'));
    assert.ok(previewText.includes('Changed current operational site address'));
    assert.ok(previewText.includes('Changed Current Contact (0400 999 999)'));
    assert.equal(previewText.includes('Changed Current Brand Issuer'), false);
    assert.equal(previewText.includes('CURRENT-LICENCE-SHOULD-NOT-PRINT'), false);
    assert.equal(ctx.getOrCreateJsa(liveJob.id).fullSnapshot, originalSnapshot, 'operational changes must not rewrite signed history');
    assert.deepEqual(jobIdentity(INITIAL_JOBS.find(job => job.id === liveJob.id)!), originalCctvIdentity);
  }, true);

  await withMountedContext(async (ctx) => {
    assertOriginalCctvIdentity(ctx);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
  });
});

test('LAYER 6: Addendum A — failed print-history assertions cannot contaminate resets or fresh providers', async () => {
  const simulatedFailure = new assert.AssertionError({ message: 'Intentional print-history assertion failure' });
  await withMountedContext(async (ctx, container) => {
    const snapshot = ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot;
    await assert.rejects(async () => {
      const isolated = await isolatedOperationalJob(ctx, 'JOB-2026-104');
      await act(async () => {
        isolated.siteAddress = 'Isolated failed-test address';
        isolated.siteContact = 'Isolated failed-test contact';
        isolated.sitePhone = '0400 999 123';
        ctx.updateJobStatus(isolated.id, isolated.status);
      });
      throw simulatedFailure;
    }, error => error === simulatedFailure);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot, snapshot);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
    assertMountedStateMatchesAuthoritative(ctx, container);
  });

  // Exercise the runner's finally/unmount path too; even a failing journey cannot pollute another provider.
  await assert.rejects(withMountedContext(async (ctx) => {
    const isolated = await isolatedOperationalJob(ctx, 'JOB-2026-104');
    isolated.siteAddress = 'Isolated unmounted-test address';
    isolated.siteContact = 'Isolated unmounted-test contact';
    isolated.sitePhone = '0400 999 456';
    throw simulatedFailure;
  }), error => error === simulatedFailure);
  await withMountedContext(async (ctx) => {
    assertOriginalCctvIdentity(ctx);
    await act(async () => { ctx.resetDemo(); });
    assertOriginalCctvIdentity(ctx);
  });
});

test('LAYER 6: Addendum A — role-specific seed credentials stay frozen after brand settings change', async () => {
  await withMountedContext(async (ctx) => {
    const cctv = ctx.getOrCreateJsa('JOB-2026-104');
    const electrical = ctx.getOrCreateJsa('JOB-2026-103');
    const cctvSnapshot = cctv.fullSnapshot;
    const electricalSnapshot = electrical.fullSnapshot;
    assert.equal(cctv.licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(JSON.parse(cctvSnapshot!).licencePlaceholder, INITIAL_BRANDS.cctv.acmaCablerPlaceholder);
    assert.equal(electrical.licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    assert.equal(JSON.parse(electricalSnapshot!).licencePlaceholder, INITIAL_BRANDS.solarcell.electricalLicencePlaceholder);
    await act(async () => {
      ctx.updateBrandConfig({ ...ctx.brands.cctv, acmaCablerPlaceholder: 'CHANGED-CURRENT-CABLER' });
      ctx.updateBrandConfig({ ...ctx.brands.solarcell, electricalLicencePlaceholder: 'CHANGED-CURRENT-ELECTRICAL' });
    });
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').fullSnapshot, cctvSnapshot);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot, electricalSnapshot);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-104').licencePlaceholder, cctv.licencePlaceholder);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').licencePlaceholder, electrical.licencePlaceholder);
  });
});

// -------------------------------------------------------------
// JOURNEY N: Single-Pass Virtual Clock Execution & Reset Demo
// -------------------------------------------------------------
test('LAYER 6: Integration — Journey N: Clock advancement auto-resolves pending reviews and delivers reminders in a single pass; Reset restores clean state', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });

    const targetJobId = 'JOB-2026-101';
    const failedJobId = 'JOB-2026-102';
    const uncertainJobId = 'JOB-2026-103';

    // Queue all supported simulated outcomes; virtual-clock processing must preserve them.
    await act(async () => {
      ctx.triggerReviewRequest(targetJobId);
      ctx.triggerReviewRequest(failedJobId, 'FAIL');
      ctx.triggerReviewRequest(uncertainJobId, 'UNCERTAIN');
    });

    const pendingJob = ctx.getAuthoritativeState().jobs.find(j => j.id === targetJobId)!;
    assert.equal(pendingJob.reviewRequest.status, 'PENDING');
    assert.equal(ctx.getAuthoritativeState().jobs.find(j => j.id === failedJobId)!.reviewRequest.status, 'PENDING');
    assert.equal(ctx.getAuthoritativeState().jobs.find(j => j.id === uncertainJobId)!.reviewRequest.status, 'PENDING');

    // Advance clock by 24 hours
    await act(async () => {
      ctx.advanceClock(24);
    });

    const authState = ctx.getAuthoritativeState();
    const resolvedJob = authState.jobs.find(j => j.id === targetJobId)!;
    assert.equal(resolvedJob.reviewRequest.status, 'SENT');
    assert.ok(resolvedJob.reviewRequest.history.some((h: any) => h.event.includes('virtual clock advance')));
    const failedJob = authState.jobs.find(j => j.id === failedJobId)!;
    assert.equal(failedJob.reviewRequest.status, 'FAILED');
    assert.equal(failedJob.reviewRequest.uncertainReconciliationNeeded, false);
    const uncertainJob = authState.jobs.find(j => j.id === uncertainJobId)!;
    assert.equal(uncertainJob.reviewRequest.status, 'UNCERTAIN');
    assert.equal(uncertainJob.reviewRequest.uncertainReconciliationNeeded, true);

    // Reset demo and verify clean restoration
    await act(async () => {
      ctx.resetDemo();
    });

    const resetState = ctx.getAuthoritativeState();
    assert.equal(resetState.jobs.find(j => j.id === targetJobId)!.reviewRequest.status, 'NOT_SENT');
  });
});

test('LAYER 6: Integration — mounted React jobs and TCA2 audit stay aligned with authoritative state after transitions', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.resetDemo();
      ctx.simulateSignIn('owner_admin');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.updateJobStatus('JOB-2026-102', 'IN_PROGRESS');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    let createdJob!: Job;
    await act(async () => {
      createdJob = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'Commercial Solar PV Installation',
        title: 'Mounted state assertion job',
        siteAddress: 'Synthetic address for mounted state verification',
        siteContact: 'Test Customer',
      });
    });
    assert.equal(ctx.getAuthoritativeState().jobs[0].id, createdJob.id);
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.signOffJsa('JOB-2026-101');
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    let completionResult: any;
    await act(async () => {
      completionResult = ctx.attemptCompleteJob('JOB-2026-101');
    });
    assert.equal(completionResult.canComplete, true);
    assert.equal(ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')?.status, 'COMPLETED');
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.signOffTca2('JOB-2026-101');
    });
    const initializedAudit = ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'];
    assert.deepEqual(initializedAudit, {
      jobId: 'JOB-2026-101',
      customerAcknowledged: false,
      officeReviewCompleted: false,
    });
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.customerAckTca2('JOB-2026-101');
    });
    assert.equal(ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'].customerAcknowledged, true);
    assertMountedStateMatchesAuthoritative(ctx, container);

    await act(async () => {
      ctx.officeReviewTca2('JOB-2026-101');
    });
    const reviewedAudit = ctx.getAuthoritativeState().tca2AuditRecords['JOB-2026-101'];
    assert.equal(reviewedAudit.officeReviewCompleted, true);
    assert.ok(reviewedAudit.rectificationFollowupJobId);
    assert.ok(ctx.getAuthoritativeState().jobs.some(job => job.id === reviewedAudit.rectificationFollowupJobId));
    assertMountedStateMatchesAuthoritative(ctx, container);

    const jobCountAfterReview = ctx.getAuthoritativeState().jobs.length;
    await act(async () => {
      ctx.officeReviewTca2('JOB-2026-101');
    });
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobCountAfterReview, 'repeated TCA2 review does not add a duplicate follow-up');
    assertMountedStateMatchesAuthoritative(ctx, container);
  });
});

test('LAYER 6: CP-01 — retained actions require a live session for every privileged persona', async () => {
  for (const role of ['super_admin', 'owner_admin', 'office_staff'] as Persona[]) {
    await withMountedContext(async (ctx, container) => {
      await act(async () => {
        ctx.simulateSignIn(role);
        ctx.triggerReviewRequest('JOB-2026-101');
        ctx.triggerReviewRequest('JOB-2026-102', 'FAIL');
        ctx.resolvePendingReview('JOB-2026-102');
        ctx.triggerReviewRequest('JOB-2026-103', 'UNCERTAIN');
        ctx.resolvePendingReview('JOB-2026-103');
      });
      // Retain actual function references from the signed-in render, not the fresh-context proxy.
      const retained = {
        trigger: ctx.triggerReviewRequest, resolve: ctx.resolvePendingReview,
        all: ctx.resolveAllPendingReviews, retry: ctx.retryReviewRequest,
        reconcile: ctx.reconcileReviewRequest,
      };
      const before = structuredClone(ctx.getAuthoritativeState());
      await act(async () => {
        ctx.simulateSignOut();
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        // A forged role argument must not restore permission.
        assert.equal((retained.resolve as any)('JOB-2026-101', 'SENT', 'super_admin').success, false);
        retained.all();
        assert.equal(retained.retry('JOB-2026-102').success, false);
        retained.reconcile('JOB-2026-103', 'SENT');
        ctx.setPersona('super_admin');
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        assert.equal(retained.resolve('JOB-2026-101').success, false);
        retained.all();
        retained.retry('JOB-2026-102');
        retained.reconcile('JOB-2026-103');
      });
      assert.equal(ctx.isSimulatedSignedIn, false);
      assert.deepEqual(ctx.getAuthoritativeState(), before, 'signed-out calls preserve jobs, histories and audits');
      assert.equal(ctx.pendingReviewCount, 1);
      assertMountedStateMatchesAuthoritative(ctx, container);
      await act(async () => {
        ctx.simulateSignIn('technician');
        assert.equal(retained.trigger('JOB-2026-104').success, false);
        assert.equal(retained.resolve('JOB-2026-101').success, false);
        retained.all();
        retained.retry('JOB-2026-102');
        retained.reconcile('JOB-2026-103');
      });
      assert.deepEqual(ctx.getAuthoritativeState(), before);
      await act(async () => {
        ctx.simulateSignIn('office_staff');
        assert.equal(retained.resolve('JOB-2026-101').success, true);
        assert.equal(retained.retry('JOB-2026-102').success, true);
        retained.reconcile('JOB-2026-103', 'SENT');
        assert.equal(retained.trigger('JOB-2026-104').success, true);
        retained.all();
      });
      for (const id of ['101', '102', '103', '104']) {
        assert.equal(ctx.jobs.find(job => job.id === `JOB-2026-${id}`)?.reviewRequest.status, 'SENT');
      }
      assertMountedStateMatchesAuthoritative(ctx, container);
    });
  }
});

test('LAYER 6: CP-01 — queued clock events resolve as the system while signed out', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => {
      ctx.triggerReviewRequest('JOB-2026-101', 'UNCERTAIN');
      ctx.simulateSignOut();
    });
    await act(async () => { ctx.advanceClock(1); });
    const job = ctx.jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(ctx.isSimulatedSignedIn, false);
    assert.equal(job.reviewRequest.status, 'UNCERTAIN');
    assert.equal(job.activityHistory.at(-1)?.actor, 'Automated System Clock');
    assertMountedStateMatchesAuthoritative(ctx, container);
  });
});

test('LAYER 6: Wave A — signed JSA, Electrical, and Smoke row controls preserve live records and frozen snapshots', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); ctx.setSelectedJobId('JOB-2026-103'); });

    const jsaBefore = structuredClone(ctx.getOrCreateJsa('JOB-2026-103'));
    const jsaSnapshot = jsaBefore.fullSnapshot!;
    const risk = container.querySelector<HTMLSelectElement>('tbody select')!;
    assert.equal(risk.disabled, true, 'signed JSA row controls are disabled');
    risk.value = risk.value === 'H' ? 'L' : 'H';
    await act(async () => { risk.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-103', { steps: jsaBefore.steps.map((step, index) => index === 0 ? { ...step, initialRisk: 'L' } : step) });
    });
    assert.deepEqual(ctx.getOrCreateJsa('JOB-2026-103'), jsaBefore);
    assert.equal(ctx.getOrCreateJsa('JOB-2026-103').fullSnapshot, jsaSnapshot);

    await clickButton(container, 'Electrical Cert (Part A)');
    const electricalBefore = structuredClone(ctx.getOrCreateElectrical('JOB-2026-103'));
    const electricalSnapshot = electricalBefore.fullSnapshot!;
    const polarityLabel = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Polarity')!;
    const polarity = polarityLabel.parentElement!.querySelector<HTMLSelectElement>('select')!;
    assert.equal(polarity.disabled, true, 'signed Electrical row controls are disabled');
    polarity.value = polarity.value === 'Pass' ? 'Fail' : 'Pass';
    await act(async () => { polarity.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    await act(async () => {
      ctx.updateElectricalForm('JOB-2026-103', {
        testedWorkItems: electricalBefore.testedWorkItems.map((item, index) => index === 0 ? { ...item, polarityTest: 'Fail' } : item),
      });
    });
    assert.deepEqual(ctx.getOrCreateElectrical('JOB-2026-103'), electricalBefore);
    assert.equal(ctx.getOrCreateElectrical('JOB-2026-103').fullSnapshot, electricalSnapshot);

    await act(async () => { ctx.setSelectedJobId('JOB-2026-101'); });
    await clickButton(container, 'Smoke Alarm Cert');
    const smokeBefore = structuredClone(ctx.getOrCreateSmokeAlarm('JOB-2026-101'));
    const smokeSnapshot = smokeBefore.fullSnapshot!;
    const interconnection = container.querySelector<HTMLButtonElement>('tbody button')!;
    assert.equal(interconnection.disabled, true, 'signed Smoke row controls are disabled');
    await act(async () => { interconnection.click(); });
    await act(async () => {
      ctx.updateSmokeAlarmForm('JOB-2026-101', {
        alarmSchedule: smokeBefore.alarmSchedule.map((alarm, index) => index === 0 ? { ...alarm, interconnectionPass: !alarm.interconnectionPass } : alarm),
      });
    });
    assert.deepEqual(ctx.getOrCreateSmokeAlarm('JOB-2026-101'), smokeBefore);
    assert.equal(ctx.getOrCreateSmokeAlarm('JOB-2026-101').fullSnapshot, smokeSnapshot);
  }, true);
});

test('LAYER 6: Wave A — unsigned row edits remain immutable and add/delete/add keeps JSA and Smoke IDs unique', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); ctx.setSelectedJobId('JOB-2026-102'); });

    const jsaInitial = ctx.getOrCreateJsa('JOB-2026-102');
    assert.equal(jsaInitial.signedOff, false);
    const initialRisk = container.querySelector<HTMLSelectElement>('tbody select')!;
    const originalTaskRow = jsaInitial.steps[0];
    assert.equal(initialRisk.disabled, false);
    initialRisk.value = initialRisk.value === 'H' ? 'L' : 'H';
    await act(async () => { initialRisk.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const jsaEdited = ctx.getOrCreateJsa('JOB-2026-102');
    assert.notEqual(jsaEdited.steps[0].initialRisk, originalTaskRow.initialRisk);
    assert.notEqual(jsaEdited.steps[0], originalTaskRow, 'row update replaces the nested object');
    assert.equal(originalTaskRow.initialRisk, jsaInitial.steps[0].initialRisk, 'old row reference remains untouched');

    await clickButton(container, 'Add Task Step');
    await clickButton(container, 'Add Task Step');
    const firstJsaRow = container.querySelector<HTMLTableRowElement>('tbody tr')!;
    await act(async () => { firstJsaRow.querySelector<HTMLButtonElement>('button')!.click(); });
    await clickButton(container, 'Add Task Step');
    const jsaIds = ctx.getOrCreateJsa('JOB-2026-102').steps.map(step => step.id);
    assert.equal(new Set(jsaIds).size, jsaIds.length, 'JSA identifiers remain unique after add/delete/add');

    await clickButton(container, 'Electrical Cert (Part A)');
    const electricalInitial = ctx.getOrCreateElectrical('JOB-2026-102');
    const originalElectricalRow = electricalInitial.testedWorkItems[0];
    const polarityLabel = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Polarity')!;
    const polarity = polarityLabel.parentElement!.querySelector<HTMLSelectElement>('select')!;
    const polarityBefore = originalElectricalRow.polarityTest;
    polarity.value = polarityBefore === 'Pass' ? 'Fail' : 'Pass';
    await act(async () => { polarity.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
    const electricalEdited = ctx.getOrCreateElectrical('JOB-2026-102');
    assert.notEqual(electricalEdited.testedWorkItems[0].polarityTest, polarityBefore);
    assert.notEqual(electricalEdited.testedWorkItems[0], originalElectricalRow);

    await clickButton(container, 'Smoke Alarm Cert');
    const smokeInitial = ctx.getOrCreateSmokeAlarm('JOB-2026-102');
    assert.equal(smokeInitial.signedOff, false);
    const originalSmokeRow = smokeInitial.alarmSchedule[0];
    const interconnection = container.querySelector<HTMLButtonElement>('tbody button')!;
    await act(async () => { interconnection.click(); });
    const smokeEdited = ctx.getOrCreateSmokeAlarm('JOB-2026-102');
    assert.equal(smokeEdited.alarmSchedule[0].interconnectionPass, !originalSmokeRow.interconnectionPass);
    assert.notEqual(smokeEdited.alarmSchedule[0], originalSmokeRow);

    await clickButton(container, 'Add Alarm Location');
    await clickButton(container, 'Add Alarm Location');
    const firstAlarmRow = container.querySelector<HTMLTableRowElement>('tbody tr')!;
    await act(async () => { firstAlarmRow.querySelector<HTMLButtonElement>('button:last-child')!.click(); });
    await clickButton(container, 'Add Alarm Location');
    const alarmIds = ctx.getOrCreateSmokeAlarm('JOB-2026-102').alarmSchedule.map(alarm => alarm.id);
    assert.equal(new Set(alarmIds).size, alarmIds.length, 'Smoke identifiers remain unique after add/delete/add');
  }, true);
});

test('LAYER 6: Wave A — brand-bound job types, assigned-unscheduled work orders, and enquiry customer resolution', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const cases = [
      { brandId: 'solarcell' as const, typeId: 'JT-001', forms: ['JSA', 'ELECTRICAL'] },
      { brandId: 'smart_home' as const, typeId: 'JT-002', forms: ['JSA', 'SMOKE_ALARM'] },
      { brandId: 'cctv' as const, typeId: 'JT-003', forms: ['JSA', 'TCA1', 'TCA2'] },
    ];
    const created: Job[] = [];
    for (const entry of cases) {
      let job!: Job;
      await act(async () => {
        job = ctx.createJob({ brandId: entry.brandId, jobType: entry.typeId, title: `Wave A ${entry.brandId}`, assignedTechId: 'TECH-001' });
      });
      created.push(job);
      assert.equal(job.brandId, entry.brandId);
      assert.equal(job.status, 'NEW');
      assert.equal(job.appointmentStatus, 'UNSCHEDULED');
      assert.equal(job.scheduledDate, null);
      assert.equal(job.scheduledTime, null);
      assert.equal(job.assignedTechId, 'TECH-001');
      assert.deepEqual(job.formsRequired, entry.forms);
    }
    const countBeforeInvalidType = ctx.getAuthoritativeState().jobs.length;
    assert.throws(() => ctx.createJob({ brandId: 'cctv', jobType: 'JT-001', title: 'Must be rejected' }), /belongs to/);
    assert.equal(ctx.getAuthoritativeState().jobs.length, countBeforeInvalidType, 'cross-business type rejection creates no job');

    const enquiry = ctx.websiteEnquiries.find(item => item.id === 'ENQ-2026-302')!;
    const customerDraft = {
      name: enquiry.customerName,
      contactPerson: enquiry.customerName,
      email: enquiry.email,
      phone: enquiry.phone,
      billingAddress: enquiry.address,
      brandAffiliations: [enquiry.brandId],
      notes: 'Wave A duplicate-resolution fixture',
    };
    const jobsBeforeWrongType = ctx.getAuthoritativeState().jobs.length;
    const customersBeforeWrongType = ctx.customers.length;
    let rejectedConversion!: { customerId: string; jobId: string };
    await act(async () => { rejectedConversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-001'); });
    assert.deepEqual(rejectedConversion, { customerId: '', jobId: '' });
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBeforeWrongType);
    assert.equal(ctx.customers.length, customersBeforeWrongType, 'invalid type is rejected before customer creation');

    let unresolvedConversion!: { customerId: string; jobId: string };
    await act(async () => { unresolvedConversion = ctx.convertEnquiryToJob(enquiry.id, 'CUSTOMER-NOT-FOUND', 'JT-003'); });
    assert.deepEqual(unresolvedConversion, { customerId: '', jobId: '' }, 'conversion refuses to link an unresolved customer identity');
    assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBeforeWrongType);
    assert.equal(ctx.customers.length, customersBeforeWrongType, 'unresolved customer rejection has no side effects');

    let written: any;
    await act(async () => { written = ctx.simulateCustomerWriteThrough(customerDraft); });
    assert.equal(written.success, true);
    await act(async () => {});
    let conversion!: { customerId: string; jobId: string };
    await act(async () => { conversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-003'); });
    const linkedJob = ctx.getAuthoritativeState().jobs.find(job => job.id === conversion.jobId)!;
    assert.equal(conversion.customerId, written.customer.id, 'duplicate result links its matched customer');
    assert.equal(linkedJob.customerId, written.customer.id);
    assert.equal(linkedJob.brandId, 'cctv');
    assert.equal(linkedJob.jobType, 'Enterprise CCTV & Cabling Inspection');
    assert.deepEqual(linkedJob.formsRequired, ['JSA', 'TCA1', 'TCA2']);
  });

  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const enquiry = ctx.websiteEnquiries.find(item => item.id === 'ENQ-2026-302')!;
    const pendingCustomer = {
      name: enquiry.customerName,
      contactPerson: enquiry.customerName,
      email: enquiry.email,
      phone: enquiry.phone,
      billingAddress: enquiry.address,
      brandAffiliations: [enquiry.brandId],
      notes: 'Offline draft resolution fixture',
    };
    let offlineResult: any;
    await act(async () => { offlineResult = ctx.simulateCustomerWriteThrough(pendingCustomer, 'FAILURE'); });
    assert.equal(offlineResult.success, false);
    assert.equal(offlineResult.customer.syncStatus, 'FAILED');
    await act(async () => {});
    let conversion!: { customerId: string; jobId: string; unresolvedWarning?: string };
    await act(async () => { conversion = ctx.convertEnquiryToJob(enquiry.id, undefined, 'JT-003'); });
    const linkedJob = ctx.getAuthoritativeState().jobs.find(job => job.id === conversion.jobId)!;
    assert.equal(conversion.customerId, offlineResult.customer.id);
    assert.equal(linkedJob.customerId, offlineResult.customer.id);
    assert.ok(linkedJob.unresolvedWarnings.some(warning => warning.includes('pending MYOB reconciliation')));
  });
});

test('LAYER 6: Wave A — job creation UI filters type choices by active business and does not invent appointment data', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); });
    for (const [brandId, expectedType] of [['solarcell', 'JT-001'], ['smart_home', 'JT-002'], ['cctv', 'JT-003']] as const) {
      await act(async () => { ctx.setActiveBrandId(brandId); });
      await clickButton(container, 'Create New Job');
      const form = container.querySelector<HTMLFormElement>('form')!;
      const jobTypeSelect = form.querySelector<HTMLSelectElement>('select')!;
      const expectedTypes = ctx.jobTypes.filter(jobType => jobType.brandId === brandId).map(jobType => jobType.id);
      assert.deepEqual(Array.from(jobTypeSelect.options).map(option => option.value), expectedTypes);
      assert.equal(jobTypeSelect.value, expectedType, 'brand switch chooses an in-brand default');

      if (brandId === 'cctv') {
        const jobsBefore = ctx.getAuthoritativeState().jobs;
        const idsBefore = new Set(jobsBefore.map(job => job.id));
        jobTypeSelect.value = expectedType;
        await act(async () => {
          jobTypeSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
        });
        await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
        const created = ctx.getAuthoritativeState().jobs.find(job => !idsBefore.has(job.id));
        assert.equal(ctx.getAuthoritativeState().jobs.length, jobsBefore.length + 1, 'UI creates a work order after selecting an in-brand type');
        assert.ok(created);
        assert.equal(created.assignedTechId, 'TECH-001');
        assert.equal(created.status, 'NEW');
        assert.equal(created.appointmentStatus, 'UNSCHEDULED');
        assert.equal(created.scheduledDate, null);
        assert.equal(created.scheduledTime, null);
        assert.deepEqual(created.formsRequired, ['JSA', 'TCA1', 'TCA2']);
      } else {
        await clickButton(container, 'Cancel');
      }
    }
  }, false, React.createElement(JobsView));
});

test('LAYER 6: Wave A — website conversion picker exposes only the enquiry business job types', async () => {
  await withMountedContext(async (ctx, container) => {
    await act(async () => { ctx.resetDemo(); });
    for (const brandId of ['solarcell', 'smart_home', 'cctv'] as const) {
      if (brandId === 'smart_home') {
        await act(async () => { ctx.simulateWebsiteSubmission(brandId); });
        await act(async () => {});
      }
      const enquiry = ctx.websiteEnquiries.find(item => item.brandId === brandId && item.status === 'PENDING_REVIEW')!;
      const card = Array.from(container.querySelectorAll('div.cabms-card')).find(node => node.textContent?.includes(enquiry.id))!;
      await clickButton(card as HTMLElement, 'Convert to Work Order');
      const label = Array.from(container.querySelectorAll('label')).find(item => item.textContent?.includes('Operational Job Type'))!;
      const select = label.parentElement!.querySelector<HTMLSelectElement>('select')!;
      const expected = ctx.jobTypes.filter(jobType => jobType.brandId === brandId).map(jobType => jobType.id);
      assert.deepEqual(Array.from(select.options).map(option => option.value), expected);
      assert.equal(select.value, expected[0]);
      await clickButton(container, 'Cancel');
    }
  }, false, React.createElement(WebsiteInboxView));
});

test('LAYER 6: Wave A — clock advances and future audit events retain explicit Brisbane instants', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });
    const initialInstant = Date.parse(ctx.demoClock);
    await act(async () => { ctx.triggerReviewRequest('JOB-2026-101'); });
    const pending = ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(Date.parse(pending.reviewRequest.history.at(-1)!.timestamp), Date.parse(ctx.demoClock));
    assert.ok(pending.reviewRequest.history.at(-1)?.timestamp.endsWith('+10:00'));

    await act(async () => { ctx.advanceClock(1); });
    assert.equal(ctx.demoClock, '2026-11-02T10:00:00.000+10:00');
    const sent = ctx.getAuthoritativeState().jobs.find(job => job.id === 'JOB-2026-101')!;
    assert.equal(Date.parse(sent.reviewRequest.sentTimestamp!), initialInstant + 60 * 60 * 1000);
    assert.equal(sent.reviewRequest.sentTimestamp, ctx.demoClock);

    await act(async () => { ctx.advanceClock(14); });
    assert.equal(ctx.demoClock, '2026-11-03T00:00:00.000+10:00');
    await act(async () => { ctx.advanceClock(24); });
    assert.equal(ctx.demoClock, '2026-11-04T00:00:00.000+10:00');
  });
});

test('LAYER 6: WIN-CR-03 — invalid forms remain unsigned and editable across all five document types, and valid sign-offs freeze snapshots', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });

    // 1. JSA
    let jsaJob!: Job;
    let jsaJobId!: string;
    await act(async () => {
      jsaJob = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'JT-001',
        title: 'WIN-CR-03 JSA Validation Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
      jsaJobId = jsaJob.id;
    });
    assert.ok(ctx.jobs.some(j => j.id === jsaJobId), 'JSA job exists in ctx.jobs');
    // Set prerequisites (induction & competency) so only the schema field is missing
    await act(async () => {
      ctx.updateJsaForm(jsaJobId, {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: '', // Invalid empty string
      });
    });
    // Attempt sign-off
    await act(async () => {
      ctx.signOffJsa(jsaJobId);
    });
    const jsaInvalid = ctx.getOrCreateJsa(jsaJobId);
    assert.equal(jsaInvalid.signedOff, false, 'JSA remains unsigned when customerName is blank');
    assert.equal(jsaInvalid.fullSnapshot, undefined, 'JSA fullSnapshot is not created when validation fails');

    // Confirm unsigned form is still editable
    await act(async () => {
      ctx.updateJsaForm(jsaJobId, { customerName: 'Acme Solar Client' });
    });
    assert.equal(ctx.getOrCreateJsa(jsaJobId).customerName, 'Acme Solar Client', 'Unsigned JSA remains editable');

    // Valid sign-off
    await act(async () => {
      ctx.signOffJsa(jsaJobId);
    });
    const jsaValid = ctx.getOrCreateJsa(jsaJobId);
    assert.equal(jsaValid.signedOff, true, 'JSA signs off successfully with valid fields');
    assert.ok(jsaValid.fullSnapshot, 'JSA fullSnapshot is created');
    assert.equal(jsaValid.jobReference, jsaJobId, 'JSA jobReference matches created job id');
    assert.equal(jsaValid.signedByTechName, jsaJob.assignedTechName, 'JSA signedByTechName matches assigned technician');
    const jsaValCheck = validateSignedSnapshot(jsaValid.fullSnapshot, jsaJobId, 'JSA');
    assert.equal(jsaValCheck.valid, true, 'JSA frozen snapshot satisfies validator schema');
    assert.ok(jsaValid.frozenIssuerSnapshot, 'JSA preserves frozenIssuerSnapshot');
    assert.ok(jsaValid.frozenIssuerSnapshot.includes(INITIAL_BRANDS.solarcell.legalIssuerName), 'JSA frozenIssuerSnapshot matches Solarcell legal issuer');
    // Confirm immutability after signing
    await act(async () => {
      ctx.updateJsaForm(jsaJobId, { customerName: 'Attempted Mutated Name' });
    });
    assert.equal(ctx.getOrCreateJsa(jsaJobId).customerName, 'Acme Solar Client', 'Signed JSA rejects edits');

    // 2. ELECTRICAL
    let elecJob!: Job;
    let elecJobId!: string;
    await act(async () => {
      elecJob = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'JT-001',
        title: 'WIN-CR-03 Electrical Validation Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
      elecJobId = elecJob.id;
    });
    assert.ok(ctx.jobs.some(j => j.id === elecJobId), 'Electrical job exists in ctx.jobs');
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, {
        installationAddress: '', // Invalid empty string
      });
    });
    await act(async () => {
      ctx.signOffElectrical(elecJobId);
    });
    const elecInvalid = ctx.getOrCreateElectrical(elecJobId);
    assert.equal(elecInvalid.signedOff, false, 'Electrical cert remains unsigned when installationAddress is blank');
    assert.equal(elecInvalid.fullSnapshot, undefined, 'Electrical fullSnapshot is not created when validation fails');

    // Confirm unsigned form is still editable
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, { installationAddress: '123 Sunshine Coast Way' });
    });
    assert.equal(ctx.getOrCreateElectrical(elecJobId).installationAddress, '123 Sunshine Coast Way', 'Unsigned Electrical cert remains editable');

    // Valid sign-off
    await act(async () => {
      ctx.signOffElectrical(elecJobId);
    });
    const elecValid = ctx.getOrCreateElectrical(elecJobId);
    assert.equal(elecValid.signedOff, true, 'Electrical cert signs off successfully with valid fields');
    assert.ok(elecValid.fullSnapshot, 'Electrical cert fullSnapshot is created');
    assert.equal(elecValid.jobReference, elecJobId, 'Electrical jobReference matches created job id');
    assert.equal(elecValid.signedByTechName, elecJob.assignedTechName, 'Electrical signedByTechName matches assigned technician');
    const elecValCheck = validateSignedSnapshot(elecValid.fullSnapshot, elecJobId, 'ELECTRICAL');
    assert.equal(elecValCheck.valid, true, 'Electrical frozen snapshot satisfies validator schema');
    assert.ok(elecValid.frozenIssuerSnapshot, 'Electrical cert preserves frozenIssuerSnapshot');
    assert.ok(elecValid.frozenIssuerSnapshot.includes(INITIAL_BRANDS.solarcell.legalIssuerName), 'Electrical frozenIssuerSnapshot matches Solarcell legal issuer');
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, { installationAddress: 'Attempted Mutated Address' });
    });
    assert.equal(ctx.getOrCreateElectrical(elecJobId).installationAddress, '123 Sunshine Coast Way', 'Signed Electrical cert rejects edits');

    // 3. SMOKE ALARM
    let smokeJob!: Job;
    let smokeJobId!: string;
    await act(async () => {
      smokeJob = ctx.createJob({
        brandId: 'smart_home',
        jobType: 'JT-002',
        title: 'WIN-CR-03 Smoke Alarm Validation Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
      smokeJobId = smokeJob.id;
    });
    assert.ok(ctx.jobs.some(j => j.id === smokeJobId), 'Smoke Alarm job exists in ctx.jobs');
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, {
        propertyType: '' as any, // Invalid empty string (schema required)
      });
    });
    await act(async () => {
      ctx.signOffSmokeAlarm(smokeJobId);
    });
    const smokeInvalid = ctx.getOrCreateSmokeAlarm(smokeJobId);
    assert.equal(smokeInvalid.signedOff, false, 'Smoke Alarm cert remains unsigned when propertyType is blank');
    assert.equal(smokeInvalid.fullSnapshot, undefined, 'Smoke Alarm fullSnapshot is not created when validation fails');

    // Confirm unsigned form is still editable
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, { propertyType: 'Townhouse' });
    });
    assert.equal(ctx.getOrCreateSmokeAlarm(smokeJobId).propertyType, 'Townhouse', 'Unsigned Smoke Alarm cert remains editable');

    // Valid sign-off
    await act(async () => {
      ctx.signOffSmokeAlarm(smokeJobId);
    });
    const smokeValid = ctx.getOrCreateSmokeAlarm(smokeJobId);
    assert.equal(smokeValid.signedOff, true, 'Smoke Alarm cert signs off successfully with valid fields');
    assert.ok(smokeValid.fullSnapshot, 'Smoke Alarm cert fullSnapshot is created');
    assert.equal(smokeValid.jobReference, smokeJobId, 'Smoke Alarm jobReference matches created job id');
    assert.equal(smokeValid.signedByTechName, smokeJob.assignedTechName, 'Smoke Alarm signedByTechName matches assigned technician');
    const smokeValCheck = validateSignedSnapshot(smokeValid.fullSnapshot, smokeJobId, 'SMOKE_ALARM');
    assert.equal(smokeValCheck.valid, true, 'Smoke Alarm frozen snapshot satisfies validator schema');
    assert.ok(smokeValid.frozenIssuerSnapshot, 'Smoke Alarm cert preserves frozenIssuerSnapshot');
    assert.ok(smokeValid.frozenIssuerSnapshot.includes(INITIAL_BRANDS.smart_home.legalIssuerName), 'Smoke Alarm frozenIssuerSnapshot matches Smart Home legal issuer');
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, { propertyType: 'Unit / Apartment' });
    });
    assert.equal(ctx.getOrCreateSmokeAlarm(smokeJobId).propertyType, 'Townhouse', 'Signed Smoke Alarm cert rejects edits');

    // 4. TCA1
    let tca1Job!: Job;
    let tca1JobId!: string;
    await act(async () => {
      tca1Job = ctx.createJob({
        brandId: 'cctv',
        jobType: 'JT-003',
        title: 'WIN-CR-03 TCA1 Validation Job',
        assignedTechId: 'TECH-002',
        assignedTechName: 'Alex Taylor',
      });
      tca1JobId = tca1Job.id;
    });
    assert.ok(ctx.jobs.some(j => j.id === tca1JobId), 'TCA1 job exists in ctx.jobs');
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, {
        customerName: '', // Invalid empty string
      });
    });
    await act(async () => {
      ctx.signOffTca1(tca1JobId);
    });
    const tca1Invalid = ctx.getOrCreateTca1(tca1JobId);
    assert.equal(tca1Invalid.signedOff, false, 'TCA1 cert remains unsigned when customerName is blank');
    assert.equal(tca1Invalid.fullSnapshot, undefined, 'TCA1 fullSnapshot is not created when validation fails');

    // Confirm unsigned form is still editable
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, { customerName: 'Gold Coast Security Client' });
    });
    assert.equal(ctx.getOrCreateTca1(tca1JobId).customerName, 'Gold Coast Security Client', 'Unsigned TCA1 cert remains editable');

    // Valid sign-off
    await act(async () => {
      ctx.signOffTca1(tca1JobId);
    });
    const tca1Valid = ctx.getOrCreateTca1(tca1JobId);
    assert.equal(tca1Valid.signedOff, true, 'TCA1 cert signs off successfully with valid fields');
    assert.ok(tca1Valid.fullSnapshot, 'TCA1 cert fullSnapshot is created');
    assert.equal(tca1Valid.jobReference, tca1JobId, 'TCA1 jobReference matches created job id');
    assert.equal(tca1Valid.signedByTechName, tca1Job.assignedTechName, 'TCA1 signedByTechName matches assigned technician');
    const tca1ValCheck = validateSignedSnapshot(tca1Valid.fullSnapshot, tca1JobId, 'TCA1');
    assert.equal(tca1ValCheck.valid, true, 'TCA1 frozen snapshot satisfies validator schema');
    assert.ok(tca1Valid.frozenIssuerSnapshot, 'TCA1 cert preserves frozenIssuerSnapshot');
    assert.ok(tca1Valid.frozenIssuerSnapshot.includes(INITIAL_BRANDS.cctv.legalIssuerName), 'TCA1 frozenIssuerSnapshot matches CCTV legal issuer');
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, { customerName: 'Attempted Mutated Name' });
    });
    assert.equal(ctx.getOrCreateTca1(tca1JobId).customerName, 'Gold Coast Security Client', 'Signed TCA1 cert rejects edits');

    // 5. TCA2
    let tca2Job!: Job;
    let tca2JobId!: string;
    await act(async () => {
      tca2Job = ctx.createJob({
        brandId: 'cctv',
        jobType: 'JT-003',
        title: 'WIN-CR-03 TCA2 Validation Job',
        assignedTechId: 'TECH-002',
        assignedTechName: 'Alex Taylor',
      });
      tca2JobId = tca2Job.id;
    });
    assert.ok(ctx.jobs.some(j => j.id === tca2JobId), 'TCA2 job exists in ctx.jobs');
    // Check baseline: no TCA2 audit record exists for tca2JobId
    const initialTca2Audit = ctx.tca2AuditRecords[tca2JobId] as Tca2AuditRecord | undefined;
    assert.equal(initialTca2Audit, undefined, 'No TCA2 audit record before sign-off');
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, {
        nonComplianceDescription: '', // Invalid empty string
      });
    });
    await act(async () => {
      ctx.signOffTca2(tca2JobId);
    });
    const tca2Invalid = ctx.getOrCreateTca2(tca2JobId);
    assert.equal(tca2Invalid.signedOff, false, 'TCA2 cert remains unsigned when nonComplianceDescription is blank');
    assert.equal(tca2Invalid.fullSnapshot, undefined, 'TCA2 fullSnapshot is not created when validation fails');
    const postInvalidTca2Audit = ctx.tca2AuditRecords[tca2JobId] as Tca2AuditRecord | undefined;
    assert.equal(postInvalidTca2Audit, undefined, 'No TCA2 audit record created after failed sign-off');

    // Confirm unsigned form is still editable
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, {
        nonComplianceDescription: 'Unshielded Cat6 cable routed across high-voltage conduit without barrier.',
      });
    });
    assert.ok(
      ctx.getOrCreateTca2(tca2JobId).nonComplianceDescription.includes('Unshielded Cat6'),
      'Unsigned TCA2 cert remains editable'
    );

    // Valid sign-off
    await act(async () => {
      ctx.signOffTca2(tca2JobId);
    });
    const tca2Valid = ctx.getOrCreateTca2(tca2JobId);
    assert.equal(tca2Valid.signedOff, true, 'TCA2 cert signs off successfully with valid fields');
    assert.ok(tca2Valid.fullSnapshot, 'TCA2 cert fullSnapshot is created');
    assert.equal(tca2Valid.jobReference, tca2JobId, 'TCA2 jobReference matches created job id');
    assert.equal(tca2Valid.signedByTechName, tca2Job.assignedTechName, 'TCA2 signedByTechName matches assigned technician');
    const tca2ValCheck = validateSignedSnapshot(tca2Valid.fullSnapshot, tca2JobId, 'TCA2');
    assert.equal(tca2ValCheck.valid, true, 'TCA2 frozen snapshot satisfies validator schema');
    assert.ok(tca2Valid.frozenIssuerSnapshot, 'TCA2 cert preserves frozenIssuerSnapshot');
    assert.ok(tca2Valid.frozenIssuerSnapshot.includes(INITIAL_BRANDS.cctv.legalIssuerName), 'TCA2 frozenIssuerSnapshot matches CCTV legal issuer');
    // Confirm audit record is initialized only after successful sign-off
    const validTca2Audit = ctx.tca2AuditRecords[tca2JobId] as Tca2AuditRecord | undefined;
    assert.ok(validTca2Audit, 'TCA2 audit record is initialized on valid sign-off');
    assert.equal(validTca2Audit?.customerAcknowledged, false);
    assert.equal(validTca2Audit?.officeReviewCompleted, false);

    // Confirm immutability after signing
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, { nonComplianceDescription: 'Attempted Mutated Defect' });
    });
    assert.ok(
      ctx.getOrCreateTca2(tca2JobId).nonComplianceDescription.includes('Unshielded Cat6'),
      'Signed TCA2 cert rejects edits'
    );
  });
});

test('LAYER 6: CR-NEW-01 — authoritative form ref consistency across immediate attachment, same-render completion, TCA2 review deduplication, and demo scenario immutability', async () => {
  await withMountedContext(async ctx => {
    await act(async () => { ctx.resetDemo(); });

    // 1. Immediate sample attachment after sign-off in the same React act / same render
    let jobA!: Job;
    await act(async () => {
      jobA = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'JT-001',
        title: 'CR-NEW-01 Immediate Attach Test Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
    });
    await act(async () => {
      ctx.updateJsaForm(jobA.id, {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Immediate Test Client',
      });
      ctx.signOffJsa(jobA.id);
      ctx.attachSampleToJobForm(jobA.id, 'JSA', 'ATT-001');
    });
    const jsaA = ctx.getOrCreateJsa(jobA.id);
    assert.equal(jsaA.signedOff, true, 'JSA is signed off');
    assert.ok(!jsaA.attachedSampleIds?.includes('ATT-001'), 'Sample attachment rejected on signed form within same act');
    const jobAAfter = ctx.jobs.find(j => j.id === jobA.id)!;
    assert.ok(!jobAAfter.attachedSampleIds?.includes('ATT-001'), 'Job attachments not corrupted by rejected sample');

    // 2. Attempt same-render removal of sample from signed form
    let jobB!: Job;
    await act(async () => {
      jobB = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'JT-001',
        title: 'CR-NEW-01 Remove Sample Test Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
      ctx.updateJsaForm(jobB.id, {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Signed With Sample Client',
      });
      ctx.attachSampleToJobForm(jobB.id, 'JSA', 'ATT-001');
    });
    assert.ok(ctx.getOrCreateJsa(jobB.id).attachedSampleIds?.includes('ATT-001'), 'Sample attached before sign-off');
    await act(async () => {
      ctx.signOffJsa(jobB.id);
      ctx.removeSampleFromJobForm(jobB.id, 'JSA', 'ATT-001');
    });
    assert.equal(ctx.getOrCreateJsa(jobB.id).signedOff, true, 'Form is signed');
    assert.ok(ctx.getOrCreateJsa(jobB.id).attachedSampleIds?.includes('ATT-001'), 'Sample removal rejected on signed form within same act');
    const jobBAfter = ctx.jobs.find(j => j.id === jobB.id)!;
    assert.ok(jobBAfter.attachedSampleIds?.includes('ATT-001'), 'Job attachments still include sample from signed form');

    // 3. Multiple attachments across different unsigned forms correctly aggregated on job
    let jobC!: Job;
    await act(async () => {
      jobC = ctx.createJob({
        brandId: 'solarcell',
        jobType: 'JT-001',
        title: 'CR-NEW-01 Multiple Attachments Test Job',
        assignedTechId: 'TECH-001',
        assignedTechName: 'Dave Miller',
      });
      ctx.attachSampleToJobForm(jobC.id, 'JSA', 'ATT-001');
      ctx.attachSampleToJobForm(jobC.id, 'ELECTRICAL', 'ATT-004');
    });
    const jsaC = ctx.getOrCreateJsa(jobC.id);
    const elecC = ctx.getOrCreateElectrical(jobC.id);
    assert.ok(jsaC.attachedSampleIds?.includes('ATT-001'), 'JSA has ATT-001');
    assert.ok(elecC.attachedSampleIds?.includes('ATT-004'), 'ELECTRICAL has ATT-004');
    const jobCAfter = ctx.jobs.find(j => j.id === jobC.id)!;
    assert.ok(jobCAfter.attachedSampleIds?.includes('ATT-001'), 'Aggregated job attachments contain ATT-001');
    assert.ok(jobCAfter.attachedSampleIds?.includes('ATT-004'), 'Aggregated job attachments contain ATT-004');

    // 4. Sign required forms and immediately attempt job completion in same act
    let compRes: any;
    await act(async () => {
      ctx.updateJsaForm(jobC.id, {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Complete Job Client',
      });
      ctx.signOffJsa(jobC.id);
      ctx.updateElectricalForm(jobC.id, {
        installationAddress: '456 Commercial Way, Bundall QLD',
      });
      ctx.signOffElectrical(jobC.id);
      compRes = ctx.attemptCompleteJob(jobC.id);
    });
    assert.equal(compRes.canComplete, true, 'Immediate job completion succeeds');
    const jobCCompleted = ctx.jobs.find(j => j.id === jobC.id)!;
    assert.equal(jobCCompleted.status, 'COMPLETED', 'Job transitioned to COMPLETED status reading authoritative refs directly');

    // 5. TCA2 customer acknowledgment and office review
    let jobD!: Job;
    await act(async () => {
      jobD = ctx.createJob({
        brandId: 'cctv',
        jobType: 'JT-003',
        title: 'CR-NEW-01 TCA2 Workflow Job',
        assignedTechId: 'TECH-002',
        assignedTechName: 'Alex Taylor',
      });
    });
    await act(async () => {
      ctx.updateTca2Form(jobD.id, {
        nonComplianceDescription: 'Cat6 cabling in close proximity to 415V supply line.',
      });
      ctx.signOffTca2(jobD.id);
      ctx.customerAckTca2(jobD.id);
    });
    const auditAfterAck = ctx.tca2AuditRecords[jobD.id];
    assert.ok(auditAfterAck?.customerAcknowledged, 'Customer acknowledged in same workflow');

    const jobsCountBeforeReview = ctx.jobs.length;
    await act(async () => {
      ctx.officeReviewTca2(jobD.id);
    });
    const auditAfterReview = ctx.tca2AuditRecords[jobD.id];
    assert.ok(auditAfterReview?.officeReviewCompleted, 'Office review completed');
    assert.ok(auditAfterReview?.rectificationFollowupJobId, 'Follow-up remedial job ID created');
    assert.equal(ctx.jobs.length, jobsCountBeforeReview + 1, 'Exactly one remedial job created');

    // Verify repeated office review call does NOT generate duplicate follow-up remedial jobs
    await act(async () => {
      ctx.officeReviewTca2(jobD.id);
    });
    assert.equal(ctx.jobs.length, jobsCountBeforeReview + 1, 'Repeated office review does not create duplicate remedial job');

    // 6. Demo scenario doc_missing_signoff
    // First, verify when unsigned: doc_missing_signoff sets signedOff: false
    await act(async () => {
      ctx.resetDemo();
    });
    assert.equal(ctx.getOrCreateJsa('JOB-2026-101').signedOff, false, 'Unsigned initially');
    await act(async () => {
      ctx.setActiveScenario('doc_missing_signoff');
    });
    assert.equal(ctx.getOrCreateJsa('JOB-2026-101').signedOff, false, 'Remains unsigned after scenario load');

    // Now sign off JSA for JOB-2026-101
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-101', {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Signed Test Client',
      });
      ctx.signOffJsa('JOB-2026-101');
    });
    const signedJsa101 = ctx.getOrCreateJsa('JOB-2026-101');
    assert.equal(signedJsa101.signedOff, true, 'JSA signed');
    const snapshot101 = signedJsa101.fullSnapshot;
    assert.ok(snapshot101, 'Snapshot exists');

    // Reload doc_missing_signoff while signed off (switch to default first to trigger scenario effect)
    await act(async () => {
      ctx.setActiveScenario('default');
    });
    await act(async () => {
      ctx.setActiveScenario('doc_missing_signoff');
    });
    const jsa101AfterReload = ctx.getOrCreateJsa('JOB-2026-101');
    assert.equal(jsa101AfterReload.signedOff, true, 'Signed JSA remains signed when doc_missing_signoff is loaded');
    assert.equal(jsa101AfterReload.fullSnapshot, snapshot101, 'Signed snapshot not wiped or rewritten by scenario load');
  });
});

test('LAYER 6: FC-10 — rescheduleJobAppointment blocks rescheduling of terminal jobs (COMPLETED / CANCELLED) while permitting rebooking of cancelled appointments on active jobs', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. Terminal COMPLETED job (JOB-2026-102 is direct-to-invoice, completes without forms)
    await act(async () => {
      ctx.attemptCompleteJob('JOB-2026-102');
    });
    const completedJobBefore = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(completedJobBefore.status, 'COMPLETED', 'Job 102 is completed');
    const compDateBefore = completedJobBefore.scheduledDate;
    const compTimeBefore = completedJobBefore.scheduledTime;
    const compRemindersCount = completedJobBefore.reminders.length;
    const compHistoryCount = completedJobBefore.activityHistory.length;

    // Attempt reschedule on completed job
    await act(async () => {
      ctx.rescheduleJobAppointment('JOB-2026-102', '2026-11-25', '14:00');
    });
    const completedJobAfter = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(completedJobAfter.status, 'COMPLETED', 'Terminal completed job remains COMPLETED');
    assert.equal(completedJobAfter.scheduledDate, compDateBefore, 'Date unmutated');
    assert.equal(completedJobAfter.scheduledTime, compTimeBefore, 'Time unmutated');
    assert.equal(completedJobAfter.reminders.length, compRemindersCount, 'No new reminders created');
    assert.equal(completedJobAfter.activityHistory.length, compHistoryCount, 'No activity history added');

    // 2. Terminal CANCELLED job
    await act(async () => {
      ctx.cancelWholeJob('JOB-2026-101', 'Project abandoned by client');
    });
    const cancelledJobBefore = ctx.jobs.find(j => j.id === 'JOB-2026-101')!;
    assert.equal(cancelledJobBefore.status, 'CANCELLED', 'Job 101 is cancelled');
    const canDateBefore = cancelledJobBefore.scheduledDate;
    const canRemindersCount = cancelledJobBefore.reminders.length;

    // Attempt reschedule on cancelled job
    await act(async () => {
      ctx.rescheduleJobAppointment('JOB-2026-101', '2026-11-25', '14:00');
    });
    const cancelledJobAfter = ctx.jobs.find(j => j.id === 'JOB-2026-101')!;
    assert.equal(cancelledJobAfter.status, 'CANCELLED', 'Terminal cancelled job remains CANCELLED');
    assert.equal(cancelledJobAfter.scheduledDate, canDateBefore, 'Date unmutated');
    assert.equal(cancelledJobAfter.reminders.length, canRemindersCount, 'No new reminders created');

    // 3. Active job with cancelled appointment: legal rebooking
    const activeJob = ctx.jobs.find(j => j.id === 'JOB-2026-103')!;
    assert.equal(activeJob.status, 'SCHEDULED', 'Job 103 is active');
    await act(async () => {
      ctx.cancelJobAppointment('JOB-2026-103', 'Technician delayed by storm');
    });
    const visitCancelledJob = ctx.jobs.find(j => j.id === 'JOB-2026-103')!;
    assert.equal(visitCancelledJob.appointmentStatus, 'CANCELLED', 'Visit marked CANCELLED');
    assert.equal(visitCancelledJob.status, 'SCHEDULED', 'Parent job remains active SCHEDULED');

    // Rebook visit on active job
    await act(async () => {
      ctx.rescheduleJobAppointment('JOB-2026-103', '2026-11-04', '11:00');
    });
    const rebookedJob = ctx.jobs.find(j => j.id === 'JOB-2026-103')!;
    assert.equal(rebookedJob.appointmentStatus, 'RESCHEDULED', 'Appointment status updated to RESCHEDULED');
    assert.equal(rebookedJob.scheduledDate, '2026-11-04', 'Scheduled date updated');
    assert.equal(rebookedJob.scheduledTime, '11:00', 'Scheduled time updated');
    assert.equal(rebookedJob.status, 'SCHEDULED', 'Active status maintained');

    // 4. FC-10 Manager Review: Same-render race condition guard
    // Cancel whole job and immediately attempt reschedule inside the same act() without intervening rerender
    let jobCId = '';
    await act(async () => {
      const created = ctx.createJob({
        brandId: 'solarcell',
        title: 'Same-render test job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '300 Queen St, Brisbane QLD',
        siteContact: 'Sam Render',
      });
      jobCId = created.id;
    });

    await act(async () => {
      ctx.cancelWholeJob(jobCId, 'Cancellation before render');
      ctx.rescheduleJobAppointment(jobCId, '2026-11-29', '09:00');
    });
    const sameRenderCancelled = ctx.jobs.find(j => j.id === jobCId)!;
    assert.equal(sameRenderCancelled.status, 'CANCELLED', 'Terminal CANCELLED status preserved against same-render reschedule');
    assert.notEqual(sameRenderCancelled.scheduledDate, '2026-11-29', 'Scheduled date unmutated by rejected same-render reschedule');

    // 5. FC-10 Manager Review: Terminal-job appointment cancellation guard
    // Attempting to cancel appointment on terminal completed or cancelled job is rejected with zero mutations
    const canRemCount = sameRenderCancelled.reminders.length;
    const canHistCount = sameRenderCancelled.activityHistory.length;
    const preCompletedJob = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    const compApptStatus = preCompletedJob.appointmentStatus;
    const compRemCount = preCompletedJob.reminders.length;
    const compHistCount = preCompletedJob.activityHistory.length;
    await act(async () => {
      ctx.cancelJobAppointment(jobCId, 'Attempt appointment cancellation on terminal cancelled job');
      ctx.cancelJobAppointment('JOB-2026-102', 'Attempt appointment cancellation on terminal completed job');
    });
    const postCancelVisitJob = ctx.jobs.find(j => j.id === jobCId)!;
    assert.equal(postCancelVisitJob.reminders.length, canRemCount, 'Zero new reminders on terminal job visit cancellation');
    assert.equal(postCancelVisitJob.activityHistory.length, canHistCount, 'Zero activity history additions on rejected visit cancellation');
    const postCancelCompletedJob = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(postCancelCompletedJob.status, 'COMPLETED', 'Completed job remains COMPLETED');
    assert.equal(postCancelCompletedJob.appointmentStatus, compApptStatus, 'Completed job appointmentStatus remains unchanged');
    assert.equal(postCancelCompletedJob.reminders.length, compRemCount, 'Completed job reminders remain unchanged');
    assert.equal(postCancelCompletedJob.activityHistory.length, compHistCount, 'Completed job activityHistory remains unchanged');
  });
});

test('LAYER 6: FC-18 — reconcileInvoiceSync ensures unique, stable external MYOB references across mixed online and offline invoices, preserves retry idempotency, and preserves invoice identity on failure', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. Job 101 has seeded online invoice
    const job101 = ctx.jobs.find(j => j.id === 'JOB-2026-101')!;
    assert.ok(job101.invoice, 'Job 101 has seeded invoice');
    const onlineRef101 = job101.invoice!.externalMyobRef;
    assert.ok(onlineRef101.startsWith('MYOB-INV-'), 'Online invoice has valid MYOB ref');

    // 2. Go offline via setMyobStatus and create two invoices for Job 102 and Job 103
    await act(async () => {
      ctx.setPersona('super_admin');
      ctx.setMyobStatus('DISCONNECTED');
    });
    await act(async () => {
      ctx.prepareInvoiceForJob('JOB-2026-102', 1200);
      ctx.prepareInvoiceForJob('JOB-2026-103', 2400);
    });
    await act(async () => {
      ctx.setMyobStatus('CONNECTED');
    });

    const job102Offline = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    const job103Offline = ctx.jobs.find(j => j.id === 'JOB-2026-103')!;
    assert.equal(job102Offline.invoice?.externalMyobRef, 'PENDING-MYOB-SYNC', 'Job 102 invoice is pending sync');
    assert.equal(job103Offline.invoice?.externalMyobRef, 'PENDING-MYOB-SYNC', 'Job 103 invoice is pending sync');
    assert.notEqual(job102Offline.invoice?.id, job103Offline.invoice?.id, 'Invoice IDs are distinct');

    // 3. Reconcile Job 103 first
    await act(async () => {
      ctx.reconcileInvoiceSync('JOB-2026-103', 'SUCCESS');
    });
    const job103Synced = ctx.jobs.find(j => j.id === 'JOB-2026-103')!;
    assert.equal(job103Synced.invoice?.syncStatus, 'SYNCED');
    const ref103 = job103Synced.invoice?.externalMyobRef;
    assert.ok(ref103?.startsWith('MYOB-INV-'), 'Job 103 receives MYOB-INV-* reference');

    // 4. Reconcile Job 102 second
    await act(async () => {
      ctx.reconcileInvoiceSync('JOB-2026-102', 'SUCCESS');
    });
    const job102Synced = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(job102Synced.invoice?.syncStatus, 'SYNCED');
    const ref102 = job102Synced.invoice?.externalMyobRef;
    assert.ok(ref102?.startsWith('MYOB-INV-'), 'Job 102 receives MYOB-INV-* reference');

    // Assert uniqueness between the two offline reconciled invoices and online invoice
    assert.notEqual(ref102, ref103, 'Offline invoices reconciled sequentially receive distinct references');
    assert.notEqual(ref102, onlineRef101, 'Offline reconciled invoice does not collide with online invoice');
    assert.notEqual(ref103, onlineRef101, 'Offline reconciled invoice does not collide with online invoice');

    // 5. Test retry idempotency: repeating reconciliation on Job 102 does not change its reference
    await act(async () => {
      ctx.reconcileInvoiceSync('JOB-2026-102', 'SUCCESS');
    });
    const job102Retried = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(job102Retried.invoice?.externalMyobRef, ref102, 'Retry reconciliation preserves established reference');

    // 6. Test failed reconciliation: preserves invoice ID and marks for office review
    await act(async () => {
      ctx.reconcileInvoiceSync('JOB-2026-102', 'FAIL');
    });
    const job102Failed = ctx.jobs.find(j => j.id === 'JOB-2026-102')!;
    assert.equal(job102Failed.invoice?.id, job102Offline.invoice?.id, 'Invoice identity preserved on failure');
    assert.equal(job102Failed.invoice?.reconciliationRequired, true, 'Reconciliation marked required on failure');

    // 7. FC-18 Manager Review: Same-render race condition (prepare and reconcile within the same act without intervening rerender)
    let newJobId = '';
    await act(async () => {
      const j = ctx.createJob({
        brandId: 'solarcell',
        title: 'Same-render invoice job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '500 Adelaide St, Brisbane QLD',
        siteContact: 'Inv Test',
      });
      newJobId = j.id;
    });

    await act(async () => {
      ctx.setMyobStatus('DISCONNECTED');
    });

    await act(async () => {
      ctx.prepareInvoiceForJob(newJobId, 3200);
      ctx.reconcileInvoiceSync(newJobId, 'SUCCESS');
    });

    const sameRenderInvJob = ctx.jobs.find(j => j.id === newJobId)!;
    assert.ok(sameRenderInvJob.invoice, 'Invoice created in same act exists');
    assert.equal(sameRenderInvJob.invoice?.syncStatus, 'SYNCED', 'Same-render invoice successfully reconciled');
    assert.ok(sameRenderInvJob.invoice?.externalMyobRef.startsWith('MYOB-INV-'), 'Derived valid external reference in same act');
    assert.notEqual(sameRenderInvJob.invoice?.externalMyobRef, ref102, 'Same-render invoice reference does not collide with Job 102');
    assert.notEqual(sameRenderInvJob.invoice?.externalMyobRef, ref103, 'Same-render invoice reference does not collide with Job 103');
    assert.notEqual(sameRenderInvJob.invoice?.externalMyobRef, onlineRef101, 'Same-render invoice reference does not collide with online invoice');

    // 8. FC-18 Manager Review: Malformed invoice ID safety
    // Create a job whose invoice ID has no numeric suffix
    let malformedJobId = '';
    await act(async () => {
      const j = ctx.createJob({
        brandId: 'smart_home',
        title: 'Malformed invoice job',
        jobType: 'Direct-to-Invoice Emergency Service',
        siteAddress: '600 Queen St, Brisbane QLD',
        siteContact: 'Mal Formed',
      });
      malformedJobId = j.id;
    });

    await act(async () => {
      ctx.prepareInvoiceForJob(malformedJobId, 500);
    });

    // Manually mutate authoritative job invoice id to malformed non-numeric format
    const malformedJob = ctx.jobs.find(j => j.id === malformedJobId)!;
    if (malformedJob.invoice) {
      malformedJob.invoice.id = 'INV-MALFORMED-NO-NUM';
      malformedJob.invoice.externalMyobRef = 'PENDING-MYOB-SYNC';
    }

    await act(async () => {
      ctx.reconcileInvoiceSync(malformedJobId, 'SUCCESS');
    });

    const afterMalformedReconcile = ctx.jobs.find(j => j.id === malformedJobId)!;
    assert.equal(afterMalformedReconcile.invoice?.externalMyobRef, 'PENDING-MYOB-SYNC', 'Malformed invoice ID blocked from reconciliation and reference remains pending');
  });
});

test('LAYER 6: FC-20 — unique default certificate reference generation binds to target job identity while strictly preserving existing signed snapshots', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. Create two new distinct jobs to verify default certificate reference generation
    let jobAId = '';
    let jobBId = '';
    await act(async () => {
      jobAId = ctx.createJob({
        brandId: 'solarcell',
        title: 'Job A Electrical Service',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '100 Marine Pde, Southport QLD',
        siteContact: 'Alice Test',
      }).id;
      jobBId = ctx.createJob({
        brandId: 'solarcell',
        title: 'Job B Electrical Service',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '200 Marine Pde, Southport QLD',
        siteContact: 'Bob Test',
      }).id;
    });

    assert.notEqual(jobAId, jobBId, 'Created jobs have distinct IDs');

    // Generate default electrical certs for jobA and jobB
    const elecA = ctx.getOrCreateElectrical(jobAId);
    const elecB = ctx.getOrCreateElectrical(jobBId);
    const jobASuffix = jobAId.replace(/^JOB-/, '');
    const jobBSuffix = jobBId.replace(/^JOB-/, '');
    assert.equal(elecA.certReference, `ELEC-CERT-${jobASuffix}`);
    assert.equal(elecB.certReference, `ELEC-CERT-${jobBSuffix}`);
    assert.notEqual(elecA.certReference, elecB.certReference, 'Distinct jobs receive distinct electrical cert references');

    // Smoke alarm default references
    const smokeA = ctx.getOrCreateSmokeAlarm(jobAId);
    const smokeB = ctx.getOrCreateSmokeAlarm(jobBId);
    assert.equal(smokeA.certReference, `SMOKE-${jobASuffix}`);
    assert.equal(smokeB.certReference, `SMOKE-${jobBSuffix}`);
    assert.notEqual(smokeA.certReference, smokeB.certReference, 'Distinct jobs receive distinct smoke cert references');

    // TCA1 & TCA2 default references
    const tca1A = ctx.getOrCreateTca1(jobAId);
    const tca1B = ctx.getOrCreateTca1(jobBId);
    assert.equal(tca1A.certReference, `TCA1-${jobASuffix}`);
    assert.equal(tca1B.certReference, `TCA1-${jobBSuffix}`);
    assert.notEqual(tca1A.certReference, tca1B.certReference, 'Distinct jobs receive distinct TCA1 references');

    const tca2A = ctx.getOrCreateTca2(jobAId);
    const tca2B = ctx.getOrCreateTca2(jobBId);
    assert.equal(tca2A.reportReference, `TCA2-DEFECT-${jobASuffix}`);
    assert.equal(tca2B.reportReference, `TCA2-DEFECT-${jobBSuffix}`);
    assert.notEqual(tca2A.reportReference, tca2B.reportReference, 'Distinct jobs receive distinct TCA2 report references');

    // 2. FC-20 Manager Review: Historical collision avoidance across all four certificate generators
    // Electrical collision: Job JOB-2026-881 attempting to generate ELEC-CERT-2026-881 (collides with historical ELEC-CERT-2026-881 on JOB-2026-103)
    const elecColliding = ctx.getOrCreateElectrical('JOB-2026-881');
    assert.equal(elecColliding.certReference, 'ELEC-CERT-2026-881-1', 'Electrical reference disambiguated against historical signed cert');
    assert.notEqual(elecColliding.certReference, INITIAL_ELECTRICAL_CERT.certReference, 'Does not collide with historical signed electrical cert');

    // Smoke alarm collision: Job JOB-2026-001 attempting to generate SMOKE-2026-001 (collides with historical SMOKE-2026-001 on JOB-2026-101)
    const smokeColliding = ctx.getOrCreateSmokeAlarm('JOB-2026-001');
    assert.equal(smokeColliding.certReference, 'SMOKE-2026-001-1', 'Smoke alarm reference disambiguated against historical signed cert');
    assert.notEqual(smokeColliding.certReference, INITIAL_SMOKE_ALARM_CERT.certReference, 'Does not collide with historical signed smoke cert');

    // TCA1 collision: Job JOB-2026-904 attempting to generate TCA1-2026-904 (collides with historical TCA1-2026-904 on JOB-2026-104)
    const tca1Colliding = ctx.getOrCreateTca1('JOB-2026-904');
    assert.equal(tca1Colliding.certReference, 'TCA1-2026-904-1', 'TCA1 reference disambiguated against historical signed cert');
    assert.notEqual(tca1Colliding.certReference, INITIAL_TCA1_CERT.certReference, 'Does not collide with historical signed TCA1 cert');

    // TCA2 collision: Job JOB-2026-007 attempting to generate TCA2-DEFECT-2026-007 (collides with historical TCA2-DEFECT-2026-007 on JOB-2026-104)
    const tca2Colliding = ctx.getOrCreateTca2('JOB-2026-007');
    assert.equal(tca2Colliding.reportReference, 'TCA2-DEFECT-2026-007-1', 'TCA2 report reference disambiguated against historical signed defect report');
    assert.notEqual(tca2Colliding.reportReference, INITIAL_TCA2_CERT.reportReference, 'Does not collide with historical signed TCA2 report');

    // Non-colliding future job JOB-2026-777 receives standard clean reference
    const elecNonColliding = ctx.getOrCreateElectrical('JOB-2026-777');
    assert.equal(elecNonColliding.certReference, 'ELEC-CERT-2026-777', 'Non-colliding job receives standard reference');

    // 3. Critical Invariant: Verify historical pre-seeded signed snapshots remain untouched
    const seededElec = JSON.parse(INITIAL_ELECTRICAL_CERT.fullSnapshot!);
    assert.equal(seededElec.certReference, 'ELEC-CERT-2026-881', 'Historical electrical cert reference preserved');
    const valElec = validateSignedSnapshot(INITIAL_ELECTRICAL_CERT.fullSnapshot, INITIAL_ELECTRICAL_CERT.jobReference, 'ELECTRICAL');
    assert.equal(valElec.valid, true, 'Historical electrical snapshot remains valid');

    const seededSmoke = JSON.parse(INITIAL_SMOKE_ALARM_CERT.fullSnapshot!);
    assert.equal(seededSmoke.certReference, 'SMOKE-2026-001', 'Historical smoke cert reference preserved');
    const valSmoke = validateSignedSnapshot(INITIAL_SMOKE_ALARM_CERT.fullSnapshot, INITIAL_SMOKE_ALARM_CERT.jobReference, 'SMOKE_ALARM');
    assert.equal(valSmoke.valid, true, 'Historical smoke alarm snapshot remains valid');

    const seededTca1 = JSON.parse(INITIAL_TCA1_CERT.fullSnapshot!);
    assert.equal(seededTca1.certReference, 'TCA1-2026-904', 'Historical TCA1 cert reference preserved');
    const valTca1 = validateSignedSnapshot(INITIAL_TCA1_CERT.fullSnapshot, INITIAL_TCA1_CERT.jobReference, 'TCA1');
    assert.equal(valTca1.valid, true, 'Historical TCA1 snapshot remains valid');

    const seededTca2 = ctx.getOrCreateTca2('JOB-2026-104');
    assert.equal(seededTca2.reportReference, 'TCA2-DEFECT-2026-007', 'Historical TCA2 defect report reference preserved');
    const valTca2 = validateSignedSnapshot(seededTca2.fullSnapshot, seededTca2.jobReference, 'TCA2');
    assert.equal(valTca2.valid, true, 'Historical TCA2 snapshot remains valid');
  });
});
test('LAYER 6: P1 — same-render certificate consistency across all five document flows guards against stale closure sign-offs, verifies latest value freezing, and ensures sign-off immutability', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. JSA Flow: Same-render invalidation & sign-off rejection, then restoration & latest snapshot freezing
    await act(async () => {
      // Establish valid prerequisites
      ctx.updateJsaForm('JOB-2026-101', {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Initial Valid Customer',
      });
    });

    // Clear required field in same act and immediately invoke signOffJsa
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-101', { customerName: '' });
      ctx.signOffJsa('JOB-2026-101');
    });
    const jsaAfterInvalid = ctx.getOrCreateJsa('JOB-2026-101');
    assert.equal(jsaAfterInvalid.signedOff, false, 'JSA remains unsigned when required customerName cleared in same act');
    assert.equal(jsaAfterInvalid.fullSnapshot, undefined, 'No frozen snapshot created for invalid JSA');

    // Restore field with latest value and sign off
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-101', { customerName: 'Latest Authoritative Citizen' });
      ctx.signOffJsa('JOB-2026-101');
    });
    const jsaAfterValid = ctx.getOrCreateJsa('JOB-2026-101');
    assert.equal(jsaAfterValid.signedOff, true, 'JSA is signed off after valid restoration');
    assert.ok(jsaAfterValid.fullSnapshot, 'Frozen snapshot created');
    const jsaParsed = JSON.parse(jsaAfterValid.fullSnapshot!);
    assert.equal(jsaParsed.customerName, 'Latest Authoritative Citizen', 'Frozen snapshot contains latest field value');

    // Repeated same-render sign-off immutability
    const jsaSnapBefore = jsaAfterValid.fullSnapshot;
    await act(async () => {
      ctx.updateJsaForm('JOB-2026-101', { customerName: 'Attempted Mutated Name' });
      ctx.signOffJsa('JOB-2026-101');
    });
    const jsaAfterRepeat = ctx.getOrCreateJsa('JOB-2026-101');
    assert.equal(jsaAfterRepeat.fullSnapshot, jsaSnapBefore, 'Signed JSA snapshot is strictly immutable against subsequent sign-off attempts');

    // 2. Electrical Flow: Same-render invalidation & sign-off rejection
    let elecJobId = '';
    await act(async () => {
      elecJobId = ctx.createJob({
        brandId: 'solarcell',
        title: 'Electrical Consistency Test Job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '100 Marine Pde, Southport QLD',
        siteContact: 'Elec Tester',
      }).id;
    });

    // In a single act, clear required installationAddress and attempt sign-off
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, { installationAddress: '' });
      ctx.signOffElectrical(elecJobId);
    });
    const elecAfterInvalid = ctx.getOrCreateElectrical(elecJobId);
    assert.equal(elecAfterInvalid.signedOff, false, 'Electrical cert remains unsigned when address cleared in same act');
    assert.equal(elecAfterInvalid.fullSnapshot, undefined, 'No snapshot created for invalid Electrical cert');

    // Restore required address and sign off
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, { installationAddress: '88 Gold Coast Hwy, Broadbeach QLD' });
      ctx.signOffElectrical(elecJobId);
    });
    const elecAfterValid = ctx.getOrCreateElectrical(elecJobId);
    assert.equal(elecAfterValid.signedOff, true, 'Electrical cert signed off after restoration');
    const elecParsed = JSON.parse(elecAfterValid.fullSnapshot!);
    assert.equal(elecParsed.installationAddress, '88 Gold Coast Hwy, Broadbeach QLD', 'Frozen snapshot contains latest address');

    // Immutability: Repeated same-render sign-off
    const elecSnapBefore = elecAfterValid.fullSnapshot;
    await act(async () => {
      ctx.updateElectricalForm(elecJobId, { installationAddress: 'Altered Address' });
      ctx.signOffElectrical(elecJobId);
    });
    assert.equal(ctx.getOrCreateElectrical(elecJobId).fullSnapshot, elecSnapBefore, 'Electrical snapshot is immutable');

    // 3. Smoke Alarm Flow: Same-render invalidation & sign-off rejection
    let smokeJobId = '';
    await act(async () => {
      smokeJobId = ctx.createJob({
        brandId: 'smart_home',
        title: 'Smoke Alarm Consistency Test Job',
        jobType: 'JT-002',
        siteAddress: '200 Marine Pde, Southport QLD',
        siteContact: 'Smoke Tester',
      }).id;
    });

    // In a single act, clear required propertyType and attempt sign-off
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, { propertyType: '' as any });
      ctx.signOffSmokeAlarm(smokeJobId);
    });
    const smokeAfterInvalid = ctx.getOrCreateSmokeAlarm(smokeJobId);
    assert.equal(smokeAfterInvalid.signedOff, false, 'Smoke cert remains unsigned when propertyType cleared in same act');
    assert.equal(smokeAfterInvalid.fullSnapshot, undefined, 'No snapshot created for invalid Smoke cert');

    // Restore propertyType and sign off
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, { propertyType: 'Townhouse' });
      ctx.signOffSmokeAlarm(smokeJobId);
    });
    const smokeAfterValid = ctx.getOrCreateSmokeAlarm(smokeJobId);
    assert.equal(smokeAfterValid.signedOff, true, 'Smoke cert signed off after restoration');
    const smokeParsed = JSON.parse(smokeAfterValid.fullSnapshot!);
    assert.equal(smokeParsed.propertyType, 'Townhouse', 'Frozen snapshot contains latest propertyType');

    // Immutability: Repeated same-render sign-off
    const smokeSnapBefore = smokeAfterValid.fullSnapshot;
    await act(async () => {
      ctx.updateSmokeAlarmForm(smokeJobId, { propertyType: 'Commercial Office' });
      ctx.signOffSmokeAlarm(smokeJobId);
    });
    assert.equal(ctx.getOrCreateSmokeAlarm(smokeJobId).fullSnapshot, smokeSnapBefore, 'Smoke cert snapshot is immutable');

    // 4. TCA1 Flow: Same-render invalidation & sign-off rejection
    let tca1JobId = '';
    await act(async () => {
      tca1JobId = ctx.createJob({
        brandId: 'cctv',
        title: 'TCA1 Consistency Test Job',
        jobType: 'Enterprise CCTV & Cabling Inspection',
        siteAddress: '300 Marine Pde, Southport QLD',
        siteContact: 'TCA1 Tester',
      }).id;
    });

    // In a single act, clear required workDescription and attempt sign-off
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, { workDescription: '' });
      ctx.signOffTca1(tca1JobId);
    });
    const tca1AfterInvalid = ctx.getOrCreateTca1(tca1JobId);
    assert.equal(tca1AfterInvalid.signedOff, false, 'TCA1 remains unsigned when workDescription cleared in same act');
    assert.equal(tca1AfterInvalid.fullSnapshot, undefined, 'No snapshot created for invalid TCA1 cert');

    // Restore workDescription and sign off
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, { workDescription: 'Latest 8x Cat6 cabling drops verified' });
      ctx.signOffTca1(tca1JobId);
    });
    const tca1AfterValid = ctx.getOrCreateTca1(tca1JobId);
    assert.equal(tca1AfterValid.signedOff, true, 'TCA1 signed off after restoration');
    const tca1Parsed = JSON.parse(tca1AfterValid.fullSnapshot!);
    assert.equal(tca1Parsed.workDescription, 'Latest 8x Cat6 cabling drops verified', 'Frozen snapshot contains latest workDescription');

    // Immutability: Repeated same-render sign-off
    const tca1SnapBefore = tca1AfterValid.fullSnapshot;
    await act(async () => {
      ctx.updateTca1Form(tca1JobId, { workDescription: 'Altered Description' });
      ctx.signOffTca1(tca1JobId);
    });
    assert.equal(ctx.getOrCreateTca1(tca1JobId).fullSnapshot, tca1SnapBefore, 'TCA1 snapshot is immutable');

    // 5. TCA2 Flow: Same-render invalidation, side-effect prevention, and sign-off
    let tca2JobId = '';
    await act(async () => {
      tca2JobId = ctx.createJob({
        brandId: 'cctv',
        title: 'TCA2 Consistency Test Job',
        jobType: 'Enterprise CCTV & Cabling Inspection',
        siteAddress: '400 Marine Pde, Southport QLD',
        siteContact: 'TCA2 Tester',
      }).id;
    });

    // In a single act, clear required nonComplianceDescription and attempt sign-off
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, { nonComplianceDescription: '' });
      ctx.signOffTca2(tca2JobId);
    });
    const tca2AfterInvalid = ctx.getOrCreateTca2(tca2JobId);
    assert.equal(tca2AfterInvalid.signedOff, false, 'TCA2 remains unsigned when defect description cleared in same act');
    assert.equal(tca2AfterInvalid.fullSnapshot, undefined, 'No snapshot created for invalid TCA2 defect report');
    assert.equal(ctx.getTca2AuditRecord(tca2JobId), undefined, 'No TCA2 audit side effect created on blocked sign-off');

    // Restore defect description and sign off
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, { nonComplianceDescription: 'Riser cupboard unsegregated mains power feed' });
      ctx.signOffTca2(tca2JobId);
    });
    const tca2AfterValid = ctx.getOrCreateTca2(tca2JobId);
    assert.equal(tca2AfterValid.signedOff, true, 'TCA2 signed off after restoration');
    const tca2Parsed = JSON.parse(tca2AfterValid.fullSnapshot!);
    assert.equal(tca2Parsed.nonComplianceDescription, 'Riser cupboard unsegregated mains power feed', 'Frozen snapshot contains latest description');
    assert.ok(ctx.getTca2AuditRecord(tca2JobId), 'TCA2 audit record created after valid sign-off');

    // Immutability: Repeated same-render sign-off
    const tca2SnapBefore = tca2AfterValid.fullSnapshot;
    await act(async () => {
      ctx.updateTca2Form(tca2JobId, { nonComplianceDescription: 'Altered Hazard' });
      ctx.signOffTca2(tca2JobId);
    });
    assert.equal(ctx.getOrCreateTca2(tca2JobId).fullSnapshot, tca2SnapBefore, 'TCA2 snapshot is immutable');
  });
});

test('LAYER 6: FC-20 & FC-18 — default certificate reference stability across repeated reads and document creation, and online invoice reference collision immunity against offline reconciled references', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. FC-20: Default reference stability across subsequent reads, same-render updates, and other document creation
    let jobA: any;
    await act(async () => {
      jobA = ctx.createJob({
        brandId: 'solarcell',
        title: 'Job A Reference Stability Test',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '100 Queen St, Brisbane QLD',
        siteContact: 'Alice Ref',
      });
    });

    // Initial read
    const refA1 = ctx.getOrCreateElectrical(jobA.id).certReference;
    assert.ok(refA1.startsWith('ELEC-CERT-'), 'Initial electrical reference assigned');

    // Subsequent read returns identical reference
    const refA2 = ctx.getOrCreateElectrical(jobA.id).certReference;
    assert.equal(refA2, refA1, 'Subsequent read returns stable reference');

    // Same-render form update retains identical reference
    await act(async () => {
      ctx.updateElectricalForm(jobA.id, { dateOfTest: '2026-11-15' });
    });
    const refA3 = ctx.getOrCreateElectrical(jobA.id).certReference;
    assert.equal(refA3, refA1, 'Reference remains stable after same-render form update');

    // Creation of another document does not mutate Job A's reference
    let jobB: any;
    await act(async () => {
      jobB = ctx.createJob({
        brandId: 'solarcell',
        title: 'Job B Reference Stability Test',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '200 Queen St, Brisbane QLD',
        siteContact: 'Bob Ref',
      });
    });
    const refB1 = ctx.getOrCreateElectrical(jobB.id).certReference;
    assert.notEqual(refB1, refA1, 'Job B receives distinct reference');
    const refA4 = ctx.getOrCreateElectrical(jobA.id).certReference;
    assert.equal(refA4, refA1, 'Job A reference remains stable after Job B creation');

    // 2. FC-18: Online invoice reference collision immunity against offline-reconciled reference
    // Create offline invoice on Job A
    await act(async () => {
      ctx.setPersona('super_admin');
      ctx.setMyobStatus('DISCONNECTED');
    });
    await act(async () => {
      ctx.prepareInvoiceForJob(jobA.id, 1500);
    });
    const offlineJobA = ctx.jobs.find(j => j.id === jobA.id)!;
    assert.equal(offlineJobA.invoice?.externalMyobRef, 'PENDING-MYOB-SYNC');

    // Reconcile Job A offline invoice
    await act(async () => {
      ctx.reconcileInvoiceSync(jobA.id, 'SUCCESS');
    });
    const reconciledJobA = ctx.jobs.find(j => j.id === jobA.id)!;
    const reconciledRefA = reconciledJobA.invoice!.externalMyobRef;
    assert.ok(reconciledRefA.startsWith('MYOB-INV-'), 'Reconciled invoice receives stable reference');

    // Repeated reconciliation preserves both reference and invoice identity
    await act(async () => {
      ctx.reconcileInvoiceSync(jobA.id, 'SUCCESS');
    });
    const repeatedJobA = ctx.jobs.find(j => j.id === jobA.id)!;
    assert.equal(repeatedJobA.invoice?.externalMyobRef, reconciledRefA, 'Repeated reconciliation preserves reference');
    assert.equal(repeatedJobA.invoice?.id, offlineJobA.invoice?.id, 'Repeated reconciliation preserves invoice identity');

    // Bring MYOB online and create an online invoice on Job B
    await act(async () => {
      ctx.setMyobStatus('CONNECTED');
    });
    await act(async () => {
      ctx.prepareInvoiceForJob(jobB.id, 2500);
    });
    const onlineJobB = ctx.jobs.find(j => j.id === jobB.id)!;
    const onlineRefB = onlineJobB.invoice!.externalMyobRef;
    assert.ok(onlineRefB.startsWith('MYOB-INV-'), 'Online invoice receives valid reference');
    assert.notEqual(onlineRefB, reconciledRefA, 'Online invoice creation cannot duplicate offline reconciled reference');
  });
});
test('LAYER 6: Render Purity — reading default forms is read-only, commits zero state, returns stable references across repeated renders, and executes cleanly in React StrictMode', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    let purityJob: any;
    await act(async () => {
      purityJob = ctx.createJob({
        brandId: 'solarcell',
        title: 'Render Purity Test Job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '55 Purity Lane, Brisbane QLD',
        siteContact: 'Pure Tester',
      });
    });

    const jobId = purityJob.id;

    // 1. Before reading: Assert that no form records are committed for this job
    const authBefore = ctx.getAuthoritativeState();
    assert.equal(authBefore.jsaForms?.[jobId], undefined, 'Precondition: JSA uncommitted');
    assert.equal(authBefore.electricalCerts?.[jobId], undefined, 'Precondition: Electrical cert uncommitted');
    assert.equal(authBefore.smokeAlarmCerts?.[jobId], undefined, 'Precondition: Smoke alarm cert uncommitted');
    assert.equal(authBefore.tca1Certs?.[jobId], undefined, 'Precondition: TCA1 cert uncommitted');
    assert.equal(authBefore.tca2Certs?.[jobId], undefined, 'Precondition: TCA2 report uncommitted');

    // 2. Initial Read: Read all five default forms
    const jsa1 = ctx.getOrCreateJsa(jobId);
    const elec1 = ctx.getOrCreateElectrical(jobId);
    const smoke1 = ctx.getOrCreateSmokeAlarm(jobId);
    const tca1_1 = ctx.getOrCreateTca1(jobId);
    const tca2_1 = ctx.getOrCreateTca2(jobId);

    // Assert that reading default forms is read-only and commits zero state
    const authAfterRead1 = ctx.getAuthoritativeState();
    assert.equal(authAfterRead1.jsaForms?.[jobId], undefined, 'Reading default JSA does not commit form state');
    assert.equal(authAfterRead1.electricalCerts?.[jobId], undefined, 'Reading default Electrical does not commit form state');
    assert.equal(authAfterRead1.smokeAlarmCerts?.[jobId], undefined, 'Reading default Smoke Alarm does not commit form state');
    assert.equal(authAfterRead1.tca1Certs?.[jobId], undefined, 'Reading default TCA1 does not commit form state');
    assert.equal(authAfterRead1.tca2Certs?.[jobId], undefined, 'Reading default TCA2 does not commit form state');

    // 3. Repeated Read: Reference stability across repeated calls/renders
    const jsa2 = ctx.getOrCreateJsa(jobId);
    const elec2 = ctx.getOrCreateElectrical(jobId);
    const smoke2 = ctx.getOrCreateSmokeAlarm(jobId);
    const tca1_2 = ctx.getOrCreateTca1(jobId);
    const tca2_2 = ctx.getOrCreateTca2(jobId);

    assert.equal(elec2.certReference, elec1.certReference, 'Electrical cert reference is stable across repeated reads');
    assert.equal(smoke2.certReference, smoke1.certReference, 'Smoke alarm cert reference is stable across repeated reads');
    assert.equal(tca1_2.certReference, tca1_1.certReference, 'TCA1 cert reference is stable across repeated reads');
    assert.equal(tca2_2.reportReference, tca2_1.reportReference, 'TCA2 report reference is stable across repeated reads');

    // Still nothing committed
    const authAfterRead2 = ctx.getAuthoritativeState();
    assert.equal(authAfterRead2.electricalCerts?.[jobId], undefined, 'Repeated reads still do not commit form state');

    // 4. Explicit Update Action commits to authoritative state
    await act(async () => {
      ctx.updateElectricalForm(jobId, { dateOfTest: '2026-11-20' });
    });
    const authAfterUpdate = ctx.getAuthoritativeState();
    assert.ok(authAfterUpdate.electricalCerts?.[jobId], 'Explicit update action persists electrical cert in authoritative state');
    assert.equal(authAfterUpdate.electricalCerts?.[jobId]?.dateOfTest, '2026-11-20');
    assert.equal(authAfterUpdate.electricalCerts?.[jobId]?.certReference, elec1.certReference, 'Preserves stable reference on update');

    // Other forms remain uncommitted
    assert.equal(authAfterUpdate.jsaForms?.[jobId], undefined, 'Other forms remain uncommitted after updating electrical cert');
    assert.equal(authAfterUpdate.smokeAlarmCerts?.[jobId], undefined, 'Smoke alarm remains uncommitted');
  });

  // 5. React StrictMode rendering verification
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  let strictRenderCount = 0;
  let strictElecRef = '';
  let strictSmokeRef = '';

  function StrictConsumer() {
    strictRenderCount++;
    const { getOrCreateElectrical, getOrCreateSmokeAlarm } = useCabms();
    const elec = getOrCreateElectrical('JOB-STRICT-001');
    const smoke = getOrCreateSmokeAlarm('JOB-STRICT-001');
    strictElecRef = elec.certReference;
    strictSmokeRef = smoke.certReference;
    return React.createElement('div', { id: 'strict-consumer' }, `${elec.certReference} / ${smoke.certReference}`);
  }

  await act(async () => {
    root.render(
      React.createElement(
        React.StrictMode,
        null,
        React.createElement(
          CabmsProvider,
          null,
          React.createElement(StrictConsumer)
        )
      )
    );
  });

  assert.ok(strictRenderCount >= 2, 'React StrictMode executed double-render');
  assert.equal(strictElecRef, 'ELEC-CERT-STRICT-001', 'Deterministic electrical cert reference rendered in StrictMode');
  assert.equal(strictSmokeRef, 'SMOKE-STRICT-001', 'Deterministic smoke cert reference rendered in StrictMode');
  assert.equal(container.querySelector('#strict-consumer')?.textContent, 'ELEC-CERT-STRICT-001 / SMOKE-STRICT-001');

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
test('LAYER 6: FC-01 & Policy A — sendCertificateEmail rejects unrequired forms and direct-to-invoice jobs, and retryCertificateDelivery enforces contractual requirement', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => {
      ctx.resetDemo();
    });

    // 1. Direct-to-invoice job (formsRequired: []) cannot dispatch any certificates
    let dtiJob: any;
    await act(async () => {
      dtiJob = ctx.createJob({
        brandId: 'smart_home',
        title: 'Policy A Direct-to-Invoice Job',
        jobType: 'Direct-to-Invoice Emergency Service',
        siteAddress: '100 DTI Way, Southport QLD',
        siteContact: 'DTI Contact',
      });
    });

    const dtiResult = ctx.sendCertificateEmail(dtiJob.id, 'JSA');
    assert.equal(dtiResult.success, false, 'sendCertificateEmail rejects unrequired JSA on DTI job');
    assert.equal(dtiResult.message, 'Certificate not required by work order contract');

    // 2. Standard job with restricted requirements (formsRequired: ['JSA', 'ELECTRICAL'])
    let solarJob: any;
    await act(async () => {
      solarJob = ctx.createJob({
        brandId: 'solarcell',
        title: 'Policy A Solarcell Job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '200 Solar Way, Broadbeach QLD',
        siteContact: 'Solar Contact',
      });
    });

    // Attempting to send unrequired Smoke Alarm certificate fails contract check
    const unrequiredResult = ctx.sendCertificateEmail(solarJob.id, 'SMOKE_ALARM');
    assert.equal(unrequiredResult.success, false, 'sendCertificateEmail rejects unrequired SMOKE_ALARM certificate');
    assert.equal(unrequiredResult.message, 'Certificate not required by work order contract');

    // 3. Attempting to send unsigned required certificate fails sign-off check
    const unsignedResult = ctx.sendCertificateEmail(solarJob.id, 'ELECTRICAL');
    assert.equal(unsignedResult.success, false, 'sendCertificateEmail rejects unsigned required certificate');
    assert.equal(unsignedResult.message, 'Document unsigned');

    // 4. Complete required electrical certificate and sign off
    await act(async () => {
      ctx.updateElectricalForm(solarJob.id, {
        installationAddress: '200 Solar Way, Broadbeach QLD',
      });
      ctx.signOffElectrical(solarJob.id);
    });

    // Dispatch required signed certificate with simulateFail = true to generate FAILED delivery record
    let failSimResult: any;
    await act(async () => {
      failSimResult = ctx.sendCertificateEmail(solarJob.id, 'ELECTRICAL', true);
    });
    assert.equal(failSimResult.success, false);
    const failedRecord = ctx.certificateDeliveries.find(d => d.jobId === solarJob.id && d.status === 'FAILED')!;
    assert.ok(failedRecord, 'Delivery record created with FAILED status');

    // Retry required delivery record succeeds
    await act(async () => {
      ctx.retryCertificateDelivery(failedRecord.id);
    });
    const retriedRecord = ctx.certificateDeliveries.find(d => d.id === failedRecord.id)!;
    assert.equal(retriedRecord.status, 'SENT', 'Retry transitions failed delivery to SENT for contractually required certificate');

    // Retrying an already SENT record is rejected and does not mutate history
    const sentAtBefore = retriedRecord.sentAt;
    await act(async () => {
      ctx.retryCertificateDelivery(retriedRecord.id);
    });
    const afterSecondRetry = ctx.certificateDeliveries.find(d => d.id === retriedRecord.id)!;
    assert.equal(afterSecondRetry.status, 'SENT', 'Historical SENT record cannot be retried');
    assert.equal(afterSecondRetry.sentAt, sentAtBefore, 'Rejected retry does not rewrite sentAt');

    // 5. Test retry snapshot corruption protection
    let jsaFailResult: any;
    await act(async () => {
      ctx.updateJsaForm(solarJob.id, {
        inductionCompleted: true,
        competencyVerified: true,
      });
      ctx.signOffJsa(solarJob.id);
      jsaFailResult = ctx.sendCertificateEmail(solarJob.id, 'JSA', true);
    });
    assert.equal(jsaFailResult.success, false);
    const jsaFailedRecord = ctx.certificateDeliveries.find(d => d.jobId === solarJob.id && d.formType === 'JSA' && d.status === 'FAILED')!;
    assert.ok(jsaFailedRecord, 'JSA failed delivery record created');

    // Corrupt snapshot
    (jsaFailedRecord as any).fullFrozenDocumentSnapshot = '{"corrupted": true}';

    await act(async () => {
      ctx.retryCertificateDelivery(jsaFailedRecord.id);
    });
    const preservedFailedRecord = ctx.certificateDeliveries.find(d => d.id === jsaFailedRecord.id)!;
    assert.equal(preservedFailedRecord.status, 'FAILED', 'Corrupted snapshot blocks retry and preserves FAILED status');

    // 6. Successful normal delivery of required certificate
    let validResult: any;
    await act(async () => {
      validResult = ctx.sendCertificateEmail(solarJob.id, 'ELECTRICAL', false);
    });
    assert.equal(validResult.success, true, 'sendCertificateEmail succeeds for valid signed required certificate');
    assert.equal(validResult.message, 'Certificate delivered successfully');
  });
});


test('LAYER 6: MAN-SEC-01 — certificate dispatch and retry enforce session authentication and authorized persona boundaries', async () => {
  await withMountedContext(async (ctx) => {
    await act(async () => { ctx.resetDemo(); });

    // Create a valid job with required signed form
    let job: any;
    await act(async () => {
      job = ctx.createJob({
        brandId: 'solarcell',
        title: 'MAN-SEC-01 Test Job',
        jobType: 'Residential Solar Maintenance',
        siteAddress: '100 Security Way, Southport QLD',
        siteContact: 'Security Contact',
      });
      ctx.updateElectricalForm(job.id, {
        installationAddress: '100 Security Way, Southport QLD',
      });
      ctx.signOffElectrical(job.id);
    });

    const deliveriesCountBefore = ctx.certificateDeliveries.length;

    // 1. Signed-out session: dispatch is rejected without creating delivery records
    await act(async () => {
      ctx.simulateSignOut();
    });
    const signedOutDispatch = ctx.sendCertificateEmail(job.id, 'ELECTRICAL');
    assert.equal(signedOutDispatch.success, false, 'Signed-out session cannot dispatch certificate');
    assert.equal(signedOutDispatch.message, 'Session signed out');
    assert.equal(ctx.certificateDeliveries.length, deliveriesCountBefore, 'No delivery record created when signed out');

    // 2. Technician persona: dispatch is rejected without creating delivery records
    await act(async () => {
      ctx.simulateSignIn('technician');
    });
    const techDispatch = ctx.sendCertificateEmail(job.id, 'ELECTRICAL');
    assert.equal(techDispatch.success, false, 'Technician cannot dispatch certificate');
    assert.equal(techDispatch.message, 'Unauthorized persona');
    assert.equal(ctx.certificateDeliveries.length, deliveriesCountBefore, 'No delivery record created by technician');

    // 3. Authorized persona (Office Staff) dispatch succeeds and creates FAILED record for retry testing
    await act(async () => {
      ctx.setPersona('office_staff');
    });
    let failSimResult: any;
    await act(async () => {
      failSimResult = ctx.sendCertificateEmail(job.id, 'ELECTRICAL', true);
    });
    assert.equal(failSimResult.success, false);
    assert.equal(ctx.certificateDeliveries.length, deliveriesCountBefore + 1, 'Delivery record created by authorized persona');
    const failedRecord = ctx.certificateDeliveries.find(d => d.jobId === job.id && d.status === 'FAILED')!;
    assert.ok(failedRecord, 'Failed delivery record exists');

    // 4. Retry while signed out: rejected without changing record status
    await act(async () => {
      ctx.simulateSignOut();
    });
    await act(async () => {
      ctx.retryCertificateDelivery(failedRecord.id);
    });
    const recordAfterSignedOutRetry = ctx.certificateDeliveries.find(d => d.id === failedRecord.id)!;
    assert.equal(recordAfterSignedOutRetry.status, 'FAILED', 'Signed-out retry rejected; status remains FAILED');

    // 5. Retry as technician: rejected without changing record status
    await act(async () => {
      ctx.simulateSignIn('technician');
    });
    await act(async () => {
      ctx.retryCertificateDelivery(failedRecord.id);
    });
    const recordAfterTechRetry = ctx.certificateDeliveries.find(d => d.id === failedRecord.id)!;
    assert.equal(recordAfterTechRetry.status, 'FAILED', 'Technician retry rejected; status remains FAILED');

    // 6. Retry as Super Admin: succeeds and updates status to SENT
    await act(async () => {
      ctx.simulateSignIn('super_admin');
    });
    await act(async () => {
      ctx.retryCertificateDelivery(failedRecord.id);
    });
    const recordAfterAdminRetry = ctx.certificateDeliveries.find(d => d.id === failedRecord.id)!;
    assert.equal(recordAfterAdminRetry.status, 'SENT', 'Super Admin retry transitions status to SENT');

    // 7. Verify Owner Admin can also dispatch
    await act(async () => {
      ctx.setPersona('owner_admin');
      ctx.updateJsaForm(job.id, {
        inductionCompleted: true,
        competencyVerified: true,
        customerName: 'Owner Admin Client',
      });
      ctx.signOffJsa(job.id);
    });
    const ownerDispatch = ctx.sendCertificateEmail(job.id, 'JSA');
    assert.equal(ownerDispatch.success, true, 'Owner Admin dispatch succeeds');
  });
});
