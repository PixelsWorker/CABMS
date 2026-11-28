import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { initializePreOperationalDatabase } from './support/preOperationalMigrations.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function loadMigration(name: string): string {
  return readFileSync(path.resolve('migrations', name), 'utf8');
}

async function setupFullDatabase(): Promise<LocalD1Database> {
  const db = createLocalD1Database() as LocalD1Database;
  await initializePreOperationalDatabase(db);
  await installG01TestAuthFixtures(db);
  await db.exec(loadMigration('0014_c1_null_safe_guards.sql'));
  await db.exec(loadMigration('0015_persistent_job_compliance.sql'));
  await db.exec(loadMigration('0016_compliance_visit_events.sql'));
  await db.exec(loadMigration('0017_operational_job_details.sql'));
  return db;
}

test('REPRODUCTION F01: Adding a form drops existing catalog requirements (CO-379bfa600054)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create two published forms in catalog
  const schema = { sections: [{ title: 'Checks', fields: [{ key: 'f1', label: 'Field 1', type: 'TEXT', required: true }] }] };
  const form1Res = await req('form-definitions', staff, 'POST', { title: 'Form 1', code: 'FORM-001', description: 'Form 1 desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(form1Res.status, 201);
  const form1 = await form1Res.json() as { id: string; revision_id: string };
  await req(`form-definitions/${form1.id}/revisions/${form1.revision_id}/review`, staff, 'POST');
  await req(`form-definitions/${form1.id}/revisions/${form1.revision_id}/approve`, owner, 'POST');

  const form2Res = await req('form-definitions', staff, 'POST', { title: 'Form 2', code: 'FORM-002', description: 'Form 2 desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(form2Res.status, 201);
  const form2 = await form2Res.json() as { id: string; revision_id: string };
  await req(`form-definitions/${form2.id}/revisions/${form2.revision_id}/review`, staff, 'POST');
  await req(`form-definitions/${form2.id}/revisions/${form2.revision_id}/approve`, owner, 'POST');

  // Create initial policy with form1 required
  const pol1Res = await req('job-types/jt-solar-service/policies', staff, 'POST', {
    isDirectToInvoice: false,
    formsRequired: [],
    formRules: [{ form_revision_id: form1.revision_id, required: true }],
  });
  assert.equal(pol1Res.status, 201);
  const pol1 = await pol1Res.json() as { id: string };
  await req(`job-types/jt-solar-service/policies/${pol1.id}/review`, staff, 'POST');
  await req(`job-types/jt-solar-service/policies/${pol1.id}/approve`, owner, 'POST');

  // Verify policy 1 has form1 in policy_catalog_form_rules
  const rulesBefore = await db.prepare('SELECT form_revision_id, required FROM policy_catalog_form_rules WHERE policy_version_id=?').bind(pol1.id).all<{ form_revision_id: string; required: number }>();
  assert.equal(rulesBefore.results.length, 1);
  assert.equal(rulesBefore.results[0].form_revision_id, form1.revision_id);

  // Now simulate CatalogPolicyEditor additive behavior in current codebase:
  // It only sends the newly selected form (form2), and omits form1!
  const pol2Res = await req('job-types/jt-solar-service/policies', staff, 'POST', {
    isDirectToInvoice: false,
    formsRequired: [],
    formRules: [{ form_revision_id: form2.revision_id, required: true }], // Missing form1!
  });
  assert.equal(pol2Res.status, 201);
  const pol2 = await pol2Res.json() as { id: string };
  await req(`job-types/jt-solar-service/policies/${pol2.id}/review`, staff, 'POST');
  await req(`job-types/jt-solar-service/policies/${pol2.id}/approve`, owner, 'POST');

  // Verify that form1 was DROPPED from policy 2!
  const rulesAfter = await db.prepare('SELECT form_revision_id, required FROM policy_catalog_form_rules WHERE policy_version_id=?').bind(pol2.id).all<{ form_revision_id: string; required: number }>();
  assert.equal(rulesAfter.results.length, 1);
  assert.equal(rulesAfter.results[0].form_revision_id, form2.revision_id);
  // form1 requirement is completely lost in policy 2!
  assert.ok(!rulesAfter.results.some(r => r.form_revision_id === form1.revision_id));
});

test('REPRODUCTION F02: Republishing a legacy policy loses approved mappings (CO-a93aaa2cf2b6)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // jt-solar-install currently has pol-solar-install-v1 which requires JSA, ELECTRICAL, TCA2 (legacy)
  const schema = { sections: [{ title: 'Checks', fields: [{ key: 'step1', label: 'Step 1', type: 'TEXT', required: true }] }] };
  const formRes = await req('form-definitions', staff, 'POST', { title: 'Form All', code: 'FORM-LEGACY-ALL', description: 'Legacy map form', category: 'Safety', brand_id: 'solarcell', schema });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST');
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // Map ALL legacy rules for pol-solar-install-v1
  const rules = await db.prepare("SELECT id FROM job_type_required_forms WHERE policy_version_id='pol-solar-install-v1'").all<{ id: string }>();
  for (const r of rules.results) {
    await db.prepare("INSERT INTO compliance_legacy_mappings (legacy_rule_id, workspace_id, revision_id, approved_by, approved_at) VALUES (?, 'solarcell', ?, 'test_g01_usr_owner_admin', '2026-10-28T00:00:00.000Z')")
      .bind(r.id, form.revision_id).run();
  }

  // Creating a job now succeeds under pol-solar-install-v1
  const opId1 = 'op-job-1';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-1', 0, ?)").bind(opId1, '1'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, customer_name, site_address) VALUES('job-1', 'solarcell', 'jt-solar-install', 'pol-solar-install-v1', 'Install 1', ?, 'Customer A', '123 Site Rd')").bind(opId1),
  ]);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_jobs WHERE id='job-1'").first('n'), 1);

  // Now create a successor draft policy for jt-solar-install with formsRequired=['JSA']
  const draftRes = await req('job-types/jt-solar-install/policies', staff, 'POST', {
    isDirectToInvoice: false,
    formsRequired: ['JSA'],
  });
  assert.equal(draftRes.status, 201);
  const draft = await draftRes.json() as { id: string };
  await req(`job-types/jt-solar-install/policies/${draft.id}/review`, staff, 'POST');
  // In current code, approval succeeds without mapping or checking legacy rules!
  const approveRes = await req(`job-types/jt-solar-install/policies/${draft.id}/approve`, owner, 'POST');
  assert.equal(approveRes.status, 200);

  // Now attempt to create a job under the newly published policy
  const opId2 = 'op-job-2';
  // It fails with LEGACY_MAPPING_REQUIRED because the new rule has no entry in compliance_legacy_mappings!
  await assert.rejects(() => db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-2', 0, ?)").bind(opId2, '2'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, customer_name, site_address) VALUES('job-2', 'solarcell', 'jt-solar-install', ?, 'Install 2', ?, 'Customer B', '456 Site Rd')").bind(draft.id, opId2),
  ]), /LEGACY_MAPPING_REQUIRED/);
});

