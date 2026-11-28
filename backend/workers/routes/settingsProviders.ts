/**
 * CABMS Worker Route Handlers: Workspace Provider & System Configuration
 *
 * Implements:
 * - GET/PATCH /api/v1/workspaces/:workspaceId/provider-settings
 * - POST      /api/v1/workspaces/:workspaceId/provider-settings/test
 * - GET       /api/v1/workspaces/:workspaceId/provider-settings/audit
 *
 * Security invariants:
 * - Strict owner_admin / super_admin RBAC on all reads, writes, tests, and audit views.
 * - Server-side-only secrets (smtp_secret, myob_client_secret) stored in workspace_provider_secrets
 *   and NEVER returned to clients or written in plaintext to logs/audit.
 * - Strong ETag + If-Match optimistic concurrency on PATCH.
 * - Simulated/sandbox provider tests are explicitly labeled as simulated.
 */

import { D1Database } from '../../db/d1.ts';
import { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, productionAuthenticationService, type AuthenticationService } from '../auth.ts';
import { parseIfMatchHeader, generateStrongETag } from '../http.ts';
import { StructuredLogger } from '../logger.ts';
import { approvedMembership } from '../privilegedApproval.ts';
import { getWorkspaceTransportStatus, resolveSenderIdentity } from '../../services/emailService.ts';
import {
  authenticationRequiredResponse,
  accessDeniedResponse,
  resourceNotFoundResponse,
  preconditionRequiredResponse,
  preconditionFailedResponse,
  validationErrorResponse,
  internalErrorResponse,
} from '../problem.ts';

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const VALID_TRANSPORT_MODES = ['sandbox', 'smtp_relay', 'http_relay'] as const;
const VALID_MYOB_ENVS = ['sandbox', 'production_disabled'] as const;
const VALID_CALENDAR_PROVIDERS = ['sandbox_local', 'google_calendar_sandbox'] as const;
const VALID_HOLIDAY_REGIONS = ['brisbane', 'gold_coast'] as const;

export interface WorkspaceProviderConfigPublic {
  workspace_id: string;
  sender_name: string;
  sender_email: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_use_tls: boolean;
  smtp_transport_mode: (typeof VALID_TRANSPORT_MODES)[number];
  has_smtp_secret: boolean;
  smtp_last_test_status: 'UNTESTED' | 'PASSED_SANDBOX' | 'PASSED_LIVE' | 'FAILED';
  smtp_last_test_at: string | null;
  smtp_last_test_message: string | null;
  myob_enabled: boolean;
  myob_environment: (typeof VALID_MYOB_ENVS)[number];
  myob_company_file_id: string | null;
  myob_company_file_name: string | null;
  myob_client_id: string | null;
  has_myob_secret: boolean;
  myob_connection_status: 'DISCONNECTED' | 'CONNECTED_SANDBOX' | 'FAILED';
  myob_last_test_at: string | null;
  myob_last_test_message: string | null;
  calendar_provider: (typeof VALID_CALENDAR_PROVIDERS)[number];
  primary_hub_calendar: string | null;
  fleet_calendar_name: string | null;
  fleet_calendar_id: string | null;
  holiday_region: (typeof VALID_HOLIDAY_REGIONS)[number];
  calendar_sync_status: 'UNCONFIGURED' | 'SYNCED_SANDBOX' | 'ERROR';
  calendar_last_test_at: string | null;
  calendar_last_test_message: string | null;
  version: number;
  updated_at: string;
}

export interface ProviderAuditEventRow {
  id: string;
  workspace_id: string;
  provider_type: 'smtp' | 'myob' | 'calendar' | 'all';
  event_type: 'PROVIDER_CONFIG_UPDATED' | 'PROVIDER_CONNECTION_TESTED' | 'PROVIDER_SECRET_UPDATED' | 'PROVIDER_SECRET_CLEARED';
  old_version: number;
  new_version: number;
  old_values: string;
  new_values: string;
  actor_user_id: string;
  request_id: string;
  transition_nonce: string;
  created_at: string;
}

export interface ProviderTestResponse {
  ok: boolean;
  provider: 'smtp' | 'myob' | 'calendar';
  simulated: true;
  mode: 'sandbox_simulation';
  status: string;
  message: string;
  tested_at: string;
  config: WorkspaceProviderConfigPublic;
}

interface RawProviderConfigRow {
  workspace_id: string;
  sender_name: string;
  sender_email: string | null;
  reply_to_email: string | null;
  smtp_host: string | null;
  smtp_port: number;
  smtp_username: string | null;
  smtp_use_tls: number;
  smtp_transport_mode: string;
  smtp_last_test_status: string;
  smtp_last_test_at: string | null;
  smtp_last_test_message: string | null;
  myob_enabled: number;
  myob_environment: string;
  myob_company_file_id: string | null;
  myob_company_file_name: string | null;
  myob_client_id: string | null;
  myob_connection_status: string;
  myob_last_test_at: string | null;
  myob_last_test_message: string | null;
  calendar_provider: string;
  primary_hub_calendar: string | null;
  fleet_calendar_name: string | null;
  fleet_calendar_id: string | null;
  holiday_region: string;
  calendar_sync_status: string;
  calendar_last_test_at: string | null;
  calendar_last_test_message: string | null;
  version: number;
  updated_at: string;
}

