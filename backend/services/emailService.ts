/**
 * CABMS Shared Email Delivery & Review Lifecycle Service
 *
 * Cloudflare Workers-compatible shared email service supporting:
 * 1. Live HTTPS Relay transport (fetch-based, e.g. Resend/Postmark/MailChannels-style JSON relay)
 * 2. Live SMTP over TCP transport (via cloudflare:sockets when available in Workers)
 * 3. Deterministic SANDBOX_SYNTHETIC fallback when live credentials are absent
 *
 * Security invariants:
 * - Credentials (EMAIL_RELAY_API_KEY, SMTP_USER, SMTP_PASS) are read ONLY from server-side Env.
 * - Credentials are NEVER returned to clients or persisted in D1/audit logs.
 * - All audit payloads and error messages pass through strict redaction.
 * - All operations are strictly scoped to workspace_id.
 */

import type { D1Database } from '../db/d1.ts';
import type { Env } from '../types.ts';

export type EmailTransportMode = 'SANDBOX_SYNTHETIC' | 'HTTPS_RELAY' | 'SMTP_TCP';
export type EmailDeliveryStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'UNCERTAIN';
export type EmailCategory =
  | 'TEST_EMAIL'
  | 'REVIEW_REQUEST'
  | 'CERTIFICATE'
  | 'REMINDER'
  | 'QUOTE'
  | 'ENQUIRY_REPLY'
  | 'GENERAL';

export type ReviewRequestStatus = 'NOT_SENT' | 'PENDING' | 'SENT' | 'FAILED' | 'UNCERTAIN';

export interface EmailEnv extends Env {
  EMAIL_RELAY_URL?: string;
  EMAIL_RELAY_API_KEY?: string;
  SMTP_HOST?: string;
  SMTP_PORT?: string;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  EMAIL_SANDBOX_ONLY?: string;
  EMAIL_FETCH_OVERRIDE?: typeof fetch;
}

export interface EmailTransportStatus {
  mode: EmailTransportMode;
  is_synthetic: boolean;
  configured_providers: EmailTransportMode[];
  reason: string;
}

export interface SenderIdentity {
  workspace_id: string;
  sender_name: string;
  sender_email: string;
  reply_to_email: string | null;
  review_url: string | null;
  is_synthetic_sender: boolean;
}

export interface SendEmailInput {
  workspaceId: string;
  category: EmailCategory;
  toEmail: string;
  toName?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  jobId?: string | null;
  actorUserId?: string | null;
  requestId: string;
  fromEmailOverride?: string;
  fromNameOverride?: string;
  /** Honored ONLY in SANDBOX_SYNTHETIC mode for deterministic failure/timeout testing */
  simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN';
}

export interface SendTestEmailInput {
  workspaceId: string;
  toEmail: string;
  toName?: string | null;
  subject?: string;
  actorUserId: string;
  requestId: string;
  simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN';
}

export interface EmailDeliveryRecord {
  id: string;
  workspace_id: string;
  category: EmailCategory;
  job_id: string | null;
  recipient_email: string;
  recipient_name: string | null;
  sender_name: string;
  sender_email: string;
  reply_to_email: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  transport_mode: EmailTransportMode;
  status: EmailDeliveryStatus;
  provider_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempt_count: number;
  last_attempt_at: string;
  sent_at: string | null;
  created_by_user_id: string | null;
  request_id: string;
  created_at: string;
  updated_at: string;
}

export interface EmailAuditEventRecord {
  id: string;
  workspace_id: string;
  delivery_id: string | null;
  event_type: string;
  transport_mode: EmailTransportMode;
  actor_user_id: string | null;
  request_id: string;
  details_json: string;
  created_at: string;
}

export interface ReviewRequestRecord {
  id: string;
  workspace_id: string;
  job_id: string;
  recipient_email: string;
  recipient_name: string | null;
  review_url: string | null;
  status: ReviewRequestStatus;
  delivery_id: string | null;
  uncertain_reconciliation_needed: number;
  attempt_count: number;
  last_error: string | null;
  reconciled_by_user_id: string | null;
  reconciled_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailDeliveryResult {
  delivery: EmailDeliveryRecord;
  transport_mode: EmailTransportMode;
  is_synthetic: boolean;
  audit_event_id: string;
}

export interface DispatchReviewRequestInput {
  workspaceId: string;
  jobId: string;
  recipientEmail: string;
  recipientName?: string | null;
  siteAddress?: string | null;
  technicianName?: string | null;
  actorUserId: string;
  requestId: string;
  simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN';
}

export interface DispatchReviewResult {
  deduplicated: boolean;
  reason: string;
  review_request: ReviewRequestRecord;
  delivery: EmailDeliveryRecord | null;
  transport_mode: EmailTransportMode;
  is_synthetic: boolean;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const SENSITIVE_KEY_PATTERN = /(pass|secret|token|key|auth|credential|cookie|bearer)/i;
const REDACTED = '[REDACTED]';

export function isValidEmailAddress(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
}

/**
 * Redacts any credential-like keys or bearer tokens from audit/error strings.
 */
export function redactEmailText(input: string): string {
  return input
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/(password|secret|token|api_key|apikey|smtp_pass)\s*[:=]\s*\S+/gi, `$1=${REDACTED}`)
    .slice(0, 500);
}

export function redactEmailAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(details)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = REDACTED;
    } else if (typeof val === 'string') {
      out[key] = redactEmailText(val);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = redactEmailAuditDetails(val as Record<string, unknown>);
    } else {
      out[key] = val;
    }
  }
  return out;
}

