/**
 * CABMS Modular Cloudflare Worker Entrypoint
 *
 * Exposes canonical API v1 routes:
 * - /api/v1/auth/me
 * - /api/v1/workspaces
 * - /api/v1/workspaces/:workspaceId/settings
 * - /api/v1/workspaces/:workspaceId/legal-details
 */

import { Env } from './types.ts';
import {
  handleGetWorkspaceSettings,
  handlePatchWorkspaceSettings,
  handleGetLegalDetails,
  handlePatchLegalDetails,
} from './workers/routes/settings.ts';
import { productionAuthenticationService, AuthenticationUnavailable, type AuthenticationService } from './workers/auth.ts';
import {
  resourceNotFoundResponse,
  authenticationRequiredResponse,
  internalErrorResponse,
  createProblemResponse,
} from './workers/problem.ts';
import { StructuredLogger } from './workers/logger.ts';
import { approvedMembership } from './workers/privilegedApproval.ts';
import { handleDemoJourney, handleDemoJob } from './workers/routes/demoJourney.ts';

export function createWorker(authentication: AuthenticationService = productionAuthenticationService) {
  return {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Generate or retain correlation request ID
    // Correlation is server-owned; caller strings cannot inject values into logs/audit.
    const requestId = `req_${crypto.randomUUID()}`;
    const logger = new StructuredLogger(requestId);

    // Handle CORS preflight in development / test
    if (method === 'OPTIONS') {
      if (env.ENVIRONMENT === 'production') {
        return new Response(null, { status: 405 });
      }
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': env.ENVIRONMENT === 'development' ? 'http://localhost:3000' : '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-Match, X-Request-Id',
          'Access-Control-Expose-Headers': 'ETag, X-Request-Id',
        },
      });
    }

    try {
      // 1. GET /api/v1/auth/me (returns current user & memberships)
      if (pathname === '/api/v1/auth/me' && method === 'GET') {
        const auth = await authentication.authenticateRequest(env.DB, request, env);
        if (!auth) {
          return addCors(authenticationRequiredResponse('Valid staff authentication token is required', requestId), env);
        }

        // Fetch memberships
        const mems = await env.DB.prepare(
          `SELECT wm.workspace_id, wm.role, w.name, w.slug
           FROM workspace_memberships wm
           JOIN workspaces w ON wm.workspace_id = w.id
           JOIN users u ON u.id = wm.user_id AND u.disabled = 0
           JOIN user_identity_mappings im ON im.user_id = u.id AND im.provider_id = 'firebase'
           WHERE wm.user_id = ? AND im.provider_subject_id = ? AND ${approvedMembership}`
        ).bind(auth.userId, auth.providerSubjectId).all<{ workspace_id: string; role: string; name: string; slug: string }>();

        return addCors(
          new Response(
            JSON.stringify({
              user: {
                id: auth.userId,
                email: auth.email,
                display_name: auth.displayName,
              },
              memberships: mems.results,
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-Request-Id': requestId,
              },
            }
          ), env
        );
      }

      // 2. GET /api/v1/workspaces (returns accessible workspaces)
      if (pathname === '/api/v1/workspaces' && method === 'GET') {
        const auth = await authentication.authenticateRequest(env.DB, request, env);
        if (!auth) {
          return addCors(authenticationRequiredResponse('Valid staff authentication token is required', requestId), env);
        }

        const res = await env.DB.prepare(
          `SELECT w.id, w.name, w.slug, wm.role
           FROM workspaces w
           JOIN workspace_memberships wm ON w.id = wm.workspace_id
           JOIN users u ON u.id = wm.user_id AND u.disabled = 0
           JOIN user_identity_mappings im ON im.user_id = u.id AND im.provider_id = 'firebase'
           WHERE wm.user_id = ? AND im.provider_subject_id = ? AND ${approvedMembership}`
        ).bind(auth.userId, auth.providerSubjectId).all<{ id: string; name: string; slug: string; role: string }>();

        return addCors(
          new Response(JSON.stringify(res.results), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-Id': requestId,
            },
          }), env
        );
      }

      // 3. /api/v1/workspaces/:workspaceId/settings
      const settingsMatch = /^\/api\/v1\/workspaces\/([^/]+)\/settings$/.exec(pathname);
      if (settingsMatch) {
        const workspaceId = settingsMatch[1];
        let resp: Response;
        if (method === 'GET') {
          resp = await handleGetWorkspaceSettings(request, env.DB, workspaceId, requestId, env, authentication);
        } else if (method === 'PATCH') {
          resp = await handlePatchWorkspaceSettings(request, env.DB, workspaceId, requestId, env, authentication);
        } else {
          return addCors(new Response('Method Not Allowed', { status: 405 }), env);
        }
        return addCors(resp, env);
      }

      // 4. /api/v1/workspaces/:workspaceId/legal-details
      const legalMatch = /^\/api\/v1\/workspaces\/([^/]+)\/legal-details$/.exec(pathname);
      if (legalMatch) {
        const workspaceId = legalMatch[1];
        let resp: Response;
        if (method === 'GET') {
          resp = await handleGetLegalDetails(request, env.DB, workspaceId, requestId, env, authentication);
        } else if (method === 'PATCH') {
          resp = await handlePatchLegalDetails(request, env.DB, workspaceId, requestId, env, authentication);
        } else {
          return addCors(new Response('Method Not Allowed', { status: 405 }), env);
        }
        return addCors(resp, env);
      }

      const jobMatch = /^\/api\/v1\/workspaces\/([^/]+)\/jobs\/([^/]+)(?:\/steps\/([^/]+))?$/.exec(pathname);
      if (jobMatch) {
        let jobId: string, stepId: string | undefined;
        try { jobId = decodeURIComponent(jobMatch[2]); stepId = jobMatch[3] ? decodeURIComponent(jobMatch[3]) : undefined; }
        catch (error) { if (error instanceof URIError) return addCors(createProblemResponse(400, 'VALIDATION_FAILED', 'validation-failed', 'Bad Request', 'Invalid path encoding', requestId), env); throw error; }
        return addCors(await handleDemoJob(request, env, jobMatch[1], jobId, stepId, requestId, authentication), env);
      }

      const journeyMatch = /^\/api\/v1\/workspaces\/([^/]+)\/(enquiries|jobs)(?:\/([^/]+)\/conversion)?$/.exec(pathname);
      if (journeyMatch && !(journeyMatch[2] === 'jobs' && journeyMatch[3])) {
        return addCors(await handleDemoJourney(request, env, journeyMatch[1], journeyMatch[2], journeyMatch[3], requestId, authentication), env);
      }

      // Unknown API route
      if (pathname.startsWith('/api/')) {
        return addCors(resourceNotFoundResponse(`Route '${pathname}' not found`, requestId), env);
      }

      // Serve static frontend assets from Vite build output if configured
      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      if (err instanceof AuthenticationUnavailable) return addCors(createProblemResponse(503, 'SERVICE_UNAVAILABLE', 'service-unavailable', 'Service Unavailable', 'Identity verification is temporarily unavailable. Retry later.', requestId), env);
      logger.error('WORKER_UNHANDLED_EXCEPTION', 'Unhandled exception in Worker fetch', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return addCors(internalErrorResponse('Unexpected server error', requestId), env);
    }
  },
  };
}

export default createWorker();

function addCors(resp: Response, env?: Env): Response {
  const headers = new Headers(resp.headers);
  if (env?.ENVIRONMENT === 'development') {
    headers.set('Access-Control-Allow-Origin', 'http://localhost:3000');
    headers.set('Access-Control-Expose-Headers', 'ETag, X-Request-Id');

  } else if (env?.ENVIRONMENT === 'test') {
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Expose-Headers', 'ETag, X-Request-Id');

  }

  headers.set('Cache-Control', 'no-store');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}
