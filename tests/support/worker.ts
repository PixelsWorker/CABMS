// Disposable local workerd entry ONLY. Production wrangler.jsonc uses backend/index.ts.
import { createWorker } from '../../backend/index.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import type { Env } from '../../backend/types.ts';
import { installG01TestAuthFixtures } from './g01SyntheticFixtures.ts';

type TestEnv = Env & {
  TEST_PUBLIC_JWKS: string;
  TEST_RUN_ID: string;
  TEST_SETUP_SECRET: string;
};
// One immutable service per local workerd isolate. A new run requires a new isolate.
let service: { runId: string; jwks: string; worker: ReturnType<typeof createWorker> } | undefined;

export default {
  async fetch(request: Request, env: TestEnv): Promise<Response> {
    if (env.ENVIRONMENT !== 'test' || !env.TEST_RUN_ID || !env.TEST_SETUP_SECRET) {
      return new Response('Unavailable', { status: 503 });
    }
    if (service && (service.runId !== env.TEST_RUN_ID || service.jwks !== env.TEST_PUBLIC_JWKS)) {
      throw new Error('Test Worker isolate cannot be reused for another run or key set');
    }
    let current = service;
    if (!current) {
      const jwks = env.TEST_PUBLIC_JWKS;
      const transport: typeof fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url === 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com') {
          return Response.json(JSON.parse(jwks), { headers: { 'Cache-Control': 'max-age=0' } });
        }
        throw new Error('Unexpected test identity transport request');
      };
      current = { runId: env.TEST_RUN_ID, jwks, worker: createWorker(createAuthenticationService(transport)) };
      service = current;
    }

    const url = new URL(request.url);
    let response: Response;
    if (url.pathname === '/__g01_test/install-auth-fixtures') {
      const allowed = request.method === 'POST'
        && request.headers.get('X-G01-Test-Setup-Secret') === env.TEST_SETUP_SECRET;
      if (!allowed) {
        response = new Response('Forbidden', { status: 403 });
      } else {
        await installG01TestAuthFixtures(env.DB);
        const fk = await env.DB.prepare('PRAGMA foreign_key_check').all();
        if (fk.results.length !== 0) throw new Error('G01 fixture foreign-key violation');
        response = Response.json({ installed: true, counts: [4, 4, 6], foreign_keys_ok: true });
      }
    } else {
      response = await current.worker.fetch(request, env);
    }
    const headers = new Headers(response.headers);
    headers.set('X-G01-Test-Run', env.TEST_RUN_ID);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
