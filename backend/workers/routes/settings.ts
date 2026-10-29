/**
 * CABMS Worker Route Handlers: Workspace Settings & Legal Details
 *
 * Implements:
 * - GET/PATCH /api/v1/workspaces/:workspaceId/settings
 * - GET/PATCH /api/v1/workspaces/:workspaceId/legal-details
 */

import { D1Database } from '../../db/d1.ts';
import { Env } from '../../types.ts';
import {
  getWorkspaceSettings,
  getLegalDetails,
  updateWorkspaceSettings,
  updateLegalDetails,
} from '../../modules/settings/settingsRepo.ts';
import {
  ALLOWED_SETTINGS_KEYS,
  ALLOWED_LEGAL_KEYS,
} from '../../../contracts/settings.ts';
import type {
  EditableWorkspaceSettings,
  EditableLegalDetails,
} from '../../../contracts/settings.ts';
import { authenticateRequest, authorizeWorkspaceAccess } from '../auth.ts';
import { parseIfMatchHeader, generateStrongETag } from '../http.ts';
import { StructuredLogger } from '../logger.ts';
import {
  authenticationRequiredResponse,
  accessDeniedResponse,
  resourceNotFoundResponse,
  preconditionRequiredResponse,
  preconditionFailedResponse,
  validationErrorResponse,
  internalErrorResponse,
} from '../problem.ts';

// Email validation regex (RFC 5322 compatible subset)
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
// Hex color token
const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const VALID_PRESETS = ['dark_neutral', 'dark_company', 'light_neutral', 'light_company', 'high_visibility_dark'];

export async function handleGetWorkspaceSettings(
  request: Request,
  db: D1Database,
  workspaceId: string,
  requestId: string,
  env?: Env
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);

  const auth = await authenticateRequest(db, request, env);
  if (!auth) {
    logger.warn('AUTH_FAILED', 'Authentication required for settings read');
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'User has no membership in workspace', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  const settings = await getWorkspaceSettings(db, workspaceId);
  if (!settings) {
    return resourceNotFoundResponse('Workspace settings not found', requestId);
  }

  logger.info('SETTINGS_READ', 'Workspace settings retrieved', {
    fields: { version: settings.version, user_id: auth.userId },
  });

  return new Response(JSON.stringify(settings), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'ETag': generateStrongETag(settings.version),
      'X-Request-Id': requestId,
    },
  });
}

