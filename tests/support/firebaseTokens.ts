/** Isolated synthetic Firebase signing keys and transport for one test instance. */
export async function createFirebaseFixture() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify']
  );
  const keys: Record<string, JsonWebKey> = { fixture: await crypto.subtle.exportKey('jwk', pair.publicKey) };
  let lookup: (() => Response | Promise<Response>) | undefined;
  const jwks = () => ({ keys: Object.entries(keys).map(([kid, key]) => ({ ...key, kid })) });
  const transport: typeof fetch = async (input, _init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
      return Response.json(jwks(), { headers: { 'Cache-Control': 'max-age=0' } });
    }
    if (url.startsWith('https://identitytoolkit.googleapis.com/v1/accounts:lookup?') && lookup) return lookup();
    throw new Error('Unexpected synthetic Firebase transport request');
  };
  const token = async (uid: string, email = `${uid}@example.invalid`, claims: Record<string, unknown> = {}) => {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const header = encode({ alg: 'RS256', kid: 'fixture' });
    const payload = encode({ sub: uid, email, email_verified: true, firebase: { sign_in_provider: 'google.com' }, iss: 'https://securetoken.google.com/cabms-test', aud: 'cabms-test', auth_time: now - 10, iat: now - 10, exp: now + 3600, ...claims });
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
    return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
  };
  return { transport, token, jwks, installKey: (kid: string, jwk: JsonWebKey) => { keys[kid] = jwk; },
    setLookup: (handler: () => Response | Promise<Response>) => { lookup = handler; } };
}
