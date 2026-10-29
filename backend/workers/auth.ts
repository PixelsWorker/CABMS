/**
 * CABMS Server-Side Identity and Authorization Verification
 *
 * Implements:
 * - Cryptographic signature and claims verification for Firebase ID tokens (RS256 via Web Crypto API)
 * - No synthetic credential or injected-key configuration in deployable authentication
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
  iat: number;
  authTime: number;
  iss: string;
  aud?: string;
}

const GOOGLE_JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: { keys: Record<string, JsonWebKey>; expiresAt: number } | null = null;
let pendingJwks: Promise<Record<string, JsonWebKey>> | null = null;
export class AuthenticationUnavailable extends Error {}

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

export async function getGoogleJwks(): Promise<Record<string, JsonWebKey>> {
  const now = Date.now();
  if (cachedJwks && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }
  if (!pendingJwks) {
    pendingJwks = fetchGoogleJwks()
      .catch(() => { throw new AuthenticationUnavailable('Identity verification is temporarily unavailable'); })
      .finally(() => { pendingJwks = null; });
  }
  return pendingJwks;
}

async function fetchGoogleJwks(): Promise<Record<string, JsonWebKey>> {
  const now = Date.now();

  const res = await fetch(GOOGLE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google JWKS: ${res.status}`);
  }

  let maxAge = 3600;
  const cacheControl = res.headers.get('Cache-Control');
  if (cacheControl) {
    const match = /max-age=(\d+)/i.exec(cacheControl);
    if (match) {
      maxAge = Math.min(86400, parseInt(match[1], 10));
    }
  }

  const body = (await res.json()) as { keys: Array<JsonWebKey & { kid: string }> };
  if (!Array.isArray(body?.keys) || !body.keys.length) throw new Error('Invalid key response');
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
  projectId: string
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

  if (!header || typeof header !== 'object' || Array.isArray(header) || header.alg !== 'RS256' || !header.kid || typeof header.kid !== 'string') {
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
  if (typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) || payload.exp <= 0 || payload.exp <= nowSec) {
    return null;
  }

  // Issued at check: iat must be in the past (allow 300s clock skew)
  if (typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) || payload.iat <= 0 || payload.iat > nowSec + 300) {
    return null;
  }

  // Auth time check
  if (typeof payload.auth_time !== 'number' || !Number.isSafeInteger(payload.auth_time) || payload.auth_time <= 0 || payload.auth_time > nowSec + 300) {
    return null;
  }
  if (payload.auth_time > payload.iat || payload.iat >= payload.exp) return null;

  const firebase = payload.firebase as { sign_in_provider?: unknown } | undefined;
  if (!firebase || firebase.sign_in_provider !== 'google.com') return null;

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
    const jwks = await getGoogleJwks();
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
  } catch (error) {
    if (error instanceof AuthenticationUnavailable) throw error;
    return null;
  }

  return {
    uid: sub,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    emailVerified: payload.email_verified === true,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    exp: payload.exp as number,
    iat: payload.iat as number,
    authTime: payload.auth_time as number,
    iss: payload.iss as string,
    aud: payload.aud as string,
  };
}

/**
 * Validates request Bearer token.
 * Synthetic test tokens are always rejected. Tests mock network transport outside this module.
 */
export async function decodeAndValidateToken(
  token: string,
  env?: Env
): Promise<DecodedToken | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  // Test credentials never enter the deployable verification path.
  if (token.startsWith('test-token:')) return null;

  // Real tokens: fail closed if Firebase project ID is missing
  if (!env?.FIREBASE_PROJECT_ID) {
    return null;
  }

  return verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
}

/**
 * Verifies live account status and token revocation against Google Identity Toolkit.
 * Compares auth_time against validSince to enforce revokeRefreshTokens().
 * Fail-closed on write operations if external Identity verification fails.
 */
