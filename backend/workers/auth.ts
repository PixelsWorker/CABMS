/**
 * CABMS Server-Side Identity and Authorization Verification
 *
 * Implements:
 * - Cryptographic signature and claims verification for Firebase ID tokens (RS256 via Web Crypto API)
 * - Strict opt-in isolation for synthetic test tokens (rejected unless ALLOW_SYNTHETIC_TEST_TOKENS === true)
 * - Mandatory email_verified check before any approved email-based identity linking
 * - Server-owned membership and role resolution via Cloudflare D1
 */

import { D1Database } from '../db/d1.ts';
import { AuthContext, WorkspaceAuthContext, Env } from '../types.ts';

export interface DecodedToken {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  exp: number;
  iss: string;
  aud?: string;
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: { keys: Record<string, JsonWebKey>; expiresAt: number } | null = null;

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function getGoogleJwks(jwksOverride?: Record<string, JsonWebKey>): Promise<Record<string, JsonWebKey>> {
  if (jwksOverride) {
    return jwksOverride;
  }
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const res = await fetch(GOOGLE_JWKS_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google JWKS: ${res.status}`);
  }

  let maxAge = 3600;
  const cacheControl = res.headers.get('Cache-Control');
  if (cacheControl) {
    const match = /max-age=(\d+)/i.exec(cacheControl);
    if (match) {
      maxAge = parseInt(match[1], 10);
    }
  }

  const body = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  const map: Record<string, JsonWebKey> = {};
  for (const k of body.keys) {
    if (k.kid) {
      map[k.kid] = k;
    }
  }

  cachedJwks = { keys: map, expiresAt: now + maxAge * 1000 };
  return map;
}

/**
 * Verifies a real Firebase ID token against Google's public JWKS using standard Web Crypto API.
 */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  jwksOverride?: Record<string, JsonWebKey>
): Promise<DecodedToken | null> {
  if (!projectId || !token || typeof token !== 'string') {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, sigB64] = parts;

  // 1. Parse header
  let header: { alg?: string; kid?: string };
  try {
    const headerJson = new TextDecoder().decode(base64UrlToUint8Array(headerB64));
    header = JSON.parse(headerJson);
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
    return null; // Must be RS256 with key ID
  }

  // 2. Parse payload
  let payload: Record<string, unknown>;
  try {
    const payloadJson = new TextDecoder().decode(base64UrlToUint8Array(payloadB64));
    payload = JSON.parse(payloadJson);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const nowSec = Math.floor(Date.now() / 1000);

  // Expiration check: exp must be integer in the future
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) {
    return null;
  }

  // Issued at check: iat must be in the past (allow 300s clock skew)
  if (typeof payload.iat !== 'number' || payload.iat > nowSec + 300) {
    return null;
  }

  // Auth time check
  if (typeof payload.auth_time === 'number' && payload.auth_time > nowSec + 300) {
    return null;
  }

  // Audience check: must match Firebase Project ID
  if (payload.aud !== projectId) {
    return null;
  }

  // Issuer check: must strictly match https://securetoken.google.com/<projectId>
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  if (payload.iss !== expectedIss) {
    return null;
  }

  // Subject check: must be non-empty string <= 128 characters
  const sub = payload.sub;
  if (typeof sub !== 'string' || !sub.trim() || sub.length > 128) {
    return null;
  }

  // 3. Cryptographic signature check
  try {
    const jwks = await getGoogleJwks(jwksOverride);
    const jwk = jwks[header.kid];
    if (!jwk) {
      return null;
    }

    const cryptoKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToUint8Array(sigB64);

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      signature as BufferSource,
      signedData
    );

    if (!valid) {
      return null;
    }
  } catch {
    return null;
  }

  return {
    uid: sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    exp: payload.exp,
    iss: payload.iss as string,
    aud: payload.aud as string,
  };
}

/**
 * Validates request Bearer token.
 * Synthetic test-tokens are STRICTLY gated to an explicit local test harness (ALLOW_SYNTHETIC_TEST_TOKENS === true).
 * In all other cases, fails closed.
 */
export async function decodeAndValidateToken(
  token: string,
  env?: Env
): Promise<DecodedToken | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  // ISOLATED TEST HARNESS: Synthetic tokens are strictly rejected unless explicit test harness flag is enabled
  if (token.startsWith('test-token:')) {
    const isSyntheticAllowed = env?.ALLOW_SYNTHETIC_TEST_TOKENS === true || env?.ALLOW_SYNTHETIC_TEST_TOKENS === 'true';
    if (isSyntheticAllowed) {
      const uid = token.replace('test-token:', '').trim();
      if (!uid) return null;
      return {
        uid,
        email: `${uid}@example.invalid`,
        emailVerified: true,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://securetoken.google.com/cabms-test',
        aud: 'cabms-test',
      };
    }
    // Fail closed in production, staging, and any environment without the explicit test flag
    return null;
  }

  // Real tokens: fail closed if Firebase project ID is missing
  if (!env?.FIREBASE_PROJECT_ID) {
    return null;
  }

  return verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID, env.JWKS_CACHE_OVERRIDE);
}

/**
 * Resolves trusted internal CABMS user from request headers.
 */
export async function authenticateRequest(
  db: D1Database,
  request: Request,
  env?: Env
): Promise<AuthContext | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7).trim();
  const decoded = await decodeAndValidateToken(token, env);
  if (!decoded) {
    return null;
  }

  // 1. Find user from identity mappings
  const mappingStmt = db.prepare(
    'SELECT user_id FROM user_identity_mappings WHERE provider_id = ? AND provider_subject_id = ?'
  ).bind('firebase', decoded.uid);

  const mapping = await mappingStmt.first<{ user_id: string }>();

  let userId: string;
  if (mapping) {
    userId = mapping.user_id;
  } else if (decoded.email && decoded.emailVerified === true) {
    // STRICT: Only link if email identity is VERIFIED (email_verified === true)
    // Never link unverified emails or create uninvited accounts
    const userStmt = db.prepare('SELECT id FROM users WHERE email = ?').bind(decoded.email);
    const existing = await userStmt.first<{ id: string }>();
    if (!existing) {
      return null; // No uninvited self-service signup
    }
    userId = existing.id;

    // Link mapping
    const mapId = `map_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(
      'INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(mapId, userId, 'firebase', decoded.uid, now).run();
  } else {
    return null;
  }

  // 2. Fetch user profile
  const userRow = await db.prepare(
    'SELECT id, email, display_name FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; email: string; display_name: string | null }>();

  if (!userRow) {
    return null;
  }

  return {
    userId: userRow.id,
    email: userRow.email,
    displayName: userRow.display_name,
    providerId: 'firebase',
    providerSubjectId: decoded.uid,
  };
}

/**
 * Resolves user's membership and verified role within a specific workspace.
 */
export async function authorizeWorkspaceAccess(
  db: D1Database,
  workspaceId: string,
  auth: AuthContext
): Promise<WorkspaceAuthContext | null> {
  const membershipStmt = db.prepare(
    'SELECT role FROM workspace_memberships WHERE workspace_id = ? AND user_id = ?'
  ).bind(workspaceId, auth.userId);

  const membership = await membershipStmt.first<{
    role: 'super_admin' | 'owner_admin' | 'office_staff' | 'technician';
  }>();

  if (!membership) {
    return null;
  }

  return {
    ...auth,
    workspaceId,
    role: membership.role,
  };
}