export async function handlePatchWorkspaceSettings(
  request: Request,
  db: D1Database,
  workspaceId: string,
  requestId: string,
  env?: Env
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);

  // 1. Authenticate
  const auth = await authenticateRequest(db, request, env);
  if (!auth) {
    logger.warn('AUTH_FAILED', 'Authentication required for settings write');
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  // 2. Authorize role: Super Admin or Owner Admin
  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'User has no membership in workspace', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  if (membership.role !== 'super_admin' && membership.role !== 'owner_admin') {
    logger.warn('INSUFFICIENT_PERMISSIONS', 'Role cannot modify workspace operational settings', {
      fields: { role: membership.role },
    });
    return accessDeniedResponse('Only Admins and Super Admins may modify workspace operational settings', requestId);
  }

  // 3. Precondition / If-Match verification
  const ifMatchHeader = request.headers.get('If-Match');
  const ifMatch = parseIfMatchHeader(ifMatchHeader);

  if (!ifMatch.isPresent) {
    logger.warn('PRECONDITION_REQUIRED', 'If-Match header is mandatory on settings PATCH');
    return preconditionRequiredResponse('If-Match header with current resource ETag is required for conditional update', requestId);
  }

  if (ifMatch.isWildcard) {
    return validationErrorResponse(
      'Wildcard If-Match (*) is prohibited for exact-version settings updates',
      [{ pointer: '/headers/if-match', code: 'WILDCARD_PROHIBITED', message: 'Wildcard * cannot bypass version guard' }],
      requestId
    );
  }

  if (ifMatch.isWeak) {
    return validationErrorResponse(
      'Weak validators (W/...) are prohibited for exact-version settings updates',
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

  const existingResource = await getWorkspaceSettings(db, workspaceId);
  const expectedVersion = existingResource && ifMatch.strongVersions.includes(existingResource.version) ? existingResource.version : ifMatch.strongVersions[0];

  // 4. Parse & validate request payload
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse(
      'Malformed JSON payload',
      [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be valid JSON' }],
      requestId
    );
  }

  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return validationErrorResponse(
      'Invalid JSON payload format',
      [{ pointer: '/', code: 'INVALID_TYPE', message: 'Request body must be a JSON object' }],
      requestId
    );
  }

  const body = rawBody as Record<string, unknown>;

  const validationErrors: Array<{ pointer: string; code: string; message: string }> = [];

  // Check for disallowed/unknown fields
  for (const key of Object.keys(body)) {
    if (!ALLOWED_SETTINGS_KEYS.includes(key as keyof EditableWorkspaceSettings)) {
      validationErrors.push({
        pointer: `/${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Field '${key}' is read-only or not allowed in workspace operational settings update`,
      });
    }
  }

  const patch: Partial<EditableWorkspaceSettings> = {};

  if ('trading_name' in body) {
    if (typeof body.trading_name !== 'string' || !body.trading_name.trim()) {
      validationErrors.push({ pointer: '/trading_name', code: 'NON_EMPTY_REQUIRED', message: 'Trading name must be non-empty' });
    } else if (body.trading_name.length > 100) {
      validationErrors.push({ pointer: '/trading_name', code: 'LENGTH_EXCEEDED', message: 'Trading name must not exceed 100 characters' });
    } else {
      patch.trading_name = body.trading_name.trim();
    }
  }

  if ('tagline' in body) {
    if (body.tagline !== null && typeof body.tagline !== 'string') {
      validationErrors.push({ pointer: '/tagline', code: 'INVALID_TYPE', message: 'Tagline must be a string or null' });
    } else if (typeof body.tagline === 'string' && body.tagline.length > 200) {
      validationErrors.push({ pointer: '/tagline', code: 'LENGTH_EXCEEDED', message: 'Tagline must not exceed 200 characters' });
    } else {
      patch.tagline = body.tagline;
    }
  }

  if ('accent_color' in body) {
    if (typeof body.accent_color !== 'string' || !HEX_COLOR_REGEX.test(body.accent_color)) {
      validationErrors.push({ pointer: '/accent_color', code: 'INVALID_COLOR', message: 'Accent color must be a valid hex color code (#rrggbb)' });
    } else {
      patch.accent_color = body.accent_color;
    }
  }

  if ('preferred_preset' in body) {
    if (typeof body.preferred_preset !== 'string' || !VALID_PRESETS.includes(body.preferred_preset)) {
      validationErrors.push({ pointer: '/preferred_preset', code: 'INVALID_ENUM', message: `Preferred preset must be one of: ${VALID_PRESETS.join(', ')}` });
    } else {
      patch.preferred_preset = body.preferred_preset;
    }
  }

  if ('contact_email' in body) {
    if (body.contact_email !== null && typeof body.contact_email !== 'string') {
      validationErrors.push({ pointer: '/contact_email', code: 'INVALID_TYPE', message: 'Contact email must be string or null' });
    } else if (typeof body.contact_email === 'string' && body.contact_email.trim() && !EMAIL_REGEX.test(body.contact_email.trim())) {
      validationErrors.push({ pointer: '/contact_email', code: 'INVALID_EMAIL', message: 'Contact email format is invalid' });
    } else if (typeof body.contact_email === 'string' && body.contact_email.trim().length > 254) {
      validationErrors.push({ pointer: '/contact_email', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 254 characters' });
    } else {
      patch.contact_email = typeof body.contact_email === 'string' && body.contact_email.trim() ? body.contact_email.trim() : null;
    }
  }

  if ('contact_phone' in body) {
    if (body.contact_phone !== null && typeof body.contact_phone !== 'string') {
      validationErrors.push({ pointer: '/contact_phone', code: 'INVALID_TYPE', message: 'Contact phone must be string or null' });
    } else if (typeof body.contact_phone === 'string' && body.contact_phone.length > 40) {
      validationErrors.push({ pointer: '/contact_phone', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 40 characters' });
    } else {
      patch.contact_phone = body.contact_phone;
    }
  }

  if ('operational_address' in body) {
    if (body.operational_address !== null && typeof body.operational_address !== 'string') {
      validationErrors.push({ pointer: '/operational_address', code: 'INVALID_TYPE', message: 'Operational address must be string or null' });
    } else if (typeof body.operational_address === 'string' && body.operational_address.length > 250) {
      validationErrors.push({ pointer: '/operational_address', code: 'LENGTH_EXCEEDED', message: 'Address must not exceed 250 characters' });
    } else {
      patch.operational_address = body.operational_address;
    }
  }

  if ('operating_hours' in body) {
    if (body.operating_hours !== null && typeof body.operating_hours !== 'string') {
      validationErrors.push({ pointer: '/operating_hours', code: 'INVALID_TYPE', message: 'Operating hours must be string or null' });
    } else if (typeof body.operating_hours === 'string' && body.operating_hours.length > 150) {
      validationErrors.push({ pointer: '/operating_hours', code: 'LENGTH_EXCEEDED', message: 'Operating hours must not exceed 150 characters' });
    } else {
      patch.operating_hours = body.operating_hours;
    }
  }

  if (validationErrors.length > 0) {
    logger.warn('VALIDATION_FAILED', 'Payload validation errors', { fields: { errors: validationErrors } });
    return validationErrorResponse('Submitted settings failed validation constraints', validationErrors, requestId);
  }

  // Fault injection belongs to the test database, never request headers.

  // 5. Execute atomic mutation
  try {
    const result = await updateWorkspaceSettings(db, {
      workspaceId,
      expectedVersion,
      patch,
      actorUserId: auth.userId,
      requestId,
    });

    if (result.status === 'NOT_FOUND') {
      return resourceNotFoundResponse('Workspace settings not found', requestId);
    }

    if (result.status === 'PRECONDITION_FAILED') {
      logger.warn('PRECONDITION_FAILED', 'Settings version conflict', {
        fields: { expected_version: expectedVersion, current_version: result.currentVersion },
      });
      return preconditionFailedResponse(
        `Supplied version (${expectedVersion}) does not match current resource version (${result.currentVersion})`,
        requestId
      );
    }

    if (result.status === 'NO_OP') {
      logger.info('SETTINGS_NO_OP', 'No changes detected in submitted settings', {
        fields: { version: result.version },
      });
      return new Response(JSON.stringify(result.current), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'ETag': generateStrongETag(result.version),
          'X-Request-Id': requestId,
        },
      });
    }

    logger.info('SETTINGS_UPDATED', 'Workspace settings atomically updated with audit event', {
      fields: {
        new_version: result.newVersion,
        audit_event_id: result.auditEventId,
        user_id: auth.userId,
      },
    });

    return new Response(JSON.stringify(result.updated), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'ETag': generateStrongETag(result.newVersion),
        'X-Request-Id': requestId,
      },
    });
  } catch (err) {
    logger.error('SETTINGS_UPDATE_ERROR', 'Unexpected database error updating settings', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return internalErrorResponse('Failed to persist workspace settings', requestId);
  }
}

export async function handleGetLegalDetails(
  request: Request,
  db: D1Database,
  workspaceId: string,
  requestId: string,
  env?: Env
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);

  const auth = await authenticateRequest(db, request, env);
  if (!auth) {
    logger.warn('AUTH_FAILED', 'Authentication required for legal details read');
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'User has no membership in workspace', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  if (membership.role !== 'super_admin') {
    logger.warn('LEGAL_READ_DENIED', 'Non-super-admin attempted to view legal issuer details', {
      fields: { role: membership.role, user_id: auth.userId },
    });
    return accessDeniedResponse('Viewing legal issuer details and licences is strictly restricted to Super Admin', requestId);
  }

  const legal = await getLegalDetails(db, workspaceId);
  if (!legal) {
    return resourceNotFoundResponse('Legal issuer details not found', requestId);
  }

  logger.info('LEGAL_READ', 'Legal details retrieved', {
    fields: { version: legal.version, user_id: auth.userId },
  });

  return new Response(JSON.stringify(legal), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'ETag': generateStrongETag(legal.version),
      'X-Request-Id': requestId,
    },
  });
}

