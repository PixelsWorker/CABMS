import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService, type AuthenticationService } from '../backend/workers/auth.ts';
import { createLocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import { StructuredLogger } from '../backend/workers/logger.ts';
import { parseIfMatchHeader } from '../backend/workers/http.ts';
import { firebaseConfig, firebaseProjectMetadata, CABMS_FIREBASE_PROJECT_ID } from '../src/services/firebase.ts';

let fixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
let authentication: AuthenticationService;
let worker: ReturnType<typeof createWorker>;
beforeEach(async () => {
  fixture = await createFirebaseFixture();
  authentication = createAuthenticationService(fixture.transport);
  worker = createWorker(authentication);
});
afterEach(() => mock.restoreAll());

test('G01: required timestamp claims and malformed JWT headers fail closed', async () => {
  for (const patch of [{ auth_time: undefined }, { auth_time: '1' }, { auth_time: -1 }, { iat: 1.5 }, { exp: 1.5 }, { exp: 0 }]) {
    assert.equal(await authentication.verifyFirebaseToken(await fixture.token('uid', undefined, patch), 'cabms-test'), null);
  }
  for (const header of [null, [], true, 'RS256']) {
    const token = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.e30.invalid`;
    assert.equal(await authentication.verifyFirebaseToken(token, 'cabms-test'), null);
  }
  assert.equal(await authentication.verifyFirebaseToken(await fixture.token('uid', undefined, { firebase: { sign_in_provider: 'password' } }), 'cabms-test'), null);
});

test('G01: unavailable Google key retrieval returns safe 503 rather than accepting identity', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);
  const token = await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email);
  worker = createWorker(createAuthenticationService(async () => { throw new Error('Upstream unavailable'); }));
  const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'SERVICE_UNAVAILABLE');
});

test('G01: removed membership denies the next protected request', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);
  const token = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
  await db.prepare('DELETE FROM workspace_memberships WHERE user_id = ?').bind(G01_TEST_AUTH.ownerAdmin.userId).run();
  const response = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', { headers: { Authorization: `Bearer ${token}` } }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 403);
});

test('G01: environment flags cannot enable synthetic credentials or injected signing keys', async () => {
  const db = createLocalD1Database();
  await runLocalMigrations(db, { disposableTest: true });
  const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', {
    headers: { Authorization: 'Bearer test-token:firebase_uid_super_admin' },
  }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test', ...{ ALLOW_SYNTHETIC_TEST_TOKENS: true, JWKS_CACHE_OVERRIDE: {} } });
  assert.equal(response.status, 401);
});

test('G01: ETag lists match a later validator and unsafe integer versions are rejected', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);
  const token = await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email);
  const response = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"999", "1"' },
    body: JSON.stringify({ tagline: 'Conditional update' }),
  }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 200);
  assert.equal(parseIfMatchHeader('"9007199254740993"').isMalformed, true);
  assert.equal(parseIfMatchHeader('"1",').isMalformed, true);
});

test('G01: concurrent first-login linking resolves a single authoritative mapping', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);
  const token = await fixture.token('new_uid', G01_TEST_AUTH.officeStaff.email);
  const request = () => new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
  const results = await Promise.all([worker.fetch(request(), env), worker.fetch(request(), env)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  const row = await db.prepare('SELECT COUNT(*) AS n FROM user_identity_mappings WHERE provider_subject_id = ?').bind('new_uid').first<{ n: number }>();
  assert.equal(row?.n, 1);
});

test('G01: controlled log payloads omit free text, nested secrets and exception contents', () => {
  const output: string[] = [];
  mock.method(console, 'error', (value: string) => output.push(value));
  const secret = 'sensitive-value-123';
  new StructuredLogger(secret, secret, secret).error('WORKER_UNHANDLED_EXCEPTION', secret, {
    fields: { detail: secret, nested: { password: secret }, version: 2 }, error: new Error(secret),
  });
  assert.equal(output.length, 1);
  assert.ok(!output[0].includes(secret));
  assert.equal(JSON.parse(output[0]).fields.version, 2);
});


test('G01: oversized operational and legal fields fail validation without audit writes', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  await installG01TestAuthFixtures(db);
  const token = await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email);
  for (const [resource, patch] of [['settings', { contact_phone: 'x'.repeat(41) }], ['legal-details', { abn: 'x'.repeat(101) }]] as const) {
    const response = await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${resource}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(patch),
    }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
    assert.equal(response.status, 422);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings_audit_events').first<{ n: number }>())?.n, 0);
});

// Existing bootstrap test uses disposable in-memory state in tests/bootstrap; persistent bootstrap remains approval-gated.

test('G01: frontend and worker Firebase project configuration match without drift', () => {
  const wranglerConfig = JSON.parse(fs.readFileSync(path.resolve('./wrangler.jsonc'), 'utf-8').replace(/\/\/.*$/gm, ''));
  assert.equal(firebaseConfig.projectId, wranglerConfig.vars.FIREBASE_PROJECT_ID);
  assert.equal(firebaseProjectMetadata.projectId, wranglerConfig.vars.FIREBASE_PROJECT_ID);
  assert.equal(CABMS_FIREBASE_PROJECT_ID, wranglerConfig.vars.FIREBASE_PROJECT_ID);
  assert.equal(firebaseConfig.apiKey, wranglerConfig.vars.FIREBASE_API_KEY);
});

test('G01: logger emits LEGAL_READ_DENIED event without unknown fallback', () => {
  const output: string[] = [];
  mock.method(console, 'warn', (value: string) => output.push(value));
  new StructuredLogger('req-1', 'solarcell', 'usr_test').warn('LEGAL_READ_DENIED', 'Access denied to legal details', {
    fields: { version: 1 },
  });
  assert.equal(output.length, 1);
  const entry = JSON.parse(output[0]);
  assert.equal(entry.event, 'LEGAL_READ_DENIED');
  assert.equal(entry.fields.version, 1);
});

test('G01: retired seeded identities are denied after 0005', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db, { disposableTest: true });
  for (const uid of ['firebase_uid_super_admin', 'firebase_uid_owner_admin', 'firebase_uid_office_staff', 'firebase_uid_technician']) {
    const token = await fixture.token(uid);
    const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
    assert.equal(response.status, 401);
  }
  for (const id of ['usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician']) {
    const user = await db.prepare('SELECT disabled FROM users WHERE id = ?').bind(id).first<{ disabled: number }>();
    assert.equal(user?.disabled, 1);
    for (const table of ['workspace_memberships', 'user_identity_mappings']) {
      const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).bind(id).first<{ n: number }>();
      assert.equal(row?.n, 0);
    }
  }
  // Sign verified tokens carrying both seeded and historically normalized emails.
  // Check both the retired UID and an otherwise-unmapped UID for each address.
  const retiredEmails = [
    ['firebase_uid_super_admin', 'admin@cabms.example.invalid'],
    ['firebase_uid_owner_admin', 'owner@solarcell.example.invalid'],
    ['firebase_uid_office_staff', 'staff@solarcell.example.invalid'],
    ['firebase_uid_technician', 'tech@solarcell.example.invalid'],
    ['firebase_chine_digital_admin_uid', 'admin@chine.example.invalid'],
    ['firebase_chine_digital_admin_uid', 'admin@chinedigital.com.au'],
  ];
  for (const [index, [uid, email]] of retiredEmails.entries()) {
    for (const candidate of [uid, `test_g01_retired_email_${index}`]) {
      const token = await fixture.token(candidate, email);
      const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
      assert.equal(response.status, 401, `${candidate} / ${email}`);
    }
  }
});
