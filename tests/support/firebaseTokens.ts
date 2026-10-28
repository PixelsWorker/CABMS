import { mock } from 'node:test';

let keys: Record<string, JsonWebKey> = {};
let pair: CryptoKeyPair;
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Test transport fixture; deployable auth still verifies signed JWTs through the Google URL. */
export async function installFirebaseFixture() {
  pair ||= await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  keys = { fixture: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  const originalFetch = globalThis.fetch;
  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
      return Response.json({ keys: Object.entries(keys).map(([kid, key]) => ({ ...key, kid })) }, { headers: { 'Cache-Control': 'max-age=0' } });
    }
    return originalFetch(input, init);
  });
}
export function installTestKey(kid: string, jwk: JsonWebKey) { keys[kid] = jwk; }
export async function fixtureToken(uid: string, email = `${uid}@example.invalid`, claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', kid: 'fixture' });
  const payload = encode({ sub: uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' }, iss: 'https://securetoken.google.com/cabms-test', aud: 'cabms-test', auth_time: now - 10, iat: now - 10, exp: now + 3600, ...claims });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}
