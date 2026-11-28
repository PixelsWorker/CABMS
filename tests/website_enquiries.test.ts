import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { G01_MIGRATION_MANIFEST, planLocalMigrations } from '../backend/db/migrate.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createWorker } from '../backend/index.ts';
import type { EmailEnv } from '../backend/services/emailService.ts';
import { handleComplianceJobs } from '../backend/workers/routes/complianceJobs.ts';
import { handleCustomers } from '../backend/workers/routes/customers.ts';
import {
  handleEnquiries,
  handlePublicEnquiryIntake,
  type EnquiriesEnv,
  type EnquiryEmailPayload,
} from '../backend/workers/routes/enquiries.ts';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { EnquiriesView } from '../src/views/EnquiriesView.tsx';
import { setApiBase, resetApiBase } from '../src/services/g01Client.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

async function setupEnquiriesDb(): Promise<LocalD1Database> {
  const db = createLocalD1Database() as LocalD1Database;
  const verified = G01_MIGRATION_MANIFEST.map(([name]) => ({
    name,
    bytes: readFileSync(resolve('migrations', name)),
  }));
  const { before, pair, after } = planLocalMigrations(verified);
  for (const m of before) await db.exec(m.bytes.toString('utf8'));
  await db.exec(`BEGIN TRANSACTION;\n${pair[0].bytes.toString('utf8')}\n${pair[1].bytes.toString('utf8')}\nCOMMIT;`);
  for (const m of after) await db.exec(m.bytes.toString('utf8'));
  await db.exec(readFileSync(resolve('migrations', '0023_website_enquiries.sql'), 'utf8'));
  await installG01TestAuthFixtures(db);
  return db;
}

async function seedActivePublishedJobType(
  db: LocalD1Database,
  opts: { workspaceId?: string; jobTypeId?: string; name?: string; code?: string; formId?: string; revisionId?: string; policyId?: string; ruleId?: string } = {}
): Promise<string> {
  const workspaceId = opts.workspaceId ?? 'solarcell';
  const jobTypeId = opts.jobTypeId ?? 'jt_enq';
  const name = opts.name ?? 'Enquiry Job Type';
  const code = opts.code ?? `JT-${jobTypeId.toUpperCase()}`;
  const formId = opts.formId ?? `fd_${jobTypeId}`;
  const revisionId = opts.revisionId ?? `rev_${jobTypeId}`;
  const policyId = opts.policyId ?? `pol_${jobTypeId}`;
  const ruleId = opts.ruleId ?? `rule_${jobTypeId}`;
  const now = new Date().toISOString();

  await db.exec(`
    INSERT OR IGNORE INTO form_definitions (id, workspace_id, brand_id, code, title, category, status, created_by, created_at, updated_at)
    VALUES ('${formId}', '${workspaceId}', '${workspaceId}', '${code}-F', 'Enquiry Safety Form', 'Custom', 'ACTIVE', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    INSERT OR IGNORE INTO form_revisions (id, workspace_id, form_definition_id, version, status, created_by, created_at, updated_at)
    VALUES ('${revisionId}', '${workspaceId}', '${formId}', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    UPDATE form_revisions SET status = 'REVIEW' WHERE id = '${revisionId}' AND status = 'DRAFT';
    UPDATE form_revisions SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = '${revisionId}' AND status = 'REVIEW';
    INSERT OR IGNORE INTO job_types (id, workspace_id, brand_id, code, name, status, created_at, updated_at)
    VALUES ('${jobTypeId}', '${workspaceId}', '${workspaceId}', '${code}', '${name}', 'ACTIVE', '${now}', '${now}');
    INSERT OR IGNORE INTO job_type_compliance_policies (id, job_type_id, version, status, created_by, created_at, updated_at)
    VALUES ('${policyId}', '${jobTypeId}', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    INSERT OR IGNORE INTO policy_catalog_form_rules (id, workspace_id, policy_version_id, form_revision_id, required, display_order)
    VALUES ('${ruleId}', '${workspaceId}', '${policyId}', '${revisionId}', 1, 1);
    UPDATE job_type_compliance_policies SET status = 'REVIEW' WHERE id = '${policyId}' AND status = 'DRAFT';
    UPDATE job_type_compliance_policies SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = '${policyId}' AND status = 'REVIEW';
    UPDATE job_types SET current_policy_version_id = '${policyId}' WHERE id = '${jobTypeId}';
  `);
  return jobTypeId;
}

