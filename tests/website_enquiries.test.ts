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

  // 5. Idempotent replay with same key + same payload -> 200 deduplicated, no second email
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
  const replayBody = (await replayRes.json()) as { enquiry: { id: string }; deduplicated: boolean };
  assert.equal(replayBody.deduplicated, true);
  assert.equal(replayBody.enquiry.id, createdBody.enquiry.id);
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

  // Concurrent conversion: exactly one succeeds (201), one gets 409
  const [c1, c2] = await Promise.all([
    handleEnquiries(
      new Request(`http://localhost/api/v1/workspaces/solarcell/enquiries/${created.enquiry.id}/convert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_mode: 'new' }),
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
        body: JSON.stringify({ customer_mode: 'new' }),
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
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const m = /^\/api\/v1\/workspaces\/([^/]+)\/website-enquiries(?:\/([^/]+)\/(convert|dismiss))?$/.exec(url.pathname);
    if (m) {
      return handleEnquiries(req, env, m[1], m[2], m[3], `req_${crypto.randomUUID().slice(0, 6)}`, authService);
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

  await act(async () => {
    const btn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Convert to Job'))!;
    btn.click();
    await new Promise(r => setTimeout(r, 20));
  });

  const uiJobTypeId = container.querySelector<HTMLSelectElement>('select[aria-label="Job type"]')?.value;
  if (uiJobTypeId) {
    const now = new Date().toISOString();
    await db.exec(`
      INSERT OR IGNORE INTO form_definitions (id, workspace_id, brand_id, code, title, category, status, created_by, created_at, updated_at)
      VALUES ('fd_ui_enq', 'solarcell', 'solarcell', 'UI-ENQ-01', 'UI Safety Form', 'Custom', 'ACTIVE', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
      INSERT OR IGNORE INTO form_revisions (id, workspace_id, form_definition_id, version, status, created_by, created_at, updated_at)
      VALUES ('rev_ui_enq', 'solarcell', 'fd_ui_enq', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
      UPDATE form_revisions SET status = 'REVIEW' WHERE id = 'rev_ui_enq';
      UPDATE form_revisions SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = 'rev_ui_enq';
      INSERT OR IGNORE INTO job_types (id, workspace_id, brand_id, code, name, status, created_at, updated_at)
      VALUES ('${uiJobTypeId}', 'solarcell', 'solarcell', 'JT-UI', 'UI Job Type', 'ACTIVE', '${now}', '${now}');
      INSERT OR IGNORE INTO job_type_compliance_policies (id, job_type_id, version, status, created_by, created_at, updated_at)
      VALUES ('pol_ui_enq', '${uiJobTypeId}', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
      INSERT OR IGNORE INTO policy_catalog_form_rules (id, workspace_id, policy_version_id, form_revision_id, required, display_order)
      VALUES ('rule_ui_enq', 'solarcell', 'pol_ui_enq', 'rev_ui_enq', 1, 1);
      UPDATE job_type_compliance_policies SET status = 'REVIEW' WHERE id = 'pol_ui_enq';
      UPDATE job_type_compliance_policies SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = 'pol_ui_enq';
      UPDATE job_types SET current_policy_version_id = 'pol_ui_enq' WHERE id = '${uiJobTypeId}';
    `);
  }

  await act(async () => {
    const confirmBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Confirm Conversion'))!;
    confirmBtn.click();
    await new Promise(r => setTimeout(r, 40));
  });

  assert.match(container.textContent!, /CONVERTED_TO_JOB/);
});

test('P1 #1 regression: enquiry conversion persists real customer & compliance job records atomically and rejects invalid job_type_id', async t => {
  const db = await setupEnquiriesDb();
  t.after(() => db.getSqliteHandle().close());

  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const env: EnquiriesEnv = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const officeToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  // Seed a published form revision, active job type, and published policy
  const now = new Date().toISOString();
  await db.exec(`
    INSERT INTO form_definitions (id, workspace_id, brand_id, code, title, category, status, created_by, created_at, updated_at)
    VALUES ('fd_enq', 'solarcell', 'solarcell', 'ENQ-01', 'Enquiry Safety Form', 'Custom', 'ACTIVE', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    INSERT INTO form_revisions (id, workspace_id, form_definition_id, version, status, created_by, created_at, updated_at)
    VALUES ('rev_enq', 'solarcell', 'fd_enq', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    UPDATE form_revisions SET status = 'REVIEW' WHERE id = 'rev_enq';
    UPDATE form_revisions SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = 'rev_enq';
    INSERT INTO job_types (id, workspace_id, brand_id, code, name, status, created_at, updated_at)
    VALUES ('jt_enq', 'solarcell', 'solarcell', 'JT-ENQ', 'Enquiry Job Type', 'ACTIVE', '${now}', '${now}');
    INSERT INTO job_type_compliance_policies (id, job_type_id, version, status, created_by, created_at, updated_at)
    VALUES ('pol_enq', 'jt_enq', '1.0', 'DRAFT', '${G01_TEST_AUTH.officeStaff.userId}', '${now}', '${now}');
    INSERT INTO policy_catalog_form_rules (id, workspace_id, policy_version_id, form_revision_id, required, display_order)
    VALUES ('rule_enq', 'solarcell', 'pol_enq', 'rev_enq', 1, 1);
    UPDATE job_type_compliance_policies SET status = 'REVIEW' WHERE id = 'pol_enq';
    UPDATE job_type_compliance_policies SET status = 'PUBLISHED', approved_by = '${G01_TEST_AUTH.ownerAdmin.userId}', approved_at = '${now}' WHERE id = 'pol_enq';
    UPDATE job_types SET current_policy_version_id = 'pol_enq' WHERE id = 'jt_enq';
  `);

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

  // Invalid job_type_id must be rejected with 422 and NOT convert or create customer
  const badConv = await handleEnquiries(
    new Request(`http://localhost/api/v1/workspaces/solarcell/website-enquiries/${enquiry.id}/convert`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${officeToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_mode: 'new', job_type_id: 'jt_nonexistent' }),
    }),
    env,
    'solarcell',
    enquiry.id,
    'convert',
    'req_enq_bad_jt',
    authService
  );
  assert.equal(badConv.status, 422);
  const badCust = await db.prepare(`SELECT COUNT(*) AS cnt FROM customers WHERE email = 'atomic@example.invalid'`).first<{ cnt: number }>();
  assert.equal(badCust?.cnt, 0);

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
  const convData = (await goodConv.json()) as { customer_id: string; job_id: string };
  assert.ok(convData.customer_id);
  assert.ok(convData.job_id);

  const persistedCust = await db.prepare(`SELECT id, myob_customer_id, sync_status FROM customers WHERE workspace_id = 'solarcell' AND id = ?`).bind(convData.customer_id).first<{ id: string; myob_customer_id: string; sync_status: string }>();
  assert.ok(persistedCust);
  assert.match(persistedCust.myob_customer_id, /^MYOB-SBX-/);

  const persistedJob = await db.prepare(`SELECT id, status, title FROM compliance_jobs WHERE workspace_id = 'solarcell' AND id = ?`).bind(convData.job_id).first<{ id: string; status: string; title: string }>();
  assert.ok(persistedJob);
  assert.equal(persistedJob.status, 'OPEN');
});
