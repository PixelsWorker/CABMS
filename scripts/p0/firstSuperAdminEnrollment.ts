/**
 * CABMS PAAR-P0 — Atomic First Super Admin Enrollment Function
 *
 * Provides the D1-binding-injected enrollment function used by both the Mode A CLI
 * and same-runtime Worker integration tests.
 *
 * Implements:
 * - Unconditional NULL-safe precondition assertions
 * - Atomic D1.batch() execution with zero hardcoded statement count
 * - Unconditional NULL-safe C03 postcondition assertions
 * - Strict error classification:
 *     - Only verified constraint/trigger aborts -> NOT_ENROLLED
 *     - Transport/timeout/unclassified -> INDETERMINATE (zero second writes)
 * - Deep read-only reconciliation: CONFIRMED_ENROLLED, NOT_ENROLLED, INDETERMINATE, INCONSISTENT
 */

import type { D1Database, D1PreparedStatement } from '../../backend/db/d1.ts';
import type { VerifiedApprovalManifest } from './approvalManifest.ts';

export type EnrollmentOutcome =
  | { status: 'SUCCESS'; operationId: string; auditReference: string }
  | { status: 'NOT_ENROLLED'; error: string; rollbackProven: boolean; writeAttempted?: boolean }
  | { status: 'INDETERMINATE'; error: string };

export type ReconciliationOutcome =
  | 'CONFIRMED_ENROLLED'
  | 'NOT_ENROLLED'
  | 'INDETERMINATE'
  | 'INCONSISTENT';

export interface EnrollmentOptions {
  requestId?: string;
  forceTransportErrorAfterCommit?: boolean; // For T14 simulation
}

const KNOWN_TRIGGER_ABORT_MESSAGES = [
  'protected identity already exists',
  'protected identity is immutable',
  'protected authority cannot be deleted',
  'super admin approval does not match protected identity',
  'approval history key already exists',
  'approval history cannot be deleted',
  'approval may only be revoked once',
  'bootstrap completion already exists',
  'bootstrap identity mismatch',
  'bootstrap completion is immutable',
  'invalid recovery data',
  'recovery replay key already exists',
  'bootstrap reference missing',
  'invalid recovery sequence',
  'invalid prior uid',
  'recovery uid cannot be reused',
  'recovery history is immutable',
  'audit manifest records are immutable',
  'audit manifest records cannot be deleted',
  'bootstrap completion requires matching pre-inserted audit manifest',
] as const;

/**
 * Checks if an error is a positively identified SQLite engine constraint or trigger abort.
 * Never misclassifies timeouts, abort signals, or network failures as proven rollbacks.
 */
export function isSqliteConstraintOrTriggerAbort(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as { name?: string; errstr?: string; errcode?: number; message?: string };
  const message = error instanceof Error ? error.message : String(error);

  // Timeouts, AbortController abort signals, and network disruptions are uncertain / indeterminate
  if (
    anyErr.name === 'AbortError' ||
    anyErr.name === 'TimeoutError' ||
    /\b(timeout|timed out|abort signal|controller abort|network|econnrefused|econnreset)\b/i.test(message)
  ) {
    return false;
  }

  // SQLite constraint error code (SQLITE_CONSTRAINT is 19; extended codes have (code & 0xff) === 19)
  if (typeof anyErr.errcode === 'number' && (anyErr.errcode & 0xff) === 19) {
    return true;
  }
  if (anyErr.errstr === 'constraint failed') {
    return true;
  }

  // Standard SQLite constraint failed messages and D1 SQLITE_CONSTRAINT errors
  if (
    message.includes('CHECK constraint failed') ||
    message.includes('UNIQUE constraint failed') ||
    message.includes('FOREIGN KEY constraint failed') ||
    message.includes('NOT NULL constraint failed') ||
    message.includes('PRIMARY KEY constraint failed') ||
    message.startsWith('constraint failed') ||
    message.includes('SQLITE_CONSTRAINT')
  ) {
    return true;
  }

  // Known migration trigger abort messages
  return KNOWN_TRIGGER_ABORT_MESSAGES.some(m => message.includes(m));
}

/**
 * Executes the atomic first-Super-Admin enrollment sequence in a single D1.batch().
 */