test('public enquiry intake: routing, validation, spam/auth guard, idempotency, and email hook', async t => {
  const db = await setupEnquiriesDb();
  t.after(() => db.getSqliteHandle().close());

  const dispatched: EnquiryEmailPayload[] = [];
  const env: EnquiriesEnv = {
    DB: db,
    ENVIRONMENT: 'test',
    ENQUIRY_INTAKE_TOKEN: 'secret-intake-token',
  };

  // 1. Missing/invalid intake token -> 401
  const noTokenRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_website: 'solarcell.com.au',
        customer_name: 'Alice',
        email: 'alice@example.com',
        phone: '0411222333',
        service_requested: 'Solar battery quote',
      }),
    }),
    env,
    'req_1'
  );
  assert.equal(noTokenRes.status, 401);

  // 2. Honeypot spam guard -> 422
  const spamRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
      },
      body: JSON.stringify({
        source_website: 'solarcell.com.au',
        customer_name: 'Bot',
        email: 'bot@example.com',
        phone: '0411222333',
        service_requested: 'Buy links',
        website_hp: 'http://spam.invalid',
      }),
    }),
    env,
    'req_2'
  );
  assert.equal(spamRes.status, 422);

  // 3. Unknown workspace -> 422
  const badWsRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
      },
      body: JSON.stringify({
        workspace_id: 'unknown_ws',
        customer_name: 'Alice',
        email: 'alice@example.com',
        phone: '0411222333',
        service_requested: 'Solar battery quote',
      }),
    }),
    env,
    'req_3'
  );
  assert.equal(badWsRes.status, 422);

  // 4. Valid intake routed by domain + custom email hook
  const validPayload = {
    source_website: 'solarcell.com.au',
    customer_name: 'Alice Nguyen',
    email: 'alice@example.com',
    phone: '0411222333',
    site_address: '10 Solar Ave, Brisbane',
    service_requested: 'Solar battery quote',
    notes: 'Interested in 10kWh battery.',
  };

  const createdRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
        'Idempotency-Key': 'web-sub-001',
      },
      body: JSON.stringify(validPayload),
    }),
    env,
    'req_4',
    async payload => {
      dispatched.push(payload);
      return { status: 'SENT', messageId: 'msg_live_123' };
    }
  );
  assert.equal(createdRes.status, 201);
  const createdBody = (await createdRes.json()) as {
    enquiry: { id: string; workspace_id: string; acknowledgement_status: string; acknowledgement_message_id: string };
    deduplicated: boolean;
  };
  assert.equal(createdBody.deduplicated, false);
  assert.equal(createdBody.enquiry.workspace_id, 'solarcell');
  assert.equal(createdBody.enquiry.acknowledgement_status, 'SENT');
  assert.equal(createdBody.enquiry.acknowledgement_message_id, 'msg_live_123');
  assert.equal(dispatched.length, 1);

  // 5. Idempotent replay with same key + same payload -> 200 deduplicated minimal receipt (no PII), no second email
  const replayRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
        'Idempotency-Key': 'web-sub-001',
      },
      body: JSON.stringify(validPayload),
    }),
    env,
    'req_5',
    async payload => {
      dispatched.push(payload);
      return { status: 'SENT', messageId: 'msg_should_not_send' };
    }
  );
  assert.equal(replayRes.status, 200);
  const replayBody = (await replayRes.json()) as { enquiry: Record<string, unknown>; deduplicated: boolean };
  assert.equal(replayBody.deduplicated, true);
  assert.equal(replayBody.enquiry.id, createdBody.enquiry.id);
  assert.deepEqual(Object.keys(replayBody.enquiry).sort(), [
    'acknowledgement_status',
    'created_at',
    'id',
    'status',
  ]);
  for (const piiKey of ['customer_name', 'email', 'phone', 'site_address', 'notes', 'service_requested', 'matched_customer_id']) {
    assert.equal(Object.hasOwn(replayBody.enquiry, piiKey), false, `idempotency replay must omit ${piiKey}`);
  }
  assert.equal(dispatched.length, 1);

  // 5b. Recent fingerprint duplicate replay (without Idempotency-Key) -> 200 deduplicated minimal receipt (no stored PII)
  const fpReplayRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
      },
      body: JSON.stringify({
        source_website: 'solarcell.com.au',
        customer_name: 'Alice Nguyen',
        email: 'alice@example.com',
        phone: '0400000000',
        service_requested: 'Solar battery quote',
      }),
    }),
    env,
    'req_5b',
    async payload => {
      dispatched.push(payload);
      return { status: 'SENT', messageId: 'msg_should_not_send_fp' };
    }
  );
  assert.equal(fpReplayRes.status, 200);
  const fpReplayBody = (await fpReplayRes.json()) as { enquiry: Record<string, unknown>; deduplicated: boolean };
  assert.equal(fpReplayBody.deduplicated, true);
  assert.equal(fpReplayBody.enquiry.id, createdBody.enquiry.id);
  assert.deepEqual(Object.keys(fpReplayBody.enquiry).sort(), [
    'acknowledgement_status',
    'created_at',
    'id',
    'status',
  ]);
  for (const piiKey of ['customer_name', 'email', 'phone', 'site_address', 'notes', 'service_requested', 'matched_customer_id']) {
    assert.equal(Object.hasOwn(fpReplayBody.enquiry, piiKey), false, `fingerprint replay must omit ${piiKey}`);
  }
  assert.equal(dispatched.length, 1);

  // 6. Idempotency key reused with different payload -> 409
  const conflictRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
        'Idempotency-Key': 'web-sub-001',
      },
      body: JSON.stringify({ ...validPayload, service_requested: 'Different service' }),
    }),
    env,
    'req_6'
  );
  assert.equal(conflictRes.status, 409);

  // 7. Failing email hook does not fail intake; records FAILED status
  const failEmailRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
      },
      body: JSON.stringify({
        workspace_id: 'cctv',
        customer_name: 'Bob Smith',
        email: 'bob@example.com',
        phone: '0499888777',
        service_requested: 'CCTV camera install',
      }),
    }),
    env,
    'req_7',
    async () => {
      throw new Error('SMTP relay timeout');
    }
  );
  assert.equal(failEmailRes.status, 201);
  const failEmailBody = (await failEmailRes.json()) as {
    enquiry: { acknowledgement_status: string; acknowledgement_error: string };
  };
  assert.equal(failEmailBody.enquiry.acknowledgement_status, 'FAILED');
  assert.match(failEmailBody.enquiry.acknowledgement_error, /SMTP relay timeout/);

  // 8. UNCERTAIN email hook outcome must never coerce to SENT or SANDBOX_SIMULATED
  const uncertainEmailRes = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Enquiry-Intake-Token': 'secret-intake-token',
      },
      body: JSON.stringify({
        workspace_id: 'smart_home',
        customer_name: 'Uncertain Client',
        email: 'uncertain@example.com',
        phone: '0488777666',
        service_requested: 'Smart blind integration',
      }),
    }),
    env,
    'req_8',
    async () => ({
      status: 'UNCERTAIN',
      messageId: 'msg_uncertain_504',
      error: '504 Gateway Timeout',
    })
  );
  assert.equal(uncertainEmailRes.status, 201);
  const uncertainBody = (await uncertainEmailRes.json()) as {
    enquiry: {
      id: string;
      acknowledgement_status: string;
      acknowledgement_message_id: string | null;
      acknowledgement_error: string | null;
    };
    acknowledgement_outcome?: string;
  };
  assert.equal(uncertainBody.acknowledgement_outcome, 'UNCERTAIN');
  assert.equal(uncertainBody.enquiry.acknowledgement_status, 'PENDING');
  assert.notEqual(uncertainBody.enquiry.acknowledgement_status, 'SENT');
  assert.notEqual(uncertainBody.enquiry.acknowledgement_status, 'SANDBOX_SIMULATED');
  assert.equal(uncertainBody.enquiry.acknowledgement_message_id, 'msg_uncertain_504');
  assert.match(uncertainBody.enquiry.acknowledgement_error ?? '', /UNCERTAIN/i);

  const uncertainAudit = await db
    .prepare(
      `SELECT event_type, details_json FROM website_enquiry_audit_events
       WHERE workspace_id = 'smart_home' AND enquiry_id = ? AND event_type = 'ACK_EMAIL_FAILED'`
    )
    .bind(uncertainBody.enquiry.id)
    .first<{ event_type: string; details_json: string }>();
  assert.ok(uncertainAudit);
  assert.equal(JSON.parse(uncertainAudit.details_json).outcome, 'UNCERTAIN');

  // 9. End-to-end Worker enquiryEmailHook + emailService HTTPS relay 504 timeout preserves UNCERTAIN cleanly
  await db.exec(
    `UPDATE workspace_provider_configs SET smtp_transport_mode = 'http_relay' WHERE workspace_id = 'smart_home'`
  );
  const worker = createWorker();
  const workerEnv: EmailEnv = {
    DB: db,
    ENVIRONMENT: 'test',
    EMAIL_RELAY_URL: 'https://relay.example.invalid/send',
    EMAIL_RELAY_API_KEY: 'secret-relay-key',
    EMAIL_FETCH_OVERRIDE: async () => new Response('Gateway Timeout', { status: 504 }),
  };
  const workerRes = await worker.fetch(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'smart_home',
        customer_name: 'Worker Timeout Client',
        email: 'worker-timeout@example.com',
        phone: '0477666555',
        service_requested: 'Smart lock setup',
      }),
    }),
    workerEnv
  );
  assert.equal(workerRes.status, 201);
  const workerBody = (await workerRes.json()) as {
    enquiry: {
      id: string;
      acknowledgement_status: string;
      acknowledgement_message_id: string | null;
      acknowledgement_error: string | null;
    };
    acknowledgement_outcome?: string;
  };
  assert.equal(workerBody.acknowledgement_outcome, 'UNCERTAIN');
  assert.equal(workerBody.enquiry.acknowledgement_status, 'PENDING');
  assert.ok(workerBody.enquiry.acknowledgement_message_id);
  assert.match(workerBody.enquiry.acknowledgement_error ?? '', /UNCERTAIN/i);
  const deliveryRow = await db
    .prepare('SELECT status FROM email_deliveries WHERE workspace_id = ? AND id = ?')
    .bind('smart_home', workerBody.enquiry.acknowledgement_message_id)
    .first<{ status: string }>();
  assert.equal(deliveryRow?.status, 'UNCERTAIN');
});

