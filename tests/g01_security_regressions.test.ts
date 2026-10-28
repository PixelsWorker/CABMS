import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/index.ts';
import { verifyFirebaseToken } from '../backend/workers/auth.ts';
import { createLocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { installFirebaseFixture, fixtureToken } from './support/firebaseTokens.ts';
import { StructuredLogger } from '../backend/workers/logger.ts';
import { parseIfMatchHeader } from '../backend/workers/http.ts';

beforeEach(installFirebaseFixture);
afterEach(() => mock.restoreAll());

test('G01: required timestamp claims and malformed JWT headers fail closed', async () => {
  for (const patch of [{ auth_time: undefined }, { auth_time: '1' }, { auth_time: -1 }, { iat: 1.5 }, { exp: 1.5 }, { exp: 0 }]) {
    assert.equal(await verifyFirebaseToken(await fixtureToken('uid', undefined, patch), 'cabms-test'), null);
  }
  for (const header of [null, [], true, 'RS256']) {
    const token = `${Buffer.from(JSON.stringify(header)).toString('base64url')}.e30.invalid`;
    assert.equal(await verifyFirebaseToken(token, 'cabms-test'), null);
  }
  assert.equal(await verifyFirebaseToken(await fixtureToken('uid', undefined, { firebase: { sign_in_provider: 'password' } }), 'cabms-test'), null);
});

test('G01: unavailable Google key retrieval returns safe 503 rather than accepting identity', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db);
  const token = await fixtureToken('firebase_uid_super_admin');
  mock.method(globalThis, 'fetch', async () => { throw new Error('Upstream unavailable'); });
  const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, 'SERVICE_UNAVAILABLE');
});

test('G01: removed membership denies the next protected request', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db);
  const token = await fixtureToken('firebase_uid_owner_admin');
  await db.prepare('DELETE FROM workspace_memberships WHERE user_id = ?').bind('usr_owner_admin').run();
  const response = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', { headers: { Authorization: `Bearer ${token}` } }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 403);
});

test('G01: environment flags cannot enable synthetic credentials or injected signing keys', async () => {
  const db = createLocalD1Database();
  await runLocalMigrations(db);
  const response = await worker.fetch(new Request('http://localhost/api/v1/auth/me', {
    headers: { Authorization: 'Bearer test-token:firebase_uid_super_admin' },
  }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test', ...{ ALLOW_SYNTHETIC_TEST_TOKENS: true, JWKS_CACHE_OVERRIDE: {} } });
  assert.equal(response.status, 401);
});

test('G01: ETag lists match a later validator and unsafe integer versions are rejected', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db);
  const token = await fixtureToken('firebase_uid_super_admin');
  const response = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"999", "1"' },
    body: JSON.stringify({ tagline: 'Conditional update' }),
  }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
  assert.equal(response.status, 200);
  assert.equal(parseIfMatchHeader('"9007199254740993"').isMalformed, true);
  assert.equal(parseIfMatchHeader('"1",').isMalformed, true);
});

test('G01: concurrent first-login linking resolves a single authoritative mapping', async () => {
  const db = createLocalD1Database(); await runLocalMigrations(db);
  const token = await fixtureToken('new_uid', 'staff@solarcell.example.invalid');
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
  const db = createLocalD1Database(); await runLocalMigrations(db);
  const token = await fixtureToken('firebase_uid_super_admin');
  for (const [resource, patch] of [['settings', { contact_phone: 'x'.repeat(41) }], ['legal-details', { abn: 'x'.repeat(101) }]] as const) {
    const response = await worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${resource}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'If-Match': '"1"' }, body: JSON.stringify(patch),
    }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
    assert.equal(response.status, 422);
  }
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM settings_audit_events').first<{ n: number }>())?.n, 0);
});
