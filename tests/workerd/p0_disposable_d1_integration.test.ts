/**
 * CABMS PAAR-P0 Mode A — Disposable Local workerd & Real D1 Integration Test Suite
 *
 * Runs against the actual Cloudflare Workers runtime (workerd) and Miniflare-backed
 * real D1 binding via pinned Wrangler createTestHarness().
 *
 * Verifies:
 * 1. Real local workerd execution with an actual disposable D1 binding.
 * 2. Synthetic authentication & protected self-link denial (/api/v1/auth/me).
 * 3. CLI rejection of workerd D1 handle (isDisposableInMemoryD1 guard defense-in-depth).
 * 4. Atomic first-admin enrollment against real D1 binding.
 * 5. Post-enrollment authorized access with super_admin privileges on workerd.
 * 6. Real D1 audit manifest immutability and conflict triggers (REPLACE, UPDATE, DELETE aborts).
 * 7. Incomplete-state privilege denial and replay rollback proof on real D1.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { isDisposableInMemoryD1, type D1Database } from '../../backend/db/d1.ts';
import {
  signApprovalManifest,
  verifyApprovalManifest,
  type ApprovalManifest,
} from '../../scripts/p0/approvalManifest.ts';
import {
  enrollFirstSuperAdmin,
} from '../../scripts/p0/firstSuperAdminEnrollment.ts';
import {
  runModeACliEnrollment,
  SecurityBoundaryError,
} from '../../scripts/p0/firstSuperAdminCli.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

const require = createRequire(import.meta.url);
const { createTestHarness } = require('wrangler');

/**
 * Safely removes a disposable isolation directory after validating that its canonical
 * path is strictly contained within the allowed root directory.
 * Returns true if contained and successfully deleted, false otherwise.
 */
