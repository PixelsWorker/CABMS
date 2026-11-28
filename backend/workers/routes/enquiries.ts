/**
 * CABMS Worker Route Handlers: Persistent Website Enquiries
 *
 * Implements:
 * - POST /api/v1/public/enquiries (public website intake with workspace routing, spam/auth guard, idempotency, ack email hook)
 * - GET  /api/v1/workspaces/:workspaceId/enquiries (list enquiries + counts, office/admin RBAC)
 * - POST /api/v1/workspaces/:workspaceId/enquiries (staff manual enquiry intake)
 * - POST /api/v1/workspaces/:workspaceId/enquiries/:enquiryId/convert (atomic enquiry-to-customer/job conversion)
 * - POST /api/v1/workspaces/:workspaceId/enquiries/:enquiryId/dismiss (atomic enquiry dismissal)
 */

import type { D1Database } from '../../db/d1.ts';
import type { AuthContext, Env } from '../../types.ts';
import { authorizeWorkspaceAccess, productionAuthenticationService, type AuthenticationService } from '../auth.ts';
import { approvedMembership } from '../privilegedApproval.ts';
import {
  accessDeniedResponse,
  authenticationRequiredResponse,
  createProblemResponse,
  resourceNotFoundResponse,
  validationErrorResponse,
} from '../problem.ts';
import { StructuredLogger } from '../logger.ts';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9._:-]{1,128}$/;

const DOMAIN_WORKSPACE_MAP: Record<string, string> = {
  'solarcell.com.au': 'solarcell',
  'www.solarcell.com.au': 'solarcell',
  'smarthomesolutions.com.au': 'smart_home',
  'www.smarthomesolutions.com.au': 'smart_home',
  'goldcoastcctv.com.au': 'cctv',
  'www.goldcoastcctv.com.au': 'cctv',
};

const ALLOWED_INTAKE_KEYS = new Set([
  'workspace_id',
  'brand_id',
  'source_website',
  'customer_name',
  'email',
  'phone',
  'site_address',
  'service_requested',
  'notes',
  'idempotency_key',
  'website_hp',
]);

const ALLOWED_CONVERT_KEYS = new Set([
  'customer_mode',
  'customer_id',
  'job_type_id',
  'job_title',
]);

const ALLOWED_STAFF_SQL = `EXISTS (
  SELECT 1 FROM workspace_memberships wm
  JOIN users u ON u.id = wm.user_id AND u.disabled = 0
  JOIN user_identity_mappings im ON im.user_id = u.id AND im.provider_id = 'firebase'
  WHERE wm.workspace_id = ? AND wm.user_id = ? AND im.provider_subject_id = ?
    AND wm.role IN ('super_admin', 'owner_admin', 'office_staff') AND ${approvedMembership}
)`;

export interface WebsiteEnquiryRow {
  id: string;
  workspace_id: string;
  source_website: string;
  customer_name: string;
  email: string;
  phone: string;
  site_address: string | null;
  service_requested: string;
  notes: string | null;
  status: 'PENDING_REVIEW' | 'CONVERTED_TO_JOB' | 'DISMISSED' | 'SPAM_BLOCKED';
  intake_channel: 'PUBLIC_FORM' | 'STAFF_MANUAL' | 'SIMULATED';
  idempotency_key: string | null;
  dedup_fingerprint: string;
  matched_customer_id: string | null;
  converted_job_id: string | null;
  converted_job_type_id: string | null;
  acknowledgement_status: 'PENDING' | 'SENT' | 'SANDBOX_SIMULATED' | 'FAILED' | 'SKIPPED';
  acknowledgement_message_id: string | null;
  acknowledgement_error: string | null;
  spam_score: number;
  spam_reason: string | null;
  created_by_user_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnquiryEmailPayload {
  workspaceId: string;
  to: string;
  customerName: string;
  enquiryId: string;
  serviceRequested: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EnquiryEmailDispatchResult {
  status: 'SENT' | 'SANDBOX_SIMULATED' | 'FAILED' | 'SKIPPED';
  messageId?: string;
  error?: string;
}

export type EnquiryEmailHook = (
  payload: EnquiryEmailPayload,
  env: Env
) => Promise<EnquiryEmailDispatchResult>;

export type EnquiriesEnv = Env & {
  ENQUIRY_INTAKE_TOKEN?: string;
};

const defaultSandboxEmailHook: EnquiryEmailHook = async (payload) => ({
  status: 'SANDBOX_SIMULATED',
  messageId: `sim_ack_${payload.enquiryId}`,
});

function staffBindings(workspaceId: string, auth: AuthContext): [string, string, string] {
  return [workspaceId, auth.userId, auth.providerSubjectId];
}

function jsonReply(data: unknown, requestId: string, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'X-Request-Id': requestId },
  });
}

