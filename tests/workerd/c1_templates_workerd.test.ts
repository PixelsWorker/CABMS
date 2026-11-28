/**
 * CABMS C1 — Cloudflare Worker & D1 Local Binding Lifecycle & Atomicity Test
 *
 * Runs against the actual Cloudflare Worker runtime (workerd) and local D1 binding via Wrangler.
 * Verifies:
 * 1. Real D1 atomic batch creation of Job Types & Document Templates in DRAFT status.
 * 2. Strict Draft -> Review -> Published lifecycle enforcement over HTTP.
 * 3. Role authorization gates: Office staff cannot publish (403); Owner Admin can approve (200).
 * 4. Approval bypass prevention: direct DRAFT -> PUBLISHED transitions fail closed (400).
 * 5. Premature activation protection: activating draft items via PATCH restore fails closed (400).
 * 6. Immutability triggers on real D1: published policies & revisions cannot be updated or deleted.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, ChildProcess } from 'node:child_process';
import { resolve, dirname, join, relative, isAbsolute, sep } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH } from '../support/g01SyntheticFixtures.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../..');

const PORT = 8792;
const BASE_URL = `http://127.0.0.1:${PORT}`;

describe('C1 Templates & Content — Cloudflare Worker & Local D1 Binding Integration', () => {
  let wranglerProc: ChildProcess | null = null;
  let wranglerDiagnostics = '';
  const runId = randomUUID();
  const setupSecret = randomUUID();

  let fixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
  let superAdminAuth: string;
  let ownerAdminAuth: string;
  let officeStaffAuth: string;
  let technicianAuth: string;

  let isolation = '';
  let isolationReal = '';
  let tempReal = '';
  let persistence = '';
  let config = '';
  let cleanupAllowed = true;

  const require = createRequire(import.meta.url);
  const resolveWrangler = () => {
    try {
      const pkgPath = require.resolve('wrangler/package.json');
      return join(dirname(pkgPath), 'bin/wrangler.js');
    } catch {
      return require.resolve('wrangler/bin/wrangler.js');
    }
  };
  const cli = resolveWrangler();
  const run = (args: string[]) => {
    cleanupAllowed = false;
    const output = execFileSync(process.execPath, [cli, ...args, '--config', config], { cwd: rootDir, encoding: 'utf8', timeout: 60000 });
    cleanupAllowed = true;
    return output;
  };
  const execute = (sql: string) => run(['d1', 'execute', 'cabms-d1', '--local', '--persist-to', persistence, '--command', sql]);

  before(async () => {
    if (process.env.CABMS_DISPOSABLE_D1_TEST !== '1') {
      throw new Error('Set CABMS_DISPOSABLE_D1_TEST=1 only for separately authorized disposable local D1 tests');
    }
    tempReal = realpathSync(tmpdir());
    isolation = mkdtempSync(join(tempReal, 'cabms-c1-workerd-'));
    isolationReal = realpathSync(isolation);
    persistence = join(isolationReal, 'state');
    config = join(isolationReal, 'wrangler.json');
    const rel = relative(tempReal, isolationReal);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel.startsWith('cabms-c1-workerd-')) {
      throw new Error('Unsafe disposable D1 isolation directory');
    }

    const verified = loadVerifiedMigrations();
    const migrationCopy = join(isolation, 'migrations');
    mkdirSync(migrationCopy);
    for (const migration of verified) writeFileSync(join(migrationCopy, migration.name), migration.bytes);

    fixture = await createFirebaseFixture();
    superAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email)}`;
    ownerAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email)}`;
    officeStaffAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email)}`;
    technicianAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email)}`;

    const jwks = fixture.jwks();
    writeFileSync(config, JSON.stringify({
      name: 'cabms-c1-test',
      main: resolve(rootDir, 'tests/support/worker.ts'),
      compatibility_date: '2026-10-28',
      compatibility_flags: ['nodejs_compat'],
      d1_databases: [{ binding: 'DB', database_name: 'cabms-d1', database_id: 'local-test-only', migrations_dir: migrationCopy }],
      vars: {
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
        TEST_PUBLIC_JWKS: JSON.stringify(jwks),
        TEST_RUN_ID: runId,
        TEST_SETUP_SECRET: setupSecret,
      },
    }));

    run(['d1', 'migrations', 'apply', 'cabms-d1', '--local', '--persist-to', persistence]);

    wranglerProc = spawn(process.execPath, [cli, 'dev', '--config', config, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistence, '--show-interactive-dev-session', 'false'], {
      cwd: rootDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const capture = (chunk: unknown) => {
      const safe = String(chunk).replaceAll(setupSecret, '[REDACTED]')
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
        .replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_FIREBASE_KEY]');
      wranglerDiagnostics = (wranglerDiagnostics + safe).slice(-6000);
    };
    wranglerProc.stdout?.on('data', capture);
    wranglerProc.stderr?.on('data', capture);
    wranglerProc.on('error', error => capture(error.message));

    let isReady = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (wranglerProc.exitCode !== null || wranglerProc.signalCode !== null) break;
      try {
        const res = await fetch(`${BASE_URL}/api/v1/workspaces`, {
          headers: { Authorization: 'Bearer invalid-readiness-token' },
        });
        if (res.status === 401 && res.headers.get('X-G01-Test-Run') === runId
          && res.headers.get('Content-Type')?.includes('application/problem+json')) {
          const body = (await res.json()) as { code?: string };
          if (body.code === 'AUTHENTICATION_REQUIRED') { isReady = true; break; }
        }
      } catch {
        // waiting for socket
      }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!isReady) {
      throw new Error(`Expected CABMS workerd readiness proof missing on port ${PORT}.\n${wranglerDiagnostics}`);
    }

    const setup = await fetch(`${BASE_URL}/__g01_test/install-auth-fixtures`, {
      method: 'POST',
      headers: { 'X-G01-Test-Setup-Secret': setupSecret },
    });
    if (setup.status !== 200 || setup.headers.get('X-G01-Test-Run') !== runId) {
      throw new Error(`Workerd C1 test fixture install failed (HTTP ${setup.status}).\n${wranglerDiagnostics}`);
    }
  });

  after(async () => {
    if (wranglerProc && wranglerProc.pid) {
      try {
        if (process.platform !== 'win32') {
          process.kill(-wranglerProc.pid, 'SIGKILL');
        } else {
          wranglerProc.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    }
    await new Promise(r => setTimeout(r, 500));
    if (cleanupAllowed && isolationReal && isolationReal.includes('cabms-c1-workerd-')) {
      try {
        rmSync(isolationReal, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  it('verifies Job Type D1 batch creation starts in DRAFT, enforces REVIEW before approval, and blocks premature activation', async () => {
    const req = async (path: string, auth: string, method = 'GET', body?: unknown) => {
      return fetch(`${BASE_URL}/api/v1/workspaces/solarcell/${path}`, {
        method,
        headers: {
          Authorization: auth,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    };

    // 1. Office staff creates new job type
    const createRes = await req('job-types', officeStaffAuth, 'POST', {
      name: 'Commercial Solar Carport System',
      code: 'carport_solar_sys',
      brandId: 'solarcell',
      description: 'Solar canopy mounting structure over commercial parking.',
      formsRequired: ['JSA', 'ELECTRICAL', 'TCA1'],
      isDirectToInvoice: false,
      status: 'ACTIVE', // Must be ignored; starts in DRAFT
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string; policyId: string };
    assert.ok(created.id.startsWith('jt-'));
    assert.ok(created.policyId.startsWith('pol-'));

    // 2. Fetch and verify DRAFT state
    const getRes = await req(`job-types/${created.id}`, officeStaffAuth);
    assert.equal(getRes.status, 200);
    const jt = (await getRes.json()) as any;
    assert.equal(jt.status, 'DRAFT', 'Job type must start in DRAFT');
    assert.equal(jt.policy_status, 'DRAFT', 'Policy must start in DRAFT');

    // 3. Premature activation check: Cannot restore draft to ACTIVE without PUBLISHED policy
    const prematureRestore = await req(`job-types/${created.id}`, officeStaffAuth, 'PATCH', { action: 'restore' });
    assert.equal(prematureRestore.status, 400);
    const restoreProb = (await prematureRestore.json()) as any;
    assert.equal(restoreProb.code, 'ACTIVATION_FAILED');

    // 4. Premature approval check: Owner Admin cannot approve while still in DRAFT
    const prematureApprove = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, ownerAdminAuth, 'POST');
    assert.equal(prematureApprove.status, 400);
    const approveProb = (await prematureApprove.json()) as any;
    assert.equal(approveProb.code, 'APPROVAL_FAILED');

    // 5. Office staff submits policy for review -> transitions to REVIEW
    const reviewRes = await req(`job-types/${created.id}/policies/${created.policyId}/review`, officeStaffAuth, 'POST');
    assert.equal(reviewRes.status, 200);

    // 6. Negative authorization: Office staff cannot approve policy (403 Forbidden)
    const staffApprove = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, officeStaffAuth, 'POST');
    assert.equal(staffApprove.status, 403);

    // 7. Owner admin approves policy (200 OK) -> publishes policy and activates parent job type
    const ownerApprove = await req(`job-types/${created.id}/policies/${created.policyId}/approve`, ownerAdminAuth, 'POST');
    assert.equal(ownerApprove.status, 200);

    // 8. Verify activated and published state
    const detailRes = await req(`job-types/${created.id}`, officeStaffAuth);
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as any;
    assert.equal(detail.status, 'ACTIVE');
    assert.equal(detail.policy_status, 'PUBLISHED');

    // 9. Immutability trigger proof: direct SQL modification of published policy fails
    assert.throws(
      () => execute(`UPDATE job_type_compliance_policies SET version = 'tampered' WHERE id = '${created.policyId}'`),
      /published compliance policies are immutable/
    );
  });

  it('verifies Document Template D1 batch creation starts in DRAFT, enforces REVIEW before approval, and blocks premature activation', async () => {
    const req = async (path: string, auth: string, method = 'GET', body?: unknown) => {
      return fetch(`${BASE_URL}/api/v1/workspaces/solarcell/${path}`, {
        method,
        headers: {
          Authorization: auth,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    };

    // 1. Office staff creates new template
    const createRes = await req('templates', officeStaffAuth, 'POST', {
      name: 'Commercial Solar Maintenance SLA',
      templateType: 'QUOTE_TERMS',
      content: 'Standard commercial solar quarterly inspection and cleaning agreement.',
      status: 'ACTIVE', // Must be ignored; starts in DRAFT
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string; revisionId: string };
    assert.ok(created.id.startsWith('tpl-'));
    assert.ok(created.revisionId.startsWith('rev-'));

    // 2. Fetch and verify DRAFT state
    const getRes = await req(`templates/${created.id}`, officeStaffAuth);
    assert.equal(getRes.status, 200);
    const tpl = (await getRes.json()) as any;
    assert.equal(tpl.status, 'DRAFT', 'Template must start in DRAFT');
    assert.equal(tpl.revision_status, 'DRAFT', 'Revision must start in DRAFT');

    // 3. Premature activation check: Cannot restore draft to ACTIVE without PUBLISHED revision
    const prematureRestore = await req(`templates/${created.id}`, officeStaffAuth, 'PATCH', { action: 'restore' });
    assert.equal(prematureRestore.status, 400);
    const restoreProb = (await prematureRestore.json()) as any;
    assert.equal(restoreProb.code, 'ACTIVATION_FAILED');

    // 4. Premature approval check: Owner Admin cannot approve while still in DRAFT
    const prematureApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, ownerAdminAuth, 'POST');
    assert.equal(prematureApprove.status, 400);
    const approveProb = (await prematureApprove.json()) as any;
    assert.equal(approveProb.code, 'APPROVAL_FAILED');

    // 5. Office staff submits revision for review -> transitions to REVIEW
    const reviewRes = await req(`templates/${created.id}/revisions/${created.revisionId}/review`, officeStaffAuth, 'POST');
    assert.equal(reviewRes.status, 200);

    // 6. Negative authorization: Office staff cannot approve revision (403 Forbidden)
    const staffApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, officeStaffAuth, 'POST');
    assert.equal(staffApprove.status, 403);

    // 7. Owner admin approves revision (200 OK) -> publishes revision and activates parent template
    const ownerApprove = await req(`templates/${created.id}/revisions/${created.revisionId}/approve`, ownerAdminAuth, 'POST');
    assert.equal(ownerApprove.status, 200);

    // 8. Verify activated and published state
    const detailRes = await req(`templates/${created.id}`, officeStaffAuth);
    assert.equal(detailRes.status, 200);
    const detail = (await detailRes.json()) as any;
    assert.equal(detail.status, 'ACTIVE');
    assert.equal(detail.revision_status, 'PUBLISHED');

    const draftRes = await req(`templates/${created.id}/revisions`,officeStaffAuth,'POST',{content:'Pending change'});
    assert.equal(draftRes.status,201); const draft = await draftRes.json() as {id:string;updated_at:string};
    const update = (stamp:string,content:string)=>fetch(`${BASE_URL}/api/v1/workspaces/solarcell/templates/${created.id}/revisions/${draft.id}`,{method:'PUT',headers:{Authorization:officeStaffAuth,'Content-Type':'application/json','If-Match':`"${stamp}"`},body:JSON.stringify({content})});
    const putOk = await update(draft.updated_at,'Saved change');
    assert.equal(putOk.status,200);
    const { updated_at: afterPutStamp } = await putOk.json() as { updated_at: string };
    assert.equal((await update(draft.updated_at,'Stale change')).status,412);
    const patchOk = await req(`templates/${created.id}`, officeStaffAuth, 'PATCH', {
      revision_id: draft.id,
      expected_updated_at: afterPutStamp,
      content: 'Patched change {{client_ref}}',
      sample_file_name: 'workerd-sample.txt',
      mapping_status: 'Mapped',
      output: { category: 'Terms', brand_id: 'solarcell', linked_form_revision_id: null, document_type_id: null, layout: { paper: 'LETTER' }, dynamic_fields: { client_ref: 'customer.name' } },
    });
    assert.equal(patchOk.status, 200);
    const patchStale = await req(`templates/${created.id}`, officeStaffAuth, 'PATCH', {
      revision_id: draft.id,
      expected_updated_at: afterPutStamp,
      content: 'Stale patch {{bad}}',
      sample_file_name: 'stale.txt',
      mapping_status: 'Pending Review',
      output: { category: 'Compliance', brand_id: 'solarcell', linked_form_revision_id: null, document_type_id: null, layout: { paper: 'A4' }, dynamic_fields: { bad: 'job.id' } },
    });
    assert.equal(patchStale.status, 412);
    const afterDraft = await (await req(`templates/${created.id}`,officeStaffAuth)).json() as any;
    assert.equal(afterDraft.current_revision_id,created.revisionId);
    assert.equal(afterDraft.sample_file_name,'workerd-sample.txt');
    const draftAfterPatch = afterDraft.revisions.find((r:any)=>r.id===draft.id);
    assert.equal(draftAfterPatch.content,'Patched change {{client_ref}}');
    assert.deepEqual(draftAfterPatch.output.dynamic_fields,{client_ref:'customer.name'});
    assert.deepEqual(draftAfterPatch.output.layout,{paper:'LETTER'});

    // 9. Immutability trigger proof: direct SQL modification of published revision fails
    assert.throws(
      () => execute(`UPDATE template_revisions SET content = 'tampered' WHERE id = '${created.revisionId}'`),
      /published template revisions are immutable/
    );
  });
  it('creates and publishes a custom form through the real Worker and disposable D1', async () => {
    const req = (path: string, auth: string, method = 'GET', body?: unknown) => fetch(`${BASE_URL}/api/v1/workspaces/solarcell/${path}`, {
      method, headers: { Authorization: auth, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
    });
    const schema = { sections: [{ title: 'Inspection', fields: [
      { key: 'mode', label: 'Mode', type: 'DROPDOWN', choices: ['On', 'Off'], required: true },
      { key: 'result', label: 'Result', type: 'PASS_FAIL', required: true },
      { key: 'sign', label: 'Sign-off', type: 'SIGNATURE', required: true },
    ] }] };
    const draftResponse = await req('form-definitions',officeStaffAuth,'POST',{title:'Unused draft',code:'UNUSED-001',description:'Draft for deletion',category:'Custom',brand_id:'solarcell',schema});
    assert.equal(draftResponse.status,201); const draft = await draftResponse.json() as {id:string};
    assert.equal((await req(`form-definitions/${draft.id}`,officeStaffAuth,'DELETE')).status,200);
    assert.equal((await req(`form-definitions/${draft.id}`,officeStaffAuth)).status,404);
    const typeResponse = await req('document-types',officeStaffAuth,'POST',{code:'INVERTER-001',title:'Inverter certificate'});
    assert.equal(typeResponse.status,201); const type = await typeResponse.json() as {id:string};
    assert.equal((await req(`document-types/${type.id}/publish`,officeStaffAuth,'POST')).status,403);
    assert.equal((await req(`document-types/${type.id}/review`,officeStaffAuth,'POST')).status,200);
    assert.equal((await req(`document-types/${type.id}/publish`,ownerAdminAuth,'POST')).status,200);
    const response = await req('form-definitions', officeStaffAuth, 'POST', { title: 'Solar Inverter Inspection Checklist', code: 'solar_inverter_inspection', description: 'Inspection checklist', category: 'Inspection', brand_id: 'solarcell', schema });
    assert.equal(response.status, 201);
    const form = await response.json() as { id: string; revision_id: string };
    const edited = { sections: [{ title: 'Updated inspection', fields: [schema.sections[0].fields[1], schema.sections[0].fields[0], {key:'details',label:'Failure details',type:'LONG_TEXT',required:false,validation:{max_length:1000},visible_when:{field:'result',equals:'FAIL'}}, schema.sections[0].fields[2]] }] };
    const initialDetail = await (await req(`form-definitions/${form.id}`, officeStaffAuth)).json() as any;
    const initialUpdatedAt = initialDetail.revisions[0].updated_at;
    assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, officeStaffAuth, 'PUT', { ...edited, expected_updated_at: initialUpdatedAt })).status, 200);
    const detail = await (await req(`form-definitions/${form.id}`, officeStaffAuth)).json() as any;
    assert.equal(detail.revisions[0].sections[0].fields[0].key, 'result');
    assert.equal(detail.revisions[0].sections[0].fields[2].visible_when.field, 'result');
    assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/review`, officeStaffAuth, 'POST', { expected_updated_at: detail.revisions[0].updated_at })).status, 200);
    const afterReview = await (await req(`form-definitions/${form.id}`, officeStaffAuth)).json() as any;
    assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}`, officeStaffAuth, 'PUT', { ...edited, expected_updated_at: afterReview.revisions[0].updated_at })).status, 400);
    assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, officeStaffAuth, 'POST')).status, 403);
    assert.equal((await req(`form-definitions/${form.id}/revisions/${form.revision_id}/approve`, ownerAdminAuth, 'POST')).status, 200);
    assert.equal((await req(`form-definitions/${form.id}`,officeStaffAuth,'PATCH',{action:'archive'})).status,200);
    assert.equal((await req(`form-definitions/${form.id}`,officeStaffAuth,'PATCH',{action:'restore'})).status,200);
    const restored = await (await req(`form-definitions/${form.id}`,officeStaffAuth)).json() as any;
    assert.equal(restored.status,'ACTIVE');
    assert.equal(restored.published_revision_id,form.revision_id);
    const published = await (await req('form-definitions?published=1', officeStaffAuth)).json() as any[];
    assert.ok(published.some(item => item.id === form.id && item.published_revision_id === form.revision_id));
    const jobTypeResponse = await req('job-types',officeStaffAuth,'POST',{name:'Inverter Inspection',code:'inverter_check',brandId:'solarcell',isDirectToInvoice:false,formsRequired:[],formRules:[{form_revision_id:form.revision_id,required:true}]});
    assert.equal(jobTypeResponse.status,201); const jobType = await jobTypeResponse.json() as {id:string;policyId:string};
    const jobTypeDetail = await (await req(`job-types/${jobType.id}`,officeStaffAuth)).json() as any;
    assert.ok(jobTypeDetail.policies.find((p:any)=>p.id===jobType.policyId).form_rules.some((r:any)=>r.form_revision_id===form.revision_id));
    assert.equal((await req(`job-types/${jobType.id}/policies/${jobType.policyId}/review`,officeStaffAuth,'POST')).status,200);
    assert.equal((await req(`job-types/${jobType.id}/policies/${jobType.policyId}/approve`,ownerAdminAuth,'POST')).status,200); // With migration 0015 triggers, eligibleCatalog allows policy publication
    const outputResponse = await req('templates', officeStaffAuth, 'POST', { name:'Inverter certificate', templateType:'COMPLIANCE_DISCLAIMER', content:'Inspection output', output:{category:'Compliance',brand_id:'solarcell',document_type_id:type.id,linked_form_revision_id:form.revision_id,layout:{},dynamic_fields:{}} });
    assert.equal(outputResponse.status,201);
    const output = await outputResponse.json() as { id:string; revisionId:string };
    const outputDetail = await (await req(`templates/${output.id}`,officeStaffAuth)).json() as any;
    assert.equal(outputDetail.revisions[0].output.linked_form_revision_id,form.revision_id);
    assert.equal(outputDetail.revisions[0].output.document_type_id,type.id);
    const newDraft = await req(`form-definitions/${form.id}/revisions`, officeStaffAuth, 'POST');
    assert.equal(newDraft.status, 201);
    const revision = await newDraft.json() as { revision_id: string };
    const reloaded = await (await req(`form-definitions/${form.id}`, officeStaffAuth)).json() as any;
    assert.equal(reloaded.published_revision_id, form.revision_id);
    assert.ok(reloaded.revisions.some((r: any) => r.id === revision.revision_id && r.sections[0].fields.length === 4 && r.sections[0].fields[2].visible_when.equals === 'FAIL'));
    assert.throws(() => execute(`UPDATE form_fields SET label = 'tampered' WHERE section_id IN (SELECT id FROM form_sections WHERE revision_id = '${form.revision_id}')`), /immutable/);
  });

});
