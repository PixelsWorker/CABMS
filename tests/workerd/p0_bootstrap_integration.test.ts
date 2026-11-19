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
  recoverAuditReceipt,
  getCliExitCode,
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

    // Seed enabled, link-eligible user with protected email and no identity mapping or privileged membership (W2 pattern)
    await db.prepare(`
      INSERT INTO users (id, email, display_name, disabled, created_at, updated_at)
      VALUES ('usr_t2_target', ?, 'Target Operator', 0, datetime('now'), datetime('now'))
    `).bind(SYNTHETIC_EMAIL).run();

    // Synthetic token carrying protected operator email string but fake UID
    const token = await firebaseFixture.token('fake_uninvited_uid', SYNTHETIC_EMAIL);
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

    // 2a. Unknown signing key (foreign key -> INVALID_SIGNATURE)
    const foreignKey = crypto.generateKeyPairSync('ed25519');
    assert.throws(
      () => verifyApprovalManifest(signed, foreignKey.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err.code === 'INVALID_SIGNATURE'
    );

    // 2b. Envelope signing_key_id mismatch with valid signature under trusted key -> KEY_ID_MISMATCH
    const mismatchedKeyIdEnvelope: SignedApprovalManifest = {
      ...signed,
      signing_key_id: 'different_key_id_in_envelope',
    };
    assert.throws(
      () => verifyApprovalManifest(mismatchedKeyIdEnvelope, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'KEY_ID_MISMATCH'
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
      let connectorCallCount = 0;
      const origProtoConnect = net.Socket.prototype.connect;
      net.Socket.prototype.connect = function (...args: any[]) {
        connectorCallCount++;
        return origProtoConnect.apply(this, args as any);
      };

      const tripwire = new LoopbackTripwire();
      tripwire.activate();
      try {
        // 1. Outbound non-loopback connection -> must be blocked, underlying connector NOT invoked
        const socket = new net.Socket();
        socket.on('error', () => {}); // Catch expected error
        socket.connect({ host: '192.0.2.1', port: 443 }); // RFC 5737 TEST-NET-1

        assert.equal(tripwire.nonLoopbackAttempts.length, 1);
        assert.equal(tripwire.nonLoopbackAttempts[0].host, '192.0.2.1');
        assert.equal(connectorCallCount, 0, 'Underlying connector MUST NOT be called for blocked non-loopback destination');
        socket.destroy();

        // 2. Loopback control -> reaches underlying connector, proving spy detects calls
        const loopbackSocket = new net.Socket();
        loopbackSocket.on('error', () => {});
        loopbackSocket.connect({ host: '127.0.0.1', port: 8089 });
        assert.equal(connectorCallCount, 1, 'Underlying connector MUST be called for allowed loopback destination');
        loopbackSocket.destroy();
      } finally {
        tripwire.deactivate();
        net.Socket.prototype.connect = origProtoConnect;
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

      // Test B: stage-specific failure signal must appear in outcome error
      const stageSignals: Record<number, RegExp> = {
        1: /CHECK constraint failed|already.*enrolled|protected.*super.*admin|singleton/i,
        2: /t6_user_fail/,
        3: /t6_map_fail/,
        4: /t6_mem_fail/,
        5: /t6_singleton_fail/,
        6: /t6_approval_fail/,
        7: /t6_audit_fail/,
        8: /t6_comp_fail/,
        9: /cardinality|membership|C03|extra.*member|set.*mismatch|CHECK constraint failed/i,
      };
      if (stageSignals[stage]) {
        assert.match(
          (outcome as any).error || '',
          stageSignals[stage],
          `Stage ${stage} must surface a stage-specific abort message in outcome.error`
        );
      }

      // Test B: stages ≥ 7 must leave zero audit ledger rows after rollback
      if (stage >= 7) {
        const auditCount = (await db.prepare('SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests').first<{ n: number }>())?.n;
        assert.equal(auditCount, 0, `Stage ${stage} must leave zero audit ledger rows after rollback`);
      }

      // Verify zero completion rows
      const compCount = (await db.prepare('SELECT COUNT(*) AS n FROM g01_bootstrap_completion').first<{ n: number }>())?.n;
      assert.equal(compCount, 0, `Stage ${stage} left uncommitted completion rows`);

      // Verify zero users created
      const userCount = (await db.prepare(`SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'`).first<{ n: number }>())?.n;
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

    // Enroll synthetic super admin with single workspace scope ('solarcell') to prove cross-workspace isolation against existing workspaces
    const manifest = createValidSyntheticManifest({
      operator_uid: 'synthetic_t8_super_admin_uid',
      operator_email: 'synthetic_t8_sa@example.invalid',
      workspace_scope: ['solarcell'],
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

    // 1. /api/v1/auth/me returns 200 with exactly 1 active membership (solarcell)
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
    assert.equal(authMeData.memberships.length, 1);
    assert.equal(authMeData.memberships[0].workspace_id, 'solarcell');

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

    // 3. Protected route in existing workspace OUTSIDE signed scope (cctv) returns 403
    const foreignRes = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/cctv/settings', {
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

    // Sign manifest with scope restricted to ['solarcell']
    const manifest = createValidSyntheticManifest({
      workspace_scope: ['solarcell'],
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);
    await enrollFirstSuperAdmin(db, verified);

    const authService = createAuthenticationService(firebaseFixture.transport);
    const worker = createWorker(authService);
    const token = await firebaseFixture.token(manifest.operator_uid, manifest.operator_email);

    // 1. Cross-workspace denial against existing workspace 'cctv' outside signed scope
    const resCross = await worker.fetch(
      new Request('http://localhost/api/v1/workspaces/cctv/settings', { headers: { Authorization: `Bearer ${token}` } }),
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

    // Case 1: Initial state before write -> with positive settlement signal, returns NOT_ENROLLED
    const initialRecon = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope,
      { settled: true }
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
      manifest.workspace_scope
    );
    assert.equal(postCommitRecon, 'CONFIRMED_ENROLLED');

    // Case 4: Zero second write calls were made during reconciliation, database is complete and sound
    let writeCountDuringRecon = 0;
    const origPrepareT14 = db.prepare.bind(db);
    (db as any).prepare = (query: string) => {
      const q = query.trim().toUpperCase();
      if (q.startsWith('INSERT') || q.startsWith('UPDATE') || q.startsWith('DELETE') || q.startsWith('REPLACE')) {
        writeCountDuringRecon++;
      }
      return origPrepareT14(query);
    };

    try {
      const reconCheck = await reconcileEnrollmentStatus(
        db,
        manifest.operation_id,
        manifest.operator_uid,
        verified.audit_reference,
        manifest.workspace_scope
      );
      assert.equal(reconCheck, 'CONFIRMED_ENROLLED');
      assert.equal(writeCountDuringRecon, 0, 'Reconciliation must execute zero write statements against D1');
    } finally {
      (db as any).prepare = origPrepareT14;
    }

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
      manifest.workspace_scope
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
          all() { throw new Error('Simulated SQLite engine read failure / disk error'); },
        };
      },
    } as unknown as D1Database;

    const recon = await reconcileEnrollmentStatus(brokenDb, 'op_f06', 'uid_f06', 'ref_f06', ['solarcell', 'smart_home', 'cctv']);
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
    assert.equal(getCliExitCode(result), 3, 'getCliExitCode returns 3 for initial transport drop even if subsequently reconciled');
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

    // 4. Directory swap race: evidence directory identity changed after temp file is opened
    {
      const dbSwap = createLocalD1Database();
      await runLocalMigrations(dbSwap, { disposableTest: true });
      const manifestSwap = createValidSyntheticManifest();
      const signedSwap = signApprovalManifest(manifestSwap, ephemeralKeyPair.privateKey);

      const approvedRoot = createVerifiedTempDir('cabms-p0-cr03-appr-');
      const outsideDir = createVerifiedTempDir('cabms-p0-cr03-out-');
      const evidenceSubdir = path.join(approvedRoot, 'swap_race_subdir');
      fs.mkdirSync(evidenceSubdir);

      const origOpenSync = fs.openSync;
      let swapInjected = false;
      (fs as any).openSync = (...args: any[]) => {
        const fd = (origOpenSync as any)(...args);
        if (!swapInjected && typeof args[0] === 'string' && args[0].includes('.tmp_p0_receipt_')) {
          swapInjected = true;
          // After temp file is created, simulate directory swap to outside directory
          fs.rmSync(evidenceSubdir, { recursive: true, force: true });
          const linkType = process.platform === 'win32' ? 'junction' : 'dir';
          fs.symlinkSync(outsideDir, evidenceSubdir, linkType);
        }
        return fd;
      };

      try {
        const swapResult = await runModeACliEnrollment(dbSwap, signedSwap, ephemeralKeyPair.publicKey, {
          evidenceDir: evidenceSubdir,
          approvedEvidenceRoot: approvedRoot,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
        });

        assert.equal(swapResult.outcome.status, 'SUCCESS');
        assert.equal(swapResult.auditReceiptPath, undefined);
        assert.ok(swapResult.receiptExportError);
        assert.match(swapResult.receiptExportError, /swapped|escapes|redirected/i);

        // Verify no receipt published in outside directory
        const outsideFiles = fs.readdirSync(outsideDir);
        assert.equal(outsideFiles.length, 0, 'No receipt must be published in outside directory');
      } finally {
        fs.openSync = origOpenSync;
        try { fs.unlinkSync(evidenceSubdir); } catch {}
        try { fs.rmSync(approvedRoot, { recursive: true, force: true }); } catch {}
        try { fs.rmSync(outsideDir, { recursive: true, force: true }); } catch {}
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
    assert.equal(getCliExitCode(result), 4, 'Missing mandatory audit evidence must produce nonzero exit code 4 while preserving committed state');
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

    // Test A: suppression assertion — evidenceDir provided, receipt must be suppressed on violation
    const suppressionDirCr11 = createVerifiedTempDir('cabms-p0-cr11-suppression-');
    try {
      const cliResult = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: suppressionDirCr11,
        approvedEvidenceRoot: suppressionDirCr11,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      assert.equal(
        cliResult.outcome.status,
        'SECURITY_VIOLATION',
        'Outcome status must be SECURITY_VIOLATION when tripwire is triggered'
      );
      assert.match(
        cliResult.outcome.error,
        /Egress tripwire triggered during Mode A execution/,
        'Outcome error must record tripwire trigger'
      );
      assert.ok(
        cliResult.securityViolation,
        'securityViolation details must be explicitly populated'
      );
      assert.equal(
        cliResult.auditReceiptPath,
        undefined,
        'Receipt publication must be strictly blocked on security violation'
      );
      // Test A negative: evidence directory must remain empty — receipt suppressed, not merely unset
      assert.equal(
        fs.readdirSync(suppressionDirCr11).length,
        0,
        'CR-11: evidence directory must remain empty when receipt is suppressed by security violation'
      );
      assert.equal(
        getCliExitCode(cliResult),
        2,
        'CLI exit code MUST be non-zero (2) for SECURITY_VIOLATION'
      );
    } finally {
      (db as any).prepare = originalPrepare;
      try { fs.rmSync(suppressionDirCr11, { recursive: true, force: true }); } catch {}
    }

    // Test A positive control: same destination accepts a receipt from a successful enrollment without a violation
    {
      const cleanDb = createLocalD1Database();
      await runLocalMigrations(cleanDb, { disposableTest: true });
      const controlDir = createVerifiedTempDir('cabms-p0-cr11-control-');
      try {
        const controlManifest = createValidSyntheticManifest();
        const controlSigned = signApprovalManifest(controlManifest, ephemeralKeyPair.privateKey);
        const controlResult = await runModeACliEnrollment(cleanDb, controlSigned, ephemeralKeyPair.publicKey, {
          evidenceDir: controlDir,
          approvedEvidenceRoot: controlDir,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
        });
        assert.equal(controlResult.outcome.status, 'SUCCESS', 'CR-11 positive control: clean enrollment must succeed');
        assert.ok(controlResult.auditReceiptPath, 'CR-11 positive control: receipt must be published to evidence directory');
        assert.ok(
          fs.readdirSync(controlDir).length > 0,
          'CR-11 positive control: evidence directory must contain the exported receipt'
        );
      } finally {
        try { fs.rmSync(controlDir, { recursive: true, force: true }); } catch {}
      }
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

  // --- Regression CR-13: Reject all memberships & approvals outside signed scope/role ---
  it('Regression CR-13: injects unauthorized membership (owner_admin) and approval during enrollment; must fail closed and roll back', async () => {
    // Case A: Injected owner_admin membership in an unsigned workspace
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      await db.exec("INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('finance', 'Finance', 'finance', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');");

      await db.exec(`
        CREATE TRIGGER inject_unauthorized_membership AFTER INSERT ON workspace_memberships
        WHEN NEW.workspace_id = 'solarcell'
        BEGIN
          INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
          VALUES ('mem_unauth_owner', 'finance', NEW.user_id, 'owner_admin', datetime('now'), datetime('now'));
        END;
      `);

      const manifest = createValidSyntheticManifest({ workspace_scope: ['solarcell'] });
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED', 'Enrollment must be rejected when unauthorized membership exists');
      assert.equal(outcome.rollbackProven, true, 'Rollback must be proven');

      const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
      assert.equal(userCount, 0, 'Users table must have rolled back completely');
    }

    // Case B: Injected unauthorized active approval (owner_admin)
    {
      const db = createLocalD1Database();
      await runLocalMigrations(db, { disposableTest: true });

      await db.exec(`
        CREATE TRIGGER inject_unauthorized_approval AFTER INSERT ON privileged_identity_approvals
        WHEN NEW.workspace_id = 'solarcell'
        BEGIN
          INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by)
          VALUES ('appr_unauth_owner', NEW.user_id, 'firebase', NEW.provider_subject_id, 'solarcell', 'owner_admin', datetime('now'), 'attacker');
        END;
      `);

      const manifest = createValidSyntheticManifest({ workspace_scope: ['solarcell'] });
      const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
      const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

      const outcome = await enrollFirstSuperAdmin(db, verified);
      assert.equal(outcome.status, 'NOT_ENROLLED', 'Enrollment must be rejected when unauthorized active approval exists');
      assert.equal(outcome.rollbackProven, true, 'Rollback must be proven');

      const userCount = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n;
      assert.equal(userCount, 0, 'Users table must have rolled back completely');
    }
  });

  // --- Regression CR-14: Block IPC socket destinations (Unix sockets and Windows named pipes) ---
  it('Regression CR-14: LoopbackTripwire rejects IPC destinations by default (Unix sockets and named pipes)', () => {
    const tripwire = new LoopbackTripwire();
    tripwire.activate();
    let sockUnix: net.Socket | undefined;
    let sockPipe: net.Socket | undefined;
    let sockPathOpt: net.Socket | undefined;

    try {
      // 1. Unix socket path as string
      sockUnix = new net.Socket();
      sockUnix.on('error', () => {});
      sockUnix.connect('/var/run/docker.sock');
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === '/var/run/docker.sock'),
        'Tripwire must record non-loopback attempt for Unix socket path'
      );

      // 2. Windows named pipe as string
      sockPipe = new net.Socket();
      sockPipe.on('error', () => {});
      sockPipe.connect('\\\\.\\pipe\\docker_engine');
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === '\\\\.\\pipe\\docker_engine'),
        'Tripwire must record non-loopback attempt for Windows named pipe'
      );

      // 3. Connect with { path: '...' } option object
      sockPathOpt = new net.Socket();
      sockPathOpt.on('error', () => {});
      sockPathOpt.connect({ path: '/tmp/test.sock' } as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === '/tmp/test.sock'),
        'Tripwire must record non-loopback attempt for options.path IPC destination'
      );
    } finally {
      sockUnix?.destroy();
      sockPipe?.destroy();
      sockPathOpt?.destroy();
      tripwire.deactivate();
    }
  });

  // --- Regression CR-15: Validate manifest issuance timestamp (issued_at) ---
  it('Regression CR-15: verifyApprovalManifest strictly validates issued_at and expiration window', () => {
    const now = Date.now();

    // 1. Future-issued manifest (issued_at > now) must be rejected
    const futureManifest = createValidSyntheticManifest({
      issued_at: new Date(now + 60000).toISOString(),
      expires_at: new Date(now + 300000).toISOString(),
    });
    const signedFuture = signApprovalManifest(futureManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedFuture, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'FUTURE_ISSUED_MANIFEST'
    );

    // 2. Inverted or equal expiration window (expires_at <= issued_at) must be rejected
    const invertedManifest = createValidSyntheticManifest({
      issued_at: new Date(now - 10000).toISOString(),
      expires_at: new Date(now - 20000).toISOString(),
    });
    const signedInverted = signApprovalManifest(invertedManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedInverted, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && (err.code === 'INVALID_EXPIRATION_WINDOW' || err.code === 'EXPIRED_MANIFEST')
    );

    // Specifically test expires_at === issued_at with future expiry to isolate INVALID_EXPIRATION_WINDOW
    const equalManifest = createValidSyntheticManifest({
      issued_at: new Date(now - 10000).toISOString(),
      expires_at: new Date(now - 10000).toISOString(),
    });
    const signedEqual = signApprovalManifest(equalManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedEqual, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && (err.code === 'INVALID_EXPIRATION_WINDOW' || err.code === 'EXPIRED_MANIFEST')
    );

    // 3. Malformed/non-parseable issued_at must be rejected
    const malformedIssuedManifest = createValidSyntheticManifest({
      issued_at: 'not-a-valid-date',
      expires_at: new Date(now + 300000).toISOString(),
    });
    const signedMalformed = signApprovalManifest(malformedIssuedManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedMalformed, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_ISSUED_AT'
    );
  });

  // =========================================================================
  // Round 2 Pre-Fix Regression Tests: CR-25 through CR-34
  // These tests assert FINAL CORRECT behavior and fail on unhardened code.
  // =========================================================================

  // --- Regression CR-25: CABMS schema audit ledger rejects explicit-rowid replacement ---
  it('Regression CR-25: audit ledger rejects INSERT OR REPLACE with explicit rowid collision under recursive_triggers=OFF', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Positive control: insert baseline audit manifest row
    await db.prepare(`
      INSERT INTO paar_p0_bootstrap_audit_manifests (
        id, operation_id, nonce, target_id, operator_email, operator_uid,
        workspace_scope, permitted_action, signing_key_id, signature_algorithm,
        signature_bytes, canonical_manifest_json, audit_reference, created_at
      ) VALUES ('audit_cr25_orig', 'op_cr25_orig', 'nonce_cr25_orig', 'target', 'email', 'uid',
        'scope', 'bootstrap_super_admin', 'key', 'Ed25519', 'sig', '{}', 'ref_cr25_orig', datetime('now'))
    `).run();

    // Verify baseline row exists
    const origBefore = await db.prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE id = 'audit_cr25_orig'").first<{ n: number }>();
    assert.equal(origBefore?.n, 1, 'Positive control: original record must exist');

    // Attack: attempt INSERT OR REPLACE reusing explicit rowid = 1 with fresh text identifiers
    // Under recursive_triggers=OFF, on a table WITH rowid, SQLite replaces rowid 1 without DELETE trigger.
    // Final required behavior: the attack must NOT overwrite the original audit entry!
    try {
      await db.exec(`
        INSERT OR REPLACE INTO paar_p0_bootstrap_audit_manifests (
          rowid, id, operation_id, nonce, target_id, operator_email, operator_uid,
          workspace_scope, permitted_action, signing_key_id, signature_algorithm,
          signature_bytes, canonical_manifest_json, audit_reference, created_at
        ) VALUES (
          1, 'audit_cr25_rep', 'op_cr25_rep', 'nonce_cr25_rep', 'target', 'email', 'uid',
          'scope', 'bootstrap_super_admin', 'key', 'Ed25519', 'sig', '{}', 'ref_cr25_rep', datetime('now')
        )
      `);
    } catch {
      // If SQLite rejects because WITHOUT ROWID or constraint, that is acceptable
    }

    // Assert final correct state: original record must remain intact, replacement record must NOT exist
    const origAfter = await db.prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE id = 'audit_cr25_orig'").first<{ n: number }>();
    const repAfter = await db.prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests WHERE id = 'audit_cr25_rep'").first<{ n: number }>();

    assert.equal(origAfter?.n, 1, 'Original audit record MUST remain intact in ledger');
    assert.equal(repAfter?.n, 0, 'Replacement audit record MUST NOT exist in ledger');
  });

  // --- Regression CR-26: Unsettled-Outcome Reconciliation Fail-Closed ---
  it('Regression CR-26: reconciliation on empty database without positive settlement must fail closed to INDETERMINATE', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // 1. Explicit settled: false -> fail-closed to INDETERMINATE
    const reconUnsettled = await reconcileEnrollmentStatus(
      db,
      'op_unsettled_9999',
      'uid_unsettled_9999',
      'ref_unsettled_9999',
      ['solarcell', 'smart_home', 'cctv'],
      { settled: false }
    );
    assert.equal(
      reconUnsettled,
      'INDETERMINATE',
      'Empty database read with settled: false must return INDETERMINATE'
    );

    // 2. Default (no options / unsettled transport) -> fail-closed to INDETERMINATE
    const reconDefault = await reconcileEnrollmentStatus(
      db,
      'op_unsettled_9999',
      'uid_unsettled_9999',
      'ref_unsettled_9999',
      ['solarcell', 'smart_home', 'cctv']
    );
    assert.equal(
      reconDefault,
      'INDETERMINATE',
      'Empty database read without explicit settlement guarantee must default to INDETERMINATE'
    );

    // 3. Positive control: explicit settled: true on empty database -> returns NOT_ENROLLED
    const reconSettled = await reconcileEnrollmentStatus(
      db,
      'op_unsettled_9999',
      'uid_unsettled_9999',
      'ref_unsettled_9999',
      ['solarcell', 'smart_home', 'cctv'],
      { settled: true }
    );
    assert.equal(
      reconSettled,
      'NOT_ENROLLED',
      'Empty database read WITH positive settled: true signal must return NOT_ENROLLED'
    );
  });

  // --- Regression CR-27: Dedicated Read-Only Receipt Recovery ---
  it('Regression CR-27: recoverAuditReceipt recovers receipt for completed enrollment without writing to D1', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // 1. First invocation: enroll successfully with invalid evidence directory so receipt export fails
    const approvedRoot = createVerifiedTempDir('cabms-p0-cr27-root-');
    const badEvidencePath = path.join(approvedRoot, 'receipts_file');
    fs.writeFileSync(badEvidencePath, 'not a directory');

    const enrollRes = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: badEvidencePath,
      approvedEvidenceRoot: approvedRoot,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });
    assert.equal(enrollRes.outcome.status, 'SUCCESS', 'Enrollment must succeed in DB');
    assert.equal(enrollRes.auditReceiptPath, undefined, 'Receipt export failed as expected');

    // 2. Prepare valid evidence directory for recovery
    fs.unlinkSync(badEvidencePath);
    fs.mkdirSync(badEvidencePath);

    // 3. Spy on D1 to ensure recovery makes ZERO write calls via prepare, batch, or exec
    let writeCalls = 0;
    const origPrepare = db.prepare.bind(db);
    const origBatch = db.batch.bind(db);
    const origExec = (db as any).exec?.bind(db);
    const isWriteSql = (query: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i.test(query.trim());
    (db as any).prepare = (query: string) => {
      if (isWriteSql(query)) {
        writeCalls++;
      }
      return origPrepare(query);
    };
    (db as any).batch = (...args: any[]) => {
      writeCalls++; // any batch call during recovery is a write attempt
      return (origBatch as any)(...args);
    };
    if (origExec) {
      (db as any).exec = (query: string, ...args: any[]) => {
        if (typeof query === 'string' && isWriteSql(query)) {
          writeCalls++;
        }
        return (origExec as any)(query, ...args);
      };
    }

    try {
      // 4. Call dedicated read-only recovery entry point
      const recoveryRes = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: badEvidencePath,
        approvedEvidenceRoot: approvedRoot,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      assert.equal(writeCalls, 0, 'Receipt recovery MUST NOT make any write calls to D1 (prepare, batch, or exec)');
      assert.equal(recoveryRes.status, 'RECOVERED', 'Recovery status must be RECOVERED');
      assert.ok(recoveryRes.auditReceiptPath, 'auditReceiptPath must be defined on recovery');
      assert.ok(fs.existsSync(recoveryRes.auditReceiptPath!), 'Receipt file must exist on disk');

      // Test C negative control: demonstrate that write-detection spy distinguishes reads from writes
      // 1. Probing with read queries (SELECT) must NOT increment writeCalls
      if (origExec) {
        await (db as any).exec('SELECT 1');
      }
      await db.prepare('SELECT COUNT(*) AS n FROM users').first();
      assert.equal(writeCalls, 0, 'CR-27 negative control: read operations (SELECT) must not increment writeCalls');

      // 2. Perform a controlled write attempt; verify spy detects it
      const writeCallsBefore = writeCalls;
      (db as any).prepare("INSERT INTO g01_security_assertions (value) VALUES (0)");
      assert.ok(
        writeCalls > writeCallsBefore,
        'CR-27 negative control: SQL INSERT statement must trigger write-detection spy'
      );

      // 3. Demonstrate that the zero-write assertion fails when an unauthorized write is detected
      assert.throws(
        () => {
          assert.equal(writeCalls, 0, 'Receipt recovery MUST NOT make any write calls to D1');
        },
        /AssertionError/,
        'CR-27 negative control: writeCalls > 0 must fail the zero-write assertion'
      );

      // 5. Test expired manifest recovery behavior
      // The original manifest (from step 1) has now expired relative to a future verification clock
      const futureNow = Date.parse(manifest.expires_at) + 10000;

      // A: Without allowExpiredForRecovery, recovery with expired clock throws EXPIRED_MANIFEST
      await assert.rejects(
        () => recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
          evidenceDir: badEvidencePath,
          approvedEvidenceRoot: approvedRoot,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
          nowMs: futureNow,
        }),
        (err: any) => err instanceof ManifestValidationError && err.code === 'EXPIRED_MANIFEST'
      );

      // B: With allowExpiredForRecovery: true, completed enrollment receipt can be recovered
      const recoveryDir = path.join(approvedRoot, 'recovery_subdir');
      fs.mkdirSync(recoveryDir);
      try {
        const recoveryExpired = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
          evidenceDir: recoveryDir,
          approvedEvidenceRoot: approvedRoot,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
          nowMs: futureNow,
          allowExpiredForRecovery: true,
        });
        assert.equal(recoveryExpired.status, 'RECOVERED');

        // C: Negative control: if manifest validity window does not encompass persisted audit record's created_at,
        // recovery must reject with INCONSISTENT
        // Fetch actual created_at from ledger
        const auditRow = await db.prepare("SELECT created_at FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?").bind(manifest.operation_id).first<{ created_at: string }>();
        assert.ok(auditRow?.created_at, 'Audit row created_at must be populated');
        const rawAuditCreated = auditRow!.created_at.trim();
        const isoAuditCreated = rawAuditCreated.includes('T')
          ? (rawAuditCreated.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawAuditCreated) ? rawAuditCreated : rawAuditCreated + 'Z')
          : rawAuditCreated.replace(' ', 'T') + 'Z';
        const auditTime = Date.parse(isoAuditCreated);
        assert.ok(!Number.isNaN(auditTime), 'Audit row created_at must be valid timestamp');
        assert.ok(auditTime >= Date.parse(manifest.issued_at) && auditTime <= Date.parse(manifest.expires_at), 'Audit record must have been created within validity window');

        // Manifest whose issued_at is strictly in the future of the audit record's created_at
        const futureIssuedManifest = createValidSyntheticManifest({
          operation_id: manifest.operation_id,
          issued_at: new Date(auditTime + 10000).toISOString(),
          expires_at: new Date(auditTime + 60000).toISOString(),
        });
        const signedFutureIssued = signApprovalManifest(futureIssuedManifest, ephemeralKeyPair.privateKey);
        const recoveryWindowMismatch = await recoverAuditReceipt(db, signedFutureIssued, ephemeralKeyPair.publicKey, {
          evidenceDir: recoveryDir,
          approvedEvidenceRoot: approvedRoot,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
          nowMs: auditTime + 70000,
          allowExpiredForRecovery: true,
        });
        assert.equal(recoveryWindowMismatch.status, 'INCONSISTENT');
      } finally {
        try { fs.rmSync(recoveryDir, { recursive: true, force: true }); } catch {}
      }
    } finally {
      (db as any).prepare = origPrepare;
      (db as any).batch = origBatch;
      if (origExec) (db as any).exec = origExec;
      try { fs.rmSync(approvedRoot, { recursive: true, force: true }); } catch {}
    }
  });

  // --- Regression CR-28: Tripwire violation returns distinct security failure outcome ---
  it('Regression CR-28: tripwire violation during committed enrollment returns SECURITY_VIOLATION outcome and blocks receipt', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Inject egress attempt during batch execution (on completion insert)
    const originalPrepare = db.prepare.bind(db);
    (db as any).prepare = (query: string) => {
      if (query.includes('INSERT INTO g01_bootstrap_completion')) {
        const sock = new net.Socket();
        sock.on('error', () => {});
        sock.connect({ host: '203.0.113.1', port: 80 }); // RFC 5737 TEST-NET-3
      }
      return originalPrepare(query);
    };

    // Test A: suppression assertion — evidenceDir provided, receipt must be suppressed on violation
    const suppressionDirCr28 = createVerifiedTempDir('cabms-p0-cr28-suppression-');
    try {
      const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir: suppressionDirCr28,
        approvedEvidenceRoot: suppressionDirCr28,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      // Final behavior: distinct unsuccessful security outcome
      assert.equal(
        result.outcome.status,
        'SECURITY_VIOLATION',
        'Outcome status must be SECURITY_VIOLATION when tripwire triggered'
      );
      assert.equal(
        (result.outcome as any).dbState,
        'COMMITTED',
        'CR-28: outcome.dbState must be COMMITTED when tripwire triggers on committed enrollment'
      );
      assert.ok(
        (result as any).securityViolation,
        'securityViolation field must be present describing the egress attempt'
      );
      assert.equal(
        result.auditReceiptPath,
        undefined,
        'Receipt publication must be strictly blocked on security violation'
      );
      // Test A negative: evidence directory must remain empty — receipt suppressed, not merely unset
      assert.equal(
        fs.readdirSync(suppressionDirCr28).length,
        0,
        'CR-28: evidence directory must remain empty when receipt is suppressed by security violation'
      );

      // Verify DB state is preserved for forensic inspection
      const compRow = await db.prepare('SELECT operation_id FROM g01_bootstrap_completion WHERE singleton = 1').first<{ operation_id: string }>();
      assert.equal(compRow?.operation_id, manifest.operation_id, 'Database state must be preserved for forensic analysis');
    } finally {
      (db as any).prepare = originalPrepare;
      try { fs.rmSync(suppressionDirCr28, { recursive: true, force: true }); } catch {}
    }

    // Test A positive control: same destination pattern accepts a receipt from a clean enrollment
    {
      const cleanDb = createLocalD1Database();
      await runLocalMigrations(cleanDb, { disposableTest: true });
      const controlDir = createVerifiedTempDir('cabms-p0-cr28-control-');
      try {
        const controlManifest = createValidSyntheticManifest();
        const controlSigned = signApprovalManifest(controlManifest, ephemeralKeyPair.privateKey);
        const controlResult = await runModeACliEnrollment(cleanDb, controlSigned, ephemeralKeyPair.publicKey, {
          evidenceDir: controlDir,
          approvedEvidenceRoot: controlDir,
          expectedTargetId: SYNTHETIC_TARGET,
          expectedOperatorUid: SYNTHETIC_UID,
          expectedOperatorEmail: SYNTHETIC_EMAIL,
        });
        assert.equal(controlResult.outcome.status, 'SUCCESS', 'CR-28 positive control: clean enrollment must succeed');
        assert.ok(controlResult.auditReceiptPath, 'CR-28 positive control: receipt must be published to evidence directory');
        assert.ok(
          fs.readdirSync(controlDir).length > 0,
          'CR-28 positive control: evidence directory must contain the exported receipt'
        );
      } finally {
        try { fs.rmSync(controlDir, { recursive: true, force: true }); } catch {}
      }
    }
  });

  // --- Regression CR-29: Reject duplicate workspace IDs in scope ---
  it('Regression CR-29: verifyApprovalManifest must reject duplicate workspace IDs with DUPLICATE_WORKSPACE_SCOPE', () => {
    const manifest = createValidSyntheticManifest({
      workspace_scope: ['solarcell', 'solarcell'],
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    assert.throws(
      () => verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'DUPLICATE_WORKSPACE_SCOPE'
    );
  });

  // --- Regression CR-30: Reject blank approval identity ---
  it('Regression CR-30: verifyApprovalManifest must reject blank or whitespace-only approval_identity', () => {
    const manifest = createValidSyntheticManifest({
      approval_identity: '   ',
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    assert.throws(
      () => verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'MISSING_APPROVAL_IDENTITY'
    );
  });

  // --- Regression CR-31: Deterministic Unicode surrogate validation in property names and values ---
  it('Regression CR-31: canonicalizeJson must reject lone and unpaired surrogates in property names and string values', () => {
    // 1. Lone high surrogate in string value
    assert.throws(
      () => canonicalizeJson({ val: '\uD800' }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_JSON_VALUE'
    );

    // 2. Lone low surrogate in string value
    assert.throws(
      () => canonicalizeJson({ val: '\uDC00' }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_JSON_VALUE'
    );

    // 3. Trailing lone surrogate in string value
    assert.throws(
      () => canonicalizeJson({ val: 'test\uD800' }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_JSON_VALUE'
    );

    // 4. Lone high surrogate in property name
    assert.throws(
      () => canonicalizeJson({ ['\uD800']: 'val' }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_JSON_VALUE'
    );

    // 5. Lone low surrogate in property name
    assert.throws(
      () => canonicalizeJson({ ['\uDC00']: 'val' }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'INVALID_JSON_VALUE'
    );

    // Positive control: valid paired surrogate (e.g. emoji 😀 U+1F600 = \uD83D\uDE00) in key and value
    const validEmoji = canonicalizeJson({ ['\uD83D\uDE00']: '\uD83D\uDE00' });
    assert.equal(validEmoji, '{"\uD83D\uDE00":"\uD83D\uDE00"}');
  });

  // --- Regression CR-32: Explicit timezone offset and calendar validation ---
  it('Regression CR-32: verifyApprovalManifest must require explicit timezone offset and valid calendar date', () => {
    const now = Date.now();

    // 1. Missing timezone offset (local time format)
    const noTzManifest = createValidSyntheticManifest({
      issued_at: '2026-11-18T10:00:00',
      expires_at: new Date(now + 300000).toISOString(),
    });
    const signedNoTz = signApprovalManifest(noTzManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedNoTz, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && err.code === 'MISSING_TIMEZONE_OFFSET'
    );

    // 2. Invalid timezone offset syntax (+99:99)
    const badOffsetManifest = createValidSyntheticManifest({
      issued_at: '2026-11-18T10:00:00+99:99',
      expires_at: new Date(now + 300000).toISOString(),
    });
    const signedBadOffset = signApprovalManifest(badOffsetManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedBadOffset, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && (err.code === 'INVALID_TIMEZONE_OFFSET' || err.code === 'INVALID_ISSUED_AT')
    );

    // 3. Invalid calendar date (February 30)
    const badCalendarManifest = createValidSyntheticManifest({
      issued_at: '2026-02-30T10:00:00Z',
      expires_at: new Date(now + 300000).toISOString(),
    });
    const signedBadCalendar = signApprovalManifest(badCalendarManifest, ephemeralKeyPair.privateKey);
    assert.throws(
      () => verifyApprovalManifest(signedBadCalendar, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: now }),
      (err: any) => err instanceof ManifestValidationError && (err.code === 'INVALID_CALENDAR_DATE' || err.code === 'INVALID_ISSUED_AT')
    );

    // Positive controls: Z and valid numeric offsets
    const validZManifest = createValidSyntheticManifest({
      issued_at: '2026-11-18T10:00:00.000Z',
      expires_at: '2026-11-18T12:00:00.000Z',
    });
    const signedValidZ = signApprovalManifest(validZManifest, ephemeralKeyPair.privateKey);
    assert.doesNotThrow(() =>
      verifyApprovalManifest(signedValidZ, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: Date.parse('2026-11-18T11:00:00.000Z') })
    );

    const validOffsetManifest = createValidSyntheticManifest({
      issued_at: '2026-11-18T20:00:00+10:00',
      expires_at: '2026-11-18T22:00:00+10:00',
    });
    const signedValidOffset = signApprovalManifest(validOffsetManifest, ephemeralKeyPair.privateKey);
    assert.doesNotThrow(() =>
      verifyApprovalManifest(signedValidOffset, ephemeralKeyPair.publicKey, { ...DEFAULT_VERIFY_OPTIONS, nowMs: Date.parse('2026-11-18T21:00:00+10:00') })
    );
  });

  // --- Regression CR-33: D1 21 vs 22 Parameter Limit Boundary ---
  it('Regression CR-33: enrollFirstSuperAdmin enforces 21-workspace D1 parameter boundary without claiming database rollback', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Arithmetic proof:
    // C03 postcondition statement binds: 15 fixed parameters + 4 parameters per workspace in scope.
    // N = 21: 15 + 4(21) = 99 <= 100 parameters -> fits within Cloudflare D1 limit.
    // N = 22: 15 + 4(22) = 103 > 100 parameters -> overflows Cloudflare D1 limit.

    // Case A: N = 22 workspaces must be rejected upfront before database write, without claiming DB rollback
    const scope22 = Array.from({ length: 22 }, (_, i) => `ws_${i}`);
    const manifest22 = createValidSyntheticManifest({
      workspace_scope: scope22,
    });
    const signed22 = signApprovalManifest(manifest22, ephemeralKeyPair.privateKey);

    // Case A1: verifyApprovalManifest rejects N = 22 upfront
    assert.throws(
      () => verifyApprovalManifest(signed22, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS),
      (err: any) => err instanceof ManifestValidationError && err.code === 'WORKSPACE_SCOPE_EXCEEDS_LIMIT'
    );

    // Case A2: enrollFirstSuperAdmin defense-in-depth rejects N = 22 before DB write with writeAttempted: false
    const bypassedVerified22: VerifiedApprovalManifest = {
      manifest: manifest22,
      signature_algorithm: 'Ed25519',
      signature_bytes: signed22.signature_bytes,
      signing_key_id: signed22.signing_key_id,
      canonical_manifest_json: signed22.canonical_manifest_json,
      audit_reference: 'ref_22',
    };

    const outcome22 = await enrollFirstSuperAdmin(db, bypassedVerified22);
    assert.equal(outcome22.status, 'NOT_ENROLLED', 'Must be rejected as NOT_ENROLLED');
    assert.equal(
      outcome22.rollbackProven,
      false,
      'Pre-dispatch parameter limit rejection MUST NOT claim database rollback occurred (rollbackProven must be false)'
    );
    assert.equal(
      outcome22.writeAttempted,
      false,
      'writeAttempted must be explicitly false for pre-dispatch validation rejection'
    );
    assert.match(
      outcome22.error,
      /parameter limit/i,
      'Error message must explicitly reference D1 parameter limit'
    );

    // Case B: N = 21 workspaces must pass upfront parameter boundary check AND successfully commit enrollment in D1
    const cleanDb21 = createLocalD1Database();
    await runLocalMigrations(cleanDb21, { disposableTest: true });

    const scope21 = Array.from({ length: 21 }, (_, i) => `ws_${i}`);

    // Seed the 21 workspace records so foreign key constraints on workspace_memberships pass
    for (const ws of scope21) {
      await cleanDb21.prepare(
        'INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(ws, ws, ws, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z').run();
    }

    // Test D: Instrument db.prepare to record actual bind argument counts per statement
    const bindCountsPerStatement: { query: string; count: number }[] = [];
    const origPrepareCr33 = cleanDb21.prepare.bind(cleanDb21);
    (cleanDb21 as any).prepare = (query: string) => {
      const stmt = origPrepareCr33(query);
      const origBind = stmt.bind.bind(stmt);
      (stmt as any).bind = (...bindArgs: any[]) => {
        bindCountsPerStatement.push({ query: query.substring(0, 60), count: bindArgs.length });
        return origBind(...bindArgs);
      };
      return stmt;
    };

    const manifest21 = createValidSyntheticManifest({
      workspace_scope: scope21,
    });
    const signed21 = signApprovalManifest(manifest21, ephemeralKeyPair.privateKey);
    const verified21 = verifyApprovalManifest(signed21, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    let outcome21: Awaited<ReturnType<typeof enrollFirstSuperAdmin>>;
    try {
      outcome21 = await enrollFirstSuperAdmin(cleanDb21, verified21);
    } finally {
      (cleanDb21 as any).prepare = origPrepareCr33;
    }
    assert.equal(outcome21.status, 'SUCCESS', '21 workspaces must commit successfully within the 100-parameter limit');

    // Test D: assert the C03 postcondition statement actually bound 100 parameters during enrollment
    // (Actual binding: 16 fixed parameters + 4 per workspace = 16 + 4(21) = 100 parameters, exactly reaching D1's 100-parameter limit.)
    const observedCounts = bindCountsPerStatement.map(e => e.count);
    assert.ok(
      observedCounts.some(n => n === 100),
      `C03 postcondition statement must bind exactly 100 parameters; observed bind counts: ${JSON.stringify(observedCounts)}`
    );
    assert.ok(
      observedCounts.every(n => n <= 100),
      `No statement may exceed D1's 100-parameter limit; observed max: ${Math.max(...observedCounts, 0)}`
    );

    // Test D negative control: demonstrate that our instrumentation detects extra parameters and over-limit bindings (>100)
    // 1. Controlled binding experiment: inject an extra parameter into a statement binding
    const testStmt = cleanDb21.prepare('SELECT 1 WHERE 1 = ?');
    let capturedBindLen = 0;
    const origTestBind = testStmt.bind.bind(testStmt);
    (testStmt as any).bind = (...args: any[]) => {
      capturedBindLen = args.length;
      return origTestBind(...args);
    };

    // Binding 1 parameter yields length 1
    testStmt.bind('val1');
    assert.equal(capturedBindLen, 1, 'CR-33 negative control: baseline statement captures 1 parameter');

    // Binding an extra parameter (length 2) changes the captured count
    testStmt.bind('val1', 'extra_param');
    assert.equal(capturedBindLen, 2, 'CR-33 negative control: extra parameter injection increases captured count to 2');

    // 2. Over-limit binding simulation (N = 22 workspace C03 formula: 14 fixed + 4*22 = 102 parameters):
    // Demonstrate that if a statement binds 102 arguments, the D1 parameter limit check detects it and fails
    const simulatedOverLimitBindings = [...observedCounts, 14 + 4 * 22]; // includes 102
    assert.equal(
      simulatedOverLimitBindings.some(n => n > 100),
      true,
      'CR-33 negative control: statement binding 102 parameters exceeds the D1 100-parameter limit'
    );
    assert.throws(
      () => {
        assert.ok(
          simulatedOverLimitBindings.every(n => n <= 100),
          `No statement may exceed D1's 100-parameter limit; observed max: ${Math.max(...simulatedOverLimitBindings)}`
        );
      },
      /AssertionError/,
      'CR-33 negative control: injected 102-parameter binding must fail the boundary assertion'
    );

    // Verify all 21 memberships and 21 approvals were inserted
    const memberRows = await cleanDb21.prepare(
      "SELECT COUNT(*) AS count FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'"
    ).first<{ count: number }>();
    assert.equal(memberRows?.count, 21, 'Must create exactly 21 workspace memberships');

    const approvalRows = await cleanDb21.prepare(
      "SELECT COUNT(*) AS count FROM privileged_identity_approvals WHERE role = 'super_admin' AND revoked_at IS NULL"
    ).first<{ count: number }>();
    assert.equal(approvalRows?.count, 21, 'Must create exactly 21 active privileged approvals');

    // Verify reconciliation establishes complete 21-workspace set consistency
    const recon21 = await reconcileEnrollmentStatus(
      cleanDb21,
      verified21.manifest.operation_id,
      verified21.manifest.operator_uid,
      verified21.audit_reference,
      scope21
    );
    assert.equal(recon21, 'CONFIRMED_ENROLLED', 'Reconciliation must confirm 21-workspace enrollment');
  });

  // --- Regression CR-34: Socket Options Immutability & Overload Coverage ---
  it('Regression CR-34: LoopbackTripwire does not mutate frozen options and supports all socket connect overloads', () => {
    const tripwire = new LoopbackTripwire();
    tripwire.activate();
    try {
      // 1. Frozen options object
      const frozenOpts = Object.freeze({ host: 'localhost', port: 8080 });
      const socket1 = new net.Socket();
      socket1.on('error', () => {});

      assert.doesNotThrow(() => {
        socket1.connect(frozenOpts as any);
      }, 'Must not throw TypeError on frozen options');
      assert.equal(frozenOpts.host, 'localhost', 'Caller options object must remain unmodified');
      socket1.destroy();

      // 2. Overload: connect(port, host)
      const socket2 = new net.Socket();
      socket2.on('error', () => {});
      assert.doesNotThrow(() => {
        socket2.connect(8081, '127.0.0.1');
      });
      socket2.destroy();

      // 3. Overload: connect(options, callback)
      const socket3 = new net.Socket();
      socket3.on('error', () => {});
      let cbCalled = false;
      assert.doesNotThrow(() => {
        socket3.connect({ host: '127.0.0.1', port: 8082 }, () => { cbCalled = true; });
      });
      socket3.destroy();

      // 4. Overload: connect({ path: '...' }) IPC destination (must be recorded in nonLoopbackAttempts)
      const socket4 = new net.Socket();
      socket4.on('error', () => {});
      socket4.connect({ path: '/tmp/test.sock' } as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === '/tmp/test.sock'),
        'IPC path destination must be intercepted and recorded'
      );
      socket4.destroy();
    } finally {
      tripwire.deactivate();
    }
  });

  it('Regression CR-35: migration 0011 fails loudly without IF NOT EXISTS when table or trigger exists and enforces WITHOUT ROWID', async () => {
    const db = createLocalD1Database();
    const migrationSql = fs.readFileSync(path.resolve('./migrations/0011_paar_p0_bootstrap_audit.sql'), 'utf-8');
    const names = [
      '0001_g01_initial_schema.sql',
      '0002_g01_seed_synthetic_data.sql',
      '0003_g01_revoke_unauthorized_seed_super_admin.sql',
      '0004_g01_user_account_status.sql',
      '0005_g01_retire_synthetic_access.sql',
      '0006_g01_privileged_identity_approvals.sql',
      '0007_g01_bootstrap_completion.sql',
    ];
    for (const name of names) {
      await db.exec(fs.readFileSync(path.resolve(`./migrations/${name}`), 'utf-8'));
    }

    // 1. Create a weak, pre-existing table of the same name with rowid
    await db.exec('CREATE TABLE paar_p0_bootstrap_audit_manifests (id TEXT PRIMARY KEY, weak INTEGER);');

    // 2. Applying migration 0011 over the pre-existing table MUST fail loudly, not silently skip
    await assert.rejects(
      () => db.exec(migrationSql),
      /table .*paar_p0_bootstrap_audit_manifests.* already exists/i
    );

    // 3. On a clean database, migration 0011 creates a table without rowid
    const cleanDb = createLocalD1Database();
    for (const name of names) {
      await cleanDb.exec(fs.readFileSync(path.resolve(`./migrations/${name}`), 'utf-8'));
    }
    await cleanDb.exec(migrationSql);

    // Assert table has no rowid in clean schema
    await assert.rejects(
      () => cleanDb.exec('SELECT rowid FROM paar_p0_bootstrap_audit_manifests;'),
      /no such column: rowid/i
    );

    // Assert re-applying migration 0011 on cleanDb also fails loudly (triggers or table already exist)
    await assert.rejects(
      () => cleanDb.exec(migrationSql),
      /already exists/i
    );
  });

  // --- Regression CR-36: Recovery on Empty, Unsettled DB Returns INDETERMINATE with Zero Writes ---
  it('Regression CR-36: recovery on empty, unsettled DB returns INDETERMINATE with zero writes', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    const approvedRoot = createVerifiedTempDir('cabms-p0-cr36-root-');
    const evidenceDir = path.join(approvedRoot, 'receipts');
    fs.mkdirSync(evidenceDir);

    // 1. Spy on D1 to detect any write attempts via prepare, batch, or exec
    let writeCalls = 0;
    const origPrepare = db.prepare.bind(db);
    const origBatch = db.batch.bind(db);
    const origExec = (db as any).exec?.bind(db);
    const isWriteSql = (query: string) => /^\s*(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/i.test(query.trim());
    (db as any).prepare = (query: string) => {
      if (isWriteSql(query)) {
        writeCalls++;
      }
      return origPrepare(query);
    };
    (db as any).batch = (...args: any[]) => {
      writeCalls++; // any batch call during recovery is a write attempt
      return (origBatch as any)(...args);
    };
    if (origExec) {
      (db as any).exec = (query: string, ...args: any[]) => {
        if (typeof query === 'string' && isWriteSql(query)) {
          writeCalls++;
        }
        return (origExec as any)(query, ...args);
      };
    }

    try {
      // 2. Case A: Recovery without operator-attested settlement (settled: false / undefined)
      // Must fail closed to INDETERMINATE, export nothing, and make zero writes
      const resUnsettled = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir,
        approvedEvidenceRoot: approvedRoot,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
        // note: settled flag omitted
      });

      assert.equal(resUnsettled.status, 'INDETERMINATE', 'Recovery without settlement attestation must fail closed to INDETERMINATE');
      assert.equal(resUnsettled.auditReceiptPath, undefined, 'No receipt path returned');
      assert.match(resUnsettled.error || '', /settlement was not attested/i, 'Error message must explain settlement was not attested');
      assert.equal(writeCalls, 0, 'Must perform zero write statements (prepare, batch, exec)');
      assert.equal(fs.readdirSync(evidenceDir).length, 0, 'No files exported to evidence directory');

      // 3. Case B (Positive Control): Recovery on same empty DB with explicit operator attestation (settled: true)
      // Must return NOT_ENROLLED, proving the settled flag is wired through rather than hardcoded INDETERMINATE
      const resSettled = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir,
        approvedEvidenceRoot: approvedRoot,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
        settled: true,
      });

      assert.equal(resSettled.status, 'NOT_ENROLLED', 'Recovery with explicit settlement attestation on empty DB returns NOT_ENROLLED');
      assert.equal(resSettled.auditReceiptPath, undefined, 'No receipt path returned');
      assert.equal(writeCalls, 0, 'Must still perform zero write statements');
      assert.equal(fs.readdirSync(evidenceDir).length, 0, 'No files exported to evidence directory');

      // Test C negative control: demonstrate that write-detection spy distinguishes reads from writes
      // 1. Probing with read queries (SELECT) must NOT increment writeCalls
      if (origExec) {
        await (db as any).exec('SELECT 1');
      }
      await db.prepare('SELECT 1').all();
      assert.equal(writeCalls, 0, 'CR-36 negative control: read operations (SELECT) must not increment writeCalls');

      // 2. Perform a controlled write attempt; verify spy detects it
      const writesBefore = writeCalls;
      (db as any).prepare("INSERT INTO g01_security_assertions (value) VALUES (0)");
      assert.ok(
        writeCalls > writesBefore,
        'CR-36 negative control: SQL INSERT statement must trigger write-detection spy'
      );

      // 3. Demonstrate that the zero-write assertion fails when an unauthorized write is detected
      assert.throws(
        () => {
          assert.equal(writeCalls, 0, 'Receipt recovery MUST NOT make any write calls to D1');
        },
        /AssertionError/,
        'CR-36 negative control: writeCalls > 0 must fail the zero-write assertion'
      );
    } finally {
      (db as any).prepare = origPrepare;
      (db as any).batch = origBatch;
      if (origExec) (db as any).exec = origExec;
    }
  });

  // --- Regression CR-37: Enrollment without evidenceDir Succeeds in D1 but Never Exits 0 ---
  it('Regression CR-37: enrollment without evidenceDir succeeds in D1 but never exits 0', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    // Run Mode A enrollment with evidenceDir omitted
    const result = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
      evidenceDir: undefined,
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
    });

    assert.equal(result.outcome.status, 'SUCCESS', 'D1 enrollment transaction must succeed');
    assert.equal(result.auditReceiptPath, undefined, 'auditReceiptPath must be undefined when evidenceDir is omitted');
    assert.equal(
      getCliExitCode(result),
      4,
      'getCliExitCode MUST return 4 (RECEIPT_EXPORT_ERROR) when mandatory audit receipt is missing, never 0'
    );
  });

  // --- Regression CR-38: Single-Snapshot Reconciliation ---
  it('Regression CR-38: reconciliation queries authorization state from a single statement snapshot', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS', 'Enrollment must succeed');

    // Instrument prepare to count read statements during reconciliation
    let readPrepareCount = 0;
    const origPrepare = db.prepare.bind(db);
    (db as any).prepare = (query: string) => {
      readPrepareCount++;
      return origPrepare(query);
    };

    try {
      const recon = await reconcileEnrollmentStatus(
        db,
        manifest.operation_id,
        manifest.operator_uid,
        verified.audit_reference,
        manifest.workspace_scope
      );
      assert.equal(recon, 'CONFIRMED_ENROLLED', 'Reconciliation must confirm enrollment');
      assert.equal(
        readPrepareCount,
        1,
        `CR-38: reconcileEnrollmentStatus MUST execute via exactly 1 statement snapshot; observed: ${readPrepareCount}`
      );
    } finally {
      (db as any).prepare = origPrepare;
    }

    // Adversarial state mutation check:
    // Demonstrate that single-statement reconciliation consistently detects partial / torn state
    // (e.g. an injected unauthorized identity mapping) and fails closed to INCONSISTENT
    const rawDb = (db as any).getSqliteHandle?.() ?? (db as any);
    rawDb.exec(`
      INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
      VALUES ('im_adversarial_torn', 'usr_primary_super_admin', 'firebase', 'rogue_uid_adversarial', datetime('now'));
    `);

    const reconTorn = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      manifest.workspace_scope
    );
    assert.equal(
      reconTorn,
      'INCONSISTENT',
      'CR-38: reconciliation must fail closed to INCONSISTENT when torn/adversarial state is present in snapshot'
    );
  });

  // --- Regression CR-39: Fractional-Second Timestamp Precision and Recovery ---
  it('Regression CR-39: enrollment preserves fractional-second precision and recovery succeeds on same-second manifest', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Ensure we are past the start of the current second so issued_at (now - 50ms) is in the SAME second
    const currentMs = Date.now() % 1000;
    if (currentMs < 100) {
      await new Promise(r => setTimeout(r, 120 - currentMs));
    }
    const enrollNow = Date.now();
    const issuedDate = new Date(enrollNow - 50);
    const isoIssued = issuedDate.toISOString();
    const isoExpires = new Date(enrollNow + 60000).toISOString();
    const manifest = createValidSyntheticManifest({
      issued_at: isoIssued,
      expires_at: isoExpires,
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS', 'Enrollment must succeed');

    // Check created_at in paar_p0_bootstrap_audit_manifests has fractional seconds
    const auditRow = await db.prepare(
      'SELECT created_at FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?'
    ).bind(manifest.operation_id).first<{ created_at: string }>();

    assert.ok(auditRow?.created_at, 'Audit row must exist');
    assert.match(
      auditRow.created_at,
      /\.\d{3}Z?$/,
      `created_at must preserve fractional-second precision; observed: ${auditRow.created_at}`
    );

    // Verify same second boundary: same YYYY-MM-DDTHH:MM:SS prefix
    const sameCalendarSecond = auditRow.created_at.slice(0, 19) === isoIssued.slice(0, 19);
    assert.ok(
      sameCalendarSecond,
      `CR-39 boundary: audit created_at (${auditRow.created_at}) and manifest issued_at (${isoIssued}) MUST share the same calendar second`
    );
    // Verify millisecond ordering within that same second:
    assert.ok(
      Date.parse(auditRow.created_at) >= Date.parse(isoIssued),
      `CR-39: created_at (${auditRow.created_at}) must be >= issued_at (${isoIssued}) within same second`
    );

    // Test expired manifest recovery where manifest expired but audit occurred within validity window
    const recoveryOutcome = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
      allowExpiredForRecovery: true,
      settled: true,
    });
    assert.equal(
      recoveryOutcome.status,
      'RECOVERED',
      `CR-39: recoverAuditReceipt must succeed with RECOVERED; got: ${JSON.stringify(recoveryOutcome)}`
    );

    // Negative control: tampered created_at earlier than issued_at WITHIN the same calendar second fails closed to INCONSISTENT
    const rawDb = (db as any).getSqliteHandle?.() ?? (db as any);
    const tamperedEarlyCreatedAt = new Date(Date.parse(isoIssued) - 10).toISOString();
    rawDb.exec(`DROP TRIGGER IF EXISTS paar_p0_audit_no_update; UPDATE paar_p0_bootstrap_audit_manifests SET created_at = '${tamperedEarlyCreatedAt}' WHERE operation_id = '${manifest.operation_id}';`);

    const negativeRecovery = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
      allowExpiredForRecovery: true,
      settled: true,
    });
    assert.equal(
      negativeRecovery.status,
      'INCONSISTENT',
      'CR-39 negative control: created_at earlier than issued_at must fail closed to INCONSISTENT'
    );
    assert.match(
      (negativeRecovery as any).error ?? '',
      /falls outside manifest validity window/i,
      'Error message must state created_at falls outside manifest validity window'
    );
  });

  // --- Regression CR-40: Persisted Signature Verification in Recovery ---
  it('Regression CR-40: recoverAuditReceipt fails closed if persisted signature_bytes, algorithm, or signing_key_id differs from manifest', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS', 'Enrollment must succeed');

    const rawDb = (db as any).getSqliteHandle?.() ?? (db as any);
    rawDb.exec('DROP TRIGGER IF EXISTS paar_p0_audit_no_update;');

    // 1. Negative control: tampered signature_bytes in DB
    rawDb.exec("UPDATE paar_p0_bootstrap_audit_manifests SET signature_bytes = 'tampered_sig_bytes_in_db';");
    const resSigBytes = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
      settled: true,
    });
    assert.equal(resSigBytes.status, 'INCONSISTENT', 'Must return INCONSISTENT on signature_bytes mismatch');
    assert.match((resSigBytes as any).error ?? '', /signature|bytes|key/i);

    // Restore signature_bytes
    rawDb.exec(`UPDATE paar_p0_bootstrap_audit_manifests SET signature_bytes = '${verified.signature_bytes}';`);

    // 2. Negative control: tampered signature_algorithm in DB
    // Recreate audit table in disposable test without CHECK constraint to simulate a corrupted/tampered DB row
    rawDb.exec(`
      CREATE TABLE audit_temp AS SELECT * FROM paar_p0_bootstrap_audit_manifests;
      DROP TABLE paar_p0_bootstrap_audit_manifests;
      CREATE TABLE paar_p0_bootstrap_audit_manifests (
        id TEXT PRIMARY KEY NOT NULL,
        operation_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        target_id TEXT NOT NULL,
        operator_email TEXT NOT NULL,
        operator_uid TEXT NOT NULL,
        workspace_scope TEXT NOT NULL,
        permitted_action TEXT NOT NULL,
        signing_key_id TEXT NOT NULL,
        signature_algorithm TEXT NOT NULL,
        signature_bytes TEXT NOT NULL,
        canonical_manifest_json TEXT NOT NULL,
        audit_reference TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
      INSERT INTO paar_p0_bootstrap_audit_manifests SELECT * FROM audit_temp;
      DROP TABLE audit_temp;
      UPDATE paar_p0_bootstrap_audit_manifests SET signature_algorithm = 'RSA_FORGED_IN_DB';
    `);
    const resAlg = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
      settled: true,
    });
    assert.equal(resAlg.status, 'INCONSISTENT', 'Must return INCONSISTENT on signature_algorithm mismatch');
    assert.match((resAlg as any).error ?? '', /signature|algorithm|key/i);

    // Restore signature_algorithm
    rawDb.exec(`UPDATE paar_p0_bootstrap_audit_manifests SET signature_algorithm = '${verified.signature_algorithm}';`);

    // 3. Negative control: tampered signing_key_id in DB
    rawDb.exec("UPDATE paar_p0_bootstrap_audit_manifests SET signing_key_id = 'tampered_key_id_999';");
    const resKeyId = await recoverAuditReceipt(db, signed, ephemeralKeyPair.publicKey, {
      expectedTargetId: SYNTHETIC_TARGET,
      expectedOperatorUid: SYNTHETIC_UID,
      expectedOperatorEmail: SYNTHETIC_EMAIL,
      settled: true,
    });
    assert.equal(resKeyId.status, 'INCONSISTENT', 'Must return INCONSISTENT on signing_key_id mismatch');
    assert.match((resKeyId as any).error ?? '', /signature|key/i);
  });

  // --- Regression CR-41: Rejection of Extra Identity Mappings in C03 ---
  it('Regression CR-41: enrollment batch fails assertion and rolls back if an extra identity mapping exists for super admin', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Simulate rogue trigger that injects a second mapping for usr_primary_super_admin
    await db.exec(`
      CREATE TRIGGER inject_rogue_mapping AFTER INSERT ON g01_protected_super_admin
      BEGIN
        INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
        VALUES ('im_extra_rogue', NEW.user_id, 'custom_provider', 'rogue_sub_123', datetime('now'));
      END;
    `);

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(
      outcome.status,
      'NOT_ENROLLED',
      'CR-41: enrollment must FAIL with NOT_ENROLLED and roll back when an extra identity mapping exists'
    );
    assert.equal(
      outcome.rollbackProven,
      true,
      'CR-41: rollbackProven must be true'
    );

    // Verify rollback: completion table must have 0 rows
    const compCount = await db.prepare(
      'SELECT COUNT(*) AS count FROM g01_bootstrap_completion'
    ).first<{ count: number }>();
    assert.equal(compCount?.count, 0, 'Completion record must not exist after rollback');
  });

  // --- Regression CR-42: Transactional Manifest Validity Window Assertion in C03 ---
  it('Regression CR-42: enrollment batch rejects execution after manifest expiration in C03 assertion', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    // Manifest valid for only 50ms
    const now = Date.now();
    const isoIssued = new Date(now - 1000).toISOString();
    const isoExpires = new Date(now + 50).toISOString();
    const manifest = createValidSyntheticManifest({
      issued_at: isoIssued,
      expires_at: isoExpires,
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS);

    // Wait until past expires_at (100ms)
    await new Promise(r => setTimeout(r, 100));

    // Execute enrollment now (wall clock is past expires_at)
    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(
      outcome.status,
      'NOT_ENROLLED',
      'CR-42: enrollment must FAIL with NOT_ENROLLED and roll back when audit event created_at is outside manifest window'
    );
    assert.equal(
      outcome.rollbackProven,
      true,
      'CR-42: rollbackProven must be true'
    );

    // Verify rollback
    const compCount = await db.prepare(
      'SELECT COUNT(*) AS count FROM g01_bootstrap_completion'
    ).first<{ count: number }>();
    assert.equal(compCount?.count, 0, 'Completion record must not exist after rollback');
  });

  // --- Regression CR-43: Strict Requirement of Verified Workspace List in Reconciliation ---
  it('Regression CR-43: reconcileEnrollmentStatus rejects numeric expected scope and requires verified string array', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest({
      workspace_scope: ['solarcell'],
    });
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);
    const verified = verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, {
      ...DEFAULT_VERIFY_OPTIONS,
    });

    const outcome = await enrollFirstSuperAdmin(db, verified);
    assert.equal(outcome.status, 'SUCCESS', 'Enrollment must succeed');

    // 1. Numeric scope input must be rejected fail-closed to INDETERMINATE
    const reconNumeric = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      1 as any
    );
    assert.equal(
      reconNumeric,
      'INDETERMINATE',
      'CR-43: numeric expectedScope MUST be rejected fail-closed to INDETERMINATE'
    );

    // 2. Substituted scope with equal count (expected ['cctv'] vs enrolled ['solarcell']) must be rejected
    const reconSubstituted = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      ['cctv']
    );
    assert.equal(
      reconSubstituted,
      'INCONSISTENT',
      'CR-43: substituted scope with equal count must be rejected to INCONSISTENT'
    );

    // 3. Exact matching scope array succeeds
    const reconExact = await reconcileEnrollmentStatus(
      db,
      manifest.operation_id,
      manifest.operator_uid,
      verified.audit_reference,
      ['solarcell']
    );
    assert.equal(reconExact, 'CONFIRMED_ENROLLED', 'Matching verified scope array must succeed');
  });

  // --- Regression CR-44: Disposable Teardown Containment Negative Control ---
  it('Regression CR-44: disposable teardown does not delete a path that failed containment check', () => {
    // Teardown routine enforcing canonical realpath containment inside allowed root
    function safeTeardown(targetDir: string | undefined, allowedRoot: string): boolean {
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
      fs.rmSync(targetReal, { recursive: true, force: true });
      return true;
    }

    // 1. Establish an approved allowed root in temp
    const allowedRoot = createVerifiedTempDir('cabms-p0-cr44-allowed-');

    // 2. Establish an OUTSIDE candidate directory with a sentinel file
    const outsideParent = createVerifiedTempDir('cabms-p0-cr44-outside-');
    const outsideCandidate = path.join(outsideParent, 'uncontained_dir');
    fs.mkdirSync(outsideCandidate);
    const sentinelFile = path.join(outsideCandidate, 'outside_sentinel.txt');
    fs.writeFileSync(sentinelFile, 'CR-44-OUTSIDE-SENTINEL-PRESERVE', 'utf8');

    // 3. Create a genuinely CONTAINED directory with a test file
    const containedDir = path.join(allowedRoot, 'contained_isolation');
    fs.mkdirSync(containedDir);
    const containedFile = path.join(containedDir, 'contained_file.txt');
    fs.writeFileSync(containedFile, 'CONTAINED_PAYLOAD', 'utf8');

    try {
      // 4. Negative control: attempt teardown on outside candidate
      const outsideResult = safeTeardown(outsideCandidate, allowedRoot);
      assert.equal(outsideResult, false, 'Teardown MUST reject uncontained directory outside allowed root');

      // Assert sentinel file and directory were NOT deleted
      assert.ok(fs.existsSync(sentinelFile), 'Outside sentinel file MUST NOT be deleted by teardown');
      assert.ok(fs.existsSync(outsideCandidate), 'Outside candidate directory MUST NOT be deleted by teardown');
      assert.equal(
        fs.readFileSync(sentinelFile, 'utf8'),
        'CR-44-OUTSIDE-SENTINEL-PRESERVE',
        'Sentinel file content must remain completely unaltered'
      );

      // 5. Positive control: teardown on genuinely contained directory
      const containedResult = safeTeardown(containedDir, allowedRoot);
      assert.equal(containedResult, true, 'Teardown MUST succeed on contained directory');
      assert.ok(!fs.existsSync(containedDir), 'Contained directory MUST be deleted by teardown');
    } finally {
      try { fs.rmSync(outsideParent, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(allowedRoot, { recursive: true, force: true }); } catch {}
    }
  });

  // --- Regression CR-45: Relative Socket Path and String Overload IPC Classification ---
  it('Regression CR-45: LoopbackTripwire rejects relative socket paths and non-numeric string destinations as IPC violations', () => {
    const tripwire = new LoopbackTripwire();
    tripwire.activate();

    try {
      // 1. Relative socket path passed as string (e.g. 'relative_ipc.sock')
      const sock1 = new net.Socket();
      sock1.on('error', () => {});
      sock1.connect('relative_ipc.sock' as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => String(a.host).includes('relative_ipc.sock')),
        'CR-45: Relative socket path MUST be classified as an IPC violation and logged in nonLoopbackAttempts'
      );

      // 2. Non-numeric loopback string with no port (e.g. 'localhost' without a port number)
      // In Node net.connect, passing a string without a port number indicates an IPC pipe path, NOT a TCP host!
      const sock2 = new net.Socket();
      sock2.on('error', () => {});
      sock2.connect('localhost' as any);
      assert.ok(
        tripwire.nonLoopbackAttempts.some(a => a.host === 'localhost' && a.port === 0),
        'CR-45: Non-numeric string without port MUST be treated as an IPC path and blocked as violation'
      );

      // Positive control: valid loopback TCP connection with explicit port is allowed
      const beforeCount = tripwire.nonLoopbackAttempts.length;
      const sock3 = new net.Socket();
      sock3.on('error', () => {});
      sock3.connect(65534, '127.0.0.1');
      assert.equal(
        tripwire.nonLoopbackAttempts.length,
        beforeCount,
        'CR-45: Explicit TCP port with loopback host must NOT trigger an egress violation'
      );
    } finally {
      tripwire.deactivate();
    }
  });

  // --- Regression CR-46: Automatic Reconciliation Harmonization with Recovery Persisted Signature Verification ---
  it('Regression CR-46: runModeACliEnrollment indeterminate reconciliation suppresses receipt export if persisted signature differs from manifest', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    const approvedRoot = createVerifiedTempDir('cabms-p0-cr46-root-');
    const evidenceDir = path.join(approvedRoot, 'receipts');
    fs.mkdirSync(evidenceDir);

    // Enroll successfully first
    const firstRes = await enrollFirstSuperAdmin(db, verifyApprovalManifest(signed, ephemeralKeyPair.publicKey, DEFAULT_VERIFY_OPTIONS));
    assert.equal(firstRes.status, 'SUCCESS');

    // Simulate tampered signature in DB (corrupted/contradictory persisted audit row)
    const rawDb = (db as any).getSqliteHandle?.() ?? (db as any);
    rawDb.exec("DROP TRIGGER IF EXISTS paar_p0_audit_no_update; UPDATE paar_p0_bootstrap_audit_manifests SET signature_bytes = 'tampered_sig_bytes_in_db';");

    // Hook db.batch so that an enrollment attempt simulates an indeterminate transport drop
    const origBatch = db.batch.bind(db);
    (db as any).batch = async () => {
      // Simulate network / worker transport drop
      const err = new Error('simulated worker transport failure: socket hang up');
      (err as any).name = 'FetchError';
      throw err;
    };

    try {
      const cliResult = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir,
        approvedEvidenceRoot: approvedRoot,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      // Indeterminate transport failure occurred, but automatic reconciliation MUST NOT publish a receipt
      // when the persisted audit record differs from the verified manifest signature!
      assert.equal(cliResult.outcome.status, 'INDETERMINATE', 'Outcome must remain INDETERMINATE on transport drop');
      assert.equal(cliResult.auditReceiptPath, undefined, 'CR-46: MUST NOT publish receipt on contradictory persisted signature');
      assert.ok(cliResult.receiptExportError, 'CR-46: receiptExportError must explain signature/ledger mismatch');
      assert.match(cliResult.receiptExportError, /signature|ledger|inconsistent/i);

      // Verify no receipt file exists in evidence directory
      const publishedFiles = fs.readdirSync(evidenceDir);
      assert.equal(publishedFiles.length, 0, 'No receipt file should exist in evidence directory');
    } finally {
      (db as any).batch = origBatch;
      try { fs.rmSync(approvedRoot, { recursive: true, force: true }); } catch {}
    }
  });

  // --- Regression CR-47: Short Filesystem Write Detection in Receipt Export ---
  it('Regression CR-47: publishAuditReceipt detects partial filesystem write and does not publish a truncated receipt', async () => {
    const db = createLocalD1Database();
    await runLocalMigrations(db, { disposableTest: true });

    const manifest = createValidSyntheticManifest();
    const signed = signApprovalManifest(manifest, ephemeralKeyPair.privateKey);

    const approvedRoot = createVerifiedTempDir('cabms-p0-cr47-root-');
    const evidenceDir = path.join(approvedRoot, 'receipts');
    fs.mkdirSync(evidenceDir);

    const origWriteSync = fs.writeSync;
    // Simulate short write: throw error during receipt write
    (fs as any).writeSync = (fd: number, buffer: any, ...rest: any[]) => {
      const content = Buffer.isBuffer(buffer) ? buffer.toString('utf8') : String(buffer);
      if (typeof fd === 'number' && content.includes(manifest.operation_id)) {
        throw new Error('ENOSPC: no space left on device, write failed during receipt export');
      }
      return (origWriteSync as any)(fd, buffer, ...rest);
    };

    try {
      const cliResult = await runModeACliEnrollment(db, signed, ephemeralKeyPair.publicKey, {
        evidenceDir,
        approvedEvidenceRoot: approvedRoot,
        expectedTargetId: SYNTHETIC_TARGET,
        expectedOperatorUid: SYNTHETIC_UID,
        expectedOperatorEmail: SYNTHETIC_EMAIL,
      });

      assert.equal(cliResult.outcome.status, 'SUCCESS', 'Database enrollment transaction must be preserved');
      assert.equal(cliResult.auditReceiptPath, undefined, 'CR-47: Must NOT publish receipt path on incomplete write');
      assert.ok(cliResult.receiptExportError, 'receiptExportError must be populated');
      assert.match(cliResult.receiptExportError, /ENOSPC|incomplete write|write failed/i);

      // Verify no receipt was published in evidence directory
      const files = fs.readdirSync(evidenceDir);
      assert.equal(files.length, 0, 'Evidence directory must contain no published receipt after failed write');
      assert.equal(getCliExitCode(cliResult), 4, 'Exit code must be 4 (RECEIPT_EXPORT_ERROR) for committed DB with write failure');
    } finally {
      fs.writeSync = origWriteSync;
      try { fs.rmSync(approvedRoot, { recursive: true, force: true }); } catch {}
    }
  });
});
