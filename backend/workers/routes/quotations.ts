/**
 * CABMS Worker Route Handlers: Quotations, Immutable Terms Snapshots & Follow-Up Scheduling
 *
 * Implements workspace-scoped quotation lifecycle:
 * - GET    /api/v1/workspaces/:workspaceId/quotations
 * - POST   /api/v1/workspaces/:workspaceId/quotations
 * - GET    /api/v1/workspaces/:workspaceId/quotations/:quoteId
 * - PATCH  /api/v1/workspaces/:workspaceId/quotations/:quoteId
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/send
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/accept
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/refuse
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/revoke
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/revise
 * - POST   /api/v1/workspaces/:workspaceId/quotations/:quoteId/follow-ups/dispatch
 *
 * And token-verified recipient portal handlers:
 * - GET    /api/v1/public/quotations/:token
 * - POST   /api/v1/public/quotations/:token/accept
 * - POST   /api/v1/public/quotations/:token/refuse
 */

import type { D1Database } from '../../db/d1.ts';
import type { Env, WorkspaceAuthContext } from '../../types.ts';
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
  internalErrorResponse,
} from '../problem.ts';
import { StructuredLogger } from '../logger.ts';

export interface QuoteEmailDispatchRequest {
  workspaceId: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  category:
    | 'QUOTE_SENT'
    | 'QUOTE_FOLLOW_UP_STAGE_1'
    | 'QUOTE_FOLLOW_UP_STAGE_2'
    | 'QUOTE_ACCEPTED'
    | 'QUOTE_REFUSED'
    | 'QUOTE_REVOKED';
  referenceId: string;
  requestId: string;
}

export interface QuoteEmailDispatchResult {
  deliveryId: string;
  status: 'SENT' | 'QUEUED' | 'SANDBOX_LOGGED' | 'FAILED' | 'UNCERTAIN';
  transport: string;
  error?: string;
}

export type QuoteEmailDispatcher = (req: QuoteEmailDispatchRequest) => Promise<QuoteEmailDispatchResult>;

export interface QuotationsHandlerOptions {
  emailDispatcher?: QuoteEmailDispatcher;
  now?: () => Date;
}

export interface QuotationLineItemInput {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
}

export interface QuotationLineItemRecord {
  id: string;
  line_order: number;
  description: string;
  quantity: number;
  unit_price_cents: number;
  unit_price: number;
  total_cents: number;
  total: number;
}

export interface QuotationFollowUpRecord {
  id: string;
  quote_id: string;
  stage: 'STAGE_1_COURTESY' | 'STAGE_2_EXPIRY';
  scheduled_date: string;
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED';
  sent_at: string | null;
  channel: string;
  email_delivery_id: string | null;
}

export interface QuotationEventRecord {
  id: string;
  quote_id: string;
  event_type: string;
  actor_user_id: string | null;
  actor_name: string;
  request_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface QuotationResponse {
  id: string;
  workspace_id: string;
  job_id: string;
  customer_id: string | null;
  brand_id: string;
  external_myob_ref: string | null;
  title: string;
  subtotal_cents: number;
  gst_cents: number;
  total_cents: number;
  subtotal: number;
  gst: number;
  total: number;
  terms_template_id: string | null;
  terms_revision_id: string | null;
  terms_version: string | null;
  terms_content_snapshot: string | null;
  frozen_issuer_snapshot: string | null;
  acceptance_status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REFUSED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  issued_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  refused_at: string | null;
  refusal_reason: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  supersedes_quote_id: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  line_items: QuotationLineItemRecord[];
  follow_ups: QuotationFollowUpRecord[];
  events: QuotationEventRecord[];
}

const BUSINESS_OFFSET_MS = 10 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const QLD_STATEWIDE_HOLIDAYS = new Set<string>([
  // 2026
  '2026-01-01', '2026-01-26', '2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-04-25', '2026-05-04', '2026-10-05', '2026-12-25', '2026-12-26', '2026-12-28',
  // 2027
  '2027-01-01', '2027-01-26', '2027-03-26', '2027-03-27', '2027-03-28', '2027-03-29',
  '2027-04-25', '2027-04-26', '2027-05-03', '2027-10-04', '2027-12-25', '2027-12-26', '2027-12-27', '2027-12-28',
  // 2028
  '2028-01-01', '2028-01-03', '2028-01-26', '2028-04-14', '2028-04-15', '2028-04-16', '2028-04-17',
  '2028-04-25', '2028-05-01', '2028-10-02', '2028-12-25', '2028-12-26',
]);

const REGIONAL_SHOW_HOLIDAYS: Record<string, Set<string>> = {
  brisbane: new Set(['2026-08-12', '2027-08-11', '2028-08-16']),
  gold_coast: new Set(['2026-08-28', '2027-08-27', '2028-09-01']),
};

export const sandboxQuoteEmailDispatcher: QuoteEmailDispatcher = async req => ({
  deliveryId: `sandbox_email_${crypto.randomUUID()}`,
  status: 'SANDBOX_LOGGED',
  transport: `sandbox_simulated:${req.category}`,
});

function serializeBusinessInstant(date: Date): string {
  return new Date(date.getTime() + BUSINESS_OFFSET_MS).toISOString().replace(/Z$/, '+10:00');
}

function addDaysInstant(isoWithOffset: string, days: number): string {
  const ts = Date.parse(isoWithOffset);
  return serializeBusinessInstant(new Date(ts + days * DAY_MS));
}

function isBusinessDay(ymd: string, region: string): boolean {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = dt.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (QLD_STATEWIDE_HOLIDAYS.has(ymd)) return false;
  return !(REGIONAL_SHOW_HOLIDAYS[region]?.has(ymd));
}

function addBusinessDays(startYmd: string, days: number, region: string): string {
  let [year, month, day] = startYmd.split('-').map(Number);
  let added = 0;
  let current = startYmd;
  while (added < days) {
    const next = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
    current = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isBusinessDay(current, region)) added++;
  }
  return current;
}

function calculateFollowUpDates(issuedAt: string, expiresAt: string, region: string): { stage1Date: string; stage2Date: string } {
  const issuedYmd = issuedAt.split('T', 1)[0];
  const expiresYmd = expiresAt.split('T', 1)[0];
  const stage1Date = addBusinessDays(issuedYmd, 3, region);
  let stage2Date = addBusinessDays(issuedYmd, 7, region);
  if (stage2Date >= expiresYmd) {
    let prev = expiresYmd;
    for (let i = 0; i < 7; i++) {
      const [y, m, d] = prev.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d - 1, 12, 0, 0));
      prev = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
      if (isBusinessDay(prev, region)) {
        stage2Date = prev;
        break;
      }
    }
  }
  return { stage1Date, stage2Date };
}

function amountToCents(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e11) {
    throw new RangeError('Amount out of supported currency range');
  }
  const scaled = Math.round(amount * 100);
  if (Math.abs(scaled - amount * 100) > 1e-6) {
    throw new RangeError('Amount must have at most 2 decimal places');
  }
  return BigInt(scaled);
}

function roundedLineTotalCents(quantity: number, unitPriceCents: bigint): bigint {
  // Support fractional quantities up to 4 decimal places with half-up rounding
  const qtyScaled = BigInt(Math.round(quantity * 10000));
  if (qtyScaled <= 0n || Math.abs(Number(qtyScaled) - quantity * 10000) > 1e-4) {
    throw new RangeError('Quantity must be positive with at most 4 decimal places');
  }
  const numerator = qtyScaled * unitPriceCents;
  return (numerator + 5000n) / 10000n;
}

