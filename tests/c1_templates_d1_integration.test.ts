import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

test('C1 D1 & Worker Integration: Job Types, Policies, Templates, and Immutability Triggers', async t => {
  const db = createLocalD1Database() as LocalD1Database;
  t.after(() => db.getSqliteHandle().close());

  // Run all migrations including 0012_templates_and_content.sql
  await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);

  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const adminToken = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const call = (path: string, method = 'GET', body?: unknown, token = staffToken) =>
    worker.fetch(
      new Request(`http://local/api/v1/workspaces/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      env
    );

  // 1. Unauthenticated request rejected (401)
  assert.equal((await call('solarcell/job-types', 'GET', undefined, 'invalid-token')).status, 401);

  // 2. Cross-workspace isolation: user only permitted for solarcell denied on cctv (403)
  assert.equal((await call('cctv/job-types')).status, 403);

  // 3. Technician rejected from creating or modifying job types (403)
  assert.equal(
    (
      await call(
        'solarcell/job-types',
        'POST',
        { name: 'Unauthorized Technician Job Type', brandId: 'solarcell' },
        techToken
      )
    ).status,
    403
  );

  // 4. Office Staff lists seeded job types for solarcell
  const initialListRes = await call('solarcell/job-types');
  assert.equal(initialListRes.status, 200);
  const initialJobTypes = (await initialListRes.json()) as Array<{
    id: string;
    name: string;
    brand_id: string;
    forms_required?: string[];
  }>;
  assert.ok(initialJobTypes.length >= 3);
  assert.ok(initialJobTypes.some(jt => jt.name.includes('Commercial Solar PV')));

  // 5. Office Staff creates a new job type
  const createRes = await call('solarcell/job-types', 'POST', {
    name: 'Residential EV Charger Installation',
    code: 'residential_ev_charger',
    brandId: 'solarcell',
    description: 'Level 2 EV fast charger installation with electrical certificate',
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL'],
    status: 'ACTIVE',
  });
  assert.equal(createRes.status, 201);
  const { id: newJtId } = (await createRes.json()) as { id: string };
  assert.ok(newJtId);

  // Verify created job type
  const getNewRes = await call(`solarcell/job-types/${newJtId}`);
  assert.equal(getNewRes.status, 200);
  const newJt = (await getNewRes.json()) as {
    id: string;
    name: string;
    brand_id: string;
    policies: Array<{ id: string; version: string; status: string; formsRequired: string[] }>;
  };
  assert.equal(newJt.name, 'Residential EV Charger Installation');
  assert.equal(newJt.policies[0].status, 'PUBLISHED');
  assert.deepEqual(newJt.policies[0].formsRequired, ['JSA', 'ELECTRICAL']);
  const initialPolicyId = newJt.policies[0].id;

  // 6. Immutability Trigger in D1: Attempting to UPDATE or DELETE a PUBLISHED policy fails loudly
  await assert.rejects(
    async () => {
      await db.prepare("UPDATE job_type_compliance_policies SET version = 'v9.9' WHERE id = ?").bind(initialPolicyId).run();
    },
    /published compliance policies are immutable/
  );

  await assert.rejects(
    async () => {
      await db.prepare('DELETE FROM job_type_compliance_policies WHERE id = ?').bind(initialPolicyId).run();
    },
    /published compliance policies cannot be deleted/
  );

  // 7. Policy draft lifecycle: Create draft policy version
  const draftRes = await call(`solarcell/job-types/${newJtId}/policies`, 'POST', {
    isDirectToInvoice: false,
    formsRequired: ['JSA', 'ELECTRICAL', 'TCA2'],
  });
  assert.equal(draftRes.status, 201);
  const { id: draftPolicyId, version: draftVersion } = (await draftRes.json()) as { id: string; version: string };
  assert.ok(draftVersion.includes('-draft'));

  // 8. Submit policy for review
  const submitReviewRes = await call(`solarcell/job-types/${newJtId}/policies/${draftPolicyId}/review`, 'POST');
  assert.equal(submitReviewRes.status, 200);

  // 9. Office Staff denied from approving policy (403)
  const staffApproveRes = await call(`solarcell/job-types/${newJtId}/policies/${draftPolicyId}/approve`, 'POST');
  assert.equal(staffApproveRes.status, 403);

  // 10. Owner Admin approves policy (200)
  const adminApproveRes = await call(
    `solarcell/job-types/${newJtId}/policies/${draftPolicyId}/approve`,
    'POST',
    undefined,
    adminToken
  );
  assert.equal(adminApproveRes.status, 200);

  // Verify approved policy is now PUBLISHED and draft suffix stripped
  const refreshedJt = (await (await call(`solarcell/job-types/${newJtId}`)).json()) as {
    version: string;
    policy_status: string;
    policies: Array<{ id: string; version: string; status: string }>;
  };
  assert.equal(refreshedJt.policy_status, 'PUBLISHED');
  assert.ok(!refreshedJt.version.includes('-draft'));

  // 11. Archive and restore job type
  assert.equal((await call(`solarcell/job-types/${newJtId}`, 'PATCH', { action: 'archive' })).status, 200);
  const archived = (await (await call(`solarcell/job-types/${newJtId}`)).json()) as { status: string };
  assert.equal(archived.status, 'ARCHIVED');

  assert.equal((await call(`solarcell/job-types/${newJtId}`, 'PATCH', { action: 'restore' })).status, 200);
  const restored = (await (await call(`solarcell/job-types/${newJtId}`)).json()) as { status: string };
  assert.equal(restored.status, 'ACTIVE');

  // 12. Deleting an ACTIVE or ARCHIVED job type fails (400)
  assert.equal((await call(`solarcell/job-types/${newJtId}`, 'DELETE')).status, 400);

  // 13. Create a DRAFT job type and delete it (200)
  const draftJtRes = await call('solarcell/job-types', 'POST', {
    name: 'Temporary Rooftop Survey',
    brandId: 'solarcell',
    status: 'DRAFT',
  });
  assert.equal(draftJtRes.status, 201);
  const { id: draftJtId } = (await draftJtRes.json()) as { id: string };

  const deleteDraftRes = await call(`solarcell/job-types/${draftJtId}`, 'DELETE');
  assert.equal(deleteDraftRes.status, 200);
  assert.equal((await call(`solarcell/job-types/${draftJtId}`)).status, 404);

  // -------------------------------------------------------------------------
  // Document Templates Integration
  // -------------------------------------------------------------------------

  // 14. List templates
  const listTemplatesRes = await call('solarcell/templates');
  assert.equal(listTemplatesRes.status, 200);
  const templates = (await listTemplatesRes.json()) as Array<{ id: string; name: string }>;
  assert.ok(templates.length >= 2);

  // 15. Create new template
  const createTplRes = await call('solarcell/templates', 'POST', {
    name: 'Commercial Solar Micro-Inverter Warranty Clause',
    templateType: 'QUOTE_TERMS',
    content: 'Standard 25-year micro-inverter limited warranty clauses.',
    status: 'ACTIVE',
  });
  assert.equal(createTplRes.status, 201);
  const { id: newTplId } = (await createTplRes.json()) as { id: string };

  // 16. Create revision draft
  const revDraftRes = await call(`solarcell/templates/${newTplId}/revisions`, 'POST', {
    content: 'Updated 25-year micro-inverter limited warranty clauses with surge protection included.',
  });
  assert.equal(revDraftRes.status, 201);
  const { id: draftRevId } = (await revDraftRes.json()) as { id: string };

  // 17. Submit revision for review
  assert.equal((await call(`solarcell/templates/${newTplId}/revisions/${draftRevId}/review`, 'POST')).status, 200);

  // 18. Office Staff denied from approving revision (403)
  assert.equal((await call(`solarcell/templates/${newTplId}/revisions/${draftRevId}/approve`, 'POST')).status, 403);

  // 19. Owner Admin approves revision (200)
  assert.equal(
    (await call(`solarcell/templates/${newTplId}/revisions/${draftRevId}/approve`, 'POST', undefined, adminToken)).status,
    200
  );

  // 20. Immutability trigger in D1 for published template revision
  await assert.rejects(
    async () => {
      await db.prepare("UPDATE template_revisions SET content = 'Malicious change' WHERE id = ?").bind(draftRevId).run();
    },
    /published template revisions are immutable/
  );

  await assert.rejects(
    async () => {
      await db.prepare('DELETE FROM template_revisions WHERE id = ?').bind(draftRevId).run();
    },
    /published template revisions cannot be deleted/
  );
});
