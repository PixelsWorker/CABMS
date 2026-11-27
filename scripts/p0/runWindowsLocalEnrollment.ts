/** One-time Windows development enrollment; no remote target or automatic retry. */
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { lstatSync, realpathSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import path from 'node:path';
import { connect } from 'node:net';
import { LocalD1Database } from '../../backend/db/d1.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import { canonicalizeJson } from './approvalManifest.ts';
import { verifyModeBApproval } from './modeBContract.ts';
import { executeLocalEnrollment } from './adminEnrollmentEngine.ts';
import { loadWindowsLocalTargetConfig, validateWindowsLocalTarget } from './windowsLocalTarget.ts';

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--local') {
    throw new Error('Exactly --local is required');
  }
  const target = loadWindowsLocalTargetConfig(process.env);
  const suppliedRoot = process.env.CABMS_WINDOWS_SUPPLIED_ROOT?.trim() || target.root;
  const suppliedDatabase = process.env.CABMS_WINDOWS_SUPPLIED_DATABASE?.trim() || target.database;
  const suppliedUid = process.env.CABMS_WINDOWS_SUPPLIED_UID?.trim() || target.uid;
  const suppliedEmail = process.env.CABMS_WINDOWS_SUPPLIED_EMAIL?.trim() || target.email;

  validateWindowsLocalTarget(
    { root: suppliedRoot, database: suppliedDatabase, uid: suppliedUid, email: suppliedEmail, local: true },
    target
  );

  const portOpen = await new Promise<boolean>((resolve) => {
    const s = connect({ host: '127.0.0.1', port: 8787 });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
  if (portOpen) throw new Error('Stop the local Worker on port 8787 before opening the database');

  const database = path.join(target.root, 'v3', 'd1', 'miniflare-D1DatabaseObject', target.database);
  for (const p of [
    target.root,
    path.join(target.root, 'v3'),
    path.join(target.root, 'v3', 'd1'),
    path.dirname(database),
    database,
  ]) {
    const stat = lstatSync(p);
    if (stat.isSymbolicLink() || realpathSync(p).toLowerCase() !== path.resolve(p).toLowerCase()) {
      throw new Error(`Unexpected redirected path: ${p}`);
    }
  }
  const stat = lstatSync(database);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Database must be a single regular file');

  const sqlite = new DatabaseSync(database);
  const db = new LocalD1Database(sqlite);
  try {
    sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    if ((sqlite.prepare('PRAGMA integrity_check').get() as any).integrity_check !== 'ok') {
      throw new Error('Source integrity check failed');
    }
    const ledger = sqlite.prepare('SELECT name FROM d1_migrations ORDER BY id').all() as Array<{ name: string }>;
    const expected = loadVerifiedMigrations();
    if (ledger.length !== expected.length || ledger.some((r, i) => r.name !== expected[i].name)) {
      throw new Error('Migration ledger mismatch');
    }

    const evidenceBase =
      process.env.CABMS_WINDOWS_LOCAL_EVIDENCE_DIR?.trim() || path.join(target.root, 'enrollment-evidence');
    mkdirSync(evidenceBase, { recursive: true });
    const dir = path.join(evidenceBase, `windows-local-enrollment-${randomUUID()}`);
    mkdirSync(dir);
    const backupPath = path.join(dir, 'before.sqlite');
    await backup(sqlite, backupPath);

    const check = new DatabaseSync(backupPath, { readOnly: true });
    try {
      if ((check.prepare('PRAGMA integrity_check').get() as any).integrity_check !== 'ok') {
        throw new Error('Backup integrity check failed');
      }
      const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>;
      for (const { name } of tables) {
        const q = `SELECT count(*) AS n FROM "${name.replaceAll('"', '""')}"`;
        if ((sqlite.prepare(q).get() as any).n !== (check.prepare(q).get() as any).n) {
          throw new Error(`Backup count mismatch: ${name}`);
        }
      }
    } finally {
      check.close();
    }

    const now = Date.now();
    const scope = ['solarcell', 'smart_home', 'cctv'];
    const keys = generateKeyPairSync('ed25519');
    const m = {
      domain: 'CABMS/MODE-B/v1',
      operation_id: `op_${randomUUID()}`,
      nonce: randomUUID(),
      account_id: 'LOCAL-DEVELOPMENT-ONLY',
      target_id: 'local-cabms-db',
      target_user_id: 'usr_primary_super_admin',
      operator_email: suppliedEmail,
      operator_uid: suppliedUid,
      workspace_scope: scope,
      permitted_action: 'bootstrap_super_admin',
      issued_at: new Date(now - 60000).toISOString(),
      expires_at: new Date(now + 300000).toISOString(),
      signing_key_id: 'LOCAL-TEST-KEY',
      approval_identity: 'LOCAL-TEST-ONLY-NOT-CLOUD',
    };
    const canonical = canonicalizeJson(m);
    const signature = sign(null, Buffer.from(canonical), keys.privateKey).toString('base64url');
    const envelope = {
      manifest: m,
      signature_algorithm: 'Ed25519',
      signature_bytes: signature,
      signing_key_id: m.signing_key_id,
      canonical_manifest_json: canonical,
    };
    const approval = verifyModeBApproval(JSON.stringify(envelope), keys.publicKey, {
      accountId: m.account_id,
      databaseId: m.target_id,
      userId: m.target_user_id,
      email: target.email,
      uid: target.uid,
      workspaceIds: scope,
      keyId: m.signing_key_id,
      publicKeySha256: createHash('sha256').update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
      nowMs: now,
    });
    writeFileSync(path.join(dir, 'approval.json'), JSON.stringify(envelope, null, 2), { flag: 'wx' });
    writeFileSync(path.join(dir, 'public-key.pem'), keys.publicKey.export({ type: 'spki', format: 'pem' }), {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        backup: backupPath,
        backup_sha256: createHash('sha256').update(readFileSync(backupPath)).digest('hex'),
        operation_id: m.operation_id,
        audit_reference: approval.audit_reference,
      })
    );
    const result = await executeLocalEnrollment(db, approval, { email: target.email, uid: target.uid });
    console.log(JSON.stringify(result));
    if (result.status !== 'CONFIRMED_ENROLLED') process.exitCode = 1;
  } finally {
    sqlite.close();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