function validateAndComputeLineItems(rawItems: unknown): {
  valid: boolean;
  error?: string;
  items?: Array<{ id: string; description: string; quantity: number; unitPriceCents: number; totalCents: number }>;
  subtotalCents?: number;
  gstCents?: number;
  totalCents?: number;
} {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 200) {
    return { valid: false, error: 'At least one line item (up to 200) is required' };
  }

  const computed: Array<{ id: string; description: string; quantity: number; unitPriceCents: number; totalCents: number }> = [];
  let subtotalBig = 0n;

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { valid: false, error: `Line item ${i + 1} must be an object` };
    }
    const rec = item as Record<string, unknown>;
    const description = typeof rec.description === 'string' ? rec.description.trim() : '';
    const quantity = typeof rec.quantity === 'number' ? rec.quantity : Number.NaN;
    const unitPrice = typeof rec.unit_price === 'number' ? rec.unit_price : (typeof rec.unitPrice === 'number' ? rec.unitPrice : Number.NaN);

    if (!description || description.length > 500) {
      return { valid: false, error: `Line item ${i + 1} description must be 1..500 characters` };
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { valid: false, error: `Line item ${i + 1} quantity must be a positive number` };
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return { valid: false, error: `Line item ${i + 1} unit_price must be a non-negative number` };
    }

    try {
      const unitPriceCents = amountToCents(unitPrice);
      const totalCents = roundedLineTotalCents(quantity, unitPriceCents);
      subtotalBig += totalCents;
      const itemId = typeof rec.id === 'string' && rec.id.trim() ? rec.id.trim().slice(0, 64) : `ITEM-${String(i + 1).padStart(2, '0')}`;
      computed.push({
        id: itemId,
        description,
        quantity,
        unitPriceCents: Number(unitPriceCents),
        totalCents: Number(totalCents),
      });
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Invalid line item pricing' };
    }
  }

  // Half-up 10% GST on integer cents
  const gstBig = (subtotalBig + 5n) / 10n;
  const totalBig = subtotalBig + gstBig;
  if (totalBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { valid: false, error: 'Quotation total exceeds maximum representable currency range' };
  }

  return {
    valid: true,
    items: computed,
    subtotalCents: Number(subtotalBig),
    gstCents: Number(gstBig),
    totalCents: Number(totalBig),
  };
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function recordQuotationEvent(
  db: D1Database,
  workspaceId: string,
  quoteId: string,
  eventType: string,
  actorUserId: string | null,
  actorName: string,
  requestId: string,
  details: Record<string, unknown> | null,
  createdAt: string
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      `qevt_${crypto.randomUUID()}`,
      workspaceId,
      quoteId,
      eventType,
      actorUserId,
      actorName,
      requestId,
      details ? JSON.stringify(details) : null,
      createdAt
    )
    .run();
}

function classifyDispatchFailure(err: unknown): { status: 'FAILED' | 'UNCERTAIN'; error: string } {
  const error = err instanceof Error ? err.message : String(err);
  const isUncertain = /timeout|timed out|abort|uncertain/i.test(error);
  return { status: isUncertain ? 'UNCERTAIN' : 'FAILED', error };
}

async function dispatchQuoteEmail(params: {
  db: D1Database;
  emailDispatcher: QuoteEmailDispatcher;
  workspaceId: string;
  quoteId: string;
  externalMyobRef: string | null;
  title: string;
  expiresAt: string;
  recipientEmail: string;
  rawToken: string;
  reqOrigin: string;
  actorUserId: string;
  actorName: string;
  requestId: string;
  nowIso: string;
}): Promise<QuoteEmailDispatchResult> {
  const portalUrl = `${params.reqOrigin}/?quote_token=${encodeURIComponent(params.rawToken)}`;
  const apiUrl = `${params.reqOrigin}/api/v1/public/quotations/${encodeURIComponent(params.rawToken)}`;

  let dispatch: QuoteEmailDispatchResult;
  try {
    dispatch = await params.emailDispatcher({
      workspaceId: params.workspaceId,
      to: params.recipientEmail,
      subject: `Quotation ${params.externalMyobRef || params.quoteId}: ${params.title}`,
      textBody: [
        `Please review and accept or refuse your quotation (${params.title}) before ${params.expiresAt}.`,
        `Customer Acceptance Link: ${portalUrl}`,
        `Public Quotation API: ${apiUrl}`,
      ].join('\n'),
      category: 'QUOTE_SENT',
      referenceId: params.quoteId,
      requestId: params.requestId,
    });
  } catch (err) {
    const classified = classifyDispatchFailure(err);
    dispatch = {
      deliveryId: '',
      status: classified.status,
      transport: 'dispatcher_error',
      error: classified.error,
    };
  }

  const eventType =
    dispatch.status === 'FAILED'
      ? 'EMAIL_DISPATCH_FAILED'
      : dispatch.status === 'UNCERTAIN'
        ? 'EMAIL_DISPATCH_UNCERTAIN'
        : 'EMAIL_DISPATCHED';

  await recordQuotationEvent(
    params.db,
    params.workspaceId,
    params.quoteId,
    eventType,
    params.actorUserId,
    params.actorName,
    params.requestId,
    {
      category: 'QUOTE_SENT',
      delivery_id: dispatch.deliveryId || null,
      status: dispatch.status,
      transport: dispatch.transport,
      recipient_email: params.recipientEmail,
      ...(dispatch.error ? { error: dispatch.error } : {}),
    },
    params.nowIso
  );

  return dispatch;
}

async function inspectQuoteEmailHistory(
  db: D1Database,
  workspaceId: string,
  quoteId: string
): Promise<{
  hasSucceededDispatch: boolean;
  lastFailedOrUncertainRecipient: string | null;
  hasFailedOrUncertain: boolean;
}> {
  const rows = await db
    .prepare(
      `SELECT event_type, details_json
       FROM quotation_events
       WHERE quote_id = ? AND workspace_id = ?
         AND event_type IN ('EMAIL_DISPATCHED', 'EMAIL_DISPATCH_FAILED', 'EMAIL_DISPATCH_UNCERTAIN')
       ORDER BY created_at DESC, rowid DESC`
    )
    .bind(quoteId, workspaceId)
    .all<{ event_type: string; details_json: string | null }>();

  let hasSucceededDispatch = false;
  let hasFailedOrUncertain = false;
  let lastFailedOrUncertainRecipient: string | null = null;

  for (const row of rows.results) {
    let details: Record<string, unknown> | null = null;
    try {
      details = row.details_json ? (JSON.parse(row.details_json) as Record<string, unknown>) : null;
    } catch {
      details = null;
    }
    const status = typeof details?.status === 'string' ? details.status : '';
    if (
      row.event_type === 'EMAIL_DISPATCHED' &&
      (status === 'SENT' || status === 'SANDBOX_LOGGED' || status === 'QUEUED')
    ) {
      hasSucceededDispatch = true;
    } else if (
      row.event_type === 'EMAIL_DISPATCH_FAILED' ||
      row.event_type === 'EMAIL_DISPATCH_UNCERTAIN' ||
      status === 'FAILED' ||
      status === 'UNCERTAIN'
    ) {
      hasFailedOrUncertain = true;
      if (!lastFailedOrUncertainRecipient && typeof details?.recipient_email === 'string') {
        lastFailedOrUncertainRecipient = details.recipient_email;
      }
    }
  }

  return { hasSucceededDispatch, hasFailedOrUncertain, lastFailedOrUncertainRecipient };
}

