// Disposable in-memory bootstrap test proving legacy bootstrap script fails closed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLocalD1Database } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';

test('G01: legacy bootstrap script is retired and fails closed with zero mutations', async () => {
  const db = createLocalD1Database();
  await runLocalMigrations(db, { disposableTest: true });

  const rawScript = fs.readFileSync(path.resolve('./scripts/bootstrap_first_super_admin.sql'), 'utf-8');

  // Executing the retired legacy script must throw an error due to CHECK constraint violation on g01_security_assertions
  await assert.rejects(
    async () => {
      await db.exec(rawScript);
    },
    /CHECK constraint failed: value = 0/
  );

  // Assert zero rows created in users, user_identity_mappings, workspace_memberships, g01_protected_super_admin, g01_bootstrap_completion
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE id = 'map_primary_super_admin'").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM g01_protected_super_admin").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM g01_bootstrap_completion").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM privileged_identity_approvals WHERE role = 'super_admin'").first<{ n: number }>())?.n, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests").first<{ n: number }>())?.n, 0);
});

test('G01: legacy bootstrap script fails closed even if executed on schema prior to migration 0006', async () => {
  const db = createLocalD1Database();
  // Apply only migrations 0001 through 0005 (before g01_security_assertions was created in 0006)
  const apply = (name: string) => db.exec(fs.readFileSync(`migrations/${name}`, 'utf8'));
  await apply('0001_g01_initial_schema.sql');
  await apply('0002_g01_seed_synthetic_data.sql');
  await apply('0003_g01_revoke_unauthorized_seed_super_admin.sql');
  await apply('0004_g01_user_account_status.sql');
  await apply('0005_g01_retire_synthetic_access.sql');

  const rawScript = fs.readFileSync(path.resolve('./scripts/bootstrap_first_super_admin.sql'), 'utf-8');

  // Must fail closed because g01_security_assertions table does not exist
  await assert.rejects(
    async () => {
      await db.exec(rawScript);
    },
    /no such table: g01_security_assertions/
  );

  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);
});
