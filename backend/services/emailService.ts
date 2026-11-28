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
  SMTP_USE_TLS?: string;
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
  review_request?: ReviewRequestRecord;
}

export interface RetryEmailOptions {
  simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN';
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

export interface ResolvedSmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  useTls: boolean;
}

async function hasProviderConfigTables(db: D1Database): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'workspace_provider_configs'")
    .first<{ name: string }>();
  return Boolean(row);
}

async function resolveWorkspaceTransport(
  db: D1Database,
  workspaceId: string,
  env?: EmailEnv
): Promise<{ status: EmailTransportStatus; smtpConfig?: ResolvedSmtpConfig }> {
  const forceSandbox = env?.EMAIL_SANDBOX_ONLY === '1' || env?.EMAIL_SANDBOX_ONLY === 'true';
  if (forceSandbox) {
    return { status: getTransportStatus(env) };
  }

  if (await hasProviderConfigTables(db)) {
    const cfg = await db
      .prepare(
        `SELECT smtp_host, smtp_port, smtp_username, smtp_use_tls, smtp_transport_mode
         FROM workspace_provider_configs
         WHERE workspace_id = ?`
      )
      .bind(workspaceId)
      .first<{
        smtp_host: string | null;
        smtp_port: number;
        smtp_username: string | null;
        smtp_use_tls: number;
        smtp_transport_mode: string;
      }>();

    if (cfg) {
      if (cfg.smtp_transport_mode === 'sandbox') {
        return {
          status: {
            mode: 'SANDBOX_SYNTHETIC',
            is_synthetic: true,
            configured_providers: ['SANDBOX_SYNTHETIC'],
            reason: 'Workspace provider settings are in sandbox mode; using deterministic sandbox/synthetic transport.',
          },
        };
      }
      if (cfg.smtp_transport_mode === 'http_relay') {
        const hasHttpsRelay = Boolean(env?.EMAIL_RELAY_URL?.trim() && env?.EMAIL_RELAY_API_KEY?.trim());
        if (hasHttpsRelay) {
          return {
            status: {
              mode: 'HTTPS_RELAY',
              is_synthetic: false,
              configured_providers: ['HTTPS_RELAY', 'SANDBOX_SYNTHETIC'],
              reason: 'Workspace http_relay mode active with server-side HTTPS relay credentials.',
            },
          };
        }
        return {
          status: {
            mode: 'SANDBOX_SYNTHETIC',
            is_synthetic: true,
            configured_providers: ['SANDBOX_SYNTHETIC'],
            reason: 'Workspace http_relay mode selected, but EMAIL_RELAY_URL/EMAIL_RELAY_API_KEY are not configured; keeping live transport disabled.',
          },
        };
      }
      if (cfg.smtp_transport_mode === 'smtp_relay') {
        const secretRow = await db
          .prepare(
            `SELECT secret_value FROM workspace_provider_secrets
             WHERE workspace_id = ? AND secret_key = 'smtp_secret'`
          )
          .bind(workspaceId)
          .first<{ secret_value: string }>();

        const host = cfg.smtp_host?.trim() ?? '';
        const port = Number(cfg.smtp_port) || 587;
        const user = cfg.smtp_username?.trim() ?? '';
        const pass = secretRow?.secret_value?.trim() ?? '';
        const useTls = cfg.smtp_use_tls === 1;

        if (host && user && pass && useTls) {
          return {
            status: {
              mode: 'SMTP_TCP',
              is_synthetic: false,
              configured_providers: ['SMTP_TCP', 'SANDBOX_SYNTHETIC'],
              reason: `Workspace SMTP relay configured with TLS (${host}:${port}).`,
            },
            smtpConfig: { host, port, user, pass, useTls: true },
          };
        }
        return {
          status: {
            mode: 'SANDBOX_SYNTHETIC',
            is_synthetic: true,
            configured_providers: ['SANDBOX_SYNTHETIC'],
            reason: !useTls
              ? 'SMTP live transport disabled: TLS (smtp_use_tls=1) is required before authenticating.'
              : 'SMTP live transport disabled: host, username, and server-side smtp_secret are required.',
          },
        };
      }
    }
  }

  const envStatus = getTransportStatus(env);
  if (envStatus.mode === 'SMTP_TCP') {
    const envUseTls = env?.SMTP_USE_TLS !== 'false' && env?.SMTP_USE_TLS !== '0';
    if (!envUseTls) {
      return {
        status: {
          mode: 'SANDBOX_SYNTHETIC',
          is_synthetic: true,
          configured_providers: ['SANDBOX_SYNTHETIC'],
          reason: 'SMTP live transport disabled: SMTP_USE_TLS cannot be disabled.',
        },
      };
    }
    return {
      status: envStatus,
      smtpConfig: {
        host: env!.SMTP_HOST!.trim(),
        port: Number.parseInt(env?.SMTP_PORT || '587', 10) || 587,
        user: env!.SMTP_USER!.trim(),
        pass: env!.SMTP_PASS!.trim(),
        useTls: true,
      },
    };
  }
  return { status: envStatus };
}