test('REPRODUCTION F03: Required autofill fields make jobs impossible to sign (CO-c8f4bdbb244e)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a form with a required READONLY_AUTOFILL field
  const schema = {
    sections: [{
      title: 'Customer Details',
      fields: [
        { key: 'cust_name', label: 'Customer Name', type: 'READONLY_AUTOFILL', required: true, autofill_source: 'customer.name' },
        { key: 'sign', label: 'Signature', type: 'SIGNATURE', required: true },
      ],
    }],
  };
  const formRes = await req('form-definitions', staff, 'POST', { title: 'Autofill Form', code: 'AUTO-001', description: 'Autofill form desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST');
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // Grant signing permission to owner
  await db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, 'test_g01_usr_owner_admin')").bind(form.revision_id).run();

  // Create policy requiring this form
  const polRes = await req('job-types/jt-solar-service/policies', staff, 'POST', {
    isDirectToInvoice: false,
    formsRequired: [],
    formRules: [{ form_revision_id: form.revision_id, required: true }],
  });
  assert.equal(polRes.status, 201);
  const pol = await polRes.json() as { id: string };
  await req(`job-types/jt-solar-service/policies/${pol.id}/review`, staff, 'POST');
  await req(`job-types/jt-solar-service/policies/${pol.id}/approve`, owner, 'POST');

  // Create job
  const opId = 'op-auto-job';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-auto', 0, ?)").bind(opId, '3'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, customer_name, site_address) VALUES('job-auto', 'solarcell', 'jt-solar-service', ?, 'Auto Job', ?, 'Acme Solar', '123 Test St')").bind(pol.id, opId),
  ]);

  const slot = `catalog:${(await db.prepare('SELECT id FROM policy_catalog_form_rules WHERE policy_version_id=?').bind(pol.id).first<{id:string}>())!.id}`;

  // Technician saves answers without providing cust_name (because it's readonly autofill)
  const saveRes = await req('compliance-jobs/job-auto', owner, 'PATCH', {
    occurrence_key: slot,
    expected_answer_version: 0,
    answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'save-key-1' });
  assert.equal(saveRes.status, 200);

  // Now attempt to sign!
  const signRes = await req(`compliance-jobs/job-auto/forms/${encodeURIComponent(slot)}/sign`, owner, 'POST', {
    expected_job_version: 1,
    answer_version: 1,
    intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: {},
  }, { 'Idempotency-Key': 'sign-key-1' });

  // Observed behavior in current codebase: signing fails with 409 because cust_name is required and was never resolved!
  assert.equal(signRes.status, 409);
  const signProblem = await signRes.json() as any;
  assert.ok(signProblem.blockers?.some((b: any) => b.field === 'cust_name' && b.code === 'ANSWER_INVALID'));
});

