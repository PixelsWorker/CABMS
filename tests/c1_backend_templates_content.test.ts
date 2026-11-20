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

  // 3. Office staff creates a new job type (always starts as DRAFT regardless of caller input)
  const createRes = await req('job-types', staffToken, 'POST', {
    name: 'Battery Backup Storage System',
    code: 'battery_backup_storage',
    description: 'High-voltage residential battery installation.',
    brandId: 'solarcell',
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL'],
    status: 'ACTIVE', // Requesting ACTIVE must be ignored; starts as DRAFT
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as { id: string; policyId: string };
  assert.ok(created.id);
  assert.ok(created.policyId);

  // 4. Verify initial state is DRAFT for both job type and policy
  const initialGet = await req(`job-types/${created.id}`, staffToken);
  assert.equal(initialGet.status, 200);
  const initialData = await initialGet.json() as any;
  assert.equal(initialData.status, 'DRAFT', 'Job type must start in DRAFT');
  assert.equal(initialData.policy_status, 'DRAFT', 'Policy must start in DRAFT');

  // 5. Premature Activation Guard: Restoring draft item to ACTIVE fails because policy is not PUBLISHED
  const prematureRestore = await req(`job-types/${created.id}`, staffToken, 'PATCH', { action: 'restore' });
  assert.equal(prematureRestore.status, 400);
  const prematureRestoreProb = await prematureRestore.json() as any;
  assert.equal(prematureRestoreProb.code, 'ACTIVATION_FAILED');

  // 6. Approval Bypass Guard: Approving a policy directly from DRAFT must fail (must be in REVIEW first)
  const prematureApprove = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, ownerToken, 'POST');
  assert.equal(prematureApprove.status, 400);
  const prematureApproveProb = await prematureApprove.json() as any;
  assert.equal(prematureApproveProb.code, 'APPROVAL_FAILED');

  // 7. Submit policy draft for review
  const reviewRes = await req(`job-types/${created.id}/policies/${created.policyId}/review`, staffToken, 'POST');
  assert.equal(reviewRes.status, 200);

  // 8. Negative Authorization: Office staff CANNOT approve policy (must return 403)
  const staffApproveRes = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, staffToken, 'POST');
  assert.equal(staffApproveRes.status, 403);

  // 9. Owner admin approves policy (200 OK) -> publishes policy and activates parent job type
  const ownerApproveRes = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, ownerToken, 'POST');
  assert.equal(ownerApproveRes.status, 200);

  // 10. Verify the policy is now PUBLISHED and job type is now ACTIVE
  const detailRes = await req(`job-types/${created.id}`, staffToken);
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json() as any;
  assert.equal(detail.status, 'ACTIVE', 'Job type automatically activated upon policy approval');
  assert.equal(detail.policy_status, 'PUBLISHED', 'Policy status is now PUBLISHED');

  // 11. Immutability Trigger: Attempting direct SQL update on published policy must be rejected by SQLite trigger
  await assert.rejects(
    () => db.exec(`UPDATE job_type_compliance_policies SET version = 'v99.0' WHERE id = '${created.policyId}'`),
    /published compliance policies are immutable/
  );

  // 12. Archive and Restore: Now permitted because current policy is PUBLISHED
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

  // 2. Create new template (starts in DRAFT regardless of caller input)
  const createRes = await req('templates', staffToken, 'POST', {
    name: 'Battery Warranty & Maintenance Agreement',
    templateType: 'QUOTE_TERMS',
    content: '10-year full replacement warranty on lithium battery cells.',
    description: 'Warranty terms for commercial energy storage.',
    status: 'ACTIVE',
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json() as { id: string; revisionId: string };
  assert.ok(created.id);
  assert.ok(created.revisionId);

  // Verify initial state is DRAFT
  const tplGet = await req(`templates/${created.id}`, staffToken);
  assert.equal(tplGet.status, 200);
  const tplData = await tplGet.json() as any;
  assert.equal(tplData.status, 'DRAFT');
  assert.equal(tplData.revision_status, 'DRAFT');

  // Premature Activation Guard: Cannot restore/activate template without published revision
  const prematureTplRestore = await req(`templates/${created.id}`, staffToken, 'PATCH', { action: 'restore' });
  assert.equal(prematureTplRestore.status, 400);
  const prematureTplProb = await prematureTplRestore.json() as any;
  assert.equal(prematureTplProb.code, 'ACTIVATION_FAILED');

  // Approval Bypass Guard: Approving revision directly from DRAFT must fail
  const prematureRevApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, ownerToken, 'POST');
  assert.equal(prematureRevApprove.status, 400);
  const prematureRevProb = await prematureRevApprove.json() as any;
  assert.equal(prematureRevProb.code, 'APPROVAL_FAILED');

  // 3. Submit revision for review
  const reviewRes = await req(`templates/${created.id}/revisions/${created.revisionId}/review`, staffToken, 'POST');
  assert.equal(reviewRes.status, 200);

  // 4. Office staff approval fails closed (403)
  const staffApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, staffToken, 'POST');
  assert.equal(staffApprove.status, 403);

  // 5. Owner admin approval succeeds (200) -> publishes revision and activates parent template
  const ownerApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, ownerToken, 'POST');
  assert.equal(ownerApprove.status, 200);

  const tplDetail = await req(`templates/${created.id}`, staffToken);
  assert.equal(tplDetail.status, 200);
  const tplDetailData = await tplDetail.json() as any;
  assert.equal(tplDetailData.status, 'ACTIVE', 'Template activated upon revision approval');
  assert.equal(tplDetailData.revision_status, 'PUBLISHED', 'Revision status is now PUBLISHED');

  // 6. Immutability Trigger: Direct SQL edit to published revision content fails
  await assert.rejects(
    () => db.exec(`UPDATE template_revisions SET content = 'Tampered content' WHERE id = '${created.revisionId}'`),
    /published template revisions are immutable/
  );
});
