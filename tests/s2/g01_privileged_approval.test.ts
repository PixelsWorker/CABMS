import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, LocalD1Database } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';
import { createWorker } from '../../backend/index.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';

test('super admin recovery authorizes only the effective approved UID', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const actor = G01_TEST_AUTH.superAdmin;
    const replacement = 'test_recovered_super_admin_uid';
    const fixture = await createFirebaseFixture();
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const call = async (uid: string, path: string) => worker.fetch(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${await fixture.token(uid, actor.email)}` } }), env);
    const memberships = async (uid: string) => (await (await call(uid, '/api/v1/auth/me')).json() as { memberships: Array<{workspace_id:string}> }).memberships;
    assert.ok((await memberships(actor.uid)).some(m => m.workspace_id === 'solarcell'), 'original UID works before bootstrap completion');
    await db.prepare("INSERT INTO g01_bootstrap_completion(singleton,original_firebase_uid,completed_at,completed_by,operation_id,request_id,audit_reference) VALUES (1,?,datetime('now'),'test','test_boot','test_boot_req','test_boot_audit')").bind(actor.uid).run();
    assert.ok((await memberships(actor.uid)).some(m => m.workspace_id === 'solarcell'), 'original UID works after bootstrap completion');
    await db.prepare("INSERT INTO g01_super_admin_recovery_events(seq,previous_seq,operation_id,request_id,prior_uid,replacement_uid,operator_identity,reason,occurred_at,bootstrap_operation_id,audit_reference) VALUES(1,0,'test_recovery','test_recovery_req',?,?,'test','synthetic recovery',datetime('now'),'test_boot','test_recovery_audit')").bind(actor.uid, replacement).run();
    await db.prepare("INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES ('test_recovery_mapping',?,'firebase',?,datetime('now'))").bind(actor.userId, replacement).run();
    assert.equal((await memberships(actor.uid)).length, 0, 'old UID loses access even while its approval is active');
    assert.equal((await memberships(replacement)).length, 0, 'replacement requires an explicit approval');
    assert.equal((await call(actor.uid, '/api/v1/workspaces/solarcell/settings')).status, 403);
    await db.prepare("INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES ('test_recovery_approval',?,'firebase',?,'solarcell','super_admin',datetime('now'),'test')").bind(actor.userId, replacement).run();
    assert.deepEqual((await memberships(replacement)).map(m => m.workspace_id), ['solarcell']);
    assert.equal((await call(replacement, '/api/v1/workspaces/solarcell/settings')).status, 200);
    assert.equal((await call(replacement, '/api/v1/workspaces/cctv/settings')).status, 403);
  } finally { db.getSqliteHandle().close(); }
});

test('revoked owner UID approval removes listings, reads and writes without exposing versions', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const actor = G01_TEST_AUTH.ownerAdmin;
    const fixture = await createFirebaseFixture();
    const token = await fixture.token(actor.uid, actor.email);
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`http://localhost${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } }), env);
    assert.equal((await call('/api/v1/workspaces/solarcell/settings')).status, 200);
    await db.prepare("UPDATE privileged_identity_approvals SET revoked_at = datetime('now'), revoked_by = 'test-operator' WHERE user_id = ? AND workspace_id = 'solarcell' AND role = 'owner_admin' AND revoked_at IS NULL").bind(actor.userId).run();
    const me = await (await call('/api/v1/auth/me')).json() as {memberships: unknown[]};
    assert.equal(me.memberships.length, 0);
    assert.deepEqual(await (await call('/api/v1/workspaces')).json(), []);
    assert.equal((await call('/api/v1/workspaces/solarcell/settings')).status, 403);
    const mutation = await call('/api/v1/workspaces/solarcell/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify({ trading_name: 'Denied' }) });
    assert.equal(mutation.status, 403);
    assert.equal(mutation.headers.get('ETag'), null);
    assert.equal((await db.prepare("SELECT version FROM workspace_settings WHERE workspace_id = 'solarcell'").first<{version:number}>())?.version, 1);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings_audit_events').first<{n:number}>())?.n, 0);
    await db.prepare("INSERT INTO privileged_identity_approvals (id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES ('test_owner_regrant', ?, 'firebase', ?, 'solarcell', 'owner_admin', datetime('now'), 'test-operator')").bind(actor.userId, actor.uid).run();
    assert.equal((await call('/api/v1/workspaces/solarcell/settings')).status, 200);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM privileged_identity_approvals WHERE user_id = ? AND workspace_id = 'solarcell'").bind(actor.userId).first<{n:number}>())?.n, 2);
    await assert.rejects(() => db.prepare("DELETE FROM privileged_identity_approvals WHERE id = 'test_owner_regrant'").run(), /approval history cannot be deleted/);
  } finally { db.getSqliteHandle().close(); }
});

test('promotion of a mapped ordinary user does not confer privilege without UID approval', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const actor = G01_TEST_AUTH.officeStaff;
    await db.prepare("UPDATE workspace_memberships SET role = 'owner_admin' WHERE user_id = ? AND workspace_id = 'solarcell'").bind(actor.userId).run();
    const fixture = await createFirebaseFixture();
    const token = await fixture.token(actor.uid, actor.email);
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const headers = { Authorization: `Bearer ${token}` };
    const me = await (await worker.fetch(new Request('http://localhost/api/v1/auth/me', { headers }), env)).json() as {memberships: unknown[]};
    assert.equal(me.memberships.length, 0);
    assert.equal((await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', { headers }), env)).status, 403);
  } finally { db.getSqliteHandle().close(); }
});

test('a second mapped UID does not inherit an existing owner approval', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const actor = G01_TEST_AUTH.ownerAdmin;
    const otherUid = 'test_unapproved_owner_uid';
    await db.prepare("INSERT INTO user_identity_mappings (id,user_id,provider_id,provider_subject_id,created_at) VALUES ('test_second_owner_mapping', ?, 'firebase', ?, datetime('now'))").bind(actor.userId, otherUid).run();
    const fixture = await createFirebaseFixture();
    const token = await fixture.token(otherUid, actor.email);
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const headers = { Authorization: `Bearer ${token}` };
    const me = await (await worker.fetch(new Request('http://localhost/api/v1/auth/me', { headers }), env)).json() as {memberships: unknown[]};
    assert.equal(me.memberships.length, 0);
    assert.equal((await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', { headers }), env)).status, 403);
  } finally { db.getSqliteHandle().close(); }
});

test('an authorized user receives 404 for a missing resource', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    await db.prepare("DELETE FROM workspace_settings WHERE workspace_id = 'solarcell'").run();
    const actor = G01_TEST_AUTH.ownerAdmin;
    const fixture = await createFirebaseFixture();
    const token = await fixture.token(actor.uid, actor.email);
    const worker = createWorker(createAuthenticationService(fixture.transport));
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', { headers }), env)).status, 404);
    const patch = new Request('http://localhost/api/v1/workspaces/solarcell/settings', { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify({ trading_name: 'Missing' }) });
    assert.equal((await worker.fetch(patch, env)).status, 404);
  } finally { db.getSqliteHandle().close(); }
});
