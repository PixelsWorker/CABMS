import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthenticationUnavailable, createAuthenticationService } from '../backend/workers/auth.ts';
import { createWorker } from '../backend/index.ts';
import { createLocalD1Database, LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import testWorker from './support/worker.ts';

test('test Worker binds one run per isolate without replacing global fetch', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    const originalFetch = globalThis.fetch;
    const fixture = await createFirebaseFixture();
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test',
      TEST_PUBLIC_JWKS: JSON.stringify(fixture.jwks()), TEST_RUN_ID: 'test-isolate-one', TEST_SETUP_SECRET: 'synthetic-secret' };
    const req = () => new Request('http://localhost/api/v1/workspaces', { method: 'OPTIONS' });
    const responses = await Promise.all([testWorker.fetch(req(), env), testWorker.fetch(req(), env)]);
    assert.deepEqual(responses.map(response => response.status), [204, 204]);
    assert.ok(responses.every(response => response.headers.get('X-G01-Test-Run') === env.TEST_RUN_ID));
    assert.equal(globalThis.fetch, originalFetch);
    await assert.rejects(() => testWorker.fetch(req(), { ...env, TEST_RUN_ID: 'test-isolate-two' }), /cannot be reused/);
    assert.equal(globalThis.fetch, originalFetch);
  } finally { db.getSqliteHandle().close(); }
});

test('concurrent Workers route with distinct auth services and key sets', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const [a, b] = await Promise.all([createFirebaseFixture(), createFirebaseFixture()]);
    const staff = G01_TEST_AUTH.officeStaff;
    const [tokenA, tokenB] = await Promise.all([a.token(staff.uid, staff.email), b.token(staff.uid, staff.email)]);
    const workerA = createWorker(createAuthenticationService(a.transport));
    const workerB = createWorker(createAuthenticationService(b.transport));
    const req = (token: string) => new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
    const responses = await Promise.all([
      workerA.fetch(req(tokenA), env), workerB.fetch(req(tokenB), env),
      workerA.fetch(req(tokenB), env), workerB.fetch(req(tokenA), env),
    ]);
    assert.deepEqual(responses.map(response => response.status), [200, 200, 401, 401]);
  } finally { db.getSqliteHandle().close(); }
});

test('authentication services isolate concurrent key sets and caches', async () => {
  const [a, b] = await Promise.all([createFirebaseFixture(), createFirebaseFixture()]);
  const tokenA = await a.token('test_a_uid');
  const tokenB = await b.token('test_b_uid');
  let callsA = 0;
  let callsB = 0;
  const serviceA = createAuthenticationService(async (input, init) => { callsA++; return a.transport(input, init); });
  const serviceB = createAuthenticationService(async (input, init) => { callsB++; return b.transport(input, init); });
  const [aa, bb, ab, ba] = await Promise.all([
    serviceA.verifyFirebaseToken(tokenA, 'cabms-test'),
    serviceB.verifyFirebaseToken(tokenB, 'cabms-test'),
    serviceA.verifyFirebaseToken(tokenB, 'cabms-test'),
    serviceB.verifyFirebaseToken(tokenA, 'cabms-test'),
  ]);
  assert.equal(aa?.uid, 'test_a_uid');
  assert.equal(bb?.uid, 'test_b_uid');
  assert.equal(ab, null);
  assert.equal(ba, null);
  assert.equal(callsA, 1);
  assert.equal(callsB, 1);
});

test('one service shares in-flight JWKS fetch, then refreshes expired keys', async () => {
  const fixture = await createFirebaseFixture();
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const service = createAuthenticationService(async (input, init) => {
    calls++;
    if (calls === 1) await barrier;
    return fixture.transport(input, init); // max-age=0: subsequent call must refresh
  });
  const first = service.getGoogleJwks();
  const second = service.getGoogleJwks();
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b);
  await service.getGoogleJwks();
  assert.equal(calls, 2);
});

test('failed JWKS fetch fails closed and does not poison future refresh', async () => {
  const fixture = await createFirebaseFixture();
  let unavailable = true;
  const service = createAuthenticationService(async (input, init) => {
    if (unavailable) throw new Error('synthetic outage');
    return fixture.transport(input, init);
  });
  await assert.rejects(() => service.getGoogleJwks(), AuthenticationUnavailable);
  unavailable = false;
  assert.ok((await service.getGoogleJwks()).fixture);
});