/**
 * Determines the active email transport mode from server-side Env without exposing secrets.
 */
export function getTransportStatus(env?: EmailEnv): EmailTransportStatus {
  const configured: EmailTransportMode[] = [];
  const forceSandbox = env?.EMAIL_SANDBOX_ONLY === '1' || env?.EMAIL_SANDBOX_ONLY === 'true';

  const hasHttpsRelay = Boolean(env?.EMAIL_RELAY_URL?.trim() && env?.EMAIL_RELAY_API_KEY?.trim());
  const hasSmtp = Boolean(env?.SMTP_HOST?.trim() && env?.SMTP_USER?.trim() && env?.SMTP_PASS?.trim());

  if (hasHttpsRelay) configured.push('HTTPS_RELAY');
  if (hasSmtp) configured.push('SMTP_TCP');
  configured.push('SANDBOX_SYNTHETIC');

  if (forceSandbox) {
    return {
      mode: 'SANDBOX_SYNTHETIC',
      is_synthetic: true,
      configured_providers: configured,
      reason: 'EMAIL_SANDBOX_ONLY is enabled; using deterministic sandbox/synthetic transport.',
    };
  }
  if (hasHttpsRelay) {
    return {
      mode: 'HTTPS_RELAY',
      is_synthetic: false,
      configured_providers: configured,
      reason: 'Server-side HTTPS email relay credentials are configured.',
    };
  }
  if (hasSmtp) {
    return {
      mode: 'SMTP_TCP',
      is_synthetic: false,
      configured_providers: configured,
      reason: 'Server-side SMTP credentials are configured (Workers cloudflare:sockets).',
    };
  }
  return {
    mode: 'SANDBOX_SYNTHETIC',
    is_synthetic: true,
    configured_providers: ['SANDBOX_SYNTHETIC'],
    reason: 'No live HTTPS relay or SMTP credentials configured; using sandbox/synthetic transport.',
  };
}

/**
 * Resolves business-specific sender identity from workspace_settings & workspaces.
 */
export async function resolveSenderIdentity(
  db: D1Database,
  workspaceId: string,
  overrides?: { fromEmail?: string; fromName?: string }
): Promise<SenderIdentity> {
  const row = await db
    .prepare(
      `SELECT w.name AS workspace_name, w.slug AS workspace_slug,
              ws.trading_name, ws.contact_email, ws.review_url
       FROM workspaces w
       LEFT JOIN workspace_settings ws ON ws.workspace_id = w.id
       WHERE w.id = ?`
    )
    .bind(workspaceId)
    .first<{
      workspace_name: string;
      workspace_slug: string;
      trading_name: string | null;
      contact_email: string | null;
      review_url: string | null;
    }>();

  const slug = row?.workspace_slug || workspaceId.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'workspace';
  const senderName = (overrides?.fromName?.trim() || row?.trading_name?.trim() || row?.workspace_name?.trim() || 'CABMS Workspace');
  const configuredEmail = overrides?.fromEmail?.trim() || row?.contact_email?.trim() || '';
  const hasValidConfigured = configuredEmail.length > 0 && isValidEmailAddress(configuredEmail);
  const senderEmail = hasValidConfigured ? configuredEmail : `noreply@${slug}.cabms-demo.invalid`;

  return {
    workspace_id: workspaceId,
    sender_name: senderName,
    sender_email: senderEmail,
    reply_to_email: hasValidConfigured ? configuredEmail : null,
    review_url: row?.review_url || null,
    is_synthetic_sender: !hasValidConfigured,
  };
}

