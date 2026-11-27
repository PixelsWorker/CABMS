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

import { fileURLToPath } from 'node:url';

const worktreeRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..');

function loadMigration(name: string): string {
  return readFileSync(path.resolve(worktreeRoot, 'migrations', name), 'utf8');
}

async function setupRemediatedDatabase(): Promise<LocalD1Database> {
  const db = createLocalD1Database() as LocalD1Database;
  await initializePreOperationalDatabase(db);
  await installG01TestAuthFixtures(db);
  await db.exec(loadMigration('0014_c1_null_safe_guards.sql'));
  await db.exec(loadMigration('0015_persistent_job_compliance.sql'));
  await db.exec(loadMigration('0016_compliance_visit_events.sql'));
  await db.exec(loadMigration('0017_operational_job_details.sql'));
  await db.exec(readFileSync(path.resolve(worktreeRoot, 'proposals', '0018_independent_review_remediation_candidate.sql'), 'utf8'));
  return db;
}

test('VERIFICATION F01: Adding a form preserves existing catalog requirements (CO-379bfa600054)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  const submitReview = async (formId: string, revisionId: string) => {
    const d = await (await req(`form-definitions/${formId}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
    const updatedAt = d.revisions.find(r => r.id === revisionId)!.updated_at;
    return req(`form-definitions/${formId}/revisions/${revisionId}/review`, staff, 'POST', { expected_updated_at: updatedAt });
  };

  // 1. Create two published forms in catalog
  const schema = { sections: [{ title: 'Checks', fields: [{ key: 'f1', label: 'Field 1', type: 'TEXT', required: true }] }] };
  const form1Res = await req('form-definitions', staff, 'POST', { title: 'Form 1', code: 'FORM-001', description: 'Form 1 desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(form1Res.status, 201);
  const form1 = await form1Res.json() as { id: string; revision_id: string };
  assert.equal((await submitReview(form1.id, form1.revision_id)).status, 200);
  await req(`form-definitions/${form1.id}/revisions/${form1.revision_id}/approve`, owner, 'POST');

  const form2Res = await req('form-definitions', staff, 'POST', { title: 'Form 2', code: 'FORM-002', description: 'Form 2 desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(form2Res.status, 201);
  const form2 = await form2Res.json() as { id: string; revision_id: string };
  assert.equal((await submitReview(form2.id, form2.revision_id)).status, 200);
  await req(`form-definitions/${form2.id}/revisions/${form2.revision_id}/approve`, owner, 'POST');

  // 2. Publish initial policy with Form 1 mandatory and empty legacy requirements
  const initialDraftRes = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    formsRequired: [],
    formRules: [{ form_revision_id: form1.revision_id, required: true, display_order: 1 }],
  });
  assert.equal(initialDraftRes.status, 201);
  const initialPolicy = await initialDraftRes.json() as { id: string };
  await req(`job-types/jt-solar-install/policies/${initialPolicy.id}/review`, owner, 'POST');
  const initApprove = await req(`job-types/jt-solar-install/policies/${initialPolicy.id}/approve`, owner, 'POST');
  assert.equal(initApprove.status, 200);

  // 3. Edit policy, adding Form 2 as optional while specifying base_policy_id and preserving Form 1
  const successorDraftRes = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    base_policy_id: initialPolicy.id,
    formRules: [
      { form_revision_id: form1.revision_id, required: true, display_order: 1 },
      { form_revision_id: form2.revision_id, required: false, display_order: 2 },
    ],
  });
  assert.equal(successorDraftRes.status, 201);
  const successorPolicy = await successorDraftRes.json() as { id: string };
  await req(`job-types/jt-solar-install/policies/${successorPolicy.id}/review`, owner, 'POST');
  const approveRes = await req(`job-types/jt-solar-install/policies/${successorPolicy.id}/approve`, owner, 'POST');
  if (approveRes.status !== 200) console.log('F01 successor approveRes error:', approveRes.status, await approveRes.text());
  assert.equal(approveRes.status, 200);

  // 4. Create a new job under the successor policy
  const createJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Verification Job F01',
    job_type_id: 'jt-solar-install',
    expected_policy_id: successorPolicy.id,
    customer_name: 'Test Customer',
    site_address: '123 Test St',
  }, { 'Idempotency-Key': 'job-f01-key' });
  assert.equal(createJobRes.status, 201);
  const jobData = await createJobRes.json() as { job_id: string };

  const jobDetailRes = await req(`compliance-jobs/${jobData.job_id}`, staff, 'GET');
  assert.equal(jobDetailRes.status, 200);
  const jobDetail = await jobDetailRes.json() as { requirements: Array<{ revision_id: string; required: number }> };

  // Verify Form 1 is present and required
  const req1 = jobDetail.requirements.find(r => r.revision_id === form1.revision_id);
  assert.ok(req1, 'Form 1 rule must be preserved in successor policy');
  assert.equal(req1.required, 1, 'Form 1 must retain mandatory status');

  // Verify Form 2 is present and optional
  const req2 = jobDetail.requirements.find(r => r.revision_id === form2.revision_id);
  assert.ok(req2, 'Form 2 rule must be present');
  assert.equal(req2.required, 0, 'Form 2 must be optional');
});

test('VERIFICATION F02: Republishing a legacy policy carries forward approved mappings (CO-a93aaa2cf2b6)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a published form in catalog
  const schema = { sections: [{ title: 'Checks', fields: [{ key: 'f1', label: 'Field 1', type: 'TEXT', required: true }] }] };
  const formRes = await req('form-definitions', staff, 'POST', { title: 'Catalog Form for Mapping', code: 'MAP-001', description: 'Desc', category: 'Custom', brand_id: 'solarcell', schema });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // 2. Fetch the active legacy policy rules for jt-solar-install and map them
  const legacyRules = await db.prepare("SELECT id, form_type FROM job_type_required_forms WHERE policy_version_id='pol-solar-install-v1' AND required=1").all<{id:string;form_type:string}>();
  for (const rule of legacyRules.results) {
    await db.prepare("INSERT OR REPLACE INTO compliance_legacy_mappings VALUES(?, 'solarcell', ?, 'test_g01_usr_owner_admin', '2026-10-28T00:00:00.000Z')")
      .bind(rule.id, form.revision_id).run();
  }

  // 3. Create a successor draft
  const successorRes = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    base_policy_id: 'pol-solar-install-v1',
  });
  assert.equal(successorRes.status, 201);
  const successor = await successorRes.json() as { id: string };

  // Submit and approve successor
  await req(`job-types/jt-solar-install/policies/${successor.id}/review`, owner, 'POST');
  const approveRes = await req(`job-types/jt-solar-install/policies/${successor.id}/approve`, owner, 'POST');
  if (approveRes.status !== 200) console.log('F02 successor approveRes error:', approveRes.status, await approveRes.text());
  assert.equal(approveRes.status, 200);

  // 4. Create a job under the successor policy - MUST SUCCEED without LEGACY_MAPPING_REQUIRED
  const createJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Successor Mapped Job',
    job_type_id: 'jt-solar-install',
    expected_policy_id: successor.id,
    customer_name: 'Test Customer',
    site_address: '123 Test St',
  }, { 'Idempotency-Key': 'job-f02-remediated-key' });
  assert.equal(createJobRes.status, 201);
});

test('VERIFICATION F03: Required autofill fields are populated and signed with 200 (CO-c8f4bdbb244e)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a form with required READONLY_AUTOFILL field
  const schemaWithAutofill = {
    sections: [{
      title: 'Customer Details',
      fields: [
        { key: 'cust_name', label: 'Customer Name', type: 'READONLY_AUTOFILL', required: true, autofill_source: 'customer.name' },
        { key: 'notes', label: 'Technician Notes', type: 'TEXT', required: true },
      ],
    }],
  };
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Autofill Form',
    code: 'AUTO-001',
    description: 'Autofill desc',
    category: 'Custom',
    brand_id: 'solarcell',
    schema: schemaWithAutofill,
  });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // 2. Create job with customer_name
  const createJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Job with Autofill Form',
    job_type_id: 'jt-solar-service',
    expected_policy_id: 'pol-solar-service-v1',
    customer_name: 'Jane Doe Customer',
    site_address: '456 Solar Way',
  }, { 'Idempotency-Key': 'job-f03-key' });
  assert.equal(createJobRes.status, 201);
  if (createJobRes.status !== 201) console.log('F05 createJobRes error:', createJobRes.status, await createJobRes.text());
  const { job_id: jobId } = await createJobRes.json() as { job_id: string };

  // Add the form occurrence to the job
  const addRes = await req(`compliance-jobs/${jobId}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-autofill',
    revision_id: form.revision_id,
    required: true,
    reason: 'Autofill compliance verification',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-add-autofill' });
  if (addRes.status !== 200) console.log('F03 addRes error:', addRes.status, await addRes.text());
  assert.equal(addRes.status, 200);

  // 3. Save answers
  const saveRes = await req(`compliance-jobs/${jobId}`, staff, 'PATCH', {
    occurrence_key: 'slot-autofill',
    expected_answer_version: 0,
    answers: { notes: 'Work completed as expected.' },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-save-autofill' });
  if (saveRes.status !== 200) console.log('F03 saveRes error:', saveRes.status, await saveRes.text());
  assert.equal(saveRes.status, 200);

  // 4. Grant signer privilege to office staff
  await db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, ?)")
    .bind(form.revision_id, G01_TEST_AUTH.officeStaff.userId).run();

  // 5. Sign the form occurrence - MUST SUCCEED WITH 200
  const signRes = await req(`compliance-jobs/${jobId}/forms/slot-autofill/sign`, staff, 'POST', {
    expected_job_version: 1,
    answer_version: 1,
    intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: {},
  }, { 'Idempotency-Key': 'op-sign-autofill' });
  if (signRes.status !== 200) console.log('F03 signRes error:', signRes.status, await signRes.text());
  assert.equal(signRes.status, 200);
});

test('VERIFICATION F04: Stale upload reservations are reclaimed and replacement technician can upload (CO-734ecdc60fbf)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const tech = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a published form with photo field
  const schemaWithPhoto = {
    sections: [{
      title: 'Evidence Section',
      fields: [{ key: 'photo1', label: 'Panel Photo', type: 'PHOTO', required: true }],
    }],
  };
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Photo Form',
    code: 'PHOTO-001',
    description: 'Photo form',
    category: 'Custom',
    brand_id: 'solarcell',
    schema: schemaWithPhoto,
  });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // 2. Create job assigned to technician
  const createJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Photo Capacity Job',
    job_type_id: 'jt-solar-service',
    expected_policy_id: 'pol-solar-service-v1',
    assignee_id: G01_TEST_AUTH.technician.userId,
    customer_name: 'Customer Photo',
    site_address: '789 Photo Ave',
  }, { 'Idempotency-Key': 'job-f04-key' });
  assert.equal(createJobRes.status, 201);
  if (createJobRes.status !== 201) console.log('F05 createJobRes error:', createJobRes.status, await createJobRes.text());
  const { job_id: jobId } = await createJobRes.json() as { job_id: string };

  // Add form occurrence
  await req(`compliance-jobs/${jobId}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-photo',
    revision_id: form.revision_id,
    required: true,
    reason: 'Photo test',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-add-photo' });

  // Save answer version 1
  const saveV1 = await req(`compliance-jobs/${jobId}`, tech, 'PATCH', {
    occurrence_key: 'slot-photo',
    expected_answer_version: 0,
    answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-save-photo-v1' });
  assert.equal(saveV1.status, 200);

  // Set workspace photo limits
  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')").run();

  // Create 20 pending reservations on answer_version 1
  for (let i = 0; i < 20; i++) {
    await db.prepare("INSERT INTO compliance_uploads VALUES(?, 'solarcell', ?, 'slot-photo', ?, 2, 1, 'image/jpeg', 100, ?)").bind(`stale-up-${i}`, jobId, G01_TEST_AUTH.technician.userId, 'a'.repeat(64)).run();
  }

  // Verify there are 20 unfinalized uploads
  const countBefore = await db.prepare("SELECT count(*) as c FROM compliance_uploads WHERE job_id=? AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=compliance_uploads.id)").bind(jobId).first<{c:number}>();
  assert.equal(countBefore?.c, 20);

  // Advance to answer version 2 (technician corrects answers)
  const saveV2 = await req(`compliance-jobs/${jobId}`, tech, 'PATCH', {
    occurrence_key: 'slot-photo',
    expected_answer_version: 1,
    answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-save-photo-v2' });
  assert.equal(saveV2.status, 200);

  // Under proposal 0018, uploading a reservation for answer_version 2 SUCCEEDS because trigger scopes count to answer_version
  const uploadV2Id = crypto.randomUUID();
  await db.prepare("INSERT INTO compliance_uploads VALUES(?, 'solarcell', ?, 'slot-photo', ?, 1, 2, 'image/jpeg', 100, ?)").bind(uploadV2Id, jobId, G01_TEST_AUTH.technician.userId, 'b'.repeat(64)).run();

  // Verify deletion by office staff of an unfinalized upload succeeds
  const deleteRes = await req(`compliance-jobs/${jobId}/forms/slot-photo/evidence/${uploadV2Id}`, staff, 'DELETE');
  assert.equal(deleteRes.status, 204);
});

test('VERIFICATION F05: Verified evidence carry-forward allows signing corrections without quota exhaustion (CO-f273cdd479ff)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64');
  const pngSha = await crypto.subtle.digest('SHA-256', png).then(b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''));
  const r2Storage = new Map<string, Uint8Array>();
  const privateEvidence = {
    get: async (key: string) => {
      const b = r2Storage.get(key);
      if (!b) return null;
      return { size: b.byteLength, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
    },
    put: async (key: string, body: any) => {
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
      r2Storage.set(key, bytes);
    },
    delete: async (key: string) => { r2Storage.delete(key); },
  };
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test', PRIVATE_EVIDENCE: privateEvidence as any };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create form with required photo
  const schemaWithPhoto = {
    sections: [{
      title: 'Panel Section',
      fields: [
        { key: 'panel_photo', label: 'Panel Photo', type: 'PHOTO', required: true },
        { key: 'serial', label: 'Serial Number', type: 'TEXT', required: true },
      ],
    }],
  };
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Panel Form',
    code: 'PANEL-001',
    description: 'Panel desc',
    category: 'Custom',
    brand_id: 'solarcell',
    schema: schemaWithPhoto,
  });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // 2. Create job
  const createJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Job Quota Carry Forward',
    job_type_id: 'jt-solar-service',
    expected_policy_id: 'pol-solar-service-v1',
    customer_name: 'Customer Quota',
    site_address: '100 Quota Rd',
  }, { 'Idempotency-Key': 'job-f05-key' });
  assert.equal(createJobRes.status, 201);
  if (createJobRes.status !== 201) console.log('F05 createJobRes error:', createJobRes.status, await createJobRes.text());
  const { job_id: jobId } = await createJobRes.json() as { job_id: string };

  await req(`compliance-jobs/${jobId}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-panel',
    revision_id: form.revision_id,
    required: true,
    reason: 'Panel test',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-add-panel' });

  const saveV1 = await req(`compliance-jobs/${jobId}`, staff, 'PATCH', {
    occurrence_key: 'slot-panel',
    expected_answer_version: 0,
    answers: { serial: 'SN-001' },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-save-panel-v1' });
  assert.equal(saveV1.status, 200);

  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')").run();

  // Populate 20 photos for the job in version 1
  for (let i = 0; i < 20; i++) {
    const photoId = `panel-photo-${i}`;
    r2Storage.set(`private/${photoId}`, png);
    await db.batch([
      db.prepare("INSERT INTO compliance_uploads VALUES(?, 'solarcell', ?, 'slot-panel', ?, 1, 1, 'image/png', ?, ?)").bind(photoId, jobId, G01_TEST_AUTH.officeStaff.userId, png.length, pngSha),
      db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', ?, 'EVIDENCE', ?, 1, ?)").bind(photoId, G01_TEST_AUTH.officeStaff.userId, jobId, pngSha),
      db.prepare("INSERT INTO compliance_evidence VALUES(?, 'solarcell', ?, 'slot-panel', 1, ?, ?, ?, ?)").bind(photoId, jobId, png.length, pngSha, `private/${photoId}`, photoId),
    ]);
  }

  // Grant sign rights
  await db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, ?)")
    .bind(form.revision_id, G01_TEST_AUTH.officeStaff.userId).run();

  // Sign version 1
  const signV1Res = await req(`compliance-jobs/${jobId}/forms/slot-panel/sign`, staff, 'POST', {
    expected_job_version: 1,
    answer_version: 1,
    intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: { panel_photo: ['panel-photo-0'] },
  }, { 'Idempotency-Key': 'op-sign-panel-v1' });
  assert.equal(signV1Res.status, 200);

  // 3. Start a correction: save answer version 2 with updated serial
  const saveV2Res = await req(`compliance-jobs/${jobId}`, staff, 'PATCH', {
    occurrence_key: 'slot-panel',
    expected_answer_version: 1,
    answers: { serial: 'SN-002-CORRECTED' },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'op-save-panel-v2' });
  assert.equal(saveV2Res.status, 200);

  // Fetch job detail - verify photos carried forward into answer version 2!
  const detailRes = await req(`compliance-jobs/${jobId}`, staff, 'GET');
  assert.equal(detailRes.status, 200);
  const detail = await detailRes.json() as { requirements: Array<{ occurrence_key: string; photos: Array<{ id: string }> }> };
  const reqDetail = detail.requirements.find(r => r.occurrence_key === 'slot-panel');
  assert.ok(reqDetail?.photos.length! > 0, 'Photos must be carried forward into version 2');

  // Sign corrected version 2 with carried forward photo - MUST SUCCEED WITH 200
  const signV2Res = await req(`compliance-jobs/${jobId}/forms/slot-panel/sign`, staff, 'POST', {
    expected_job_version: 1,
    answer_version: 2,
    intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: { panel_photo: [reqDetail!.photos[0].id] },
  }, { 'Idempotency-Key': 'op-sign-panel-v2' });
  assert.equal(signV2Res.status, 200);
});