async function expireQuoteIfNeeded(
  db: D1Database,
  row: Record<string, unknown>,
  nowIso: string,
  requestId: string
): Promise<Record<string, unknown>> {
  if (
    row.acceptance_status === 'SENT' &&
    typeof row.expires_at === 'string' &&
    Date.parse(nowIso) >= Date.parse(row.expires_at)
  ) {
    const expectedVersion = Number(row.version);
    const res = await db
      .prepare(
        `UPDATE quotations
         SET acceptance_status = 'EXPIRED', version = version + 1, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
      )
      .bind(nowIso, row.id, row.workspace_id, expectedVersion)
      .run();
    if (res.meta.changes > 0) {
      await db
        .prepare(
          `UPDATE quotation_follow_ups
           SET status = 'CANCELLED', updated_at = ?
           WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'`
        )
        .bind(nowIso, row.id, row.workspace_id)
        .run();
      await recordQuotationEvent(
        db,
        String(row.workspace_id),
        String(row.id),
        'EXPIRED',
        null,
        'System',
        requestId,
        { expires_at: row.expires_at },
        nowIso
      );
      return { ...row, acceptance_status: 'EXPIRED', updated_at: nowIso, version: expectedVersion + 1 };
    }
    const latest = await db
      .prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`)
      .bind(row.id, row.workspace_id)
      .first<Record<string, unknown>>();
    if (latest) return latest;
  }
  return row;
}

async function hydrateQuotation(db: D1Database, row: Record<string, unknown>): Promise<QuotationResponse> {
  const quoteId = String(row.id);
  const workspaceId = String(row.workspace_id);

  const [itemsRes, followUpsRes, eventsRes] = await Promise.all([
    db
      .prepare(
        `SELECT id, line_order, description, quantity, unit_price_cents, total_cents
         FROM quotation_line_items
         WHERE quote_id = ? AND workspace_id = ?
         ORDER BY line_order ASC`
      )
      .bind(quoteId, workspaceId)
      .all<{
        id: string;
        line_order: number;
        description: string;
        quantity: number;
        unit_price_cents: number;
        total_cents: number;
      }>(),
    db
      .prepare(
        `SELECT id, quote_id, stage, scheduled_date, status, sent_at, channel, email_delivery_id
         FROM quotation_follow_ups
         WHERE quote_id = ? AND workspace_id = ?
         ORDER BY stage ASC`
      )
      .bind(quoteId, workspaceId)
      .all<QuotationFollowUpRecord>(),
    db
      .prepare(
        `SELECT id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at
         FROM quotation_events
         WHERE quote_id = ? AND workspace_id = ?
         ORDER BY created_at ASC`
      )
      .bind(quoteId, workspaceId)
      .all<{
        id: string;
        quote_id: string;
        event_type: string;
        actor_user_id: string | null;
        actor_name: string;
        request_id: string | null;
        details_json: string | null;
        created_at: string;
      }>(),
  ]);

  const subtotalCents = Number(row.subtotal_cents);
  const gstCents = Number(row.gst_cents);
  const totalCents = Number(row.total_cents);

  return {
    id: quoteId,
    workspace_id: workspaceId,
    job_id: String(row.job_id),
    customer_id: (row.customer_id as string | null) ?? null,
    brand_id: String(row.brand_id),
    external_myob_ref: (row.external_myob_ref as string | null) ?? null,
    title: String(row.title),
    subtotal_cents: subtotalCents,
    gst_cents: gstCents,
    total_cents: totalCents,
    subtotal: subtotalCents / 100,
    gst: gstCents / 100,
    total: totalCents / 100,
    terms_template_id: (row.terms_template_id as string | null) ?? null,
    terms_revision_id: (row.terms_revision_id as string | null) ?? null,
    terms_version: (row.terms_version as string | null) ?? null,
    terms_content_snapshot: (row.terms_content_snapshot as string | null) ?? null,
    frozen_issuer_snapshot: (row.frozen_issuer_snapshot as string | null) ?? null,
    acceptance_status: row.acceptance_status as QuotationResponse['acceptance_status'],
    issued_at: (row.issued_at as string | null) ?? null,
    expires_at: (row.expires_at as string | null) ?? null,
    accepted_at: (row.accepted_at as string | null) ?? null,
    accepted_by_name: (row.accepted_by_name as string | null) ?? null,
    refused_at: (row.refused_at as string | null) ?? null,
    refusal_reason: (row.refusal_reason as string | null) ?? null,
    revoked_at: (row.revoked_at as string | null) ?? null,
    revocation_reason: (row.revocation_reason as string | null) ?? null,
    supersedes_quote_id: (row.supersedes_quote_id as string | null) ?? null,
    version: Number(row.version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    line_items: itemsRes.results.map(item => ({
      ...item,
      unit_price: item.unit_price_cents / 100,
      total: item.total_cents / 100,
    })),
    follow_ups: followUpsRes.results,
    events: eventsRes.results.map(evt => ({
      id: evt.id,
      quote_id: evt.quote_id,
      event_type: evt.event_type,
      actor_user_id: evt.actor_user_id,
      actor_name: evt.actor_name,
      request_id: evt.request_id,
      details: evt.details_json ? (JSON.parse(evt.details_json) as Record<string, unknown>) : null,
      created_at: evt.created_at,
    })),
  };
}

function quoteTerminalConflict(status: string, requestId: string): Response {
  const map: Record<string, { code: string; detail: string }> = {
    DRAFT: { code: 'QUOTE_NOT_SENT', detail: 'Quotation must be sent before customer acceptance or refusal' },
    ACCEPTED: { code: 'ALREADY_ACCEPTED', detail: 'Quotation has already been accepted' },
    REFUSED: { code: 'QUOTE_REFUSED', detail: 'Quotation has already been refused' },
    REVOKED: { code: 'QUOTE_REVOKED', detail: 'Quotation link has been revoked by the office' },
    SUPERSEDED: { code: 'QUOTE_SUPERSEDED', detail: 'Quotation has been superseded by a newer revision' },
    EXPIRED: { code: 'QUOTE_EXPIRED', detail: 'Quotation has expired past its 14-day validity period' },
  };
  const info = map[status] ?? { code: 'CONFLICT', detail: `Action not permitted in ${status} state` };
  return createProblemResponse(409, info.code, 'conflict', 'Conflict', info.detail, requestId);
}

async function authorizeQuoteRole(
  db: D1Database,
  workspaceId: string,
  auth: WorkspaceAuthContext | { userId: string; email: string; displayName: string | null; providerId: string; providerSubjectId: string }
): Promise<WorkspaceAuthContext | null> {
  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership || membership.role === 'technician') return null;
  return membership;
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

function replyJson(value: unknown, requestId: string, status = 200): Response {
  return Response.json(value, { status, headers: { 'X-Request-Id': requestId } });
}

export async function handleQuotations(
  request: Request,
  env: Env,
  workspaceId: string,
  quoteId: string | undefined,
  action: string | undefined,
  requestId: string,
  authentication: AuthenticationService = productionAuthenticationService,
  options: QuotationsHandlerOptions = {}
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);
  const nowFn = options.now ?? (() => new Date());
  const nowIso = serializeBusinessInstant(nowFn());
  const emailDispatcher = options.emailDispatcher ?? sandboxQuoteEmailDispatcher;

  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) {
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeQuoteRole(env.DB, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'Quotation access denied for user or role', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have permission to manage quotations in this workspace', requestId);
  }

  const actorName = auth.displayName || auth.email;
  const url = new URL(request.url);

  try {
    // Collection routes: /quotations
    if (!quoteId) {
      if (request.method === 'GET') {
        const jobIdFilter = url.searchParams.get('job_id');
        const statusFilter = url.searchParams.get('status');
        let sql = `SELECT * FROM quotations WHERE workspace_id = ?`;
        const params: unknown[] = [workspaceId];
        if (jobIdFilter) {
          sql += ` AND job_id = ?`;
          params.push(jobIdFilter);
        }
        if (statusFilter) {
          sql += ` AND acceptance_status = ?`;
          params.push(statusFilter);
        }
        sql += ` ORDER BY created_at DESC, CASE WHEN acceptance_status = 'SUPERSEDED' THEN 1 ELSE 0 END ASC, rowid DESC`;
        const rows = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
        const hydrated: QuotationResponse[] = [];
        for (const r of rows.results) {
          const updated = await expireQuoteIfNeeded(env.DB, r, nowIso, requestId);
          hydrated.push(await hydrateQuotation(env.DB, updated));
        }
        return replyJson({ quotations: hydrated }, requestId);
      }

      if (request.method === 'POST') {
        const body = await parseJsonObject(request);
        if (!body) return validationErrorResponse('Invalid JSON payload', [], requestId);

        const jobId = typeof body.job_id === 'string' ? body.job_id.trim() : '';
        const title = typeof body.title === 'string' ? body.title.trim() : '';
        const customerId = typeof body.customer_id === 'string' && body.customer_id.trim() ? body.customer_id.trim() : null;
        const brandId = typeof body.brand_id === 'string' && body.brand_id.trim() ? body.brand_id.trim() : workspaceId;
        const externalMyobRef =
          typeof body.external_myob_ref === 'string' && body.external_myob_ref.trim()
            ? body.external_myob_ref.trim()
            : `MYOB-Q-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

        if (!jobId) {
          return validationErrorResponse('job_id is required', [{ pointer: '/job_id', code: 'REQUIRED', message: 'job_id is required' }], requestId);
        }
        if (!title || title.length > 200) {
          return validationErrorResponse('title is required (1..200 chars)', [{ pointer: '/title', code: 'INVALID', message: 'title is required' }], requestId);
        }

        const calc = validateAndComputeLineItems(body.line_items);
        if (!calc.valid || !calc.items) {
          return validationErrorResponse(calc.error || 'Invalid line items', [{ pointer: '/line_items', code: 'INVALID', message: calc.error || 'Invalid line items' }], requestId);
        }

        // Re-verify membership right before write
        if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
          return accessDeniedResponse('Permission changed', requestId);
        }

        const newQuoteId = `QUOTE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
        const stmts = [
          env.DB.prepare(
            `INSERT INTO quotations (
              id, workspace_id, job_id, customer_id, brand_id, external_myob_ref, title,
              subtotal_cents, gst_cents, total_cents, acceptance_status, version,
              created_by, updated_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, ?, ?, ?, ?)`
          ).bind(
            newQuoteId,
            workspaceId,
            jobId,
            customerId,
            brandId,
            externalMyobRef,
            title,
            calc.subtotalCents!,
            calc.gstCents!,
            calc.totalCents!,
            auth.userId,
            auth.userId,
            nowIso,
            nowIso
          ),
          ...calc.items.map((item, idx) =>
            env.DB.prepare(
              `INSERT INTO quotation_line_items (
                id, workspace_id, quote_id, line_order, description, quantity, unit_price_cents, total_cents
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              `${newQuoteId}:${item.id}:${idx}`,
              workspaceId,
              newQuoteId,
              idx,
              item.description,
              item.quantity,
              item.unitPriceCents,
              item.totalCents
            )
          ),
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             VALUES (?, ?, ?, 'CREATED', ?, ?, ?, ?, ?)`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            newQuoteId,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({ job_id: jobId, total_cents: calc.totalCents }),
            nowIso
          ),
        ];

        await env.DB.batch(stmts);
        const created = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(newQuoteId, workspaceId).first<Record<string, unknown>>();
        return replyJson({ quotation: await hydrateQuotation(env.DB, created!) }, requestId, 201);
      }

      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only GET and POST are supported on quotations collection', requestId, undefined, undefined, { Allow: 'GET, POST' });
    }

    // Single quotation routes: /quotations/:quoteId[/action]
    const existingRow = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
    if (!existingRow) {
      return resourceNotFoundResponse('Quotation not found', requestId);
    }
    const currentRow = await expireQuoteIfNeeded(env.DB, existingRow, nowIso, requestId);

    if (!action) {
      if (request.method === 'GET') {
        return replyJson({ quotation: await hydrateQuotation(env.DB, currentRow) }, requestId);
      }

      if (request.method === 'PATCH') {
        if (currentRow.acceptance_status !== 'DRAFT') {
          return createProblemResponse(
            409,
            'QUOTE_IMMUTABLE',
            'conflict',
            'Conflict',
            `Cannot edit quotation in ${currentRow.acceptance_status} state; create a revision instead.`,
            requestId
          );
        }

        const body = await parseJsonObject(request);
        if (!body) return validationErrorResponse('Invalid JSON payload', [], requestId);

        const nextTitle = typeof body.title === 'string' ? body.title.trim() : String(currentRow.title);
        if (!nextTitle || nextTitle.length > 200) {
          return validationErrorResponse('title must be 1..200 chars', [{ pointer: '/title', code: 'INVALID', message: 'Invalid title' }], requestId);
        }

        const nextCustomerId = body.customer_id !== undefined
          ? (typeof body.customer_id === 'string' && body.customer_id.trim() ? body.customer_id.trim() : null)
          : (currentRow.customer_id as string | null);
        const nextMyobRef = body.external_myob_ref !== undefined
          ? (typeof body.external_myob_ref === 'string' && body.external_myob_ref.trim() ? body.external_myob_ref.trim() : null)
          : (currentRow.external_myob_ref as string | null);

        let calc: ReturnType<typeof validateAndComputeLineItems> | null = null;
        if (body.line_items !== undefined) {
          calc = validateAndComputeLineItems(body.line_items);
          if (!calc.valid || !calc.items) {
            return validationErrorResponse(calc.error || 'Invalid line items', [{ pointer: '/line_items', code: 'INVALID', message: calc.error || 'Invalid line items' }], requestId);
          }
        }

        if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
          return accessDeniedResponse('Permission changed', requestId);
        }

        const stmts = [
          env.DB.prepare(
            `UPDATE quotations
             SET title = ?, customer_id = ?, external_myob_ref = ?,
                 subtotal_cents = COALESCE(?, subtotal_cents),
                 gst_cents = COALESCE(?, gst_cents),
                 total_cents = COALESCE(?, total_cents),
                 version = version + 1, updated_by = ?, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND acceptance_status = 'DRAFT'`
          ).bind(
            nextTitle,
            nextCustomerId,
            nextMyobRef,
            calc ? calc.subtotalCents! : null,
            calc ? calc.gstCents! : null,
            calc ? calc.totalCents! : null,
            auth.userId,
            nowIso,
            quoteId,
            workspaceId
          ),
        ];

        if (calc?.items) {
          stmts.push(
            env.DB.prepare(`DELETE FROM quotation_line_items WHERE quote_id = ? AND workspace_id = ?`).bind(quoteId, workspaceId)
          );
          for (let idx = 0; idx < calc.items.length; idx++) {
            const item = calc.items[idx];
            stmts.push(
              env.DB.prepare(
                `INSERT INTO quotation_line_items (
                  id, workspace_id, quote_id, line_order, description, quantity, unit_price_cents, total_cents
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(`${quoteId}:${item.id}:${idx}`, workspaceId, quoteId, idx, item.description, item.quantity, item.unitPriceCents, item.totalCents)
            );
          }
        }

        stmts.push(
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             VALUES (?, ?, ?, 'EDITED', ?, ?, ?, ?, ?)`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            quoteId,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({ updated_line_items: Boolean(calc?.items) }),
            nowIso
          )
        );

        await env.DB.batch(stmts);
        const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
        return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
      }

      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only GET and PATCH are supported on quotation resource', requestId, undefined, undefined, { Allow: 'GET, PATCH' });
    }

    if (request.method !== 'POST') {
      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only POST is supported for quotation actions', requestId, undefined, undefined, { Allow: 'POST' });
    }

    const body = (await parseJsonObject(request)) ?? {};

    // Action: send (freezes immutable Terms snapshot + Issuer snapshot + schedules follow-ups + generates token)
    // and Action: resend (recoverable email re-dispatch for an already-SENT quote)
    if (action === 'send' || action === 'resend') {
      const hasRecipientField = Object.prototype.hasOwnProperty.call(body, 'recipient_email');
      const recipientEmailInput = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
      if (hasRecipientField && (!recipientEmailInput || !EMAIL_REGEX.test(recipientEmailInput))) {
        return validationErrorResponse('Invalid recipient_email', [{ pointer: '/recipient_email', code: 'INVALID', message: 'Invalid email address' }], requestId);
      }

      if (currentRow.acceptance_status === 'DRAFT') {
        if (action === 'resend') {
          return quoteTerminalConflict('DRAFT', requestId);
        }

        const requestedRevisionId = typeof body.terms_revision_id === 'string' && body.terms_revision_id.trim()
          ? body.terms_revision_id.trim()
          : null;

        const termsRow = requestedRevisionId
          ? await env.DB.prepare(
              `SELECT dt.id AS template_id, tr.id AS revision_id, tr.version, tr.content
               FROM template_revisions tr
               JOIN document_templates dt ON dt.id = tr.template_id
               WHERE dt.workspace_id = ? AND dt.template_type = 'QUOTE_TERMS' AND tr.id = ? AND tr.status = 'PUBLISHED'`
            ).bind(workspaceId, requestedRevisionId).first<{ template_id: string; revision_id: string; version: string; content: string }>()
          : await env.DB.prepare(
              `SELECT dt.id AS template_id, tr.id AS revision_id, tr.version, tr.content
               FROM document_templates dt
               JOIN template_revisions tr ON tr.id = dt.current_revision_id OR (tr.template_id = dt.id AND tr.status = 'PUBLISHED')
               WHERE dt.workspace_id = ? AND dt.template_type = 'QUOTE_TERMS' AND tr.status = 'PUBLISHED'
               ORDER BY tr.approved_at DESC, tr.created_at DESC
               LIMIT 1`
            ).bind(workspaceId).first<{ template_id: string; revision_id: string; version: string; content: string }>();

        if (!termsRow) {
          return validationErrorResponse(
            'A published QUOTE_TERMS template revision is required before sending a quotation',
            [{ pointer: '/terms_revision_id', code: 'TERMS_REVISION_REQUIRED', message: 'No published QUOTE_TERMS revision found for workspace' }],
            requestId
          );
        }

        const issuerRow = await env.DB.prepare(
          `SELECT li.legal_issuer_name, li.abn, li.electrical_licence, li.qbcc_licence, ws.holiday_region, ws.trading_name
           FROM workspaces w
           LEFT JOIN legal_issuers li ON li.workspace_id = w.id
           LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
           WHERE w.id = ?`
        ).bind(workspaceId).first<{
          legal_issuer_name: string | null;
          abn: string | null;
          electrical_licence: string | null;
          qbcc_licence: string | null;
          holiday_region: string | null;
          trading_name: string | null;
        }>();

        const issuerParts = [
          issuerRow?.legal_issuer_name || issuerRow?.trading_name || workspaceId,
          issuerRow?.abn ? `ABN ${issuerRow.abn}` : null,
          issuerRow?.electrical_licence ? `Elec Lic ${issuerRow.electrical_licence}` : null,
          issuerRow?.qbcc_licence ? `QBCC ${issuerRow.qbcc_licence}` : null,
        ].filter(Boolean);
        const frozenIssuerSnapshot = issuerParts.join(' • ');
        const holidayRegion = issuerRow?.holiday_region === 'gold_coast' ? 'gold_coast' : 'brisbane';

        const expiresAt = addDaysInstant(nowIso, 14);
        const { stage1Date, stage2Date } = calculateFollowUpDates(nowIso, expiresAt, holidayRegion);

        const rawToken = `qtok_${crypto.randomUUID().replace(/-/g, '')}`;
        const tokenHash = await sha256Hex(rawToken);

        if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
          return accessDeniedResponse('Permission changed', requestId);
        }

        const expectedVersion = Number(currentRow.version);
        const nextVersion = expectedVersion + 1;

        const batchRes = await env.DB.batch([
          env.DB.prepare(
            `UPDATE quotations
             SET acceptance_status = 'SENT',
                 terms_template_id = ?,
                 terms_revision_id = ?,
                 terms_version = ?,
                 terms_content_snapshot = ?,
                 frozen_issuer_snapshot = ?,
                 acceptance_token_hash = ?,
                 issued_at = ?,
                 expires_at = ?,
                 version = version + 1,
                 updated_by = ?,
                 updated_at = ?
             WHERE id = ? AND workspace_id = ? AND acceptance_status = 'DRAFT' AND version = ?`
          ).bind(
            termsRow.template_id,
            termsRow.revision_id,
            termsRow.version,
            termsRow.content,
            frozenIssuerSnapshot,
            tokenHash,
            nowIso,
            expiresAt,
            auth.userId,
            nowIso,
            quoteId,
            workspaceId,
            expectedVersion
          ),
          env.DB.prepare(
            `INSERT INTO quotation_follow_ups (id, workspace_id, quote_id, stage, scheduled_date, status, channel, created_at, updated_at)
             SELECT ?, ?, ?, 'STAGE_1_COURTESY', ?, 'SCHEDULED', 'EMAIL_SIMULATED', ?, ?
             WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SENT')
               AND NOT EXISTS (SELECT 1 FROM quotation_follow_ups WHERE quote_id = ? AND stage = 'STAGE_1_COURTESY')`
          ).bind(`qfu_${quoteId}_1`, workspaceId, quoteId, stage1Date, nowIso, nowIso, quoteId, workspaceId, nextVersion, quoteId),
          env.DB.prepare(
            `INSERT INTO quotation_follow_ups (id, workspace_id, quote_id, stage, scheduled_date, status, channel, created_at, updated_at)
             SELECT ?, ?, ?, 'STAGE_2_EXPIRY', ?, 'SCHEDULED', 'EMAIL_SIMULATED', ?, ?
             WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SENT')
               AND NOT EXISTS (SELECT 1 FROM quotation_follow_ups WHERE quote_id = ? AND stage = 'STAGE_2_EXPIRY')`
          ).bind(`qfu_${quoteId}_2`, workspaceId, quoteId, stage2Date, nowIso, nowIso, quoteId, workspaceId, nextVersion, quoteId),
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             SELECT ?, ?, ?, 'SENT', ?, ?, ?, ?, ?
             WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SENT')
               AND NOT EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND event_type = 'SENT')`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            quoteId,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({ terms_version: termsRow.version, terms_revision_id: termsRow.revision_id, expires_at: expiresAt }),
            nowIso,
            quoteId,
            workspaceId,
            nextVersion,
            quoteId
          ),
        ]);

        if (batchRes[0].meta.changes !== 1) {
          return createProblemResponse(409, 'QUOTE_ALREADY_SENT', 'conflict', 'Conflict', 'Quotation is no longer in DRAFT state', requestId);
        }

        let emailDispatch: QuoteEmailDispatchResult | null = null;
        if (recipientEmailInput) {
          emailDispatch = await dispatchQuoteEmail({
            db: env.DB,
            emailDispatcher,
            workspaceId,
            quoteId,
            externalMyobRef: (currentRow.external_myob_ref as string | null) ?? null,
            title: String(currentRow.title),
            expiresAt,
            recipientEmail: recipientEmailInput,
            rawToken,
            reqOrigin: new URL(request.url).origin,
            actorUserId: auth.userId,
            actorName,
            requestId,
            nowIso,
          });
        }

        const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
        return replyJson({
          quotation: await hydrateQuotation(env.DB, refreshed!),
          acceptance_token: rawToken,
          email_dispatch: emailDispatch,
        }, requestId);
      }

      if (currentRow.acceptance_status === 'SENT') {
        const emailHistory = await inspectQuoteEmailHistory(env.DB, workspaceId, quoteId);

        if (action === 'send') {
          if (emailHistory.hasSucceededDispatch) {
            return createProblemResponse(409, 'QUOTE_ALREADY_SENT', 'conflict', 'Conflict', 'Quotation in SENT state has already been dispatched', requestId);
          }
          if (!emailHistory.hasFailedOrUncertain && !recipientEmailInput) {
            return createProblemResponse(409, 'QUOTE_ALREADY_SENT', 'conflict', 'Conflict', 'Quotation in SENT state cannot be sent again', requestId);
          }
        }

        const targetRecipient = recipientEmailInput || emailHistory.lastFailedOrUncertainRecipient || '';
        if (!targetRecipient || !EMAIL_REGEX.test(targetRecipient)) {
          return validationErrorResponse(
            'A valid recipient_email is required to resend this quotation',
            [{ pointer: '/recipient_email', code: 'INVALID', message: 'Valid recipient_email is required' }],
            requestId
          );
        }

        if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
          return accessDeniedResponse('Permission changed', requestId);
        }

        const rawToken = `qtok_${crypto.randomUUID().replace(/-/g, '')}`;
        const tokenHash = await sha256Hex(rawToken);
        const expectedVersion = Number(currentRow.version);

        const rotateRes = await env.DB
          .prepare(
            `UPDATE quotations
             SET acceptance_token_hash = ?, version = version + 1, updated_by = ?, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
          )
          .bind(tokenHash, auth.userId, nowIso, quoteId, workspaceId, expectedVersion)
          .run();

        if (rotateRes.meta.changes !== 1) {
          const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
          return quoteTerminalConflict(String(latest?.acceptance_status ?? 'CONFLICT'), requestId);
        }

        const emailDispatch = await dispatchQuoteEmail({
          db: env.DB,
          emailDispatcher,
          workspaceId,
          quoteId,
          externalMyobRef: (currentRow.external_myob_ref as string | null) ?? null,
          title: String(currentRow.title),
          expiresAt: String(currentRow.expires_at ?? ''),
          recipientEmail: targetRecipient,
          rawToken,
          reqOrigin: new URL(request.url).origin,
          actorUserId: auth.userId,
          actorName,
          requestId,
          nowIso,
        });

        const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
        return replyJson({
          quotation: await hydrateQuotation(env.DB, refreshed!),
          acceptance_token: rawToken,
          email_dispatch: emailDispatch,
        }, requestId);
      }

      if (action === 'send') {
        return createProblemResponse(409, 'QUOTE_ALREADY_SENT', 'conflict', 'Conflict', `Quotation in ${currentRow.acceptance_status} state cannot be sent`, requestId);
      }
      return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
    }

    // Action: accept
    if (action === 'accept') {
      if (currentRow.acceptance_status !== 'SENT') {
        return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
      }
      const acceptedByName = typeof body.accepted_by_name === 'string' && body.accepted_by_name.trim()
        ? body.accepted_by_name.trim().slice(0, 120)
        : actorName;

      if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
        return accessDeniedResponse('Permission changed', requestId);
      }

      const expectedVersion = Number(currentRow.version);
      const res = await env.DB.prepare(
        `UPDATE quotations
         SET acceptance_status = 'ACCEPTED', accepted_at = ?, accepted_by_name = ?, version = version + 1, updated_by = ?, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
      ).bind(nowIso, acceptedByName, auth.userId, nowIso, quoteId, workspaceId, expectedVersion).run();

      if (res.meta.changes === 0) {
        const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
        return quoteTerminalConflict(String(latest?.acceptance_status ?? 'ACCEPTED'), requestId);
      }

      await env.DB.batch([
        env.DB.prepare(
          `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
           WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'`
        ).bind(nowIso, quoteId, workspaceId),
        env.DB.prepare(
          `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
           VALUES (?, ?, ?, 'ACCEPTED', ?, ?, ?, ?, ?)`
        ).bind(`qevt_${crypto.randomUUID()}`, workspaceId, quoteId, auth.userId, acceptedByName, requestId, JSON.stringify({ accepted_by_name: acceptedByName }), nowIso),
      ]);

      const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
      return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
    }

    // Action: refuse
    if (action === 'refuse') {
      if (currentRow.acceptance_status !== 'SENT') {
        return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
      }
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (!reason || reason.length > 500) {
        return validationErrorResponse('Refusal reason is required (1..500 chars)', [{ pointer: '/reason', code: 'REQUIRED', message: 'reason is required' }], requestId);
      }

      if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
        return accessDeniedResponse('Permission changed', requestId);
      }

      const expectedVersion = Number(currentRow.version);
      const nextVersion = expectedVersion + 1;
      const batchRes = await env.DB.batch([
        env.DB.prepare(
          `UPDATE quotations
           SET acceptance_status = 'REFUSED', refused_at = ?, refusal_reason = ?, version = version + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
        ).bind(nowIso, reason, auth.userId, nowIso, quoteId, workspaceId, expectedVersion),
        env.DB.prepare(
          `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
           WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'
             AND EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REFUSED')`
        ).bind(nowIso, quoteId, workspaceId, quoteId, workspaceId, nextVersion),
        env.DB.prepare(
          `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
           SELECT ?, ?, ?, 'REFUSED', ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REFUSED')
             AND NOT EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND event_type = 'REFUSED')`
        ).bind(`qevt_${crypto.randomUUID()}`, workspaceId, quoteId, auth.userId, actorName, requestId, JSON.stringify({ reason }), nowIso, quoteId, workspaceId, nextVersion, quoteId, workspaceId),
      ]);

      if (batchRes[0].meta.changes !== 1) {
        const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
        return quoteTerminalConflict(String(latest?.acceptance_status ?? 'CONFLICT'), requestId);
      }

      const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
      return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
    }

    // Action: revoke
    if (action === 'revoke') {
      if (currentRow.acceptance_status !== 'DRAFT' && currentRow.acceptance_status !== 'SENT') {
        return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
      }
      const reason = typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : 'Revoked by office administration';

      if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
        return accessDeniedResponse('Permission changed', requestId);
      }

      const expectedVersion = Number(currentRow.version);
      const nextVersion = expectedVersion + 1;
      const batchRes = await env.DB.batch([
        env.DB.prepare(
          `UPDATE quotations
           SET acceptance_status = 'REVOKED', revoked_at = ?, revocation_reason = ?, version = version + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND acceptance_status IN ('DRAFT', 'SENT') AND version = ?`
        ).bind(nowIso, reason, auth.userId, nowIso, quoteId, workspaceId, expectedVersion),
        env.DB.prepare(
          `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
           WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'
             AND EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REVOKED')`
        ).bind(nowIso, quoteId, workspaceId, quoteId, workspaceId, nextVersion),
        env.DB.prepare(
          `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
           SELECT ?, ?, ?, 'REVOKED', ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REVOKED')
             AND NOT EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND event_type = 'REVOKED')`
        ).bind(`qevt_${crypto.randomUUID()}`, workspaceId, quoteId, auth.userId, actorName, requestId, JSON.stringify({ reason }), nowIso, quoteId, workspaceId, nextVersion, quoteId, workspaceId),
      ]);

      if (batchRes[0].meta.changes !== 1) {
        const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
        return quoteTerminalConflict(String(latest?.acceptance_status ?? 'CONFLICT'), requestId);
      }

      const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
      return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
    }

    // Action: revise (supersedes SENT/EXPIRED/REFUSED quote and opens a new DRAFT)
    if (action === 'revise') {
      if (!['SENT', 'EXPIRED', 'REFUSED'].includes(String(currentRow.acceptance_status))) {
        return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
      }

      const existingItems = await env.DB
        .prepare(`SELECT id, description, quantity, unit_price_cents, total_cents FROM quotation_line_items WHERE quote_id = ? AND workspace_id = ? ORDER BY line_order ASC`)
        .bind(quoteId, workspaceId)
        .all<{ id: string; description: string; quantity: number; unit_price_cents: number; total_cents: number }>();

      const newTitle = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : String(currentRow.title);
      const calc = body.line_items !== undefined
        ? validateAndComputeLineItems(body.line_items)
        : validateAndComputeLineItems(
            existingItems.results.map(i => ({
              id: i.id,
              description: i.description,
              quantity: i.quantity,
              unit_price: i.unit_price_cents / 100,
            }))
          );

      if (!calc.valid || !calc.items) {
        return validationErrorResponse(calc.error || 'Invalid line items', [], requestId);
      }

      if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
        return accessDeniedResponse('Permission changed', requestId);
      }

      const expectedVersion = Number(currentRow.version);
      const nextVersion = expectedVersion + 1;
      const revisedQuoteId = `QUOTE-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;

      const batchRes = await env.DB.batch([
        env.DB.prepare(
          `UPDATE quotations
           SET acceptance_status = 'SUPERSEDED', version = version + 1, updated_by = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status IN ('SENT', 'EXPIRED', 'REFUSED')`
        ).bind(auth.userId, nowIso, quoteId, workspaceId, expectedVersion),
        env.DB.prepare(
          `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
           SELECT ?, ?, ?, 'SUPERSEDED', ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SUPERSEDED')
             AND NOT EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND event_type = 'SUPERSEDED')`
        ).bind(
          `qevt_${crypto.randomUUID()}`,
          workspaceId,
          quoteId,
          auth.userId,
          actorName,
          requestId,
          JSON.stringify({ superseded_by: revisedQuoteId }),
          nowIso,
          quoteId,
          workspaceId,
          nextVersion,
          quoteId,
          workspaceId
        ),
        env.DB.prepare(
          `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
           WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'
             AND EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND request_id = ? AND event_type = 'SUPERSEDED')`
        ).bind(nowIso, quoteId, workspaceId, quoteId, workspaceId, requestId),
        env.DB.prepare(
          `INSERT INTO quotations (
            id, workspace_id, job_id, customer_id, brand_id, external_myob_ref, title,
            subtotal_cents, gst_cents, total_cents, acceptance_status, supersedes_quote_id,
            version, created_by, updated_by, created_at, updated_at
          )
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, 1, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SUPERSEDED')
            AND EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND request_id = ? AND event_type = 'SUPERSEDED')`
        ).bind(
          revisedQuoteId,
          workspaceId,
          currentRow.job_id,
          currentRow.customer_id,
          currentRow.brand_id,
          currentRow.external_myob_ref,
          newTitle,
          calc.subtotalCents!,
          calc.gstCents!,
          calc.totalCents!,
          quoteId,
          auth.userId,
          auth.userId,
          nowIso,
          nowIso,
          quoteId,
          workspaceId,
          nextVersion,
          quoteId,
          workspaceId,
          requestId
        ),
        ...calc.items.map((item, idx) =>
          env.DB.prepare(
            `INSERT INTO quotation_line_items (
              id, workspace_id, quote_id, line_order, description, quantity, unit_price_cents, total_cents
            )
            SELECT ?, ?, ?, ?, ?, ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SUPERSEDED')
              AND EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND request_id = ? AND event_type = 'SUPERSEDED')`
          ).bind(
            `${revisedQuoteId}:${item.id}:${idx}`,
            workspaceId,
            revisedQuoteId,
            idx,
            item.description,
            item.quantity,
            item.unitPriceCents,
            item.totalCents,
            quoteId,
            workspaceId,
            nextVersion,
            quoteId,
            workspaceId,
            requestId
          )
        ),
        env.DB.prepare(
          `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
           SELECT ?, ?, ?, 'CREATED', ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'SUPERSEDED')
             AND EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND request_id = ? AND event_type = 'SUPERSEDED')`
        ).bind(
          `qevt_${crypto.randomUUID()}`,
          workspaceId,
          revisedQuoteId,
          auth.userId,
          actorName,
          requestId,
          JSON.stringify({ supersedes_quote_id: quoteId }),
          nowIso,
          quoteId,
          workspaceId,
          nextVersion,
          quoteId,
          workspaceId,
          requestId
        ),
      ]);

      if (batchRes[0].meta.changes !== 1) {
        const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
        return quoteTerminalConflict(String(latest?.acceptance_status ?? 'CONFLICT'), requestId);
      }

      const revised = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(revisedQuoteId, workspaceId).first<Record<string, unknown>>();
      return replyJson({ quotation: await hydrateQuotation(env.DB, revised!) }, requestId, 201);
    }

    // Action: follow-ups/dispatch
    if (action === 'follow-ups/dispatch') {
      if (currentRow.acceptance_status !== 'SENT') {
        return quoteTerminalConflict(String(currentRow.acceptance_status), requestId);
      }
      const stage = body.stage === 'STAGE_2_EXPIRY' ? 'STAGE_2_EXPIRY' : 'STAGE_1_COURTESY';
      const recipientEmail = typeof body.recipient_email === 'string' ? body.recipient_email.trim() : '';
      if (!recipientEmail || !EMAIL_REGEX.test(recipientEmail)) {
        return validationErrorResponse('A valid recipient_email is required to dispatch a follow-up', [{ pointer: '/recipient_email', code: 'INVALID', message: 'Valid email required' }], requestId);
      }

      if (!(await authorizeQuoteRole(env.DB, workspaceId, auth))) {
        return accessDeniedResponse('Permission changed', requestId);
      }

      const fu = await env.DB
        .prepare(`SELECT * FROM quotation_follow_ups WHERE quote_id = ? AND workspace_id = ? AND stage = ?`)
        .bind(quoteId, workspaceId, stage)
        .first<QuotationFollowUpRecord>();

      if (!fu) return resourceNotFoundResponse('Follow-up stage not found', requestId);
      if (fu.status !== 'SCHEDULED') {
        return createProblemResponse(409, 'FOLLOW_UP_NOT_SCHEDULED', 'conflict', 'Conflict', `Follow-up ${stage} is already ${fu.status}`, requestId);
      }

      const claimToken = `CLAIM:${requestId}`;
      const claimRes = await env.DB
        .prepare(
          `UPDATE quotation_follow_ups
           SET email_delivery_id = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND status = 'SCHEDULED' AND email_delivery_id IS NULL`
        )
        .bind(claimToken, nowIso, fu.id, workspaceId)
        .run();

      if (claimRes.meta.changes !== 1) {
        return createProblemResponse(
          409,
          'FOLLOW_UP_NOT_SCHEDULED',
          'conflict',
          'Conflict',
          `Follow-up ${stage} is already claimed, awaiting reconciliation, or no longer SCHEDULED`,
          requestId
        );
      }

      let dispatch: QuoteEmailDispatchResult;
      try {
        dispatch = await emailDispatcher({
          workspaceId,
          to: recipientEmail,
          subject:
            stage === 'STAGE_1_COURTESY'
              ? `Courtesy Follow-Up: Quotation ${currentRow.external_myob_ref || quoteId}`
              : `Expiry Warning: Quotation ${currentRow.external_myob_ref || quoteId} expires ${currentRow.expires_at}`,
          textBody: `Reminder regarding quotation "${currentRow.title}" (valid until ${currentRow.expires_at}).`,
          category: stage === 'STAGE_1_COURTESY' ? 'QUOTE_FOLLOW_UP_STAGE_1' : 'QUOTE_FOLLOW_UP_STAGE_2',
          referenceId: fu.id,
          requestId,
        });
      } catch (err) {
        const classified = classifyDispatchFailure(err);
        dispatch = {
          deliveryId: '',
          status: classified.status,
          transport: 'dispatcher_error',
          error: classified.error,
        };
      }

      if (dispatch.status === 'SENT' || dispatch.status === 'SANDBOX_LOGGED') {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE quotation_follow_ups
             SET status = 'SENT', sent_at = ?, email_delivery_id = ?, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND status = 'SCHEDULED' AND email_delivery_id = ?`
          ).bind(nowIso, dispatch.deliveryId, nowIso, fu.id, workspaceId, claimToken),
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             SELECT ?, ?, ?, 'FOLLOW_UP_SENT', ?, ?, ?, ?, ?
             WHERE EXISTS (
               SELECT 1 FROM quotation_follow_ups
               WHERE id = ? AND workspace_id = ? AND status = 'SENT' AND email_delivery_id = ?
             )`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            quoteId,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({ stage, delivery_id: dispatch.deliveryId, status: dispatch.status, transport: dispatch.transport, recipient_email: recipientEmail }),
            nowIso,
            fu.id,
            workspaceId,
            dispatch.deliveryId
          ),
        ]);
      } else if (dispatch.status === 'FAILED') {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE quotation_follow_ups
             SET status = 'SCHEDULED', sent_at = NULL, email_delivery_id = NULL, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND status = 'SCHEDULED' AND email_delivery_id = ?`
          ).bind(nowIso, fu.id, workspaceId, claimToken),
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             VALUES (?, ?, ?, 'FOLLOW_UP_FAILED', ?, ?, ?, ?, ?)`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            quoteId,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({
              stage,
              delivery_id: dispatch.deliveryId || null,
              status: 'FAILED',
              transport: dispatch.transport,
              recipient_email: recipientEmail,
              ...(dispatch.error ? { error: dispatch.error } : {}),
            }),
            nowIso
          ),
        ]);
      } else {
        // UNCERTAIN or QUEUED: keep status = 'SCHEDULED' and preserve deliveryId/lock so it cannot double-send
        const nonNullRef = dispatch.deliveryId || `${dispatch.status}:${requestId}`;
        const eventType = dispatch.status === 'UNCERTAIN' ? 'FOLLOW_UP_UNCERTAIN' : 'FOLLOW_UP_QUEUED';
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE quotation_follow_ups
             SET status = 'SCHEDULED', sent_at = NULL, email_delivery_id = ?, updated_at = ?
             WHERE id = ? AND workspace_id = ? AND status = 'SCHEDULED' AND email_delivery_id = ?`
          ).bind(nonNullRef, nowIso, fu.id, workspaceId, claimToken),
          env.DB.prepare(
            `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            `qevt_${crypto.randomUUID()}`,
            workspaceId,
            quoteId,
            eventType,
            auth.userId,
            actorName,
            requestId,
            JSON.stringify({
              stage,
              delivery_id: dispatch.deliveryId || null,
              status: dispatch.status,
              transport: dispatch.transport,
              recipient_email: recipientEmail,
              ...(dispatch.error ? { error: dispatch.error } : {}),
            }),
            nowIso
          ),
        ]);
      }

      const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
      return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!), email_dispatch: dispatch }, requestId);
    }

    return resourceNotFoundResponse('Unsupported quotation action', requestId);
  } catch (error) {
    logger.error('QUOTATIONS_ERROR', 'Unexpected error handling quotation request', {
      fields: { error: error instanceof Error ? error.message : String(error) },
    });
    return internalErrorResponse('An unexpected error occurred while processing the quotation request', requestId);
  }
}

export async function handlePublicQuotationToken(
  request: Request,
  env: Env,
  token: string,
  action: 'accept' | 'refuse' | undefined,
  requestId: string,
  options: QuotationsHandlerOptions = {}
): Promise<Response> {
  const nowFn = options.now ?? (() => new Date());
  const nowIso = serializeBusinessInstant(nowFn());

  if (!token || token.length < 12) {
    return resourceNotFoundResponse('Invalid acceptance token', requestId);
  }

  const tokenHash = await sha256Hex(token);
  const existing = await env.DB
    .prepare(`SELECT * FROM quotations WHERE acceptance_token_hash = ?`)
    .bind(tokenHash)
    .first<Record<string, unknown>>();

  if (!existing) {
    return resourceNotFoundResponse('Invalid or unknown acceptance token', requestId);
  }

  const current = await expireQuoteIfNeeded(env.DB, existing, nowIso, requestId);
  const workspaceId = String(current.workspace_id);
  const quoteId = String(current.id);

  if (!action) {
    if (request.method !== 'GET') {
      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only GET is supported', requestId, undefined, undefined, { Allow: 'GET' });
    }
    return replyJson({ quotation: await hydrateQuotation(env.DB, current) }, requestId);
  }

  if (request.method !== 'POST') {
    return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only POST is supported', requestId, undefined, undefined, { Allow: 'POST' });
  }

  if (current.acceptance_status !== 'SENT') {
    return quoteTerminalConflict(String(current.acceptance_status), requestId);
  }

  const body = (await parseJsonObject(request)) ?? {};

  if (action === 'accept') {
    if (body.confirmed !== true) {
      return validationErrorResponse('Customer acceptance confirmation is required', [{ pointer: '/confirmed', code: 'REQUIRED', message: 'confirmed must be true' }], requestId);
    }
    const acceptedByName = typeof body.accepted_by_name === 'string' && body.accepted_by_name.trim()
      ? body.accepted_by_name.trim().slice(0, 120)
      : 'Customer (Recipient Portal)';

    const expectedVersion = Number(current.version);
    const res = await env.DB.prepare(
      `UPDATE quotations
       SET acceptance_status = 'ACCEPTED', accepted_at = ?, accepted_by_name = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
    ).bind(nowIso, acceptedByName, nowIso, quoteId, workspaceId, expectedVersion).run();

    if (res.meta.changes === 0) {
      const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
      return quoteTerminalConflict(String(latest?.acceptance_status ?? 'ACCEPTED'), requestId);
    }

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
         WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'`
      ).bind(nowIso, quoteId, workspaceId),
      env.DB.prepare(
        `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
         VALUES (?, ?, ?, 'ACCEPTED', NULL, ?, ?, ?, ?)`
      ).bind(`qevt_${crypto.randomUUID()}`, workspaceId, quoteId, acceptedByName, requestId, JSON.stringify({ via: 'public_token' }), nowIso),
    ]);

    const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
    return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
  }

  if (action === 'refuse') {
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason || reason.length > 500) {
      return validationErrorResponse('Refusal reason is required (1..500 chars)', [{ pointer: '/reason', code: 'REQUIRED', message: 'reason is required' }], requestId);
    }

    const expectedVersion = Number(current.version);
    const nextVersion = expectedVersion + 1;
    const batchRes = await env.DB.batch([
      env.DB.prepare(
        `UPDATE quotations
         SET acceptance_status = 'REFUSED', refused_at = ?, refusal_reason = ?, version = version + 1, updated_at = ?
         WHERE id = ? AND workspace_id = ? AND acceptance_status = 'SENT' AND version = ?`
      ).bind(nowIso, reason, nowIso, quoteId, workspaceId, expectedVersion),
      env.DB.prepare(
        `UPDATE quotation_follow_ups SET status = 'CANCELLED', updated_at = ?
         WHERE quote_id = ? AND workspace_id = ? AND status = 'SCHEDULED'
           AND EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REFUSED')`
      ).bind(nowIso, quoteId, workspaceId, quoteId, workspaceId, nextVersion),
      env.DB.prepare(
        `INSERT INTO quotation_events (id, workspace_id, quote_id, event_type, actor_user_id, actor_name, request_id, details_json, created_at)
         SELECT ?, ?, ?, 'REFUSED', NULL, 'Customer (Recipient Portal)', ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM quotations WHERE id = ? AND workspace_id = ? AND version = ? AND acceptance_status = 'REFUSED')
           AND NOT EXISTS (SELECT 1 FROM quotation_events WHERE quote_id = ? AND workspace_id = ? AND event_type = 'REFUSED')`
      ).bind(`qevt_${crypto.randomUUID()}`, workspaceId, quoteId, requestId, JSON.stringify({ via: 'public_token', reason }), nowIso, quoteId, workspaceId, nextVersion, quoteId, workspaceId),
    ]);

    if (batchRes[0].meta.changes !== 1) {
      const latest = await env.DB.prepare(`SELECT acceptance_status FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<{ acceptance_status: string }>();
      return quoteTerminalConflict(String(latest?.acceptance_status ?? 'CONFLICT'), requestId);
    }

    const refreshed = await env.DB.prepare(`SELECT * FROM quotations WHERE id = ? AND workspace_id = ?`).bind(quoteId, workspaceId).first<Record<string, unknown>>();
    return replyJson({ quotation: await hydrateQuotation(env.DB, refreshed!) }, requestId);
  }

  return resourceNotFoundResponse('Unsupported action', requestId);
}
