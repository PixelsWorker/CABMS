// Existing bootstrap test; execute only with separate bootstrap approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createLocalD1Database } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';

test('G01: first-admin bootstrap is strictly one-time and guarded against resurrecting revoked memberships', async () => {
  const db = createLocalD1Database();
  await runLocalMigrations(db, { disposableTest: true });

  const rawScript = fs.readFileSync(path.resolve('./scripts/bootstrap_first_super_admin.sql'), 'utf-8');

  // 1. Placeholder protection: raw unmodified script does not insert any records
  await db.exec(rawScript);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);

  // 2. Real operator bootstrap executes successfully on first run
  const customizedScript = rawScript.replaceAll('OPERATOR_FIREBASE_UID_PLACEHOLDER', 'firebase_uid_real_operator');
  await db.exec(customizedScript);

  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE id = 'map_primary_super_admin'").first<{ n: number }>())?.n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 3);

  // 3. Rerunning script with active memberships performs no mutations
  await db.exec(customizedScript);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 3);

  // 4. Rerunning after partial revocation: deleted solarcell membership is NOT resurrected
  await db.prepare("DELETE FROM workspace_memberships WHERE id = 'mem_sa_primary_solarcell'").run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 2);

  await db.exec(customizedScript);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE id = 'mem_sa_primary_solarcell'").first<{ n: number }>())?.n, 0);

  // 5. Rerunning after full revocation: deleted memberships are NOT resurrected
  await db.prepare("DELETE FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);

  await db.exec(customizedScript);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'").first<{ n: number }>())?.n, 0);
});

