/**
 * CABMS Worker Route Handlers: Communications, Email Delivery & Review Lifecycle
 *
 * Implements workspace-scoped routes under /api/v1/workspaces/:workspaceId/communications:
 * - GET  /status
 * - POST /test-email
 * - GET  /deliveries
 * - POST /deliveries
 * - POST /deliveries/:deliveryId/retry
 * - GET  /reviews
 * - POST /reviews
 * - POST /reviews/:jobId/retry
 * - POST /reviews/:jobId/reconcile
 */

import type { Env } from '../../types.ts';
import {
  authorizeWorkspaceAccess,
  productionAuthenticationService,
  type AuthenticationService,
} from '../auth.ts';
import {
  accessDeniedResponse,
  authenticationRequiredResponse,
  createProblemResponse,
  resourceNotFoundResponse,
  validationErrorResponse,
} from '../problem.ts';
import {
  emailService,
  type EmailCategory,
  type EmailDeliveryStatus,
  type EmailEnv,
} from '../../services/emailService.ts';

const VALID_CATEGORIES = new Set<EmailCategory>([
  'TEST_EMAIL',
  'REVIEW_REQUEST',
  'CERTIFICATE',
  'REMINDER',
  'QUOTE',
  'ENQUIRY_REPLY',
  'GENERAL',
]);
const VALID_STATUSES = new Set<EmailDeliveryStatus>(['QUEUED', 'SENT', 'FAILED', 'UNCERTAIN']);
const VALID_SIMULATE_OUTCOMES = new Set(['SENT', 'FAILED', 'UNCERTAIN']);