export async function getWorkspaceTransportStatus(
  db: D1Database,
  workspaceId: string,
  env?: EmailEnv
): Promise<EmailTransportStatus> {
  const resolved = await resolveWorkspaceTransport(db, workspaceId, env);
  return resolved.status;
}

/**
 * Resolves business-specific sender identity from workspace_provider_configs, workspace_settings & workspaces.
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

  const providerCfg = (await hasProviderConfigTables(db))
    ? await db
        .prepare(
          `SELECT sender_name, sender_email, reply_to_email, version, updated_by_user_id
           FROM workspace_provider_configs
           WHERE workspace_id = ?`
        )
        .bind(workspaceId)
        .first<{
          sender_name: string | null;
          sender_email: string | null;
          reply_to_email: string | null;
          version: number;
          updated_by_user_id: string | null;
        }>()
    : null;

  const slug = row?.workspace_slug || workspaceId.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'workspace';
  const providerSenderName = providerCfg?.sender_name?.trim() || '';
  const isExplicitProviderEdit = Boolean(providerCfg?.updated_by_user_id) || (providerCfg?.version ?? 1) > 1;
  const autoGeneratedName = row?.workspace_name?.trim() ? `${row.workspace_name.trim()} Operations` : '';
  const hasCustomProviderSender =
    providerSenderName.length > 0 &&
    (isExplicitProviderEdit ||
      Boolean(providerCfg?.sender_email?.trim()) ||
      (providerSenderName !== 'CABMS Operations' && providerSenderName !== autoGeneratedName));

  const senderName =
    overrides?.fromName?.trim() ||
    (hasCustomProviderSender ? providerSenderName : '') ||
    row?.trading_name?.trim() ||
    row?.workspace_name?.trim() ||
    providerSenderName ||
    'CABMS Workspace';

  const configuredEmail = overrides?.fromEmail?.trim() || providerCfg?.sender_email?.trim() || row?.contact_email?.trim() || '';
  const hasValidConfigured = configuredEmail.length > 0 && isValidEmailAddress(configuredEmail);
  const senderEmail = hasValidConfigured ? configuredEmail : `noreply@${slug}.cabms-demo.invalid`;

  const providerReplyTo = providerCfg?.reply_to_email?.trim() || '';
  const replyToEmail =
    providerReplyTo && isValidEmailAddress(providerReplyTo)
      ? providerReplyTo
      : hasValidConfigured
        ? configuredEmail
        : null;

  return {
    workspace_id: workspaceId,
    sender_name: senderName,
    sender_email: senderEmail,
    reply_to_email: replyToEmail,
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

export interface SmtpSocketLike {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  close: () => Promise<void>;
  startTls?: () => SmtpSocketLike;
}

export type SmtpConnectFn = (
  addr: { hostname: string; port: number },
  options?: { secureTransport?: 'on' | 'off' | 'starttls'; allowHalfOpen?: boolean }
) => SmtpSocketLike;

export async function dispatchViaSmtpTcp(
  env: Partial<EmailEnv> | undefined,
  payload: {
    fromName: string;
    fromEmail: string;
    toEmail: string;
    subject: string;
    bodyText: string;
  },
  smtpOverride?: ResolvedSmtpConfig,
  connectOverride?: SmtpConnectFn
): Promise<TransportDispatchOutcome> {
  const host = (smtpOverride?.host ?? env?.SMTP_HOST ?? '').trim();
  const port = smtpOverride?.port ?? (Number.parseInt(env?.SMTP_PORT || '587', 10) || 587);
  const user = (smtpOverride?.user ?? env?.SMTP_USER ?? '').trim();
  const pass = (smtpOverride?.pass ?? env?.SMTP_PASS ?? '').trim();
  const useTls = smtpOverride ? smtpOverride.useTls : env?.SMTP_USE_TLS !== 'false' && env?.SMTP_USE_TLS !== '0';

  if (!useTls) {
    return {
      status: 'FAILED',
      providerMessageId: null,
      errorCode: 'SMTP_TLS_REQUIRED',
      errorMessage: 'Refusing SMTP authentication over plaintext: TLS is required.',
    };
  }

  let connectFn: SmtpConnectFn | null = connectOverride ?? null;

  if (!connectFn) {
    try {
      // @ts-expect-error cloudflare:sockets is only resolved in Cloudflare Workers runtime
      const mod = await import('cloudflare:sockets');
      if (typeof mod?.connect === 'function') {
        connectFn = mod.connect as SmtpConnectFn;
      }
    } catch {
      connectFn = null;
    }
  }

  if (!connectFn) {
    return {
      status: 'FAILED',
      providerMessageId: null,
      errorCode: 'SMTP_SOCKET_UNAVAILABLE',
      errorMessage: 'cloudflare:sockets is unavailable in this runtime; configure EMAIL_RELAY_URL for HTTPS relay or run in Cloudflare Workers.',
    };
  }

  const useImplicitTls = port === 465;
  const socket = connectFn(
    { hostname: host, port },
    { secureTransport: useImplicitTls ? 'on' : 'starttls', allowHalfOpen: false }
  );
  let activeSocket: SmtpSocketLike = socket;
  let writer = activeSocket.writable.getWriter();
  let reader = activeSocket.readable.getReader();
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
    let ehlo = await sendCmd('EHLO cabms.workers.local');
    if (!ehlo.startsWith('250')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_EHLO_ERROR', errorMessage: redactEmailText(ehlo) };
    }

    if (!useImplicitTls) {
      if (!/STARTTLS/i.test(ehlo)) {
        return {
          status: 'FAILED',
          providerMessageId: null,
          errorCode: 'SMTP_TLS_REQUIRED',
          errorMessage: 'SMTP server does not advertise STARTTLS; refusing plaintext authentication.',
        };
      }
      const startTlsRes = await sendCmd('STARTTLS');
      if (!startTlsRes.startsWith('220') || typeof activeSocket.startTls !== 'function') {
        return {
          status: 'FAILED',
          providerMessageId: null,
          errorCode: 'SMTP_TLS_REQUIRED',
          errorMessage: 'SMTP STARTTLS upgrade failed; refusing plaintext authentication.',
        };
      }
      writer.releaseLock();
      reader.releaseLock();
      activeSocket = activeSocket.startTls();
      writer = activeSocket.writable.getWriter();
      reader = activeSocket.readable.getReader();
      ehlo = await sendCmd('EHLO cabms.workers.local');
      if (!ehlo.startsWith('250')) {
        return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_EHLO_ERROR', errorMessage: redactEmailText(ehlo) };
      }
    }

    const authInit = await sendCmd('AUTH LOGIN');
    if (!authInit.startsWith('334')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_AUTH_ERROR', errorMessage: redactEmailText(authInit) };
    }
    const userRes = await sendCmd(btoa(user));
    if (!userRes.startsWith('334')) {
      return { status: 'FAILED', providerMessageId: null, errorCode: 'SMTP_AUTH_REJECTED', errorMessage: 'SMTP authentication failed' };
    }
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
    try { await activeSocket.close(); } catch { /* ignore */ }
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

