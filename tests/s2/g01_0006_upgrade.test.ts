import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, LocalD1Database } from '../../backend/db/d1.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';

test('0006 upgrade does not automatically approve an existing privileged mapping', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    const migrations = loadVerifiedMigrations();
    assert.equal(migrations[5]?.name, '0006_g01_privileged_identity_approvals.sql');
    for (const migration of migrations.slice(0, 5)) await db.exec(migration.bytes.toString('utf8'));
    await db.exec(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ('upgrade_privileged','upgrade-privileged@example.invalid','Upgrade test','2026','2026');
      INSERT INTO user_identity_mappings VALUES ('upgrade_mapping','upgrade_privileged','firebase','upgrade_uid','2026');
      INSERT INTO workspace_memberships VALUES ('upgrade_membership','solarcell','upgrade_privileged','owner_admin','2026','2026');`);
    await db.exec(migrations[5].bytes.toString('utf8'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals').first<{n:number}>())?.n, 0);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM g01_protected_super_admin').first<{n:number}>())?.n, 0);
    assert.equal((await db.prepare("SELECT role FROM workspace_memberships WHERE id = 'upgrade_membership'").first<{role:string}>())?.role, 'owner_admin');
    assert.equal((await db.prepare("SELECT user_id FROM user_identity_mappings WHERE id = 'upgrade_mapping'").first<{user_id:string}>())?.user_id, 'upgrade_privileged');
  } finally { db.getSqliteHandle().close(); }
});