export async function handlePatchLegalDetails(
  request: Request,
  db: D1Database,
  workspaceId: string,
  requestId: string,
  env?: Env
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);

  // 1. Authenticate
  const auth = await authenticateRequest(db, request, env);
  if (!auth) {
    logger.warn('AUTH_FAILED', 'Authentication required for legal details write');
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  // 2. Authorize role: STRICTLY Super Admin only!
  const membership = await authorizeWorkspaceAccess(db, workspaceId, auth);
  if (!membership) {
    logger.warn('ACCESS_DENIED', 'User has no membership in workspace', { fields: { user_id: auth.userId } });
    return accessDeniedResponse('You do not have access to this workspace', requestId);
  }

  if (membership.role !== 'super_admin') {
    logger.warn('LEGAL_WRITE_DENIED', 'Non-super-admin attempted to modify legal issuer details', {
      fields: { role: membership.role, user_id: auth.userId },
    });
    return accessDeniedResponse('Modifying legal issuer details and licences is strictly restricted to Super Admin', requestId);
  }

  // 3. Precondition / If-Match
  const ifMatchHeader = request.headers.get('If-Match');
  const ifMatch = parseIfMatchHeader(ifMatchHeader);

  if (!ifMatch.isPresent) {
    logger.warn('PRECONDITION_REQUIRED', 'If-Match header is mandatory on legal-details PATCH');
    return preconditionRequiredResponse('If-Match header with current legal resource ETag is required', requestId);
  }

  if (ifMatch.isWildcard) {
    return validationErrorResponse(
      'Wildcard If-Match (*) is prohibited for exact-version legal updates',
      [{ pointer: '/headers/if-match', code: 'WILDCARD_PROHIBITED', message: 'Wildcard * cannot bypass version guard' }],
      requestId
    );
  }

  if (ifMatch.isWeak) {
    return validationErrorResponse(
      'Weak validators (W/...) are prohibited for exact-version legal updates',
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

  const existingResource = await getLegalDetails(db, workspaceId);
  const expectedVersion = existingResource && ifMatch.strongVersions.includes(existingResource.version) ? existingResource.version : ifMatch.strongVersions[0];

  // 4. Parse & validate request payload
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return validationErrorResponse(
      'Malformed JSON payload',
      [{ pointer: '/', code: 'INVALID_JSON', message: 'Request body must be valid JSON' }],
      requestId
    );
  }

  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return validationErrorResponse(
      'Invalid JSON payload format',
      [{ pointer: '/', code: 'INVALID_TYPE', message: 'Request body must be a JSON object' }],
      requestId
    );
  }

  const body = rawBody as Record<string, unknown>;

  const validationErrors: Array<{ pointer: string; code: string; message: string }> = [];

  for (const key of Object.keys(body)) {
    if (!ALLOWED_LEGAL_KEYS.includes(key as keyof EditableLegalDetails)) {
      validationErrors.push({
        pointer: `/${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Field '${key}' is not allowed in legal details update`,
      });
    }
  }

  const patch: Partial<EditableLegalDetails> = {};

  if ('legal_issuer_name' in body) {
    if (typeof body.legal_issuer_name !== 'string' || !body.legal_issuer_name.trim()) {
      validationErrors.push({ pointer: '/legal_issuer_name', code: 'NON_EMPTY_REQUIRED', message: 'Legal issuer name is required' });
    } else if (body.legal_issuer_name.length > 150) {
      validationErrors.push({ pointer: '/legal_issuer_name', code: 'LENGTH_EXCEEDED', message: 'Legal issuer name cannot exceed 150 characters' });
    } else {
      patch.legal_issuer_name = body.legal_issuer_name.trim();
    }
  }

  if ('abn' in body) {
    if (body.abn !== null && typeof body.abn !== 'string') {
      validationErrors.push({ pointer: '/abn', code: 'INVALID_TYPE', message: 'ABN must be a string or null' });
    } else if (typeof body.abn === 'string' && body.abn.length > 100) {
      validationErrors.push({ pointer: '/abn', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 100 characters' });
    } else {
      patch.abn = body.abn;
    }
  }

  if ('electrical_licence' in body) {
    if (body.electrical_licence !== null && typeof body.electrical_licence !== 'string') {
      validationErrors.push({ pointer: '/electrical_licence', code: 'INVALID_TYPE', message: 'Electrical licence must be string or null' });
    } else if (typeof body.electrical_licence === 'string' && body.electrical_licence.length > 100) {
      validationErrors.push({ pointer: '/electrical_licence', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 100 characters' });
    } else {
      patch.electrical_licence = body.electrical_licence;
    }
  }

  if ('acma_cabler_registration' in body) {
    if (body.acma_cabler_registration !== null && typeof body.acma_cabler_registration !== 'string') {
      validationErrors.push({ pointer: '/acma_cabler_registration', code: 'INVALID_TYPE', message: 'ACMA registration must be string or null' });
    } else if (typeof body.acma_cabler_registration === 'string' && body.acma_cabler_registration.length > 100) {
      validationErrors.push({ pointer: '/acma_cabler_registration', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 100 characters' });
    } else {
      patch.acma_cabler_registration = body.acma_cabler_registration;
    }
  }

  if ('qbcc_licence' in body) {
    if (body.qbcc_licence !== null && typeof body.qbcc_licence !== 'string') {
      validationErrors.push({ pointer: '/qbcc_licence', code: 'INVALID_TYPE', message: 'QBCC licence must be string or null' });
    } else if (typeof body.qbcc_licence === 'string' && body.qbcc_licence.length > 100) {
      validationErrors.push({ pointer: '/qbcc_licence', code: 'LENGTH_EXCEEDED', message: 'Field exceeds 100 characters' });
    } else {
      patch.qbcc_licence = body.qbcc_licence;
    }
  }

  if (validationErrors.length > 0) {
    logger.warn('VALIDATION_FAILED', 'Legal details validation errors', { fields: { errors: validationErrors } });
    return validationErrorResponse('Submitted legal details failed validation constraints', validationErrors, requestId);
  }

  // Fault injection belongs to the test database, never request headers.

  // 5. Execute atomic mutation
  try {
    const result = await updateLegalDetails(db, {
      workspaceId,
      expectedVersion,
      patch,
      actorUserId: auth.userId,
      requestId,
    });

    if (result.status === 'NOT_FOUND') {
      return resourceNotFoundResponse('Legal issuer details not found', requestId);
    }

    if (result.status === 'PRECONDITION_FAILED') {
      logger.warn('PRECONDITION_FAILED', 'Legal details version conflict', {
        fields: { expected_version: expectedVersion, current_version: result.currentVersion },
      });
      return preconditionFailedResponse(
        `Supplied version (${expectedVersion}) does not match current legal version (${result.currentVersion})`,
        requestId
      );
    }

    if (result.status === 'NO_OP') {
      logger.info('LEGAL_NO_OP', 'No changes detected in submitted legal details', {
        fields: { version: result.version },
      });
      return new Response(JSON.stringify(result.current), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'ETag': generateStrongETag(result.version),
          'X-Request-Id': requestId,
        },
      });
    }

    logger.info('LEGAL_UPDATED', 'Legal details atomically updated with audit event', {
      fields: {
        new_version: result.newVersion,
        audit_event_id: result.auditEventId,
        user_id: auth.userId,
      },
    });

    return new Response(JSON.stringify(result.updated), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'ETag': generateStrongETag(result.newVersion),
        'X-Request-Id': requestId,
      },
    });
  } catch (err) {
    logger.error('LEGAL_UPDATE_ERROR', 'Unexpected database error updating legal details', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return internalErrorResponse('Failed to persist legal issuer details', requestId);
  }
}