test('authenticated enquiries: RBAC, workspace isolation, atomic conversion, and dismiss', async t => {
  const db = await setupEnquiriesDb();
  t.after(() => db.getSqliteHandle().close());

  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const env: EnquiriesEnv = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const officeToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  // Unauthenticated -> 401
  const unauthRes = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/solarcell/enquiries'),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_unauth',
    authService
  );
  assert.equal(unauthRes.status, 401);

  // Technician -> 403
  const techRes = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/solarcell/enquiries', {
      headers: { Authorization: `Bearer ${techToken}` },
    }),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_tech',
    authService
  );
  assert.equal(techRes.status, 403);

  // Cross-workspace (officeStaff is in solarcell, not cctv) -> 403
  const crossRes = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/cctv/enquiries', {
      headers: { Authorization: `Bearer ${officeToken}` },
    }),
    env,
    'cctv',
    undefined,
    undefined,
    'req_cross',
    authService
  );
  assert.equal(crossRes.status, 403);

  // Staff create enquiry
  const createRes = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/solarcell/enquiries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Claire Evans',
        email: 'claire@example.com',
        phone: '0412000111',
        site_address: '55 Bayview St, Gold Coast',
        service_requested: 'Inverter fault check',
      }),
    }),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_create',
    authService
  );
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { enquiry: { id: string; acknowledgement_status: string } };
  assert.equal(created.enquiry.acknowledgement_status, 'SANDBOX_SIMULATED');

  // Conversion without job_type_id -> 422 and leaves enquiry PENDING_REVIEW
  const missingJtConv = await handleEnquiries(
    new Request(`http://localhost/api/v1/workspaces/solarcell/enquiries/${created.enquiry.id}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_mode: 'new' }),
    }),
    env,
    'solarcell',
    created.enquiry.id,
    'convert',
    'req_conv_missing_jt',
    authService
  );
  assert.equal(missingJtConv.status, 422);
  const stillPending = await db
    .prepare('SELECT status, converted_job_id FROM website_enquiries WHERE id = ?')
    .bind(created.enquiry.id)
    .first<{ status: string; converted_job_id: string | null }>();
  assert.equal(stillPending?.status, 'PENDING_REVIEW');
  assert.equal(stillPending?.converted_job_id, null);

  const jobTypeId = await seedActivePublishedJobType(db, { workspaceId: 'solarcell', jobTypeId: 'jt_auth_conv', name: 'Solar Fault' });

  // Concurrent conversion with valid active published job_type_id: exactly one succeeds (201), one gets 409
  const [c1, c2] = await Promise.all([
    handleEnquiries(
      new Request(`http://localhost/api/v1/workspaces/solarcell/enquiries/${created.enquiry.id}/convert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_mode: 'new', job_type_id: jobTypeId }),
      }),
      env,
      'solarcell',
      created.enquiry.id,
      'convert',
      'req_conv_1',
      authService
    ),
    handleEnquiries(
      new Request(`http://localhost/api/v1/workspaces/solarcell/enquiries/${created.enquiry.id}/convert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_mode: 'new', job_type_id: jobTypeId }),
      }),
      env,
      'solarcell',
      created.enquiry.id,
      'convert',
      'req_conv_2',
      authService
    ),
  ]);
  assert.deepEqual([c1.status, c2.status].sort(), [201, 409]);
  const customerCount = await db
    .prepare("SELECT COUNT(*) AS cnt FROM customers WHERE workspace_id = 'solarcell' AND email = 'claire@example.com'")
    .first<{ cnt: number }>();
  assert.equal(customerCount?.cnt, 1);
  const jobCount = await db
    .prepare("SELECT COUNT(*) AS cnt FROM compliance_jobs WHERE workspace_id = 'solarcell'")
    .first<{ cnt: number }>();
  assert.equal(jobCount?.cnt, 1);

  // Create second enquiry and dismiss it
  const create2Res = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/solarcell/enquiries', {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Dan Test',
        email: 'dan@example.com',
        phone: '0412000222',
        service_requested: 'Roof inspection',
      }),
    }),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_create_2',
    authService
  );
  const created2 = (await create2Res.json()) as { enquiry: { id: string } };

  const dismissRes = await handleEnquiries(
    new Request(`http://localhost/api/v1/workspaces/solarcell/enquiries/${created2.enquiry.id}/dismiss`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}` },
    }),
    env,
    'solarcell',
    created2.enquiry.id,
    'dismiss',
    'req_dismiss',
    authService
  );
  assert.equal(dismissRes.status, 200);

  // List verifies counts
  const listRes = await handleEnquiries(
    new Request('http://localhost/api/v1/workspaces/solarcell/enquiries', {
      headers: { Authorization: `Bearer ${officeToken}` },
    }),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_list',
    authService
  );
  assert.equal(listRes.status, 200);
  const listBody = (await listRes.json()) as { counts: { pending: number; converted: number; dismissed: number; total: number } };
  assert.equal(listBody.counts.pending, 0);
  assert.equal(listBody.counts.converted, 1);
  assert.equal(listBody.counts.dismissed, 1);
  assert.equal(listBody.counts.total, 2);
});

