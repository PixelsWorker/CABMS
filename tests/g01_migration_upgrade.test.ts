import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalD1Database } from '../backend/db/d1.ts';

test('G01 legacy seed upgrade revokes only the target identity and preserves settings and audit', async () => {
  const db = createLocalD1Database();
  const apply = (name: string) => db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  await apply('0001_g01_initial_schema.sql');
  await apply('0002_g01_seed_synthetic_data.sql');
  await db.exec(`UPDATE users SET email = 'admin@chinedigital.com.au' WHERE id = 'usr_chine_super_admin';
    INSERT INTO user_identity_mappings VALUES ('legacy-map', 'usr_chine_super_admin', 'firebase', 'legacy-uid', '2026-01-01');
    INSERT INTO workspace_memberships VALUES ('legacy-member', 'solarcell', 'usr_chine_super_admin', 'super_admin', '2026-01-01', '2026-01-01');
    UPDATE workspace_settings SET version = 7 WHERE workspace_id = 'solarcell';
    INSERT INTO settings_audit_events VALUES ('legacy-audit', 'solarcell', 'workspace_settings', 'solarcell', 'SETTINGS_UPDATED', 6, 7, '{}', '{}', 'usr_chine_super_admin', 'req-legacy', 'nonce-legacy', '2026-01-01');`);
  await apply('0003_g01_revoke_unauthorized_seed_super_admin.sql');
  await apply('0004_g01_user_account_status.sql');
  const user = await db.prepare("SELECT email, disabled FROM users WHERE id = 'usr_chine_super_admin'").first<{ email: string; disabled: number }>();
  assert.equal(user?.email, 'admin@chine.example.invalid');
  assert.equal(user?.disabled, 0);
  for (const table of ['workspace_memberships', 'user_identity_mappings']) {
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind('usr_chine_super_admin').first<{ n: number }>())?.n, 0);
  }
  assert.equal((await db.prepare("SELECT version FROM workspace_settings WHERE workspace_id = 'solarcell'").first<{ version: number }>())?.version, 7);
  assert.equal((await db.prepare("SELECT actor_user_id FROM settings_audit_events WHERE id = 'legacy-audit'").first<{ actor_user_id: string }>())?.actor_user_id, 'usr_chine_super_admin');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_owner_admin'").first<{ n: number }>())?.n, 1);
});