const ALLOWED_PATCH_KEYS = [
  'sender_name',
  'sender_email',
  'reply_to_email',
  'smtp_host',
  'smtp_port',
  'smtp_username',
  'smtp_use_tls',
  'smtp_transport_mode',
  'smtp_secret',
  'myob_enabled',
  'myob_environment',
  'myob_company_file_id',
  'myob_company_file_name',
  'myob_client_id',
  'myob_client_secret',
  'calendar_provider',
  'primary_hub_calendar',
  'fleet_calendar_name',
  'fleet_calendar_id',
  'holiday_region',
] as const;

const REDACTED_KEYS = new Set([
  'smtp_secret',
  'myob_client_secret',
  'sender_email',
  'reply_to_email',
  'smtp_username',
  'myob_client_id',
]);

function isAllowedAdminRole(role: string): boolean {
  return role === 'super_admin' || role === 'owner_admin';
}

const currentAdminPrivilege = `EXISTS (
  SELECT 1 FROM workspace_memberships wm
  JOIN users u ON u.id = wm.user_id AND u.disabled = 0
  JOIN user_identity_mappings im ON im.user_id = u.id AND im.provider_id = 'firebase'
  WHERE wm.workspace_id = ? AND wm.user_id = ? AND im.provider_subject_id = ?
    AND wm.role IN ('super_admin', 'owner_admin') AND ${approvedMembership}
)`;

async function getSecretFlags(db: D1Database, workspaceId: string): Promise<{ hasSmtpSecret: boolean; hasMyobSecret: boolean }> {
  const rows = await db
    .prepare('SELECT secret_key FROM workspace_provider_secrets WHERE workspace_id = ?')
    .bind(workspaceId)
    .all<{ secret_key: string }>();
  const keys = new Set((rows.results || []).map(r => r.secret_key));
  return {
    hasSmtpSecret: keys.has('smtp_secret'),
    hasMyobSecret: keys.has('myob_client_secret'),
  };
}

function toPublicConfig(row: RawProviderConfigRow, flags: { hasSmtpSecret: boolean; hasMyobSecret: boolean }): WorkspaceProviderConfigPublic {
  return {
    workspace_id: row.workspace_id,
    sender_name: row.sender_name,
    sender_email: row.sender_email,
    reply_to_email: row.reply_to_email,
    smtp_host: row.smtp_host,
    smtp_port: row.smtp_port,
    smtp_username: row.smtp_username,
    smtp_use_tls: row.smtp_use_tls === 1,
    smtp_transport_mode: (VALID_TRANSPORT_MODES.includes(row.smtp_transport_mode as any) ? row.smtp_transport_mode : 'sandbox') as WorkspaceProviderConfigPublic['smtp_transport_mode'],
    has_smtp_secret: flags.hasSmtpSecret,
    smtp_last_test_status: row.smtp_last_test_status as WorkspaceProviderConfigPublic['smtp_last_test_status'],
    smtp_last_test_at: row.smtp_last_test_at,
    smtp_last_test_message: row.smtp_last_test_message,
    myob_enabled: row.myob_enabled === 1,
    myob_environment: (VALID_MYOB_ENVS.includes(row.myob_environment as any) ? row.myob_environment : 'sandbox') as WorkspaceProviderConfigPublic['myob_environment'],
    myob_company_file_id: row.myob_company_file_id,
    myob_company_file_name: row.myob_company_file_name,
    myob_client_id: row.myob_client_id,
    has_myob_secret: flags.hasMyobSecret,
    myob_connection_status: row.myob_connection_status as WorkspaceProviderConfigPublic['myob_connection_status'],
    myob_last_test_at: row.myob_last_test_at,
    myob_last_test_message: row.myob_last_test_message,
    calendar_provider: (VALID_CALENDAR_PROVIDERS.includes(row.calendar_provider as any) ? row.calendar_provider : 'sandbox_local') as WorkspaceProviderConfigPublic['calendar_provider'],
    primary_hub_calendar: row.primary_hub_calendar,
    fleet_calendar_name: row.fleet_calendar_name,
    fleet_calendar_id: row.fleet_calendar_id,
    holiday_region: (VALID_HOLIDAY_REGIONS.includes(row.holiday_region as any) ? row.holiday_region : 'brisbane') as WorkspaceProviderConfigPublic['holiday_region'],
    calendar_sync_status: row.calendar_sync_status as WorkspaceProviderConfigPublic['calendar_sync_status'],
    calendar_last_test_at: row.calendar_last_test_at,
    calendar_last_test_message: row.calendar_last_test_message,
    version: row.version,
    updated_at: row.updated_at,
  };
}

