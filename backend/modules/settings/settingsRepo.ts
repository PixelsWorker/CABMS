/**
 * CABMS G01 Settings Repository
 * Implements the approved Cloudflare D1 Request-Correlation Nonce Pattern
 * for atomic settings updates and durable audit event emission.
 */

import { D1Database } from '../../db/d1.ts';
import {
  ALLOWED_SETTINGS_KEYS,
  ALLOWED_LEGAL_KEYS,
} from '../../../contracts/settings.ts';
import type {
  WorkspaceSettingsRow,
  LegalIssuerRow,
  SettingsAuditEventRow,
  EditableWorkspaceSettings,
  EditableLegalDetails,
  MutationOutcome,
} from '../../../contracts/settings.ts';

export {
  ALLOWED_SETTINGS_KEYS,
  ALLOWED_LEGAL_KEYS,
};

export type {
  WorkspaceSettingsRow,
  LegalIssuerRow,
  SettingsAuditEventRow,
  EditableWorkspaceSettings,
  EditableLegalDetails,
  MutationOutcome,
};

/**
 * Fetch current workspace settings
 */
export async function getWorkspaceSettings(
  db: D1Database,
  workspaceId: string
): Promise<WorkspaceSettingsRow | null> {
  const stmt = db
    .prepare('SELECT * FROM workspace_settings WHERE workspace_id = ?')
    .bind(workspaceId);
  return stmt.first<WorkspaceSettingsRow>();
}

/**
 * Fetch current legal details
 */
export async function getLegalDetails(
  db: D1Database,
  workspaceId: string
): Promise<LegalIssuerRow | null> {
  const stmt = db
    .prepare('SELECT * FROM legal_issuers WHERE workspace_id = ?')
    .bind(workspaceId);
  return stmt.first<LegalIssuerRow>();
}

/**
 * Update workspace settings with Request-Correlation Nonce Pattern and atomic audit event insertion.
 */