interface TransportDispatchOutcome {
  status: 'SENT' | 'FAILED' | 'UNCERTAIN';
  providerMessageId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

async function dispatchViaHttpsRelay(
  env: EmailEnv,
  payload: {
    fromName: string;
    fromEmail: string;
    replyTo: string | null;
    toEmail: string;
    toName: string | null;
    subject: string;
    bodyText: string;
    bodyHtml: string | null;
    requestId: string;
  }
): Promise<TransportDispatchOutcome> {
  const relayUrl = env.EMAIL_RELAY_URL!.trim();
  const apiKey = env.EMAIL_RELAY_API_KEY!.trim();
  const fetchFn = env.EMAIL_FETCH_OVERRIDE ?? globalThis.fetch;

  try {
    const response = await fetchFn(relayUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Request-Id': payload.requestId,
      },
      body: JSON.stringify({
        from: `${payload.fromName} <${payload.fromEmail}>`,
        to: [payload.toName ? `${payload.toName} <${payload.toEmail}>` : payload.toEmail],
        reply_to: payload.replyTo || undefined,
        subject: payload.subject,
        text: payload.bodyText,
        html: payload.bodyHtml || undefined,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      let msgId = `relay_${crypto.randomUUID()}`;
      try {
        const json = (await response.json()) as { id?: string; message_id?: string };
        if (typeof json.id === 'string' && json.id) msgId = json.id;
        else if (typeof json.message_id === 'string' && json.message_id) msgId = json.message_id;
      } catch {
        // Non-JSON 2xx response is still accepted
      }
      return { status: 'SENT', providerMessageId: msgId, errorCode: null, errorMessage: null };
    }

    if (response.status === 504 || response.status === 408) {
      return {
        status: 'UNCERTAIN',
        providerMessageId: null,
        errorCode: `HTTP_${response.status}`,
        errorMessage: `HTTPS relay timed out with HTTP ${response.status}; delivery state uncertain.`,
      };
    }

    return {
      status: 'FAILED',
      providerMessageId: null,
      errorCode: `HTTP_${response.status}`,
      errorMessage: redactEmailText(`HTTPS relay rejected message with HTTP ${response.status}.`),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('abort');
    return {
      status: isTimeout ? 'UNCERTAIN' : 'FAILED',
      providerMessageId: null,
      errorCode: isTimeout ? 'RELAY_TIMEOUT' : 'RELAY_NETWORK_ERROR',
      errorMessage: redactEmailText(msg),
    };
  }
}

async function dispatchViaSmtpTcp(
  env: EmailEnv,
  payload: {
    fromName: string;
    fromEmail: string;
    toEmail: string;
    subject: string;
    bodyText: string;
  }
): Promise<TransportDispatchOutcome> {
  const host = env.SMTP_HOST!.trim();
  const port = Number.parseInt(env.SMTP_PORT || '587', 10) || 587;
  const user = env.SMTP_USER!.trim();
  const pass = env.SMTP_PASS!.trim();

  // Dynamic import of cloudflare:sockets so Node/Vite builds do not fail when not running in workerd.
  let connectFn: ((addr: { hostname: string; port: number }) => {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    close: () => Promise<void>;
  }) | null = null;

  try {
    // @ts-expect-error cloudflare:sockets is only resolved in Cloudflare Workers runtime
    const mod = await import('cloudflare:sockets');
    if (typeof mod?.connect === 'function') {
      connectFn = mod.connect;
    }
  } catch {
    connectFn = null;
  }

  if (!connectFn) {
    return {
      status: 'FAILED',
      providerMessageId: null,
      errorCode: 'SMTP_SOCKET_UNAVAILABLE',
      errorMessage: 'cloudflare:sockets is unavailable in this runtime; configure EMAIL_RELAY_URL for HTTPS relay or run in Cloudflare Workers.',
    };
  }

  const socket = connectFn({ hostname: host, port });
  const writer = socket.writable.getWriter();
  const reader = socket.readable.getReader();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const readLine = async (): Promise<string> => {
    let acc = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });
      const lines = acc.split(/\r?\n/);
      for (const line of lines) {
        if (/^\d{3} /.test(line)) return acc.trim();
      }
    }
    return acc.trim();
  };

  const sendCmd = async (cmd: string): Promise<string> => {
    await writer.write(encoder.encode(`${cmd}\r\n`));
    return readLine();
  };