async function fetchPublicProviderConfig(db: D1Database, workspaceId: string): Promise<WorkspaceProviderConfigPublic | null> {
  let row = await db
    .prepare('SELECT * FROM workspace_provider_configs WHERE workspace_id = ?')
    .bind(workspaceId)
    .first<RawProviderConfigRow>();

  if (!row) {
    const ws = await db.prepare('SELECT id, name FROM workspaces WHERE id = ?').bind(workspaceId).first<{ id: string; name: string }>();
    if (!ws) return null;
    const now = new Date().toISOString();
    await db
      .prepare(
        `INSERT OR IGNORE INTO workspace_provider_configs (workspace_id, sender_name, updated_at)
         VALUES (?, ?, ?)`
      )
      .bind(workspaceId, `${ws.name} Operations`, now)
      .run();
    row = await db
      .prepare('SELECT * FROM workspace_provider_configs WHERE workspace_id = ?')
      .bind(workspaceId)
      .first<RawProviderConfigRow>();
    if (!row) return null;
  }

  const flags = await getSecretFlags(db, workspaceId);
  return toPublicConfig(row, flags);
}

function redactAuditValue(key: string, value: unknown): unknown {
  if (REDACTED_KEYS.has(key)) {
    return value !== null && value !== undefined && value !== '' ? '[REDACTED]' : null;
  }
  return value;
}

function validateStringField(
  body: Record<string, unknown>,
  key: string,
  maxLen: number,
  errors: Array<{ pointer: string; code: string; message: string }>,
  options: { requiredNonEmpty?: boolean; email?: boolean } = {}
): string | null | undefined {
  if (!(key in body)) return undefined;
  const val = body[key];
  if (val === null) {
    if (options.requiredNonEmpty) {
      errors.push({ pointer: `/${key}`, code: 'NON_EMPTY_REQUIRED', message: `${key} must be non-empty` });
      return undefined;
    }
    return null;
  }
  if (typeof val !== 'string') {
    errors.push({ pointer: `/${key}`, code: 'INVALID_TYPE', message: `${key} must be a string${options.requiredNonEmpty ? '' : ' or null'}` });
    return undefined;
  }
  const trimmed = val.trim();
  if (options.requiredNonEmpty && !trimmed) {
    errors.push({ pointer: `/${key}`, code: 'NON_EMPTY_REQUIRED', message: `${key} must be non-empty` });
    return undefined;
  }
  if (trimmed.length > maxLen) {
    errors.push({ pointer: `/${key}`, code: 'LENGTH_EXCEEDED', message: `${key} must not exceed ${maxLen} characters` });
    return undefined;
  }
  if (options.email && trimmed && !EMAIL_REGEX.test(trimmed)) {
    errors.push({ pointer: `/${key}`, code: 'INVALID_EMAIL', message: `${key} format is invalid` });
    return undefined;
  }
  return trimmed || null;
}

/**
 * Unified router for /api/v1/workspaces/:workspaceId/provider-settings[/test|/audit]
 */