test('EnquiriesView UI: enforces technician RBAC and supports create & convert', async t => {
  const db = await setupEnquiriesDb();
  t.after(() => db.getSqliteHandle().close());

  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const env: EnquiriesEnv = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const officeToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) {
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k],
    });
  }
  t.after(() => {
    mock.restoreAll();
    resetApiBase();
    dom.window.close();
    for (const k of keys) {
      const desc = saved.get(k);
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as any)[k];
    }
  });

  setApiBase('http://localhost');
  const requestedUrls: string[] = [];
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    requestedUrls.push(`${req.method} ${url.pathname}${url.search}`);
    const enqMatch = /^\/api\/v1\/workspaces\/([^/]+)\/website-enquiries(?:\/([^/]+)\/(convert|dismiss))?$/.exec(url.pathname);
    if (enqMatch) {
      return handleEnquiries(req, env, enqMatch[1], enqMatch[2], enqMatch[3], `req_${crypto.randomUUID().slice(0, 6)}`, authService);
    }
    const cjMatch = /^\/api\/v1\/workspaces\/([^/]+)\/compliance-jobs(?:\/([^/]+))?$/.exec(url.pathname);
    if (cjMatch) {
      return handleComplianceJobs(req, env, cjMatch[1], cjMatch[2], `req_${crypto.randomUUID().slice(0, 6)}`, authService);
    }
    const custMatch = /^\/api\/v1\/workspaces\/([^/]+)\/customers(?:\/([^/]+))?$/.exec(url.pathname);
    if (custMatch) {
      return handleCustomers(req, env, custMatch[1], custMatch[2], undefined, `req_${crypto.randomUUID().slice(0, 6)}`, authService);
    }
    return new Response('Not Found', { status: 404 });
  });

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  // Technician sees Access Denied
  const techSession: Session = {
    profile: {
      user: { id: G01_TEST_AUTH.technician.userId, email: G01_TEST_AUTH.technician.email, display_name: 'Tech' },
      memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'technician' }],
    },
    workspaceId: 'solarcell',
    selectWorkspace: () => {},
    token: async () => techToken,
    login: async () => {},
    logout: async () => {},
    invalidate: () => {},
    loading: false,
    error: '',
  };

  await act(async () => {
    root.render(
      React.createElement(
        SessionContext.Provider,
        { value: techSession },
        React.createElement(CabmsProvider, null, React.createElement(EnquiriesView))
      )
    );
    await new Promise(r => setTimeout(r, 20));
  });
  assert.match(container.textContent!, /Access Denied|Restricted/i);

  // Office staff creates and converts an enquiry
  const officeSession: Session = {
    profile: {
      user: { id: G01_TEST_AUTH.officeStaff.userId, email: G01_TEST_AUTH.officeStaff.email, display_name: 'Office' },
      memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' }],
    },
    workspaceId: 'solarcell',
    selectWorkspace: () => {},
    token: async () => officeToken,
    login: async () => {},
    logout: async () => {},
    invalidate: () => {},
    loading: false,
    error: '',
  };

  await act(async () => {
    root.render(
      React.createElement(
        SessionContext.Provider,
        { value: officeSession },
        React.createElement(CabmsProvider, null, React.createElement(EnquiriesView))
      )
    );
    await new Promise(r => setTimeout(r, 30));
  });

  const inputs = container.querySelectorAll('input');
  const setVal = (node: HTMLInputElement, value: string) => {
    const propKey = Object.keys(node).find(k => k.startsWith('__reactProps$'))!;
    (node as any)[propKey].onChange({ target: { value } });
  };

  await act(async () => {
    setVal(inputs[0], 'Jordan Lee');
    setVal(inputs[1], 'jordan@example.com');
    setVal(inputs[2], '0412345678');
    setVal(inputs[3], 'Solar panel check');
  });

  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 40));
  });

  assert.match(container.textContent!, /Jordan Lee/);
  assert.match(container.textContent!, /SANDBOX_SIMULATED/);

  // 1a. When only unmapped published job types exist (no ready job types), modal warns and disables Confirm Conversion
  await db.exec("UPDATE job_types SET status = 'ARCHIVED' WHERE workspace_id = 'solarcell' AND id = 'jt-solar-service'");
  await act(async () => {
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Convert to Job'))!;
    btn.click();
    await new Promise(r => setTimeout(r, 40));
  });
  assert.ok(
    requestedUrls.includes('GET /api/v1/workspaces/solarcell/compliance-jobs?view=creation-options'),
    'EnquiriesView loads real creation-options endpoint'
  );
  assert.match(container.textContent!, /Published job types exist in this workspace, but none have complete mandatory form mappings yet/i);
  assert.equal(
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Conversion'))!.disabled,
    true
  );

  // 1b. When NO active published job types exist at all, modal shows empty feedback and disables Confirm Conversion
  await act(async () => {
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Cancel'))!;
    cancelBtn.click();
    await new Promise(r => setTimeout(r, 20));
  });
  await db.exec("UPDATE job_types SET status = 'ARCHIVED' WHERE workspace_id = 'solarcell'");
  await act(async () => {
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Convert to Job'))!;
    btn.click();
    await new Promise(r => setTimeout(r, 40));
  });
  assert.match(container.textContent!, /No active published job types are available in this workspace/i);
  const disabledConfirmBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Conversion'))!;
  assert.equal(disabledConfirmBtn.disabled, true);

  // 2. Close modal, seed a real persisted active published job type, and reopen
  await act(async () => {
    const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Cancel'))!;
    cancelBtn.click();
    await new Promise(r => setTimeout(r, 20));
  });

  const persistedJtId = await seedActivePublishedJobType(db, {
    workspaceId: 'solarcell',
    jobTypeId: 'jt_ui_persisted',
    name: 'Persisted Solar Inspection',
  });

  await act(async () => {
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Convert to Job'))!;
    btn.click();
    await new Promise(r => setTimeout(r, 40));
  });

  const jobTypeSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Job type"]')!;
  assert.ok(jobTypeSelect);
  assert.equal(jobTypeSelect.value, persistedJtId);
  assert.equal(
    Array.from(jobTypeSelect.options).some(opt => opt.value === 'JT-001'),
    false,
    'demo CabmsContext jobTypes must not appear'
  );

  await act(async () => {
    const confirmBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Conversion'))!;
    assert.equal(confirmBtn.disabled, false);
    confirmBtn.click();
    await new Promise(r => setTimeout(r, 50));
  });

  assert.match(container.textContent!, /CONVERTED_TO_JOB/);
  const uiJob = await db
    .prepare("SELECT id, job_type_id, status FROM compliance_jobs WHERE workspace_id = 'solarcell' AND job_type_id = ?")
    .bind(persistedJtId)
    .first<{ id: string; job_type_id: string; status: string }>();
  assert.ok(uiJob);
  assert.equal(uiJob.status, 'OPEN');
});