  try {
    const greeting = await readLine();
    if (!greeting.startsWith('220')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_GREETING_ERROR', errorMessage: redactEmailText(greeting) };
    }
    const ehlo = await sendCmd(`EHLO cabms.workers.local`);
    if (!ehlo.startsWith('250')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_EHLO_ERROR', errorMessage: redactEmailText(ehlo) };
    }
    const authInit = await sendCmd('AUTH LOGIN');
    if (!authInit.startsWith('334')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_AUTH_ERROR', errorMessage: redactEmailText(authInit) };
    }
    await sendCmd(btoa(user));
    const authRes = await sendCmd(btoa(pass));
    if (!authRes.startsWith('235')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_AUTH_REJECTED', errorMessage: 'SMTP authentication failed' };
    }
    const mailFrom = await sendCmd(`MAIL FROM:<${payload.fromEmail}>`);
    if (!mailFrom.startsWith('250')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_MAIL_FROM_ERROR', errorMessage: redactEmailText(mailFrom) };
    }
    const rcptTo = await sendCmd(`RCPT TO:<${payload.toEmail}>`);
    if (!rcptTo.startsWith('250')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_RCPT_ERROR', errorMessage: redactEmailText(rcptTo) };
    }
    const dataInit = await sendCmd('DATA');
    if (!dataInit.startsWith('354')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_DATA_ERROR', errorMessage: redactEmailText(dataInit) };
    }
    const messageId = `<${crypto.randomUUID()}@cabms.workers.local>`;
    const rawMsg = [
      `From: "${payload.fromName.replace(/"/g, '')}" <${payload.fromEmail}>`,
      `To: <${payload.toEmail}>`,
      `Subject: ${payload.subject}`,
      `Message-ID: ${messageId}`,
      `Content-Type: text/plain; charset=utf-8`,
      '',
      payload.bodyText.replace(/^\./gm, '..'),
      '.',
    ].join('\r\n');
    const dataDone = await sendCmd(rawMsg);
    await sendCmd('QUIT').catch(() => undefined);

    if (!dataDone.startsWith('250')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_SEND_ERROR', errorMessage: redactEmailText(dataDone) };
    }
    return { status: 'SENT', providerMessageId: messageId, errorCode: null, errorMessage: null };
  } catch (err) {
    return {
      status: 'UNCERTAIN',
      providerMessageId: null,
      errorCode: 'SMTP_IO_ERROR',
      errorMessage: redactEmailText(err instanceof Error ? err.message : String(err)),
    };
  } finally {
    try { writer.releaseLock(); } catch { /* ignore */ }
    try { reader.releaseLock(); } catch { /* ignore */ }
    try { await socket.close(); } catch { /* ignore */ }
  }
}

function dispatchViaSandboxSynthetic(simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN'): TransportDispatchOutcome {
  if (simulateOutcome === 'FAILED') {
    return {
      status: 'FAILED',
      providerMessageId: null,
      errorCode: 'SANDBOX_SMTP_550',
      errorMessage: 'Simulated sandbox failure: 550 Mailbox unavailable.',
    };
  }
  if (simulateOutcome === 'UNCERTAIN') {
    return {
      status: 'UNCERTAIN',
      providerMessageId: null,
      errorCode: 'SANDBOX_TIMEOUT_504',
      errorMessage: 'Simulated sandbox 504 gateway timeout; manual reconciliation required.',
    };
  }
  return {
    status: 'SENT',
    providerMessageId: `sandbox_${crypto.randomUUID()}`,
    errorCode: null,
    errorMessage: null,
  };
}