export async function enrollFirstSuperAdmin(
  db: D1Database,
  verified: VerifiedApprovalManifest,
  options?: EnrollmentOptions
): Promise<EnrollmentOutcome> {
  const { manifest, audit_reference, canonical_manifest_json, signature_bytes, signing_key_id, signature_algorithm } = verified;
  const requestId = options?.requestId ?? `req_p0_${crypto.randomUUID()}`;
  const mappingId = `map_sa_primary_${crypto.randomUUID()}`;
  const auditId = `audit_p0_${crypto.randomUUID()}`;
  const scope = manifest.workspace_scope;

  // Guard: D1 limits statements to 100 bound parameters.
  // C03 postcondition statement binds 15 fixed + 4 per workspace in scope.
  // For N = 21: 15 + 4(21) = 99 <= 100.
  // For N = 22: 15 + 4(22) = 103 > 100.
  // Validation rejected before database write MUST NOT claim rollback occurred (rollbackProven: false).
  const MAX_D1_SCOPE_SIZE = 21;
  if (scope.length > MAX_D1_SCOPE_SIZE) {
    return {
      status: 'NOT_ENROLLED',
      error: `workspace_scope length ${scope.length} exceeds Mode A D1 parameter limit of 21 workspaces (15 + 4N <= 100)`,
      rollbackProven: false,
      writeAttempted: false,
    };
  }

  // Build statement array for D1.batch()
  const statements: D1PreparedStatement[] = [];

  // 1. Unconditional, NULL-safe in-transaction precondition assertion
  statements.push(
    db.prepare(`
      INSERT INTO g01_security_assertions (value)
      SELECT 1 WHERE NOT COALESCE((
        (SELECT COUNT(*) FROM g01_protected_super_admin) = 0
        AND (SELECT COUNT(*) FROM g01_bootstrap_completion) = 0
        AND (SELECT COUNT(*) FROM paar_p0_bootstrap_audit_manifests) = 0
        AND (SELECT COUNT(*) FROM privileged_identity_approvals WHERE role = 'super_admin') = 0
      ), 0)
    `)
  );

  // 2. Create approved synthetic user
  statements.push(
    db.prepare(`
      INSERT INTO users (id, email, display_name, created_at, updated_at)
      VALUES ('usr_primary_super_admin', ?, 'Primary Super Admin', datetime('now'), datetime('now'))
    `).bind(manifest.operator_email)
  );

  // 3. Create identity mapping
  statements.push(
    db.prepare(`
      INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
      VALUES (?, 'usr_primary_super_admin', 'firebase', ?, datetime('now'))
    `).bind(mappingId, manifest.operator_uid)
  );

  // 4. Create approved workspace memberships
  for (const workspaceId of scope) {
    const memId = `mem_sa_primary_${workspaceId}`;
    statements.push(
      db.prepare(`
        INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
        VALUES (?, ?, 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now'))
      `).bind(memId, workspaceId)
    );
  }

  // 5. Create protected singleton
  statements.push(
    db.prepare(`
      INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by)
      VALUES (1, 'usr_primary_super_admin', 'firebase', ?, datetime('now'), ?)
    `).bind(manifest.operator_uid, manifest.approval_identity)
  );

  // 6. Create matching active approvals
  for (const workspaceId of scope) {
    const approvalId = `appr_sa_primary_${workspaceId}`;
    statements.push(
      db.prepare(`
        INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by)
        VALUES (?, 'usr_primary_super_admin', 'firebase', ?, ?, 'super_admin', datetime('now'), ?)
      `).bind(approvalId, manifest.operator_uid, workspaceId, manifest.approval_identity)
    );
  }

  // 7. Insert append-only signed audit manifest with independent unique nonce and operation_id
  statements.push(
    db.prepare(`
      INSERT INTO paar_p0_bootstrap_audit_manifests (
        id, operation_id, nonce, target_id, operator_email, operator_uid,
        workspace_scope, permitted_action, signing_key_id, signature_algorithm,
        signature_bytes, canonical_manifest_json, audit_reference, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind(
      auditId,
      manifest.operation_id,
      manifest.nonce,
      manifest.target_id,
      manifest.operator_email,
      manifest.operator_uid,
      manifest.workspace_scope.join(','),
      manifest.permitted_action,
      signing_key_id,
      signature_algorithm,
      signature_bytes,
      canonical_manifest_json,
      audit_reference
    )
  );

  // 8. Insert bootstrap completion (validates audit trigger and identity trigger)
  statements.push(
    db.prepare(`
      INSERT INTO g01_bootstrap_completion (
        singleton, original_firebase_uid, completed_at, completed_by,
        operation_id, request_id, audit_reference
      ) VALUES (1, ?, datetime('now'), ?, ?, ?, ?)
    `).bind(
      manifest.operator_uid,
      manifest.approval_identity,
      manifest.operation_id,
      requestId,
      audit_reference
    )
  );

  // 9. Unconditional C03 NULL-safe failure-only postcondition assertions
  const scopePlaceholders = scope.map(() => '?').join(',');
  statements.push(
    db.prepare(`
      INSERT INTO g01_security_assertions (value)
      SELECT 1 WHERE NOT COALESCE((
        -- C03-01: Exactly one enabled user usr_primary_super_admin with disabled = 0
        (SELECT COUNT(*) FROM users WHERE id = 'usr_primary_super_admin' AND disabled = 0) = 1
        -- C03-02: Exactly one identity mapping for usr_primary_super_admin matching operator_uid
        AND (SELECT COUNT(*) FROM user_identity_mappings WHERE user_id = 'usr_primary_super_admin' AND provider_id = 'firebase' AND provider_subject_id = ?) = 1
        -- C03-03: Matching g01_protected_super_admin singleton with correct user_id and provider_subject_id
        AND (SELECT COUNT(*) FROM g01_protected_super_admin WHERE singleton = 1 AND user_id = 'usr_primary_super_admin' AND provider_subject_id = ?) = 1
        -- C03-04: Exactly the approved workspace memberships, zero memberships outside signed scope, and no non-super_admin roles
        AND (SELECT COUNT(*) FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin') = ?
        AND (SELECT COUNT(*) FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin' AND (role != 'super_admin' OR workspace_id NOT IN (${scopePlaceholders}))) = 0
        AND (SELECT COUNT(DISTINCT workspace_id) FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin' AND role = 'super_admin' AND workspace_id IN (${scopePlaceholders})) = ?
        -- C03-05: Exactly one active approval per approved workspace matching operator UID, zero approvals outside signed scope, and no non-super_admin or non-firebase approvals
        AND (SELECT COUNT(*) FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND revoked_at IS NULL) = ?
        AND (SELECT COUNT(*) FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND revoked_at IS NULL AND (role != 'super_admin' OR provider_id != 'firebase' OR provider_subject_id != ? OR workspace_id NOT IN (${scopePlaceholders}))) = 0
        AND (SELECT COUNT(DISTINCT workspace_id) FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND role = 'super_admin' AND provider_id = 'firebase' AND provider_subject_id = ? AND revoked_at IS NULL AND workspace_id IN (${scopePlaceholders})) = ?
        -- C03-06: No prior revoked approvals for this user/role
        AND (SELECT COUNT(*) FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND role = 'super_admin' AND revoked_at IS NOT NULL) = 0
        -- C03-07: Matching audit record with operation_id and audit_reference
        AND (SELECT COUNT(*) FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ? AND audit_reference = ?) = 1
        -- C03-08: Matching bootstrap completion record
        AND (SELECT COUNT(*) FROM g01_bootstrap_completion WHERE singleton = 1 AND operation_id = ? AND audit_reference = ? AND original_firebase_uid = ?) = 1
        -- C03-09: g01_effective_super_admin_uid resolves to operator_uid
        AND (SELECT provider_subject_id FROM g01_effective_super_admin_uid) = ?
        -- C03-10: No invalid prior recovery state
        AND (SELECT COUNT(*) FROM g01_super_admin_recovery_events) = 0
      ), 0)
    `).bind(
      manifest.operator_uid,
      manifest.operator_uid,
      scope.length,
      ...scope,
      ...scope,
      scope.length,
      scope.length,
      manifest.operator_uid,
      ...scope,
      manifest.operator_uid,
      ...scope,
      scope.length,
      manifest.operation_id,
      audit_reference,
      manifest.operation_id,
      audit_reference,
      manifest.operator_uid,
      manifest.operator_uid
    )
  );

  try {
    const results = await db.batch(statements);
    if (!results || results.length !== statements.length || results.some(r => !r.success)) {
      throw new Error('Batch execution failed: one or more statements did not succeed');
    }

    // Simulation hook for T14: force transport exception after successful commit
    if (options?.forceTransportErrorAfterCommit) {
      throw new Error('SIMULATED_TRANSPORT_TIMEOUT: network dropped before response reached caller');
    }

    return {
      status: 'SUCCESS',
      operationId: manifest.operation_id,
      auditReference: audit_reference,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Only positively identified SQLite constraints or triggers establish NOT_ENROLLED rollback
    if (isSqliteConstraintOrTriggerAbort(error)) {
      return {
        status: 'NOT_ENROLLED',
        error: message,
        rollbackProven: true,
      };
    }

    // Every transport, timeout, or unclassified error yields INDETERMINATE (zero second writes!)
    return {
      status: 'INDETERMINATE',
      error: message,
    };
  }
}

export interface ReconcileOptions {
  settled?: boolean;
}

/**
 * Deep read-only reconciliation function.
 * Called ONLY when outcome is uncertain (INDETERMINATE).
 * Asserts zero second write calls and fails closed to INDETERMINATE on any read failure.
 */
export async function reconcileEnrollmentStatus(
  db: D1Database,
  operationId: string,
  expectedUid: string,
  expectedAuditRef: string,
  expectedScopeLengthOrList?: number | readonly string[],
  options?: ReconcileOptions
): Promise<ReconciliationOutcome> {
  try {
    // Query completion, audit, protected identity, mappings, memberships, approvals, user status
    const compRow = await db
      .prepare('SELECT singleton, original_firebase_uid, operation_id, audit_reference FROM g01_bootstrap_completion WHERE operation_id = ?')
      .bind(operationId)
      .first<{ singleton: number; original_firebase_uid: string; operation_id: string; audit_reference: string }>();

    const auditRow = await db
      .prepare('SELECT operation_id, operator_uid, audit_reference, workspace_scope, canonical_manifest_json FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?')
      .bind(operationId)
      .first<{ operation_id: string; operator_uid: string; audit_reference: string; workspace_scope: string; canonical_manifest_json: string }>();

    const totalAuditCount = (
      await db
        .prepare('SELECT COUNT(*) AS n FROM paar_p0_bootstrap_audit_manifests')
        .first<{ n: number }>()
    )?.n ?? 0;

    const effectiveUidRow = await db
      .prepare('SELECT provider_subject_id FROM g01_effective_super_admin_uid')
      .first<{ provider_subject_id: string | null }>();
    const effectiveUid = effectiveUidRow?.provider_subject_id ?? null;

    const protectedRow = await db
      .prepare('SELECT singleton, user_id, provider_id, provider_subject_id FROM g01_protected_super_admin WHERE singleton = 1')
      .first<{ singleton: number; user_id: string; provider_id: string; provider_subject_id: string }>();

    // Atomic snapshot read for user and memberships via single read statement (SQLite statement snapshot isolation)
    const userAndMembershipsRes = await db
      .prepare(`
        SELECT 'user' AS kind, u.id AS k1, CAST(u.disabled AS TEXT) AS k2
        FROM users u WHERE u.id = 'usr_primary_super_admin'
        UNION ALL
        SELECT 'membership' AS kind, wm.workspace_id AS k1, wm.role AS k2
        FROM workspace_memberships wm WHERE wm.user_id = 'usr_primary_super_admin'
      `)
      .all<{ kind: string; k1: string; k2: string }>();

    const uAndMRows = userAndMembershipsRes.results ?? [];
    const uRow = uAndMRows.find(r => r.kind === 'user');
    const userRow = uRow ? { id: uRow.k1, disabled: Number(uRow.k2) } : undefined;
    const membershipRows = uAndMRows
      .filter(r => r.kind === 'membership')
      .map(r => ({ workspace_id: r.k1, role: r.k2 }));

    const mappingCounts = await db
      .prepare(`
        SELECT
          COUNT(CASE WHEN provider_id = 'firebase' AND provider_subject_id = ? THEN 1 END) AS firebase_match,
          COUNT(*) AS total
        FROM user_identity_mappings
        WHERE user_id = 'usr_primary_super_admin'
      `)
      .bind(expectedUid)
      .first<{ firebase_match: number; total: number }>();
    const firebaseMappingCount = mappingCounts?.firebase_match ?? 0;
    const totalMappingCount = mappingCounts?.total ?? 0;

    const approvalsRes = await db
      .prepare("SELECT workspace_id, role, provider_id, provider_subject_id FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND revoked_at IS NULL")
      .all<{ workspace_id: string; role: string; provider_id: string; provider_subject_id: string }>();
    const approvalRows = approvalsRes.results ?? [];

    // Derive approved workspace set (CR-08: Caller's verified expectedScopeList is strictly authoritative)
    let callerExpectedWorkspaces: string[] | undefined;
    if (Array.isArray(expectedScopeLengthOrList)) {
      callerExpectedWorkspaces = [...expectedScopeLengthOrList].sort();
    }

    // Read workspace IDs from lossless array in canonical_manifest_json when available
    let manifestArrayMalformed = false;
    const auditWorkspaces = (() => {
      if (!auditRow) return [];
      if (auditRow.canonical_manifest_json) {
        try {
          const parsed = JSON.parse(auditRow.canonical_manifest_json) as Record<string, unknown>;
          if (Array.isArray(parsed.workspace_scope)) {
            return (parsed.workspace_scope as unknown[]).map(String).sort();
          } else if (callerExpectedWorkspaces) {
            manifestArrayMalformed = true;
          }
        } catch {
          if (callerExpectedWorkspaces) {
            manifestArrayMalformed = true;
          }
        }
      } else if (callerExpectedWorkspaces) {
        manifestArrayMalformed = true;
      }
      return auditRow.workspace_scope
        ? auditRow.workspace_scope.split(',').map(s => s.trim()).filter(Boolean).sort()
        : [];
    })();

    const expectedWorkspaces = callerExpectedWorkspaces ?? auditWorkspaces;

    const actualMembershipWorkspaces = membershipRows
      .filter(m => m.role === 'super_admin')
      .map(m => m.workspace_id)
      .sort();

    const actualApprovalWorkspaces = approvalRows
      .filter(a => a.role === 'super_admin')
      .map(a => a.workspace_id)
      .sort();

    const expectedLength = typeof expectedScopeLengthOrList === 'number'
      ? expectedScopeLengthOrList
      : expectedWorkspaces.length;

    const setsEqual = (a: string[], b: string[]) =>
      a.length === b.length && a.every((val, idx) => val === b[idx]);

    const auditMatchesCaller = !callerExpectedWorkspaces || setsEqual(callerExpectedWorkspaces, auditWorkspaces);

    const isScopeConsistent =
      !manifestArrayMalformed &&
      expectedWorkspaces.length > 0 &&
      auditMatchesCaller &&
      setsEqual(expectedWorkspaces, actualMembershipWorkspaces) &&
      setsEqual(expectedWorkspaces, actualApprovalWorkspaces) &&
      (typeof expectedScopeLengthOrList !== 'number' || actualMembershipWorkspaces.length === expectedScopeLengthOrList) &&
      membershipRows.length === expectedLength &&
      approvalRows.length === expectedLength &&
      membershipRows.every(m => m.role === 'super_admin') &&
      approvalRows.every(a => a.role === 'super_admin' && a.provider_id === 'firebase' && a.provider_subject_id === expectedUid);

    // Case 1: Complete, active user, and fully consistent
    if (
      compRow &&
      auditRow &&
      protectedRow &&
      userRow &&
      userRow.disabled === 0 &&
      compRow.singleton === 1 &&
      compRow.original_firebase_uid === expectedUid &&
      compRow.audit_reference === expectedAuditRef &&
      auditRow.operator_uid === expectedUid &&
      auditRow.audit_reference === expectedAuditRef &&
      protectedRow.user_id === 'usr_primary_super_admin' &&
      protectedRow.provider_id === 'firebase' &&
      protectedRow.provider_subject_id === expectedUid &&
      effectiveUid === expectedUid &&
      firebaseMappingCount === 1 &&
      totalMappingCount === 1 &&
      isScopeConsistent
    ) {
      return 'CONFIRMED_ENROLLED';
    }

    // Case 2: Clean database with zero records
    if (
      !compRow &&
      !auditRow &&
      totalAuditCount === 0 &&
      !protectedRow &&
      !userRow &&
      totalMappingCount === 0 &&
      membershipRows.length === 0 &&
      approvalRows.length === 0
    ) {
      if (options?.settled !== true) {
        return 'INDETERMINATE';
      }
      return 'NOT_ENROLLED';
    }

    // Case 3: Partial or contradictory records
    if (
      compRow ||
      auditRow ||
      totalAuditCount > 0 ||
      protectedRow ||
      userRow ||
      totalMappingCount > 0 ||
      membershipRows.length > 0 ||
      approvalRows.length > 0
    ) {
      return 'INCONSISTENT';
    }

    return 'INDETERMINATE';
  } catch {
    // Fail closed to INDETERMINATE on any read query exception / SQLite error
    return 'INDETERMINATE';
  }
}
