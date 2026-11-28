/**
 * CABMS Wave 1 & 2 — Integrated Client Journey Walkthrough on Disposable Workerd + D1 + R2
 *
 * Exercises the complete end-to-end journey:
 * Website enquiry -> Customer -> Quotation -> Test email -> Job -> Schedule ->
 * Compliance forms -> Evidence -> Sign -> Complete -> Documents -> MYOB handoff -> Follow-up
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import type { D1Database } from '../../backend/db/d1.ts';

const { createTestHarness } = createRequire(import.meta.url)('wrangler');

test('integrated client journey: website enquiry -> customer -> quote -> test email -> job -> schedule -> compliance -> evidence -> sign -> complete -> documents -> MYOB -> follow-up', async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'cabms-wave12-journey-')));
  const migrations = path.join(dir, 'migrations');
  mkdirSync(migrations);
  for (const m of loadVerifiedMigrations()) writeFileSync(path.join(migrations, m.name), m.bytes);

  const fixture = await createFirebaseFixture();
  const officeToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const adminToken = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const configPath = path.join(dir, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify({
    name: 'cabms-wave12-journey',
    main: path.resolve('tests/support/worker.ts'),
    compatibility_date: '2026-10-28',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{ binding: 'DB', database_name: 'cabms-d1', database_id: 'wave12-only', migrations_dir: migrations }],
    r2_buckets: [{ binding: 'PRIVATE_EVIDENCE', bucket_name: 'cabms-private-evidence' }],
    vars: {
      ENVIRONMENT: 'test',
      FIREBASE_PROJECT_ID: 'cabms-test',
      TEST_PUBLIC_JWKS: JSON.stringify(fixture.jwks()),
      TEST_RUN_ID: randomUUID(),
      TEST_SETUP_SECRET: randomUUID(),
    },
  }));

  const harness = createTestHarness({ workers: [{ configPath }] });

  try {
    await harness.listen();
    const worker = harness.getWorker('cabms-wave12-journey');
    await worker.applyD1Migrations('DB');
    const db: D1Database = (await worker.getEnv()).DB;
    await installG01TestAuthFixtures(db);
    await db.prepare("INSERT OR IGNORE INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 5242880, '2026-11-28T00:00:00Z', ?)").bind(G01_TEST_AUTH.superAdmin.userId).run();
    const call = async (token: string | null, urlPath: string, method = 'GET', body?: unknown, headers?: Record<string, string>) => {
      const res = await worker.fetch(`http://localhost${urlPath}`, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`Non-JSON ${res.status} from ${method} ${urlPath}: ${text}`); }
      return { status: res.status, headers: res.headers, json };
    };

    // 1. Settings: verify & test sandbox provider config
    const provGet = await call(adminToken, '/api/v1/workspaces/solarcell/provider-settings');
    assert.equal(provGet.status, 200);
    const etag = provGet.headers.get('ETag')!;
    const provTest = await call(adminToken, '/api/v1/workspaces/solarcell/provider-settings/test', 'POST', { provider: 'smtp', recipient: 'preview-test@example.invalid' });
    assert.equal(provTest.status, 200);
    assert.equal(provTest.json.simulated, true);
    assert.ok(etag);

    // 2. Communications: send test email via shared emailService
    const testEmail = await call(officeToken, '/api/v1/workspaces/solarcell/communications/test-email', 'POST', {
      recipient_email: 'client-preview@example.invalid',
      subject: 'CABMS Preview Test Email',
    });
    assert.equal(testEmail.status, 201);
    assert.equal(testEmail.json.is_synthetic, true);

    // 3. Website enquiry: public intake -> acknowledgement via shared emailService
    const enqRes = await call(null, '/api/v1/public/enquiries', 'POST', {
      workspace_id: 'solarcell',
      source_website: 'https://solarcell.example.invalid',
      customer_name: 'Jordan Preview',
      email: 'jordan.preview@example.invalid',
      phone: '0412345678',
      site_address: '42 Sunshine Way, Gold Coast QLD',
      service_requested: 'Solar Inverter Inspection',
      notes: 'Preview journey enquiry',
    });
    assert.equal(enqRes.status, 201);
    const enquiryId = enqRes.json.enquiry.id as string;
    assert.equal(enqRes.json.enquiry.acknowledgement_status, 'SANDBOX_SIMULATED');

    // 4. Customer + MYOB Sandbox write-through
    const custRes = await call(officeToken, '/api/v1/workspaces/solarcell/customers', 'POST', {
      name: 'Jordan Preview',
      email: 'jordan.preview@example.invalid',
      phone: '0412345678',
      address: '42 Sunshine Way, Gold Coast QLD',
      brand_affiliations: ['solarcell'],
      idempotency_key: `cust-${randomUUID()}`,
    });
    assert.equal(custRes.status, 201);
    const customerId = custRes.json.customer.id as string;
    assert.match(custRes.json.customer.myob_customer_id, /^MYOB-SBX-/);

    // 5. Quotation & Terms: create -> send (freezes Terms + dispatches email) -> accept
    const quoteRes = await call(officeToken, '/api/v1/workspaces/solarcell/quotations', 'POST', {
      job_id: `JOB-PREVIEW-${randomUUID().slice(0, 6)}`,
      customer_id: customerId,
      customer_name: 'Jordan Preview',
      customer_email: 'jordan.preview@example.invalid',
      title: 'Solar Inverter Inspection Quote',
      line_items: [{ id: 'L1', description: 'Inverter safety check', quantity: 1, unit_price: 250 }],
    });
    assert.equal(quoteRes.status, 201);
    const quoteId = quoteRes.json.quotation.id as string;
    assert.equal(quoteRes.json.quotation.total, 275);

    const sendQuote = await call(officeToken, `/api/v1/workspaces/solarcell/quotations/${quoteId}/send`, 'POST', {
      recipient_email: 'jordan.preview@example.invalid',
    });
    assert.equal(sendQuote.status, 200);
    assert.equal(sendQuote.json.quotation.acceptance_status, 'SENT');
    assert.ok(sendQuote.json.email_dispatch.deliveryId);
    const quoteToken = sendQuote.json.acceptance_token as string;
    assert.ok(quoteToken);

    const dispatchedEmail = await db
      .prepare('SELECT body_text FROM email_deliveries WHERE id = ?')
      .bind(sendQuote.json.email_dispatch.deliveryId)
      .first<{ body_text: string }>();
    assert.ok(dispatchedEmail?.body_text.includes(`?quote_token=${encodeURIComponent(quoteToken)}`));
    assert.ok(dispatchedEmail?.body_text.includes(`/api/v1/public/quotations/${encodeURIComponent(quoteToken)}`));

    const publicQuoteGet = await call(null, `/api/v1/public/quotations/${encodeURIComponent(quoteToken)}`);
    assert.equal(publicQuoteGet.status, 200);
    assert.equal(publicQuoteGet.json.quotation.id, quoteId);

    const acceptQuote = await call(null, `/api/v1/public/quotations/${encodeURIComponent(quoteToken)}/accept`, 'POST', {
      confirmed: true,
      accepted_by_name: 'Jordan Preview',
    });
    assert.equal(acceptQuote.status, 200);
    assert.equal(acceptQuote.json.quotation.acceptance_status, 'ACCEPTED');

    // 6. Setup Form + Job Type, convert enquiry, create Job -> Assign -> Schedule Visit -> Compliance -> Evidence -> Sign -> Complete
    const formDef = await call(officeToken, '/api/v1/workspaces/solarcell/form-definitions', 'POST', {
      title: 'Preview Safety Check',
      code: 'PSC-01',
      description: 'Integrated client preview safety form',
      category: 'Custom',
      brand_id: 'solarcell',
      schema: { sections: [{ title: 'Checks', fields: [{ key: 'ok', label: 'Inverter isolated', type: 'PASS_FAIL', required: true }, { key: 'proof', label: 'Proof', type: 'PHOTO', required: true }] }] },
    });
    assert.equal(formDef.status, 201);
    const formId = formDef.json.id as string;
    const revId = formDef.json.revision_id as string;
    const formDetail = await call(officeToken, `/api/v1/workspaces/solarcell/form-definitions/${formId}`);
    const revUpdatedAt = formDetail.json.revisions.find((r: any) => r.id === revId)?.updated_at;
    assert.equal((await call(officeToken, `/api/v1/workspaces/solarcell/form-definitions/${formId}/revisions/${revId}/review`, 'POST', { expected_updated_at: revUpdatedAt })).status, 200);
    assert.equal((await call(adminToken, `/api/v1/workspaces/solarcell/form-definitions/${formId}/revisions/${revId}/approve`, 'POST', {})).status, 200);

    const jt = await call(officeToken, '/api/v1/workspaces/solarcell/job-types', 'POST', {
      name: 'Solar Service',
      code: 'SOL-SVC-01',
      brandId: 'solarcell',
      isDirectToInvoice: false,
      formRules: [{ form_revision_id: revId, required: true }],
    });
    assert.equal(jt.status, 201);
    const jtId = jt.json.id as string;
    const polId = jt.json.policyId as string;
    assert.equal((await call(officeToken, `/api/v1/workspaces/solarcell/job-types/${jtId}/policies/${polId}/review`, 'POST', {})).status, 200);
    assert.equal((await call(adminToken, `/api/v1/workspaces/solarcell/job-types/${jtId}/policies/${polId}/approve`, 'POST', {})).status, 200);

    // Convert enquiry directly into a real persisted compliance job using jtId
    const conv = await call(officeToken, `/api/v1/workspaces/solarcell/website-enquiries/${enquiryId}/convert`, 'POST', {
      customer_mode: 'existing',
      customer_id: customerId,
      job_type_id: jtId,
      job_title: 'Solar Inverter Inspection Job',
    });
    assert.equal(conv.status, 201);
    const jobId = conv.json.job_id as string;
    assert.ok(jobId);

    // Assign technician & grant signer permission
    assert.equal((await call(officeToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}?operation=ASSIGN`, 'POST', {
      assignee_id: G01_TEST_AUTH.technician.userId,
    }, { 'Idempotency-Key': randomUUID(), 'If-Match': '"1"' })).status, 200);
    // Admin grants signer permission via API route (no raw SQL)
    assert.equal((await call(adminToken, `/api/v1/workspaces/solarcell/form-definitions/${formId}/revisions/${revId}/signer-grants`, 'POST', {
      user_id: G01_TEST_AUTH.technician.userId,
    })).status, 201);

    const jobDetail = await call(officeToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}`);
    assert.equal(jobDetail.status, 200);
    const rawOccKey = jobDetail.json.requirements[0].occurrence_key as string;
    const occKey = encodeURIComponent(rawOccKey);
    const jobVersion = Number(jobDetail.json.job.version);

    // Schedule visit
    const visit = await call(officeToken, '/api/v1/workspaces/solarcell/visits', 'POST', {
      visit_id: randomUUID(),
      version: 1,
      job_id: jobId,
      technician_id: G01_TEST_AUTH.technician.userId,
      starts_at: '2026-11-30T00:00:00.000Z',
      duration_minutes: 60,
      status: 'SCHEDULED',
      reason: '',
    }, { 'Idempotency-Key': randomUUID() });
    assert.equal(visit.status, 200);

    // Compliance answer + R2 evidence + sign + complete
    const ans = await call(techToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}`, 'PATCH', {
      occurrence_key: rawOccKey,
      expected_answer_version: 0,
      answers: { ok: 'PASS' },
    }, { 'Idempotency-Key': randomUUID(), 'If-Match': `"${jobVersion}"` });
    assert.equal(ans.status, 200);

    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC', 'base64');
    const evStageRes = await worker.fetch(`http://localhost/api/v1/workspaces/solarcell/compliance-jobs/${jobId}/forms/${occKey}/evidence`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${techToken}`,
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
        'If-Match': `"${jobVersion}"`,
        'X-Answer-Version': '1',
      },
      body: new Uint8Array(png),
    });
    assert.equal(evStageRes.status, 201, await evStageRes.clone().text());
    const evId = ((await evStageRes.json()) as { upload_id: string }).upload_id;
    assert.equal((await call(techToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}/forms/${occKey}/evidence/${evId}/finalize`, 'POST', {}, { 'Idempotency-Key': randomUUID() })).status, 200);

    const sign = await call(techToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}/forms/${occKey}/sign`, 'POST', {
      expected_job_version: jobVersion,
      answer_version: 1,
      intent_version: 'cabms-form-attestation-v1',
      evidence_by_field: { proof: [evId] },
    }, { 'Idempotency-Key': randomUUID() });
    assert.equal(sign.status, 200);

    const complete = await call(officeToken, `/api/v1/workspaces/solarcell/compliance-jobs/${jobId}/complete`, 'POST', {
      expected_job_version: jobVersion,
    }, { 'Idempotency-Key': randomUUID() });
    assert.equal(complete.status, 200);
    assert.equal(complete.json.status, 'COMPLETED');

    // 7. Documents: template preview (simulated rendering notice)
    const tmpl = await call(adminToken, '/api/v1/workspaces/solarcell/templates', 'POST', {
      name: 'Completion Summary',
      templateType: 'QUOTE_TERMS',
      content: 'Hello {{customer_name}}, job {{job_title}} is complete.',
    });
    assert.equal(tmpl.status, 201);
    const tmplId = tmpl.json.id as string;
    const preview = await call(officeToken, `/api/v1/workspaces/solarcell/templates/${tmplId}/preview`, 'POST', {
      sampleData: { customer_name: 'Jordan Preview', job_title: 'Solar Inverter Inspection Job' },
    });
    assert.equal(preview.status, 200);
    assert.equal(preview.json.rendering_mode, 'SIMULATED_TEXT_PREVIEW');
    assert.match(preview.json.rendered_text, /Jordan Preview/);

    // 8. MYOB handoff verification + Follow-up review request
    const myobCheck = await call(officeToken, `/api/v1/workspaces/solarcell/customers/${customerId}`);
    assert.equal(myobCheck.status, 200);
    assert.match(myobCheck.json.customer.myob_customer_id, /^MYOB-SBX-/);

    const reviewReq = await call(officeToken, '/api/v1/workspaces/solarcell/communications/reviews', 'POST', {
      job_id: jobId,
      recipient_email: 'jordan.preview@example.invalid',
      recipient_name: 'Jordan Preview',
    });
    assert.equal(reviewReq.status, 201);
    assert.ok(reviewReq.json);
  } finally {
    await harness.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