test('VERIFICATION F06: Concurrent form draft edits reject stale versions with 409 (CO-b4bdd528c561)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${staff}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a draft form definition
  const schemaInitial = { sections: [{ title: 'Initial Section', fields: [{ key: 'f_init', label: 'Initial Field', type: 'TEXT', required: true }] }] };
  const formRes = await req('form-definitions', 'POST', { title: 'Draft Concurrency', code: 'CONC-002', description: 'Conc desc', category: 'Custom', brand_id: 'solarcell', schema: schemaInitial });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };

  // Fetch initial revision updated_at
  const revDetailRes = await req(`form-definitions/${form.id}`, 'GET');
  const revDetail = await revDetailRes.json() as { revisions: Array<{ id: string; updated_at: string }> };
  const initialUpdatedAt = revDetail.revisions.find(r => r.id === form.revision_id)?.updated_at;
  assert.ok(initialUpdatedAt);

  // (c) Missing preconditions on PUT and POST .../review -> 428 Precondition Required (without mutating sections/fields)
  const schemaMissing = { sections: [{ title: 'Missing Precondition Title', fields: [{ key: 'f_missing', label: 'Missing Field', type: 'TEXT', required: true }] }] };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaMissing)).status, 428);
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', { ...schemaMissing, expected_updated_at: null })).status, 428);
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', { ...schemaMissing, expected_updated_at: '' })).status, 428);
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, 'POST')).status, 428);
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, 'POST', { expected_updated_at: null })).status, 428);

  // (a) Concurrent saves with same starting version: exactly one succeeds (200) and loser gets 409; winner's sections & fields preserved
  const schemaA = { sections: [{ title: 'Session A Title', fields: [{ key: 'f_a', label: 'Field A', type: 'TEXT', required: true }] }] };
  const schemaB = { sections: [{ title: 'Session B Title', fields: [{ key: 'f_b', label: 'Field B', type: 'TEXT', required: true }] }] };
  const [raceA, raceB] = await Promise.all([
    req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaA, { 'If-Match': initialUpdatedAt }),
    req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaB, { 'If-Match': initialUpdatedAt }),
  ]);
  const statuses = [raceA.status, raceB.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const winnerRes = raceA.status === 200 ? raceA : raceB;
  const winnerField = raceA.status === 200 ? 'f_a' : 'f_b';
  const winnerSection = raceA.status === 200 ? 'Session A Title' : 'Session B Title';
  const winnerBody = await winnerRes.json() as { success: boolean; updated_at: string };

  // (d) Successful save produces a new, distinct version value different from the input
  assert.ok(winnerBody.updated_at);
  assert.notEqual(winnerBody.updated_at, initialUpdatedAt);

  // (b) Stale save gets 409 and does NOT modify sections or fields
  const schemaStale = { sections: [{ title: 'Stale Overwrite Title', fields: [{ key: 'f_stale', label: 'Stale Field', type: 'TEXT', required: true }] }] };
  const resStale = await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', schemaStale, { 'If-Match': initialUpdatedAt });
  assert.equal(resStale.status, 409);

  // Stale submit for review -> 409
  const submitB = await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, 'POST', { action: 'SUBMIT_FOR_REVIEW' }, { 'If-Match': initialUpdatedAt });
  assert.equal(submitB.status, 409);

  // Verify stored sections and fields are winner's changes, NOT overwritten by loser or stale save
  const sections = await db.prepare("SELECT title FROM form_sections WHERE revision_id=?").bind(form.revision_id).all<{ title: string }>();
  assert.deepEqual(sections.results.map(r => r.title), [winnerSection]);
  const fields = await db.prepare("SELECT field_key FROM form_fields WHERE section_id IN (SELECT id FROM form_sections WHERE revision_id=?)").bind(form.revision_id).all<{field_key:string}>();
  assert.deepEqual(fields.results.map(r => r.field_key), [winnerField]);

  // Sequential save with winnerBody.updated_at produces yet another distinct version token
  const resFollowup = await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, 'PUT', { ...schemaA, expected_updated_at: winnerBody.updated_at });
  assert.equal(resFollowup.status, 200);
  const followupBody = await resFollowup.json() as { success: boolean; updated_at: string };
  assert.notEqual(followupBody.updated_at, winnerBody.updated_at);
  assert.notEqual(followupBody.updated_at, initialUpdatedAt);
  const storedSectionsAfter = await db.prepare("SELECT title FROM form_sections WHERE revision_id=?").bind(form.revision_id).all<{ title: string }>();
  assert.deepEqual(storedSectionsAfter.results.map(r => r.title), ['Session A Title']);
  const storedFieldsAfter = await db.prepare("SELECT field_key FROM form_fields WHERE section_id IN (SELECT id FROM form_sections WHERE revision_id=?)").bind(form.revision_id).all<{field_key:string}>();
  assert.deepEqual(storedFieldsAfter.results.map(r => r.field_key), ['f_a']);
});