test('REPRODUCTION F04: Abandoned photo reservations block evidence uploads for the job (CO-734ecdc60fbf)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());

  // Insert a valid form definition and revision to satisfy foreign keys
  await db.batch([
    db.prepare("INSERT INTO form_definitions(id, workspace_id, brand_id, code, title, description, category, status, created_at, updated_at) VALUES('form-res', 'solarcell', 'solarcell', 'RES-001', 'Res Form', 'Desc', 'Custom', 'ACTIVE', '2026', '2026')"),
    db.prepare("INSERT INTO form_revisions(id, workspace_id, form_definition_id, version, status, created_at, updated_at) VALUES('rev-res', 'solarcell', 'form-res', 'v1.0', 'DRAFT', '2026', '2026')"),
    db.prepare("UPDATE form_revisions SET status='REVIEW' WHERE id='rev-res'"),
    db.prepare("UPDATE form_revisions SET status='PUBLISHED' WHERE id='rev-res'"),
    db.prepare("UPDATE form_definitions SET published_revision_id='rev-res' WHERE id='form-res'"),
  ]);

  // Create job
  const opId = 'op-res-job';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-res', 0, ?)").bind(opId, '4'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, customer_name, site_address) VALUES('job-res', 'solarcell', 'jt-solar-service', 'pol-solar-service-v1', 'Res Job', ?, 'Customer', 'Address')").bind(opId),
    db.prepare("INSERT INTO compliance_operations VALUES('op-req', 'solarcell', 'test_g01_usr_owner_admin', 'ADD', 'job-res', 1, ?)").bind('5'.repeat(64)),
    db.prepare("INSERT INTO compliance_requirements VALUES('solarcell', 'job-res', 'slot-1', 'rev-res', 'ADDITIONAL', 1, 'Test', 'op-req')"),
    db.prepare("INSERT INTO compliance_operations VALUES('op-ans-1', 'solarcell', 'test_g01_usr_owner_admin', 'SAVE', 'job-res', 1, ?)").bind('6'.repeat(64)),
    db.prepare("INSERT INTO compliance_answers VALUES('solarcell', 'job-res', 'slot-1', 1, '{}', 'op-ans-1')"),
  ]);

  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')").run();

  // Create 20 pending reservations on answer_version 1
  for (let i = 0; i < 20; i++) {
    await db.prepare("INSERT INTO compliance_uploads VALUES(?, 'solarcell', 'job-res', 'slot-1', 'test_g01_usr_owner_admin', 1, 1, 'image/jpeg', 100, ?)").bind(`upload-${i}`, 'a'.repeat(64)).run();
  }

  // Count is 20 unfinalized uploads
  const count = await db.prepare("SELECT count(*) as c FROM compliance_uploads u WHERE u.job_id='job-res' AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=u.id)").first<{c:number}>();
  assert.equal(count?.c, 20);

  // Now create answer version 2 (e.g. technician corrected answers)
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES('op-ans-2', 'solarcell', 'test_g01_usr_owner_admin', 'SAVE', 'job-res', 1, ?)").bind('7'.repeat(64)),
    db.prepare("INSERT INTO compliance_answers VALUES('solarcell', 'job-res', 'slot-1', 2, '{}', 'op-ans-2')"),
  ]);

  // Attempt to create a 21st reservation on answer_version 2:
  // In current code, this is rejected with EVIDENCE_INVALID because the trigger counts the 20 abandoned reservations from version 1!
  await assert.rejects(() => db.prepare("INSERT INTO compliance_uploads VALUES('upload-21', 'solarcell', 'job-res', 'slot-1', 'test_g01_usr_owner_admin', 1, 2, 'image/jpeg', 100, ?)").bind('b'.repeat(64)).run(), /EVIDENCE_INVALID/);
});