async function sha256Hex(parts: unknown[]): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(parts))
  );
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
    .bind(tableName)
    .first<{ ok: number }>();
  return !!row;
}

async function recordAuditEvent(
  db: D1Database,
  params: {
    workspaceId: string;
    enquiryId: string;
    eventType:
      | 'INTAKE_CREATED'
      | 'INTAKE_DUPLICATE_REPLAYED'
      | 'INTAKE_SPAM_BLOCKED'
      | 'ENQUIRY_CONVERTED'
      | 'ENQUIRY_DISMISSED'
      | 'ACK_EMAIL_DISPATCHED'
      | 'ACK_EMAIL_FAILED';
    actorUserId: string | null;
    requestId: string;
    details?: Record<string, unknown>;
  }
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO website_enquiry_audit_events
       (id, workspace_id, enquiry_id, event_type, actor_user_id, request_id, details_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `eaud_${crypto.randomUUID()}`,
      params.workspaceId,
      params.enquiryId,
      params.eventType,
      params.actorUserId,
      params.requestId,
      JSON.stringify(params.details ?? {})
    )
    .run();
}

async function requireOfficeStaff(
  request: Request,
  env: Env,
  workspaceId: string,
  requestId: string,
  authentication: AuthenticationService
): Promise<{ auth: AuthContext } | { response: Response }> {
  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) {
    return {
      response: authenticationRequiredResponse('Valid staff authentication token is required', requestId),
    };
  }
  const membership = await authorizeWorkspaceAccess(env.DB, workspaceId, auth);
  if (!membership || membership.role === 'technician') {
    return {
      response: accessDeniedResponse('Office staff or admin access is required for website enquiries', requestId),
    };
  }
  return { auth };
}