async function writeAuditEvent(
  db: D1Database,
  params: {
    workspaceId: string;
    deliveryId: string | null;
    eventType: string;
    transportMode: EmailTransportMode;
    actorUserId: string | null;
    requestId: string;
    details: Record<string, unknown>;
    now: string;
  }
): Promise<string> {
  const id = `ema_${crypto.randomUUID()}`;
  const safeJson = JSON.stringify(redactEmailAuditDetails(params.details));
  await db
    .prepare(
      `INSERT INTO email_delivery_audit_events (
        id, workspace_id, delivery_id, event_type, transport_mode,
        actor_user_id, request_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      params.workspaceId,
      params.deliveryId,
      params.eventType,
      params.transportMode,
      params.actorUserId,
      params.requestId,
      safeJson,
      params.now
    )
    .run();
  return id;
}

/**
 * Dispatches an email through the configured transport (or SANDBOX_SYNTHETIC fallback),
 * persists the delivery record, and logs a redacted audit event.
 */
export async function sendEmail(
  db: D1Database,
  env: EmailEnv | undefined,
  input: SendEmailInput
): Promise<EmailDeliveryResult> {
  const toEmail = input.toEmail.trim();
  if (!isValidEmailAddress(toEmail)) {
    throw new Error('Invalid recipient email address');
  }
  if (!input.subject.trim()) {
    throw new Error('Email subject is required');
  }
  if (!input.bodyText.trim()) {
    throw new Error('Email body is required');
  }

  const transport = getTransportStatus(env);
  const sender = await resolveSenderIdentity(db, input.workspaceId, {
    fromEmail: input.fromEmailOverride,
    fromName: input.fromNameOverride,
  });

  const now = new Date().toISOString();
  const deliveryId = `em_${crypto.randomUUID()}`;

  await db
    .prepare(
      `INSERT INTO email_deliveries (
        id, workspace_id, category, job_id, recipient_email, recipient_name,
        sender_name, sender_email, reply_to_email, subject, body_text, body_html,
        transport_mode, status, provider_message_id, error_code, error_message,
        attempt_count, last_attempt_at, sent_at, created_by_user_id, request_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', NULL, NULL, NULL, 1, ?, NULL, ?, ?, ?, ?)`
    )
    .bind(
      deliveryId,
      input.workspaceId,
      input.category,
      input.jobId ?? null,
      toEmail,
      input.toName?.trim() || null,
      sender.sender_name,
      sender.sender_email,
      sender.reply_to_email,
      input.subject.trim(),
      input.bodyText,
      input.bodyHtml ?? null,
      transport.mode,
      now,
      input.actorUserId ?? null,
      input.requestId,
      now,
      now
    )
    .run();

  let outcome: TransportDispatchOutcome;
  if (transport.mode === 'HTTPS_RELAY' && env) {
    outcome = await dispatchViaHttpsRelay(env, {
      fromName: sender.sender_name,
      fromEmail: sender.sender_email,
      replyTo: sender.reply_to_email,
      toEmail,
      toName: input.toName?.trim() || null,
      subject: input.subject.trim(),
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml ?? null,
      requestId: input.requestId,
    });
  } else if (transport.mode === 'SMTP_TCP' && env) {
    outcome = await dispatchViaSmtpTcp(env, {
      fromName: sender.sender_name,
      fromEmail: sender.sender_email,
      toEmail,
      subject: input.subject.trim(),
      bodyText: input.bodyText,
    });
  } else {
    outcome = dispatchViaSandboxSynthetic(input.simulateOutcome);
  }

  const finishedAt = new Date().toISOString();
  const sentAt = outcome.status === 'SENT' ? finishedAt : null;

  await db
    .prepare(
      `UPDATE email_deliveries
       SET status = ?, provider_message_id = ?, error_code = ?, error_message = ?,
           sent_at = ?, updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(
      outcome.status,
      outcome.providerMessageId,
      outcome.errorCode,
      outcome.errorMessage,
      sentAt,
      finishedAt,
      deliveryId,
      input.workspaceId
    )
    .run();

  const eventType =
    input.category === 'TEST_EMAIL'
      ? outcome.status === 'SENT'
        ? 'TEST_EMAIL_SENT'
        : 'TEST_EMAIL_FAILED'
      : outcome.status === 'SENT'
      ? 'EMAIL_SENT'
      : outcome.status === 'UNCERTAIN'
      ? 'EMAIL_UNCERTAIN'
      : 'EMAIL_FAILED';

  const auditEventId = await writeAuditEvent(db, {
    workspaceId: input.workspaceId,
    deliveryId,
    eventType,
    transportMode: transport.mode,
    actorUserId: input.actorUserId ?? null,
    requestId: input.requestId,
    details: {
      category: input.category,
      recipient_email: toEmail,
      sender_email: sender.sender_email,
      status: outcome.status,
      error_code: outcome.errorCode,
      error_message: outcome.errorMessage,
      is_synthetic: transport.is_synthetic,
    },
    now: finishedAt,
  });

  const delivery = await db
    .prepare(`SELECT * FROM email_deliveries WHERE id = ? AND workspace_id = ?`)
    .bind(deliveryId, input.workspaceId)
    .first<EmailDeliveryRecord>();

  if (!delivery) {
    throw new Error('Failed to load persisted email delivery record');
  }

  return {
    delivery,
    transport_mode: transport.mode,
    is_synthetic: transport.is_synthetic,
    audit_event_id: auditEventId,
  };
}

/**
 * Convenience helper for Settings & Communications test-email verification.
 */
export async function sendTestEmail(
  db: D1Database,
  env: EmailEnv | undefined,
  input: SendTestEmailInput
): Promise<EmailDeliveryResult> {
  const transport = getTransportStatus(env);
  const sender = await resolveSenderIdentity(db, input.workspaceId);
  const subject = input.subject?.trim() || `[${sender.sender_name}] CABMS Email Transport Verification (${transport.mode})`;
  const bodyText = [
    `CABMS Email Transport Verification`,
    `Business: ${sender.sender_name} (${input.workspaceId})`,
    `Sender: ${sender.sender_name} <${sender.sender_email}>`,
    `Transport Mode: ${transport.mode}${transport.is_synthetic ? ' (Sandbox/Synthetic — no external email sent)' : ' (Live)'}`,
    `Request Ref: ${input.requestId}`,
  ].join('\n');

  return sendEmail(db, env, {
    workspaceId: input.workspaceId,
    category: 'TEST_EMAIL',
    toEmail: input.toEmail,
    toName: input.toName,
    subject,
    bodyText,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    simulateOutcome: input.simulateOutcome,
  });
}

/**
 * Retries a FAILED email delivery within the same workspace.
 */
export async function retryEmailDelivery(
  db: D1Database,
  env: EmailEnv | undefined,
  workspaceId: string,
  deliveryId: string,
  actorUserId: string,
  requestId: string
): Promise<{ ok: true; result: EmailDeliveryResult } | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE'; message: string }> {
  const existing = await db
    .prepare(`SELECT * FROM email_deliveries WHERE id = ? AND workspace_id = ?`)
    .bind(deliveryId, workspaceId)
    .first<EmailDeliveryRecord>();

  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Email delivery record not found in this workspace.' };
  }
  if (existing.status !== 'FAILED') {
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `Only FAILED deliveries can be retried (current status: ${existing.status}).`,
    };
  }

  const transport = getTransportStatus(env);
  const now = new Date().toISOString();

  await writeAuditEvent(db, {
    workspaceId,
    deliveryId,
    eventType: 'EMAIL_RETRIED',
    transportMode: transport.mode,
    actorUserId,
    requestId,
    details: { previous_attempt_count: existing.attempt_count },
    now,
  });

  let outcome: TransportDispatchOutcome;
  if (transport.mode === 'HTTPS_RELAY' && env) {
    outcome = await dispatchViaHttpsRelay(env, {
      fromName: existing.sender_name,
      fromEmail: existing.sender_email,
      replyTo: existing.reply_to_email,
      toEmail: existing.recipient_email,
      toName: existing.recipient_name,
      subject: existing.subject,
      bodyText: existing.body_text,
      bodyHtml: existing.body_html,
      requestId,
    });
  } else if (transport.mode === 'SMTP_TCP' && env) {
    outcome = await dispatchViaSmtpTcp(env, {
      fromName: existing.sender_name,
      fromEmail: existing.sender_email,
      toEmail: existing.recipient_email,
      subject: existing.subject,
      bodyText: existing.body_text,
    });
  } else {
    outcome = dispatchViaSandboxSynthetic('SENT');
  }

  const finishedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE email_deliveries
       SET status = ?, transport_mode = ?, provider_message_id = ?, error_code = ?,
           error_message = ?, attempt_count = attempt_count + 1,
           last_attempt_at = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
       WHERE id = ? AND workspace_id = ?`
    )
    .bind(
      outcome.status,
      transport.mode,
      outcome.providerMessageId,
      outcome.errorCode,
      outcome.errorMessage,
      finishedAt,
      outcome.status === 'SENT' ? finishedAt : null,
      finishedAt,
      deliveryId,
      workspaceId
    )
    .run();

  const auditEventId = await writeAuditEvent(db, {
    workspaceId,
    deliveryId,
    eventType: outcome.status === 'SENT' ? 'EMAIL_SENT' : outcome.status === 'UNCERTAIN' ? 'EMAIL_UNCERTAIN' : 'EMAIL_FAILED',
    transportMode: transport.mode,
    actorUserId,
    requestId,
    details: {
      retry: true,
      status: outcome.status,
      error_code: outcome.errorCode,
      error_message: outcome.errorMessage,
    },
    now: finishedAt,
  });

  const updated = await db
    .prepare(`SELECT * FROM email_deliveries WHERE id = ? AND workspace_id = ?`)
    .bind(deliveryId, workspaceId)
    .first<EmailDeliveryRecord>();

  if (!updated) {
    throw new Error('Failed to reload retried delivery record');
  }

  return {
    ok: true,
    result: {
      delivery: updated,
      transport_mode: transport.mode,
      is_synthetic: transport.is_synthetic,
      audit_event_id: auditEventId,
    },
  };
}

export async function listEmailDeliveries(
  db: D1Database,
  workspaceId: string,
  options?: { category?: EmailCategory; status?: EmailDeliveryStatus; jobId?: string; limit?: number }
): Promise<EmailDeliveryRecord[]> {
  const conditions = ['workspace_id = ?'];
  const binds: unknown[] = [workspaceId];

  if (options?.category) {
    conditions.push('category = ?');
    binds.push(options.category);
  }
  if (options?.status) {
    conditions.push('status = ?');
    binds.push(options.status);
  }
  if (options?.jobId) {
    conditions.push('job_id = ?');
    binds.push(options.jobId);
  }

  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 200);
  binds.push(limit);

  const res = await db
    .prepare(`SELECT * FROM email_deliveries WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
    .bind(...binds)
    .all<EmailDeliveryRecord>();

  return res.results;
}

export async function listEmailAuditEvents(
  db: D1Database,
  workspaceId: string,
  deliveryId?: string,
  limit = 50
): Promise<EmailAuditEventRecord[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 200);
  if (deliveryId) {
    const res = await db
      .prepare(
        `SELECT * FROM email_delivery_audit_events
         WHERE workspace_id = ? AND delivery_id = ?
         ORDER BY created_at DESC LIMIT ?`
      )
      .bind(workspaceId, deliveryId, safeLimit)
      .all<EmailAuditEventRecord>();
    return res.results;
  }

  const res = await db
    .prepare(
      `SELECT * FROM email_delivery_audit_events
       WHERE workspace_id = ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .bind(workspaceId, safeLimit)
    .all<EmailAuditEventRecord>();
  return res.results;
}

/**
 * Dispatches a Google Review Request for a job, enforcing the Single Logical Request per Job Guard.
 */
export async function dispatchReviewRequest(
  db: D1Database,
  env: EmailEnv | undefined,
  input: DispatchReviewRequestInput
): Promise<DispatchReviewResult> {
  const transport = getTransportStatus(env);
  const existing = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(input.workspaceId, input.jobId)
    .first<ReviewRequestRecord>();

  if (existing && (existing.status === 'SENT' || existing.status === 'PENDING' || existing.status === 'UNCERTAIN')) {
    const now = new Date().toISOString();
    await writeAuditEvent(db, {
      workspaceId: input.workspaceId,
      deliveryId: existing.delivery_id,
      eventType: 'REVIEW_DEDUP_BLOCKED',
      transportMode: transport.mode,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      details: { job_id: input.jobId, existing_status: existing.status },
      now,
    });
    return {
      deduplicated: true,
      reason: `Review request already ${existing.status} for job ${input.jobId}; duplicate dispatch prevented.`,
      review_request: existing,
      delivery: null,
      transport_mode: transport.mode,
      is_synthetic: transport.is_synthetic,
    };
  }

  const sender = await resolveSenderIdentity(db, input.workspaceId);
  const reviewUrl = sender.review_url || `https://g.page/r/${input.workspaceId}-review/review`;
  const recipientName = input.recipientName?.trim() || 'Valued Customer';
  const subject = `How was your experience with ${sender.sender_name}?`;
  const bodyText = [
    `Hi ${recipientName},`,
    '',
    `Thank you for trusting ${sender.sender_name}${input.siteAddress ? ` with your service at ${input.siteAddress}` : ''}.`,
    `Our technician ${input.technicianName || 'our team'} has completed work order ${input.jobId}.`,
    `Share your experience on Google: ${reviewUrl}`,
  ].join('\n');

  const deliveryResult = await sendEmail(db, env, {
    workspaceId: input.workspaceId,
    category: 'REVIEW_REQUEST',
    jobId: input.jobId,
    toEmail: input.recipientEmail,
    toName: recipientName,
    subject,
    bodyText,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    simulateOutcome: input.simulateOutcome,
  });

  const now = new Date().toISOString();
  const nextStatus: ReviewRequestStatus =
    deliveryResult.delivery.status === 'SENT'
      ? 'SENT'
      : deliveryResult.delivery.status === 'UNCERTAIN'
      ? 'UNCERTAIN'
      : 'FAILED';
  const uncertainFlag = nextStatus === 'UNCERTAIN' ? 1 : 0;

  if (existing) {
    await db
      .prepare(
        `UPDATE review_requests
         SET recipient_email = ?, recipient_name = ?, review_url = ?, status = ?,
             delivery_id = ?, uncertain_reconciliation_needed = ?,
             attempt_count = attempt_count + 1, last_error = ?,
             sent_at = COALESCE(?, sent_at), updated_at = ?
         WHERE workspace_id = ? AND job_id = ?`
      )
      .bind(
        input.recipientEmail.trim(),
        recipientName,
        reviewUrl,
        nextStatus,
        deliveryResult.delivery.id,
        uncertainFlag,
        deliveryResult.delivery.error_message,
        nextStatus === 'SENT' ? now : null,
        now,
        input.workspaceId,
        input.jobId
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO review_requests (
          id, workspace_id, job_id, recipient_email, recipient_name, review_url,
          status, delivery_id, uncertain_reconciliation_needed, attempt_count,
          last_error, reconciled_by_user_id, reconciled_at, sent_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, ?, ?, ?)`
      )
      .bind(
        `rev_${crypto.randomUUID()}`,
        input.workspaceId,
        input.jobId,
        input.recipientEmail.trim(),
        recipientName,
        reviewUrl,
        nextStatus,
        deliveryResult.delivery.id,
        uncertainFlag,
        deliveryResult.delivery.error_message,
        nextStatus === 'SENT' ? now : null,
        now,
        now
      )
      .run();
  }

  await writeAuditEvent(db, {
    workspaceId: input.workspaceId,
    deliveryId: deliveryResult.delivery.id,
    eventType: 'REVIEW_DISPATCHED',
    transportMode: deliveryResult.transport_mode,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
    details: { job_id: input.jobId, status: nextStatus },
    now,
  });

  const saved = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(input.workspaceId, input.jobId)
    .first<ReviewRequestRecord>();

  if (!saved) {
    throw new Error('Failed to load persisted review request');
  }

  return {
    deduplicated: false,
    reason:
      nextStatus === 'SENT'
        ? `Review request dispatched (${deliveryResult.transport_mode}).`
        : nextStatus === 'UNCERTAIN'
        ? 'Review request dispatch timed out; reconciliation required.'
        : 'Review request dispatch failed; retry available.',
    review_request: saved,
    delivery: deliveryResult.delivery,
    transport_mode: deliveryResult.transport_mode,
    is_synthetic: deliveryResult.is_synthetic,
  };
}

export async function retryReviewRequestDelivery(
  db: D1Database,
  env: EmailEnv | undefined,
  workspaceId: string,
  jobId: string,
  actorUserId: string,
  requestId: string
): Promise<{ ok: true; review_request: ReviewRequestRecord; delivery: EmailDeliveryRecord } | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE'; message: string }> {
  const existing = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(workspaceId, jobId)
    .first<ReviewRequestRecord>();

  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Review request not found for this job.' };
  }
  if (existing.status !== 'FAILED' || !existing.delivery_id) {
    return { ok: false, code: 'INVALID_STATE', message: `Only FAILED review requests can be retried (current: ${existing.status}).` };
  }

  const retryRes = await retryEmailDelivery(db, env, workspaceId, existing.delivery_id, actorUserId, requestId);
  if (!retryRes.ok) {
    return retryRes;
  }

  const now = new Date().toISOString();
  const nextStatus: ReviewRequestStatus =
    retryRes.result.delivery.status === 'SENT'
      ? 'SENT'
      : retryRes.result.delivery.status === 'UNCERTAIN'
      ? 'UNCERTAIN'
      : 'FAILED';

  await db
    .prepare(
      `UPDATE review_requests
       SET status = ?, uncertain_reconciliation_needed = ?, attempt_count = attempt_count + 1,
           last_error = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
       WHERE workspace_id = ? AND job_id = ?`
    )
    .bind(
      nextStatus,
      nextStatus === 'UNCERTAIN' ? 1 : 0,
      retryRes.result.delivery.error_message,
      nextStatus === 'SENT' ? now : null,
      now,
      workspaceId,
      jobId
    )
    .run();

  await writeAuditEvent(db, {
    workspaceId,
    deliveryId: existing.delivery_id,
    eventType: 'REVIEW_RETRIED',
    transportMode: retryRes.result.transport_mode,
    actorUserId,
    requestId,
    details: { job_id: jobId, status: nextStatus },
    now,
  });

  const updated = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(workspaceId, jobId)
    .first<ReviewRequestRecord>();

  return { ok: true, review_request: updated!, delivery: retryRes.result.delivery };
}

export async function reconcileReviewRequestStatus(
  db: D1Database,
  env: EmailEnv | undefined,
  workspaceId: string,
  jobId: string,
  outcome: 'SENT' | 'FAILED',
  actorUserId: string,
  requestId: string
): Promise<{ ok: true; review_request: ReviewRequestRecord } | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATE'; message: string }> {
  const existing = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(workspaceId, jobId)
    .first<ReviewRequestRecord>();

  if (!existing) {
    return { ok: false, code: 'NOT_FOUND', message: 'Review request not found for this job.' };
  }
  if (existing.status !== 'UNCERTAIN') {
    return { ok: false, code: 'INVALID_STATE', message: `Only UNCERTAIN review requests can be reconciled (current: ${existing.status}).` };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE review_requests
       SET status = ?, uncertain_reconciliation_needed = 0,
           reconciled_by_user_id = ?, reconciled_at = ?,
           sent_at = COALESCE(?, sent_at), updated_at = ?
       WHERE workspace_id = ? AND job_id = ?`
    )
    .bind(
      outcome,
      actorUserId,
      now,
      outcome === 'SENT' ? now : null,
      now,
      workspaceId,
      jobId
    )
    .run();

  if (existing.delivery_id) {
    await db
      .prepare(
        `UPDATE email_deliveries
         SET status = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
         WHERE id = ? AND workspace_id = ?`
      )
      .bind(outcome, outcome === 'SENT' ? now : null, now, existing.delivery_id, workspaceId)
      .run();
  }

  const transport = getTransportStatus(env);
  await writeAuditEvent(db, {
    workspaceId,
    deliveryId: existing.delivery_id,
    eventType: 'REVIEW_RECONCILED',
    transportMode: transport.mode,
    actorUserId,
    requestId,
    details: { job_id: jobId, reconciled_to: outcome },
    now,
  });

  const updated = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
    .bind(workspaceId, jobId)
    .first<ReviewRequestRecord>();

  return { ok: true, review_request: updated! };
}

export async function listReviewRequests(
  db: D1Database,
  workspaceId: string,
  jobId?: string
): Promise<ReviewRequestRecord[]> {
  if (jobId) {
    const res = await db
      .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ? ORDER BY updated_at DESC`)
      .bind(workspaceId, jobId)
      .all<ReviewRequestRecord>();
    return res.results;
  }
  const res = await db
    .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 100`)
    .bind(workspaceId)
    .all<ReviewRequestRecord>();
  return res.results;
}

export const emailService = {
  getTransportStatus,
  resolveSenderIdentity,
  sendEmail,
  sendTestEmail,
  retryEmailDelivery,
  listEmailDeliveries,
  listEmailAuditEvents,
  dispatchReviewRequest,
  retryReviewRequestDelivery,
  reconcileReviewRequestStatus,
  listReviewRequests,
  isValidEmailAddress,
  redactEmailText,
  redactEmailAuditDetails,
};

export default emailService;
