// Disposable in-memory SQLite test; persistent migration remains approval-gated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, LocalD1Database } from '../../backend/db/d1.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';

const retired = ['usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician'];

test('0005 retires old identities on an upgraded database and preserves unrelated records', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    const snapshots = loadVerifiedMigrations();
    assert.equal(snapshots[4]?.name, '0005_g01_retire_synthetic_access.sql');
    for (const migration of snapshots.slice(0, 4)) await db.exec(migration.bytes.toString('utf8'));
    await db.exec(`
      INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES
        ('upgrade_control_user','upgrade-control@example.invalid','Upgrade control','2026','2026');
      INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES
        ('upgrade_control_mapping','upgrade_control_user','firebase','upgrade_control_uid','2026');
      INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES
        ('upgrade_control_membership','solarcell','upgrade_control_user','office_staff','2026','2026');
      UPDATE workspace_settings SET version = 7 WHERE workspace_id = 'solarcell';
      INSERT INTO settings_audit_events VALUES
        ('upgrade_control_audit','solarcell','workspace_settings','solarcell','SETTINGS_UPDATED',6,7,'{}','{}','upgrade_control_user','upgrade_control_request','upgrade_control_nonce','2026');
    `);
    const memberBefore = await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_owner_admin'").first<{n:number}>();
    assert.equal(memberBefore?.n, 1);
    await db.exec(snapshots[4].bytes.toString('utf8'));
    for (const id of retired) {
      const user = await db.prepare('SELECT disabled FROM users WHERE id = ?').bind(id).first<{disabled:number}>();
      assert.equal(user?.disabled, 1);
      const memberships = await db.prepare('SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = ?').bind(id).first<{n:number}>();
      const mappings = await db.prepare("SELECT COUNT(*) AS n FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(id).first<{n:number}>();
      assert.equal(memberships?.n, 0);
      assert.equal(mappings?.n, 0);
    }
    assert.equal((await db.prepare("SELECT disabled FROM users WHERE id = 'upgrade_control_user'").first<{disabled:number}>())?.disabled, 0);
    assert.equal((await db.prepare("SELECT user_id FROM user_identity_mappings WHERE id = 'upgrade_control_mapping'").first<{user_id:string}>())?.user_id, 'upgrade_control_user');
    assert.equal((await db.prepare("SELECT user_id FROM workspace_memberships WHERE id = 'upgrade_control_membership'").first<{user_id:string}>())?.user_id, 'upgrade_control_user');
    assert.equal((await db.prepare("SELECT version FROM workspace_settings WHERE workspace_id = 'solarcell'").first<{version:number}>())?.version, 7);
    assert.equal((await db.prepare("SELECT actor_user_id FROM settings_audit_events WHERE id = 'upgrade_control_audit'").first<{actor_user_id:string}>())?.actor_user_id, 'upgrade_control_user');
  } finally {
    db.getSqliteHandle().close();
  }
});

test('0005 cannot itself distinguish a repurposed retired ID: collision inventory is mandatory', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    const snapshots = loadVerifiedMigrations();
    assert.equal(snapshots[4]?.name, '0005_g01_retire_synthetic_access.sql');
    for (const migration of snapshots.slice(0, 4)) await db.exec(migration.bytes.toString('utf8'));
    await db.prepare("UPDATE users SET email = ?, display_name = ? WHERE id = ?")
      .bind('repurposed-user@example.invalid', 'Repurposed user', 'usr_owner_admin').run();
    await db.exec(snapshots[4].bytes.toString('utf8'));
    assert.equal((await db.prepare("SELECT disabled FROM users WHERE id = 'usr_owner_admin'").first<{disabled:number}>())?.disabled, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM workspace_memberships WHERE user_id = 'usr_owner_admin'").first<{n:number}>())?.n, 0);
  } finally {
    db.getSqliteHandle().close();
  }
});
