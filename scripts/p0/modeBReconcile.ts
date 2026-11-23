/** Read-only single-statement reconciliation. The binding must be independently attested. */
import type {D1Database} from '../../backend/db/d1.ts';
import {isVerifiedModeBApproval,type VerifiedModeBApproval} from './modeBContract.ts';

export type ModeBReconciliation='CONFIRMED_ENROLLED'|'NOT_ENROLLED'|'INCONSISTENT'|'INDETERMINATE';
export async function reconcileModeB(db:D1Database,approval:Readonly<VerifiedModeBApproval>,options:{settled:boolean}):Promise<ModeBReconciliation> {
 if (!isVerifiedModeBApproval(approval)) return 'INDETERMINATE';
 const m=approval.manifest, scope=JSON.stringify(m.workspace_scope), n=m.workspace_scope.length;
 try {
  const row=await db.prepare(`SELECT
   (SELECT count(*) FROM users WHERE id=? AND email=? AND disabled=0) AS user_ok,
   (SELECT count(*) FROM user_identity_mappings WHERE user_id=?) AS mappings,
   (SELECT count(*) FROM user_identity_mappings WHERE user_id=? AND provider_id='firebase' AND provider_subject_id=?) AS mapping_ok,
   (SELECT count(*) FROM workspace_memberships WHERE user_id=?) AS memberships,
   (SELECT count(*) FROM workspace_memberships WHERE user_id=? AND role='super_admin' AND workspace_id IN (SELECT value FROM json_each(?))) AS memberships_ok,
   (SELECT count(*) FROM privileged_identity_approvals WHERE user_id=?) AS approvals,
   (SELECT count(*) FROM privileged_identity_approvals WHERE user_id=? AND revoked_at IS NULL AND role='super_admin' AND provider_id='firebase' AND provider_subject_id=? AND workspace_id IN (SELECT value FROM json_each(?))) AS approvals_ok,
   (SELECT count(*) FROM g01_protected_super_admin) AS protected_count,
   (SELECT count(*) FROM g01_protected_super_admin WHERE singleton=1 AND user_id=? AND provider_id='firebase' AND provider_subject_id=?) AS protected_ok,
   (SELECT count(*) FROM g01_bootstrap_completion) AS completions,
   (SELECT count(*) FROM g01_bootstrap_completion WHERE singleton=1 AND original_firebase_uid=? AND operation_id=? AND audit_reference=?) AS completion_ok,
   (SELECT count(*) FROM paar_p0_bootstrap_audit_manifests) AS audits,
   (SELECT count(*) FROM paar_p0_bootstrap_audit_manifests WHERE operation_id=? AND nonce=? AND target_id=? AND operator_email=? AND operator_uid=? AND workspace_scope=? AND permitted_action=? AND signature_algorithm=? AND signature_bytes=? AND signing_key_id=? AND canonical_manifest_json=? AND audit_reference=? AND json_extract(canonical_manifest_json,'$.account_id')=? AND json_extract(canonical_manifest_json,'$.target_user_id')=? AND created_at>=? AND created_at<=?) AS audit_ok,
   (SELECT count(*) FROM g01_super_admin_recovery_events) AS recoveries,
   (SELECT count(*) FROM g01_effective_super_admin_uid WHERE provider_subject_id=?) AS effective_ok`).bind(
   m.target_user_id,m.operator_email,m.target_user_id,m.target_user_id,m.operator_uid,m.target_user_id,m.target_user_id,scope,m.target_user_id,m.target_user_id,m.operator_uid,scope,m.target_user_id,m.operator_uid,m.operator_uid,m.operation_id,approval.audit_reference,m.operation_id,m.nonce,m.target_id,m.operator_email,m.operator_uid,m.workspace_scope.join(','),m.permitted_action,approval.signature_algorithm,approval.signature_bytes,approval.signing_key_id,approval.canonical_manifest_json,approval.audit_reference,m.account_id,m.target_user_id,m.issued_at,m.expires_at,m.operator_uid
  ).first<Record<string,number>>();
  const keys=['user_ok','mappings','mapping_ok','memberships','memberships_ok','approvals','approvals_ok','protected_count','protected_ok','completions','completion_ok','audits','audit_ok','recoveries','effective_ok'];
  if (!row || keys.some(k=>!Number.isInteger(row[k]) || row[k]<0)) return 'INDETERMINATE';
  const identity=row.user_ok===1 && row.mappings===1 && row.mapping_ok===1;
  const baseline=identity && row.memberships===0 && row.approvals===0 && row.protected_count===0 && row.completions===0 && row.audits===0 && row.recoveries===0;
  if (baseline) return options.settled ? 'NOT_ENROLLED' : 'INDETERMINATE';
  if (identity && row.memberships===n && row.memberships_ok===n && row.approvals===n && row.approvals_ok===n && row.protected_count===1 && row.protected_ok===1 && row.completions===1 && row.completion_ok===1 && row.audits===1 && row.audit_ok===1 && row.recoveries===0 && row.effective_ok===1) return 'CONFIRMED_ENROLLED';
  return options.settled ? 'INCONSISTENT' : 'INDETERMINATE';
 } catch { return 'INDETERMINATE'; }
}
