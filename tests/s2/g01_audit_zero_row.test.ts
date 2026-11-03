import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, LocalD1Database } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';
import { getWorkspaceSettings, getLegalDetails, getAuditEvents, updateWorkspaceSettings, updateLegalDetails } from '../../backend/modules/settings/settingsRepo.ts';

for (const resource of ['settings', 'legal'] as const) {
  test(`${resource}: a suppressed audit insert rolls back its update`, async () => {
    const db = createLocalD1Database() as LocalD1Database;
    try {
      await runLocalMigrations(db, { disposableTest: true });
      await installG01TestAuthFixtures(db);
      await db.exec(`CREATE TRIGGER test_suppress_audit BEFORE INSERT ON settings_audit_events
        BEGIN SELECT RAISE(IGNORE); END;`);
      const before = resource === 'settings' ? await getWorkspaceSettings(db, 'solarcell') : await getLegalDetails(db, 'solarcell');
      assert.ok(before);
      const params = { workspaceId: 'solarcell', expectedVersion: before.version, actorUserId: G01_TEST_AUTH.superAdmin.userId, actorUid: G01_TEST_AUTH.superAdmin.uid, requestId: `test_zero_audit_${resource}` };
      await assert.rejects(() => resource === 'settings'
        ? updateWorkspaceSettings(db, { ...params, patch: { trading_name: 'Should roll back' } })
        : updateLegalDetails(db, { ...params, patch: { legal_issuer_name: 'Should roll back' } }),
      /NOT NULL constraint failed: users\.email/);
      const after = resource === 'settings' ? await getWorkspaceSettings(db, 'solarcell') : await getLegalDetails(db, 'solarcell');
      assert.deepEqual(after, before);
      assert.equal((await getAuditEvents(db, 'solarcell')).length, 0);
    } finally {
      db.getSqliteHandle().close();
    }
  });
}