test('REPRODUCTION F05: Historical photos exhaust the quota needed to sign a correction (CO-f273cdd479ff)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());

  // Insert a valid form definition and revision to satisfy foreign keys
  await db.batch([
    db.prepare("INSERT INTO form_definitions(id, workspace_id, brand_id, code, title, description, category, status, created_at, updated_at) VALUES('form-quota', 'solarcell', 'solarcell', 'QUOTA-001', 'Quota Form', 'Desc', 'Custom', 'ACTIVE', '2026', '2026')"),
    db.prepare("INSERT INTO form_revisions(id, workspace_id, form_definition_id, version, status, created_at, updated_at) VALUES('rev-quota', 'solarcell', 'form-quota', 'v1.0', 'DRAFT', '2026', '2026')"),
    db.prepare("UPDATE form_revisions SET status='REVIEW' WHERE id='rev-quota'"),
    db.prepare("UPDATE form_revisions SET status='PUBLISHED' WHERE id='rev-quota'"),
    db.prepare("UPDATE form_definitions SET published_revision_id='rev-quota' WHERE id='form-quota'"),
  ]);

  // Create job
  const opId = 'op-quota-job';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-quota', 0, ?)").bind(opId, '8'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, customer_name, site_address) VALUES('job-quota', 'solarcell', 'jt-solar-service', 'pol-solar-service-v1', 'Quota Job', ?, 'Customer', 'Address')").bind(opId),
    db.prepare("INSERT INTO compliance_operations VALUES('op-req-q', 'solarcell', 'test_g01_usr_owner_admin', 'ADD', 'job-quota', 1, ?)").bind('9'.repeat(64)),
    db.prepare("INSERT INTO compliance_requirements VALUES('solarcell', 'job-quota', 'slot-1', 'rev-quota', 'ADDITIONAL', 1, 'Test', 'op-req-q')"),
    db.prepare("INSERT INTO compliance_operations VALUES('op-ans-q1', 'solarcell', 'test_g01_usr_owner_admin', 'SAVE', 'job-quota', 1, ?)").bind('a'.repeat(64)),
    db.prepare("INSERT INTO compliance_answers VALUES('solarcell', 'job-quota', 'slot-1', 1, '{}', 'op-ans-q1')"),
  ]);

  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')").run();

  // Insert 20 verified photos on answer_version 1 (hitting max_photos = 20)
  for (let i = 0; i < 20; i++) {
    const photoId = `photo-${i}`;
    await db.batch([
      db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'EVIDENCE', 'job-quota', 1, ?)").bind(photoId, 'b'.repeat(64)),
      db.prepare("INSERT INTO compliance_evidence VALUES(?, 'solarcell', 'job-quota', 'slot-1', 1, 100, ?, ?, ?)").bind(photoId, 'c'.repeat(64), `private/${photoId}`, photoId),
    ]);
  }

  // Job now has 20 photos in compliance_evidence
  assert.equal(await db.prepare("SELECT count(*) as c FROM compliance_evidence WHERE job_id='job-quota'").first('c'), 20);

  // Now create answer version 2 (correction)
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES('op-ans-q2', 'solarcell', 'test_g01_usr_owner_admin', 'SAVE', 'job-quota', 1, ?)").bind('d'.repeat(64)),
    db.prepare("INSERT INTO compliance_answers VALUES('solarcell', 'job-quota', 'slot-1', 2, '{}', 'op-ans-q2')"),
  ]);

  // Barrier 1: In current code, attempting to attach a new 21st photo to answer_version 2 FAILS with EVIDENCE_INVALID because total count >= 20!
  await assert.rejects(() => db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES('op-ev-new', 'solarcell', 'test_g01_usr_owner_admin', 'EVIDENCE', 'job-quota', 1, ?)").bind('e'.repeat(64)),
    db.prepare("INSERT INTO compliance_evidence VALUES('photo-new-21', 'solarcell', 'job-quota', 'slot-1', 2, 100, ?, 'private/photo-21', 'op-ev-new')").bind('c'.repeat(64)),
  ]), /EVIDENCE_INVALID/);

  // Barrier 2: Attempting to carry forward an existing photo (reusing storage_key) FAILS with HISTORY_IMMUTABLE due to compliance_evidence_no_replace trigger!
  await assert.rejects(() => db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES('op-ev-carry', 'solarcell', 'test_g01_usr_owner_admin', 'EVIDENCE', 'job-quota', 1, ?)").bind('f'.repeat(64)),
    db.prepare("INSERT INTO compliance_evidence VALUES('photo-carry', 'solarcell', 'job-quota', 'slot-1', 2, 100, ?, 'private/photo-0', 'op-ev-carry')").bind('c'.repeat(64)),
  ]), /HISTORY_IMMUTABLE/);
});

