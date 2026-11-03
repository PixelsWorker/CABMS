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

test('unknown signing key refresh is shared and bounded, including provider failures', async () => {
 const keys=await Promise.all([0,1].map(()=>crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify'])));
 const jwks=await Promise.all(keys.map(async (key,i)=>({...await crypto.subtle.exportKey('jwk',key.publicKey),kid:`kid${i}`})));
 const sign=async (kid:string,index:number)=>{const encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const now=Math.floor(Date.now()/1000);const a=encode({alg:'RS256',kid});const b=encode({sub:'uid',email_verified:true,firebase:{sign_in_provider:'google.com'},iss:'https://securetoken.google.com/cabms-test',aud:'cabms-test',auth_time:now-1,iat:now-1,exp:now+300});const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys[index].privateKey,new TextEncoder().encode(`${a}.${b}`));return `${a}.${b}.${Buffer.from(sig).toString('base64url')}`;};
 let coldCalls=0;const cold=createAuthenticationService(async()=>{coldCalls++;return Response.json({keys:[jwks[0]]},{headers:{'Cache-Control':'max-age=3600'}});});
 assert.equal(await cold.verifyFirebaseToken(await sign('unknown',0),'cabms-test'),null);assert.equal(coldCalls,1);
 let calls=0;let rotate=false;let outage=false;
 const service=createAuthenticationService(async()=>{calls++; if(outage)throw Error('outage');return Response.json({keys:rotate?jwks:[jwks[0]]},{headers:{'Cache-Control':'max-age=3600'}});});
 assert.ok(await service.verifyFirebaseToken(await sign('kid0',0),'cabms-test')); assert.equal(calls,1);
 rotate=true; const fresh=await sign('kid1',1); const result=await Promise.all([service.verifyFirebaseToken(fresh,'cabms-test'),service.verifyFirebaseToken(fresh,'cabms-test')]); assert.ok(result.every(Boolean)); assert.equal(calls,2);
 assert.equal(await service.verifyFirebaseToken(await sign('unknown',0),'cabms-test'),null); assert.equal(calls,2);
 assert.equal(await service.verifyFirebaseToken(await sign('kid0',1),'cabms-test'),null); assert.equal(calls,2);
 let failures=0; let recovered=false; const broken=createAuthenticationService(async()=>{failures++;if(failures>1 && !recovered)throw Error('outage');return Response.json({keys:recovered?jwks:[jwks[0]]},{headers:{'Cache-Control':'max-age=3600'}});});
 await broken.verifyFirebaseToken(await sign('kid0',0),'cabms-test'); await assert.rejects(()=>broken.verifyFirebaseToken(fresh,'cabms-test'),AuthenticationUnavailable); await assert.rejects(()=>broken.verifyFirebaseToken(fresh,'cabms-test'),AuthenticationUnavailable); assert.equal(failures,2);
 const originalNow=Date.now;try {Date.now=()=>originalNow()+6000;recovered=true;assert.ok(await broken.verifyFirebaseToken(fresh,'cabms-test'));assert.equal(failures,3);} finally {Date.now=originalNow;}
});