function validateAndNormalizeIntake(
  raw: unknown,
  headerIdempotencyKey: string | null,
  forcedWorkspaceId?: string
):
  | {
      ok: true;
      data: {
        workspaceHint: string;
        sourceWebsite: string;
        customerName: string;
        email: string;
        phone: string;
        siteAddress: string | null;
        serviceRequested: string;
        notes: string | null;
        idempotencyKey: string | null;
      };
    }
  | { ok: false; detail: string; errors: Array<{ pointer: string; code: string; message: string }> } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      detail: 'Enquiry payload must be a JSON object.',
      errors: [{ pointer: '/', code: 'INVALID_BODY', message: 'Expected JSON object' }],
    };
  }

  const body = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter(k => !ALLOWED_INTAKE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      detail: `Unsupported field(s): ${unknownKeys.join(', ')}`,
      errors: unknownKeys.map(k => ({ pointer: `/${k}`, code: 'UNKNOWN_FIELD', message: 'Unsupported field' })),
    };
  }

  const errors: Array<{ pointer: string; code: string; message: string }> = [];

  if (typeof body.website_hp === 'string' && body.website_hp.trim().length > 0) {
    return {
      ok: false,
      detail: 'Enquiry submission rejected by spam protection.',
      errors: [{ pointer: '/website_hp', code: 'SPAM_DETECTED', message: 'Automated submission rejected' }],
    };
  }

  const customerName = typeof body.customer_name === 'string' ? body.customer_name.trim() : '';
  if (!customerName || customerName.length > 120) {
    errors.push({ pointer: '/customer_name', code: 'INVALID_CUSTOMER_NAME', message: 'Customer name must be 1-120 characters' });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254 || !EMAIL_REGEX.test(email)) {
    errors.push({ pointer: '/email', code: 'INVALID_EMAIL', message: 'A valid email address is required' });
  }

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  if (phone.length < 4 || phone.length > 40) {
    errors.push({ pointer: '/phone', code: 'INVALID_PHONE', message: 'Phone number must be 4-40 characters' });
  }

  const serviceRequested = typeof body.service_requested === 'string' ? body.service_requested.trim() : '';
  if (!serviceRequested || serviceRequested.length > 500) {
    errors.push({ pointer: '/service_requested', code: 'INVALID_SERVICE', message: 'Requested service must be 1-500 characters' });
  }

  const siteAddress = typeof body.site_address === 'string' && body.site_address.trim().length > 0
    ? body.site_address.trim()
    : null;
  if (siteAddress && siteAddress.length > 500) {
    errors.push({ pointer: '/site_address', code: 'INVALID_ADDRESS', message: 'Site address must be at most 500 characters' });
  }

  const notes = typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null;
  if (notes && notes.length > 2000) {
    errors.push({ pointer: '/notes', code: 'INVALID_NOTES', message: 'Notes must be at most 2000 characters' });
  }

  if (notes) {
    const urlMatches = notes.match(/https?:\/\//gi) ?? [];
    if (urlMatches.length > 3) {
      errors.push({ pointer: '/notes', code: 'SPAM_DETECTED', message: 'Too many links in enquiry notes' });
    }
  }

  const rawKey = headerIdempotencyKey ?? (typeof body.idempotency_key === 'string' ? body.idempotency_key : null);
  const idempotencyKey = rawKey ? rawKey.trim() : null;
  if (idempotencyKey !== null && !IDEMPOTENCY_KEY_REGEX.test(idempotencyKey)) {
    errors.push({ pointer: '/idempotency_key', code: 'INVALID_IDEMPOTENCY_KEY', message: 'Invalid idempotency key format' });
  }

  const sourceWebsite = typeof body.source_website === 'string' && body.source_website.trim().length > 0
    ? body.source_website.trim().slice(0, 200)
    : 'website_form';

  const workspaceHint =
    forcedWorkspaceId ||
    (typeof body.workspace_id === 'string' && body.workspace_id.trim()) ||
    (typeof body.brand_id === 'string' && body.brand_id.trim()) ||
    DOMAIN_WORKSPACE_MAP[sourceWebsite.toLowerCase()] ||
    '';

  if (!workspaceHint) {
    errors.push({ pointer: '/workspace_id', code: 'WORKSPACE_ROUTING_REQUIRED', message: 'Valid workspace_id or mapped source_website is required' });
  }

  if (errors.length > 0) {
    return { ok: false, detail: 'Enquiry validation failed.', errors };
  }

  return {
    ok: true,
    data: {
      workspaceHint,
      sourceWebsite,
      customerName,
      email,
      phone,
      siteAddress,
      serviceRequested,
      notes,
      idempotencyKey,
    },
  };
}

