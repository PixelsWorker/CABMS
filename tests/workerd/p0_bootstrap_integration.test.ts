/**
 * CABMS PAAR-P0 Mode A — Comprehensive Security Integration Test Suite
 *
 * Implements and verifies all 14 mandatory Mode A scenarios (T1–T14):
 * - T1: Unmapped synthetic operator 401 & unauthenticated denial
 * - T2: Protected first-admin automatic self-link block proof
 * - T3: Signature/policy rejection & independent audit constraints
 * - T4: Allowlist child environment, boundary guards & loopback tripwire
 * - T5: NULL-safe, cardinality & extra-membership assertion rollback
 * - T6: Injected failure at all 9 transaction stages
 * - T7: Mode A CLI wrapper, export receipt & Ed25519 re-verification
 * - T8: Same-runtime Worker/D1 authenticated verification & authorized operations
 * - T9: Revocation non-resurrection & bootstrap replay protection
 * - T10: Incomplete-state privilege denial (hardened predicate proof)
 * - T11: Approved-UID recovery chain verification
 * - T12: Cross-workspace, disabled-account & unapproved-role denial
 * - T13: Concurrent competing enrollment batches (LOCAL SIMULATION)
 * - T14: Error classification & deep read-only reconciliation (LOCAL SIMULATION)
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';

import { createLocalD1Database, type D1Database } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';
import { createWorker } from '../../backend/index.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';

import {
  signApprovalManifest,
  verifyApprovalManifest,
  canonicalizeJson,
  computeAuditReference,
  type ApprovalManifest,
  type SignedApprovalManifest,
  type VerifiedApprovalManifest,
  ManifestValidationError,
} from '../../scripts/p0/approvalManifest.ts';

import {
  enrollFirstSuperAdmin,
  reconcileEnrollmentStatus,
  isSqliteConstraintOrTriggerAbort,
} from '../../scripts/p0/firstSuperAdminEnrollment.ts';

import {
  createVerifiedTempDir,
  buildAllowlistedChildEnv,
  assertChildEnvAllowlist,
  LoopbackTripwire,
  runModeACliEnrollment,
  SecurityBoundaryError,
} from '../../scripts/p0/firstSuperAdminCli.ts';

describe('CABMS PAAR-P0 Mode A Integration & Security Specification', () => {
  let ephemeralKeyPair: ReturnType<typeof crypto.generateKeyPairSync>;
  let firebaseFixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
  let testEvidenceDir: string;

  const SYNTHETIC_TARGET = 'cabms-d1-dev-local';
  const SYNTHETIC_EMAIL = 'admin@chinedigital.com.au'; // Evaluates protected operator guard
  const SYNTHETIC_UID = 'synthetic_p0_operator_uid_128char_safe';
  const SYNTHETIC_WORKSPACES = ['solarcell', 'smart_home', 'cctv'];

  const DEFAULT_VERIFY_OPTIONS = {
    expectedTargetId: SYNTHETIC_TARGET,
    expectedOperatorUid: SYNTHETIC_UID,
    expectedOperatorEmail: SYNTHETIC_EMAIL,
  } as const;

  before(async () => {
    ephemeralKeyPair = crypto.generateKeyPairSync('ed25519');
    firebaseFixture = await createFirebaseFixture();
    testEvidenceDir = createVerifiedTempDir('cabms-p0-test-evidence-');
  });

  after(() => {
    if (testEvidenceDir && fs.existsSync(testEvidenceDir)) {
      fs.rmSync(testEvidenceDir, { recursive: true, force: true });
    }
  });

  function createValidSyntheticManifest(overrides?: Partial<ApprovalManifest>): ApprovalManifest {
    return {
      operation_id: overrides?.operation_id ?? `op_${crypto.randomUUID()}`,
      nonce: `nonce_p0_${crypto.randomUUID()}`,
      target_id: SYNTHETIC_TARGET,
      operator_email: SYNTHETIC_EMAIL,
      operator_uid: SYNTHETIC_UID,
      workspace_scope: [...SYNTHETIC_WORKSPACES],
      permitted_action: 'bootstrap_super_admin',
      issued_at: new Date(Date.now() - 5000).toISOString(),
      expires_at: new Date(Date.now() + 300000).toISOString(),
      signing_key_id: 'ephemeral_p0_key_01',
      approval_identity: 'rockson-mode-a-synthetic-auth',
      ...overrides,
    };
  }

  // --- T1: Pre-bootstrap baseline & unauthenticated denial ---
  it('T1: unmapped synthetic operator receives 401; unauthenticated requests denied', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });
    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);

    // 1. Unauthenticated request without token
    const resNoToken = await worker.fetch(new Request('http://localhost/api/v1/auth/me'), {
      DB: db,
      ENVIRONMENT: 'test',
      FIREBASE_PROJECT_ID: 'cabms-test',
    });
    assert.equal(resNoToken.status, 401);
    const bodyNoToken = (await resNoToken.json()) as { code: string };
    assert.equal(bodyNoToken.code, 'AUTHENTICATION_REQUIRED');

    // 2. Unmapped operator token
    const unmappedToken = await firebaseFixture.token('unmapped_uid_123', 'unmapped@example.invalid');
    const resUnmapped = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${unmappedToken}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(resUnmapped.status, 401);
  });

  // --- T2: Self-service block proof ---
  it('T2: protected first-admin automatic self-link is blocked with synthetic claim', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });
    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);

    // Synthetic token carrying protected operator email string but fake UID
    const token = await firebaseFixture.token('fake_uninvited_uid', 'admin@chinedigital.com.au');
    const res = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(res.status, 401);

    // Verify 0 rows created in user_identity_mappings
    const count = await db.prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE provider_subject_id = 'fake_uninvited_uid'").first<{ n: number }>();
    assert.equal(count?.n, 0);
  });

  // --- T3: Signature/policy rejection & independent audit constraints ---
  it('T3: signature/policy rejection & independent audit nonce/op_id constraints', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // 1. Invalid signature
    const validManifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(validManifest, ephemeralKeyPair.privateKey);
    const tampered = { ...signed, signature_bytes: Buffer.from('invalid-sig').toString('base64url') };
    assert.throws(
      () => verifyApprovalManifest(tampered, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err.code === 'INVALID_SIGNATURE'
    );

    // 2. Unknown signing key ID
    const foreignKey = crypto.generateKeyPairSync('ed25519');
    assert.throws(
      () => verifyApprovalManifest(signed, foreignKey.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err.code === 'INVALID_SIGNATURE'
    );

    // 3. Expired manifest
    const expiredManifest = createValidSyntheticManifest({
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    const expiredSigned = signApprovalManifest(expiredManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(expiredSigned, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err.code === 'EXPIRED_MANIFEST'
    );

    // 4. Target mismatch
    assert.throws(
      () => verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, expectedTargetId: 'wrong-target' }),
      (err: any) => err.code === 'TARGET_MISMATCH'
    );

    // 5. Wrong permitted action
    const wrongActionManifest = { ...validManifest, permitted_action: 'invalid_action' as any };
    const wrongActionSigned = signApprovalManifest(wrongActionManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(wrongActionSigned, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err.code === 'ACTION_MISMATCH'
    );

    // 6. Independent audit unique constraints (duplicate nonce / duplicate op_id)
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);
    await db.prepare(`
      INSERT INTO paar_p0_bootstrap_audit_manifests (
        id, operation_id, nonce, target_id, operator_email, operator_uid,
        workspace_scope, permitted_action, signing_key_id, signature_algorithm,
        signature_bytes, canonical_manifest_json, audit_reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      'audit_1', verified.manifest.operation_id, verified.manifest.nonce, verified.manifest.target_id,
      verified.manifest.operator_email, verified.manifest.operator_uid, verified.manifest.workspace_scope.join(','),
      verified.manifest.permitted_action, verified.signing_key_id, verified.signature_algorithm,
      verified.signature_bytes, verified.canonical_manifest_json, verified.audit_reference
    ).run();

    // Replay nonce with different operation ID -> fails on nonce UNIQUE constraint / trigger conflict
    await assert.rejects(
      () => db.prepare(`
        INSERT INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES ('audit_2', 'different_op_id', ?, 'target', 'email', 'uid', 'scope', 'bootstrap_super_admin', 'key', 'Ed25519', 'sig', '{}', 'diff_ref_1', datetime('now'))
      `).bind(verified.manifest.nonce).run(),
      /UNIQUE constraint failed: paar_p0_bootstrap_audit_manifests\.nonce|audit manifest records cannot be replaced/
    );

    // Replay operation_id with different nonce -> fails on operation_id UNIQUE constraint / trigger conflict
    await assert.rejects(
      () => db.prepare(`
        INSERT INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES ('audit_3', ?, 'different_nonce', 'target', 'email', 'uid', 'scope', 'bootstrap_super_admin', 'key', 'Ed25519', 'sig', '{}', 'diff_ref_2', datetime('now'))
      `).bind(verified.manifest.operation_id).run(),
      /UNIQUE constraint failed: paar_p0_bootstrap_audit_manifests\.operation_id|audit manifest records cannot be replaced/
    );
  });

  // --- T4: Allowlisted child environment, boundary guards & loopback tripwire ---
  it('T4: child environment allowlist, boundary checks & loopback tripwire', async () => {
    const tempDir = createVerifiedTempDir('cabms-p0-t4-');
    try {
      const childEnv = buildAllowlistedChildEnv(tempDir);

      // Verify exact allowlist compliance
      assertChildEnvAllowlist(childEnv);
      assert.equal(childEnv.CI, '1');
      assert.equal(childEnv.WRANGLER_SEND_METRICS, 'false');

      // Verify forbidden credential variable rejection
      const contaminatedEnv = { ...childEnv, CLOUDFLARE_API_TOKEN: 'secret_leak' };
      assert.throws(
        () => assertChildEnvAllowlist(contaminatedEnv),
        (err: any) => err instanceof SecurityBoundaryError
      );

      // Verify tripwire: loopback allowed, non-loopback intercepted
      const tripwire = new LoopbackTripwire();
      tripwire.activate();
      try {
        // Positive control: attempt outbound non-loopback connection
        const socket = new net.Socket();
        socket.on('error', () => {}); // Catch expected error
        socket.connect({ host: '192.0.2.1', port: 443 }); // RFC 5737 TEST-NET-1

        assert.equal(tripwire.nonLoopbackAttempts.length, 1);
        assert.equal(tripwire.nonLoopbackAttempts[0].host, '192.0.2.1');
      } finally {
        tripwire.deactivate();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  // --- T5: NULL-safe, cardinality & extra-membership assertion rollback ---
  it('T5: missing rows, SQL NULL, and extra memberships trigger assertion rollback', async () => {
    // Case A: Extra membership causes C03 cardinality mismatch and assertion rollback
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      // Insert valid workspace 'finance' outside signed scope to ensure assertion triggers rather than UNIQUE key constraint
      await db.exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('finance', 'Finance', 'finance', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');");

      await db.exec(`
        CREATE TRIGGER t5_extra_membership AFTER INSERT ON workspace_memberships
        WHEN NEW.workspace_id = 'solarcell'
        BEGIN
          INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
          VALUES ('extra_mem_id', 'finance', NEW.user_id, 'super_admin', datetime('now'), datetime('now'));
        END;
      `);

      const manifest = createValidSyntheticManifest();
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED');
      assert.equal(outcome.rollbackProven, true);

      // Verify total rollback: 0 completion records and 0 primary super admin users
      const comp = await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>();
      assert.equal(comp?.n, 0);
      const user = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>();
      assert.equal(user?.n, 0);
    }

    // Case B: Precondition assertion detects existing privileged super_admin singleton and rolls back
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      // Create pre-existing protected super admin for an existing user
      await db.exec(`
        INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by)
        VALUES (1, 'usr_super_admin', 'firebase', 'admin_uid', datetime('now'), 'admin');
      `);

      const manifest = createValidSyntheticManifest();
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED');
      assert.equal(outcome.rollbackProven, true);

      const comp = await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>();
      assert.equal(comp?.n, 0);
      const user = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>();
      assert.equal(user?.n, 0);
    }
  });

  // --- T6: Injected failure at all 9 transaction stages ---
  it('T6: injected failures across all 9 stages result in complete rollback', async () => {
    for (let stage = 1; stage <= 9; stage++) {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      // Inject stage-specific trigger to force failure
      if (stage === 1) {
        // Precondition failure: insert an existing protected super admin using valid user
        await db.exec("INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by) VALUES (1, 'usr_super_admin', 'firebase', 'uid', 'now', 'admin');");
      } else if (stage === 2) {
        // User stage failure: trigger abort on users
        await db.exec("CREATE TRIGGER t6_fail_user BEFORE INSERT ON users BEGIN SELECT RAISE(ABORT, 't6_user_fail'); END;");
      } else if (stage === 3) {
        // Mapping stage failure
        await db.exec("CREATE TRIGGER t6_fail_map BEFORE INSERT ON user_identity_mappings BEGIN SELECT RAISE(ABORT, 't6_map_fail'); END;");
      } else if (stage === 4) {
        // Membership stage failure
        await db.exec("CREATE TRIGGER t6_fail_mem BEFORE INSERT ON workspace_memberships BEGIN SELECT RAISE(ABORT, 't6_mem_fail'); END;");
      } else if (stage === 5) {
        // Singleton stage failure
        await db.exec("CREATE TRIGGER t6_fail_sing BEFORE INSERT ON g01_protected_super_admin BEGIN SELECT RAISE(ABORT, 't6_singleton_fail'); END;");
      } else if (stage === 6) {
        // Approvals stage failure
        await db.exec("CREATE TRIGGER t6_fail_appr BEFORE INSERT ON privileged_identity_approvals BEGIN SELECT RAISE(ABORT, 't6_approval_fail'); END;");
      } else if (stage === 7) {
        // Audit stage failure
        await db.exec("CREATE TRIGGER t6_fail_audit BEFORE INSERT ON paar_p0_bootstrap_audit_manifests BEGIN SELECT RAISE(ABORT, 't6_audit_fail'); END;");
      } else if (stage === 8) {
        // Completion stage failure
        await db.exec("CREATE TRIGGER t6_fail_comp BEFORE INSERT ON g01_bootstrap_completion BEGIN SELECT RAISE(ABORT, 't6_comp_fail'); END;");
      } else if (stage === 9) {
        // Final assertion failure: insert extra membership on completion to violate C03 cardinality using valid workspace 'finance' outside signed scope
        await db.exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('finance', 'Finance', 'finance', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');");
        await db.exec("CREATE TRIGGER t6_fail_assert AFTER INSERT ON g01_bootstrap_completion BEGIN INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('extra_m_t6', 'finance', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now')); END;");
      }

      const manifest = createValidSyntheticManifest();
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED', `Stage ${stage} failed with ${outcome.status}: ${(outcome as any).error}`);
      assert.equal(outcome.rollbackProven, true);

      // Verify zero completion rows
      const compCount = (await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>())?.n;
      assert.equal(compCount, 0, `Stage ${stage} left uncommitted completion rows`);

      // Verify zero users created
      const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
      assert.equal(userCount, 0, `Stage ${stage} left uncommitted primary super admin user`);
    }
  });

  // --- T7: Mode A CLI wrapper, export receipt & Ed25519 re-verification ---
  it('T7: Mode A CLI wrapper executes, exports audit receipt, and passes reverification', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: testEvidenceDir,
      approvedEvidenceRoot: testEvidenceDir,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    assert.equal(result.outcome.status, 'SUCCESS');
    assert.ok(result.auditReceiptPath);
    assert.ok(fs.existsSync(result.auditReceiptPath));

    // Reverify the exported receipt
    const receiptData = JSON.parse(fs.readFileSync(result.auditReceiptPath, 'utf8'));
    assert.equal(receiptData.operation_id, manifest.operation_id);
    assert.equal(receiptData.signature_algorithm, 'Ed25519');

    // Cryptographically reverify receipt signature against public key
    const sigBuffer = Buffer.from(receiptData.signature_bytes, 'base64url');
    const valid = crypto.verify(null, Buffer.from(receiptData.canonical_manifest_json, 'utf8'), ephemeralKeyPair.publicKey, sigBuffer);
    assert.equal(valid, true);

    // Verify zero assertion rows remain in database
    const assertionCount = (await db.prepare('SELECT COUNT(*) AS n FROM g01_security_assertions').first<{ n: number }>())?.n;
    assert.equal(assertionCount, 0);
  });

  // --- T8: Same-runtime Worker/D1 authenticated verification & authorized operations ---
  it('T8: same-runtime Worker/D1 authenticated verification & authorized operations', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Enroll synthetic super admin using same D1 binding
    const manifest = createValidSyntheticManifest({
      operator_uid: 'synthetic_t8_super_admin_uid',
      operator_email: 'synthetic_t8_sa@example.invalid',
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: 'synthetic_t8_super_admin_uid',
      expectedOperatorEmail: 'synthetic_t8_sa@example.invalid',
    });
    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS');

    // Initialize Worker with same DB binding and test Firebase fixture
    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const operatorToken = await firebaseFixture.token(manifest.operator_uid, manifest.operator_email);

    // 1. /api/v1/auth/me returns 200 with 3 active memberships
    const authMeRes = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(authMeRes.status, 200);
    const authMeData = (await authMeRes.json()) as { user: { id: string; email: string }; memberships: Array<{ workspace_id: string; role: string }> };
    assert.equal(authMeData.user.email, manifest.operator_email);
    assert.equal(authMeData.memberships.length, 3);
    const workspaceIds = authMeData.memberships.map(m => m.workspace_id).sort();
    assert.deepEqual(workspaceIds, ['cctv', 'smart_home', 'solarcell']);

    // 2. Protected route in authorized workspace is permitted
    const settingsRes = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(settingsRes.status, 200);

    // 3. Protected route in unauthorized workspace returns 403
    const foreignRes = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/unauthorized_workspace/settings', {
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(foreignRes.status, 403);
  });

  // --- T9: Revocation non-resurrection & bootstrap replay protection ---
  it('T9: revocation non-resurrection & bootstrap replay protection', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);
    await enrollFirstSuperAdmin(db, verified);

    // Re-running identical bootstrap batch fails on g01_bootstrap_no_reinsert trigger
    const replayOutcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(replayOutcome.status, 'NOT_ENROLLED');
    assert.equal(replayOutcome.rollbackProven, true);

    // Revoke solarcell approval
    await db.prepare("UPDATE privileged_identity_approvals SET revoked_at = datetime('now'), revoked_by = 'admin_audit' WHERE workspace_id = 'solarcell' AND user_id = 'usr_primary_super_admin'").run();

    // Verify /api/v1/auth/me now returns only 2 active memberships
    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const operatorToken = await firebaseFixture.token(manifest.operator_uid, manifest.operator_email);
    const resAfterRevoke = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${operatorToken}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(resAfterRevoke.status, 200);
    const dataAfterRevoke = (await resAfterRevoke.json()) as { memberships: Array<{ workspace_id: string }> };
    assert.equal(dataAfterRevoke.memberships.length, 2);
    assert.ok(!dataAfterRevoke.memberships.some(m => m.workspace_id === 'solarcell'));

    // Re-running bootstrap again cannot resurrect the revoked solarcell approval
    const rerunAfterRevoke = await enrollFirstSuperAdmin(db, verified);
    assert.equal(rerunAfterRevoke.status, 'NOT_ENROLLED');
    const solarcellActive = await db.prepare("SELECT COUNT(*) AS n FROM privileged_identity_approvals WHERE workspace_id = 'solarcell' AND revoked_at IS NULL").first<{ n: number }>();
    assert.equal(solarcellActive?.n, 0);
  });

  // --- T10: Incomplete-state privilege denial (hardened predicate proof) ---
  it('T10: incomplete-state privilege denial (protected ID + memberships + approvals without completion)', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Manually construct incomplete state: user, mapping, memberships, protected singleton, approvals, but NO g01_bootstrap_completion!
    const fakeUid = 'synthetic_t10_uncompleted_uid';
    await db.exec(`
      INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ('usr_primary_super_admin', 'synthetic_t10@example.invalid', 'T10 Admin', datetime('now'), datetime('now'));
      INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_t10', 'usr_primary_super_admin', 'firebase', '${fakeUid}', datetime('now'));
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ('mem_t10_solarcell', 'solarcell', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now'));
      INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by) VALUES (1, 'usr_primary_super_admin', 'firebase', '${fakeUid}', datetime('now'), 'test');
      INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by) VALUES ('appr_t10', 'usr_primary_super_admin', 'firebase', '${fakeUid}', 'solarcell', 'super_admin', datetime('now'), 'test');
    `);

    // Verify g01_bootstrap_completion is absent
    const compCount = (await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>())?.n;
    assert.equal(compCount, 0);

    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const token = await firebaseFixture.token(fakeUid, 'synthetic_t10@example.invalid');

    // 1. /api/v1/auth/me must return 0 memberships because privilegedApproval.ts requires completed bootstrap!
    const resAuthMe = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(resAuthMe.status, 200);
    const authMeData = (await resAuthMe.json()) as { memberships: unknown[] };
    assert.equal(authMeData.memberships.length, 0, 'Incomplete state exposed privileged memberships');

    // 2. Protected worker operation must return 403 Forbidden
    const resSettings = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      {
        DB: db,
        ENVIRONMENT: 'test',
        FIREBASE_PROJECT_ID: 'cabms-test',
      }
    );
    assert.equal(resSettings.status, 403);
  });

  // --- T11: Approved-UID recovery chain verification ---
  it('T11: approved-UID recovery chain grants authority to replacement UID and revokes original', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const originalUid = 'synthetic_t11_original_uid';
    const replacementUid = 'synthetic_t11_replacement_uid';
    const manifest = createValidSyntheticManifest({ operator_uid: originalUid });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: originalUid,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });
    await enrollFirstSuperAdmin(db, verified);

    // Insert append-only recovery event in g01_super_admin_recovery_events per migration 0007 schema
    await db.prepare(`
      INSERT INTO g01_super_admin_recovery_events (
        seq, previous_seq, operation_id, request_id, prior_uid,
        replacement_uid, operator_identity, reason, occurred_at,
        bootstrap_operation_id, audit_reference
      ) VALUES (1, 0, 'op_recovery_1', 'req_recovery_1', ?, ?, 'owner_admin', 'scheduled rotation', datetime('now'), ?, 'audit_recovery_1')
    `).bind(originalUid, replacementUid, manifest.operation_id).run();

    // Map replacement UID in user_identity_mappings and create approval
    await db.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_rec_1', 'usr_primary_super_admin', 'firebase', ?, datetime('now'))").bind(replacementUid).run();
    for (const ws of SYNTHETIC_WORKSPACES) {
      await db.prepare("INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by) VALUES (?, 'usr_primary_super_admin', 'firebase', ?, ?, 'super_admin', datetime('now'), 'recovery')").bind(`appr_rec_${ws}`, replacementUid, ws).run();
    }

    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);

    // 1. Replacement UID has authority
    const replacementToken = await firebaseFixture.token(replacementUid, manifest.operator_email);
    const resReplacement = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${replacementToken}` } }),
      { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }
    );
    assert.equal(resReplacement.status, 200);
    const repData = (await resReplacement.json()) as { memberships: unknown[] };
    assert.equal(repData.memberships.length, 3);

    // 2. Original UID loses authority
    const originalToken = await firebaseFixture.token(originalUid, manifest.operator_email);
    const resOriginal = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${originalToken}` } }),
      { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }
    );
    assert.equal(resOriginal.status, 200);
    const origData = (await resOriginal.json()) as { memberships: unknown[] };
    assert.equal(origData.memberships.length, 0);
  });

  // --- T12: Cross-workspace, disabled-account & unapproved-role denial ---
  it('T12: cross-workspace, disabled-account, and unapproved-role denial', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);
    await enrollFirstSuperAdmin(db, verified);

    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const token = await firebaseFixture.token(manifest.operator_uid, manifest.operator_email);

    // 1. Cross-workspace denial
    const resCross = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/unknown_workspace/settings', { headers: { Authorization: `Bearer ${token}` } }),
      { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }
    );
    assert.equal(resCross.status, 403);

    // 2. Disabled account denial
    await db.prepare("UPDATE users SET disabled = 1 WHERE id = 'usr_primary_super_admin'").run();
    const resDisabled = await worker.fetch(
      new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
      { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }
    );
    assert.equal(resDisabled.status, 401);
  });

  // --- T13: Concurrent competing enrollment batches (LOCAL SIMULATION) ---
  it('T13: concurrent competing enrollment batches (LOCAL SIMULATION ONLY)', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest1 = createValidSyntheticManifest({ nonce: 'nonce_t13_1' });
    const manifest2 = createValidSyntheticManifest({ nonce: 'nonce_t13_2' });

    const signed1 = signApprovalManifest(manifest1, ephemeralKeyPair.privateKey);
    const signed2 = signApprovalManifest(manifest2, ephemeralKeyPair.privateKey);

    const verified1 = verifyApprovalManifest(signed1, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);
    const verified2 = verifyApprovalManifest(signed2, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    // Execute concurrently on the same database
    const [res1, res2] = await Promise.all([
      enrollFirstSuperAdmin(db, verified1),
      enrollFirstSuperAdmin(db, verified2),
    ]);

    // Exactly one must succeed and the other must be NOT_ENROLLED
    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, ['NOT_ENROLLED', 'SUCCESS']);

    // Verify exactly one completion row exists
    const compCount = (await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>())?.n;
    assert.equal(compCount, 1);
  });

  // --- T14: Error classification & deep read-only reconciliation (LOCAL SIMULATION) ---
  it('T14: error classification & deep read-only reconciliation (LOCAL SIMULATION ONLY)', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    // Case 1: Initial state before write -> reconcile returns NOT_ENROLLED
    const initialRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope.length
    );
    assert.equal(initialRecon, 'NOT_ENROLLED');

    // Case 2: Injected post-commit transport error: write commits, but transport throws!
    // Must be classified initially as INDETERMINATE, NOT NOT_ENROLLED!
    const outcomeWithTransportError = await enrollFirstSuperAdmin(db, verified, {
      forceTransportErrorAfterCommit: true,
    });
    assert.equal(outcomeWithTransportError.status, 'INDETERMINATE');

    // Case 3: Read-only deep reconciliation verifies complete consistent records -> CONFIRMED_ENROLLED
    const postCommitRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope.length
    );
    assert.equal(postCommitRecon, 'CONFIRMED_ENROLLED');

    // Case 4: Zero second write calls were made, database is complete and sound
    const compRow = await db.prepare('SELECT operation_id FROM g01_bootstrap_completion WHERE singleton = 1').first<{ operation_id: string }>();
    assert.equal(compRow?.operation_id, manifest.operation_id);
  });

  // =========================================================================
  // Bounded Security Regression Tests: F-01 through F-12 & Acceptance Gaps
  // =========================================================================

  // --- Regression F-01: Rollback classification narrowness ---
  it('Regression F-01: isSqliteConstraintOrTriggerAbort must NOT classify timeouts or generic aborts as proven rollback', () => {
    // Broad tokens must not be classified as verified SQLite engine constraints
    assert.equal(isSqliteConstraintOrTriggerAbort(new Error('AbortError: The operation was aborted due to a timeout')), false, 'timeout classified as rollback');
    assert.equal(isSqliteConstraintOrTriggerAbort(new Error('mismatch in network transport headers')), false, 'generic mismatch classified as rollback');
    assert.equal(isSqliteConstraintOrTriggerAbort(new Error('record already exists in local cache')), false, 'cache already exists classified as rollback');
    assert.equal(isSqliteConstraintOrTriggerAbort(new Error('connection is immutable')), false, 'immutable classified as rollback');
  });

  // --- Regression F-02 & F-04: Mandatory target and operator identity verification ---
  it('Regression F-02: verifyApprovalManifest must strictly require expectedTargetId and enforce exact match', () => {
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Omission of expectedTargetId must fail closed
    assert.throws(
      () => (verifyApprovalManifest as any)(signed, ephemeralKeyPair.publicKey),
      (err: any) => err instanceof ManifestValidationError && err.code === 'TARGET_REQUIRED'
    );
  });

  it('Regression F-04: verifyApprovalManifest must strictly require and verify expectedOperatorUid and expectedOperatorEmail', () => {
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Omission of expectedOperatorUid must fail closed
    assert.throws(
      () => (verifyApprovalManifest as any)(signed, ephemeralKeyPair.publicKey, { expectedTargetId: SYNTHETIC_TARGET }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'OPERATOR_UID_REQUIRED'
    );

    // Omission of expectedOperatorEmail must fail closed
    assert.throws(
      () => (verifyApprovalManifest as any)(signed, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
      }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'OPERATOR_EMAIL_REQUIRED'
    );

    // Mismatched operator email must fail closed
    assert.throws(
      () => verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: 'different@example.invalid',
      }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'OPERATOR_EMAIL_MISMATCH'
    );
  });

  // --- Regression F-03: Local-only execution boundary ---
  it('Regression F-03: runModeACliEnrollment must enforce verified disposable local database boundary', async () => {
    // Generic plain object without factory provenance
    const nonDisposableDb = {
      prepare: () => ({ bind: () => ({ run: async () => ({ results: [], success: true, meta: {} as any }) }) }),
      batch: async () => [],
      exec: async () => ({ count: 1, duration: 0 }),
    } as any;
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    await assert.rejects(
      () => runModeACliEnrollment(nonDisposableDb, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: testEvidenceDir,
        approvedEvidenceRoot: testEvidenceDir,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      } as any),
      (err: any) => err instanceof SecurityBoundaryError && err.message.includes('disposable')
    );
  });

  // --- Regression F-05: Exact membership & approval set matching in reconciliation ---
  it('Regression F-05: reconcileEnrollmentStatus must verify exact workspace set equality, not just count', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });
    await enrollFirstSuperAdmin(db, verified);

    // Seed a 4th workspace and corrupt one membership to it ('finance' instead of 'solarcell')
    // Count remains 3, but the set is wrong!
    await db.prepare("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('finance', 'Finance', 'finance', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z')").run();
    await db.prepare("UPDATE workspace_memberships SET workspace_id = 'finance' WHERE workspace_id = 'solarcell'").run();

    const recon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope.length
    );

    // Count is still 3, but set is inconsistent with approved scope! Must return INCONSISTENT!
    assert.equal(recon, 'INCONSISTENT', 'Reconciliation did not verify exact workspace set equality');
  });

  // --- Regression F-06: Safe uncertain result on reconciliation read query failure ---
  it('Regression F-06: reconcileEnrollmentStatus must return INDETERMINATE on read query failure', async () => {
    const brokenDb = {
      prepare() {
        return {
          bind() { return this; },
          first() { throw new Error('Simulated SQLite engine read failure / disk error'); },
        };
      },
    } as unknown as D1Database;

    const recon = await reconcileEnrollmentStatus(brokenDb, 'op_f06', 'uid_f06', 'ref_f06', 3);
    assert.equal(recon, 'INDETERMINATE', 'Reconciliation did not fail closed to INDETERMINATE on read error');
  });

  // --- Regression F-07: Tripwire host normalization ---
  it('Regression F-07: LoopbackTripwire must normalize uppercase localhost, bracketed IPv6, and loopback CIDRs', () => {
    const tripwire = new LoopbackTripwire();
    tripwire.activate();
    let sock1: net.Socket | undefined;
    let sock2: net.Socket | undefined;
    let sock3: net.Socket | undefined;
    try {
      // Uppercase LOCALHOST
      sock1 = new net.Socket();
      sock1.on('error', () => {});
      sock1.connect({ host: 'LOCALHOST', port: 8080 });

      // 127.0.0.2 (loopback subnet 127.0.0.0/8)
      sock2 = new net.Socket();
      sock2.on('error', () => {});
      sock2.connect({ host: '127.0.0.2', port: 8080 });

      // Bracketed IPv6 [::1]
      sock3 = new net.Socket();
      sock3.on('error', () => {});
      sock3.connect({ host: '[::1]', port: 8080 });

      // None of the above should be treated as non-loopback egress attempts!
      assert.equal(tripwire.nonLoopbackAttempts.length, 0, `Loopback variations misclassified as non-loopback: ${JSON.stringify(tripwire.nonLoopbackAttempts)}`);
    } finally {
      sock1?.destroy();
      sock2?.destroy();
      sock3?.destroy();
      tripwire.deactivate();
    }
  });

  // --- Regression F-08: Receipt path traversal prevention ---
  it('Regression F-08: runModeACliEnrollment must prevent evidence directory path traversal', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Relative traversal path attempting to write outside testEvidenceDir
    const traversalDir = path.join(testEvidenceDir, '..', 'traversal_escape');

    await assert.rejects(
      () => runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: traversalDir,
        approvedEvidenceRoot: testEvidenceDir,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      }),
      (err: any) => err instanceof SecurityBoundaryError && err.message.includes('boundary')
    );
  });

  // --- Regression F-11: Detached immutable verified manifest ---
  it('Regression F-11: verifyApprovalManifest must return an immutable detached manifest snapshot', () => {
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    // Mutating returned manifest must not affect signed or must be frozen
    assert.throws(() => {
      (verified.manifest as any).target_id = 'tampered_after_verification';
    });
  });

  // --- Additional Coverage Gaps: T3, T5, T12 ---
  it('T3 Gap: verifyApprovalManifest rejects non-Ed25519 algorithm and malformed canonical JSON', () => {
    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Non-Ed25519 algorithm
    const tamperedAlgo = { ...signed, signature_algorithm: 'RS256' as any };
    assert.throws(
      () => verifyApprovalManifest(tamperedAlgo, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      }),
      (err: any) => err.code === 'ALGORITHM_REJECTED'
    );

    // Malformed canonical JSON
    const tamperedJson = { ...signed, canonical_manifest_json: signed.canonical_manifest_json.replace(':', ': ') };
    assert.throws(
      () => verifyApprovalManifest(tamperedJson, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      }),
      (err: any) => err.code === 'CANONICALIZATION_MISMATCH'
    );
  });

  it('T5 Gap: SQL NULL and missing join row trigger assertion rollback', async () => {
    // Case A: Missing join row trigger: delete user mapping before assertion
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      await db.exec(`
        CREATE TRIGGER t5_gap_delete_map AFTER INSERT ON user_identity_mappings
        BEGIN
          DELETE FROM user_identity_mappings WHERE user_id = NEW.user_id;
        END;
      `);

      const manifest = createValidSyntheticManifest();
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED');
      assert.equal(outcome.rollbackProven, true);

      const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
      assert.equal(userCount, 0);
    }

    // Case B: Effective-UID view evaluates to SQL NULL while other postconditions hold
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      // Redefine effective-UID view to return SQL NULL (verifies COALESCE handling in C03-09 assertion)
      await db.exec(`
        DROP VIEW g01_effective_super_admin_uid;
        CREATE VIEW g01_effective_super_admin_uid AS
        SELECT CAST(NULL AS TEXT) AS provider_subject_id;
      `);

      const manifest = createValidSyntheticManifest();
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED');
      assert.equal(outcome.rollbackProven, true);

      const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
      assert.equal(userCount, 0);
    }
  });

  it('T12 Gap: unapproved-role assignment triggers failure and denial', async () => {
    // 1. Enrollment assertion rollback when role is altered to another valid role ('owner_admin')
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    await db.exec(`
      CREATE TRIGGER t12_gap_unapproved_role AFTER INSERT ON workspace_memberships
      WHEN NEW.workspace_id = 'solarcell'
      BEGIN
        UPDATE workspace_memberships SET role = 'owner_admin' WHERE id = NEW.id;
      END;
    `);

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'NOT_ENROLLED');
    assert.equal(outcome.rollbackProven, true);

    // 2. Worker authorization denial: mapped user with privileged owner_admin role but no active approval returns 403
    const dbAuth = createLocalD1Database();
    await runLocalMigrations(dbAuth, { disposableTest: true });
    await dbAuth.exec(`
      INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES ('usr_unapproved_owner', 'unapproved_owner@example.invalid', 'Unapproved Owner', datetime('now'), datetime('now'));
      INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
      VALUES ('map_unapproved_owner', 'usr_unapproved_owner', 'firebase', 'uid_unapproved_owner', datetime('now'));
      INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
      VALUES ('mem_unapproved_owner', 'solarcell', 'usr_unapproved_owner', 'owner_admin', datetime('now'), datetime('now'));
    `);

    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const token = await firebaseFixture.token('uid_unapproved_owner', 'unapproved_owner@example.invalid');

    const res = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      { DB: dbAuth, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }
    );
    assert.equal(res.status, 403);
  });

  // --- Regression F-01-B: Replacement under both recursive_triggers OFF and ON ---
  it('Regression F-01-B: audit manifests must reject REPLACE, IGNORE, and conflicting UPSERT under recursive_triggers OFF and ON', async () => {
    for (const recursive of ['OFF', 'ON']) {
      const db = createLocalD1Database();
      const sqlite = (db as any).getSqliteHandle();
      sqlite.exec(`PRAGMA recursive_triggers = ${recursive};`);
      await runLocalMigrations(db, { disposableTest: true });

      const manifest = createValidSyntheticManifest({ operation_id: `op_${crypto.randomUUID()}` });
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      // Insert legitimate original row
      const insertOriginal = `
        INSERT INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES (
          'audit_orig', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')
        )
      `;
      await db.prepare(insertOriginal).bind(
        verified.manifest.operation_id,
        verified.manifest.nonce,
        verified.manifest.target_id,
        verified.manifest.operator_email,
        verified.manifest.operator_uid,
        verified.manifest.workspace_scope.join(','),
        verified.manifest.permitted_action,
        verified.signing_key_id,
        verified.signature_algorithm,
        verified.signature_bytes,
        verified.canonical_manifest_json,
        verified.audit_reference
      ).run();

      // Attempt 1: INSERT OR REPLACE with duplicate operation_id
      const replaceSql = `
        INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES (
          'audit_hacked', ?, 'nonce_hacked', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ref_hacked', datetime('now')
        )
      `;
      await assert.rejects(
        () => db.prepare(replaceSql).bind(
          verified.manifest.operation_id,
          verified.manifest.target_id,
          verified.manifest.operator_email,
          verified.manifest.operator_uid,
          verified.manifest.workspace_scope.join(','),
          verified.manifest.permitted_action,
          verified.signing_key_id,
          verified.signature_algorithm,
          verified.signature_bytes,
          verified.canonical_manifest_json
        ).run(),
        /audit manifest records cannot be replaced|cannot be deleted|ABORT/i
      );

      // Attempt 2: INSERT OR IGNORE with duplicate operation_id
      const ignoreSql = `
        INSERT OR IGNORE INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES (
          'audit_ignored', ?, 'nonce_ignored', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ref_ignored', datetime('now')
        )
      `;
      await assert.rejects(
        () => db.prepare(ignoreSql).bind(
          verified.manifest.operation_id,
          verified.manifest.target_id,
          verified.manifest.operator_email,
          verified.manifest.operator_uid,
          verified.manifest.workspace_scope.join(','),
          verified.manifest.permitted_action,
          verified.signing_key_id,
          verified.signature_algorithm,
          verified.signature_bytes,
          verified.canonical_manifest_json
        ).run(),
        /audit manifest records cannot be replaced|ABORT/i
      );

      // Attempt 3: UPSERT ON CONFLICT(operation_id) DO UPDATE
      const upsertSql = `
        INSERT INTO paar_p0_bootstrap_audit_manifests (
          id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES (
          'audit_upsert', ?, 'nonce_upsert', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ref_upsert', datetime('now')
        ) ON CONFLICT(operation_id) DO UPDATE SET target_id = 'tampered'
      `;
      await assert.rejects(
        () => db.prepare(upsertSql).bind(
          verified.manifest.operation_id,
          verified.manifest.target_id,
          verified.manifest.operator_email,
          verified.manifest.operator_uid,
          verified.manifest.workspace_scope.join(','),
          verified.manifest.permitted_action,
          verified.signing_key_id,
          verified.signature_algorithm,
          verified.signature_bytes,
          verified.canonical_manifest_json
        ).run(),
        /audit manifest records (cannot be replaced|are immutable)|ABORT/i
      );

      // Verify original row is 100% unaltered
      const row = await db.prepare('SELECT id, audit_reference, target_id FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?')
        .bind(verified.manifest.operation_id).first<{ id: string; audit_reference: string; target_id: string }>();
      assert.equal(row?.id, 'audit_orig');
      assert.equal(row?.audit_reference, verified.audit_reference);
      assert.equal(row?.target_id, verified.manifest.target_id);
    }
  });

  // --- Regression F-03-B: Generic / forged D1 bindings rejected ---
  it('Regression F-03-B: runModeACliEnrollment must reject generic, forged, or unverified D1 database objects', async () => {
    const manifest = createValidSyntheticManifest({ operation_id: `op_${crypto.randomUUID()}` });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // 1. Generic mock object without factory provenance
    const genericDb = {
      prepare: () => ({ bind: () => ({ run: async () => ({ results: [], success: true, meta: {} as any }) }) }),
      batch: async () => [],
      exec: async () => ({ count: 1, duration: 0 }),
    } as any;

    await assert.rejects(
      () => runModeACliEnrollment(genericDb, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: testEvidenceDir,
        approvedEvidenceRoot: testEvidenceDir,
        ...DEFAULT_VERIFY_OPTIONS,
      }),
      (err: any) => err instanceof SecurityBoundaryError && err.message.includes('trusted factory')
    );

    // 2. Forged object with isDisposableLocal = true
    const forgedDb = {
      ...genericDb,
      isDisposableLocal: true,
    };
    await assert.rejects(
      () => runModeACliEnrollment(forgedDb, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: testEvidenceDir,
        approvedEvidenceRoot: testEvidenceDir,
        ...DEFAULT_VERIFY_OPTIONS,
      }),
      (err: any) => err instanceof SecurityBoundaryError && err.message.includes('trusted factory')
    );

    // 3. Object with isDisposableLocal = undefined
    const undefinedDb = {
      ...genericDb,
      isDisposableLocal: undefined,
    };
    await assert.rejects(
      () => runModeACliEnrollment(undefinedDb, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: testEvidenceDir,
        approvedEvidenceRoot: testEvidenceDir,
        ...DEFAULT_VERIFY_OPTIONS,
      }),
      (err: any) => err instanceof SecurityBoundaryError && err.message.includes('trusted factory')
    );
  });

  // --- Regression F-08-B: op_<UUID> format and evidence root containment ---
  it('Regression F-08-B: runModeACliEnrollment must enforce op_<UUID> filename format and approved evidence root containment', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // 1. Unsafe / invalid operation_id formats
    for (const badOpId of ['op_test_non_uuid', 'op_12345', 'op_../../../bad_escape', 'non_op_prefix']) {
      const manifest = createValidSyntheticManifest({ operation_id: badOpId });
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

      await assert.rejects(
        () => runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
          evidenceDir: testEvidenceDir,
          approvedEvidenceRoot: testEvidenceDir,
          ...DEFAULT_VERIFY_OPTIONS,
        }),
        (err: any) =>
          (err instanceof SecurityBoundaryError || err instanceof ManifestValidationError) &&
          /op_<UUID>/i.test(err.message)
      );
    }

    // 2. Unsafe destination: absolute path outside approved evidence root without '..'
    const validManifest = createValidSyntheticManifest({ operation_id: `op_${crypto.randomUUID()}` });
    const validSigned = signApprovalManifest(validManifest, ephemeralKeyPair.privateKey);
    const outsideDir = path.resolve(os.tmpdir(), 'unauthorized_outside_evidence_dir');

    await assert.rejects(
      () => runModeACliEnrollment(db, validSigned, ephemeralKeyPair.publicKey, {
        evidenceDir: outsideDir,
        approvedEvidenceRoot: testEvidenceDir,
        ...DEFAULT_VERIFY_OPTIONS,
      }),
      (err: any) => err instanceof SecurityBoundaryError && /escapes approved evidence root/i.test(err.message)
    );
  });

  // =========================================================================
  // HARDENING REGRESSIONS (CR-01, CR-02, CR-03, CR-04, CR-07, CR-08)
  // =========================================================================

  // --- Regression CR-01: Audit Primary Key Conflict Rejection ---
  it('Regression CR-01: audit manifests must reject INSERT OR REPLACE reusing existing primary key id under recursive_triggers OFF and ON', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS');

    const existingAudit = await db
      .prepare('SELECT id, operation_id, nonce, audit_reference FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?')
      .bind(verified.manifest.operation_id)
      .first<{ id: string; operation_id: string; nonce: string; audit_reference: string }>();
    assert.ok(existingAudit);

    // Test under both recursive_triggers OFF and ON
    for (const recursive of ['OFF', 'ON']) {
      await db.exec(`PRAGMA recursive_triggers = ${recursive};`);

      const freshOpId = `op_fresh_${crypto.randomUUID()}`;
      const freshNonce = `nonce_fresh_${crypto.randomUUID()}`;
      const freshAuditRef = `ref_fresh_${crypto.randomUUID()}`;

      await assert.rejects(
        () =>
          db
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
              SYNTHETIC_EMAIL,
              SYNTHETIC_UID,
              SYNTHETIC_WORKSPACES.join(','),
              'bootstrap_super_admin',
              'ephemeral_p0_key_01',
              'Ed25519',
              verified.signature_bytes,
              verified.canonical_manifest_json,
              freshAuditRef
            )
            .run(),
        /audit manifest records cannot be replaced|UNIQUE constraint failed/
      );
    }
  });

  // --- Regression CR-02: Receipt Export After Confirmed Reconciliation ---
  it('Regression CR-02: runModeACliEnrollment exports audit receipt when deep reconciliation confirms enrollment', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    // Pre-enroll to establish committed DB state
    const enrollOutcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(enrollOutcome.status, 'SUCCESS');

    // Simulate transport failure returning INDETERMINATE by monkey-patching db.batch on the real disposable db instance
    db.batch = async () => {
      throw new Error('Connection timeout during transport');
    };

    const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: testEvidenceDir,
      approvedEvidenceRoot: testEvidenceDir,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    assert.equal(result.outcome.status, 'INDETERMINATE');
    assert.equal(result.reconciliation, 'CONFIRMED_ENROLLED');
    assert.ok(result.auditReceiptPath, 'auditReceiptPath must be defined when reconciliation confirms enrollment');
    assert.ok(fs.existsSync(result.auditReceiptPath));
  });

  // --- Regression CR-03: Containment & Exclusive Receipt Creation ---
  it('Regression CR-03: runModeACliEnrollment validates canonical realpath containment and prohibits overwriting existing receipt', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // 1. Pre-create receipt file at target location to verify exclusive write ('wx' flag)
    const receiptFilename = `p0_audit_receipt_${manifest.operation_id}.json`;
    const targetReceiptPath = path.join(testEvidenceDir, receiptFilename);
    fs.writeFileSync(targetReceiptPath, '{"pre_existing": true}', 'utf8');

    const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: testEvidenceDir,
      approvedEvidenceRoot: testEvidenceDir,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    const content = fs.readFileSync(targetReceiptPath, 'utf8');
    assert.equal(content, '{"pre_existing": true}', 'Pre-existing receipt file must not be overwritten');

    // 2. Windows Symlink / NTFS directory junction escape reproduction:
    // Create an outside target directory outside testEvidenceDir
    const outsideTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cabms-escape-target-'));
    const junctionEscapeDir = path.join(testEvidenceDir, 'junction_escape_link');

    try {
      // Create NTFS junction or symlink pointing outside approvedEvidenceRoot
      const linkType = process.platform === 'win32' ? 'junction' : 'dir';
      fs.symlinkSync(outsideTargetDir, junctionEscapeDir, linkType);

      // Attempting to export receipts to the junction directory must fail closed
      await assert.rejects(
        () =>
          runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
            evidenceDir: junctionEscapeDir,
            approvedEvidenceRoot: testEvidenceDir,
            expectedTargetId: SYNTHETIC_TARGET,
            expectedOperatorUid: SYNTHETIC_UID,
            expectedOperatorEmail: SYNTHETIC_EMAIL,
          }),
        (err: any) =>
          err instanceof SecurityBoundaryError &&
          err.message.includes('canonical realpath escapes approved root boundary')
      );

      // Attempting to export to a nested subfolder within the junction must also fail closed
      const nestedJunctionDir = path.join(junctionEscapeDir, 'nested_subfolder');
      await assert.rejects(
        () =>
          runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
            evidenceDir: nestedJunctionDir,
            approvedEvidenceRoot: testEvidenceDir,
            expectedTargetId: SYNTHETIC_TARGET,
            expectedOperatorUid: SYNTHETIC_UID,
            expectedOperatorEmail: SYNTHETIC_EMAIL,
          }),
        (err: any) =>
          err instanceof SecurityBoundaryError &&
          err.message.includes('canonical realpath escapes approved root boundary')
      );
    } finally {
      try {
        if (fs.existsSync(junctionEscapeDir)) {
          fs.unlinkSync(junctionEscapeDir);
        }
      } catch {}
      try {
        fs.rmSync(outsideTargetDir, { recursive: true, force: true });
      } catch {}
    }

    // 3. Controlled filesystem race test: destination created after existsSync preflight
    // Proves COPYFILE_EXCL kernel exclusivity and preserves competing file
    {
      const dbRace = createLocalD1Database();
      await runLocalMigrations(dbRace, { disposableTest: true });
      const manifestRace = createValidSyntheticManifest();
      const signedRace = signApprovalManifest(manifestRace, ephemeralKeyPair.privateKey);
      const raceReceiptPath = path.join(testEvidenceDir, `p0_audit_receipt_${manifestRace.operation_id}.json`);

      const origOpenSync = fs.openSync;
      let raceInjected = false;
      (fs as any).openSync = (...args: any[]) => {
        const fd = (origOpenSync as any)(...args);
        if (!raceInjected && typeof args[0] === 'string' && args[0].includes('.tmp_p0_receipt_')) {
          raceInjected = true;
          // Race condition injection: create target receipt file after preflight check passed
          fs.writeFileSync(raceReceiptPath, '{"created_after_preflight": true}', 'utf8');
        }
        return fd;
      };

      try {
        const raceResult = await runModeACliEnrollment(dbRace, signedRace, ephemeralKeyPair.publicKey, {
          evidenceDir: testEvidenceDir,
          approvedEvidenceRoot: testEvidenceDir,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
        });

        assert.equal(raceResult.outcome.status, 'SUCCESS');
        assert.equal(raceResult.auditReceiptPath, undefined);
        assert.ok(raceResult.receiptExportError);
        assert.match(raceResult.receiptExportError, /file already exists|EEXIST/i);

        const raceContent = fs.readFileSync(raceReceiptPath, 'utf8');
        assert.equal(raceContent, '{"created_after_preflight": true}', 'File created during race must be preserved by COPYFILE_EXCL');
      } finally {
        fs.openSync = origOpenSync;
        try { fs.unlinkSync(raceReceiptPath); } catch {}
      }
    }
  });

  // --- Regression CR-04: Receipt Write Failure Preserves Committed State ---
  it('Regression CR-04: runModeACliEnrollment preserves committed enrollment outcome when receipt export encounters write error', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Provide a file as evidenceDir to trigger ENOTDIR error during receipt export
    const dummyFileAsDir = path.join(testEvidenceDir, 'dummy_file_blocking_dir');
    fs.writeFileSync(dummyFileAsDir, 'not a directory', 'utf8');

    const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: dummyFileAsDir,
      approvedEvidenceRoot: testEvidenceDir,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    assert.equal(result.outcome.status, 'SUCCESS', 'Committed enrollment must be preserved despite receipt write error');
    assert.ok(result.receiptExportError, 'receiptExportError must be populated');
  });

  // --- Regression CR-07: Tripwire Normalized Argument Handling ---
  it('Regression CR-07: LoopbackTripwire rejects malformed, array, and non-loopback connection arguments fail-closed', () => {
    const tripwire = new LoopbackTripwire();
    tripwire.activate();
    let sock1: net.Socket | undefined;
    let sock2: net.Socket | undefined;

    try {
      sock1 = new net.Socket();
      sock1.on('error', () => {});
      sock1.connect([{ malformed: true }] as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === 'malformed_unknown'),
        'Tripwire must record non-loopback attempt for malformed connection argument'
      );

      sock2 = new net.Socket();
      sock2.on('error', () => {});
      sock2.connect([{ host: '198.51.100.1', port: 443 }] as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === '198.51.100.1' && a.port === 443),
        'Tripwire must record non-loopback attempt for array-wrapped destination'
      );
    } finally {
      sock1?.destroy();
      sock2?.destroy();
      tripwire.deactivate();
    }
  });

  // --- Regression CR-08: Caller Verified Workspace Authority ---
  it('Regression CR-08: reconcileEnrollmentStatus enforces caller-supplied expected workspace list as authoritative over database records', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest({ workspace_scope: ['cctv'] });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS');

    // Caller expected scope is ['solarcell'], but DB records contain ['cctv']
    const reconciliation = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      ['solarcell']
    );

    assert.equal(
      reconciliation,
      'INCONSISTENT',
      'Reconciliation must return INCONSISTENT when caller expected scope does not match database audit record'
    );
  });

  // --- Regression CR-09: Ed25519 Key Type Enforcement ---
  it('Regression CR-09: signApprovalManifest and verifyApprovalManifest strictly reject non-Ed25519 keys (RSA, ECDSA)', () => {
    const manifest = createValidSyntheticManifest();

    // 1. RSA keys must be rejected by signApprovalManifest with KEY_TYPE_REJECTED
    const rsaPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    assert.throws(
      () => signApprovalManifest(manifest, rsaPair.privateKey),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_TYPE_REJECTED'
    );

    // 2. ECDSA keys must be rejected by signApprovalManifest with KEY_TYPE_REJECTED
    const ecdsaPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    assert.throws(
      () => signApprovalManifest(manifest, ecdsaPair.privateKey),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_TYPE_REJECTED'
    );

    // 3. Valid signed manifest verified with RSA public key must be rejected with KEY_TYPE_REJECTED
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signed, rsaPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_TYPE_REJECTED'
    );

    // 4. Valid signed manifest verified with ECDSA public key must be rejected with KEY_TYPE_REJECTED
    assert.throws(
      () => verifyApprovalManifest(signed, ecdsaPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_TYPE_REJECTED'
    );

    // 5. Raw PEM strings of RSA/ECDSA keys must also be parsed and rejected with KEY_TYPE_REJECTED
    const rsaPubPem = rsaPair.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    assert.throws(
      () => verifyApprovalManifest(signed, rsaPubPem, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_TYPE_REJECTED'
    );
  });

  // --- Regression CR-10: Firebase Provider Enforcement in Reconciliation ---
  it('Regression CR-10: reconcileEnrollmentStatus strictly rejects non-firebase or contradictory provider mappings', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS');

    // Positive control: reconciliation succeeds for pristine state
    const cleanRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope
    );
    assert.equal(cleanRecon, 'CONFIRMED_ENROLLED');

    // Case A: Identity mapping altered to non-firebase provider (e.g. 'google')
    await db.prepare("UPDATE user_identity_mappings SET provider_id = 'google' WHERE user_id = 'usr_primary_super_admin'").run();
    const nonFirebaseRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope
    );
    assert.equal(nonFirebaseRecon, 'INCONSISTENT', 'Reconciliation must return INCONSISTENT when provider_id is not firebase');

    // Case B: Contradictory second mapping inserted (total > 1)
    await db.prepare("UPDATE user_identity_mappings SET provider_id = 'firebase' WHERE user_id = 'usr_primary_super_admin'").run();
    await db.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ('map_extra_t10', 'usr_primary_super_admin', 'google', 'extra_sub', datetime('now'))").run();
    const extraMappingRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope
    );
    assert.equal(extraMappingRecon, 'INCONSISTENT', 'Reconciliation must return INCONSISTENT when multiple identity mappings exist');
  });

  // --- Regression CR-11: Active LoopbackTripwire during Mode A CLI execution ---
  it('Regression CR-11: runModeACliEnrollment executes under active LoopbackTripwire and fails closed on non-loopback egress', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Install a DB trigger that simulates an inadvertent or malicious outbound network socket call during enrollment
    await db.exec(`
      CREATE TRIGGER test_simulate_outbound_egress AFTER INSERT ON g01_bootstrap_completion
      BEGIN
        SELECT 1;
      END;
    `);

    // We can simulate an outbound socket attempt during execution by hooking D1Database.prepare or intercepting
    const originalPrepare = db.prepare.bind(db);
    let tripwireCheckedDuringCall = false;
    (db as any).prepare = (query: string) => {
      // During execution of one statement, attempt a non-loopback connect
      if (query.includes('g01_bootstrap_completion') && !tripwireCheckedDuringCall) {
        tripwireCheckedDuringCall = true;
        const sock = new net.Socket();
        sock.on('error', () => {});
        sock.connect({ host: '203.0.113.1', port: 80 }); // RFC 5737 TEST-NET-3
      }
      return originalPrepare(query);
    };

    try {
      await assert.rejects(
        () =>
          runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
            expectedTargetId: SYNTHETIC_TARGET,
            expectedOperatorUid: SYNTHETIC_UID,
            expectedOperatorEmail: SYNTHETIC_EMAIL,
          }),
        (err: any) =>
          err instanceof SecurityBoundaryError &&
          err.message.includes('Egress tripwire triggered during Mode A execution')
      );
    } finally {
      (db as any).prepare = originalPrepare;
    }
  });

  // --- Regression CR-12: Directory-Swap TOCTOU Closure on Audit Receipt Export ---
  it('Regression CR-12: runModeACliEnrollment detects directory-swap / junction escape on receipt write and unlinks leaked files', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Setup an approved evidence root and an outside target directory
    const approvedDir = createVerifiedTempDir('cabms-p0-cr12-approved-');
    const outsideDir = createVerifiedTempDir('cabms-p0-cr12-outside-');

    const swappedSubdir = path.join(approvedDir, 'swapped_receipts');
    // Hook db.prepare so that during enrollment (after initial step 3 boundary check has passed),
    // a competing process swaps swappedSubdir with a junction pointing to outsideDir
    const originalPrepare = db.prepare.bind(db);
    let swapped = false;
    (db as any).prepare = (query: string) => {
      if (!swapped && query.includes('INSERT INTO users')) {
        swapped = true;
        const linkType = process.platform === 'win32' ? 'junction' : 'dir';
        fs.symlinkSync(outsideDir, swappedSubdir, linkType);
      }
      return originalPrepare(query);
    };

    try {
      const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: swappedSubdir,
        approvedEvidenceRoot: approvedDir,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      // Enrollment must be successful in DB
      assert.equal(result.outcome.status, 'SUCCESS');
      // But receipt export must fail closed and record error
      assert.equal(result.auditReceiptPath, undefined);
      assert.ok(result.receiptExportError, 'receiptExportError must be set');
      assert.match(result.receiptExportError, /canonical realpath escapes approved root boundary/);

      // Verify no leaked receipt file remains in the outside directory
      const outsideFiles = fs.readdirSync(outsideDir);
      assert.equal(outsideFiles.length, 0, 'No files must be left in the outside directory after escape detection');
    } finally {
      (db as any).prepare = originalPrepare;
      try { fs.rmSync(approvedDir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch {}
    }
  });
});
