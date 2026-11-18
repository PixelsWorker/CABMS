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

describe('CABMS PAAR-P0 — Real Disposable workerd & D1 Integration', () => {
  let server: any;
  let worker: any;
  let workerUrl: URL;
  let realD1: D1Database;
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
    isolationDir = fs.mkdtempSync(path.join(tempReal, 'cabms-p0-workerd-'));
    isolationReal = fs.realpathSync(isolationDir);

    const rel = path.relative(tempReal, isolationReal);
    if (!rel || path.isAbsolute(rel) || rel === '..' || rel.startsWith('..' + path.sep)) {
      throw new Error('Unsafe disposable workerd isolation directory path escape');
    }

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

    // 3. Write ephemeral Wrangler configuration targeting tests/support/worker.ts
    const configPath = path.join(isolationReal, 'wrangler.json');
    const workerEntryPath = path.resolve(rootDir, 'tests/support/worker.ts');
    fs.writeFileSync(
      configPath,
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

    // 4. Launch disposable test harness via pinned Wrangler createTestHarness
    server = createTestHarness({
      workers: [{ configPath }],
    });

    const listenResult = await server.listen();
    workerUrl = new URL(listenResult.url.href);
    worker = server.getWorker('cabms-p0-workerd-worker');

    // 5. Apply migrations 0001 through 0011 to real D1 instance
    await worker.applyD1Migrations('DB');

    // 6. Obtain real D1 binding for test verification
    const env = await worker.getEnv();
    realD1 = env.DB;
  });

  after(async () => {
    if (server) {
      try {
        await server.close();
      } catch {
        // Best effort close
      }
    }

    if (isolationReal && fs.existsSync(isolationReal)) {
      // Windows file-lock retry loop
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          fs.rmSync(isolationReal, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((r) => setTimeout(r, 100));
        }
      }
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
    // 1. Verify BEFORE INSERT trigger blocks INSERT OR REPLACE with conflicting unique keys
    await assert.rejects(
      () =>
        realD1
          .prepare(
            `INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
              id, operation_id, nonce, target_id, operator_email, operator_uid,
              workspace_scope, permitted_action, signing_key_id, signature_algorithm,
              signature_bytes, canonical_manifest_json, audit_reference, created_at
            ) VALUES ('audit_workerd_replace', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'diff_ref', datetime('now'))`
          )
          .bind(
            verifiedEnrolledManifest.manifest.operation_id,
            verifiedEnrolledManifest.manifest.nonce,
            verifiedEnrolledManifest.manifest.target_id,
            verifiedEnrolledManifest.manifest.operator_email,
            verifiedEnrolledManifest.manifest.operator_uid,
            verifiedEnrolledManifest.manifest.workspace_scope.join(','),
            verifiedEnrolledManifest.manifest.permitted_action,
            verifiedEnrolledManifest.signing_key_id,
            verifiedEnrolledManifest.signature_algorithm,
            verifiedEnrolledManifest.signature_bytes,
            verifiedEnrolledManifest.canonical_manifest_json
          )
          .run(),
      /audit manifest records cannot be replaced|UNIQUE constraint failed/
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
    // Replay attempt with exact same manifest
    const replayedOutcome = await enrollFirstSuperAdmin(realD1, verifiedEnrolledManifest);
    assert.equal(replayedOutcome.status, 'NOT_ENROLLED');
    assert.equal(replayedOutcome.rollbackProven, true);

    // Attempt with fresh new manifest against already-bootstrapped real D1
    const freshManifest = createValidSyntheticManifest();
    const signedFresh = signApprovalManifest(freshManifest, ephemeralKeyPair.privateKey);
    const verifiedFresh = verifyApprovalManifest(signedFresh, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const freshOutcome = await enrollFirstSuperAdmin(realD1, verifiedFresh);
    assert.equal(freshOutcome.status, 'NOT_ENROLLED');
    assert.equal(freshOutcome.rollbackProven, true);
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
      /audit manifest records cannot be replaced|UNIQUE constraint failed/
    );
  });
});
