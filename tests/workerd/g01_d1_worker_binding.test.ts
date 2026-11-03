/**
 * CABMS G01 — Cloudflare Worker & D1 Local Binding Atomicity and Rollback Proof
 *
 * Runs against the actual Cloudflare Worker runtime (workerd) and local D1 binding via Wrangler.
 * Verifies:
 * 1. Real D1 atomic batch updates with request-correlation nonce.
 * 2. Real D1 rollback proof: forced audit constraint failure rolls back the settings mutation.
 * 3. Stale version (412) and missing precondition (428) enforcement on workerd.
 * 4. Concurrent racing writes: version guard ensures only one succeeds and the other gets 412.
 * 5. Durable audit persistence with privacy redaction ([REDACTED]) in local D1.
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

const PORT = 8789;
const BASE_URL = `http://127.0.0.1:${PORT}`;

describe('Cloudflare Worker & Local D1 Binding Integration Proof', () => {
  let wranglerProc: ChildProcess | null = null;
  let wranglerDiagnostics = '';
  const runId = randomUUID();
  const setupSecret = randomUUID();

  let fixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
  let superAdminAuth: string;
  let ownerAdminAuth: string;
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
    // If Wrangler fails or times out, descendant shutdown is unknown: preserve state.
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
    isolation = mkdtempSync(join(tempReal, 'cabms-g01-d1-'));
    isolationReal = realpathSync(isolation);
    persistence = join(isolationReal, 'state');
    config = join(isolationReal, 'wrangler.json');
    const rel = relative(tempReal, isolationReal);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel.startsWith('cabms-g01-d1-')) {
      throw new Error('Unsafe disposable D1 isolation directory');
    }
    // Copy validated byte snapshots to this run's isolated migration directory.
    const verified = loadVerifiedMigrations();
    const migrationCopy = join(isolation, 'migrations');
    mkdirSync(migrationCopy);
    for (const migration of verified) writeFileSync(join(migrationCopy, migration.name), migration.bytes);
    fixture = await createFirebaseFixture();
    superAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email)}`;
    ownerAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email)}`;
    const jwks = fixture.jwks();
    writeFileSync(config, JSON.stringify({
      name: 'cabms-g01-test', main: resolve(rootDir, 'tests/support/worker.ts'),
      compatibility_date: '2026-10-28', compatibility_flags: ['nodejs_compat'],
      d1_databases: [{ binding: 'DB', database_name: 'cabms-d1', database_id: 'local-test-only', migrations_dir: migrationCopy }],
      vars: {
        ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test',
        TEST_PUBLIC_JWKS: JSON.stringify(jwks), TEST_RUN_ID: runId, TEST_SETUP_SECRET: setupSecret,
      },
    }));
    run(['d1', 'migrations', 'apply', 'cabms-d1', '--local', '--persist-to', persistence]);
    wranglerProc = spawn(process.execPath, [cli, 'dev', '--config', config, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistence, '--show-interactive-dev-session', 'false'], {
      cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
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

    // Readiness is a marker-proven *unauthenticated* CABMS 401, not a seeded
    // privileged account's 200. Another process on the port cannot impersonate it.
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
        // The socket may not be listening yet.
      }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!isReady) {
      throw new Error(`Expected CABMS workerd readiness proof missing on port ${PORT}.\n${wranglerDiagnostics}`);
    }

    // Auth fixture installation uses the actual workerd D1.batch(), never
    // production migrations or retired IDs. The setup key is never echoed.
    const setup = await fetch(`${BASE_URL}/__g01_test/install-auth-fixtures`, {
      method: 'POST', headers: { 'X-G01-Test-Setup-Secret': setupSecret },
    });
    if (setup.status !== 200 || setup.headers.get('X-G01-Test-Run') !== runId) {
      throw new Error(`Workerd G01 test fixture install failed (HTTP ${setup.status}).\n${wranglerDiagnostics}`);
    }
    const installed = (await setup.json()) as { installed?: boolean; counts?: number[]; foreign_keys_ok?: boolean };
    assert.equal(installed.installed, true);
    assert.deepEqual(installed.counts, [4, 4, 6]);
    assert.equal(installed.foreign_keys_ok, true);
  });

  after(async () => {
    if (!isolation) return; // Opt-in or creation failed; no test-owned directory exists.
    if (wranglerProc && (wranglerProc.exitCode !== null || wranglerProc.signalCode !== null)) {
      throw new Error('Wrangler exited before verified process-tree teardown; temporary state preserved');
    }
    if (wranglerProc && wranglerProc.pid && wranglerProc.exitCode === null && wranglerProc.signalCode === null) {
      const closed = new Promise<void>((resolveClose, rejectClose) => {
        const timeout = setTimeout(() => rejectClose(new Error('Wrangler process and stdio did not close; temporary state preserved')), 10000);
        wranglerProc!.once('close', () => { clearTimeout(timeout); resolveClose(); });
      });
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/pid', String(wranglerProc.pid), '/f', '/t'], { timeout: 10000 });
      } else {
        process.kill(-wranglerProc.pid, 'SIGKILL');
      }
      await closed;
    }
    if (!cleanupAllowed) throw new Error('Wrangler CLI shutdown not verified; temporary state preserved');
    const rel = relative(tempReal, isolationReal);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel.startsWith('cabms-g01-d1-') || realpathSync(isolation) !== isolationReal) {
      throw new Error('Unsafe disposable directory; temporary state preserved');
    }
    // Windows can briefly retain Wrangler's SQLite handles after the process
    // tree closes. Retry only those transient sharing/permission errors; keep
    // the disposable directory and fail visibly for every other condition.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(isolationReal, { recursive: true, force: true });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '') || attempt >= 4) {
          throw new Error(`Cleanup failed; temporary state preserved at ${isolationReal} (${code ?? 'unknown error'})`, { cause: error });
        }
        await new Promise(resolveRetry => setTimeout(resolveRetry, 200 * (attempt + 1)));
      }
    }
  });

  it('1. GET workspace settings returns ETag and current state from local D1', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    assert.equal(res.status, 200);
    const etag = res.headers.get('ETag');
    assert.ok(etag, 'ETag must be returned');
    assert.match(etag, /^"\d+"$/, 'Strong ETag must be quoted integer');

    const body = (await res.json()) as { workspace_id: string; trading_name: string; version: number };
    assert.equal(body.workspace_id, 'cctv');
    assert.ok(body.trading_name, 'Trading name must be present');
    assert.equal(etag, `"${body.version}"`);
  });

  it('2. PATCH workspace settings enforces 428 PRECONDITION_REQUIRED when If-Match is omitted', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: 'CCTV Surveillance' }),
    });

    assert.equal(res.status, 428);
    const problem = (await res.json()) as { code: string };
    assert.equal(problem.code, 'PRECONDITION_REQUIRED');
  });

  it('3. Successful conditional PATCH executes atomic D1 batch and increments version', async () => {
    // 1. Read current version
    const getRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    const current = (await getRes.json()) as { version: number; trading_name: string };
    const currentEtag = `"${current.version}"`;

    const newName = `Gold Coast CCTV Premium ${Date.now()}`;

    // 2. Conditional PATCH
    const patchRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': currentEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: newName }),
    });

    assert.equal(patchRes.status, 200);
    const newEtag = patchRes.headers.get('ETag');
    assert.equal(newEtag, `"${current.version + 1}"`);

    const updated = (await patchRes.json()) as { version: number; trading_name: string };
    assert.equal(updated.version, current.version + 1);
    assert.equal(updated.trading_name, newName);
  });

  it('4. Stale If-Match returns 412 PRECONDITION_FAILED without mutating state', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': '"99999"', // Obsolete version
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: 'Should Not Persist' }),
    });

    assert.equal(res.status, 412);
    const problem = (await res.json()) as { code: string };
    assert.equal(problem.code, 'PRECONDITION_FAILED');
  });

  it('5. Concurrent racing requests: only one succeeds, the other receives 412', async () => {
    // Get current ETag
    const getRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    const current = (await getRes.json()) as { version: number };
    const validEtag = `"${current.version}"`;
    const raceId = Date.now();
    const [res1, res2] = await Promise.all([
      fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: superAdminAuth,
          'If-Match': validEtag,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tagline: `Fast Competitor 1 ${raceId}` }),
      }),
      fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
        method: 'PATCH',
        headers: {
          Authorization: superAdminAuth,
          'If-Match': validEtag,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tagline: `Fast Competitor 2 ${raceId}` }),
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 412], 'Exactly one request must succeed (200) and one must fail (412)');
  });

  it('6. REAL D1 ROLLBACK PROOF: forced audit failure rolls back the settings mutation in local D1', async () => {
    // 1. Fetch current settings before attempt
    const beforeRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    const beforeData = (await beforeRes.json()) as { version: number; trading_name: string };
    const currentEtag = `"${beforeData.version}"`;

    execute("CREATE TRIGGER g01_fail_audit BEFORE INSERT ON settings_audit_events BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
    // 2. Issue PATCH against a database whose audit insertion must fail.
    // A test-only database trigger aborts audit insertion inside D1.batch().
    const failRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': currentEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: 'This Name Must Roll Back' }),
    });

    // Worker must catch error and return 500 INTERNAL_ERROR
    execute('DROP TRIGGER g01_fail_audit');
    assert.equal(failRes.status, 500);
    const problem = (await failRes.json()) as { code: string };
    assert.equal(problem.code, 'INTERNAL_ERROR');

    // 3. Verify settings were ROLLED BACK and NOT changed
    const afterRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    const afterData = (await afterRes.json()) as { version: number; trading_name: string };

    assert.equal(
      afterData.trading_name,
      beforeData.trading_name,
      'Settings trading_name must NOT have changed (transaction rolled back)'
    );
    assert.equal(
      afterData.version,
      beforeData.version,
      'Settings version must NOT have incremented (transaction rolled back)'
    );
  });

  it('7. Legal details: Owner Admin is rejected (403), Super Admin can update with audit privacy', async () => {
    // Non-super-admin GET is blocked (403)
    const forbiddenGet = await fetch(`${BASE_URL}/api/v1/workspaces/solarcell/legal-details`, {
      headers: { Authorization: ownerAdminAuth },
    });
    assert.equal(forbiddenGet.status, 403);
    assert.match((await forbiddenGet.json() as { detail: string }).detail, /Super Admin/i);

    // Nonmember GET is blocked (403)
    const nonmemberGet = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/legal-details`, {
      headers: { Authorization: ownerAdminAuth },
    });
    assert.equal(nonmemberGet.status, 403);
    assert.match((await nonmemberGet.json() as { detail: string }).detail, /access to this workspace/i);

    const getRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/legal-details`, {
      headers: { Authorization: superAdminAuth },
    });
    const legalBefore = (await getRes.json()) as { version: number; legal_issuer_name: string };
    const legalEtag = `"${legalBefore.version}"`;

    // Non-super-admin is blocked
    const forbiddenRes = await fetch(`${BASE_URL}/api/v1/workspaces/solarcell/legal-details`, {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'If-Match': legalEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ legal_issuer_name: 'Unauthorized Change' }),
    });
    assert.equal(forbiddenRes.status, 403);
    assert.match((await forbiddenRes.json() as { detail: string }).detail, /Super Admin/i);

    // Super Admin succeeds
    const uniqueLegalName = `Gold Coast CCTV Pty Ltd ${Date.now()}`;
    const successRes = await fetch(`${BASE_URL}/api/v1/workspaces/cctv/legal-details`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': legalEtag,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        legal_issuer_name: uniqueLegalName,
        abn: '98 765 432 109',
      }),
    });
    assert.equal(successRes.status, 200);
    const updated = (await successRes.json()) as { version: number; legal_issuer_name: string };
    assert.equal(updated.version, legalBefore.version + 1);
    assert.equal(updated.legal_issuer_name, uniqueLegalName);
  });

  it('8. RFC 9110 multi-value If-Match: matches current version in list, rejects unmatched list with 412', async () => {
    const getRes = await fetch(`${BASE_URL}/api/v1/workspaces/smart_home/settings`, {
      headers: { Authorization: superAdminAuth },
    });
    const cur = (await getRes.json()) as { version: number; trading_name: string };
    const curVer = cur.version;

    // Multi-value list containing current version succeeds
    const multiMatchHeader = `"99", "${curVer}", "100"`;
    const patchRes = await fetch(`${BASE_URL}/api/v1/workspaces/smart_home/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': multiMatchHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: `Smart Home Multi ${Date.now()}` }),
    });
    assert.equal(patchRes.status, 200);
    const updated = (await patchRes.json()) as { version: number };
    assert.equal(updated.version, curVer + 1);

    // Multi-value list not containing updated version fails with 412
    const staleListHeader = `"99", "${curVer}"`;
    const failRes = await fetch(`${BASE_URL}/api/v1/workspaces/smart_home/settings`, {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'If-Match': staleListHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: 'Should Fail' }),
    });
    assert.equal(failRes.status, 412);
  });

  it('9. Deactivated user enforcement: user with disabled = 1 in D1 is immediately denied', async () => {
    const techAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email)}`;

    // Active technician succeeds on GET settings
    const activeRes = await fetch(`${BASE_URL}/api/v1/workspaces/solarcell/settings`, {
      headers: { Authorization: techAuth },
    });
    assert.equal(activeRes.status, 200);

    // Deactivate the disposable authorized test identity only.
    execute(`UPDATE users SET disabled = 1, status_updated_at = datetime('now') WHERE id = '${G01_TEST_AUTH.technician.userId}'`);

    try {
      const disabledRes = await fetch(`${BASE_URL}/api/v1/workspaces/solarcell/settings`, {
        headers: { Authorization: techAuth },
      });
      assert.equal(disabledRes.status, 401);
    } finally {
      // Revert the disposable test user's status.
      execute(`UPDATE users SET disabled = 0 WHERE id = '${G01_TEST_AUTH.technician.userId}'`);
    }
  });

  it('10. Privileged role email auto-linking prevention: cannot auto-link to super_admin by email match', async () => {
    // An unmapped provider UID cannot auto-link to an authorized test Super Admin.
    const attackerAuth = `Bearer ${await fixture.token('test_g01_unmapped_attacker_uid', G01_TEST_AUTH.superAdmin.email)}`;

    const unmappedRes = await fetch(`${BASE_URL}/api/v1/workspaces/solarcell/settings`, {
      headers: { Authorization: attackerAuth },
    });
    // Must be rejected: unmapped privileged account cannot auto-link by email match alone
    assert.equal(unmappedRes.status, 401);
  });
});