test('REPRODUCTION F06: Concurrent form draft edits silently overwrite each other (CO-b4bdd528c561)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, method = 'GET', body?: unknown) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${staff}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a draft form definition
  const schemaInitial = { sections: [{ title: 'Initial Section', fields: [{ key: 'f_init', label: 'Initial Field', type: 'TEXT', required: true }] }] };
  const formRes = await req('form-definitions', 'POST', { title: 'Draft Concurrency', code: 'CONC-001', description: 'Conc desc', category: 'Custom', brand_id: 'solarcell', schema: schemaInitial });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };

  // Session A loads the draft, Session B loads the draft
  // Session A edits and saves
  const schemaA = { sections: [{ title: 'Session A Title', fields: [{ key: 'f_a', label: 'Field A', type: 'TEXT', required: true }] }] };
  const resA = await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaA);
  assert.equal(resA.status, 200);

  // Session B (which still had the initial state) saves its changes without any expected version or conflict detection
  const schemaB = { sections: [{ title: 'Session B Title', fields: [{ key: 'f_b', label: 'Field B', type: 'TEXT', required: true }] }] };
  const resB = await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaB);
  // In the current code, this silently succeeds (200) and completely overwrites Session A's edits!
  assert.equal(resB.status, 200);

  // Inspect the stored fields: Session A's field f_a is GONE, only f_b exists!
  const fields = await db.prepare("SELECT field_key FROM form_fields WHERE section_id IN (SELECT id FROM form_sections WHERE revision_id=?)").bind(form.revision_id).all<{field_key:string}>();
  assert.deepEqual(fields.results.map(r => r.field_key), ['f_b']);
});

test('REPRODUCTION F07: Closing a job leaves its visits scheduled and frozen (CO-6edd88862a45)', async t => {
  t.skip('Baseline reproduction fixture; verified fixed in independent_review_remediation.test.ts');
  return;
  const db = await setupFullDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${owner}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a job and assign technician (test_g01_usr_technician)
  const opId = 'op-visit-job';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-visit', 0, ?)").bind(opId, 'f'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, assignee_id, customer_name, site_address) VALUES('job-visit', 'solarcell', 'jt-solar-service', 'pol-solar-service-v1', 'Visit Job', ?, 'test_g01_usr_technician', 'Customer', 'Address')").bind(opId),
  ]);

  // 2. Schedule a visit for tomorrow
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const visitPayload = {
    visit_id: 'visit-1',
    job_id: 'job-visit',
    technician_id: 'test_g01_usr_technician',
    starts_at: startsAt,
    duration_minutes: 60,
    status: 'SCHEDULED',
    reason: 'Initial inspection',
    version: 1,
  };
  const visitRes = await req('visits', 'POST', visitPayload, { 'Idempotency-Key': 'key-visit-1' });
  assert.equal(visitRes.status, 200);

  // 3. Cancel the job via ?operation=CANCEL
  const cancelRes = await req('compliance-jobs/job-visit?operation=CANCEL', 'POST', {}, {
    'If-Match': '"1"',
    'Idempotency-Key': 'cancel-key-1',
  });
  assert.equal(cancelRes.status, 200);

  // Check job status is CANCELLED
  const job = await db.prepare("SELECT status FROM compliance_jobs WHERE id='job-visit'").first<{status:string}>();
  assert.equal(job?.status, 'CANCELLED');

  // In current code: the visit remains SCHEDULED in compliance_visit_events!
  const latestVisit = await db.prepare("SELECT status FROM compliance_visit_events WHERE visit_id='visit-1' ORDER BY version DESC LIMIT 1").first<{status:string}>();
  assert.equal(latestVisit?.status, 'SCHEDULED'); // Still SCHEDULED!

  // And attempts to cancel or update the visit fail because visits.ts rejects closed jobs!
  const cancelVisitRes = await req('visits', 'POST', {
    ...visitPayload,
    status: 'CANCELLED',
    reason: 'Job was cancelled',
    version: 2,
  }, { 'Idempotency-Key': 'key-visit-2' });
  // Fails with 412 VERSION_CONFLICT / invalid state because compliance_jobs status is not OPEN!
  assert.equal(cancelVisitRes.status, 412);
});
