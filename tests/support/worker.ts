// Local workerd test entry only. Production wrangler.jsonc references backend/index.ts.
import worker from '../../backend/index.ts';
import type { Env } from '../../backend/types.ts';

const networkFetch = globalThis.fetch;
export default {
  async fetch(request: Request, env: Env & { TEST_PUBLIC_JWKS: string }) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
        return Response.json(JSON.parse(env.TEST_PUBLIC_JWKS), { headers: { 'Cache-Control': 'max-age=0' } });
      }
      return networkFetch(input, init);
    }) as typeof fetch;
    return worker.fetch(request, env);
  },
};