export function safeTeardownDisposableDirectory(targetDir: string | undefined, allowedRoot: string): boolean {
  if (!targetDir) return false;
  let targetReal: string;
  try {
    targetReal = fs.realpathSync(targetDir);
  } catch {
    return false;
  }
  let rootReal: string;
  try {
    rootReal = fs.realpathSync(allowedRoot);
  } catch {
    return false;
  }
  const rel = path.relative(rootReal, targetReal);
  const isContained = Boolean(rel && !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
  if (!isContained) {
    return false;
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      fs.rmSync(targetReal, { recursive: true, force: true });
      lastError = undefined;
      break;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError && fs.existsSync(targetReal)) {
    console.error(`Failed to remove disposable isolation directory '${targetReal}':`, lastError);
    return false;
  }
  return true;
}

if (process.env.CABMS_DISPOSABLE_D1_TEST === '1') {
  describe('CABMS PAAR-P0 — Real Disposable workerd & D1 Integration', () => {
  let server: any;
  let worker: any;
  let workerUrl: URL;
  let realD1: D1Database;
  let workerW7: any;
  let w7D1: D1Database;
  let workerW9: any;
  let w9D1: D1Database;
  let workerW11: any;
  let w11D1: D1Database;
  let isolationDir: string;
  let isolationReal: string;
  let tempReal: string;

  let ephemeralKeyPair: ReturnType<typeof crypto.generateKeyPairSync>;
  let firebaseFixture: Awaited<ReturnType<typeof createFirebaseFixture>>;

  const runId = crypto.randomUUID();
  const setupSecret = crypto.randomUUID();

  const SYNTHETIC_TARGET = 'cabms-d1-test';
  const PROTECTED_EMAIL = 'admin@chinedigital.com.au';
  const SYNTHETIC_OPERATOR_UID = 'p0_workerd_operator_uid_secure_128';
  const SYNTHETIC_WORKSPACES = ['solarcell', 'smart_home', 'cctv'];

  const DEFAULT_VERIFY_OPTIONS = {
    expectedTargetId: SYNTHETIC_TARGET,
    expectedOperatorUid: SYNTHETIC_OPERATOR_UID,
    expectedOperatorEmail: PROTECTED_EMAIL,
  } as const;

  let enrolledManifest: ApprovalManifest;
  let verifiedEnrolledManifest: ReturnType<typeof verifyApprovalManifest>;

  before(async () => {
    if (process.env.CABMS_DISPOSABLE_D1_TEST !== '1') {
      throw new Error(
        'Set CABMS_DISPOSABLE_D1_TEST=1 to authorize real disposable local workerd/D1 execution'
      );
    }

    tempReal = fs.realpathSync(os.tmpdir());
    const candidateDir = fs.mkdtempSync(path.join(tempReal, 'cabms-p0-workerd-'));
    const candidateReal = fs.realpathSync(candidateDir);

    const rel = path.relative(tempReal, candidateReal);
    if (!rel || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
      throw new Error('Unsafe disposable workerd isolation directory path escape');
    }

    // Assign to cleanup targets only AFTER containment validation passes
    isolationDir = candidateDir;
    isolationReal = candidateReal;

    // 1. Copy validated migrations 0001 through 0011 into ephemeral migrations directory
    const verified = loadVerifiedMigrations();
    const migrationDir = path.join(isolationReal, 'migrations');
    fs.mkdirSync(migrationDir);
    for (const migration of verified) {
      fs.writeFileSync(path.join(migrationDir, migration.name), migration.bytes);
    }

    // 2. Initialize synthetic crypto & token fixture
    ephemeralKeyPair = crypto.generateKeyPairSync('ed25519');
    firebaseFixture = await createFirebaseFixture();
    const jwks = firebaseFixture.jwks();

    // 3. Write ephemeral Wrangler configurations targeting tests/support/worker.ts
    // Main worker: tests W1-W6, W8
    const workerEntryPath = path.resolve(rootDir, 'tests/support/worker.ts');
    const configPathMain = path.join(isolationReal, 'wrangler-main.json');
    fs.writeFileSync(
      configPathMain,
      JSON.stringify({
        name: 'cabms-p0-workerd-worker',
        main: workerEntryPath,
        compatibility_date: '2026-10-28',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'cabms-d1',
            database_id: 'local-test-only',
            migrations_dir: migrationDir,
          },
        ],
        vars: {
          ENVIRONMENT: 'test',
          FIREBASE_PROJECT_ID: 'cabms-test',
          TEST_PUBLIC_JWKS: JSON.stringify(jwks),
          TEST_RUN_ID: runId,
          TEST_SETUP_SECRET: setupSecret,
        },
      })
    );

    // Dedicated W7 worker with isolated D1 binding for real D1 rollback proof
    const configPathW7 = path.join(isolationReal, 'wrangler-w7.json');
    fs.writeFileSync(
      configPathW7,
      JSON.stringify({
        name: 'cabms-p0-workerd-w7-worker',
        main: workerEntryPath,
        compatibility_date: '2026-10-28',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'cabms-d1-w7',
            database_id: 'local-w7-only',
            migrations_dir: migrationDir,
          },
        ],
        vars: {
          ENVIRONMENT: 'test',
          FIREBASE_PROJECT_ID: 'cabms-test',
          TEST_PUBLIC_JWKS: JSON.stringify(jwks),
          TEST_RUN_ID: runId,
          TEST_SETUP_SECRET: setupSecret,
        },
      })
    );

    // Dedicated W9 worker with isolated D1 binding for real workerd runtime privilege denial
    const configPathW9 = path.join(isolationReal, 'wrangler-w9.json');
    fs.writeFileSync(
      configPathW9,
      JSON.stringify({
        name: 'cabms-p0-workerd-w9-worker',
        main: workerEntryPath,
        compatibility_date: '2026-10-28',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'cabms-d1-w9',
            database_id: 'local-w9-only',
            migrations_dir: migrationDir,
          },
        ],
        vars: {
          ENVIRONMENT: 'test',
          FIREBASE_PROJECT_ID: 'cabms-test',
          TEST_PUBLIC_JWKS: JSON.stringify(jwks),
          TEST_RUN_ID: runId,
          TEST_SETUP_SECRET: setupSecret,
        },
      })
    );

    // Dedicated W11 worker with isolated D1 binding for real D1 N=21 100-parameter boundary proof
    const configPathW11 = path.join(isolationReal, 'wrangler-w11.json');
    fs.writeFileSync(
      configPathW11,
      JSON.stringify({
        name: 'cabms-p0-workerd-w11-worker',
        main: workerEntryPath,
        compatibility_date: '2026-10-28',
        compatibility_flags: ['nodejs_compat'],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'cabms-d1-w11',
            database_id: 'local-w11-only',
            migrations_dir: migrationDir,
          },
        ],
        vars: {
          ENVIRONMENT: 'test',
          FIREBASE_PROJECT_ID: 'cabms-test',
          TEST_PUBLIC_JWKS: JSON.stringify(jwks),
          TEST_RUN_ID: runId,
          TEST_SETUP_SECRET: setupSecret,
        },
      })
    );

    // 4. Launch disposable test harness via pinned Wrangler createTestHarness
    server = createTestHarness({
      workers: [
        { configPath: configPathMain },
        { configPath: configPathW7 },
        { configPath: configPathW9 },
        { configPath: configPathW11 },
      ],
    });

    const listenResult = await server.listen();
    workerUrl = new URL(listenResult.url.href);
    worker = server.getWorker('cabms-p0-workerd-worker');
    workerW7 = server.getWorker('cabms-p0-workerd-w7-worker');
    workerW9 = server.getWorker('cabms-p0-workerd-w9-worker');
    workerW11 = server.getWorker('cabms-p0-workerd-w11-worker');

    // 5. Apply migrations 0001 through 0011 to real D1 instances
    await worker.applyD1Migrations('DB');
    await workerW7.applyD1Migrations('DB');
    await workerW9.applyD1Migrations('DB');
    await workerW11.applyD1Migrations('DB');

    // 6. Obtain real D1 bindings for test verification
    const env = await worker.getEnv();
    realD1 = env.DB;

    const envW7 = await workerW7.getEnv();
    w7D1 = envW7.DB;

    const envW9 = await workerW9.getEnv();
    w9D1 = envW9.DB;

    const envW11 = await workerW11.getEnv();
    w11D1 = envW11.DB;
  });

  after(async () => {
    if (server) {
      try {
        await server.close();
      } catch {
        // Best effort close
      }
    }

    if (isolationReal && tempReal) {
      safeTeardownDisposableDirectory(isolationReal, tempReal);
    }
  });

  function createValidSyntheticManifest(overrides?: Partial<ApprovalManifest>): ApprovalManifest {
    return {
      operation_id: overrides?.operation_id ?? `op_${crypto.randomUUID()}`,
      nonce: `nonce_p0_${crypto.randomUUID()}`,
      target_id: SYNTHETIC_TARGET,
      operator_email: PROTECTED_EMAIL,
      operator_uid: SYNTHETIC_OPERATOR_UID,
      workspace_scope: [...SYNTHETIC_WORKSPACES],
      permitted_action: 'bootstrap_super_admin',
      issued_at: new Date(Date.now() - 5000).toISOString(),
      expires_at: new Date(Date.now() + 300000).toISOString(),
      signing_key_id: 'ephemeral_p0_key_01',
      approval_identity: 'rockson-mode-a-synthetic-auth',
      ...overrides,
    };
  }

  // --- Scenario 1: Real local workerd execution & unauthenticated denial ---
  it('W1: unauthenticated requests and unmapped synthetic operator receive 401 on workerd', async () => {
    // 1. Unauthenticated request without Authorization header
    const resNoAuth = await fetch(`${workerUrl.origin}/api/v1/auth/me`);
    assert.equal(resNoAuth.status, 401);
    const bodyNoAuth = (await resNoAuth.json()) as { code: string };
    assert.equal(bodyNoAuth.code, 'AUTHENTICATION_REQUIRED');

    // 2. Unmapped synthetic operator token
    const unmappedToken = await firebaseFixture.token('unmapped_uid_workerd', 'unmapped@example.invalid');
    const resUnmapped = await fetch(`${workerUrl.origin}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${unmappedToken}` },
    });
    assert.equal(resUnmapped.status, 401);
  });

  // --- Scenario 2: Protected self-link denial on workerd ---
  it('W2: protected first-admin automatic self-link is blocked with synthetic claim on workerd', async () => {
    // Seed enabled user with PROTECTED_EMAIL without identity mappings or privileged memberships
    await realD1.prepare(`
      INSERT INTO users (id, email, display_name, disabled, created_at, updated_at)
      VALUES ('usr_w2_victim', ?, 'Victim Operator', 0, datetime('now'), datetime('now'))
    `).bind(PROTECTED_EMAIL).run();

    try {
      const fakeToken = await firebaseFixture.token('uninvited_attacker_uid', PROTECTED_EMAIL);
      const res = await fetch(`${workerUrl.origin}/api/v1/auth/me`, {
        headers: { Authorization: `Bearer ${fakeToken}` },
      });
      assert.equal(res.status, 401);

      // Verify 0 rows in user_identity_mappings on real D1
      const count = await realD1
        .prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE provider_subject_id = 'uninvited_attacker_uid'")
        .first<{ n: number }>();
      assert.equal(count?.n, 0);
    } finally {
      await realD1.prepare("DELETE FROM users WHERE id = 'usr_w2_victim'").run();
    }
  });

  // --- Scenario 3: CLI defense-in-depth rejects workerd D1 binding ---
  it('W3: runModeACliEnrollment strictly rejects workerd D1 binding (preserving isDisposableInMemoryD1 guard)', async () => {
    // Confirm realD1 does NOT pass the WeakSet-backed in-memory factory check
    assert.equal(isDisposableInMemoryD1(realD1), false);

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    await assert.rejects(
      () =>
        runModeACliEnrollment(realD1, signed, ephemeralKeyPair.publicKey, {
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_OPERATOR_UID,
          expectedOperatorEmail: PROTECTED_EMAIL,
        }),
      (err: any) =>
        err instanceof SecurityBoundaryError &&
        err.message.includes('Mode A CLI requires verified disposable local database boundary from trusted factory')
    );
  });

  // --- Scenario 4: Atomic enrollment against real D1 binding ---
  it('W4: successful first-admin enrollment executes transaction against real D1 with audit and completion', async () => {
    enrolledManifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(enrolledManifest, ephemeralKeyPair.privateKey);
    verifiedEnrolledManifest = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    // Execute atomic enrollment against real D1 binding
    const outcome = await enrollFirstSuperAdmin(realD1, verifiedEnrolledManifest);
    assert.equal(outcome.status, 'SUCCESS');

    // Verify audit record exists on real D1
    const auditRow = await realD1
      .prepare('SELECT audit_reference FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?')
      .bind(verifiedEnrolledManifest.manifest.operation_id)
      .first<{ audit_reference: string }>();
    assert.equal(auditRow?.audit_reference, verifiedEnrolledManifest.audit_reference);

    // Verify completion record on real D1
    const compRow = await realD1
      .prepare('SELECT original_firebase_uid, audit_reference FROM g01_bootstrap_completion WHERE singleton = 1')
      .first<{ original_firebase_uid: string; audit_reference: string }>();
    assert.equal(compRow?.original_firebase_uid, SYNTHETIC_OPERATOR_UID);
    assert.equal(compRow?.audit_reference, verifiedEnrolledManifest.audit_reference);
  });

  // --- Scenario 5: Post-enrollment authorized access on workerd ---
  it('W5: enrolled operator token authenticates on workerd with super_admin privileges', async () => {
    const operatorToken = await firebaseFixture.token(SYNTHETIC_OPERATOR_UID, PROTECTED_EMAIL);
    const authRes = await fetch(`${workerUrl.origin}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${operatorToken}` },
    });
    assert.equal(authRes.status, 200);

    const authBody = (await authRes.json()) as {
      user: { id: string; email: string };
      memberships: Array<{ workspace_id: string; role: string }>;
    };
    assert.equal(authBody.user.id, 'usr_primary_super_admin');
    assert.equal(authBody.user.email, PROTECTED_EMAIL);
    assert.equal(authBody.memberships.length, 3);
    for (const mem of authBody.memberships) {
      assert.equal(mem.role, 'super_admin');
      assert.ok(SYNTHETIC_WORKSPACES.includes(mem.workspace_id));
    }
  });

  // --- Scenario 6: Real D1 audit triggers enforce immutability & reject replacement ---
  it('W6: real D1 audit triggers block INSERT OR REPLACE, UPDATE, and DELETE', async () => {
    // 1a. Verify BEFORE INSERT trigger blocks duplicate operation_id with fresh nonce and audit reference
    await assert.rejects(
      () =>
        realD1
          .prepare(
            `INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
              id, operation_id, nonce, target_id, operator_email, operator_uid,
              workspace_scope, permitted_action, signing_key_id, signature_algorithm,
              signature_bytes, canonical_manifest_json, audit_reference, created_at
            ) VALUES ('audit_workerd_replace_op', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            verifiedEnrolledManifest.manifest.operation_id, // reuse operation_id only
            `nonce_fresh_${crypto.randomUUID()}`, // fresh nonce
            verifiedEnrolledManifest.manifest.target_id,
            verifiedEnrolledManifest.manifest.operator_email,
            verifiedEnrolledManifest.manifest.operator_uid,
            verifiedEnrolledManifest.manifest.workspace_scope.join(','),
            verifiedEnrolledManifest.manifest.permitted_action,
            verifiedEnrolledManifest.signing_key_id,
            verifiedEnrolledManifest.signature_algorithm,
            verifiedEnrolledManifest.signature_bytes,
            verifiedEnrolledManifest.canonical_manifest_json,
            `ref_fresh_${crypto.randomUUID()}` // fresh audit_reference
          )
          .run(),
      /audit manifest records cannot be replaced/
    );

    // 1b. Verify BEFORE INSERT trigger blocks duplicate nonce with fresh operation_id and audit reference
    await assert.rejects(
      () =>
        realD1
          .prepare(
            `INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
              id, operation_id, nonce, target_id, operator_email, operator_uid,
              workspace_scope, permitted_action, signing_key_id, signature_algorithm,
              signature_bytes, canonical_manifest_json, audit_reference, created_at
            ) VALUES ('audit_workerd_replace_nonce', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            `op_fresh_${crypto.randomUUID()}`, // fresh operation_id
            verifiedEnrolledManifest.manifest.nonce, // reuse nonce only
            verifiedEnrolledManifest.manifest.target_id,
            verifiedEnrolledManifest.manifest.operator_email,
            verifiedEnrolledManifest.manifest.operator_uid,
            verifiedEnrolledManifest.manifest.workspace_scope.join(','),
            verifiedEnrolledManifest.manifest.permitted_action,
            verifiedEnrolledManifest.signing_key_id,
            verifiedEnrolledManifest.signature_algorithm,
            verifiedEnrolledManifest.signature_bytes,
            verifiedEnrolledManifest.canonical_manifest_json,
            `ref_fresh_${crypto.randomUUID()}` // fresh audit_reference
          )
          .run(),
      /audit manifest records cannot be replaced/
    );

    // 2. Verify BEFORE UPDATE trigger aborts mutation on real D1
    await assert.rejects(
      () =>
        realD1
          .prepare("UPDATE paar_p0_bootstrap_audit_manifests SET operator_email = 'tampered@example.invalid'")
          .run(),
      /audit manifest records are immutable/
    );

    // 3. Verify BEFORE DELETE trigger aborts deletion on real D1
    await assert.rejects(
      () =>
        realD1
          .prepare("DELETE FROM paar_p0_bootstrap_audit_manifests")
          .run(),
      /audit manifest records cannot be deleted/
    );
  });

  // --- Scenario 7: Replay protection & precondition assertion rollback proof ---
  it('W7: replaying enrollment or running with existing bootstrap records triggers stage-1 rollback', async () => {
    // 1. Replay attempt with exact same manifest
    const replayedOutcome = await enrollFirstSuperAdmin(realD1, verifiedEnrolledManifest);
    assert.equal(replayedOutcome.status, 'NOT_ENROLLED');
    assert.equal(replayedOutcome.rollbackProven, true);

    // 2. Attempt with fresh new manifest against already-bootstrapped real D1
    const freshManifest = createValidSyntheticManifest();
    const signedFresh = signApprovalManifest(freshManifest, ephemeralKeyPair.privateKey);
    const verifiedFresh = verifyApprovalManifest(signedFresh, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const freshOutcome = await enrollFirstSuperAdmin(realD1, verifiedFresh);
    assert.equal(freshOutcome.status, 'NOT_ENROLLED');
    assert.equal(freshOutcome.rollbackProven, true);

    // 3. Real disposable D1 rollback proof: abort at completion insertion rolls back all earlier writes on real D1 binding
    // Inject trigger on real D1 binding to abort at completion insertion
    await w7D1.exec("CREATE TRIGGER w7_fail_completion BEFORE INSERT ON g01_bootstrap_completion BEGIN SELECT RAISE(ABORT, 'w7_simulated_completion_failure'); END;");

    const manifestW7 = createValidSyntheticManifest();
    const signedW7 = signApprovalManifest(manifestW7, ephemeralKeyPair.privateKey);
    const verifiedW7 = verifyApprovalManifest(signedW7, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const failedOutcome = await enrollFirstSuperAdmin(w7D1, verifiedW7);
    assert.equal(failedOutcome.status, 'NOT_ENROLLED');
    assert.equal(failedOutcome.rollbackProven, true);

    // Verify all prior writes were rolled back cleanly on real D1
    const userCount = (await w7D1.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
    assert.equal(userCount, 0, 'Users table must have rolled back');
    const mapCount = (await w7D1.prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
    assert.equal(mapCount, 0, 'Identity mappings must have rolled back');
    const memCount = (await w7D1.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
    assert.equal(memCount, 0, 'Workspace memberships must have rolled back');
    const apprCount = (await w7D1.prepare("SELECT COUNT(*) AS n FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
    assert.equal(apprCount, 0, 'Approvals must have rolled back');
    const auditCount = (await w7D1.prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?").bind(manifestW7.operation_id).first<{ n: number }>())?.n;
    assert.equal(auditCount, 0, 'Audit record must have rolled back');

    // Remove failure trigger and confirm enrollment now succeeds on real D1
    await w7D1.exec("DROP TRIGGER w7_fail_completion;");
    const retryOutcome = await enrollFirstSuperAdmin(w7D1, verifiedW7);
    assert.equal(retryOutcome.status, 'SUCCESS');
  });

  // --- Scenario 8: Real D1 primary key replacement conflict rejection (CR-01) ---
  it('W8: real D1 rejects INSERT OR REPLACE reusing existing primary key id with fresh metadata', async () => {
    const existingAudit = await realD1
      .prepare('SELECT id, operation_id, nonce, audit_reference FROM paar_p0_bootstrap_audit_manifests LIMIT 1')
      .first<{ id: string; operation_id: string; nonce: string; audit_reference: string }>();
    assert.ok(existingAudit, 'Baseline audit row must exist from Scenario W4');

    const freshOpId = `op_w8_fresh_${crypto.randomUUID()}`;
    const freshNonce = `nonce_w8_fresh_${crypto.randomUUID()}`;
    const freshAuditRef = `ref_w8_fresh_${crypto.randomUUID()}`;

    // Attempt INSERT OR REPLACE reusing existing id but fresh operation_id, nonce, audit_reference
    await assert.rejects(
      () =>
        realD1
          .prepare(
            `INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
              id, operation_id, nonce, target_id, operator_email, operator_uid,
              workspace_scope, permitted_action, signing_key_id, signature_algorithm,
              signature_bytes, canonical_manifest_json, audit_reference, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
          )
          .bind(
            existingAudit.id,
            freshOpId,
            freshNonce,
            SYNTHETIC_TARGET,
            PROTECTED_EMAIL,
            SYNTHETIC_OPERATOR_UID,
            SYNTHETIC_WORKSPACES.join(','),
            'bootstrap_super_admin',
            'ephemeral_p0_key_01',
            'Ed25519',
            verifiedEnrolledManifest.signature_bytes,
            verifiedEnrolledManifest.canonical_manifest_json,
            freshAuditRef
          )
          .run(),
      /audit manifest records cannot be replaced/
    );
  });

  // --- Scenario 9: Incomplete-state privilege denial on real workerd & D1 binding ---
  it('W9: incomplete-state on real workerd & D1 binding (protected identity + active approval without completion) denies super_admin privilege', async () => {
    const incompleteUid = 'workerd_incomplete_super_admin_uid';
    await w9D1.batch([
      w9D1.prepare("INSERT INTO users (id, email, display_name, disabled, created_at, updated_at) VALUES ('usr_primary_super_admin', ?, 'Primary Super Admin', 0, datetime('now'), datetime('now'))").bind(PROTECTED_EMAIL),
      w9D1.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_incomplete_workerd', 'usr_primary_super_admin', 'firebase', ?, datetime('now'))").bind(incompleteUid),
      w9D1.prepare("INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('mem_incomplete_workerd', 'solarcell', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now'))"),
      w9D1.prepare("INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by) VALUES (1, 'usr_primary_super_admin', 'firebase', ?, datetime('now'), 'test')").bind(incompleteUid),
      w9D1.prepare("INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by) VALUES ('appr_incomplete_workerd', 'usr_primary_super_admin', 'firebase', ?, 'solarcell', 'super_admin', datetime('now'), 'test')").bind(incompleteUid),
    ]);

    const token = await firebaseFixture.token(incompleteUid, PROTECTED_EMAIL);

    // 1. Dispatch directly to workerW9 in real workerd runtime
    const res = await workerW9.fetch('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { memberships: unknown[] };
    assert.equal(body.memberships.length, 0, 'Incomplete state on real workerd runtime must not expose super_admin membership');

    // 2. Dispatch protected workspace endpoint to workerW9 in real workerd runtime
    const resProtected = await workerW9.fetch('http://localhost/api/v1/workspaces/solarcell/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(resProtected.status, 403, 'Incomplete bootstrap state must return 403 Forbidden on real workerd runtime');
  });

  // --- Scenario 10: Real D1 explicit-rowid replacement rejection (CR-25 / W10) ---
  it('W10: real D1 rejects INSERT OR REPLACE with explicit rowid collision, leaving original ledger row intact', async () => {
    // 1. Positive control: retrieve existing audit row from W4
    const existingAudit = await realD1
      .prepare('SELECT id, operation_id, nonce, audit_reference FROM paar_p0_bootstrap_audit_manifests LIMIT 1')
      .first<{ id: string; operation_id: string; nonce: string; audit_reference: string }>();
    assert.ok(existingAudit, 'Baseline audit row must exist from Scenario W4');

    const freshOpId = `op_w10_attack_${crypto.randomUUID()}`;
    const freshNonce = `nonce_w10_attack_${crypto.randomUUID()}`;
    const freshAuditRef = `ref_w10_attack_${crypto.randomUUID()}`;

    // 2. Attack: attempt INSERT OR REPLACE reusing explicit rowid = 1 with fresh text identifiers
    // Under recursive_triggers=OFF, on a table WITH rowid, SQLite replaces rowid 1 without DELETE trigger.
    // Final required behavior: the attack must NOT overwrite the original audit entry!
    try {
      await realD1
        .prepare(
          `INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
            rowid, id, operation_id, nonce, target_id, operator_email, operator_uid,
            workspace_scope, permitted_action, signing_key_id, signature_algorithm,
            signature_bytes, canonical_manifest_json, audit_reference, created_at
          ) VALUES (
            1, 'audit_w10_replacement', ?, ?, ?, ?, ?, ?, 'bootstrap_super_admin',
            'ephemeral_p0_key_01', 'Ed25519', ?, ?, ?, datetime('now')
          )`
        )
        .bind(
          freshOpId,
          freshNonce,
          SYNTHETIC_TARGET,
          PROTECTED_EMAIL,
          SYNTHETIC_OPERATOR_UID,
          SYNTHETIC_WORKSPACES.join(','),
          verifiedEnrolledManifest.signature_bytes,
          verifiedEnrolledManifest.canonical_manifest_json,
          freshAuditRef
        )
        .run();
    } catch {
      // Rejection via SQLite constraint or WITHOUT ROWID error is expected final behavior
    }

    // 3. Assert final correct state: original record must remain intact, replacement record must NOT exist
    const origAfter = await realD1
      .prepare('SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE id = ?')
      .bind(existingAudit.id)
      .first<{ n: number }>();
    const repAfter = await realD1
      .prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE id = 'audit_w10_replacement'")
      .first<{ n: number }>();

    assert.equal(origAfter?.n, 1, 'Original audit record MUST remain intact in real D1 ledger');
    assert.equal(repAfter?.n, 0, 'Replacement audit record MUST NOT exist in real D1 ledger');
  });

  // --- Scenario 11: Real D1 parameter limit boundary check (N=21 positive, N=22 negative) ---
  it('W11: real D1 binding executes N=21 enrollment (100 parameters) and rejects N=22 before dispatch', async () => {
    // 1. Positive test: N=21 workspaces exercises the exact 100-bound-parameter statement against real D1
    const scope21 = Array.from({ length: 21 }, (_, i) => `ws_real_21_${i}`);
    for (const ws of scope21) {
      await w11D1
        .prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, datetime('now'), datetime('now'))")
        .bind(ws, ws, ws)
        .run();
    }
    const manifest21: ApprovalManifest = {
      operation_id: `op_${crypto.randomUUID()}`,
      nonce: `nonce_w11_21_${crypto.randomUUID()}`,
      target_id: SYNTHETIC_TARGET,
      operator_email: PROTECTED_EMAIL,
      operator_uid: SYNTHETIC_OPERATOR_UID,
      workspace_scope: scope21,
      permitted_action: 'bootstrap_super_admin',
      approval_identity: 'test-w11-identity-21',
      signing_key_id: 'ephemeral_p0_key_01',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const signed21 = signApprovalManifest(manifest21, ephemeralKeyPair.privateKey);
    const verified21 = verifyApprovalManifest(signed21, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome21 = await enrollFirstSuperAdmin(w11D1, verified21);
    assert.equal(
      outcome21.status,
      'SUCCESS',
      `W11: N=21 real D1 enrollment MUST succeed; got: ${JSON.stringify(outcome21)}`
    );

    // Verify all 21 memberships and approvals are persisted in real workerd D1
    const membersCount = await w11D1
      .prepare('SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = ?')
      .bind('usr_primary_super_admin')
      .first<{ n: number }>();
    assert.equal(membersCount?.n, 21, 'All 21 workspace memberships MUST exist in real D1');

    const approvalsCount = await w11D1
      .prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals WHERE user_id = ? AND revoked_at IS NULL')
      .bind('usr_primary_super_admin')
      .first<{ n: number }>();
    assert.equal(approvalsCount?.n, 21, 'All 21 privileged approvals MUST exist in real D1');

    // 2. Negative boundary test: N=22 workspaces rejected upfront before dispatch
    const scope22 = Array.from({ length: 22 }, (_, i) => `ws_${i}`);
    const manifest22: ApprovalManifest = {
      operation_id: `op_${crypto.randomUUID()}`,
      nonce: `nonce_w11_22_${crypto.randomUUID()}`,
      target_id: SYNTHETIC_TARGET,
      operator_email: PROTECTED_EMAIL,
      operator_uid: SYNTHETIC_OPERATOR_UID,
      workspace_scope: scope22,
      permitted_action: 'bootstrap_super_admin',
      approval_identity: 'test-w11-identity',
      signing_key_id: 'ephemeral_p0_key_01',
      issued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    const signed22 = signApprovalManifest(manifest22, ephemeralKeyPair.privateKey);
    const bypassedVerified22 = {
      manifest: manifest22,
      signature_algorithm: 'Ed25519' as const,
      signature_bytes: signed22.signature_bytes,
      signing_key_id: signed22.signing_key_id,
      canonical_manifest_json: signed22.canonical_manifest_json,
      audit_reference: 'ref_w11_22',
    };

    const outcome22 = await enrollFirstSuperAdmin(w11D1, bypassedVerified22);
    assert.equal(outcome22.status, 'NOT_ENROLLED');
    assert.equal(outcome22.rollbackProven, false);
    assert.equal(outcome22.writeAttempted, false);
    assert.match(outcome22.error, /parameter limit/i);
  });

  // --- Scenario W12: Disposable Teardown Containment Negative Control & Later Setup Failure ---
  it('W12: safeTeardownDisposableDirectory rejects uncontained target preserving outside sentinel, and cleans up valid target on later setup failure', () => {
    // 1. Establish an approved allowed root in temp
    const allowedRoot = fs.mkdtempSync(path.join(tempReal, 'cabms-p0-w12-allowed-'));

    // 2. Establish an OUTSIDE candidate directory with a sentinel file
    const outsideParent = fs.mkdtempSync(path.join(tempReal, 'cabms-p0-w12-outside-'));
    const outsideCandidate = path.join(outsideParent, 'uncontained_dir');
    fs.mkdirSync(outsideCandidate);
    const sentinelFile = path.join(outsideCandidate, 'outside_sentinel.txt');
    fs.writeFileSync(sentinelFile, 'W12-OUTSIDE-SENTINEL-PRESERVE', 'utf8');

    // 3. Create a genuinely CONTAINED directory with a test file (simulating later setup failure after candidate assignment)
    const containedDir = path.join(allowedRoot, 'contained_isolation');
    fs.mkdirSync(containedDir);
    const containedFile = path.join(containedDir, 'contained_file.txt');
    fs.writeFileSync(containedFile, 'CONTAINED_PAYLOAD', 'utf8');

    try {
      // 4. Negative control: attempt teardown on outside candidate (rejected-path case)
      const outsideResult = safeTeardownDisposableDirectory(outsideCandidate, allowedRoot);
      assert.equal(outsideResult, false, 'Teardown MUST reject uncontained candidate directory outside allowed root');

      // Assert outside sentinel file and candidate directory were NOT deleted
      assert.ok(fs.existsSync(sentinelFile), 'Outside sentinel file MUST NOT be deleted by teardown');
      assert.ok(fs.existsSync(outsideCandidate), 'Outside candidate directory MUST NOT be deleted by teardown');
      assert.equal(
        fs.readFileSync(sentinelFile, 'utf8'),
        'W12-OUTSIDE-SENTINEL-PRESERVE',
        'Sentinel file content must remain completely unaltered'
      );

      // 5. Positive control: teardown on valid isolation directory assigned before later setup failure
      const containedResult = safeTeardownDisposableDirectory(containedDir, allowedRoot);
      assert.equal(containedResult, true, 'Teardown MUST succeed on contained directory when later setup steps fail');
      assert.ok(!fs.existsSync(containedDir), 'Contained directory MUST be cleanly deleted by teardown');
    } finally {
      try { fs.rmSync(outsideParent, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(allowedRoot, { recursive: true, force: true }); } catch {}
    }
  });
});
}