function jsonResponse(data: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    },
  });
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const raw = await request.json();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function handleCommunications(
  request: Request,
  env: Env,
  workspaceId: string,
  subPath: string,
  requestId: string,
  authentication: AuthenticationService = productionAuthenticationService
): Promise<Response> {
  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) {
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeWorkspaceAccess(env.DB, workspaceId, auth);
  if (!membership) {
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  // Technicians do not dispatch or manage automated customer communications
  if (membership.role === 'technician') {
    return accessDeniedResponse(
      'Technicians do not have permission to manage customer communications or email delivery',
      requestId
    );
  }

  const emailEnv = env as EmailEnv;
  const method = request.method;
  const url = new URL(request.url);
  const normalizedSub = subPath.replace(/^\/+|\/+$/g, '');

  // 1. GET /communications/status
  if (normalizedSub === 'status' && method === 'GET') {
    const transport = await emailService.getWorkspaceTransportStatus(env.DB, workspaceId, emailEnv);
    const sender = await emailService.resolveSenderIdentity(env.DB, workspaceId);
    return jsonResponse({ transport_status: transport, sender_identity: sender }, 200, requestId);
  }

  // 2. POST /communications/test-email
  if (normalizedSub === 'test-email' && method === 'POST') {
    const body = await parseJsonObject(request);
    if (!body) {
      return validationErrorResponse(
        'Invalid JSON payload',
        [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be a JSON object' }],
        requestId
      );
    }

    const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
    if (!emailService.isValidEmailAddress(recipientEmail)) {
      return validationErrorResponse(
        'Valid recipient_email is required',
        [{ pointer: '/recipient_email', code: 'INVALID_EMAIL', message: 'Provide a valid recipient email address' }],
        requestId
      );
    }

    const simulateOutcome =
      typeof body.simulate_outcome === 'string' && VALID_SIMULATE_OUTCOMES.has(body.simulate_outcome)
        ? (body.simulate_outcome as 'SENT' | 'FAILED' | 'UNCERTAIN')
        : undefined;

    const result = await emailService.sendTestEmail(env.DB, emailEnv, {
      workspaceId,
      toEmail: recipientEmail,
      toName: typeof body.recipient_name === 'string' ? body.recipient_name.trim() : undefined,
      subject: typeof body.subject === 'string' ? body.subject.trim() : undefined,
      actorUserId: auth.userId,
      requestId,
      simulateOutcome,
    });

    const sender = await emailService.resolveSenderIdentity(env.DB, workspaceId);
    return jsonResponse(
      {
        delivery: result.delivery,
        transport_mode: result.transport_mode,
        is_synthetic: result.is_synthetic,
        audit_event_id: result.audit_event_id,
        sender_identity: sender,
      },
      201,
      requestId
    );
  }

  // 3. GET /communications/deliveries
  if (normalizedSub === 'deliveries' && method === 'GET') {
    const categoryParam = url.searchParams.get('category');
    const statusParam = url.searchParams.get('status');
    const jobIdParam = url.searchParams.get('job_id') || undefined;
    const limitParam = url.searchParams.get('limit');

    const category = categoryParam && VALID_CATEGORIES.has(categoryParam as EmailCategory)
      ? (categoryParam as EmailCategory)
      : undefined;
    const status = statusParam && VALID_STATUSES.has(statusParam as EmailDeliveryStatus)
      ? (statusParam as EmailDeliveryStatus)
      : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;

    const [deliveries, auditEvents] = await Promise.all([
      emailService.listEmailDeliveries(env.DB, workspaceId, {
        category,
        status,
        jobId: jobIdParam,
        limit: Number.isFinite(limit) ? limit : undefined,
      }),
      emailService.listEmailAuditEvents(env.DB, workspaceId, undefined, 50),
    ]);

    return jsonResponse(
      {
        deliveries,
        audit_events: auditEvents,
        transport_status: await emailService.getWorkspaceTransportStatus(env.DB, workspaceId, emailEnv),
      },
      200,
      requestId
    );
  }

  // 4. POST /communications/deliveries
  if (normalizedSub === 'deliveries' && method === 'POST') {
    const body = await parseJsonObject(request);
    if (!body) {
      return validationErrorResponse(
        'Invalid JSON payload',
        [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be a JSON object' }],
        requestId
      );
    }

    const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const bodyText = typeof body.body_text === 'string' ? body.body_text.trim() : '';
    const category = typeof body.category === 'string' && VALID_CATEGORIES.has(body.category as EmailCategory)
      ? (body.category as EmailCategory)
      : 'GENERAL';

    const errors: Array<{ pointer: string; code: string; message: string }> = [];
    if (!emailService.isValidEmailAddress(recipientEmail)) {
      errors.push({ pointer: '/recipient_email', code: 'INVALID_EMAIL', message: 'Valid recipient_email is required' });
    }
    if (!subject) {
      errors.push({ pointer: '/subject', code: 'REQUIRED', message: 'subject is required' });
    }
    if (!bodyText) {
      errors.push({ pointer: '/body_text', code: 'REQUIRED', message: 'body_text is required' });
    }
    if (errors.length > 0) {
      return validationErrorResponse('Invalid email delivery request', errors, requestId);
    }

    const simulateOutcome =
      typeof body.simulate_outcome === 'string' && VALID_SIMULATE_OUTCOMES.has(body.simulate_outcome)
        ? (body.simulate_outcome as 'SENT' | 'FAILED' | 'UNCERTAIN')
        : undefined;

    const result = await emailService.sendEmail(env.DB, emailEnv, {
      workspaceId,
      category,
      toEmail: recipientEmail,
      toName: typeof body.recipient_name === 'string' ? body.recipient_name.trim() : undefined,
      subject,
      bodyText,
      bodyHtml: typeof body.body_html === 'string' ? body.body_html : undefined,
      jobId: typeof body.job_id === 'string' ? body.job_id.trim() : undefined,
      actorUserId: auth.userId,
      requestId,
      simulateOutcome,
    });

    return jsonResponse(result, 201, requestId);
  }

  // 5. POST /communications/deliveries/:deliveryId/retry
  const retryDeliveryMatch = /^deliveries\/([^/]+)\/retry$/.exec(normalizedSub);
  if (retryDeliveryMatch && method === 'POST') {
    const deliveryId = decodeURIComponent(retryDeliveryMatch[1]);
    const body = await parseJsonObject(request);
    const simulateOutcome =
      body && typeof body.simulate_outcome === 'string' && VALID_SIMULATE_OUTCOMES.has(body.simulate_outcome)
        ? (body.simulate_outcome as 'SENT' | 'FAILED' | 'UNCERTAIN')
        : undefined;
    const res = await emailService.retryEmailDelivery(
      env.DB,
      emailEnv,
      workspaceId,
      deliveryId,
      auth.userId,
      requestId,
      simulateOutcome ? { simulateOutcome } : undefined
    );
    if (!res.ok) {
      if (res.code === 'NOT_FOUND') {
        return resourceNotFoundResponse(res.message, requestId);
      }
      return createProblemResponse(409, 'CONFLICT', 'conflict', 'Conflict', res.message, requestId);
    }
    return jsonResponse(res.result, 200, requestId);
  }

  // 6. GET /communications/reviews
  if (normalizedSub === 'reviews' && method === 'GET') {
    const jobId = url.searchParams.get('job_id') || undefined;
    const reviews = await emailService.listReviewRequests(env.DB, workspaceId, jobId);
    return jsonResponse({ review_requests: reviews }, 200, requestId);
  }

  // 7. POST /communications/reviews
  if (normalizedSub === 'reviews' && method === 'POST') {
    const body = await parseJsonObject(request);
    if (!body) {
      return validationErrorResponse(
        'Invalid JSON payload',
        [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be a JSON object' }],
        requestId
      );
    }

    const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
    const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
    const errors: Array<{ pointer: string; code: string; message: string }> = [];
    if (!jobId) {
      errors.push({ pointer: '/job_id', code: 'REQUIRED', message: 'job_id is required' });
    }
    if (!emailService.isValidEmailAddress(recipientEmail)) {
      errors.push({ pointer: '/recipient_email', code: 'INVALID_EMAIL', message: 'Valid recipient_email is required' });
    }
    if (errors.length > 0) {
      return validationErrorResponse('Invalid review request payload', errors, requestId);
    }

    const simulateOutcome =
      typeof body.simulate_outcome === 'string' && VALID_SIMULATE_OUTCOMES.has(body.simulate_outcome)
        ? (body.simulate_outcome as 'SENT' | 'FAILED' | 'UNCERTAIN')
        : undefined;

    const result = await emailService.dispatchReviewRequest(env.DB, emailEnv, {
      workspaceId,
      jobId,
      recipientEmail,
      recipientName: typeof body.recipient_name === 'string' ? body.recipient_name.trim() : undefined,
      siteAddress: typeof body.site_address === 'string' ? body.site_address.trim() : undefined,
      technicianName: typeof body.technician_name === 'string' ? body.technician_name.trim() : undefined,
      actorUserId: auth.userId,
      requestId,
      simulateOutcome,
    });

    return jsonResponse(result, result.deduplicated ? 200 : 201, requestId);
  }

  // 8. POST /communications/reviews/:jobId/retry
  const retryReviewMatch = /^reviews\/([^/]+)\/retry$/.exec(normalizedSub);
  if (retryReviewMatch && method === 'POST') {
    const jobId = decodeURIComponent(retryReviewMatch[1]);
    const body = await parseJsonObject(request);
    const simulateOutcome =
      body && typeof body.simulate_outcome === 'string' && VALID_SIMULATE_OUTCOMES.has(body.simulate_outcome)
        ? (body.simulate_outcome as 'SENT' | 'FAILED' | 'UNCERTAIN')
        : undefined;
    const res = await emailService.retryReviewRequestDelivery(
      env.DB,
      emailEnv,
      workspaceId,
      jobId,
      auth.userId,
      requestId,
      simulateOutcome ? { simulateOutcome } : undefined
    );
    if (!res.ok) {
      if (res.code === 'NOT_FOUND') {
        return resourceNotFoundResponse(res.message, requestId);
      }
      return createProblemResponse(409, 'CONFLICT', 'conflict', 'Conflict', res.message, requestId);
    }
    return jsonResponse(res, 200, requestId);
  }

  // 9. POST /communications/reviews/:jobId/reconcile
  const reconcileReviewMatch = /^reviews\/([^/]+)\/reconcile$/.exec(normalizedSub);
  if (reconcileReviewMatch && method === 'POST') {
    const jobId = decodeURIComponent(reconcileReviewMatch[1]);
    const body = await parseJsonObject(request);
    const outcome = body?.outcome;
    if (outcome !== 'SENT' && outcome !== 'FAILED') {
      return validationErrorResponse(
        'Outcome must be SENT or FAILED',
        [{ pointer: '/outcome', code: 'INVALID_ENUM', message: 'outcome must be SENT or FAILED' }],
        requestId
      );
    }

    const res = await emailService.reconcileReviewRequestStatus(
      env.DB,
      emailEnv,
      workspaceId,
      jobId,
      outcome,
      auth.userId,
      requestId
    );
    if (!res.ok) {
      if (res.code === 'NOT_FOUND') {
        return resourceNotFoundResponse(res.message, requestId);
      }
      return createProblemResponse(409, 'CONFLICT', 'conflict', 'Conflict', res.message, requestId);
    }
    return jsonResponse(res, 200, requestId);
  }

  return resourceNotFoundResponse(`Communications route '${normalizedSub}' not found`, requestId);
}