export async function updateWorkspaceSettings(
  db: D1Database,
  params: {
    workspaceId: string;
    expectedVersion: number;
    patch: Partial<EditableWorkspaceSettings>;
    actorUserId: string;
    requestId: string;
    forcedAuditFailure?: boolean; // For testing atomicity rollback
  }
): Promise<MutationOutcome> {
  const { workspaceId, expectedVersion, patch, actorUserId, requestId, forcedAuditFailure } = params;

  // 1. Fetch current row
  const current = await getWorkspaceSettings(db, workspaceId);
  if (!current) {
    return { status: 'NOT_FOUND' };
  }

  // 2. Early precondition check
  if (current.version !== expectedVersion) {
    return { status: 'PRECONDITION_FAILED', currentVersion: current.version };
  }

  // 3. Filter patch to strictly allowlisted keys
  const merged: EditableWorkspaceSettings = {
    trading_name: patch.trading_name !== undefined ? patch.trading_name : current.trading_name,
    tagline: patch.tagline !== undefined ? patch.tagline : current.tagline,
    accent_color: patch.accent_color !== undefined ? patch.accent_color : current.accent_color,
    preferred_preset: patch.preferred_preset !== undefined ? patch.preferred_preset : current.preferred_preset,
    contact_email: patch.contact_email !== undefined ? patch.contact_email : current.contact_email,
    contact_phone: patch.contact_phone !== undefined ? patch.contact_phone : current.contact_phone,
    operational_address: patch.operational_address !== undefined ? patch.operational_address : current.operational_address,
    operating_hours: patch.operating_hours !== undefined ? patch.operating_hours : current.operating_hours,
  };

  // 4. Detect No-Op
  const changedKeys = ALLOWED_SETTINGS_KEYS.filter(key => merged[key] !== current[key]);
  if (changedKeys.length === 0) {
    return { status: 'NO_OP', current, version: current.version };
  }

  // 5. Build old/new values for audit with MANDATORY PRIVACY REDACTION
  // Under Section 19.5: contact_email, contact_phone, and operational_address are sensitive contact details
  // and must be redacted in durable audit logs to prevent perpetual retention of personally identifiable contact data.
  const SENSITIVE_SETTINGS_KEYS = new Set(['contact_email', 'contact_phone', 'operational_address']);
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const k of changedKeys) {
    if (SENSITIVE_SETTINGS_KEYS.has(k)) {
      oldValues[k] = current[k] ? '[REDACTED]' : null;
      newValues[k] = merged[k] ? '[REDACTED]' : null;
    } else {
      oldValues[k] = current[k];
      newValues[k] = merged[k];
    }
  }

  const reqNonce = crypto.randomUUID();
  const auditId = `aud_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Statement 1: Conditional Update capturing request nonce
  const stmt1 = db.prepare(
    `UPDATE workspace_settings
     SET trading_name = ?,
         tagline = ?,
         accent_color = ?,
         preferred_preset = ?,
         contact_email = ?,
         contact_phone = ?,
         operational_address = ?,
         operating_hours = ?,
         version = version + 1,
         transition_nonce = ?,
         updated_at = ?
     WHERE workspace_id = ? AND version = ?`
  ).bind(
    merged.trading_name,
    merged.tagline,
    merged.accent_color,
    merged.preferred_preset,
    merged.contact_email,
    merged.contact_phone,
    merged.operational_address,
    merged.operating_hours,
    reqNonce,
    now,
    workspaceId,
    expectedVersion
  );

  // Statement 2: Guarded Audit Insertion matching ONLY this request's nonce
  // If forcedAuditFailure is true, deliberately violate a constraint (non-null actor_user_id)
  const auditInsertSql = forcedAuditFailure
    ? `INSERT INTO settings_audit_events (id, workspace_id, resource_type, resource_id, event_type, old_version, new_version, old_values, new_values, actor_user_id, request_id, transition_nonce, created_at)
       SELECT ?, workspace_id, 'workspace_settings', workspace_id, 'SETTINGS_UPDATED', ?, version, ?, ?, NULL, ?, transition_nonce, ?
       FROM workspace_settings
       WHERE workspace_id = ? AND transition_nonce = ?` // NULL actor_user_id violates NOT NULL constraint!
    : `INSERT INTO settings_audit_events (id, workspace_id, resource_type, resource_id, event_type, old_version, new_version, old_values, new_values, actor_user_id, request_id, transition_nonce, created_at)
       SELECT ?, workspace_id, 'workspace_settings', workspace_id, 'SETTINGS_UPDATED', ?, version, ?, ?, ?, ?, transition_nonce, ?
       FROM workspace_settings
       WHERE workspace_id = ? AND transition_nonce = ?`;

  const stmt2 = db.prepare(auditInsertSql).bind(
    auditId,
    expectedVersion,
    JSON.stringify(oldValues),
    JSON.stringify(newValues),
    ...(forcedAuditFailure ? [] : [actorUserId]),
    requestId,
    now,
    workspaceId,
    reqNonce
  );

  // Execute atomic batch
  const batchRes = await db.batch([stmt1, stmt2]);

  const updateChanges = batchRes[0]?.meta?.changes ?? 0;
  const auditChanges = batchRes[1]?.meta?.changes ?? 0;

  // If zero rows updated (concurrent conflict or stale version between read and write)
  if (updateChanges === 0 || auditChanges === 0) {
    const fresh = await getWorkspaceSettings(db, workspaceId);
    return { status: 'PRECONDITION_FAILED', currentVersion: fresh?.version };
  }

  // Construct response directly from this request's committed values and transaction state
  // to avoid race conditions with subsequent concurrent writes overwriting the returned record.
  const nextVersion = current.version + 1;
  const updatedRecord: WorkspaceSettingsRow = {
    ...current,
    ...merged,
    version: nextVersion,
    transition_nonce: reqNonce,
    updated_at: now,
  };

  return {
    status: 'SUCCESS',
    newVersion: nextVersion,
    updated: updatedRecord,
    auditEventId: auditId,
    reqNonce,
  };
}

/**
 * Update legal details with Request-Correlation Nonce Pattern and atomic audit event insertion.
 * Enforces privacy redaction: ABN and licence numbers are masked in audit payload!
 */
export async function updateLegalDetails(
  db: D1Database,
  params: {
    workspaceId: string;
    expectedVersion: number;
    patch: Partial<EditableLegalDetails>;
    actorUserId: string;
    requestId: string;
    forcedAuditFailure?: boolean; // For testing atomicity rollback
  }
): Promise<MutationOutcome> {
  const { workspaceId, expectedVersion, patch, actorUserId, requestId, forcedAuditFailure } = params;

  // 1. Fetch current row
  const current = await getLegalDetails(db, workspaceId);
  if (!current) {
    return { status: 'NOT_FOUND' };
  }

  // 2. Precondition check
  if (current.version !== expectedVersion) {
    return { status: 'PRECONDITION_FAILED', currentVersion: current.version };
  }

  // 3. Filter patch
  const merged: EditableLegalDetails = {
    legal_issuer_name: patch.legal_issuer_name !== undefined ? patch.legal_issuer_name : current.legal_issuer_name,
    abn: patch.abn !== undefined ? patch.abn : current.abn,
    electrical_licence: patch.electrical_licence !== undefined ? patch.electrical_licence : current.electrical_licence,
    acma_cabler_registration: patch.acma_cabler_registration !== undefined ? patch.acma_cabler_registration : current.acma_cabler_registration,
    qbcc_licence: patch.qbcc_licence !== undefined ? patch.qbcc_licence : current.qbcc_licence,
  };

  // 4. Detect No-Op
  const changedKeys = ALLOWED_LEGAL_KEYS.filter(key => merged[key] !== current[key]);
  if (changedKeys.length === 0) {
    return { status: 'NO_OP', current, version: current.version };
  }

  // 5. Build old/new values for audit with MANDATORY PRIVACY REDACTION
  // Under Section 19.5: "Default to omitting raw ABNs, licence numbers and other potentially sensitive values
  // from ordinary audit payloads... Credentials, passwords, session tokens and authentication/provider tokens never enter audit events."
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const k of changedKeys) {
    if (k === 'legal_issuer_name') {
      oldValues[k] = current[k];
      newValues[k] = merged[k];
    } else {
      // Sensitive legal fields: REDACT raw numbers!
      oldValues[k] = current[k] ? '[REDACTED]' : null;
      newValues[k] = merged[k] ? '[REDACTED]' : null;
    }
  }

  const reqNonce = crypto.randomUUID();
  const auditId = `aud_${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Statement 1: Conditional Update
  const stmt1 = db.prepare(
    `UPDATE legal_issuers
     SET legal_issuer_name = ?,
         abn = ?,
         electrical_licence = ?,
         acma_cabler_registration = ?,
         qbcc_licence = ?,
         version = version + 1,
         transition_nonce = ?,
         updated_at = ?
     WHERE workspace_id = ? AND version = ?`
  ).bind(
    merged.legal_issuer_name,
    merged.abn,
    merged.electrical_licence,
    merged.acma_cabler_registration,
    merged.qbcc_licence,
    reqNonce,
    now,
    workspaceId,
    expectedVersion
  );

  // Statement 2: Guarded Audit Insertion matching ONLY this request's nonce
  const auditInsertSql = forcedAuditFailure
    ? `INSERT INTO settings_audit_events (id, workspace_id, resource_type, resource_id, event_type, old_version, new_version, old_values, new_values, actor_user_id, request_id, transition_nonce, created_at)
       SELECT ?, workspace_id, 'legal_issuer', id, 'LEGAL_DETAILS_UPDATED', ?, version, ?, ?, NULL, ?, transition_nonce, ?
       FROM legal_issuers
       WHERE workspace_id = ? AND transition_nonce = ?` // NOT NULL violation on actor_user_id
    : `INSERT INTO settings_audit_events (id, workspace_id, resource_type, resource_id, event_type, old_version, new_version, old_values, new_values, actor_user_id, request_id, transition_nonce, created_at)
       SELECT ?, workspace_id, 'legal_issuer', id, 'LEGAL_DETAILS_UPDATED', ?, version, ?, ?, ?, ?, transition_nonce, ?
       FROM legal_issuers
       WHERE workspace_id = ? AND transition_nonce = ?`;

  const stmt2 = db.prepare(auditInsertSql).bind(
    auditId,
    expectedVersion,
    JSON.stringify(oldValues),
    JSON.stringify(newValues),
    ...(forcedAuditFailure ? [] : [actorUserId]),
    requestId,
    now,
    workspaceId,
    reqNonce
  );

  const batchRes = await db.batch([stmt1, stmt2]);

  const updateChanges = batchRes[0]?.meta?.changes ?? 0;
  const auditChanges = batchRes[1]?.meta?.changes ?? 0;

  if (updateChanges === 0 || auditChanges === 0) {
    const fresh = await getLegalDetails(db, workspaceId);
    return { status: 'PRECONDITION_FAILED', currentVersion: fresh?.version };
  }

  // Construct response directly from this request's committed values and transaction state
  // to avoid race conditions with subsequent concurrent writes overwriting the returned record.
  const nextVersion = current.version + 1;
  const updatedRecord: LegalIssuerRow = {
    ...current,
    ...merged,
    version: nextVersion,
    transition_nonce: reqNonce,
    updated_at: now,
  };

  return {
    status: 'SUCCESS',
    newVersion: nextVersion,
    updated: updatedRecord,
    auditEventId: auditId,
    reqNonce,
  };
}

/**
 * Fetch audit events for a workspace (read-only verification)
 */
export async function getAuditEvents(
  db: D1Database,
  workspaceId: string,
  resourceType?: 'workspace_settings' | 'legal_issuer'
): Promise<SettingsAuditEventRow[]> {
  let query = 'SELECT * FROM settings_audit_events WHERE workspace_id = ?';
  const params: unknown[] = [workspaceId];
  if (resourceType) {
    query += ' AND resource_type = ?';
    params.push(resourceType);
  }
  query += ' ORDER BY created_at DESC';

  const res = await db.prepare(query).bind(...params).all<SettingsAuditEventRow>();
  return res.results;
}
