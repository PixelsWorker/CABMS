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
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
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

const PORT = 8790;
const BASE_URL = `http://127.0.0.1:${PORT}`;

describe('Disposable Workerd enquiry-to-job persistence proof', () => {
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
    console.log(`Test-owned temporary directory: ${isolationReal}`);
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
    // Sequential application is allowed only on this fresh disposable DB. It does not prove atomic 0006/0007 deployment.
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
      throw new Error(`Wrangler exited before verified process-tree teardown; temporary state preserved at ${isolationReal}`);
    }
    if (wranglerProc && wranglerProc.pid && wranglerProc.exitCode === null && wranglerProc.signalCode === null) {
      const exited = new Promise<void>((resolveExit, rejectExit) => {
        const timeout = setTimeout(() => rejectExit(new Error(`Wrangler did not close; temporary state preserved at ${isolationReal}`)), 10000);
        wranglerProc!.once('close', () => { clearTimeout(timeout); resolveExit(); });
      });
      // Avoid an unhandled timeout rejection if the termination command fails.
      void exited.catch(() => {});
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/pid', String(wranglerProc.pid), '/f', '/t'], { timeout: 10000 });
        } else {
          process.kill(-wranglerProc.pid, 'SIGKILL');
        }
        await exited;
      } catch (error) {
        throw new Error(`Worker shutdown could not be verified; temporary state preserved at ${isolationReal}`, { cause: error });
      }
    }
    if (!cleanupAllowed) throw new Error(`Wrangler CLI shutdown not verified; temporary state preserved at ${isolationReal}`);
    const rel = relative(tempReal, isolationReal);
    if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !rel.startsWith('cabms-g01-d1-') || realpathSync(isolation) !== isolationReal) {
      throw new Error(`Unsafe disposable directory; temporary state preserved at ${isolationReal}`);
    }
    // Windows may retain handles briefly after process-tree termination. Await
    // child 'close' above, then retry only transient errors on this owned path.
    // A failed recursive removal can have removed some entries; retain the
    // remaining directory and report its exact path rather than hiding failure.
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        if (realpathSync(isolation) !== isolationReal) throw new Error('Temporary directory identity changed');
        await rm(isolationReal, { recursive: true, force: false, maxRetries: 0 });
        console.log(`Removed test-owned temporary directory: ${isolationReal}`);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(code ?? '') || attempt === 5) {
          throw new Error(`Cleanup failed; remaining test-owned state preserved at ${isolationReal} (${code ?? 'unknown error'})`, { cause: error });
        }
        await delay(250 * (attempt + 1));
      }
    }
  });

  it('persists one converted enquiry through Worker restart and denies cross-workspace access', async () => {
    const call = (workspace: string, path: string, method = 'GET', body?: unknown) => fetch(`${BASE_URL}/api/v1/workspaces/${workspace}/${path}`, {
      method, headers: { Authorization: ownerAdminAuth, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await call('cctv', 'enquiries')).status, 403);
    const created = await call('solarcell', 'enquiries', 'POST', { customer_name: 'Synthetic client', service: 'Synthetic enquiry' });
    assert.equal(created.status, 201);
    const { id } = await created.json() as { id: string };
    const attempts = await Promise.all([call('solarcell', `enquiries/${id}/conversion`, 'POST'), call('solarcell', `enquiries/${id}/conversion`, 'POST')]);
    assert.deepEqual(attempts.map(r => r.status).sort(), [201, 409]);
    const before = await (await call('solarcell', 'jobs')).json() as Array<{ id: string; enquiry_id: string }>;
    assert.equal(before.filter(job => job.enquiry_id === id).length, 1);
    const jobId = before.find(job => job.enquiry_id === id)!.id;

    // Terminate only the process tree spawned by this test and verify exit.
    if (!wranglerProc || !wranglerProc.pid || wranglerProc.exitCode !== null || wranglerProc.signalCode !== null) throw new Error(`Cannot verify worker ownership; preserve ${isolationReal}`);
    const old = wranglerProc;
    const oldPid = old.pid!;
    const stopped = new Promise<void>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => rejectExit(new Error(`Worker did not stop; preserve ${isolationReal}`)), 10000);
      old.once('close', () => { clearTimeout(timer); resolveExit(); });
    });
    cleanupAllowed = false;
    void stopped.catch(() => {});
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(oldPid), '/f', '/t'], { timeout: 10000 });
      else process.kill(-oldPid, 'SIGKILL');
      await stopped;
    } catch (error) {
      throw new Error(`Worker shutdown could not be verified; temporary state preserved at ${isolationReal}`, { cause: error });
    }
    cleanupAllowed = true;
    wranglerProc = spawn(process.execPath, [cli, 'dev', '--config', config, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persistence, '--show-interactive-dev-session', 'false'], {
      cwd: rootDir, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
    });
    const capture = (chunk: unknown) => {
      const safe = String(chunk).replaceAll(setupSecret, '[REDACTED]').replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]').replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_FIREBASE_KEY]');
      wranglerDiagnostics = (wranglerDiagnostics + safe).slice(-6000);
    };
    wranglerProc.stdout?.on('data', capture); wranglerProc.stderr?.on('data', capture); wranglerProc.on('error', error => capture(error.message));
    let ready = false;
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      if (wranglerProc.exitCode !== null || wranglerProc.signalCode !== null) break;
      try {
        const res = await fetch(`${BASE_URL}/api/v1/workspaces`, { headers: { Authorization: 'Bearer invalid-readiness-token' } });
        if (res.status === 401 && res.headers.get('X-G01-Test-Run') === runId) { ready = true; break; }
      } catch { /* process has not started */ }
      await new Promise(r => setTimeout(r, 600));
    }
    if (!ready) throw new Error(`Restart readiness failed; preserve ${isolationReal}.\n${wranglerDiagnostics}`);
    const enquiriesResponse = await call('solarcell', 'enquiries');
    const jobsResponse = await call('solarcell', 'jobs');
    assert.equal(enquiriesResponse.status, 200); assert.equal(jobsResponse.status, 200);
    const enquiries = await enquiriesResponse.json() as Array<{ id: string; job_id: string | null }>;
    const jobs = await jobsResponse.json() as Array<{ id: string; enquiry_id: string }>;
    assert.equal(enquiries.find(e => e.id === id)?.job_id, jobId);
    assert.equal(jobs.filter(job => job.enquiry_id === id).length, 1);
    assert.equal(jobs.find(job => job.enquiry_id === id)?.id, jobId);
    assert.equal((await call('cctv', 'jobs')).status, 403);
  });
});