test('VERIFICATION F07: Closing a job automatically cancels scheduled visits (CO-6edd88862a45)', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as any,
  };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);

  const req = (p: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${owner}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // 1. Create a job and assign technician
  const opId = 'op-visit-job-f07';
  await db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?, 'solarcell', 'test_g01_usr_owner_admin', 'CREATE', 'job-visit-f07', 0, ?)").bind(opId, 'f'.repeat(64)),
    db.prepare("INSERT INTO compliance_jobs(id, workspace_id, job_type_id, policy_id, title, operation_id, assignee_id, customer_name, site_address) VALUES('job-visit-f07', 'solarcell', 'jt-solar-service', 'pol-solar-service-v1', 'Visit Job F07', ?, 'test_g01_usr_technician', 'Customer', 'Address')").bind(opId),
  ]);

  // 2. Schedule a visit
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const visitPayload = {
    visit_id: 'visit-f07-1',
    job_id: 'job-visit-f07',
    technician_id: 'test_g01_usr_technician',
    starts_at: startsAt,
    duration_minutes: 60,
    status: 'SCHEDULED',
    reason: 'Initial inspection',
    version: 1,
  };
  const visitRes = await req('visits', 'POST', visitPayload, { 'Idempotency-Key': 'key-visit-f07-1' });
  assert.equal(visitRes.status, 200);

  // 3. Cancel the job via ?operation=CANCEL
  const cancelRes = await req('compliance-jobs/job-visit-f07?operation=CANCEL', 'POST', {}, {
    'If-Match': '"1"',
    'Idempotency-Key': 'cancel-key-f07',
  });
  assert.equal(cancelRes.status, 200);

  // 4. Verify the visit in compliance_visit_events is CANCELLED
  const latestVisit = await db.prepare("SELECT status FROM compliance_visit_events WHERE visit_id='visit-f07-1' ORDER BY version DESC LIMIT 1").first<{status:string}>();
  assert.equal(latestVisit?.status, 'CANCELLED');

  // 5. Verify GET /visits returns CANCELLED
  const visitsListRes = await req('visits', 'GET');
  assert.equal(visitsListRes.status, 200);
  const visits = await visitsListRes.json() as Array<{ visit_id: string; status: string }>;
  const visitInList = visits.find(v => v.visit_id === 'visit-f07-1');
  assert.equal(visitInList?.status, 'CANCELLED');
});

const REMEDIATION_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC', 'base64');
function makeDistinctPng(pixelByte: number): Buffer {
  // Valid 1x1 RGB PNG with distinct pixel payload & valid CRC32 so each image has a unique SHA-256 while remaining valid PNG.
  const buf = Buffer.from(REMEDIATION_PNG);
  buf.writeUInt32BE(pixelByte, 41);
  // Compute CRC32 over IDAT chunk type+data (bytes 37..49 inclusive)
  let crc = 0xffffffff;
  for (let i = 37; i < 50; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 50);
  return buf;
}

