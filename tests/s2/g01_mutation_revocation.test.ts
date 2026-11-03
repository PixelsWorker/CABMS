import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalD1Database, LocalD1Database, type D1Database, type D1PreparedStatement } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';
import { createWorker } from '../../backend/index.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';

for (const resource of ['settings', 'legal-details'] as const) {
  test(`${resource}: revocation before the update denies the write without audit`, async () => {
    const db = createLocalD1Database() as LocalD1Database;
    try {
      await runLocalMigrations(db, { disposableTest: true });
      await installG01TestAuthFixtures(db);
      const actor = resource === 'settings' ? G01_TEST_AUTH.ownerAdmin : G01_TEST_AUTH.superAdmin;
      const table = resource === 'settings' ? 'workspace_settings' : 'legal_issuers';
      const before = await db.prepare(`SELECT * FROM ${table} WHERE workspace_id = 'solarcell'`).first();
      assert.ok(before);
      let revoked = false;
      const intercepted: D1Database = {
        prepare: sql => db.prepare(sql), exec: sql => db.exec(sql), dump: () => db.dump(),
        batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
          if (statements.some(s => new RegExp(`^\\s*UPDATE\\s+${table}\\b`, 'i').test(s.query))) {
            assert.equal(revoked, false);
            await db.prepare('DELETE FROM workspace_memberships WHERE user_id = ? AND workspace_id = ?').bind(actor.userId, 'solarcell').run();
            revoked = true;
          }
          return db.batch<T>(statements);
        },
      };
      const fixture = await createFirebaseFixture();
      const token = await fixture.token(actor.uid, actor.email);
      const worker = createWorker(createAuthenticationService(fixture.transport));
      const body = resource === 'settings' ? { trading_name: 'Unauthorized change' } : { legal_issuer_name: 'Unauthorized change' };
      const response = await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${resource}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(body),
      }), { DB: intercepted, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
      assert.equal(revoked, true, 'must intercept the actual mutation batch');
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('ETag'), null);
      const denied = await response.json() as Record<string, unknown>;
      assert.equal(denied.code, 'ACCESS_DENIED');
      assert.equal(JSON.stringify(denied).includes('version'), false);
      assert.deepEqual(await db.prepare(`SELECT * FROM ${table} WHERE workspace_id = 'solarcell'`).first(), before);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings_audit_events').first<{n:number}>())?.n, 0);
    } finally { db.getSqliteHandle().close(); }
  });
}

for (const event of ['disable', 'remove-mapping', 'revoke-approval'] as const) {
  test(`settings: ${event} immediately before the update denies the write`, async () => {
    const db = createLocalD1Database() as LocalD1Database;
    try {
      await runLocalMigrations(db, { disposableTest: true });
      await installG01TestAuthFixtures(db);
      const actor = G01_TEST_AUTH.ownerAdmin;
      const before = await db.prepare("SELECT * FROM workspace_settings WHERE workspace_id = 'solarcell'").first();
      let fired = false;
      const intercepted: D1Database = {
        prepare: sql => db.prepare(sql), exec: sql => db.exec(sql), dump: () => db.dump(),
        batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
          if (statements.some(s => /^\s*UPDATE\s+workspace_settings\b/i.test(s.query))) {
            assert.equal(fired, false);
            if (event === 'disable') await db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(actor.userId).run();
            else if (event === 'remove-mapping') await db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND provider_subject_id = ?").bind(actor.uid).run();
            else await db.prepare("UPDATE privileged_identity_approvals SET revoked_at = datetime('now'), revoked_by = 'test-operator' WHERE user_id = ? AND workspace_id = 'solarcell' AND role = 'owner_admin' AND revoked_at IS NULL").bind(actor.userId).run();
            fired = true;
          }
          return db.batch<T>(statements);
        },
      };
      const fixture = await createFirebaseFixture();
      const token = await fixture.token(actor.uid, actor.email);
      const worker = createWorker(createAuthenticationService(fixture.transport));
      const response = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"1"' },
        body: JSON.stringify({ trading_name: 'Unauthorized change' }),
      }), { DB: intercepted, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
      assert.equal(fired, true);
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('ETag'), null);
      assert.equal((await response.json() as {code:string}).code, 'ACCESS_DENIED');
      assert.deepEqual(await db.prepare("SELECT * FROM workspace_settings WHERE workspace_id = 'solarcell'").first(), before);
      assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings_audit_events').first<{n:number}>())?.n, 0);
    } finally { db.getSqliteHandle().close(); }
  });
}