test('P1 #1 regression: enquiry conversion persists real customer & compliance job records atomically and rejects invalid/missing job_type_id', async t => {
  const db = await setupEnquiriesDb();
  t.after(() => db.getSqliteHandle().close());

  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const env: EnquiriesEnv = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const officeToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  // Seed a published form revision, active job type, and published policy in solarcell, plus an un-published draft job type
  await seedActivePublishedJobType(db, { workspaceId: 'solarcell', jobTypeId: 'jt_enq', name: 'Enquiry Job Type' });
  const now = new Date().toISOString();
  await db.exec(`
    INSERT INTO job_types (id, workspace_id, brand_id, code, name, status, created_at, updated_at)
    VALUES ('jt_draft_only', 'solarcell', 'solarcell', 'JT-DRAFT', 'Draft Job Type', 'ACTIVE', '${now}', '${now}');
    INSERT INTO job_type_compliance_policies (id, job_type_id, version, status, created_by, created_at, updated_at)
    VALUES ('pol_draft_only', 'jt_draft_only', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    UPDATE job_types SET current_policy_version_id = 'pol_draft_only' WHERE id = 'jt_draft_only';
  `);
  await seedActivePublishedJobType(db, { workspaceId: 'cctv', jobTypeId: 'jt_other_ws', name: 'CCTV Job Type' });

  const intake = await handlePublicEnquiryIntake(
    new Request('http://localhost/api/v1/public/enquiries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspace_id: 'solarcell',
        source_website: 'https://solarcell.example.invalid',
        customer_name: 'Atomic Convert Customer',
        email: 'atomic@example.invalid',
        phone: '0411222333',
        site_address: '100 Solar Rd, Brisbane QLD',
        service_requested: 'Battery Install',
      }),
    }),
    env,
    'req_enq_intake'
  );
  assert.equal(intake.status, 201);
  const { enquiry } = (await intake.json()) as { enquiry: { id: string } };

  // Missing, invalid, draft, or cross-workspace job_type_id must be rejected with 422 and leave enquiry PENDING_REVIEW
  for (const [label, body] of [
    ['missing', { customer_mode: 'new' }],
    ['invalid', { customer_mode: 'new', job_type_id: 'jt_nonexistent' }],
    ['draft', { customer_mode: 'new', job_type_id: 'jt_draft_only' }],
    ['cross_workspace', { customer_mode: 'new', job_type_id: 'jt_other_ws' }],
  ] as const) {
    const res = await handleEnquiries(
      new Request(`http://localhost/api/v1/workspaces/solarcell/website-enquiries/${enquiry.id}/convert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
      'solarcell',
      enquiry.id,
      'convert',
      `req_enq_bad_${label}`,
      authService
    );
    assert.equal(res.status, 422, `${label} job_type_id must return 422`);
    const enqRow = await db
      .prepare('SELECT status, converted_job_id FROM website_enquiries WHERE id = ?')
      .bind(enquiry.id)
      .first<{ status: string; converted_job_id: string | null }>();
    assert.equal(enqRow?.status, 'PENDING_REVIEW', `${label}: enquiry remains PENDING_REVIEW`);
    assert.equal(enqRow?.converted_job_id, null, `${label}: converted_job_id remains null`);
    const custCnt = await db.prepare(`SELECT COUNT(*) AS cnt FROM customers WHERE email = 'atomic@example.invalid'`).first<{ cnt: number }>();
    assert.equal(custCnt?.cnt, 0, `${label}: no orphan customer created`);
  }

  // Valid conversion creates real customer + brand affiliation + compliance_job + compliance_requirements
  const goodConv = await handleEnquiries(
    new Request(`http://localhost/api/v1/workspaces/solarcell/website-enquiries/${enquiry.id}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_mode: 'new', job_type_id: 'jt_enq' }),
    }),
    env,
    'solarcell',
    enquiry.id,
    'convert',
    'req_enq_good_conv',
    authService
  );
  assert.equal(goodConv.status, 201);
  const convData = (await goodConv.json()) as { customer_id: string; job_id: string; enquiry: { converted_job_id: string; status: string } };
  assert.ok(convData.customer_id);
  assert.ok(convData.job_id);
  assert.equal(convData.enquiry.status, 'CONVERTED_TO_JOB');
  assert.equal(convData.enquiry.converted_job_id, convData.job_id);

  const persistedCust = await db.prepare(`SELECT id, myob_customer_id, sync_status FROM customers WHERE workspace_id = 'solarcell' AND id = ?`).bind(convData.customer_id).first<{ id: string; myob_customer_id: string; sync_status: string }>();
  assert.ok(persistedCust);
  assert.match(persistedCust.myob_customer_id, /^MYOB-SBX-/);

  const affiliation = await db
    .prepare(`SELECT customer_id, workspace_id, brand_id FROM customer_brand_affiliations WHERE customer_id = ? AND brand_id = 'solarcell'`)
    .bind(convData.customer_id)
    .first<{ customer_id: string; workspace_id: string; brand_id: string }>();
  assert.ok(affiliation);
  assert.equal(affiliation.workspace_id, 'solarcell');

  const persistedJob = await db.prepare(`SELECT id, status, title FROM compliance_jobs WHERE workspace_id = 'solarcell' AND id = ?`).bind(convData.job_id).first<{ id: string; status: string; title: string }>();
  assert.ok(persistedJob);
  assert.equal(persistedJob.status, 'OPEN');

  const reqCount = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM compliance_requirements WHERE workspace_id = 'solarcell' AND job_id = ?`)
    .bind(convData.job_id)
    .first<{ cnt: number }>();
  assert.equal(reqCount?.cnt, 1);
});