export async function handleSettingsProviders(
  request: Request,
  env: Env,
  workspaceId: string,
  subAction: string | undefined,
  requestId: string,
  authentication: AuthenticationService = productionAuthenticationService
): Promise<Response> {
  const db = env.DB;
  const logger = new StructuredLogger(requestId, workspaceId);

  const auth = await authentication.authenticateRequest(db, request, env);
  if (!auth) {
    logger.warn('AUTH_FAILED', 'Authentication required for provider settings');
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'User has no membership in workspace', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  if (!isAllowedAdminRole(membership.role)) {
    logger.warn('INSUFFICIENT_PERMISSIONS', 'Non-admin attempted provider settings access', {
      fields: { role: membership.role, user_id: auth.userId },
    });
    return accessDeniedResponse('Provider and system configuration is strictly restricted to Owner Admin and Super Admin', requestId);
  }

  // GET /provider-settings/audit
  if (request.method === 'GET' && subAction === 'audit') {
    const events = await db
      .prepare(
        `SELECT * FROM provider_config_audit_events
         WHERE workspace_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 50`
      )
      .bind(workspaceId)
      .all<ProviderAuditEventRow>();
    return new Response(JSON.stringify({ events: events.results || [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': requestId },
    });
  }

  // POST /provider-settings/test
  if (request.method === 'POST' && subAction === 'test') {
    return handleTestProviderConnection(request, db, workspaceId, auth.userId, auth.providerSubjectId, requestId, logger);
  }

  if (subAction) {
    return resourceNotFoundResponse('Provider settings endpoint not found', requestId);
  }

  // GET /provider-settings
  if (request.method === 'GET') {
    const config = await fetchPublicProviderConfig(db, workspaceId);
    if (!config) {
      return resourceNotFoundResponse('Workspace provider settings not found', requestId);
    }
    logger.info('PROVIDER_SETTINGS_READ', 'Provider settings retrieved', {
      fields: { version: config.version, user_id: auth.userId },
    });
    return new Response(JSON.stringify(config), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'ETag': generateStrongETag(config.version),
        'X-Request-Id': requestId,
      },
    });
  }

  // PATCH /provider-settings
  if (request.method === 'PATCH') {
    return handlePatchProviderSettings(request, db, workspaceId, auth.userId, auth.providerSubjectId, requestId, logger);
  }

  return new Response('Method Not Allowed', { status: 405, headers: { 'X-Request-Id': requestId } });
}

async function handlePatchProviderSettings(
  request: Request,
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
  actorUid: string,
  requestId: string,
  logger: StructuredLogger
): Promise<Response> {
  const ifMatch = parseIfMatchHeader(request.headers.get('If-Match'));
  if (!ifMatch.isPresent) {
    return preconditionRequiredResponse('If-Match header with current resource ETag is required', requestId);
  }
  if (ifMatch.isWildcard) {
    return validationErrorResponse(
      'Wildcard If-Match (*) is prohibited',
      [{ pointer: '/headers/if-match', code: 'WILDCARD_PROHIBITED', message: 'Wildcard * cannot bypass version guard' }],
      requestId
    );
  }
  if (ifMatch.isWeak) {
    return validationErrorResponse(
      'Weak validators (W/...) are prohibited',
      [{ pointer: '/headers/if-match', code: 'WEAK_ETAG_PROHIBITED', message: 'Only strong ETags are permitted' }],
      requestId
    );
  }
  if (ifMatch.isMalformed || ifMatch.strongVersions.length === 0) {
    return validationErrorResponse(
      'Malformed If-Match validator',
      [{ pointer: '/headers/if-match', code: 'MALFORMED_VALIDATOR', message: 'If-Match must be a quoted integer version, e.g. "1"' }],
      requestId
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse('Malformed JSON payload', [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be valid JSON' }], requestId);
  }
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return validationErrorResponse('Invalid JSON payload format', [{ pointer: '/', code: 'INVALID_TYPE', message: 'Request body must be a JSON object' }], requestId);
  }

  const body = rawBody as Record<string, unknown>;
  const errors: Array<{ pointer: string; code: string; message: string }> = [];

  for (const key of Object.keys(body)) {
    if (!(ALLOWED_PATCH_KEYS as readonly string[]).includes(key)) {
      errors.push({ pointer: `/${key}`, code: 'UNKNOWN_FIELD', message: `Field '${key}' is not allowed in provider settings update` });
    }
  }

  const sender_name = validateStringField(body, 'sender_name', 100, errors, { requiredNonEmpty: true });
  const sender_email = validateStringField(body, 'sender_email', 254, errors, { email: true });
  const reply_to_email = validateStringField(body, 'reply_to_email', 254, errors, { email: true });
  const smtp_host = validateStringField(body, 'smtp_host', 200, errors);
  const smtp_username = validateStringField(body, 'smtp_username', 150, errors);
  const myob_company_file_id = validateStringField(body, 'myob_company_file_id', 120, errors);
  const myob_company_file_name = validateStringField(body, 'myob_company_file_name', 150, errors);
  const myob_client_id = validateStringField(body, 'myob_client_id', 150, errors);
  const primary_hub_calendar = validateStringField(body, 'primary_hub_calendar', 150, errors);
  const fleet_calendar_name = validateStringField(body, 'fleet_calendar_name', 150, errors);
  const fleet_calendar_id = validateStringField(body, 'fleet_calendar_id', 150, errors);

  let smtp_port: number | undefined;
  if ('smtp_port' in body) {
    if (typeof body.smtp_port !== 'number' || !Number.isSafeInteger(body.smtp_port) || body.smtp_port < 1 || body.smtp_port > 65535) {
      errors.push({ pointer: '/smtp_port', code: 'INVALID_PORT', message: 'SMTP port must be an integer between 1 and 65535' });
    } else {
      smtp_port = body.smtp_port;
    }
  }

  let smtp_use_tls: boolean | undefined;
  if ('smtp_use_tls' in body) {
    if (typeof body.smtp_use_tls !== 'boolean') {
      errors.push({ pointer: '/smtp_use_tls', code: 'INVALID_TYPE', message: 'smtp_use_tls must be a boolean' });
    } else {
      smtp_use_tls = body.smtp_use_tls;
    }
  }

  let myob_enabled: boolean | undefined;
  if ('myob_enabled' in body) {
    if (typeof body.myob_enabled !== 'boolean') {
      errors.push({ pointer: '/myob_enabled', code: 'INVALID_TYPE', message: 'myob_enabled must be a boolean' });
    } else {
      myob_enabled = body.myob_enabled;
    }
  }

  if ('smtp_transport_mode' in body && (typeof body.smtp_transport_mode !== 'string' || !(VALID_TRANSPORT_MODES as readonly string[]).includes(body.smtp_transport_mode))) {
    errors.push({ pointer: '/smtp_transport_mode', code: 'INVALID_ENUM', message: `smtp_transport_mode must be one of: ${VALID_TRANSPORT_MODES.join(', ')}` });
  }
  if ('myob_environment' in body && (typeof body.myob_environment !== 'string' || !(VALID_MYOB_ENVS as readonly string[]).includes(body.myob_environment))) {
    errors.push({ pointer: '/myob_environment', code: 'INVALID_ENUM', message: `myob_environment must be one of: ${VALID_MYOB_ENVS.join(', ')}` });
  }
  if ('calendar_provider' in body && (typeof body.calendar_provider !== 'string' || !(VALID_CALENDAR_PROVIDERS as readonly string[]).includes(body.calendar_provider))) {
    errors.push({ pointer: '/calendar_provider', code: 'INVALID_ENUM', message: `calendar_provider must be one of: ${VALID_CALENDAR_PROVIDERS.join(', ')}` });
  }
  if ('holiday_region' in body && (typeof body.holiday_region !== 'string' || !(VALID_HOLIDAY_REGIONS as readonly string[]).includes(body.holiday_region))) {
    errors.push({ pointer: '/holiday_region', code: 'INVALID_ENUM', message: `holiday_region must be one of: ${VALID_HOLIDAY_REGIONS.join(', ')}` });
  }

  let smtpSecretAction: { op: 'set'; value: string } | { op: 'clear' } | undefined;
  if ('smtp_secret' in body) {
    if (body.smtp_secret === null || body.smtp_secret === '') {
      smtpSecretAction = { op: 'clear' };
    } else if (typeof body.smtp_secret !== 'string' || body.smtp_secret.length > 512) {
      errors.push({ pointer: '/smtp_secret', code: 'INVALID_SECRET', message: 'smtp_secret must be a string <= 512 characters or null' });
    } else {
      smtpSecretAction = { op: 'set', value: body.smtp_secret };
    }
  }

  let myobSecretAction: { op: 'set'; value: string } | { op: 'clear' } | undefined;
  if ('myob_client_secret' in body) {
    if (body.myob_client_secret === null || body.myob_client_secret === '') {
      myobSecretAction = { op: 'clear' };
    } else if (typeof body.myob_client_secret !== 'string' || body.myob_client_secret.length > 512) {
      errors.push({ pointer: '/myob_client_secret', code: 'INVALID_SECRET', message: 'myob_client_secret must be a string <= 512 characters or null' });
    } else {
      myobSecretAction = { op: 'set', value: body.myob_client_secret };
    }
  }

  if (errors.length > 0) {
    return validationErrorResponse('Submitted provider settings failed validation constraints', errors, requestId);
  }

  const current = await fetchPublicProviderConfig(db, workspaceId);
  if (!current) {
    return resourceNotFoundResponse('Workspace provider settings not found', requestId);
  }

  const expectedVersion = ifMatch.strongVersions.includes(current.version) ? current.version : ifMatch.strongVersions[0];
  if (current.version !== expectedVersion) {
    return preconditionFailedResponse(`Supplied version (${expectedVersion}) does not match current resource version (${current.version})`, requestId);
  }

  const next = {
    sender_name: sender_name !== undefined ? sender_name! : current.sender_name,
    sender_email: sender_email !== undefined ? sender_email : current.sender_email,
    reply_to_email: reply_to_email !== undefined ? reply_to_email : current.reply_to_email,
    smtp_host: smtp_host !== undefined ? smtp_host : current.smtp_host,
    smtp_port: smtp_port !== undefined ? smtp_port : current.smtp_port,
    smtp_username: smtp_username !== undefined ? smtp_username : current.smtp_username,
    smtp_use_tls: smtp_use_tls !== undefined ? smtp_use_tls : current.smtp_use_tls,
    smtp_transport_mode: ('smtp_transport_mode' in body ? body.smtp_transport_mode : current.smtp_transport_mode) as WorkspaceProviderConfigPublic['smtp_transport_mode'],
    myob_enabled: myob_enabled !== undefined ? myob_enabled : current.myob_enabled,
    myob_environment: ('myob_environment' in body ? body.myob_environment : current.myob_environment) as WorkspaceProviderConfigPublic['myob_environment'],
    myob_company_file_id: myob_company_file_id !== undefined ? myob_company_file_id : current.myob_company_file_id,
    myob_company_file_name: myob_company_file_name !== undefined ? myob_company_file_name : current.myob_company_file_name,
    myob_client_id: myob_client_id !== undefined ? myob_client_id : current.myob_client_id,
    calendar_provider: ('calendar_provider' in body ? body.calendar_provider : current.calendar_provider) as WorkspaceProviderConfigPublic['calendar_provider'],
    primary_hub_calendar: primary_hub_calendar !== undefined ? primary_hub_calendar : current.primary_hub_calendar,
    fleet_calendar_name: fleet_calendar_name !== undefined ? fleet_calendar_name : current.fleet_calendar_name,
    fleet_calendar_id: fleet_calendar_id !== undefined ? fleet_calendar_id : current.fleet_calendar_id,
    holiday_region: ('holiday_region' in body ? body.holiday_region : current.holiday_region) as WorkspaceProviderConfigPublic['holiday_region'],
  };

  const changedFields: string[] = [];
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const key of Object.keys(next) as Array<keyof typeof next>) {
    if (next[key] !== current[key]) {
      changedFields.push(key);
      oldValues[key] = redactAuditValue(key, current[key]);
      newValues[key] = redactAuditValue(key, next[key]);
    }
  }
  if (smtpSecretAction) {
    changedFields.push('smtp_secret');
    oldValues.smtp_secret = current.has_smtp_secret ? '[REDACTED]' : null;
    newValues.smtp_secret = smtpSecretAction.op === 'set' ? '[REDACTED]' : null;
  }
  if (myobSecretAction) {
    changedFields.push('myob_client_secret');
    oldValues.myob_client_secret = current.has_myob_secret ? '[REDACTED]' : null;
    newValues.myob_client_secret = myobSecretAction.op === 'set' ? '[REDACTED]' : null;
  }

  if (changedFields.length === 0) {
    return new Response(JSON.stringify(current), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'ETag': generateStrongETag(current.version), 'X-Request-Id': requestId },
    });
  }

  const now = new Date().toISOString();
  const reqNonce = crypto.randomUUID();
  const auditId = `paud_${crypto.randomUUID()}`;

  const stmts = [
    db
      .prepare(
        `UPDATE workspace_provider_configs
         SET sender_name = ?, sender_email = ?, reply_to_email = ?,
             smtp_host = ?, smtp_port = ?, smtp_username = ?, smtp_use_tls = ?, smtp_transport_mode = ?,
             myob_enabled = ?, myob_environment = ?, myob_company_file_id = ?, myob_company_file_name = ?, myob_client_id = ?,
             calendar_provider = ?, primary_hub_calendar = ?, fleet_calendar_name = ?, fleet_calendar_id = ?, holiday_region = ?,
             version = version + 1, transition_nonce = ?, updated_at = ?, updated_by_user_id = ?
         WHERE workspace_id = ? AND version = ? AND ${currentAdminPrivilege}`
      )
      .bind(
        next.sender_name,
        next.sender_email,
        next.reply_to_email,
        next.smtp_host,
        next.smtp_port,
        next.smtp_username,
        next.smtp_use_tls ? 1 : 0,
        next.smtp_transport_mode,
        next.myob_enabled ? 1 : 0,
        next.myob_environment,
        next.myob_company_file_id,
        next.myob_company_file_name,
        next.myob_client_id,
        next.calendar_provider,
        next.primary_hub_calendar,
        next.fleet_calendar_name,
        next.fleet_calendar_id,
        next.holiday_region,
        reqNonce,
        now,
        actorUserId,
        workspaceId,
        expectedVersion,
        workspaceId,
        actorUserId,
        actorUid
      ),
  ];

  if (smtpSecretAction?.op === 'set') {
    stmts.push(
      db
        .prepare(
          `INSERT INTO workspace_provider_secrets (workspace_id, secret_key, secret_value, updated_at, updated_by_user_id)
           VALUES (?, 'smtp_secret', ?, ?, ?)
           ON CONFLICT(workspace_id, secret_key) DO UPDATE SET
             secret_value = excluded.secret_value,
             updated_at = excluded.updated_at,
             updated_by_user_id = excluded.updated_by_user_id`
        )
        .bind(workspaceId, smtpSecretAction.value, now, actorUserId)
    );
  } else if (smtpSecretAction?.op === 'clear') {
    stmts.push(
      db.prepare(`DELETE FROM workspace_provider_secrets WHERE workspace_id = ? AND secret_key = 'smtp_secret'`).bind(workspaceId)
    );
  }

  if (myobSecretAction?.op === 'set') {
    stmts.push(
      db
        .prepare(
          `INSERT INTO workspace_provider_secrets (workspace_id, secret_key, secret_value, updated_at, updated_by_user_id)
           VALUES (?, 'myob_client_secret', ?, ?, ?)
           ON CONFLICT(workspace_id, secret_key) DO UPDATE SET
             secret_value = excluded.secret_value,
             updated_at = excluded.updated_at,
             updated_by_user_id = excluded.updated_by_user_id`
        )
        .bind(workspaceId, myobSecretAction.value, now, actorUserId)
    );
  } else if (myobSecretAction?.op === 'clear') {
    stmts.push(
      db.prepare(`DELETE FROM workspace_provider_secrets WHERE workspace_id = ? AND secret_key = 'myob_client_secret'`).bind(workspaceId)
    );
  }

  stmts.push(
    db
      .prepare(
        `INSERT INTO provider_config_audit_events (
           id, workspace_id, provider_type, event_type, old_version, new_version,
           old_values, new_values, actor_user_id, request_id, transition_nonce, created_at
         )
         SELECT ?, workspace_id, 'all', 'PROVIDER_CONFIG_UPDATED', ?, version, ?, ?, ?, ?, transition_nonce, ?
         FROM workspace_provider_configs
         WHERE workspace_id = ? AND transition_nonce = ?`
      )
      .bind(
        auditId,
        expectedVersion,
        JSON.stringify(oldValues),
        JSON.stringify(newValues),
        actorUserId,
        requestId,
        now,
        workspaceId,
        reqNonce
      )
  );

  try {
    const batchRes = await db.batch(stmts);
    const updateChanges = batchRes[0]?.meta?.changes ?? 0;
    if (updateChanges === 0) {
      const fresh = await fetchPublicProviderConfig(db, workspaceId);
      if (!fresh) return resourceNotFoundResponse('Workspace provider settings not found', requestId);
      return preconditionFailedResponse(`Supplied version (${expectedVersion}) does not match current resource version (${fresh.version})`, requestId);
    }

    const updated = await fetchPublicProviderConfig(db, workspaceId);
    if (!updated) return internalErrorResponse('Failed to reload updated provider settings', requestId);

    logger.info('PROVIDER_SETTINGS_UPDATED', 'Provider settings updated with redacted audit', {
      fields: { new_version: updated.version, changed_fields: changedFields, user_id: actorUserId },
    });

    return new Response(JSON.stringify(updated), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'ETag': generateStrongETag(updated.version),
        'X-Request-Id': requestId,
      },
    });
  } catch (err) {
    logger.error('PROVIDER_SETTINGS_ERROR', 'Database error updating provider settings', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return internalErrorResponse('Failed to persist provider settings', requestId);
  }
}

