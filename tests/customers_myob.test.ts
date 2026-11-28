import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { G01_MIGRATION_MANIFEST, planLocalMigrations } from '../backend/db/migrate.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { handleCustomers } from '../backend/workers/routes/customers.ts';
import { SandboxMyobGateway } from '../src/services/myobGateway.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

async function setupCustomerTestDb(): Promise<LocalD1Database> {
  const db = createLocalD1Database() as LocalD1Database;
  const verified = G01_MIGRATION_MANIFEST.map(([name]) => ({
    name,
    bytes: readFileSync(resolve('migrations', name)),
  }));
  const { before, pair, after } = planLocalMigrations(verified);
  for (const m of before) await db.exec(m.bytes.toString('utf8'));
  await db.exec(`BEGIN TRANSACTION;\n${pair[0].bytes.toString('utf8')}\n${pair[1].bytes.toString('utf8')}\nCOMMIT;`);
  for (const m of after) await db.exec(m.bytes.toString('utf8'));
  await db.exec(readFileSync(resolve('migrations/0021_customers_myob.sql'), 'utf8'));
  await installG01TestAuthFixtures(db);
  return db;
}

function makeCall(
  db: LocalD1Database,
  authentication: ReturnType<typeof createAuthenticationService>,
  defaultToken: string
) {
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  return async (
    workspace: string,
    path: string,
    options: {
      method?: string;
      body?: unknown;
      token?: string;
      headers?: Record<string, string>;
    } = {}
  ) => {
    const method = options.method ?? 'GET';
    const token = options.token ?? defaultToken;
    const [pathOnly, queryString] = path.split('?');
    const segments = pathOnly.split('/').filter(Boolean);
    const customerId = segments[0] && segments[0] !== 'check-duplicate' ? segments[0] : undefined;
    const action = segments[0] === 'check-duplicate' ? 'check-duplicate' : segments[1];
    const req = new Request(
      `http://local/api/v1/workspaces/${workspace}/customers${pathOnly ? `/${pathOnly}` : ''}${queryString ? `?${queryString}` : ''}`,
      {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers ?? {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    return handleCustomers(req, env, workspace, customerId, action, `req_${crypto.randomUUID()}`, authentication);
  };
}

test('SandboxMyobGateway provides idempotent, clearly labeled sandbox write-through, retry, and reconciliation', async () => {
  const gateway = new SandboxMyobGateway();
  assert.equal(gateway.mode, 'mock');
  assert.equal(gateway.isSandbox, true);

  const first = await gateway.writeThroughCustomer(
    'solarcell',
    {
      name: 'Sandbox Solar Client',
      contactPerson: 'Jane Doe',
      email: 'jane@sandbox.invalid',
      phone: '0411222333',
      billingAddress: '10 Sun St',
      brandAffiliations: ['solarcell', 'smart_home'],
    },
    { idempotencyKey: 'idem-001', simulatedOutcome: 'SUCCESS', nowIso: '2026-11-28T00:00:00.000Z' }
  );
  assert.equal(first.status, 'SYNCED');
  assert.equal(first.isSandbox, true);
  assert.equal(first.sandboxLabel, 'SANDBOX_SYNTHETIC');
  assert.match(first.myobCustomerId, /^MYOB-SBX-/);

  // Idempotent replay returns identical card ID
  const replay = await gateway.writeThroughCustomer(
    'solarcell',
    {
      name: 'Different Name Ignored On Replay',
      contactPerson: 'Jane Doe',
      email: 'jane@sandbox.invalid',
      phone: '0411222333',
      billingAddress: '10 Sun St',
      brandAffiliations: ['solarcell'],
    },
    { idempotencyKey: 'idem-001', simulatedOutcome: 'FAILURE' }
  );
  assert.deepEqual(replay, first);

  const failed = await gateway.writeThroughCustomer(
    'solarcell',
    {
      name: 'Offline Client',
      contactPerson: 'Bob',
      email: 'bob@sandbox.invalid',
      phone: '0422333444',
      billingAddress: '20 Moon St',
      brandAffiliations: ['solarcell'],
    },
    { idempotencyKey: 'idem-fail', simulatedOutcome: 'FAILURE' }
  );
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.myobCustomerId, 'PENDING_MYOB_SYNC');

  const retried = await gateway.retryCustomerSync('solarcell', 'CUST-123', {
    name: 'Offline Client',
    contactPerson: 'Bob',
    email: 'bob@sandbox.invalid',
    phone: '0422333444',
    billingAddress: '20 Moon St',
    brandAffiliations: ['solarcell'],
  });
  assert.equal(retried.status, 'SYNCED');
  assert.match(retried.myobCustomerId, /^MYOB-SBX-/);

  const reconciled = await gateway.reconcileUncertainCustomer('solarcell', 'CUST-999', true);
  assert.equal(reconciled.status, 'SYNCED');
  assert.match(reconciled.myobCustomerId, /^MYOB-SBX-REC-/);
});

test('Customers API persists to D1, enforces RBAC & workspace isolation, detects duplicates, and supports idempotent MYOB sandbox sync', async t => {
  const db = await setupCustomerTestDb();
  t.after(() => db.getSqliteHandle().close());

  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);
  const call = makeCall(db, authService, staffToken);

  // 1. Auth & RBAC & Workspace Isolation
  assert.equal((await call('solarcell', '', { token: 'invalid-token' })).status, 401);
  assert.equal((await call('solarcell', '', { token: techToken })).status, 403);
  assert.equal((await call('cctv', '')).status, 403);

  // 2. Validation
  assert.equal((await call('solarcell', '', { method: 'POST', body: { name: '', email: 'not-an-email' } })).status, 422);

  // 3. Create customer with multi-brand affiliations & Idempotency-Key
  const createResp = await call('solarcell', '', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'cust-create-1' },
    body: {
      name: 'Oceanic Resort Group',
      contact_person: 'Alex Mercer',
      email: 'accounts@oceanic.example.invalid',
      phone: '0412 345 678',
      billing_address: '120 Marine Parade, Southport QLD 4215',
      brand_affiliations: ['solarcell', 'smart_home'],
      simulated_outcome: 'SUCCESS',
    },
  });
  assert.equal(createResp.status, 201);
  const createdJson = (await createResp.json()) as {
    customer: {
      id: string;
      myob_customer_id: string;
      brand_affiliations: string[];
      sync_status: string;
      myob_sandbox_mode: boolean;
      sandbox_label: string;
    };
  };
  assert.equal(createdJson.customer.sync_status, 'SYNCED');
  assert.equal(createdJson.customer.myob_sandbox_mode, true);
  assert.equal(createdJson.customer.sandbox_label, 'SANDBOX_SYNTHETIC');
  assert.match(createdJson.customer.myob_customer_id, /^MYOB-SBX-/);
  assert.deepEqual(createdJson.customer.brand_affiliations.sort(), ['smart_home', 'solarcell']);

  // Idempotent replay returns 200 with same customer and no duplicate row
  const replayResp = await call('solarcell', '', {
    method: 'POST',
    headers: { 'Idempotency-Key': 'cust-create-1' },
    body: {
      name: 'Oceanic Resort Group',
      email: 'accounts@oceanic.example.invalid',
      brand_affiliations: ['solarcell'],
    },
  });
  assert.equal(replayResp.status, 200);
  assert.equal(replayResp.headers.get('X-Idempotent-Replay'), 'true');
  const replayJson = (await replayResp.json()) as { customer: { id: string } };
  assert.equal(replayJson.customer.id, createdJson.customer.id);

  // 4. Duplicate detection & force_distinct override
  const dupResp = await call('solarcell', '', {
    method: 'POST',
    body: {
      name: 'Different Name',
      email: 'ACCOUNTS@oceanic.example.invalid',
      phone: '0499 999 999',
      brand_affiliations: ['solarcell'],
    },
  });
  assert.equal(dupResp.status, 409);
  const dupProblem = (await dupResp.json()) as { code: string };
  assert.equal(dupProblem.code, 'DUPLICATE_CUSTOMER');

  const checkDup = await call('solarcell', 'check-duplicate', {
    method: 'POST',
    body: { phone: '0412345678' },
  });
  assert.equal(checkDup.status, 200);
  const checkDupJson = (await checkDup.json()) as { is_duplicate: boolean; field: string };
  assert.equal(checkDupJson.is_duplicate, true);
  assert.equal(checkDupJson.field, 'phone');

  // Placeholder phone 0400 000 000 must NOT trigger false phone duplicate
  const placeholderResp = await call('solarcell', '', {
    method: 'POST',
    body: {
      name: 'Placeholder Phone Client',
      email: 'placeholder@example.invalid',
      phone: '0400 000 000',
      brand_affiliations: ['cctv'],
    },
  });
  assert.equal(placeholderResp.status, 201);

  // 5. Search & brand filter
  const searchByBrand = await call('solarcell', '?brand=smart_home&q=oceanic');
  assert.equal(searchByBrand.status, 200);
  const searchJson = (await searchByBrand.json()) as {
    customers: Array<{ id: string }>;
    myob_connection: { mode: string; is_sandbox: boolean };
  };
  assert.equal(searchJson.myob_connection.mode, 'sandbox');
  assert.equal(searchJson.myob_connection.is_sandbox, true);
  assert.equal(searchJson.customers.length, 1);
  assert.equal(searchJson.customers[0].id, createdJson.customer.id);

  // 6. Update customer & multi-brand affiliations
  const patchResp = await call('solarcell', createdJson.customer.id, {
    method: 'PATCH',
    body: {
      name: 'Oceanic Resort Group Pty Ltd',
      brand_affiliations: ['solarcell', 'smart_home', 'cctv'],
      notes: 'VIP commercial account',
    },
  });
  assert.equal(patchResp.status, 200);
  const patchedJson = (await patchResp.json()) as {
    customer: { name: string; brand_affiliations: string[]; version: number };
  };
  assert.equal(patchedJson.customer.name, 'Oceanic Resort Group Pty Ltd');
  assert.equal(patchedJson.customer.version, 2);
  assert.deepEqual(patchedJson.customer.brand_affiliations.sort(), ['cctv', 'smart_home', 'solarcell']);

  // 7. Failed write-through + retry sync
  const failedCreate = await call('solarcell', '', {
    method: 'POST',
    body: {
      name: 'Retryable Draft Co',
      email: 'retry@example.invalid',
      phone: '0433 111 222',
      brand_affiliations: ['solarcell'],
      simulated_outcome: 'FAILURE',
    },
  });
  assert.equal(failedCreate.status, 201);
  const failedJson = (await failedCreate.json()) as { customer: { id: string; sync_status: string; is_recoverable_draft: boolean } };
  assert.equal(failedJson.customer.sync_status, 'FAILED');
  assert.equal(failedJson.customer.is_recoverable_draft, true);

  const retryResp = await call('solarcell', `${failedJson.customer.id}/retry-sync`, {
    method: 'POST',
    body: { simulated_outcome: 'SUCCESS' },
  });
  assert.equal(retryResp.status, 200);
  const retriedJson = (await retryResp.json()) as { customer: { sync_status: string; myob_customer_id: string; is_recoverable_draft: boolean } };
  assert.equal(retriedJson.customer.sync_status, 'SYNCED');
  assert.equal(retriedJson.customer.is_recoverable_draft, false);
  assert.match(retriedJson.customer.myob_customer_id, /^MYOB-SBX-/);

  // 8. Uncertain write-through + reconcile
  const uncertainCreate = await call('solarcell', '', {
    method: 'POST',
    body: {
      name: 'Uncertain Draft Co',
      email: 'uncertain@example.invalid',
      phone: '0444 555 666',
      brand_affiliations: ['solarcell'],
      simulated_outcome: 'UNCERTAIN',
    },
  });
  assert.equal(uncertainCreate.status, 201);
  const uncertainJson = (await uncertainCreate.json()) as { customer: { id: string; sync_status: string } };
  assert.equal(uncertainJson.customer.sync_status, 'UNCERTAIN');

  const reconcileResp = await call('solarcell', `${uncertainJson.customer.id}/reconcile`, {
    method: 'POST',
    body: { confirm_synced: true },
  });
  assert.equal(reconcileResp.status, 200);
  const reconciledJson = (await reconcileResp.json()) as { customer: { sync_status: string; myob_customer_id: string; is_recoverable_draft: boolean } };
  assert.equal(reconciledJson.customer.sync_status, 'SYNCED');
  assert.equal(reconciledJson.customer.is_recoverable_draft, false);
  assert.match(reconciledJson.customer.myob_customer_id, /^MYOB-SBX-REC-/);
});
