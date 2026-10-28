/**
 * CABMS G01 Worker API End-to-End Integration Tests
 *
 * Verifies:
 * - RFC 9457 Problem Details formatting
 * - Authentication & server-side membership / role checks
 * - Strict exact-version strong ETag and If-Match validation (428, 412, rejection of weak/wildcard)
 * - Field allowlist validation (422)
 * - Super-admin-only restriction for legal details
 * - Redacted audit persistence and zero secret leakage
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/index.ts';
import { createLocalD1Database, D1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { getAuditEvents } from '../backend/modules/settings/settingsRepo.ts';
import { Env } from '../backend/types.ts';

function base64UrlEncode(bytes: Uint8Array | string): string {
  const binary = typeof bytes === 'string'
    ? Buffer.from(bytes, 'utf8').toString('base64')
    : Buffer.from(bytes).toString('base64');
  return binary.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function createSignedToken(
  payload: Record<string, unknown>,
  privateKey: CryptoKey,
  kid = 'test-kid'
): Promise<string> {
  const header = { alg: 'RS256', kid, typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, data);
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

describe('G01 Worker API Endpoints', () => {
  let db!: D1Database;
  let env!: Env;

  const superAdminAuth = 'Bearer test-token:firebase_uid_super_admin';
  const ownerAdminAuth = 'Bearer test-token:firebase_uid_owner_admin';
  const technicianAuth = 'Bearer test-token:firebase_uid_technician';

  beforeEach(async () => {
    db = createLocalD1Database(':memory:');
    await runLocalMigrations(db);
    env = { DB: db, ALLOW_SYNTHETIC_TEST_TOKENS: true };
  });

  it('GET /api/v1/auth/me: rejects unauthenticated requests with 401 Problem Details', async () => {
    const req = new Request('http://localhost/api/v1/auth/me', { method: 'GET' });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 401);
    assert.equal(res.headers.get('Content-Type'), 'application/problem+json');

    const prob = await res.json();
    assert.equal(prob.code, 'AUTHENTICATION_REQUIRED');
    assert.equal(prob.status, 401);
    assert.ok(prob.request_id);
  });

  it('GET /api/v1/auth/me: returns user profile and memberships for authenticated staff', async () => {
    const req = new Request('http://localhost/api/v1/auth/me', {
      method: 'GET',
      headers: { Authorization: superAdminAuth },
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, 'admin@cabms.example.invalid');
    assert.equal(body.memberships.length, 3);
  });

  it('GET /api/v1/workspaces/:workspaceId/settings: returns settings and strong ETag', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'GET',
      headers: { Authorization: ownerAdminAuth },
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('ETag'), '"1"');

    const body = await res.json();
    assert.equal(body.trading_name, 'Solarcell');
    assert.equal(body.version, 1);
  });

  it('GET /api/v1/workspaces/:workspaceId/settings: blocks access if user has no membership', async () => {
    // usr_owner_admin is only a member of solarcell, not cctv
    const req = new Request('http://localhost/api/v1/workspaces/cctv/settings', {
      method: 'GET',
      headers: { Authorization: ownerAdminAuth },
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 403);
    const prob = await res.json();
    assert.equal(prob.code, 'ACCESS_DENIED');
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: enforces 428 PRECONDITION_REQUIRED when If-Match is missing', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ trading_name: 'Solarcell Updated' }),
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 428);
    const prob = await res.json();
    assert.equal(prob.code, 'PRECONDITION_REQUIRED');
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: rejects wildcard and weak If-Match', async () => {
    // Test wildcard
    const wildcardReq = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '*',
      },
      body: JSON.stringify({ trading_name: 'Wildcard Hack' }),
    });
    const wildcardRes = await worker.fetch(wildcardReq, env);
    assert.equal(wildcardRes.status, 422);
    const probWild = await wildcardRes.json();
    assert.equal(probWild.code, 'VALIDATION_FAILED');

    // Test weak ETag
    const weakReq = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': 'W/"1"',
      },
      body: JSON.stringify({ trading_name: 'Weak Hack' }),
    });
    const weakRes = await worker.fetch(weakReq, env);
    assert.equal(weakRes.status, 422);
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: rejects unknown/unallowlisted fields with 422', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({
        trading_name: 'Solarcell Good',
        primary_color: '#000000', // Read-only / forbidden field in G01
      }),
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 422);
    const prob = await res.json();
    assert.equal(prob.code, 'VALIDATION_FAILED');
    assert.equal(prob.errors?.[0]?.pointer, '/primary_color');
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: denies non-admin roles (technician) with 403', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: technicianAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({ trading_name: 'Technician Breach' }),
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 403);
    const prob = await res.json();
    assert.equal(prob.code, 'ACCESS_DENIED');
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: returns 412 when If-Match version is stale', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"99"', // Stale
      },
      body: JSON.stringify({ trading_name: 'Stale Version Update' }),
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 412);
    const prob = await res.json();
    assert.equal(prob.code, 'PRECONDITION_FAILED');
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: successful update returns new ETag and persists audit', async () => {
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({
        trading_name: 'Solarcell Commercial HQ',
        contact_phone: '(07) 5500 8888',
      }),
    });
    const res = await worker.fetch(req, env);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('ETag'), '"2"');

    const body = await res.json();
    assert.equal(body.version, 2);
    assert.equal(body.trading_name, 'Solarcell Commercial HQ');

    // Audit check
    const auditEvents = await getAuditEvents(db, 'solarcell', 'workspace_settings');
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].new_version, 2);
  });

  it('PATCH /api/v1/workspaces/:workspaceId/legal-details: strictly restricted to Super Admin (Owner Admin rejected 403)', async () => {
    // Owner Admin attempt
    const ownerReq = new Request('http://localhost/api/v1/workspaces/solarcell/legal-details', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({ legal_issuer_name: 'Malicious Legal Rewrite' }),
    });
    const ownerRes = await worker.fetch(ownerReq, env);

    assert.equal(ownerRes.status, 403);
    const prob = await ownerRes.json();
    assert.equal(prob.code, 'ACCESS_DENIED');

    // Super Admin attempt succeeds
    const saReq = new Request('http://localhost/api/v1/workspaces/solarcell/legal-details', {
      method: 'PATCH',
      headers: {
        Authorization: superAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({
        legal_issuer_name: 'Solarcell Technologies Pty Ltd (Authorized)',
        abn: '12 345 678 999',
      }),
    });
    const saRes = await worker.fetch(saReq, env);

    assert.equal(saRes.status, 200);
    assert.equal(saRes.headers.get('ETag'), '"2"');
    const saBody = await saRes.json();
    assert.equal(saBody.version, 2);
    assert.equal(saBody.legal_issuer_name, 'Solarcell Technologies Pty Ltd (Authorized)');

    // Audit verification: sensitive ABN is redacted!
    const auditEvents = await getAuditEvents(db, 'solarcell', 'legal_issuer');
    assert.equal(auditEvents.length, 1);
    const newVals = JSON.parse(auditEvents[0].new_values);
    assert.equal(newVals.abn, '[REDACTED]');
    assert.doesNotMatch(auditEvents[0].new_values, /12 345 678 999/);
  });

  it('Authentication: fails closed when synthetic test tokens are disabled', async () => {
    const strictEnv: Env = { DB: db, ALLOW_SYNTHETIC_TEST_TOKENS: false };
    const req = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: superAdminAuth },
    });
    const res = await worker.fetch(req, strictEnv);
    assert.equal(res.status, 401);
  });

  it('Authentication: verifies real Firebase ID token signature with RS256 against JWKS', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & { kid?: string };
    jwk.kid = 'test-key-1';

    const projectId = 'cabms-real-project';
    const now = Math.floor(Date.now() / 1000);
    const validPayload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'firebase_uid_super_admin',
      user_id: 'firebase_uid_super_admin',
      auth_time: now - 10,
      iat: now - 10,
      exp: now + 3600,
      email: 'admin@cabms.example.invalid',
      email_verified: true,
    };

    const token = await createSignedToken(validPayload, keyPair.privateKey, 'test-key-1');
    const cryptoEnv: Env = {
      DB: db,
      FIREBASE_PROJECT_ID: projectId,
      JWKS_CACHE_OVERRIDE: { 'test-key-1': jwk },
    };

    // Valid token succeeds
    const req = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await worker.fetch(req, cryptoEnv);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, 'admin@cabms.example.invalid');

    // Forged signature fails (tampered token)
    const tamperedToken = token.slice(0, -6) + 'xxxxxx';
    const reqForged = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${tamperedToken}` },
    });
    const resForged = await worker.fetch(reqForged, cryptoEnv);
    assert.equal(resForged.status, 401);

    // Expired token fails
    const expiredPayload = { ...validPayload, exp: now - 100, iat: now - 500, auth_time: now - 500 };
    const expiredToken = await createSignedToken(expiredPayload, keyPair.privateKey, 'test-key-1');
    const reqExpired = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });
    const resExpired = await worker.fetch(reqExpired, cryptoEnv);
    assert.equal(resExpired.status, 401);

    // Wrong audience / project ID fails
    const wrongAudPayload = { ...validPayload, aud: 'wrong-project' };
    const wrongAudToken = await createSignedToken(wrongAudPayload, keyPair.privateKey, 'test-key-1');
    const reqWrongAud = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${wrongAudToken}` },
    });
    const resWrongAud = await worker.fetch(reqWrongAud, cryptoEnv);
    assert.equal(resWrongAud.status, 401);

    // Wrong issuer fails
    const wrongIssPayload = { ...validPayload, iss: 'https://attacker.example.invalid' };
    const wrongIssToken = await createSignedToken(wrongIssPayload, keyPair.privateKey, 'test-key-1');
    const reqWrongIss = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${wrongIssToken}` },
    });
    const resWrongIss = await worker.fetch(reqWrongIss, cryptoEnv);
    assert.equal(resWrongIss.status, 401);

    // Missing FIREBASE_PROJECT_ID in env fails closed
    const noProjEnv: Env = { DB: db, JWKS_CACHE_OVERRIDE: { 'test-key-1': jwk } };
    const reqNoProj = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const resNoProj = await worker.fetch(reqNoProj, noProjEnv);
    assert.equal(resNoProj.status, 401);
  });

  it('Authentication: refuses account linking when email_verified is false', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & { kid?: string };
    jwk.kid = 'test-key-2';

    const projectId = 'cabms-real-project';
    const now = Math.floor(Date.now() / 1000);
    // New unlinked Firebase UID, but email matches an existing user (admin@cabms.example.invalid)
    const unverifiedPayload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'new_unverified_firebase_uid',
      user_id: 'new_unverified_firebase_uid',
      auth_time: now - 10,
      iat: now - 10,
      exp: now + 3600,
      email: 'admin@cabms.example.invalid',
      email_verified: false, // Refuses linking!
    };

    const token = await createSignedToken(unverifiedPayload, keyPair.privateKey, 'test-key-2');
    const cryptoEnv: Env = {
      DB: db,
      FIREBASE_PROJECT_ID: projectId,
      JWKS_CACHE_OVERRIDE: { 'test-key-2': jwk },
    };

    const req = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const res = await worker.fetch(req, cryptoEnv);
    assert.equal(res.status, 401);
  });

  it('PATCH /api/v1/workspaces/:workspaceId/settings: rejects non-object JSON bodies (null, array, primitive) with 422', async () => {
    const nonObjectBodies = [
      { label: 'null', body: 'null' },
      { label: 'array', body: '[1, 2, 3]' },
      { label: 'string', body: '"string literal"' },
      { label: 'number', body: '12345' },
      { label: 'boolean', body: 'true' },
    ];

    for (const testCase of nonObjectBodies) {
      const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
        method: 'PATCH',
        headers: {
          Authorization: ownerAdminAuth,
          'Content-Type': 'application/json',
          'If-Match': '"1"',
        },
        body: testCase.body,
      });
      const res = await worker.fetch(req, env);
      assert.equal(res.status, 422, `Expected 422 for non-object body: ${testCase.label}`);
      const prob = await res.json();
      assert.equal(prob.code, 'VALIDATION_FAILED');
      assert.equal(prob.errors?.[0]?.code, 'INVALID_TYPE');
    }
  });

  it('Fault injection: X-Force-Audit-Failure header is ignored when ALLOW_FAULT_INJECTION is not set', async () => {
    // env has ALLOW_SYNTHETIC_TEST_TOKENS: true, but NOT ALLOW_FAULT_INJECTION
    const req = new Request('http://localhost/api/v1/workspaces/solarcell/settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
        'X-Force-Audit-Failure': '1', // Attempt external fault injection
      },
      body: JSON.stringify({ trading_name: 'Solarcell No Fault' }),
    });
    const res = await worker.fetch(req, env);
    // Because ALLOW_FAULT_INJECTION is false, header is ignored and patch succeeds normally!
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.trading_name, 'Solarcell No Fault');
  });

  it('g01Client: handles 200 responses with non-JSON bodies by returning INVALID_RESPONSE Problem Details', async () => {
    const { apiGetCurrentUser, setApiFetchHandler, resetApiFetchHandler } = await import('../src/services/g01Client.ts');
    setApiFetchHandler(async () => {
      return new Response('<html><body>Login Page</body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'req_html_200' },
      });
    });

    try {
      const resp = await apiGetCurrentUser('dummy-token');
      assert.equal(resp.ok, false);
      assert.equal(resp.status, 200);
      assert.ok(resp.problem);
      assert.equal(resp.problem.code, 'INVALID_RESPONSE');
      assert.equal(resp.problem.request_id, 'req_html_200');
    } finally {
      resetApiFetchHandler();
    }
  });

  it('Authentication: admin@chinedigital.com.au is recognized with Super Admin access across all 3 workspaces', async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const jwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as JsonWebKey & { kid?: string };
    jwk.kid = 'test-chine-sa';

    const projectId = 'cabms-panel';
    const now = Math.floor(Date.now() / 1000);
    const chinePayload = {
      iss: `https://securetoken.google.com/${projectId}`,
      aud: projectId,
      sub: 'firebase_chine_digital_admin_uid',
      user_id: 'firebase_chine_digital_admin_uid',
      auth_time: now - 10,
      iat: now - 10,
      exp: now + 3600,
      email: 'admin@chinedigital.com.au',
      email_verified: true,
    };

    const token = await createSignedToken(chinePayload, keyPair.privateKey, 'test-chine-sa');
    const chineEnv: Env = {
      DB: db,
      FIREBASE_PROJECT_ID: projectId,
      JWKS_CACHE_OVERRIDE: { 'test-chine-sa': jwk },
    };

    // 1. GET /api/v1/auth/me resolves Chine Digital Admin profile and all 3 workspaces
    const meReq = new Request('http://localhost/api/v1/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const meRes = await worker.fetch(meReq, chineEnv);
    assert.equal(meRes.status, 200);
    const meBody = await meRes.json();
    assert.equal(meBody.user.email, 'admin@chinedigital.com.au');
    assert.equal(meBody.memberships.length, 3);
    for (const m of meBody.memberships) {
      assert.equal(m.role, 'super_admin');
    }

    // 2. Can modify legal issuer details (restricted strictly to super_admin)
    const patchReq = new Request('http://localhost/api/v1/workspaces/solarcell/legal-details', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'If-Match': '"1"',
      },
      body: JSON.stringify({ legal_issuer_name: 'Solarcell Technologies (Updated by Chine Digital)' }),
    });
    const patchRes = await worker.fetch(patchReq, chineEnv);
    assert.equal(patchRes.status, 200);
    const patchBody = await patchRes.json();
    assert.equal(patchBody.version, 2);
    assert.equal(patchBody.legal_issuer_name, 'Solarcell Technologies (Updated by Chine Digital)');
  });
});