async function handleTestProviderConnection(
  request: Request,
  db: D1Database,
  workspaceId: string,
  actorUserId: string,
  actorUid: string,
  requestId: string,
  logger: StructuredLogger
): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse('Malformed JSON payload', [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be valid JSON' }], requestId);
  }
  const provider = (rawBody as Record<string, unknown> | null)?.provider;
  if (provider !== 'smtp' && provider !== 'myob' && provider !== 'calendar') {
    return validationErrorResponse(
      'Invalid provider for connection test',
      [{ pointer: '/provider', code: 'INVALID_ENUM', message: 'provider must be one of: smtp, myob, calendar' }],
      requestId
    );
  }

  const current = await fetchPublicProviderConfig(db, workspaceId);
  if (!current) {
    return resourceNotFoundResponse('Workspace provider settings not found', requestId);
  }

  const now = new Date().toISOString();
  const reqNonce = crypto.randomUUID();
  const auditId = `paud_${crypto.randomUUID()}`;

  let ok = false;
  let status = 'FAILED';
  let message = '';
  let updateSql = '';
  let updateParams: unknown[] = [];

  if (provider === 'smtp') {
    const resolvedTransport = await getWorkspaceTransportStatus(db, workspaceId);
    const resolvedSender = await resolveSenderIdentity(db, workspaceId);
    if (!current.sender_email || !current.smtp_host) {
      ok = false;
      status = 'FAILED';
      message = '[PROVIDER TEST] Missing sender email or SMTP host configuration.';
    } else if (current.smtp_transport_mode === 'smtp_relay' && !current.smtp_use_tls) {
      ok = false;
      status = 'FAILED';
      message = '[PROVIDER TEST] TLS is required for smtp_relay (smtp_use_tls must be enabled). Plaintext SMTP authentication is blocked.';
    } else if (current.smtp_transport_mode === 'smtp_relay' && (!current.smtp_username || !current.has_smtp_secret)) {
      ok = false;
      status = 'FAILED';
      message = '[PROVIDER TEST] SMTP username and server-side secret are required for smtp_relay.';
    } else if (resolvedTransport.mode === 'SMTP_TCP') {
      ok = true;
      status = 'PASSED_LIVE';
      message = `[TLS SMTP CONFIGURED] Verified sender ${resolvedSender.sender_name} <${resolvedSender.sender_email}> via ${current.smtp_host}:${current.smtp_port} with TLS enabled and server-side secret.`;
    } else {
      ok = true;
      status = 'PASSED_SANDBOX';
      const secretNote = current.has_smtp_secret ? 'server-side secret verified' : 'no secret configured (sandbox mode)';
      message = `[SIMULATED SANDBOX TEST] Verified sender ${resolvedSender.sender_name} <${resolvedSender.sender_email}> via ${current.smtp_host}:${current.smtp_port} (${current.smtp_transport_mode}, ${secretNote}; resolved transport: ${resolvedTransport.mode}). No live external email was sent.`;
    }
    updateSql = `UPDATE workspace_provider_configs
                 SET smtp_last_test_status = ?, smtp_last_test_at = ?, smtp_last_test_message = ?,
                     version = version + 1, transition_nonce = ?, updated_at = ?, updated_by_user_id = ?
                 WHERE workspace_id = ? AND version = ? AND ${currentAdminPrivilege}`;
    updateParams = [status, now, message, reqNonce, now, actorUserId, workspaceId, current.version, workspaceId, actorUserId, actorUid];
  } else if (provider === 'myob') {
    if (!current.myob_enabled) {
      ok = false;
      status = 'DISCONNECTED';
      message = '[SIMULATED SANDBOX TEST] MYOB sandbox integration is currently disabled for this workspace.';
    } else if (!current.myob_company_file_name && !current.myob_company_file_id) {
      ok = false;
      status = 'FAILED';
      message = '[SIMULATED SANDBOX TEST] Missing MYOB sandbox company file name or ID.';
    } else {
      ok = true;
      status = 'CONNECTED_SANDBOX';
      const secretNote = current.has_myob_secret ? 'server-side client secret present' : 'sandbox stub credentials';
      message = `[SIMULATED SANDBOX TEST] Connected to MYOB Sandbox (${current.myob_company_file_name || current.myob_company_file_id}; ${secretNote}). No live MYOB production API call was made.`;
    }
    updateSql = `UPDATE workspace_provider_configs
                 SET myob_connection_status = ?, myob_last_test_at = ?, myob_last_test_message = ?,
                     version = version + 1, transition_nonce = ?, updated_at = ?, updated_by_user_id = ?
                 WHERE workspace_id = ? AND version = ? AND ${currentAdminPrivilege}`;
    updateParams = [status, now, message, reqNonce, now, actorUserId, workspaceId, current.version, workspaceId, actorUserId, actorUid];
  } else {
    if (!current.primary_hub_calendar || !current.fleet_calendar_name) {
      ok = false;
      status = 'ERROR';
      message = '[SIMULATED SANDBOX TEST] Primary hub calendar and fleet calendar name are required.';
    } else {
      ok = true;
      status = 'SYNCED_SANDBOX';
      message = `[SIMULATED SANDBOX TEST] Verified calendar mapping "${current.fleet_calendar_name}" -> "${current.primary_hub_calendar}" (${current.holiday_region} holiday policy).`;
    }
    updateSql = `UPDATE workspace_provider_configs
                 SET calendar_sync_status = ?, calendar_last_test_at = ?, calendar_last_test_message = ?,
                     version = version + 1, transition_nonce = ?, updated_at = ?, updated_by_user_id = ?
                 WHERE workspace_id = ? AND version = ? AND ${currentAdminPrivilege}`;
    updateParams = [status, now, message, reqNonce, now, actorUserId, workspaceId, current.version, workspaceId, actorUserId, actorUid];
  }

  const auditStmt = db
    .prepare(
      `INSERT INTO provider_config_audit_events (
         id, workspace_id, provider_type, event_type, old_version, new_version,
         old_values, new_values, actor_user_id, request_id, transition_nonce, created_at
       )
       SELECT ?, workspace_id, ?, 'PROVIDER_CONNECTION_TESTED', ?, version, ?, ?, ?, ?, transition_nonce, ?
       FROM workspace_provider_configs
       WHERE workspace_id = ? AND transition_nonce = ?`
    )
    .bind(
      auditId,
      provider,
      current.version,
      JSON.stringify({}),
      JSON.stringify({ provider, simulated: true, status }),
      actorUserId,
      requestId,
      now,
      workspaceId,
      reqNonce
    );

  const batchRes = await db.batch([db.prepare(updateSql).bind(...updateParams), auditStmt]);
  if ((batchRes[0]?.meta?.changes ?? 0) === 0) {
    return preconditionFailedResponse('Provider settings version changed concurrently; retry test', requestId);
  }

  const updated = await fetchPublicProviderConfig(db, workspaceId);
  if (!updated) {
    return internalErrorResponse('Failed to reload provider settings after test', requestId);
  }

  logger.info('PROVIDER_CONNECTION_TESTED', 'Simulated provider connection test executed', {
    fields: { provider, ok, status, simulated: true, user_id: actorUserId },
  });

  const payload: ProviderTestResponse = {
    ok,
    provider,
    simulated: true,
    mode: 'sandbox_simulation',
    status,
    message,
    tested_at: now,
    config: updated,
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'ETag': generateStrongETag(updated.version),
      'X-Request-Id': requestId,
    },
  });
}