test('TASK A: Upload cleanup reassignment, authorization alignment, closed-job consistency, and R2-before-DB race', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const r2Storage = new Map<string, Uint8Array>();
  let onDeleteHook: ((key: string) => Promise<void>) | null = null;
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async (key: string) => {
        const b = r2Storage.get(key);
        if (!b) return null;
        return { size: b.byteLength, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
      },
      put: async (key: string, body: any) => {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
        r2Storage.set(key, bytes);
      },
      delete: async (key: string) => {
        r2Storage.delete(key);
        if (onDeleteHook) await onDeleteHook(key);
      },
    } as any,
  };

  // Add second technician, unrelated third technician, and a cctv-only user
  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ('usr_tech2', 'tech2@example.invalid', 'Tech Two', datetime('now'), datetime('now')), ('usr_tech3', 'tech3@example.invalid', 'Tech Three', datetime('now'), datetime('now')), ('usr_cctv_only', 'cctv@example.invalid', 'CCTV User', datetime('now'), datetime('now'))"),
    db.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_tech2', 'usr_tech2', 'firebase', 'uid_tech2', datetime('now')), ('map_tech3', 'usr_tech3', 'firebase', 'uid_tech3', datetime('now')), ('map_cctv_only', 'usr_cctv_only', 'firebase', 'uid_cctv_only', datetime('now'))"),
    db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('mem_tech2', 'solarcell', 'usr_tech2', 'technician', datetime('now'), datetime('now')), ('mem_tech3', 'solarcell', 'usr_tech3', 'technician', datetime('now'), datetime('now')), ('mem_cctv_only', 'cctv', 'usr_cctv_only', 'office_staff', datetime('now'), datetime('now'))"),
    db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')"),
  ]);

  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const superAdmin = await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email);
  const tech1 = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);
  const tech2 = await fixture.token('uid_tech2', 'tech2@example.invalid');
  const tech3 = await fixture.token('uid_tech3', 'tech3@example.invalid');
  const cctvOnly = await fixture.token('uid_cctv_only', 'cctv@example.invalid');

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}, ws = 'solarcell') => {
    const isBinary = body instanceof Uint8Array;
    return worker.fetch(new Request(`http://localhost/api/v1/workspaces/${ws}/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !isBinary ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (isBinary ? Uint8Array.from(body) : JSON.stringify(body)) : undefined,
    }), env);
  };

  // Create form & job assigned to tech1
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Task A Form', code: 'TASKA-001', description: 'Desc', category: 'Custom', brand_id: 'solarcell',
    schema: { sections: [{ title: 'S', fields: [{ key: 'p1', label: 'P1', type: 'PHOTO', required: true }] }] },
  });
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  const jobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Task A Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust A', site_address: '1 A St',
  }, { 'Idempotency-Key': 'taska-job-1' });
  const { job_id: jobId } = await jobRes.json() as { job_id: string };
  await req(`compliance-jobs/${jobId}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-a', revision_id: form.revision_id, required: true, reason: 'Task A',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taska-add' });
  await req(`compliance-jobs/${jobId}`, tech1, 'PATCH', {
    occurrence_key: 'slot-a', expected_answer_version: 0, answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taska-save-1' });

  const stageUpload = async (token: string, jobVer = 1) => {
    const res = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence`, token, 'POST', REMEDIATION_PNG, {
      'Content-Type': 'image/png', 'If-Match': `"${jobVer}"`, 'X-Answer-Version': '1',
    });
    assert.equal(res.status, 201);
    return (await res.json() as { upload_id: string }).upload_id;
  };

  // 1. tech1 stages up1; unrelated tech3 and cross-workspace callers are denied
  const up1 = await stageUpload(tech1, 1);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, tech3, 'DELETE')).status, 404);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, cctvOnly, 'DELETE')).status, 403);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, superAdmin, 'DELETE', undefined, {}, 'cctv')).status, 404);

  // 2. Reassign job to tech2 (job_version becomes 2)
  const assignRes = await req(`compliance-jobs/${jobId}?operation=ASSIGN`, staff, 'POST', {
    assignee_id: 'usr_tech2',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taska-assign-tech2' });
  assert.equal(assignRes.status, 200);

  // Original uploader tech1 lost job-assignment access -> MUST be denied (404), NOT allowed via upload.actor_id
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, tech1, 'DELETE')).status, 404);

  // New assignee tech2 (not original uploader) CAN reclaim up1 -> 204; repeated cleanup -> 404 (never 500)
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, tech2, 'DELETE')).status, 204);
  assert.equal(r2Storage.has(`stage/${up1}`), false);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up1}`, tech2, 'DELETE')).status, 404);

  // 3. Office/admin can reclaim tech2's staged upload on OPEN job
  const up2 = await stageUpload(tech2, 2);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${up2}`, staff, 'DELETE')).status, 204);

  // 4. Cleanup racing with finalization: private/... & compliance_evidence MUST survive and DELETE returns 409 JOB_STATE_CONFLICT
  const upRace = await stageUpload(tech2, 2);
  let racedOnce = false;
  onDeleteHook = async (key: string) => {
    if (key === `stage/${upRace}` && !racedOnce) {
      racedOnce = true;
      // Restore staged bytes temporarily so concurrent finalize succeeds before DELETE's DB query runs
      r2Storage.set(key, REMEDIATION_PNG);
      const finRes = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upRace}/finalize`, tech2, 'POST');
      assert.equal(finRes.status, 200);
    }
  };
  const raceDelRes = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upRace}`, tech2, 'DELETE');
  onDeleteHook = null;
  assert.equal(raceDelRes.status, 409);
  assert.equal(((await raceDelRes.json()) as { code: string }).code, 'JOB_STATE_CONFLICT');
  const contentAfterRace = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upRace}/content`, tech2, 'GET');
  assert.equal(contentAfterRace.status, 200);
  assert.deepEqual(Buffer.from(await contentAfterRace.arrayBuffer()), REMEDIATION_PNG);

  // 5. Revoked membership does NOT bypass via original uploader status
  const upRevoked = await stageUpload(tech2, 2);
  await db.prepare("DELETE FROM workspace_memberships WHERE id='mem_tech2'").run();
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upRevoked}`, tech2, 'DELETE')).status, 403);

  // Re-grant tech2 membership to test closed-job consistency + R2-before-DB failure case
  await db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('mem_tech2', 'solarcell', 'usr_tech2', 'technician', datetime('now'), datetime('now'))").run();

  // 6. R2-before-DB failure case: concurrent CANCEL runs between store.delete(staged) and DELETE FROM compliance_uploads -> 409 JOB_STATE_CONFLICT
  const upBeforeClose = await stageUpload(tech2, 2);
  const upStaffBeforeClose = await stageUpload(staff, 2);
  let cancelledOnce = false;
  onDeleteHook = async (key: string) => {
    if (key === `stage/${upBeforeClose}` && !cancelledOnce) {
      cancelledOnce = true;
      const cancelRes = await req(`compliance-jobs/${jobId}?operation=CANCEL`, staff, 'POST', {}, {
        'If-Match': '"2"', 'Idempotency-Key': 'taska-cancel-race',
      });
      assert.equal(cancelRes.status, 200);
    }
  };
  const r2BeforeDbFail = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upBeforeClose}`, tech2, 'DELETE');
  onDeleteHook = null;
  assert.equal(r2BeforeDbFail.status, 409);
  assert.equal(((await r2BeforeDbFail.json()) as { code: string }).code, 'JOB_STATE_CONFLICT');
  // Staged bytes in R2 were deleted prior to DB check while compliance_uploads row remains and finalized upRace remains intact in R2 & D1
  assert.equal(r2Storage.has(`stage/${upBeforeClose}`), false);
  assert.equal(await db.prepare("SELECT count(*) AS c FROM compliance_uploads WHERE id=?").bind(upBeforeClose).first('c'), 1);
  assert.equal((await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upRace}/content`, staff, 'GET')).status, 200);

  // 7. Closed job consistently returns 409 JOB_STATE_CONFLICT for both original uploader (tech2) and office (no actor_id asymmetry)
  const closedTechDel = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upBeforeClose}`, tech2, 'DELETE');
  assert.equal(closedTechDel.status, 409);
  assert.equal(((await closedTechDel.json()) as { code: string }).code, 'JOB_STATE_CONFLICT');
  const closedStaffDel = await req(`compliance-jobs/${jobId}/forms/slot-a/evidence/${upStaffBeforeClose}`, staff, 'DELETE');
  assert.equal(closedStaffDel.status, 409);
  assert.equal(((await closedStaffDel.json()) as { code: string }).code, 'JOB_STATE_CONFLICT');
});

