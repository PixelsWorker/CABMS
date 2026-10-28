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
import { authenticateRequest, AuthenticationUnavailable } from './workers/auth.ts';
import {
  resourceNotFoundResponse,
  authenticationRequiredResponse,
  internalErrorResponse,
  createProblemResponse,
} from './workers/problem.ts';
import { StructuredLogger } from './workers/logger.ts';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // Generate or retain correlation request ID
    // Correlation is server-owned; caller strings cannot inject values into logs/audit.
    const requestId = `req_${crypto.randomUUID()}`;
    const logger = new StructuredLogger(requestId);

    // Handle CORS preflight in development
    if (method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, If-Match, X-Request-Id, X-Force-Audit-Failure',
          'Access-Control-Expose-Headers': 'ETag, X-Request-Id',
        },
      });
    }

    try {
      // 1. GET /api/v1/auth/me (returns current user & memberships)
      if (pathname === '/api/v1/auth/me' && method === 'GET') {
        const auth = await authenticateRequest(env.DB, request, env);
        if (!auth) {
          return addCors(authenticationRequiredResponse('Valid staff authentication token is required', requestId));
        }

        // Fetch memberships
        const mems = await env.DB.prepare(
          `SELECT wm.workspace_id, wm.role, w.name, w.slug
           FROM workspace_memberships wm
           JOIN workspaces w ON wm.workspace_id = w.id
           WHERE wm.user_id = ?`
        ).bind(auth.userId).all<{ workspace_id: string; role: string; name: string; slug: string }>();

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
          )
        );
      }

      // 2. GET /api/v1/workspaces (returns accessible workspaces)
      if (pathname === '/api/v1/workspaces' && method === 'GET') {
        const auth = await authenticateRequest(env.DB, request, env);
        if (!auth) {
          return addCors(authenticationRequiredResponse('Valid staff authentication token is required', requestId));
        }

        const res = await env.DB.prepare(
          `SELECT w.id, w.name, w.slug, wm.role
           FROM workspaces w
           JOIN workspace_memberships wm ON w.id = wm.workspace_id
           WHERE wm.user_id = ?`
        ).bind(auth.userId).all<{ id: string; name: string; slug: string; role: string }>();

        return addCors(
          new Response(JSON.stringify(res.results), {
            status: 200,
            headers: {
              'Content-Type': 'application/json',
              'X-Request-Id': requestId,
            },
          })
        );
      }

      // 3. /api/v1/workspaces/:workspaceId/settings
      const settingsMatch = /^\/api\/v1\/workspaces\/([^/]+)\/settings$/.exec(pathname);
      if (settingsMatch) {
        const workspaceId = settingsMatch[1];
        let resp: Response;
        if (method === 'GET') {
          resp = await handleGetWorkspaceSettings(request, env.DB, workspaceId, requestId, env);
        } else if (method === 'PATCH') {
          resp = await handlePatchWorkspaceSettings(request, env.DB, workspaceId, requestId, env);
        } else {
          return addCors(new Response('Method Not Allowed', { status: 405 }));
        }
        return addCors(resp);
      }

      // 4. /api/v1/workspaces/:workspaceId/legal-details
      const legalMatch = /^\/api\/v1\/workspaces\/([^/]+)\/legal-details$/.exec(pathname);
      if (legalMatch) {
        const workspaceId = legalMatch[1];
        let resp: Response;
        if (method === 'GET') {
          resp = await handleGetLegalDetails(request, env.DB, workspaceId, requestId, env);
        } else if (method === 'PATCH') {
          resp = await handlePatchLegalDetails(request, env.DB, workspaceId, requestId, env);
        } else {
          return addCors(new Response('Method Not Allowed', { status: 405 }));
        }
        return addCors(resp);
      }

      // Unknown API route
      if (pathname.startsWith('/api/')) {
        return addCors(resourceNotFoundResponse(`Route '${pathname}' not found`, requestId));
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      if (err instanceof AuthenticationUnavailable) return addCors(createProblemResponse(503, 'SERVICE_UNAVAILABLE', 'service-unavailable', 'Service Unavailable', 'Identity verification is temporarily unavailable. Retry later.', requestId));
      logger.error('WORKER_UNHANDLED_EXCEPTION', 'Unhandled exception in Worker fetch', {
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return addCors(internalErrorResponse('Unexpected server error', requestId));
    }
  },
};

function addCors(resp: Response): Response {
  const headers = new Headers(resp.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Expose-Headers', 'ETag, X-Request-Id');
  headers.set('Cache-Control', 'no-store');
  return new Response(resp.body, {
    status: resp.status,
    statusText: resp.statusText,
    headers,
  });
}
