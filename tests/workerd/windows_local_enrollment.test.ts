import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import { canonicalizeJson } from '../../scripts/p0/approvalManifest.ts';
import { verifyModeBApproval } from '../../scripts/p0/modeBContract.ts';
import { executeLocalEnrollment } from '../../scripts/p0/adminEnrollmentEngine.ts';
import {
  loadWindowsLocalTargetConfig,
  validateWindowsLocalTarget,
  type WindowsLocalTargetConfig,
} from '../../scripts/p0/windowsLocalTarget.ts';

const { createTestHarness } = createRequire(import.meta.url)('wrangler');

function syntheticTarget(tempRoot: string): WindowsLocalTargetConfig {
  return loadWindowsLocalTargetConfig({
    CABMS_WINDOWS_LOCAL_ROOT: tempRoot,
    CABMS_WINDOWS_LOCAL_DATABASE: 'fixture-local.sqlite',
    CABMS_WINDOWS_LOCAL_UID: 'fixture-uid-0001',
    CABMS_WINDOWS_LOCAL_EMAIL: 'fixture@example.invalid',
  });
}

function approval() {
  const key = generateKeyPairSync('ed25519'),
    now = Date.now(),
    scope = ['solarcell', 'smart_home', 'cctv'];
  const m = {
    domain: 'CABMS/MODE-B/v1',
    operation_id: `op_${randomUUID()}`,
    nonce: randomUUID(),
    account_id: 'LOCAL-DEVELOPMENT-ONLY',
    target_id: 'local-cabms-db',
    target_user_id: 'usr_primary_super_admin',
    operator_email: 'fixture@example.invalid',
    operator_uid: 'fixture-uid-0001',
    workspace_scope: scope,
    permitted_action: 'bootstrap_super_admin',
    issued_at: new Date(now - 60000).toISOString(),
    expires_at: new Date(now + 300000).toISOString(),
    signing_key_id: 'LOCAL-TEST-KEY',
    approval_identity: 'LOCAL-TEST-ONLY-NOT-CLOUD',
  };
  const canonical = canonicalizeJson(m),
    signature = sign(null, Buffer.from(canonical), key.privateKey).toString('base64url');
  return verifyModeBApproval(
    JSON.stringify({
      manifest: m,
      signature_algorithm: 'Ed25519',
      signature_bytes: signature,
      signing_key_id: m.signing_key_id,
      canonical_manifest_json: canonical,
    }),
    key.publicKey,
    {
      accountId: m.account_id,
      databaseId: m.target_id,
      userId: m.target_user_id,
      email: m.operator_email,
      uid: m.operator_uid,
      workspaceIds: scope,
      keyId: m.signing_key_id,
      publicKeySha256: createHash('sha256').update(key.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
      nowMs: now,
    }
  );
}

test('disposable workerd D1: success, rejection, rollback, replay and uncertain result', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cabms-mode-b-'));
  let server: any;
  try {
    const migrations = path.join(dir, 'migrations');
    mkdirSync(migrations);
    for (const m of loadVerifiedMigrations()) writeFileSync(path.join(migrations, m.name), m.bytes);
    const workers = ['success', 'conflict', 'uncertain', 'rollback'].map((name) => {
      const config = path.join(dir, `${name}.json`);
      writeFileSync(
        config,
        JSON.stringify({
          name: `cabms-b-${name}`,
          main: path.resolve('tests/support/worker.ts'),
          compatibility_date: '2026-10-28',
          compatibility_flags: ['nodejs_compat'],
          d1_databases: [
            { binding: 'DB', database_name: `cabms-${name}`, database_id: `test-${name}`, migrations_dir: migrations },
          ],
          vars: { ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' },
        })
      );
      return { configPath: config };
    });
    server = createTestHarness({ workers });
    await server.listen();
    const dbs = [];
    for (const name of ['success', 'conflict', 'uncertain', 'rollback']) {
      const w = server.getWorker(`cabms-b-${name}`);
      await w.applyD1Migrations('DB');
      dbs.push((await w.getEnv()).DB);
    }
    const [db, conflict, uncertain, rollback] = dbs;
    const a = approval(),
      expected = { email: a.manifest.operator_email, uid: a.manifest.operator_uid };
    const trustedTarget = syntheticTarget(dir);

    assert.throws(() =>
      validateWindowsLocalTarget(
        { root: `${trustedTarget.root}-other`, database: trustedTarget.database, uid: trustedTarget.uid, email: trustedTarget.email, local: true },
        trustedTarget
      )
    );
    assert.throws(() =>
      validateWindowsLocalTarget(
        { root: trustedTarget.root, database: 'wrong.sqlite', uid: trustedTarget.uid, email: trustedTarget.email, local: true },
        trustedTarget
      )
    );
    assert.throws(() =>
      validateWindowsLocalTarget(
        { root: trustedTarget.root, database: trustedTarget.database, uid: 'wrong-uid-0001', email: trustedTarget.email, local: true },
        trustedTarget
      )
    );

    assert.equal((await executeLocalEnrollment(db, a, { ...expected, uid: 'wrong' })).status, 'REJECTED');
    assert.equal((await executeLocalEnrollment(db, a, expected)).status, 'CONFIRMED_ENROLLED');
    assert.equal(
      (
        await db
          .prepare("select count(*) n from workspace_memberships where user_id=? and role='super_admin'")
          .bind(a.manifest.target_user_id)
          .first()
      ).n,
      3
    );
    assert.equal((await executeLocalEnrollment(db, a, expected)).status, 'CONFIRMED_ENROLLED');
    assert.equal((await db.prepare('select count(*) n from paar_p0_bootstrap_audit_manifests').first()).n, 1);

    await conflict
      .prepare(
        "insert into users(id,email,display_name,disabled,created_at,updated_at) values('other',?,'conflict',0,datetime('now'),datetime('now'))"
      )
      .bind(expected.email)
      .run();
    const result = await executeLocalEnrollment(conflict, approval(), expected);
    assert.equal(result.status, 'INDETERMINATE');
    assert.equal((await conflict.prepare("select count(*) n from users where id='usr_primary_super_admin'").first()).n, 0);
    assert.equal((await conflict.prepare('select count(*) n from workspace_memberships').first()).n, 0);

    await rollback.exec(
      "CREATE TRIGGER test_abort_membership BEFORE INSERT ON workspace_memberships BEGIN SELECT RAISE(ABORT, 'injected failure'); END;"
    );
    assert.equal((await executeLocalEnrollment(rollback, approval(), expected)).status, 'INDETERMINATE');
    assert.equal((await rollback.prepare("select count(*) n from users where id='usr_primary_super_admin'").first()).n, 0);
    assert.equal((await rollback.prepare('select count(*) n from user_identity_mappings').first()).n, 0);
    assert.equal((await rollback.prepare('select count(*) n from paar_p0_bootstrap_audit_manifests').first()).n, 0);

    const a2 = approval();
    let calls = 0;
    const wrapper = {
      prepare: uncertain.prepare.bind(uncertain),
      batch: async (s: any[]) => {
        calls++;
        await uncertain.batch(s);
        throw new Error('lost response');
      },
      exec: uncertain.exec.bind(uncertain),
      dump: uncertain.dump.bind(uncertain),
    };
    assert.equal((await executeLocalEnrollment(wrapper, a2, expected)).status, 'CONFIRMED_ENROLLED');
    assert.equal(calls, 1);
  } finally {
    if (server) await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
