/**
 * CABMS F06 — Cloudflare Worker & D1 Local Binding Single-Batch Atomicity & Concurrency Proof
 *
 * Runs against the actual Cloudflare Worker runtime (workerd) and local D1 binding via Wrangler.
 * Verifies:
 * 1. Overlapping saves with the same starting version produce [200, 409] and preserve only the winner's content.
 * 2. Concurrent reader never observes a half-committed state (new version with old content or vice versa), and sequential save succeeds.
 * 3. Save vs review submission at the concurrency boundary produces [200, 409] with consistent final status & content.
 * 4. Injected dependent mutation failure rolls back the entire transaction including form_revisions.updated_at.
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

const PORT = 8794;
const BASE_URL = `http://127.0.0.1:${PORT}`;

type FormRevisionDetail = {
  id: string;
  status: string;
  updated_at: string;
  sections: Array<{
    id: string;
    title: string;
    fields: Array<{ key: string; label: string; type: string; required: number }>;
  }>;
};

type FormDefinitionDetail = {
  id: string;
  revisions: FormRevisionDetail[];
};

describe('F06 Form Revision Single-Batch Atomicity & Concurrency — workerd & Local D1', () => {
  let wranglerProc: ChildProcess | null = null;
  let wranglerDiagnostics = '';
  const runId = randomUUID();
  const setupSecret = randomUUID();

  let fixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
  let officeStaffAuth: string;

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
    const output = execFileSync(process.execPath, [cli, ...args, '--config', config], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 60000,
    });
    cleanupAllowed = true;
    return output;
  };
  const execute = (sql: string) =>
    run(['d1', 'execute', 'cabms-d1', '--local', '--persist-to', persistence, '--command', sql]);

  const api = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${BASE_URL}/api/v1/workspaces/solarcell/${path}`, {
      method,
      headers: {
        Authorization: officeStaffAuth,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const getFormDetail = async (formId: string): Promise<FormDefinitionDetail> => {
    const res = await api(`form-definitions/${formId}`);
    assert.equal(res.status, 200);
    return (await res.json()) as FormDefinitionDetail;
  };

  const createDraftAndSaveV1 = async (code: string) => {
    const initialSchema = {
      sections: [
        {
          title: 'Initial V0 Section',
          fields: [{ key: 'v0_field', label: 'V0 Field', type: 'TEXT', required: true }],
        },
      ],
    };
    const createRes = await api('form-definitions', 'POST', {
      title: `Concurrency Form ${code}`,
      code,
      description: 'F06 single-batch atomicity test form',
      category: 'Custom',
      brand_id: 'solarcell',
      schema: initialSchema,
    });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { id: string; revision_id: string };
    const detail0 = await getFormDetail(created.id);
    const rev0 = detail0.revisions.find(r => r.id === created.revision_id);
    assert.ok(rev0?.updated_at);

    const v1Schema = {
      sections: [
        {
          title: 'V1 Baseline Section',
          fields: [{ key: 'v1_field', label: 'V1 Field', type: 'TEXT', required: true }],
        },
      ],
    };
    const putV1 = await api(
      `form-definitions/${created.id}/revisions/${created.revision_id}`,
      'PUT',
      v1Schema,
      { 'If-Match': rev0.updated_at },
    );
    assert.equal(putV1.status, 200);
    const putV1Body = (await putV1.json()) as { success: boolean; updated_at: string };
    assert.equal(putV1Body.success, true);
    assert.ok(putV1Body.updated_at);
    assert.notEqual(putV1Body.updated_at, rev0.updated_at);

    return {
      formId: created.id,
      revisionId: created.revision_id,
      v1: putV1Body.updated_at,
      v1Schema,
    };
  };

  before(async () => {
    if (process.env.CABMS_DISPOSABLE_D1_TEST !== '1') {
      throw new Error('Set CABMS_DISPOSABLE_D1_TEST=1 only for separately authorized disposable local D1 tests');
    }
    tempReal = realpathSync(tmpdir());
    isolation = mkdtempSync(join(tempReal, 'cabms-f06-workerd-'));
    isolationReal = realpathSync(isolation);
    persistence = join(isolationReal, 'state');
    config = join(isolationReal, 'wrangler.json');
    const rel = relative(tempReal, isolationReal);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel.startsWith('cabms-f06-workerd-')) {
      throw new Error('Unsafe disposable D1 isolation directory');
    }

    const verified = loadVerifiedMigrations();
    const migrationCopy = join(isolation, 'migrations');
    mkdirSync(migrationCopy);
    for (const migration of verified) writeFileSync(join(migrationCopy, migration.name), migration.bytes);

    fixture = await createFirebaseFixture();
    officeStaffAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email)}`;

    const jwks = fixture.jwks();
    writeFileSync(config, JSON.stringify({
      name: 'cabms-f06-test',
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

    wranglerProc = spawn(
      process.execPath,
      [cli, 'dev', '--config', config, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistence, '--show-interactive-dev-session', 'false'],
      { cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' },
    );

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
        if (
          res.status === 401
          && res.headers.get('X-G01-Test-Run') === runId
          && res.headers.get('Content-Type')?.includes('application/problem+json')
        ) {
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
      throw new Error(`Workerd F06 test fixture install failed (HTTP ${setup.status}).\n${wranglerDiagnostics}`);
    }
  });

  after(async () => {
    if (!isolation) return;
    if (wranglerProc && wranglerProc.pid && wranglerProc.exitCode === null && wranglerProc.signalCode === null) {
      const closed = new Promise<void>(resolveClose => {
        const timeout = setTimeout(resolveClose, 10000);
        wranglerProc!.once('close', () => { clearTimeout(timeout); resolveClose(); });
      });
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/pid', String(wranglerProc.pid), '/f', '/t'], { timeout: 10000 });
        } else {
          process.kill(-wranglerProc.pid, 'SIGKILL');
        }
      } catch {
        // ignore
      }
      await closed;
    }
    if (cleanupAllowed && isolationReal && isolationReal.includes('cabms-f06-workerd-')) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          rmSync(isolationReal, { recursive: true, force: true });
          break;
        } catch {
          await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
        }
      }
    }
  });

  it('Test 1 — Overlapping saves with the same starting version', async () => {
    const { formId, revisionId, v1 } = await createDraftAndSaveV1('F06_TEST_1');

    const schemaA = {
      sections: [
        {
          title: 'Concurrent Alpha Section',
          fields: [
            { key: 'alpha_one', label: 'Alpha One', type: 'TEXT', required: true },
            { key: 'alpha_two', label: 'Alpha Two', type: 'NUMBER', required: false },
          ],
        },
      ],
    };
    const schemaB = {
      sections: [
        {
          title: 'Concurrent Beta Section',
          fields: [{ key: 'beta_one', label: 'Beta One', type: 'PASS_FAIL', required: true }],
        },
      ],
    };

    const [resA, resB] = await Promise.all([
      api(`form-definitions/${formId}/revisions/${revisionId}`, 'PUT', schemaA, { 'If-Match': v1 }),
      api(`form-definitions/${formId}/revisions/${revisionId}`, 'PUT', schemaB, { 'If-Match': v1 }),
    ]);

    assert.deepEqual([resA.status, resB.status].sort(), [200, 409]);

    const winnerIsA = resA.status === 200;
    const winnerRes = winnerIsA ? resA : resB;
    const loserRes = winnerIsA ? resB : resA;
    const winnerSchema = winnerIsA ? schemaA : schemaB;

    const winnerBody = (await winnerRes.json()) as { success: boolean; updated_at: string };
    const loserBody = (await loserRes.json()) as { code?: string };
    assert.equal(winnerBody.success, true);
    assert.ok(winnerBody.updated_at);
    assert.notEqual(winnerBody.updated_at, v1);
    assert.equal(loserBody.code, 'VERSION_CONFLICT');

    const detail = await getFormDetail(formId);
    const rev = detail.revisions.find(r => r.id === revisionId);
    assert.ok(rev);
    assert.equal(rev.updated_at, winnerBody.updated_at);
    assert.notEqual(rev.updated_at, v1);
    assert.deepEqual(
      rev.sections.map(s => ({
        title: s.title,
        fields: s.fields.map(f => f.key),
      })),
      winnerSchema.sections.map(s => ({
        title: s.title,
        fields: s.fields.map(f => f.key),
      })),
    );
  });

  it('Test 2 — Concurrent reader never sees half-committed state and sequential save advances to V3', async () => {
    const { formId, revisionId, v1 } = await createDraftAndSaveV1('F06_TEST_2');

    const schemaA = {
      sections: [
        {
          title: 'Atomic Read Check A',
          fields: [
            { key: 'read_a1', label: 'Read A1', type: 'TEXT', required: true },
            { key: 'read_a2', label: 'Read A2', type: 'CHECKBOX', required: false },
          ],
        },
      ],
    };

    const [putARes, concurrentGetRes] = await Promise.all([
      api(`form-definitions/${formId}/revisions/${revisionId}`, 'PUT', schemaA, { 'If-Match': v1 }),
      api(`form-definitions/${formId}`, 'GET'),
    ]);

    assert.equal(putARes.status, 200);
    const putABody = (await putARes.json()) as { success: boolean; updated_at: string };
    assert.ok(putABody.updated_at);
    assert.notEqual(putABody.updated_at, v1);

    // The concurrent GET must see either the complete V1 state or the complete V2 (A) state, never a split state.
    assert.equal(concurrentGetRes.status, 200);
    const concurrentDetail = (await concurrentGetRes.json()) as FormDefinitionDetail;
    const concurrentRev = concurrentDetail.revisions.find(r => r.id === revisionId)!;
    if (concurrentRev.updated_at === v1) {
      assert.deepEqual(concurrentRev.sections.map(s => s.title), ['V1 Baseline Section']);
      assert.deepEqual(concurrentRev.sections[0].fields.map(f => f.key), ['v1_field']);
    } else {
      assert.equal(concurrentRev.updated_at, putABody.updated_at);
      assert.deepEqual(concurrentRev.sections.map(s => s.title), ['Atomic Read Check A']);
      assert.deepEqual(concurrentRev.sections[0].fields.map(f => f.key), ['read_a1', 'read_a2']);
    }

    // Subsequent GET after A completes must match A's updated_at and full payload.
    const afterADetail = await getFormDetail(formId);
    const afterARev = afterADetail.revisions.find(r => r.id === revisionId)!;
    assert.equal(afterARev.updated_at, putABody.updated_at);
    assert.deepEqual(afterARev.sections.map(s => s.title), ['Atomic Read Check A']);
    assert.deepEqual(afterARev.sections[0].fields.map(f => f.key), ['read_a1', 'read_a2']);

    // Second PUT using A's updated_at produces V3.
    const schemaV3 = {
      sections: [
        {
          title: 'Sequential V3 Section',
          fields: [{ key: 'v3_field', label: 'V3 Field', type: 'DATE', required: true }],
        },
      ],
    };
    const putV3Res = await api(
      `form-definitions/${formId}/revisions/${revisionId}`,
      'PUT',
      schemaV3,
      { 'If-Match': putABody.updated_at },
    );
    assert.equal(putV3Res.status, 200);
    const putV3Body = (await putV3Res.json()) as { success: boolean; updated_at: string };
    assert.notEqual(putV3Body.updated_at, v1);
    assert.notEqual(putV3Body.updated_at, putABody.updated_at);

    const afterV3Detail = await getFormDetail(formId);
    const afterV3Rev = afterV3Detail.revisions.find(r => r.id === revisionId)!;
    assert.equal(afterV3Rev.updated_at, putV3Body.updated_at);
    assert.deepEqual(afterV3Rev.sections.map(s => s.title), ['Sequential V3 Section']);
    assert.deepEqual(afterV3Rev.sections[0].fields.map(f => f.key), ['v3_field']);
  });

  it('Test 3 — Save versus review submission at the concurrency boundary', async () => {
    const { formId, revisionId, v1 } = await createDraftAndSaveV1('F06_TEST_3');

    const saveSchema = {
      sections: [
        {
          title: 'Competing Save Section',
          fields: [{ key: 'competing_field', label: 'Competing Field', type: 'TEXT', required: true }],
        },
      ],
    };

    const [putRes, reviewRes] = await Promise.all([
      api(`form-definitions/${formId}/revisions/${revisionId}`, 'PUT', saveSchema, { 'If-Match': v1 }),
      api(`form-definitions/${formId}/revisions/${revisionId}/review`, 'POST', { expected_updated_at: v1 }),
    ]);

    assert.deepEqual([putRes.status, reviewRes.status].sort(), [200, 409]);

    const detail = await getFormDetail(formId);
    const rev = detail.revisions.find(r => r.id === revisionId)!;

    if (putRes.status === 200) {
      const putBody = (await putRes.json()) as { updated_at: string };
      assert.equal(rev.status, 'DRAFT');
      assert.equal(rev.updated_at, putBody.updated_at);
      assert.deepEqual(rev.sections.map(s => s.title), ['Competing Save Section']);
      assert.deepEqual(rev.sections[0].fields.map(f => f.key), ['competing_field']);
    } else {
      const reviewBody = (await reviewRes.json()) as { updated_at: string };
      assert.equal(rev.status, 'REVIEW');
      assert.equal(rev.updated_at, reviewBody.updated_at);
      assert.deepEqual(rev.sections.map(s => s.title), ['V1 Baseline Section']);
      assert.deepEqual(rev.sections[0].fields.map(f => f.key), ['v1_field']);
    }
  });

  it('Test 4 — Injected dependent mutation failure rolls back the entire transaction including updated_at', async () => {
    const { formId, revisionId, v1 } = await createDraftAndSaveV1('F06_TEST_4');

    const failedSchema = {
      sections: [
        {
          title: 'Should Roll Back Completely',
          fields: [{ key: 'rollback_field', label: 'Rollback Field', type: 'TEXT', required: true }],
        },
      ],
    };

    execute("CREATE TRIGGER f06_fail_section_insert BEFORE INSERT ON form_sections BEGIN SELECT RAISE(ABORT, 'injected dependent section failure'); END;");
    let putRes: Response;
    try {
      putRes = await api(
        `form-definitions/${formId}/revisions/${revisionId}`,
        'PUT',
        failedSchema,
        { 'If-Match': v1 },
      );
    } finally {
      execute('DROP TRIGGER IF EXISTS f06_fail_section_insert;');
    }

    assert.equal(putRes.status, 500);
    const errBody = (await putRes.json()) as { error?: string; detail?: string };
    assert.match(errBody.error ?? '', /rolled back/i);
    assert.match(errBody.detail ?? '', /injected dependent section failure/i);

    // Both form_revisions.updated_at AND all deleted/inserted sections & fields must be completely rolled back to V1.
    const afterFailDetail = await getFormDetail(formId);
    const afterFailRev = afterFailDetail.revisions.find(r => r.id === revisionId)!;
    assert.equal(afterFailRev.status, 'DRAFT');
    assert.equal(afterFailRev.updated_at, v1, 'form_revisions.updated_at must be rolled back to V1');
    assert.deepEqual(afterFailRev.sections.map(s => s.title), ['V1 Baseline Section']);
    assert.deepEqual(afterFailRev.sections[0].fields.map(f => f.key), ['v1_field']);

    // Verify recovery: a subsequent valid PUT with V1 succeeds and maintains complete structural integrity.
    const recoverySchema = {
      sections: [
        {
          title: 'Recovered Section',
          fields: [
            { key: 'rec_field_1', label: 'Recovered 1', type: 'TEXT', required: true },
            { key: 'rec_field_2', label: 'Recovered 2', type: 'NUMBER', required: false },
          ],
        },
      ],
    };
    const recRes = await api(
      `form-definitions/${formId}/revisions/${revisionId}`,
      'PUT',
      recoverySchema,
      { 'If-Match': v1 },
    );
    assert.equal(recRes.status, 200);
    const recBody = (await recRes.json()) as { updated_at: string };
    const afterRecDetail = await getFormDetail(formId);
    const afterRecRev = afterRecDetail.revisions.find(r => r.id === revisionId)!;
    assert.equal(afterRecRev.updated_at, recBody.updated_at);
    assert.equal(afterRecRev.sections.length, 1);
    assert.equal(afterRecRev.sections[0].title, 'Recovered Section');
    assert.deepEqual(afterRecRev.sections[0].fields.map(f => f.key), ['rec_field_1', 'rec_field_2']);
  });
});