test('TASK B: Same-version recovery on answer_version=1, 3 independent limits, and carry-forward blocker at cap', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const r2Storage = new Map<string, Uint8Array>();
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: {
      get: async (key: string) => {
        const b = r2Storage.get(key);
        if (!b) return null;
        return { size: b.byteLength, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
      },
      put: async (key: string, body: any) => {
        const bytes = body instanceof Uint8Array ? body : new Uint8Array(await new Response(body).arrayBuffer());
        r2Storage.set(key, bytes);
      },
      delete: async (key: string) => { r2Storage.delete(key); },
    } as any,
  };

  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ('usr_b_tech2', 'btech2@example.invalid', 'B Tech2', datetime('now'), datetime('now'))"),
    db.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_b_tech2', 'usr_b_tech2', 'firebase', 'uid_b_tech2', datetime('now'))"),
    db.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('mem_b_tech2', 'solarcell', 'usr_b_tech2', 'technician', datetime('now'), datetime('now'))"),
    db.prepare("INSERT INTO compliance_photo_limits(workspace_id, max_bytes, validated_at, validated_by) VALUES('solarcell', 1000000, '2026', 'test_g01_usr_owner_admin')"),
  ]);

  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const tech1 = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);
  const tech2 = await fixture.token('uid_b_tech2', 'btech2@example.invalid');

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
    const isBinary = body instanceof Uint8Array;
    return worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body && !isBinary ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? (isBinary ? Uint8Array.from(body) : JSON.stringify(body)) : undefined,
    }), env);
  };

  // Create form with initial photo + conditional correction photo
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Task B Form', code: 'TASKB-001', description: 'Desc', category: 'Custom', brand_id: 'solarcell',
    schema: {
      sections: [{
        title: 'Photos',
        fields: [
          { key: 'initial_photo', label: 'Initial Photo', type: 'PHOTO', required: true },
          { key: 'needs_new_photo', label: 'Needs New Photo', type: 'CHECKBOX', required: false },
          { key: 'correction_photo', label: 'Correction Photo', type: 'PHOTO', required: true, visible_when: { field: 'needs_new_photo', equals: true } },
        ],
      }],
    },
  });
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');
  await db.batch([
    db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, ?)").bind(form.revision_id, G01_TEST_AUTH.technician.userId),
    db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, 'usr_b_tech2')").bind(form.revision_id),
    db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, ?)").bind(form.revision_id, G01_TEST_AUTH.officeStaff.userId),
  ]);

  // --- Subtest 1: Same-version abandoned-upload reclamation on answer_version = 1 WITHOUT incrementing answer_version ---
  const job1Res = await req('compliance-jobs', staff, 'POST', {
    title: 'Same Version Recovery Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust B1', site_address: '1 B St',
  }, { 'Idempotency-Key': 'taskb-job-1' });
  const { job_id: job1 } = await job1Res.json() as { job_id: string };
  await req(`compliance-jobs/${job1}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-b1', revision_id: form.revision_id, required: true, reason: 'Task B1',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-add-1' });
  await req(`compliance-jobs/${job1}`, tech1, 'PATCH', {
    occurrence_key: 'slot-b1', expected_answer_version: 0, answers: { needs_new_photo: false },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-save-b1-v1' });

  // Abandon 20 pending reservations on answer_version = 1
  const abandonedIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    const r = await req(`compliance-jobs/${job1}/forms/slot-b1/evidence`, tech1, 'POST', makeDistinctPng(i + 1), {
      'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
    });
    assert.equal(r.status, 201);
    abandonedIds.push(((await r.json()) as { upload_id: string }).upload_id);
  }
  // 21st pending upload on answer_version = 1 is rejected (pending cap = 20)
  const cap21Res = await req(`compliance-jobs/${job1}/forms/slot-b1/evidence`, tech1, 'POST', makeDistinctPng(21), {
    'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
  });
  assert.equal(cap21Res.status, 422);

  // Reassign to tech2; tech2 reclaims one abandoned upload on answer_version=1 WITHOUT incrementing answer_version
  assert.equal((await req(`compliance-jobs/${job1}?operation=ASSIGN`, staff, 'POST', {
    assignee_id: 'usr_b_tech2',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-assign-1' })).status, 200);
  assert.equal((await req(`compliance-jobs/${job1}/forms/slot-b1/evidence/${abandonedIds[0]}`, tech2, 'DELETE')).status, 204);

  // Create new upload on answer_version = 1, finalize, and sign answer_version = 1
  const recoveredStage = await req(`compliance-jobs/${job1}/forms/slot-b1/evidence`, tech2, 'POST', makeDistinctPng(30), {
    'Content-Type': 'image/png', 'If-Match': '"2"', 'X-Answer-Version': '1',
  });
  assert.equal(recoveredStage.status, 201);
  const { upload_id: recId } = await recoveredStage.json() as { upload_id: string };
  assert.equal((await req(`compliance-jobs/${job1}/forms/slot-b1/evidence/${recId}/finalize`, tech2, 'POST')).status, 200);
  const signV1SameVer = await req(`compliance-jobs/${job1}/forms/slot-b1/sign`, tech2, 'POST', {
    expected_job_version: 2, answer_version: 1, intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: { initial_photo: [recId] },
  }, { 'Idempotency-Key': 'taskb-sign-same-v1' });
  assert.equal(signV1SameVer.status, 200);
  assert.equal(await db.prepare("SELECT max(version) AS v FROM compliance_answers WHERE job_id=?").bind(job1).first('v'), 1);

  // --- Subtest 2A: Byte limit trips independently of pending cap (20) and max_photos (20) ---
  await db.prepare("INSERT INTO compliance_job_byte_limits VALUES('solarcell', ?)").bind(REMEDIATION_PNG.length * 2).run();
  const jobBytesRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Byte Limit Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    assignee_id: 'usr_b_tech2', customer_name: 'Cust Byte', site_address: '2 B St',
  }, { 'Idempotency-Key': 'taskb-job-bytes' });
  const { job_id: jobBytes } = await jobBytesRes.json() as { job_id: string };
  await req(`compliance-jobs/${jobBytes}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-bytes', revision_id: form.revision_id, required: true, reason: 'Bytes',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-add-bytes' });
  await req(`compliance-jobs/${jobBytes}`, tech2, 'PATCH', {
    occurrence_key: 'slot-bytes', expected_answer_version: 0, answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-save-bytes' });
  for (let i = 0; i < 2; i++) {
    const s = await req(`compliance-jobs/${jobBytes}/forms/slot-bytes/evidence`, tech2, 'POST', makeDistinctPng(40 + i), {
      'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
    });
    assert.equal(s.status, 201);
    const { upload_id } = await s.json() as { upload_id: string };
    assert.equal((await req(`compliance-jobs/${jobBytes}/forms/slot-bytes/evidence/${upload_id}/finalize`, tech2, 'POST')).status, 200);
  }
  const s3 = await req(`compliance-jobs/${jobBytes}/forms/slot-bytes/evidence`, tech2, 'POST', makeDistinctPng(42), {
    'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
  });
  assert.equal(s3.status, 201);
  const { upload_id: up3 } = await s3.json() as { upload_id: string };
  // 3rd distinct photo hits job byte limit (422) even though pending=0 and distinct_photos=2 (<20)
  assert.equal((await req(`compliance-jobs/${jobBytes}/forms/slot-bytes/evidence/${up3}/finalize`, tech2, 'POST')).status, 422);
  await db.prepare("DELETE FROM compliance_job_byte_limits WHERE workspace_id='solarcell'").run();

  // --- Subtest 2B & 3: Carry-forward preserves history, reuses storage_key, 0 duplicate objects, and actionable blocker at retained limit ---
  const jobCarryRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Carry Forward Blocker Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    assignee_id: 'usr_b_tech2', customer_name: 'Cust Carry', site_address: '3 B St',
  }, { 'Idempotency-Key': 'taskb-job-carry' });
  const { job_id: jobCarry } = await jobCarryRes.json() as { job_id: string };
  await req(`compliance-jobs/${jobCarry}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-carry', revision_id: form.revision_id, required: true, reason: 'Carry',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-add-carry' });
  await req(`compliance-jobs/${jobCarry}`, tech2, 'PATCH', {
    occurrence_key: 'slot-carry', expected_answer_version: 0, answers: { needs_new_photo: false },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-save-carry-v1' });

  r2Storage.clear();
  const committedIds: string[] = [];
  for (let i = 0; i < 20; i++) {
    const s = await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence`, tech2, 'POST', makeDistinctPng(100 + i), {
      'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
    });
    assert.equal(s.status, 201);
    const { upload_id } = await s.json() as { upload_id: string };
    assert.equal((await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence/${upload_id}/finalize`, tech2, 'POST')).status, 200);
    committedIds.push(upload_id);
  }
  assert.equal(r2Storage.size, 20);
  // 21st distinct photo fails max_photos=20 (pending=0, byte limit unset)
  const overMaxStage = await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence`, tech2, 'POST', makeDistinctPng(121), {
    'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
  });
  assert.equal(overMaxStage.status, 201);
  const { upload_id: overMaxId } = await overMaxStage.json() as { upload_id: string };
  assert.equal((await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence/${overMaxId}/finalize`, tech2, 'POST')).status, 422);
  assert.equal((await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence/${overMaxId}`, tech2, 'DELETE')).status, 204);

  // Sign answer_version = 1
  assert.equal((await req(`compliance-jobs/${jobCarry}/forms/slot-carry/sign`, tech2, 'POST', {
    expected_job_version: 1, answer_version: 1, intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: { initial_photo: [committedIds[0]] },
  }, { 'Idempotency-Key': 'taskb-sign-carry-v1' })).status, 200);
  const signV1Digest = await db.prepare("SELECT digest FROM compliance_signoffs WHERE job_id=? AND answer_version=1").bind(jobCarry).first<string>('digest');

  // Correction on answer_version = 2 now requires correction_photo (needs_new_photo: true)
  const saveV2Carry = await req(`compliance-jobs/${jobCarry}`, tech2, 'PATCH', {
    occurrence_key: 'slot-carry', expected_answer_version: 1, answers: { needs_new_photo: true },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-save-carry-v2' });
  assert.equal(saveV2Carry.status, 200);

  // Verify carry-forward reused storage_keys without duplicating physical R2 objects or incrementing distinct photo_count
  assert.equal(r2Storage.size, 20);
  const jobDetailAfterCarry = await (await req(`compliance-jobs/${jobCarry}`, staff, 'GET')).json() as {
    job: { photo_count: number };
    requirements: Array<{ occurrence_key: string; photos: Array<{ id: string }> }>;
  };
  assert.equal(jobDetailAfterCarry.job.photo_count, 20);
  const carriedPhotos = jobDetailAfterCarry.requirements.find(r => r.occurrence_key === 'slot-carry')!.photos;
  assert.equal(carriedPhotos.length, 20);

  // Attempting to upload + finalize genuinely new evidence at retained-photo limit produces actionable 422 blocker
  const newEvStage = await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence`, tech2, 'POST', makeDistinctPng(150), {
    'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '2',
  });
  assert.equal(newEvStage.status, 201);
  const { upload_id: newEvId } = await newEvStage.json() as { upload_id: string };
  const newEvFin = await req(`compliance-jobs/${jobCarry}/forms/slot-carry/evidence/${newEvId}/finalize`, tech2, 'POST');
  assert.equal(newEvFin.status, 422);
  assert.equal(((await newEvFin.json()) as { code: string }).code, 'EVIDENCE_INVALID');

  // Attempting to sign correction without new evidence produces actionable SIGNOFF_BLOCKED without deleting signed v1 history
  const blockedSign = await req(`compliance-jobs/${jobCarry}/forms/slot-carry/sign`, tech2, 'POST', {
    expected_job_version: 1, answer_version: 2, intent_version: 'cabms-form-attestation-v1',
    evidence_by_field: { initial_photo: [carriedPhotos[0].id] },
  }, { 'Idempotency-Key': 'taskb-sign-carry-v2-blocked' });
  assert.equal(blockedSign.status, 409);
  const blockedBody = await blockedSign.json() as { code: string; blockers: Array<{ code: string; field?: string }> };
  assert.equal(blockedBody.code, 'SIGNOFF_BLOCKED');
  assert.ok(blockedBody.blockers.some(b => b.code === 'EVIDENCE_REQUIRED' && b.field === 'correction_photo'));
  assert.equal(await db.prepare("SELECT digest FROM compliance_signoffs WHERE job_id=? AND answer_version=1").bind(jobCarry).first('digest'), signV1Digest);

  // --- Subtest 2C: Disposable workspace max_photos=25 allows >20 sequential uploads/finalizations on same answer_version=1 while pending cap=20 holds ---
  await db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER IF EXISTS compliance_upload_capacity;
    DROP TRIGGER IF EXISTS compliance_evidence_guard;
    DROP TRIGGER IF EXISTS compliance_total_evidence_bytes;
    CREATE TABLE compliance_photo_limits_v2 (
      workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id),
      max_bytes INTEGER NOT NULL CHECK(max_bytes>0),
      validated_at TEXT NOT NULL,
      validated_by TEXT NOT NULL REFERENCES users(id),
      max_photos INTEGER NOT NULL DEFAULT 20 CHECK(max_photos>0)
    );
    INSERT INTO compliance_photo_limits_v2 SELECT * FROM compliance_photo_limits;
    DROP TABLE compliance_photo_limits;
    ALTER TABLE compliance_photo_limits_v2 RENAME TO compliance_photo_limits;
    CREATE TRIGGER compliance_upload_capacity BEFORE INSERT ON compliance_uploads BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
      OR (SELECT count(*) FROM compliance_uploads u WHERE u.job_id=NEW.job_id AND u.answer_version=NEW.answer_version AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=u.id))>=20
      THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
    END;
    CREATE TRIGGER compliance_evidence_guard BEFORE INSERT ON compliance_evidence BEGIN
      SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
      OR (NOT EXISTS(SELECT 1 FROM compliance_evidence exist WHERE exist.workspace_id=NEW.workspace_id AND exist.job_id=NEW.job_id AND exist.storage_key=NEW.storage_key)
          AND (SELECT count(DISTINCT e.storage_key) FROM compliance_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.job_id=NEW.job_id)>=(SELECT max_photos FROM compliance_photo_limits WHERE workspace_id=NEW.workspace_id))
      THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
      SELECT CASE WHEN EXISTS(SELECT 1 FROM compliance_signoffs s WHERE s.workspace_id=NEW.workspace_id AND s.job_id=NEW.job_id AND s.occurrence_key=NEW.occurrence_key AND s.answer_version=NEW.answer_version)
      THEN RAISE(ABORT,'HISTORY_IMMUTABLE') END;
    END;
    PRAGMA foreign_keys = ON;
    UPDATE compliance_photo_limits SET max_photos=25 WHERE workspace_id='solarcell';
  `);
  const job25Res = await req('compliance-jobs', staff, 'POST', {
    title: '25 Sequential Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    assignee_id: 'usr_b_tech2', customer_name: 'Cust 25', site_address: '4 B St',
  }, { 'Idempotency-Key': 'taskb-job-25' });
  const { job_id: job25 } = await job25Res.json() as { job_id: string };
  await req(`compliance-jobs/${job25}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-25', revision_id: form.revision_id, required: true, reason: '25',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-add-25' });
  await req(`compliance-jobs/${job25}`, tech2, 'PATCH', {
    occurrence_key: 'slot-25', expected_answer_version: 0, answers: {},
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskb-save-25' });

  for (let i = 0; i < 25; i++) {
    const s = await req(`compliance-jobs/${job25}/forms/slot-25/evidence`, tech2, 'POST', makeDistinctPng(200 + i), {
      'Content-Type': 'image/png', 'If-Match': '"1"', 'X-Answer-Version': '1',
    });
    assert.equal(s.status, 201);
    const { upload_id } = await s.json() as { upload_id: string };
    assert.equal((await req(`compliance-jobs/${job25}/forms/slot-25/evidence/${upload_id}/finalize`, tech2, 'POST')).status, 200);
  }
  assert.equal(await db.prepare("SELECT count(DISTINCT storage_key) AS c FROM compliance_evidence WHERE job_id=?").bind(job25).first('c'), 25);
});

test('TASK C: F07 CANCEL and COMPLETE paths, preserved visit history, concurrency, idempotency, and atomic rollback', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
  };
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // Create direct-to-invoice policy for COMPLETE tests (validates completion path cleanly)
  const invPolRes = await req('job-types/jt-solar-service/policies', owner, 'POST', {
    base_policy_id: 'pol-solar-service-v1', isDirectToInvoice: true, formsRequired: [],
  });
  assert.equal(invPolRes.status, 201);
  const invPol = await invPolRes.json() as { id: string };
  assert.equal((await req(`job-types/jt-solar-service/policies/${invPol.id}/review`, owner, 'POST')).status, 200);
  assert.equal((await req(`job-types/jt-solar-service/policies/${invPol.id}/approve`, owner, 'POST')).status, 200);

  const startsAt = new Date(Date.now() + 86400000).toISOString();

  // --- Path 1: CANCEL preserves already-CANCELLED visits, cancels SCHEDULED, handles idempotency & post-close scheduling ---
  const cancelJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Task C Cancel Job', job_type_id: 'jt-solar-service', expected_policy_id: invPol.id,
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust C1', site_address: '1 C St',
  }, { 'Idempotency-Key': 'taskc-job-cancel' });
  const { job_id: cancelJob } = await cancelJobRes.json() as { job_id: string };

  // Schedule two visits; cancel one beforehand with custom reason
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'c-visit-sched', job_id: cancelJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 60, status: 'SCHEDULED', reason: 'Scheduled 1', version: 1,
  }, { 'Idempotency-Key': 'c-v1' })).status, 200);
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'c-visit-prev-cancel', job_id: cancelJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 60, status: 'SCHEDULED', reason: 'Scheduled 2', version: 1,
  }, { 'Idempotency-Key': 'c-v2' })).status, 200);
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'c-visit-prev-cancel', job_id: cancelJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 60, status: 'CANCELLED', reason: 'Customer rescheduled', version: 2,
  }, { 'Idempotency-Key': 'c-v2-cancel' })).status, 200);

  // Close via CANCEL
  assert.equal((await req(`compliance-jobs/${cancelJob}?operation=CANCEL`, owner, 'POST', {}, {
    'If-Match': '"1"', 'Idempotency-Key': 'taskc-do-cancel',
  })).status, 200);

  // Verify c-visit-sched cancelled with 'Job cancelled', while c-visit-prev-cancel was NOT relabelled or duplicated
  const cSchedRow = await db.prepare("SELECT status, reason, version FROM compliance_visit_events WHERE visit_id='c-visit-sched' ORDER BY version DESC LIMIT 1").first<{ status: string; reason: string; version: number }>();
  assert.deepEqual({ ...cSchedRow }, { status: 'CANCELLED', reason: 'Job cancelled', version: 2 });
  const cPrevRows = await db.prepare("SELECT status, reason, version FROM compliance_visit_events WHERE visit_id='c-visit-prev-cancel' ORDER BY version ASC").all<{ status: string; reason: string; version: number }>();
  assert.equal(cPrevRows.results.length, 2);
  assert.deepEqual({ ...cPrevRows.results[1] }, { status: 'CANCELLED', reason: 'Customer rescheduled', version: 2 });

  // Repeated CANCEL: same key -> 200 replay, new key -> 409 JOB_STATE_CONFLICT (never 500)
  assert.equal((await req(`compliance-jobs/${cancelJob}?operation=CANCEL`, owner, 'POST', {}, {
    'If-Match': '"1"', 'Idempotency-Key': 'taskc-do-cancel',
  })).status, 200);
  const repeatCancel = await req(`compliance-jobs/${cancelJob}?operation=CANCEL`, owner, 'POST', {}, {
    'If-Match': '"2"', 'Idempotency-Key': 'taskc-do-cancel-2',
  });
  assert.equal(repeatCancel.status, 409);

  // Scheduling on closed CANCELLED job rejected with 412
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'c-visit-late', job_id: cancelJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 60, status: 'SCHEDULED', reason: 'Late', version: 1,
  }, { 'Idempotency-Key': 'c-v-late' })).status, 412);

  // --- Path 2: COMPLETE preserves already-CANCELLED visits, cancels SCHEDULED, handles idempotency & post-close scheduling ---
  const completeJobRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Task C Complete Job', job_type_id: 'jt-solar-service', expected_policy_id: invPol.id,
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust C2', site_address: '2 C St',
  }, { 'Idempotency-Key': 'taskc-job-complete' });
  const { job_id: completeJob } = await completeJobRes.json() as { job_id: string };

  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'comp-visit-sched', job_id: completeJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 45, status: 'SCHEDULED', reason: 'Scheduled comp', version: 1,
  }, { 'Idempotency-Key': 'comp-v1' })).status, 200);
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'comp-visit-prev-cancel', job_id: completeJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 45, status: 'SCHEDULED', reason: 'Scheduled comp 2', version: 1,
  }, { 'Idempotency-Key': 'comp-v2' })).status, 200);
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'comp-visit-prev-cancel', job_id: completeJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 45, status: 'CANCELLED', reason: 'Prior visit cancelled', version: 2,
  }, { 'Idempotency-Key': 'comp-v2-cancel' })).status, 200);

  const compRes = await req(`compliance-jobs/${completeJob}/complete`, owner, 'POST', {
    expected_job_version: 1,
  }, { 'Idempotency-Key': 'taskc-do-complete' });
  assert.equal(compRes.status, 200);
  assert.equal(((await compRes.json()) as { status: string }).status, 'COMPLETED');

  const compSchedRow = await db.prepare("SELECT status, reason, version FROM compliance_visit_events WHERE visit_id='comp-visit-sched' ORDER BY version DESC LIMIT 1").first<{ status: string; reason: string; version: number }>();
  assert.deepEqual({ ...compSchedRow }, { status: 'CANCELLED', reason: 'Job completed', version: 2 });
  const compPrevRows = await db.prepare("SELECT status, reason, version FROM compliance_visit_events WHERE visit_id='comp-visit-prev-cancel' ORDER BY version ASC").all<{ status: string; reason: string; version: number }>();
  assert.equal(compPrevRows.results.length, 2);
  assert.deepEqual({ ...compPrevRows.results[1] }, { status: 'CANCELLED', reason: 'Prior visit cancelled', version: 2 });

  const visitsList = await (await req('visits', owner, 'GET')).json() as Array<{ visit_id: string; status: string; reason: string }>;
  assert.equal(visitsList.find(v => v.visit_id === 'comp-visit-sched')?.reason, 'Job completed');
  assert.equal(visitsList.find(v => v.visit_id === 'comp-visit-prev-cancel')?.reason, 'Prior visit cancelled');

  // Repeated COMPLETE: same key -> 200 replay, new key -> 409 COMPLETION_BLOCKED (never 500)
  assert.equal((await req(`compliance-jobs/${completeJob}/complete`, owner, 'POST', {
    expected_job_version: 1,
  }, { 'Idempotency-Key': 'taskc-do-complete' })).status, 200);
  const repeatComp = await req(`compliance-jobs/${completeJob}/complete`, owner, 'POST', {
    expected_job_version: 2,
  }, { 'Idempotency-Key': 'taskc-do-complete-2' });
  assert.equal(repeatComp.status, 409);

  // Scheduling on closed COMPLETED job rejected with 412
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'comp-visit-late', job_id: completeJob, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 45, status: 'SCHEDULED', reason: 'Late', version: 1,
  }, { 'Idempotency-Key': 'comp-v-late' })).status, 412);

  // --- Path 3: Rollback on visit-cancellation failure (job MUST remain OPEN and visit MUST stay SCHEDULED) ---
  const rbJob1 = ((await (await req('compliance-jobs', staff, 'POST', {
    title: 'Rollback Cancel Job', job_type_id: 'jt-solar-service', expected_policy_id: invPol.id,
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust RB1', site_address: '3 C St',
  }, { 'Idempotency-Key': 'taskc-rb-1' })).json()) as { job_id: string }).job_id;
  const rbJob2 = ((await (await req('compliance-jobs', staff, 'POST', {
    title: 'Rollback Complete Job', job_type_id: 'jt-solar-service', expected_policy_id: invPol.id,
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust RB2', site_address: '4 C St',
  }, { 'Idempotency-Key': 'taskc-rb-2' })).json()) as { job_id: string }).job_id;

  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'rb-visit-1', job_id: rbJob1, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 30, status: 'SCHEDULED', reason: 'RB1', version: 1,
  }, { 'Idempotency-Key': 'rb-v1' })).status, 200);
  assert.equal((await req('visits', owner, 'POST', {
    visit_id: 'rb-visit-2', job_id: rbJob2, technician_id: G01_TEST_AUTH.technician.userId,
    starts_at: startsAt, duration_minutes: 30, status: 'SCHEDULED', reason: 'RB2', version: 1,
  }, { 'Idempotency-Key': 'rb-v2' })).status, 200);

  await db.exec("CREATE TRIGGER test_fail_visit_cancel BEFORE INSERT ON compliance_visit_events WHEN NEW.status='CANCELLED' BEGIN SELECT RAISE(ABORT, 'OPERATION_UNCONFIRMED'); END;");
  const failCancel = await req(`compliance-jobs/${rbJob1}?operation=CANCEL`, owner, 'POST', {}, {
    'If-Match': '"1"', 'Idempotency-Key': 'taskc-fail-cancel',
  });
  assert.equal(failCancel.status, 500);
  assert.deepEqual({ ...(await db.prepare("SELECT status, version FROM compliance_jobs WHERE id=?").bind(rbJob1).first<{ status: string; version: number }>()) }, { status: 'OPEN', version: 1 });
  assert.equal(await db.prepare("SELECT status FROM compliance_visit_events WHERE visit_id='rb-visit-1' ORDER BY version DESC LIMIT 1").first('status'), 'SCHEDULED');

  const failComplete = await req(`compliance-jobs/${rbJob2}/complete`, owner, 'POST', {
    expected_job_version: 1,
  }, { 'Idempotency-Key': 'taskc-fail-complete' });
  assert.equal(failComplete.status, 500);
  assert.deepEqual({ ...(await db.prepare("SELECT status, version FROM compliance_jobs WHERE id=?").bind(rbJob2).first<{ status: string; version: number }>()) }, { status: 'OPEN', version: 1 });
  assert.equal(await db.prepare("SELECT status FROM compliance_visit_events WHERE visit_id='rb-visit-2' ORDER BY version DESC LIMIT 1").first('status'), 'SCHEDULED');
  await db.exec('DROP TRIGGER test_fail_visit_cancel;');

  // --- Path 4: Concurrent scheduling vs job closure (no closed job can retain a SCHEDULED visit) ---
  const raceJob = ((await (await req('compliance-jobs', staff, 'POST', {
    title: 'Concurrent Schedule Close Job', job_type_id: 'jt-solar-service', expected_policy_id: invPol.id,
    assignee_id: G01_TEST_AUTH.technician.userId, customer_name: 'Cust Race', site_address: '5 C St',
  }, { 'Idempotency-Key': 'taskc-race-job' })).json()) as { job_id: string }).job_id;
  const [raceSched, raceClose] = await Promise.all([
    req('visits', owner, 'POST', {
      visit_id: 'race-visit-1', job_id: raceJob, technician_id: G01_TEST_AUTH.technician.userId,
      starts_at: startsAt, duration_minutes: 30, status: 'SCHEDULED', reason: 'Concurrent visit', version: 1,
    }, { 'Idempotency-Key': 'race-v1' }),
    req(`compliance-jobs/${raceJob}/complete`, owner, 'POST', {
      expected_job_version: 1,
    }, { 'Idempotency-Key': 'taskc-race-complete' }),
  ]);
  assert.equal(raceClose.status, 200);
  assert.ok([200, 412].includes(raceSched.status));
  const openSchedAfterClose = await db.prepare("SELECT count(*) AS c FROM compliance_visit_events v WHERE v.job_id=? AND v.status='SCHEDULED' AND v.version=(SELECT max(h.version) FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id)").bind(raceJob).first('c');
  assert.equal(openSchedAfterClose, 0);
});

test('TASK D: F01 rejected publication, F02 stale base_policy_id, F03 unavailable autofill blocker, F06 tampered If-Match & auth', async t => {
  const db = await setupRemediatedDatabase();
  t.after(() => db.getSqliteHandle().close());
  const fixture = await createFirebaseFixture();
  const worker = createWorker(createAuthenticationService(fixture.transport));
  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
    PRIVATE_EVIDENCE: { get: async () => null, put: async () => {}, delete: async () => {} } as any,
  };
  const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  const tech = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  const req = (p: string, token: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${p}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env);

  // Setup published catalog form with required technician.name autofill
  const formRes = await req('form-definitions', staff, 'POST', {
    title: 'Task D Form', code: 'TASKD-001', description: 'Desc', category: 'Custom', brand_id: 'solarcell',
    schema: {
      sections: [{
        title: 'Autofill',
        fields: [
          { key: 'tech_name', label: 'Technician Name', type: 'READONLY_AUTOFILL', required: true, autofill_source: 'technician.name' },
          { key: 'notes', label: 'Notes', type: 'TEXT', required: true },
        ],
      }],
    },
  });
  assert.equal(formRes.status, 201);
  const form = await formRes.json() as { id: string; revision_id: string };
  const formDetail = await (await req(`form-definitions/${form.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, staff, 'POST', { expected_updated_at: formDetail.revisions[0].updated_at })).status, 200);
  await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, owner, 'POST');

  // --- F01: Rejected policy publication preserves prior published policy unchanged ---
  const p1Res = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    formsRequired: [], formRules: [{ form_revision_id: form.revision_id, required: true }],
  });
  const p1 = await p1Res.json() as { id: string };
  await req(`job-types/jt-solar-install/policies/${p1.id}/review`, owner, 'POST');
  assert.equal((await req(`job-types/jt-solar-install/policies/${p1.id}/approve`, owner, 'POST')).status, 200);

  // Create draft p2, leave in DRAFT (unreviewed) or attempt approve as office_staff -> rejected
  const p2Res = await req('job-types/jt-solar-install/policies', staff, 'POST', {
    base_policy_id: p1.id, formsRequired: [], formRules: [],
  });
  const p2 = await p2Res.json() as { id: string };
  assert.equal((await req(`job-types/jt-solar-install/policies/${p2.id}/approve`, owner, 'POST')).status, 400);
  await req(`job-types/jt-solar-install/policies/${p2.id}/review`, staff, 'POST');
  assert.equal((await req(`job-types/jt-solar-install/policies/${p2.id}/approve`, staff, 'POST')).status, 403);

  const jtAfterRejected = await db.prepare("SELECT current_policy_version_id FROM job_types WHERE id='jt-solar-install'").first<{ current_policy_version_id: string }>();
  assert.equal(jtAfterRejected?.current_policy_version_id, p1.id);
  assert.equal(await db.prepare("SELECT status FROM job_type_compliance_policies WHERE id=?").bind(p1.id).first('status'), 'PUBLISHED');
  assert.equal(await db.prepare("SELECT count(*) AS c FROM policy_catalog_form_rules WHERE policy_version_id=? AND form_revision_id=?").bind(p1.id, form.revision_id).first('c'), 1);

  // --- F02: Stale base_policy_id save returns 409 and does not overwrite active policy ---
  const p3Res = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    base_policy_id: p1.id, isDirectToInvoice: true, formsRequired: [], formRules: [],
  });
  const p3 = await p3Res.json() as { id: string };
  await req(`job-types/jt-solar-install/policies/${p3.id}/review`, owner, 'POST');
  assert.equal((await req(`job-types/jt-solar-install/policies/${p3.id}/approve`, owner, 'POST')).status, 200);

  const staleSave = await req('job-types/jt-solar-install/policies', owner, 'POST', {
    base_policy_id: p1.id, formsRequired: [], formRules: [{ form_revision_id: form.revision_id, required: true }],
  });
  assert.equal(staleSave.status, 409);
  assert.equal(((await staleSave.json()) as { code: string }).code, 'VERSION_CONFLICT');
  assert.equal(await db.prepare("SELECT current_policy_version_id FROM job_types WHERE id='jt-solar-install'").first('current_policy_version_id'), p3.id);

  // --- F03: Signing when trusted autofill data is unavailable (assignee unset) returns AUTOFILL_UNAVAILABLE blocker ---
  const jobAutoRes = await req('compliance-jobs', staff, 'POST', {
    title: 'Missing Assignee Autofill Job', job_type_id: 'jt-solar-service', expected_policy_id: 'pol-solar-service-v1',
    customer_name: 'Cust Auto', site_address: '10 Auto St',
  }, { 'Idempotency-Key': 'taskd-job-auto' });
  const { job_id: jobAuto } = await jobAutoRes.json() as { job_id: string };
  await req(`compliance-jobs/${jobAuto}?operation=ADD`, staff, 'POST', {
    occurrence_key: 'slot-auto-miss', revision_id: form.revision_id, required: true, reason: 'Autofill blocker',
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskd-add-auto' });
  await req(`compliance-jobs/${jobAuto}`, staff, 'PATCH', {
    occurrence_key: 'slot-auto-miss', expected_answer_version: 0, answers: { notes: 'Saved without assignee' },
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskd-save-auto' });
  await db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell', ?, ?)").bind(form.revision_id, G01_TEST_AUTH.officeStaff.userId).run();

  const blockedSign = await req(`compliance-jobs/${jobAuto}/forms/slot-auto-miss/sign`, staff, 'POST', {
    expected_job_version: 1, answer_version: 1, intent_version: 'cabms-form-attestation-v1', evidence_by_field: {},
  }, { 'Idempotency-Key': 'taskd-sign-blocked' });
  assert.equal(blockedSign.status, 409);
  const blockedSignBody = await blockedSign.json() as { code: string; blockers: Array<{ code: string; field?: string }> };
  assert.equal(blockedSignBody.code, 'SIGNOFF_BLOCKED');
  assert.ok(blockedSignBody.blockers.some(b => b.code === 'AUTOFILL_UNAVAILABLE' && b.field === 'tech_name'));

  // Even if answers were saved while assignee was set, unassigning before sign still blocks with AUTOFILL_UNAVAILABLE (no stale/partial autofill bypass)
  assert.equal((await req(`compliance-jobs/${jobAuto}?operation=ASSIGN`, staff, 'POST', {
    assignee_id: G01_TEST_AUTH.technician.userId,
  }, { 'If-Match': '"1"', 'Idempotency-Key': 'taskd-assign-tech' })).status, 200);
  assert.equal((await req(`compliance-jobs/${jobAuto}`, staff, 'PATCH', {
    occurrence_key: 'slot-auto-miss', expected_answer_version: 1, answers: { notes: 'Saved with assignee' },
  }, { 'If-Match': '"2"', 'Idempotency-Key': 'taskd-save-auto-v2' })).status, 200);
  assert.equal((await req(`compliance-jobs/${jobAuto}?operation=ASSIGN`, staff, 'POST', {
    assignee_id: null,
  }, { 'If-Match': '"2"', 'Idempotency-Key': 'taskd-unassign-tech' })).status, 200);
  const blockedSignAfterUnassign = await req(`compliance-jobs/${jobAuto}/forms/slot-auto-miss/sign`, staff, 'POST', {
    expected_job_version: 3, answer_version: 2, intent_version: 'cabms-form-attestation-v1', evidence_by_field: {},
  }, { 'Idempotency-Key': 'taskd-sign-blocked-unassign' });
  assert.equal(blockedSignAfterUnassign.status, 409);
  const blockedAfterUnassignBody = await blockedSignAfterUnassign.json() as { code: string; blockers: Array<{ code: string; field?: string }> };
  assert.equal(blockedAfterUnassignBody.code, 'SIGNOFF_BLOCKED');
  assert.ok(blockedAfterUnassignBody.blockers.some(b => b.code === 'AUTOFILL_UNAVAILABLE' && b.field === 'tech_name'));

  // --- F06: Tampered If-Match, stale expected_updated_at, and unauthorized save/sign denial ---
  const draftFormRes = await req('form-definitions', staff, 'POST', {
    title: 'Task D Concurrency', code: 'TASKD-CONC', description: 'Desc', category: 'Custom', brand_id: 'solarcell',
    schema: { sections: [{ title: 'S', fields: [{ key: 'f1', label: 'F1', type: 'TEXT', required: true }] }] },
  });
  const draftForm = await draftFormRes.json() as { id: string; revision_id: string };
  const detail = await (await req(`form-definitions/${draftForm.id}`, staff, 'GET')).json() as { revisions: Array<{ id: string; updated_at: string }> };
  const realUpdatedAt = detail.revisions[0].updated_at;
  const validSchema = { sections: [{ title: 'S2', fields: [{ key: 'f1', label: 'F1', type: 'TEXT', required: true }] }] };

  // Tampered If-Match and empty If-Match both rejected with 409
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}`, staff, 'PUT', validSchema, { 'If-Match': '"tampered-ts"' })).status, 409);
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}`, staff, 'PUT', validSchema, { 'If-Match': '""' })).status, 409);

  // Stale expected_updated_at in body (even alongside valid If-Match) rejected with 409
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}`, staff, 'PUT', {
    ...validSchema, expected_updated_at: '1999-01-01T00:00:00.000Z',
  })).status, 409);
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}`, staff, 'PUT', {
    ...validSchema, expected_updated_at: '1999-01-01T00:00:00.000Z',
  }, { 'If-Match': `"${realUpdatedAt}"` })).status, 409);

  // Stale expected_updated_at on review submission rejected with 409
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}/review`, staff, 'POST', {
    expected_updated_at: '1999-01-01T00:00:00.000Z',
  })).status, 409);

  // Unauthorized callers denied on form save (technician -> 403), answer save (unassigned technician -> 404), and sign (ungranted owner -> 403)
  assert.equal((await req(`form-definitions/${draftForm.id}/revisions/${draftForm.revision_id}`, tech, 'PUT', validSchema, { 'If-Match': `"${realUpdatedAt}"` })).status, 403);
  assert.equal((await req(`compliance-jobs/${jobAuto}`, tech, 'PATCH', {
    occurrence_key: 'slot-auto-miss', expected_answer_version: 2, answers: { notes: 'Unauthorized' },
  }, { 'If-Match': '"3"', 'Idempotency-Key': 'taskd-unauth-save' })).status, 404);
  assert.equal((await req(`compliance-jobs/${jobAuto}/forms/slot-auto-miss/sign`, owner, 'POST', {
    expected_job_version: 3, answer_version: 2, intent_version: 'cabms-form-attestation-v1', evidence_by_field: {},
  }, { 'Idempotency-Key': 'taskd-unauth-sign' })).status, 403);
});
