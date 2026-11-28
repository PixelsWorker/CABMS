/** Atomic existing-user transaction. The caller must attest the real target before invoking it. */
import {randomUUID} from 'node:crypto';
import {isDisposableInMemoryD1,type D1Database,type D1PreparedStatement} from '../../backend/db/d1.ts';
import {isSqliteConstraintOrTriggerAbort,type EnrollmentOutcome} from './firstSuperAdminEnrollment.ts';
import {isVerifiedModeBApproval,type VerifiedModeBApproval} from './modeBContract.ts';

export function buildModeBStatements(db:D1Database, approval:Readonly<VerifiedModeBApproval>):D1PreparedStatement[] {
 if (!isVerifiedModeBApproval(approval)) throw new Error('A verified Mode B approval is required');
 const m=approval.manifest, scope=m.workspace_scope;
 if (!scope.length || scope.length>21) throw new Error('Unsupported workspace scope');
 const scopeJson=JSON.stringify(scope), requestId=`req_mode_b_${randomUUID()}`;
 const statements:D1PreparedStatement[]=[
  db.prepare(`INSERT INTO g01_security_assertions(value) SELECT 1 WHERE NOT COALESCE((
   (SELECT count(*) FROM users WHERE id=? AND email=? AND disabled=0)=1
   AND (SELECT count(*) FROM user_identity_mappings WHERE user_id=? AND provider_id='firebase' AND provider_subject_id=?)=1
   AND (SELECT count(*) FROM user_identity_mappings WHERE user_id=?)=1
   AND (SELECT count(*) FROM workspace_memberships WHERE user_id=?)=0
   AND (SELECT count(*) FROM privileged_identity_approvals WHERE user_id=?)=0
   AND (SELECT count(*) FROM g01_protected_super_admin)=0 AND (SELECT count(*) FROM g01_bootstrap_completion)=0
   AND (SELECT count(*) FROM paar_p0_bootstrap_audit_manifests)=0 AND (SELECT count(*) FROM g01_super_admin_recovery_events)=0
   AND (SELECT count(*) FROM workspaces WHERE id IN (SELECT value FROM json_each(?)))=?
  ),0)`).bind(m.target_user_id,m.operator_email,m.target_user_id,m.operator_uid,m.target_user_id,m.target_user_id,m.target_user_id,scopeJson,scope.length),
 ];
 for (const workspace of scope) statements.push(db.prepare(`INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,?,?,'super_admin',datetime('now'),datetime('now'))`).bind(`mem_b_${randomUUID()}`,workspace,m.target_user_id));
 statements.push(db.prepare(`INSERT INTO g01_protected_super_admin(singleton,user_id,provider_id,provider_subject_id,assigned_at,assigned_by) VALUES(1,?,'firebase',?,datetime('now'),?)`).bind(m.target_user_id,m.operator_uid,m.approval_identity));
 for (const workspace of scope) statements.push(db.prepare(`INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES(?,?,'firebase',?,?,'super_admin',datetime('now'),?)`).bind(`appr_b_${randomUUID()}`,m.target_user_id,m.operator_uid,workspace,m.approval_identity));
 statements.push(db.prepare(`INSERT INTO paar_p0_bootstrap_audit_manifests(id,operation_id,nonce,target_id,operator_email,operator_uid,workspace_scope,permitted_action,signing_key_id,signature_algorithm,signature_bytes,canonical_manifest_json,audit_reference,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(`audit_b_${randomUUID()}`,m.operation_id,m.nonce,m.target_id,m.operator_email,m.operator_uid,scope.join(','),m.permitted_action,approval.signing_key_id,approval.signature_algorithm,approval.signature_bytes,approval.canonical_manifest_json,approval.audit_reference));
 statements.push(db.prepare(`INSERT INTO g01_bootstrap_completion(singleton,original_firebase_uid,completed_at,completed_by,operation_id,request_id,audit_reference) VALUES(1,?,datetime('now'),?,?,?,?)`).bind(m.operator_uid,m.approval_identity,m.operation_id,requestId,approval.audit_reference));
 statements.push(db.prepare(`INSERT INTO g01_security_assertions(value) SELECT 1 WHERE NOT COALESCE((
  (SELECT count(*) FROM users WHERE id=? AND email=? AND disabled=0)=1
  AND (SELECT count(*) FROM user_identity_mappings WHERE user_id=? AND provider_id='firebase' AND provider_subject_id=?)=1
  AND (SELECT count(*) FROM user_identity_mappings WHERE user_id=?)=1
  AND (SELECT count(*) FROM g01_protected_super_admin WHERE singleton=1 AND user_id=? AND provider_id='firebase' AND provider_subject_id=?)=1
  AND (SELECT count(*) FROM workspace_memberships WHERE user_id=?)=?
  AND (SELECT count(*) FROM workspace_memberships WHERE user_id=? AND role='super_admin' AND workspace_id IN (SELECT value FROM json_each(?)))=?
  AND (SELECT count(*) FROM privileged_identity_approvals WHERE user_id=?)=?
  AND (SELECT count(*) FROM privileged_identity_approvals WHERE user_id=? AND revoked_at IS NULL AND role='super_admin' AND provider_id='firebase' AND provider_subject_id=? AND workspace_id IN (SELECT value FROM json_each(?)))=?
  AND (SELECT count(*) FROM paar_p0_bootstrap_audit_manifests WHERE operation_id=? AND audit_reference=? AND canonical_manifest_json=? AND signature_bytes=? AND created_at>=? AND created_at<=?)=1
  AND (SELECT count(*) FROM paar_p0_bootstrap_audit_manifests)=1
  AND (SELECT count(*) FROM g01_bootstrap_completion WHERE singleton=1 AND operation_id=? AND audit_reference=? AND original_firebase_uid=?)=1
  AND (SELECT provider_subject_id FROM g01_effective_super_admin_uid)=?
  AND (SELECT count(*) FROM g01_super_admin_recovery_events)=0
 ),0)`).bind(m.target_user_id,m.operator_email,m.target_user_id,m.operator_uid,m.target_user_id,m.target_user_id,m.operator_uid,m.target_user_id,scope.length,m.target_user_id,scopeJson,scope.length,m.target_user_id,scope.length,m.target_user_id,m.operator_uid,scopeJson,scope.length,m.operation_id,approval.audit_reference,approval.canonical_manifest_json,approval.signature_bytes,m.issued_at,m.expires_at,m.operation_id,approval.audit_reference,m.operator_uid,m.operator_uid));
 return statements;
}

export async function enrollModeBExistingUser(db:D1Database,approval:Readonly<VerifiedModeBApproval>):Promise<EnrollmentOutcome> {
 // Fail closed until an independently reviewed cloud-target capability exists.
 if (!isDisposableInMemoryD1(db)) throw new Error('Mode B cloud enrollment is not enabled');
 const statements=buildModeBStatements(db,approval);
 try {
  const results=await db.batch(statements);
  if (results.length!==statements.length || results.some(r=>!r.success)) throw new Error('Batch did not confirm success');
  return {status:'SUCCESS',operationId:approval.manifest.operation_id,auditReference:approval.audit_reference};
 } catch (error) {
  const message=error instanceof Error ? error.message : String(error);
  // Remote transport rollback and error formats are not yet verified; fail closed.
  if (isDisposableInMemoryD1(db) && isSqliteConstraintOrTriggerAbort(error)) return {status:'NOT_ENROLLED',error:message,rollbackProven:true};
  return {status:'INDETERMINATE',error:message};
 }
}
