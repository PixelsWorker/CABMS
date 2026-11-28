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
import { handleDemoAppointments } from './workers/routes/demoAppointments.ts';
import { handleJobTypesRoute, handleTemplatesRoute } from './workers/routes/templatesAndContent.ts';
import { handleFormDefinitions } from './workers/routes/formDefinitions.ts';
import {handleVisits} from './workers/routes/visits.ts';
import { assignStaffRole } from './workers/routes/staffRoles.ts';
import { handleSignComplete } from './workers/routes/signComplete.ts';
import { handleFormOperation } from './workers/routes/formOperation.ts';
import { handleEvidence } from './workers/routes/evidence.ts';
import { handleComplianceJobs } from './workers/routes/complianceJobs.ts';
import { handleDocumentTypes } from './workers/routes/documentTypes.ts';
import { handleSettingsProviders } from './workers/routes/settingsProviders.ts';
import { handleCommunications } from './workers/routes/communications.ts';
import { handleCustomers } from './workers/routes/customers.ts';
import { handleQuotations, handlePublicQuotationToken } from './workers/routes/quotations.ts';
import { handleEnquiries, handlePublicEnquiryIntake } from './workers/routes/enquiries.ts';
import { sendEmail, type EmailEnv } from './services/emailService.ts';

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

      const staffRole = /^\/api\/v1\/workspaces\/([^/]+)\/staff\/([^/]+)\/role$/.exec(pathname);
      if (staffRole && method === 'PATCH') {
        return addCors(await assignStaffRole(request, env, authentication, staffRole[1], staffRole[2], requestId), env);
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

      const formOperation = /^\/api\/v1\/workspaces\/([\w-]+)\/compliance-jobs\/([\w-]+)\/forms\/([^/]+)\/(answer-receipt|withdrawal-request|withdrawal-decision|finding|finding-resolution)$/.exec(pathname);
      if (formOperation) return addCors(await handleFormOperation(request,env,authentication,requestId,formOperation),env);
      const signComplete = /^\/api\/v1\/workspaces\/([\w-]+)\/compliance-jobs\/([\w-]+)\/(?:(?:forms\/([^/]+)\/sign)|complete)$/.exec(pathname);
      if (signComplete) return addCors(await handleSignComplete(request,env,authentication,requestId,signComplete),env);
      const evidenceMatch = /^\/api\/v1\/workspaces\/([\w-]+)\/compliance-jobs\/([\w-]+)\/forms\/([^/]+)\/evidence(?:\/([a-f0-9-]{36}|[a-f0-9]{64})(?:\/(finalize|content|carry-forward))?)?$/.exec(pathname);
      if (evidenceMatch) return addCors(await handleEvidence(request,env,authentication,requestId,evidenceMatch),env);
      const complianceMatch = /^\/api\/v1\/workspaces\/([A-Za-z0-9_-]+)\/compliance-jobs(?:\/([A-Za-z0-9_-]+))?$/.exec(pathname);
      if (complianceMatch) return addCors(await handleComplianceJobs(request, env, complianceMatch[1], complianceMatch[2], requestId, authentication), env);

      const visitsMatch=/^\/api\/v1\/workspaces\/([\w-]+)\/visits$/.exec(pathname);
      if(visitsMatch)return addCors(await handleVisits(request,env,visitsMatch[1],requestId,authentication),env);

      const appointmentMatch = /^\/api\/v1\/workspaces\/([^/]+)\/demo-appointments(?:\/([^/]+))?$/.exec(pathname);
      if (appointmentMatch) return addCors(await handleDemoAppointments(request, env, appointmentMatch[1], appointmentMatch[2], requestId, authentication), env);

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

      const formsMatch = /^\/api\/v1\/workspaces\/([^/]+)\/form-definitions(?:\/([^/]+)(?:\/(revisions)(?:\/([^/]+)(?:\/(review|approve|signer-grants))?)?)?)?$/.exec(pathname);
      if (formsMatch) return addCors(await handleFormDefinitions(request, env, formsMatch[1], formsMatch[2], formsMatch[4], formsMatch[3] && !formsMatch[4] ? 'new-revision' : formsMatch[5], requestId, authentication), env);

      const documentTypesMatch = /^\/api\/v1\/workspaces\/([^/]+)\/document-types(?:\/([^/]+)(?:\/(review|publish))?)?$/.exec(pathname);
      if (documentTypesMatch) return addCors(await handleDocumentTypes(request,env,documentTypesMatch[1],documentTypesMatch[2],documentTypesMatch[3],requestId,authentication),env);

      // Job Types & Compliance Policies
      const jobTypesMatch = /^\/api\/v1\/workspaces\/([^/]+)\/job-types(?:\/([^/]+)(?:\/(policies)(?:\/([^/]+)(?:\/(review|approve))?)?)?)?$/.exec(pathname);
      if (jobTypesMatch) {
        return addCors(await handleJobTypesRoute(request, env, jobTypesMatch[1], jobTypesMatch[2], jobTypesMatch[3], jobTypesMatch[4], jobTypesMatch[5], requestId, authentication), env);
      }

      // Document Templates & Revisions
      const templatesMatch = /^\/api\/v1\/workspaces\/([^/]+)\/templates(?:\/([^/]+)(?:\/(revisions|preview)(?:\/([^/]+)(?:\/(review|approve))?)?)?)?$/.exec(pathname);
      if (templatesMatch) {
        return addCors(await handleTemplatesRoute(request, env, templatesMatch[1], templatesMatch[2], templatesMatch[3], templatesMatch[4], templatesMatch[5], requestId, authentication), env);
      }

      // Provider & System Settings
      const providerSettingsMatch = /^\/api\/v1\/workspaces\/([^/]+)\/provider-settings(?:\/(test|audit))?$/.exec(pathname);
      if (providerSettingsMatch) {
        return addCors(await handleSettingsProviders(request, env, providerSettingsMatch[1], providerSettingsMatch[2], requestId, authentication), env);
      }

      // Communications & Shared Email Service
      const commsMatch = /^\/api\/v1\/workspaces\/([^/]+)\/communications(.*)$/.exec(pathname);
      if (commsMatch) {
        return addCors(await handleCommunications(request, env, commsMatch[1], commsMatch[2] || '', requestId, authentication), env);
      }

      // Customers (MYOB Sandbox)
      const customersMatch = /^\/api\/v1\/workspaces\/([^/]+)\/customers(?:\/([^/]+))?(?:\/(check-duplicate|retry-sync|reconcile))?$/.exec(pathname);
      if (customersMatch) {
        const custId = customersMatch[2] === 'check-duplicate' ? undefined : customersMatch[2];
        const custAction = customersMatch[2] === 'check-duplicate' ? 'check-duplicate' : customersMatch[3];
        return addCors(await handleCustomers(request, env, customersMatch[1], custId, custAction, requestId, authentication), env);
      }

      // Quotations & Public Quotation Token
      const publicQuoteMatch = /^\/api\/v1\/public\/quotations\/([^/]+)(?:\/(accept|refuse))?$/.exec(pathname);
      if (publicQuoteMatch) {
        const pubAction = publicQuoteMatch[2] === 'accept' || publicQuoteMatch[2] === 'refuse' ? publicQuoteMatch[2] : undefined;
        return addCors(await handlePublicQuotationToken(request, env, publicQuoteMatch[1], pubAction, requestId), env);
      }
      const quotesMatch = /^\/api\/v1\/workspaces\/([^/]+)\/quotations(?:\/([^/]+)(?:\/(send|accept|refuse|revoke|revise|follow-ups\/dispatch))?)?$/.exec(pathname);
      if (quotesMatch) {
        return addCors(await handleQuotations(request, env, quotesMatch[1], quotesMatch[2], quotesMatch[3], requestId, authentication, {
          emailDispatcher: async req => {
            const res = await sendEmail(env.DB, env as unknown as EmailEnv, {
              workspaceId: req.workspaceId,
              category: 'QUOTE',
              toEmail: req.to,
              subject: req.subject,
              bodyText: req.textBody,
              bodyHtml: req.htmlBody ?? null,
              requestId,
            });
            return {
              deliveryId: res.delivery.id,
              status: res.delivery.status === 'FAILED' ? 'FAILED' : (res.is_synthetic ? 'SANDBOX_LOGGED' : 'SENT'),
              transport: res.transport_mode,
            };
          },
        }), env);
      }

      // Website Enquiries (Public Intake & Authenticated Management)
      const enquiryEmailHook = async (
        payload: { workspaceId: string; to: string; customerName: string; enquiryId: string; serviceRequested: string; subject: string; text: string },
        e: { DB: typeof env.DB }
      ) => {
        try {
          const res = await sendEmail(e.DB, env as unknown as EmailEnv, {
            workspaceId: payload.workspaceId,
            category: 'ENQUIRY_REPLY',
            toEmail: payload.to,
            toName: payload.customerName,
            subject: payload.subject,
            bodyText: payload.text,
            requestId,
          });
          return {
            status: res.delivery.status === 'FAILED' ? 'FAILED' as const : (res.is_synthetic ? 'SANDBOX_SIMULATED' as const : 'SENT' as const),
            messageId: res.delivery.id,
          };
        } catch (err) {
          return { status: 'FAILED' as const, error: err instanceof Error ? err.message : 'Email dispatch failed' };
        }
      };
      if (pathname === '/api/v1/public/enquiries') {
        return addCors(await handlePublicEnquiryIntake(request, env, requestId, enquiryEmailHook), env);
      }
      const websiteEnquiriesMatch = /^\/api\/v1\/workspaces\/([^/]+)\/website-enquiries(?:\/([^/]+)(?:\/(convert|dismiss))?)?$/.exec(pathname);
      if (websiteEnquiriesMatch) {
        return addCors(await handleEnquiries(request, env, websiteEnquiriesMatch[1], websiteEnquiriesMatch[2], websiteEnquiriesMatch[3], requestId, authentication, enquiryEmailHook), env);
      }

      // Unknown API route
      if (pathname.startsWith('/api/')) {
        return addCors(resourceNotFoundResponse(`Route '${pathname}' not found`, requestId), env);
      }

      // Serve static frontend assets from Vite build output if configured
      if (/^\/(?:stage|private)\//.test(pathname)) {
        return addCors(resourceNotFoundResponse('Resource unavailable', requestId), env);
      }
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
