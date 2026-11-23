import type { KeyObject } from 'node:crypto';
import { verifyApprovalManifest, type SignedApprovalManifest, type VerifiedApprovalManifest } from './approvalManifest.ts';

/** @deprecated This is a Mode A manifest helper, not a Mode B cloud preflight.
 * It does not pin a public-key fingerprint, bind an existing user, attest the D1
 * binding, or authorize any write. Do not use it for Mode B enrollment. */
export function verifyCloudEnrollmentPreflight(
 signed: SignedApprovalManifest,
 trustedPublicKey: KeyObject | string,
 expected: { databaseId:string; operatorUid:string; operatorEmail:string; signingKeyId:string; workspaceIds:readonly string[]; nowMs?:number },
): VerifiedApprovalManifest {
 if (!expected.signingKeyId || !expected.workspaceIds.length || new Set(expected.workspaceIds).size!==expected.workspaceIds.length) throw new Error('Trusted key ID and unique workspace scope are required');
 const verified = verifyApprovalManifest(signed,trustedPublicKey,{expectedTargetId:expected.databaseId,expectedOperatorUid:expected.operatorUid,expectedOperatorEmail:expected.operatorEmail,nowMs:expected.nowMs});
 if (verified.signing_key_id!==expected.signingKeyId) throw new Error('Approval signing key is not trusted for this target');
 const actual = new Set(verified.manifest.workspace_scope);
 if (actual.size!==expected.workspaceIds.length || expected.workspaceIds.some(id=>!actual.has(id))) throw new Error('Approval workspace scope does not match the authorized scope');
 return verified;
}
