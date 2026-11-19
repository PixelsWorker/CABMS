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
  // C03 postcondition statement binds 16 fixed + 4 per workspace in scope.
  // For N = 21: 16 + 4(21) = 100 <= 100.
  // For N = 22: 16 + 4(22) = 104 > 100.
  // Validation rejected before database write MUST NOT claim rollback occurred (rollbackProven: false).
  const MAX_D1_SCOPE_SIZE = 21;
  if (scope.length > MAX_D1_SCOPE_SIZE) {
    return {
      status: 'NOT_ENROLLED',
      error: `workspace_scope length ${scope.length} exceeds Mode A D1 parameter limit of 21 workspaces (16 + 4N <= 100)`,
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
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
        -- C03-02: Exactly one identity mapping for usr_primary_super_admin matching operator_uid and no additional mappings
        AND (SELECT COUNT(*) FROM user_identity_mappings WHERE user_id = 'usr_primary_super_admin' AND provider_id = 'firebase' AND provider_subject_id = ?) = 1
        AND (SELECT COUNT(*) FROM user_identity_mappings WHERE user_id = 'usr_primary_super_admin') = 1
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
        -- C03-07: Matching audit record with operation_id, audit_reference, and created_at within manifest validity window
        AND (SELECT COUNT(*) FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ? AND audit_reference = ? AND created_at >= ? AND created_at <= ?) = 1
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
      new Date(manifest.issued_at).toISOString(),
      new Date(manifest.expires_at).toISOString(),
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
  verifiedManifest?: {
    signature_bytes: string;
    signature_algorithm: string;
    signing_key_id: string;
    canonical_manifest_json?: string;
  };
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
  expectedScope: readonly string[],
  options?: ReconcileOptions
): Promise<ReconciliationOutcome> {
  // Finding F: Caller's verified workspace list is strictly required. Reject numeric or invalid input fail-closed to INDETERMINATE.
  if (
    !Array.isArray(expectedScope) ||
    expectedScope.length === 0 ||
    !expectedScope.every(s => typeof s === 'string' && s.trim().length > 0)
  ) {
    return 'INDETERMINATE';
  }

  if (
    typeof operationId !== 'string' ||
    typeof expectedUid !== 'string' ||
    typeof expectedAuditRef !== 'string' ||
    !operationId ||
    !expectedUid ||
    !expectedAuditRef
  ) {
    return 'INDETERMINATE';
  }

  try {
    // Finding A: Consolidate authorization state into a single consistent SQL statement snapshot.
    // Guaranteed single-snapshot consistency by SQLite statement-level transaction isolation.
    const singleSnapshotSql = `
      SELECT 'completion' AS kind, CAST(singleton AS TEXT) AS k1, original_firebase_uid AS k2, operation_id AS k3, audit_reference AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM g01_bootstrap_completion WHERE operation_id = ?
      UNION ALL
      SELECT 'audit_manifest' AS kind, operation_id AS k1, operator_uid AS k2, audit_reference AS k3, workspace_scope AS k4, canonical_manifest_json AS k5, signature_bytes AS k6, signature_algorithm AS k7, signing_key_id AS k8
      FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?
      UNION ALL
      SELECT 'audit_count' AS kind, CAST(COUNT(*) AS TEXT) AS k1, NULL AS k2, NULL AS k3, NULL AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM paar_p0_bootstrap_audit_manifests
      UNION ALL
      SELECT 'effective_uid' AS kind, provider_subject_id AS k1, NULL AS k2, NULL AS k3, NULL AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM g01_effective_super_admin_uid
      UNION ALL
      SELECT 'protected_admin' AS kind, CAST(singleton AS TEXT) AS k1, user_id AS k2, provider_id AS k3, provider_subject_id AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM g01_protected_super_admin WHERE singleton = 1
      UNION ALL
      SELECT 'user' AS kind, id AS k1, CAST(disabled AS TEXT) AS k2, NULL AS k3, NULL AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM users WHERE id = 'usr_primary_super_admin'
      UNION ALL
      SELECT 'membership' AS kind, workspace_id AS k1, role AS k2, NULL AS k3, NULL AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM workspace_memberships WHERE user_id = 'usr_primary_super_admin'
      UNION ALL
      SELECT 'mapping' AS kind, provider_id AS k1, provider_subject_id AS k2, NULL AS k3, NULL AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM user_identity_mappings WHERE user_id = 'usr_primary_super_admin'
      UNION ALL
      SELECT 'approval' AS kind, workspace_id AS k1, role AS k2, provider_id AS k3, provider_subject_id AS k4, NULL AS k5, NULL AS k6, NULL AS k7, NULL AS k8
      FROM privileged_identity_approvals WHERE user_id = 'usr_primary_super_admin' AND revoked_at IS NULL
    `;

    const res = await db.prepare(singleSnapshotSql).bind(operationId, operationId).all<{
      kind: string;
      k1: string | null;
      k2: string | null;
      k3: string | null;
      k4: string | null;
      k5: string | null;
      k6: string | null;
      k7: string | null;
      k8: string | null;
    }>();

    const rows = res.results ?? [];

    const compRowRaw = rows.find(r => r.kind === 'completion');
    const compRow = compRowRaw
      ? {
          singleton: Number(compRowRaw.k1),
          original_firebase_uid: compRowRaw.k2!,
          operation_id: compRowRaw.k3!,
          audit_reference: compRowRaw.k4!,
        }
      : undefined;

    const auditRowRaw = rows.find(r => r.kind === 'audit_manifest');
    const auditRow = auditRowRaw
      ? {
          operation_id: auditRowRaw.k1!,
          operator_uid: auditRowRaw.k2!,
          audit_reference: auditRowRaw.k3!,
          workspace_scope: auditRowRaw.k4!,
          canonical_manifest_json: auditRowRaw.k5!,
          signature_bytes: auditRowRaw.k6!,
          signature_algorithm: auditRowRaw.k7!,
          signing_key_id: auditRowRaw.k8!,
        }
      : undefined;

    const countRowRaw = rows.find(r => r.kind === 'audit_count');
    const totalAuditCount = countRowRaw?.k1 ? Number(countRowRaw.k1) : 0;

    const effectiveUidRowRaw = rows.find(r => r.kind === 'effective_uid');
    const effectiveUid = effectiveUidRowRaw?.k1 ?? null;

    const protectedRowRaw = rows.find(r => r.kind === 'protected_admin');
    const protectedRow = protectedRowRaw
      ? {
          singleton: Number(protectedRowRaw.k1),
          user_id: protectedRowRaw.k2!,
          provider_id: protectedRowRaw.k3!,
          provider_subject_id: protectedRowRaw.k4!,
        }
      : undefined;

    const userRowRaw = rows.find(r => r.kind === 'user');
    const userRow = userRowRaw
      ? {
          id: userRowRaw.k1!,
          disabled: Number(userRowRaw.k2),
        }
      : undefined;

    const membershipRows = rows
      .filter(r => r.kind === 'membership')
      .map(r => ({ workspace_id: r.k1!, role: r.k2! }));

    const mappingRows = rows
      .filter(r => r.kind === 'mapping')
      .map(r => ({ provider_id: r.k1!, provider_subject_id: r.k2! }));
    const firebaseMappingCount = mappingRows.filter(
      m => m.provider_id === 'firebase' && m.provider_subject_id === expectedUid
    ).length;
    const totalMappingCount = mappingRows.length;

    const approvalRows = rows
      .filter(r => r.kind === 'approval')
      .map(r => ({
        workspace_id: r.k1!,
        role: r.k2!,
        provider_id: r.k3!,
        provider_subject_id: r.k4!,
      }));

    const callerExpectedWorkspaces = [...expectedScope].sort();

    // Read workspace IDs from lossless array in canonical_manifest_json when available
    let manifestArrayMalformed = false;
    const auditWorkspaces = (() => {
      if (!auditRow) return [];
      if (auditRow.canonical_manifest_json) {
        try {
          const parsed = JSON.parse(auditRow.canonical_manifest_json) as Record<string, unknown>;
          if (Array.isArray(parsed.workspace_scope)) {
            return (parsed.workspace_scope as unknown[]).map(String).sort();
          } else {
            manifestArrayMalformed = true;
          }
        } catch {
          manifestArrayMalformed = true;
        }
      } else {
        manifestArrayMalformed = true;
      }
      return auditRow.workspace_scope
        ? auditRow.workspace_scope.split(',').map(s => s.trim()).filter(Boolean).sort()
        : [];
    })();

    const expectedWorkspaces = callerExpectedWorkspaces;

    const actualMembershipWorkspaces = membershipRows
      .filter(m => m.role === 'super_admin')
      .map(m => m.workspace_id)
      .sort();

    const actualApprovalWorkspaces = approvalRows
      .filter(a => a.role === 'super_admin')
      .map(a => a.workspace_id)
      .sort();

    const setsEqual = (a: string[], b: string[]) =>
      a.length === b.length && a.every((val, idx) => val === b[idx]);

    const auditMatchesCaller = setsEqual(callerExpectedWorkspaces, auditWorkspaces);

    const isScopeConsistent =
      !manifestArrayMalformed &&
      expectedWorkspaces.length > 0 &&
      auditMatchesCaller &&
      setsEqual(expectedWorkspaces, actualMembershipWorkspaces) &&
      setsEqual(expectedWorkspaces, actualApprovalWorkspaces) &&
      membershipRows.length === expectedWorkspaces.length &&
      approvalRows.length === expectedWorkspaces.length &&
      membershipRows.every(m => m.role === 'super_admin') &&
      approvalRows.every(a => a.role === 'super_admin' && a.provider_id === 'firebase' && a.provider_subject_id === expectedUid);

    const matchesVerifiedManifest =
      !options?.verifiedManifest ||
      (auditRow !== undefined &&
        auditRow.signature_bytes === options.verifiedManifest.signature_bytes &&
        auditRow.signature_algorithm === options.verifiedManifest.signature_algorithm &&
        auditRow.signing_key_id === options.verifiedManifest.signing_key_id &&
        (!options.verifiedManifest.canonical_manifest_json ||
          auditRow.canonical_manifest_json === options.verifiedManifest.canonical_manifest_json));

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
      matchesVerifiedManifest &&
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
