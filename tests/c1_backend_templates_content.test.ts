/**
 * CABMS C1 — Backend Persistence & API Integration Tests
 * Validates Worker endpoints, D1 database persistence, role gates, and SQLite immutability triggers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

test('C1 Backend: Job Types & Compliance Policies lifecycle against real disposable D1', async (t) => {
  const db = createLocalD1Database() as LocalD1Database;
  t.after(() => db.getSqliteHandle().close());

  await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);

  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const ownerToken = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const req = async (path: string, token: string, method = 'GET', body?: unknown) => {
    return worker.fetch(
      new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env
    );
  };

  // 1. List seeded job types
  const listRes = await req('job-types', staffToken);
  assert.equal(listRes.status, 200);
  const jobTypes = await listRes.json() as any[];
  assert.ok(jobTypes.length >= 3);
  const solarInstall = jobTypes.find(jt => jt.id === 'jt-solar-install');
  assert.ok(solarInstall);
  assert.deepEqual(solarInstall.forms_required, ['JSA', 'ELECTRICAL', 'TCA2']);

  // 2. Technician is forbidden from creating or modifying job types
  const techCreate = await req('job-types', techToken, 'POST', {
    name: 'Unauthorized Type',
    brandId: 'solarcell',
  });
  assert.equal(techCreate.status, 403);

  // 3. Office staff creates a new job type
  const createRes = await req('job-types', staffToken, 'POST', {
    name: 'Battery Backup Storage System',
    code: 'battery_backup_storage',
    description: 'High-voltage residential battery installation.',
    brandId: 'solarcell',
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL'],
    status: 'ACTIVE',
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as { id: string };
  assert.ok(created.id);

  // 4. Create new draft compliance policy
  const draftRes = await req(`job-types/${created.id}/policies`, staffToken, 'POST', {
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL', 'TCA2'],
  });
  assert.equal(draftRes.status, 201);
  const draftPolicy = await draftRes.json() as { id: string; version: string };
  assert.match(draftPolicy.version, /v.*-draft/);

  // 5. Submit policy draft for review
  const reviewRes = await req(`job-types/${created.id}/policies/${draftPolicy.id}/review`, staffToken, 'POST');
  assert.equal(reviewRes.status, 200);

  // 6. Role Gate: Office staff CANNOT approve policy (must return 403)
  const staffApproveRes = await req(`job-types/${created.id}/policies/${draftPolicy.id}/approve`, staffToken, 'POST');
  assert.equal(staffApproveRes.status, 403);

  // 7. Owner admin approves policy (200 OK)
  const ownerApproveRes = await req(`job-types/${created.id}/policies/${draftPolicy.id}/approve`, ownerToken, 'POST');
  assert.equal(ownerApproveRes.status, 200);

  // 8. Verify the policy is now PUBLISHED and forms updated
  const detailRes = await req(`job-types/${created.id}`, staffToken);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json() as any;
  assert.equal(detail.policy_status, 'PUBLISHED');

  // 9. Immutability Trigger: Attempting direct SQL update on published policy must be rejected by SQLite trigger
  await assert.rejects(
    () => db.exec(`UPDATE job_type_compliance_policies SET version = 'v99.0' WHERE id = '${draftPolicy.id}'`),
    /published compliance policies are immutable/
  );

  // 10. Archive and Restore
  const archiveRes = await req(`job-types/${created.id}`, staffToken, 'PATCH', { action: 'archive' });
  assert.equal(archiveRes.status, 200);

  const restoreRes = await req(`job-types/${created.id}`, staffToken, 'PATCH', { action: 'restore' });
  assert.equal(restoreRes.status, 200);
});

test('C1 Backend: Document Templates & Revisions lifecycle against real disposable D1', async (t) => {
  const db = createLocalD1Database() as LocalD1Database;
  t.after(() => db.getSqliteHandle().close());

  await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);

  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const ownerToken = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = async (path: string, token: string, method = 'GET', body?: unknown) => {
    return worker.fetch(
      new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      }),
      env
    );
  };

  // 1. List seeded templates
  const listRes = await req('templates', staffToken);
  assert.equal(listRes.status, 200);
  const templates = await listRes.json() as any[];
  assert.ok(templates.length >= 2);
  const quoteTerms = templates.find(t => t.id === 'tpl-solar-quote');
  assert.ok(quoteTerms);
  assert.equal(quoteTerms.revision_status, 'PUBLISHED');

  // 2. Create new template
  const createRes = await req('templates', staffToken, 'POST', {
    name: 'Battery Warranty & Maintenance Agreement',
    templateType: 'QUOTE_TERMS',
    content: '10-year full replacement warranty on lithium battery cells.',
    description: 'Warranty terms for commercial energy storage.',
    status: 'ACTIVE',
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as { id: string };

  // 3. Create draft revision
  const draftRevRes = await req(`templates/${created.id}/revisions`, staffToken, 'POST', {
    content: 'Updated: 15-year battery warranty with complimentary annual health inspection.',
  });
  assert.equal(draftRevRes.status, 201);
  const draftRev = await draftRevRes.json() as { id: string; version: string };
  assert.match(draftRev.version, /v.*-draft/);

  // 4. Submit revision for review
  const reviewRes = await req(`templates/${created.id}/revisions/${draftRev.id}/review`, staffToken, 'POST');
  assert.equal(reviewRes.status, 200);

  // 5. Office staff approval fails closed (403)
  const staffApprove = await req(`templates/${created.id}/revisions/${draftRev.id}/approve`, staffToken, 'POST');
  assert.equal(staffApprove.status, 403);

  // 6. Owner admin approval succeeds (200)
  const ownerApprove = await req(`templates/${created.id}/revisions/${draftRev.id}/approve`, ownerToken, 'POST');
  assert.equal(ownerApprove.status, 200);

  // 7. Immutability Trigger: Direct SQL edit to published revision content fails
  await assert.rejects(
    () => db.exec(`UPDATE template_revisions SET content = 'Tampered content' WHERE id = '${draftRev.id}'`),
    /published template revisions are immutable/
  );
});