export async function checkFirebaseAccountStatus(
  token: string,
  authTime: number,
  apiKey: string,
  expectedUid?: string
): Promise<{ valid: boolean; reason?: 'TOKEN_REVOKED' | 'ACCOUNT_DISABLED' }> {
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status >= 500 || res.status === 429) {
      throw new AuthenticationUnavailable('Identity provider verification temporarily unavailable');
    }
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new AuthenticationUnavailable('Firebase Identity Toolkit authentication failed (HTTP ' + res.status + ')');
      }
      try {
        const errJson = (await res.json()) as { error?: { message?: string } };
        const msg = errJson.error?.message;
        if (msg && (msg.startsWith('API_KEY_') || msg === 'PROJECT_NOT_FOUND')) {
          throw new AuthenticationUnavailable('Firebase configuration error: ' + msg);
        }
        if (msg === 'INVALID_ID_TOKEN' || msg === 'USER_NOT_FOUND' || msg === 'TOKEN_EXPIRED') {
          return { valid: false, reason: 'TOKEN_REVOKED' };
        }
      } catch (parseErr) {
        if (parseErr instanceof AuthenticationUnavailable) throw parseErr;
      }
      return { valid: false, reason: 'TOKEN_REVOKED' };
    }
    const data = (await res.json()) as { users?: Array<{ localId?: string; disabled?: boolean; validSince?: string }> };
    const user = data.users?.[0];
    if (!user || typeof user !== 'object') {
      return { valid: false, reason: 'TOKEN_REVOKED' };
    }
    if (expectedUid && (!user.localId || user.localId !== expectedUid)) {
      return { valid: false, reason: 'TOKEN_REVOKED' };
    }
    if (user.disabled === true) {
      return { valid: false, reason: 'ACCOUNT_DISABLED' };
    }
    if (user.validSince !== undefined) {
      if (typeof user.validSince !== 'string' || !/^\d+$/.test(user.validSince)) {
        throw new AuthenticationUnavailable('Malformed validSince timestamp from identity provider');
      }
      const validSinceSec = parseInt(user.validSince, 10);
      if (!Number.isSafeInteger(validSinceSec) || validSinceSec <= 0) {
        throw new AuthenticationUnavailable('Invalid validSince timestamp from identity provider');
      }
      if (authTime < validSinceSec) {
        return { valid: false, reason: 'TOKEN_REVOKED' };
      }
    }
    return { valid: true };
  } catch (err) {
    if (err instanceof AuthenticationUnavailable) throw err;
    throw new AuthenticationUnavailable('Account status verification unavailable');
  }
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
  if (!decoded.emailVerified) return null;

  // 0. Live provider account revocation & disabled check if API key configured (fail closed)
  if (env?.FIREBASE_API_KEY) {
    const status = await checkFirebaseAccountStatus(token, decoded.authTime, env.FIREBASE_API_KEY, decoded.uid);
    if (!status.valid) {
      return null;
    }
  } else if (env?.ENVIRONMENT !== 'test') {
    // In staging/production environments, fail closed if FIREBASE_API_KEY is not configured
    throw new AuthenticationUnavailable('FIREBASE_API_KEY is required for live account status verification');
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

    // Privileged accounts (super_admin, owner_admin) must NEVER be auto-linked by email match alone
    const privilegedCheck = await db.prepare(
      "SELECT 1 FROM workspace_memberships WHERE user_id = ? AND role IN ('super_admin', 'owner_admin')"
    ).bind(existing.id).first();
    if (privilegedCheck) {
      return null;
    }

    userId = existing.id;

    // Link mapping
    const mapId = `map_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    await db.prepare(
      'INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider_id, provider_subject_id) DO NOTHING'
    ).bind(mapId, userId, 'firebase', decoded.uid, now).run();
    const linked = await db.prepare('SELECT user_id FROM user_identity_mappings WHERE provider_id = ? AND provider_subject_id = ?').bind('firebase', decoded.uid).first<{ user_id: string }>();
    if (!linked || linked.user_id !== userId) return null;
    userId = linked.user_id;
  } else {
    return null;
  }

  // 2. Fetch user profile and verify active account status
  const userRow = await db.prepare(
    'SELECT id, email, display_name, disabled FROM users WHERE id = ?'
  ).bind(userId).first<{ id: string; email: string; display_name: string | null; disabled?: number }>();

  if (!userRow || userRow.disabled === 1) {
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