async function executeTransportDispatch(
  env: EmailEnv | undefined,
  resolvedTransport: { status: EmailTransportStatus; smtpConfig?: ResolvedSmtpConfig },
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
    simulateOutcome?: 'SENT' | 'FAILED' | 'UNCERTAIN';
  }
): Promise<TransportDispatchOutcome> {
  if (resolvedTransport.status.mode === 'HTTPS_RELAY' && env) {
    return dispatchViaHttpsRelay(env, {
      fromName: payload.fromName,
      fromEmail: payload.fromEmail,
      replyTo: payload.replyTo,
      toEmail: payload.toEmail,
      toName: payload.toName,
      subject: payload.subject,
      bodyText: payload.bodyText,
      bodyHtml: payload.bodyHtml,
      requestId: payload.requestId,
    });
  }
  if (resolvedTransport.status.mode === 'SMTP_TCP' && (resolvedTransport.smtpConfig || env)) {
    return dispatchViaSmtpTcp(
      env ?? {},
      {
        fromName: payload.fromName,
        fromEmail: payload.fromEmail,
        toEmail: payload.toEmail,
        subject: payload.subject,
        bodyText: payload.bodyText,
      },
      resolvedTransport.smtpConfig
    );
  }
  return dispatchViaSandboxSynthetic(payload.simulateOutcome);
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

  const resolvedTransport = await resolveWorkspaceTransport(db, input.workspaceId, env);
  const transport = resolvedTransport.status;
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

  const outcome = await executeTransportDispatch(env, resolvedTransport, {
    fromName: sender.sender_name,
    fromEmail: sender.sender_email,
    replyTo: sender.reply_to_email,
    toEmail,
    toName: input.toName?.trim() || null,
    subject: input.subject.trim(),
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml ?? null,
    requestId: input.requestId,
    simulateOutcome: input.simulateOutcome,
  });

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
  const transport = await getWorkspaceTransportStatus(db, input.workspaceId, env);
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

function toReviewRequestStatus(status: TransportDispatchOutcome['status'] | EmailDeliveryStatus): ReviewRequestStatus {
  if (status === 'SENT') return 'SENT';
  if (status === 'UNCERTAIN') return 'UNCERTAIN';
  return 'FAILED';
}

/**
 * Retries a FAILED email delivery within the same workspace.
 * Atomically claims the delivery (and linked review_requests row when category is REVIEW_REQUEST)
 * before calling external transport so concurrent retries cannot double-send.
 */
export async function retryEmailDelivery(
  db: D1Database,
  env: EmailEnv | undefined,
  workspaceId: string,
  deliveryId: string,
  actorUserId: string,
  requestId: string,
  options?: RetryEmailOptions
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

  const linkedReview =
    existing.category === 'REVIEW_REQUEST' && existing.job_id
      ? await db
          .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
          .bind(workspaceId, existing.job_id)
          .first<ReviewRequestRecord>()
      : null;

  if (linkedReview) {
    if (linkedReview.delivery_id !== deliveryId) {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Delivery ${deliveryId} is no longer the active delivery for review request ${existing.job_id}.`,
      };
    }
    if (linkedReview.status !== 'FAILED') {
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Only FAILED review requests can be retried (current: ${linkedReview.status}).`,
      };
    }
  }

  const claimNow = new Date().toISOString();
  if (linkedReview && existing.job_id) {
    const claimBatch = await db.batch([
      db
        .prepare(
          `UPDATE email_deliveries
           SET status = 'QUEUED', updated_at = ?
           WHERE id = ? AND workspace_id = ? AND status = 'FAILED'
             AND EXISTS (
               SELECT 1 FROM review_requests
               WHERE workspace_id = ? AND job_id = ? AND delivery_id = ? AND status = 'FAILED'
             )`
        )
        .bind(claimNow, deliveryId, workspaceId, workspaceId, existing.job_id, deliveryId),
      db
        .prepare(
          `UPDATE review_requests
           SET status = 'PENDING', uncertain_reconciliation_needed = 0, last_error = NULL, updated_at = ?
           WHERE workspace_id = ? AND job_id = ? AND delivery_id = ? AND status = 'FAILED'
             AND EXISTS (
               SELECT 1 FROM email_deliveries
               WHERE id = ? AND workspace_id = ? AND status = 'QUEUED'
             )`
        )
        .bind(claimNow, workspaceId, existing.job_id, deliveryId, deliveryId, workspaceId),
    ]);
    const deliveryClaimed = (claimBatch[0]?.meta?.changes ?? 0) === 1;
    const reviewClaimed = (claimBatch[1]?.meta?.changes ?? 0) === 1;
    if (!deliveryClaimed || !reviewClaimed) {
      const latestReview = await db
        .prepare(`SELECT status FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
        .bind(workspaceId, existing.job_id)
        .first<{ status: string }>();
      const latestDelivery = await db
        .prepare(`SELECT status FROM email_deliveries WHERE id = ? AND workspace_id = ?`)
        .bind(deliveryId, workspaceId)
        .first<{ status: string }>();
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Retry claim rejected (delivery: ${latestDelivery?.status ?? 'UNKNOWN'}, review: ${latestReview?.status ?? 'UNKNOWN'}).`,
      };
    }
  } else {
    const claimRes = await db
      .prepare(
        `UPDATE email_deliveries
         SET status = 'QUEUED', updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status = 'FAILED'`
      )
      .bind(claimNow, deliveryId, workspaceId)
      .run();
    if ((claimRes.meta?.changes ?? 0) !== 1) {
      const latestDelivery = await db
        .prepare(`SELECT status FROM email_deliveries WHERE id = ? AND workspace_id = ?`)
        .bind(deliveryId, workspaceId)
        .first<{ status: string }>();
      return {
        ok: false,
        code: 'INVALID_STATE',
        message: `Only FAILED deliveries can be retried (current status: ${latestDelivery?.status ?? 'UNKNOWN'}).`,
      };
    }
  }

  const resolvedTransport = await resolveWorkspaceTransport(db, workspaceId, env);
  const transport = resolvedTransport.status;
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
  try {
    outcome = await executeTransportDispatch(env, resolvedTransport, {
      fromName: existing.sender_name,
      fromEmail: existing.sender_email,
      replyTo: existing.reply_to_email,
      toEmail: existing.recipient_email,
      toName: existing.recipient_name,
      subject: existing.subject,
      bodyText: existing.body_text,
      bodyHtml: existing.body_html,
      requestId,
      simulateOutcome: options?.simulateOutcome ?? 'SENT',
    });
  } catch (err) {
    const failAt = new Date().toISOString();
    const errMsg = redactEmailText(err instanceof Error ? err.message : String(err));
    const revertStmts = [
      db
        .prepare(
          `UPDATE email_deliveries
           SET status = 'FAILED', error_code = 'RETRY_TRANSPORT_ERROR', error_message = ?,
               attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ?
           WHERE id = ? AND workspace_id = ? AND status = 'QUEUED'`
        )
        .bind(errMsg, failAt, failAt, deliveryId, workspaceId),
    ];
    if (linkedReview && existing.job_id) {
      revertStmts.push(
        db
          .prepare(
            `UPDATE review_requests
             SET status = 'FAILED', uncertain_reconciliation_needed = 0,
                 attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
             WHERE workspace_id = ? AND job_id = ? AND delivery_id = ? AND status = 'PENDING'`
          )
          .bind(errMsg, failAt, workspaceId, existing.job_id, deliveryId)
      );
    }
    await db.batch(revertStmts).catch(() => undefined);
    throw err;
  }

  const finishedAt = new Date().toISOString();
  const deliverySentAt = outcome.status === 'SENT' ? finishedAt : null;

  if (linkedReview && existing.job_id) {
    const nextReviewStatus = toReviewRequestStatus(outcome.status);
    const uncertainFlag = nextReviewStatus === 'UNCERTAIN' ? 1 : 0;
    await db.batch([
      db
        .prepare(
          `UPDATE email_deliveries
           SET status = ?, transport_mode = ?, provider_message_id = ?, error_code = ?,
               error_message = ?, attempt_count = attempt_count + 1,
               last_attempt_at = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
           WHERE id = ? AND workspace_id = ? AND status = 'QUEUED'`
        )
        .bind(
          outcome.status,
          transport.mode,
          outcome.providerMessageId,
          outcome.errorCode,
          outcome.errorMessage,
          finishedAt,
          deliverySentAt,
          finishedAt,
          deliveryId,
          workspaceId
        ),
      db
        .prepare(
          `UPDATE review_requests
           SET status = ?, uncertain_reconciliation_needed = ?, attempt_count = attempt_count + 1,
               last_error = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
           WHERE workspace_id = ? AND job_id = ? AND delivery_id = ? AND status = 'PENDING'`
        )
        .bind(
          nextReviewStatus,
          uncertainFlag,
          outcome.errorMessage,
          nextReviewStatus === 'SENT' ? finishedAt : null,
          finishedAt,
          workspaceId,
          existing.job_id,
          deliveryId
        ),
    ]);
  } else {
    await db
      .prepare(
        `UPDATE email_deliveries
         SET status = ?, transport_mode = ?, provider_message_id = ?, error_code = ?,
             error_message = ?, attempt_count = attempt_count + 1,
             last_attempt_at = ?, sent_at = COALESCE(?, sent_at), updated_at = ?
         WHERE id = ? AND workspace_id = ? AND status = 'QUEUED'`
      )
      .bind(
        outcome.status,
        transport.mode,
        outcome.providerMessageId,
        outcome.errorCode,
        outcome.errorMessage,
        finishedAt,
        deliverySentAt,
        finishedAt,
        deliveryId,
        workspaceId
      )
      .run();
  }

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

  let updatedReview: ReviewRequestRecord | undefined;
  if (linkedReview && existing.job_id) {
    const nextReviewStatus = toReviewRequestStatus(outcome.status);
    await writeAuditEvent(db, {
      workspaceId,
      deliveryId,
      eventType: 'REVIEW_RETRIED',
      transportMode: transport.mode,
      actorUserId,
      requestId,
      details: { job_id: existing.job_id, status: nextReviewStatus },
      now: finishedAt,
    });
    const reloadedReview = await db
      .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
      .bind(workspaceId, existing.job_id)
      .first<ReviewRequestRecord>();
    if (!reloadedReview) {
      throw new Error('Failed to reload synchronized review request record');
    }
    updatedReview = reloadedReview;
  }

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
      ...(updatedReview ? { review_request: updatedReview } : {}),
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
 * Atomically claims the review_requests row in 'PENDING' state before calling sendEmail so concurrent
 * requests deduplicate without sending duplicate emails.
 */
export async function dispatchReviewRequest(
  db: D1Database,
  env: EmailEnv | undefined,
  input: DispatchReviewRequestInput
): Promise<DispatchReviewResult> {
  const toEmail = input.recipientEmail.trim();
  if (!isValidEmailAddress(toEmail)) {
    throw new Error('Invalid recipient email address');
  }

  const transport = await getWorkspaceTransportStatus(db, input.workspaceId, env);
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

  const claimNow = new Date().toISOString();
  const claimId = `rev_${crypto.randomUUID()}`;
  const claimRes = await db
    .prepare(
      `INSERT INTO review_requests (
        id, workspace_id, job_id, recipient_email, recipient_name, review_url,
        status, delivery_id, uncertain_reconciliation_needed, attempt_count,
        last_error, reconciled_by_user_id, reconciled_at, sent_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL, 0, 0, NULL, NULL, NULL, NULL, ?, ?)
      ON CONFLICT(workspace_id, job_id) DO UPDATE SET
        recipient_email = excluded.recipient_email,
        recipient_name = excluded.recipient_name,
        review_url = excluded.review_url,
        status = 'PENDING',
        uncertain_reconciliation_needed = 0,
        last_error = NULL,
        updated_at = excluded.updated_at
      WHERE review_requests.status IN ('NOT_SENT', 'FAILED')`
    )
    .bind(
      claimId,
      input.workspaceId,
      input.jobId,
      toEmail,
      recipientName,
      reviewUrl,
      claimNow,
      claimNow
    )
    .run();

  if ((claimRes.meta?.changes ?? 0) !== 1) {
    const existing = await db
      .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
      .bind(input.workspaceId, input.jobId)
      .first<ReviewRequestRecord>();

    if (!existing) {
      throw new Error('Failed to claim or load review request record');
    }

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

  let deliveryResult: EmailDeliveryResult;
  try {
    deliveryResult = await sendEmail(db, env, {
      workspaceId: input.workspaceId,
      category: 'REVIEW_REQUEST',
      jobId: input.jobId,
      toEmail,
      toName: recipientName,
      subject,
      bodyText,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      simulateOutcome: input.simulateOutcome,
    });
  } catch (err) {
    const failAt = new Date().toISOString();
    const errMsg = redactEmailText(err instanceof Error ? err.message : String(err));
    await db
      .prepare(
        `UPDATE review_requests
         SET status = 'FAILED', uncertain_reconciliation_needed = 0,
             attempt_count = attempt_count + 1, last_error = ?, updated_at = ?
         WHERE workspace_id = ? AND job_id = ? AND status = 'PENDING'`
      )
      .bind(errMsg, failAt, input.workspaceId, input.jobId)
      .run()
      .catch(() => undefined);
    throw err;
  }

  const now = new Date().toISOString();
  const nextStatus = toReviewRequestStatus(deliveryResult.delivery.status);
  const uncertainFlag = nextStatus === 'UNCERTAIN' ? 1 : 0;

  await db
    .prepare(
      `UPDATE review_requests
       SET status = ?, delivery_id = ?, uncertain_reconciliation_needed = ?,
           attempt_count = attempt_count + 1, last_error = ?,
           sent_at = COALESCE(?, sent_at), updated_at = ?
       WHERE workspace_id = ? AND job_id = ? AND status = 'PENDING'`
    )
    .bind(
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
  requestId: string,
  options?: RetryEmailOptions
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

  const retryRes = await retryEmailDelivery(db, env, workspaceId, existing.delivery_id, actorUserId, requestId, options);
  if (!retryRes.ok) {
    return retryRes;
  }

  const updated =
    retryRes.result.review_request ??
    (await db
      .prepare(`SELECT * FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
      .bind(workspaceId, jobId)
      .first<ReviewRequestRecord>());

  if (!updated) {
    throw new Error('Failed to reload retried review request record');
  }

  return { ok: true, review_request: updated, delivery: retryRes.result.delivery };
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
  const reconcileRes = await db
    .prepare(
      `UPDATE review_requests
       SET status = ?, uncertain_reconciliation_needed = 0,
           reconciled_by_user_id = ?, reconciled_at = ?,
           sent_at = COALESCE(?, sent_at), updated_at = ?
       WHERE workspace_id = ? AND job_id = ? AND status = 'UNCERTAIN'`
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

  if ((reconcileRes.meta?.changes ?? 0) !== 1) {
    const latest = await db
      .prepare(`SELECT status FROM review_requests WHERE workspace_id = ? AND job_id = ?`)
      .bind(workspaceId, jobId)
      .first<{ status: string }>();
    return {
      ok: false,
      code: 'INVALID_STATE',
      message: `Only UNCERTAIN review requests can be reconciled (current: ${latest?.status ?? 'UNKNOWN'}).`,
    };
  }

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

  const transport = await getWorkspaceTransportStatus(db, workspaceId, env);
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
  getWorkspaceTransportStatus,
  resolveSenderIdentity,
  dispatchViaSmtpTcp,
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