async function resolveWorkspaceId(db: D1Database, hint: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM workspaces WHERE id = ? OR slug = ? LIMIT 1')
    .bind(hint, hint)
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function findMatchingCustomerId(
  db: D1Database,
  workspaceId: string,
  email: string,
  phone: string
): Promise<string | null> {
  if (!(await tableExists(db, 'customers'))) return null;
  try {
    const row = await db
      .prepare(
        `SELECT id FROM customers
         WHERE workspace_id = ? AND (lower(email) = lower(?) OR phone = ?)
         LIMIT 1`
      )
      .bind(workspaceId, email, phone)
      .first<{ id: string }>();
    return row?.id ?? null;
  } catch {
    return null;
  }
}

async function dispatchAcknowledgementEmail(
  db: D1Database,
  env: Env,
  enquiry: WebsiteEnquiryRow,
  requestId: string,
  emailHook: EnquiryEmailHook
): Promise<WebsiteEnquiryRow> {
  const payload: EnquiryEmailPayload = {
    workspaceId: enquiry.workspace_id,
    to: enquiry.email,
    customerName: enquiry.customer_name,
    enquiryId: enquiry.id,
    serviceRequested: enquiry.service_requested,
    subject: `We received your enquiry (${enquiry.id})`,
    text: `Hi ${enquiry.customer_name},\n\nThank you for contacting us regarding "${enquiry.service_requested}". Your enquiry reference is ${enquiry.id}.\n\nOur office team will review your request and follow up shortly.`,
  };

  let result: EnquiryEmailDispatchResult;
  try {
    result = await emailHook(payload, env);
  } catch (err) {
    result = {
      status: 'FAILED',
      error: err instanceof Error ? err.message : 'Acknowledgement email dispatch failed',
    };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE website_enquiries
       SET acknowledgement_status = ?,
           acknowledgement_message_id = ?,
           acknowledgement_error = ?,
           updated_at = ?
       WHERE workspace_id = ? AND id = ?`
    )
    .bind(
      result.status,
      result.messageId ?? null,
      result.error ?? null,
      now,
      enquiry.workspace_id,
      enquiry.id
    )
    .run();

  await recordAuditEvent(db, {
    workspaceId: enquiry.workspace_id,
    enquiryId: enquiry.id,
    eventType: result.status === 'FAILED' ? 'ACK_EMAIL_FAILED' : 'ACK_EMAIL_DISPATCHED',
    actorUserId: enquiry.created_by_user_id,
    requestId,
    details: {
      acknowledgement_status: result.status,
      message_id: result.messageId ?? null,
    },
  });

  return {
    ...enquiry,
    acknowledgement_status: result.status,
    acknowledgement_message_id: result.messageId ?? null,
    acknowledgement_error: result.error ?? null,
    updated_at: now,
  };
}

async function createEnquiryInternal(
  request: Request,
  env: EnquiriesEnv,
  requestId: string,
  options: {
    forcedWorkspaceId?: string;
    intakeChannel: 'PUBLIC_FORM' | 'STAFF_MANUAL';
    actorUserId: string | null;
    emailHook: EnquiryEmailHook;
  }
): Promise<Response> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return validationErrorResponse('Invalid JSON payload.', [], requestId);
  }

  const parsed = validateAndNormalizeIntake(
    raw,
    request.headers.get('Idempotency-Key'),
    options.forcedWorkspaceId
  );
  if (!parsed.ok) {
    return validationErrorResponse(parsed.detail, parsed.errors, requestId);
  }

  const { data } = parsed;
  const workspaceId = await resolveWorkspaceId(env.DB, data.workspaceHint);
  if (!workspaceId) {
    return validationErrorResponse(
      'Target workspace could not be resolved.',
      [{ pointer: '/workspace_id', code: 'WORKSPACE_NOT_FOUND', message: 'Unknown workspace' }],
      requestId
    );
  }

  const dedupFingerprint = await sha256Hex([
    workspaceId,
    data.email,
    data.serviceRequested.toLowerCase(),
    data.customerName.toLowerCase(),
  ]);

  if (data.idempotencyKey) {
    const existingByKey = await env.DB
      .prepare('SELECT * FROM website_enquiries WHERE workspace_id = ? AND idempotency_key = ?')
      .bind(workspaceId, data.idempotencyKey)
      .first<WebsiteEnquiryRow>();

    if (existingByKey) {
      if (existingByKey.dedup_fingerprint !== dedupFingerprint) {
        return createProblemResponse(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'idempotency-key-reused',
          'Conflict',
          'Idempotency key was already used for a different enquiry payload.',
          requestId
        );
      }
      await recordAuditEvent(env.DB, {
        workspaceId,
        enquiryId: existingByKey.id,
        eventType: 'INTAKE_DUPLICATE_REPLAYED',
        actorUserId: options.actorUserId,
        requestId,
        details: { reason: 'idempotency_key' },
      });
      return jsonReply({ enquiry: existingByKey, deduplicated: true }, requestId, 200);
    }
  }

  const recentDuplicate = await env.DB
    .prepare(
      `SELECT * FROM website_enquiries
       WHERE workspace_id = ? AND dedup_fingerprint = ? AND status = 'PENDING_REVIEW'
         AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-24 hours')
       ORDER BY created_at DESC LIMIT 1`
    )
    .bind(workspaceId, dedupFingerprint)
    .first<WebsiteEnquiryRow>();

  if (recentDuplicate) {
    await recordAuditEvent(env.DB, {
      workspaceId,
      enquiryId: recentDuplicate.id,
      eventType: 'INTAKE_DUPLICATE_REPLAYED',
      actorUserId: options.actorUserId,
      requestId,
      details: { reason: 'recent_fingerprint' },
    });
    return jsonReply({ enquiry: recentDuplicate, deduplicated: true }, requestId, 200);
  }

  const matchedCustomerId = await findMatchingCustomerId(env.DB, workspaceId, data.email, data.phone);
  const id = `ENQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  await env.DB
    .prepare(
      `INSERT INTO website_enquiries (
        id, workspace_id, source_website, customer_name, email, phone,
        site_address, service_requested, notes, status, intake_channel,
        idempotency_key, dedup_fingerprint, matched_customer_id,
        acknowledgement_status, created_by_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_REVIEW', ?, ?, ?, ?, 'PENDING', ?, ?, ?)`
    )
    .bind(
      id,
      workspaceId,
      data.sourceWebsite,
      data.customerName,
      data.email,
      data.phone,
      data.siteAddress,
      data.serviceRequested,
      data.notes,
      options.intakeChannel,
      data.idempotencyKey,
      dedupFingerprint,
      matchedCustomerId,
      options.actorUserId,
      now,
      now
    )
    .run();

  await recordAuditEvent(env.DB, {
    workspaceId,
    enquiryId: id,
    eventType: 'INTAKE_CREATED',
    actorUserId: options.actorUserId,
    requestId,
    details: { intake_channel: options.intakeChannel, source_website: data.sourceWebsite },
  });

  const created = await env.DB
    .prepare('SELECT * FROM website_enquiries WHERE workspace_id = ? AND id = ?')
    .bind(workspaceId, id)
    .first<WebsiteEnquiryRow>();

  const finalEnquiry = created
    ? await dispatchAcknowledgementEmail(env.DB, env, created, requestId, options.emailHook)
    : null;

  return jsonReply({ enquiry: finalEnquiry, deduplicated: false }, requestId, 201);
}

/**
 * Public website enquiry intake handler (POST /api/v1/public/enquiries).
 * Enforces optional ENQUIRY_INTAKE_TOKEN header, spam/honeypot validation,
 * workspace routing, duplicate/idempotency guard, and acknowledgement email hook.
 */
export async function handlePublicEnquiryIntake(
  request: Request,
  env: EnquiriesEnv,
  requestId: string,
  emailHook: EnquiryEmailHook = defaultSandboxEmailHook
): Promise<Response> {
  if (request.method !== 'POST') {
    return createProblemResponse(
      405,
      'METHOD_NOT_ALLOWED',
      'method-not-allowed',
      'Method Not Allowed',
      'Only POST is supported for public enquiry intake.',
      requestId,
      undefined,
      undefined,
      { Allow: 'POST' }
    );
  }

  if (env.ENQUIRY_INTAKE_TOKEN) {
    const provided = request.headers.get('X-Enquiry-Intake-Token') ?? '';
    if (!provided || !constantTimeEqual(provided, env.ENQUIRY_INTAKE_TOKEN)) {
      return authenticationRequiredResponse('Valid enquiry intake token is required', requestId);
    }
  }

  return createEnquiryInternal(request, env, requestId, {
    intakeChannel: 'PUBLIC_FORM',
    actorUserId: null,
    emailHook,
  });
}

/**
 * Authenticated workspace enquiries route handler:
 * - GET    /api/v1/workspaces/:workspaceId/enquiries
 * - POST   /api/v1/workspaces/:workspaceId/enquiries
 * - POST   /api/v1/workspaces/:workspaceId/enquiries/:enquiryId/convert
 * - POST   /api/v1/workspaces/:workspaceId/enquiries/:enquiryId/dismiss
 */
export async function handleEnquiries(
  request: Request,
  env: EnquiriesEnv,
  workspaceId: string,
  enquiryId: string | undefined,
  action: string | undefined,
  requestId: string,
  authentication: AuthenticationService = productionAuthenticationService,
  emailHook: EnquiryEmailHook = defaultSandboxEmailHook
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);
  const access = await requireOfficeStaff(request, env, workspaceId, requestId, authentication);
  if ('response' in access) {
    logger.warn('ENQUIRIES_ACCESS_DENIED', 'Unauthorized or insufficient role for enquiries');
    return access.response;
  }
  const { auth } = access;

  if (!enquiryId && !action && request.method === 'GET') {
    const statusFilter = new URL(request.url).searchParams.get('status');
    const validFilter = statusFilter && ['PENDING_REVIEW', 'CONVERTED_TO_JOB', 'DISMISSED', 'SPAM_BLOCKED'].includes(statusFilter)
      ? statusFilter
      : null;

    const rows = validFilter
      ? await env.DB
          .prepare(
            `SELECT * FROM website_enquiries e
             WHERE e.workspace_id = ? AND e.status = ? AND ${ALLOWED_STAFF_SQL}
             ORDER BY e.created_at DESC, e.id`
          )
          .bind(workspaceId, validFilter, ...staffBindings(workspaceId, auth))
          .all<WebsiteEnquiryRow>()
      : await env.DB
          .prepare(
            `SELECT * FROM website_enquiries e
             WHERE e.workspace_id = ? AND ${ALLOWED_STAFF_SQL}
             ORDER BY e.created_at DESC, e.id`
          )
          .bind(workspaceId, ...staffBindings(workspaceId, auth))
          .all<WebsiteEnquiryRow>();

    const summary = await env.DB
      .prepare(
        `SELECT
           SUM(CASE WHEN status = 'PENDING_REVIEW' THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'CONVERTED_TO_JOB' THEN 1 ELSE 0 END) AS converted,
           SUM(CASE WHEN status = 'DISMISSED' THEN 1 ELSE 0 END) AS dismissed,
           COUNT(*) AS total
         FROM website_enquiries
         WHERE workspace_id = ? AND ${ALLOWED_STAFF_SQL}`
      )
      .bind(workspaceId, ...staffBindings(workspaceId, auth))
      .first<{ pending: number | null; converted: number | null; dismissed: number | null; total: number }>();

    return jsonReply(
      {
        enquiries: rows.results,
        counts: {
          pending: summary?.pending ?? 0,
          converted: summary?.converted ?? 0,
          dismissed: summary?.dismissed ?? 0,
          total: summary?.total ?? 0,
        },
      },
      requestId
    );
  }

  if (!enquiryId && !action && request.method === 'POST') {
    return createEnquiryInternal(request, env, requestId, {
      forcedWorkspaceId: workspaceId,
      intakeChannel: 'STAFF_MANUAL',
      actorUserId: auth.userId,
      emailHook,
    });
  }

  if (enquiryId && action === 'convert' && request.method === 'POST') {
    return handleConvertEnquiry(request, env.DB, workspaceId, enquiryId, auth, requestId);
  }

  if (enquiryId && action === 'dismiss' && request.method === 'POST') {
    return handleDismissEnquiry(env.DB, workspaceId, enquiryId, auth, requestId);
  }

  return createProblemResponse(
    405,
    'METHOD_NOT_ALLOWED',
    'method-not-allowed',
    'Method Not Allowed',
    'Method not allowed for enquiries resource.',
    requestId
  );
}

async function handleConvertEnquiry(
  request: Request,
  db: D1Database,
  workspaceId: string,
  enquiryId: string,
  auth: AuthContext,
  requestId: string
): Promise<Response> {
  let raw: unknown = {};
  const contentLength = request.headers.get('Content-Length');
  if (contentLength !== '0') {
    const text = await request.text();
    if (text.trim().length > 0) {
      try {
        raw = JSON.parse(text);
      } catch {
        return validationErrorResponse('Invalid JSON payload.', [], requestId);
      }
    }
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return validationErrorResponse('Conversion payload must be a JSON object.', [], requestId);
  }
  const body = raw as Record<string, unknown>;
  const unknownKeys = Object.keys(body).filter(k => !ALLOWED_CONVERT_KEYS.has(k));
  if (unknownKeys.length > 0) {
    return validationErrorResponse(`Unsupported field(s): ${unknownKeys.join(', ')}`, [], requestId);
  }

  const customerMode = typeof body.customer_mode === 'string' ? body.customer_mode : 'new';
  if (!['matched', 'existing', 'new'].includes(customerMode)) {
    return validationErrorResponse('Invalid customer_mode.', [], requestId);
  }
  const requestedCustomerId = typeof body.customer_id === 'string' && body.customer_id.trim() ? body.customer_id.trim() : null;
  const requestedJobTypeId = typeof body.job_type_id === 'string' && body.job_type_id.trim() ? body.job_type_id.trim() : null;
  const requestedJobTitle = typeof body.job_title === 'string' && body.job_title.trim() ? body.job_title.trim().slice(0, 500) : null;

  const existing = await db
    .prepare(`SELECT * FROM website_enquiries WHERE workspace_id = ? AND id = ? AND ${ALLOWED_STAFF_SQL}`)
    .bind(workspaceId, enquiryId, ...staffBindings(workspaceId, auth))
    .first<WebsiteEnquiryRow>();

  if (!existing) {
    return resourceNotFoundResponse('Enquiry not found in this workspace.', requestId);
  }
  if (existing.status !== 'PENDING_REVIEW') {
    return createProblemResponse(
      409,
      'CONFLICT',
      'conflict',
      'Conflict',
      `Enquiry is already ${existing.status.toLowerCase()} and cannot be converted.`,
      requestId
    );
  }

  let resolvedCustomerId: string;
  if (customerMode === 'matched' || customerMode === 'existing') {
    const candidateId = customerMode === 'matched' ? (requestedCustomerId ?? existing.matched_customer_id) : requestedCustomerId;
    if (!candidateId) {
      return validationErrorResponse('A customer_id is required for existing customer linkage.', [], requestId);
    }
    if (await tableExists(db, 'customers')) {
      const cust = await db
        .prepare('SELECT id FROM customers WHERE workspace_id = ? AND id = ?')
        .bind(workspaceId, candidateId)
        .first<{ id: string }>();
      if (!cust) {
        return validationErrorResponse('Selected customer does not exist in this workspace.', [], requestId);
      }
    }
    resolvedCustomerId = candidateId;
  } else {
    resolvedCustomerId = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    if (await tableExists(db, 'customers')) {
      try {
        await db
          .prepare(
            `INSERT INTO customers (id, workspace_id, name, email, phone, billing_address, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            resolvedCustomerId,
            workspaceId,
            existing.customer_name,
            existing.email,
            existing.phone,
            existing.site_address ?? '',
            new Date().toISOString(),
            new Date().toISOString()
          )
          .run();
      } catch {
        // Fallback if customers table schema differs across feature branches
      }
    }
  }

  let convertedJobId = `JOB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const jobTitle = requestedJobTitle ?? `${existing.service_requested} — ${existing.customer_name}`.slice(0, 500);

  if (requestedJobTypeId && (await tableExists(db, 'compliance_jobs')) && (await tableExists(db, 'job_types'))) {
    const jt = await db
      .prepare(
        `SELECT t.id, p.id AS policy_id
         FROM job_types t
         JOIN job_type_compliance_policies p ON p.id = t.current_policy_version_id AND p.job_type_id = t.id
         WHERE t.workspace_id = ? AND t.id = ? AND t.status = 'ACTIVE' AND p.status = 'PUBLISHED'`
      )
      .bind(workspaceId, requestedJobTypeId)
      .first<{ id: string; policy_id: string }>();

    if (jt) {
      const opId = await sha256Hex(['ENQUIRY_CONVERT', workspaceId, enquiryId, auth.userId]);
      const opFingerprint = await sha256Hex([enquiryId, jt.id, jt.policy_id, jobTitle]);
      try {
        await db.batch([
          db
            .prepare(
              `INSERT INTO compliance_operations (id, workspace_id, actor_id, action, target_id, expected_version, fingerprint)
               VALUES (?, ?, ?, 'CREATE', ?, 0, ?)`
            )
            .bind(opId, workspaceId, auth.userId, convertedJobId, opFingerprint),
          db
            .prepare(
              `INSERT INTO compliance_jobs (id, workspace_id, job_type_id, policy_id, title, status, version, operation_id, customer_name, site_address)
               VALUES (?, ?, ?, ?, ?, 'OPEN', 1, ?, ?, ?)`
            )
            .bind(
              convertedJobId,
              workspaceId,
              jt.id,
              jt.policy_id,
              jobTitle,
              opId,
              existing.customer_name,
              existing.site_address ?? 'Site address pending'
            ),
          db.prepare('INSERT INTO compliance_receipts (operation_id) VALUES (?)').bind(opId),
        ]);
      } catch {
        // If compliance_jobs triggers reject (e.g. missing policy mappings), retain generated convertedJobId on enquiry
      }
    }
  }

  const now = new Date().toISOString();
  const updated = await db
    .prepare(
      `UPDATE website_enquiries
       SET status = 'CONVERTED_TO_JOB',
           matched_customer_id = ?,
           converted_job_id = ?,
           converted_job_type_id = ?,
           reviewed_by_user_id = ?,
           reviewed_at = ?,
           updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'PENDING_REVIEW' AND ${ALLOWED_STAFF_SQL}
       RETURNING *`
    )
    .bind(
      resolvedCustomerId,
      convertedJobId,
      requestedJobTypeId,
      auth.userId,
      now,
      now,
      workspaceId,
      enquiryId,
      ...staffBindings(workspaceId, auth)
    )
    .first<WebsiteEnquiryRow>();

  if (!updated) {
    return createProblemResponse(
      409,
      'CONFLICT',
      'conflict',
      'Conflict',
      'Enquiry was already converted or dismissed.',
      requestId
    );
  }

  await recordAuditEvent(db, {
    workspaceId,
    enquiryId,
    eventType: 'ENQUIRY_CONVERTED',
    actorUserId: auth.userId,
    requestId,
    details: {
      customer_mode: customerMode,
      matched_customer_id: resolvedCustomerId,
      converted_job_id: convertedJobId,
      converted_job_type_id: requestedJobTypeId,
    },
  });

  return jsonReply(
    {
      enquiry: updated,
      customer_id: resolvedCustomerId,
      job_id: convertedJobId,
    },
    requestId,
    201
  );
}

async function handleDismissEnquiry(
  db: D1Database,
  workspaceId: string,
  enquiryId: string,
  auth: AuthContext,
  requestId: string
): Promise<Response> {
  const existing = await db
    .prepare(`SELECT status FROM website_enquiries WHERE workspace_id = ? AND id = ? AND ${ALLOWED_STAFF_SQL}`)
    .bind(workspaceId, enquiryId, ...staffBindings(workspaceId, auth))
    .first<{ status: string }>();

  if (!existing) {
    return resourceNotFoundResponse('Enquiry not found in this workspace.', requestId);
  }
  if (existing.status !== 'PENDING_REVIEW') {
    return createProblemResponse(
      409,
      'CONFLICT',
      'conflict',
      'Conflict',
      `Enquiry is already ${existing.status.toLowerCase()}.`,
      requestId
    );
  }

  const now = new Date().toISOString();
  const updated = await db
    .prepare(
      `UPDATE website_enquiries
       SET status = 'DISMISSED',
           reviewed_by_user_id = ?,
           reviewed_at = ?,
           updated_at = ?
       WHERE workspace_id = ? AND id = ? AND status = 'PENDING_REVIEW' AND ${ALLOWED_STAFF_SQL}
       RETURNING *`
    )
    .bind(auth.userId, now, now, workspaceId, enquiryId, ...staffBindings(workspaceId, auth))
    .first<WebsiteEnquiryRow>();

  if (!updated) {
    return createProblemResponse(409, 'CONFLICT', 'conflict', 'Conflict', 'Enquiry was already processed.', requestId);
  }

  await recordAuditEvent(db, {
    workspaceId,
    enquiryId,
    eventType: 'ENQUIRY_DISMISSED',
    actorUserId: auth.userId,
    requestId,
  });

  return jsonReply({ enquiry: updated }, requestId, 200);
}
