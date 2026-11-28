/** Mode B signature verification only. This is not an enrollment or target-attestation runner. */
import {createHash, timingSafeEqual, verify, type KeyObject} from 'node:crypto';
import {canonicalizeJson, computeAuditReference, ManifestValidationError, OPERATION_ID_UUID_REGEX} from './approvalManifest.ts';

export interface ModeBManifest {
 domain:string; operation_id:string; nonce:string; account_id:string; target_id:string; target_user_id:string;
 operator_email:string; operator_uid:string; workspace_scope:readonly string[]; permitted_action:string;
 issued_at:string; expires_at:string; signing_key_id:string; approval_identity:string;
}
export interface ModeBExpected {
 accountId:string; databaseId:string; userId:string; email:string; uid:string; workspaceIds:readonly string[];
 keyId:string; publicKeySha256:string; nowMs:number;
}
const fields=['domain','operation_id','nonce','account_id','target_id','target_user_id','operator_email','operator_uid','workspace_scope','permitted_action','issued_at','expires_at','signing_key_id','approval_identity'];
export class ModeBApprovalError extends Error { constructor(public readonly code:string) { super(`Mode B approval rejected: ${code}`); } }
export interface VerifiedModeBApproval { readonly manifest:Readonly<ModeBManifest>; readonly signature_algorithm:'Ed25519'; readonly signature_bytes:string; readonly canonical_manifest_json:string; readonly signing_key_id:string; readonly audit_reference:string }
const verifiedApprovals = new WeakSet<object>();
export const isVerifiedModeBApproval = (value:unknown):value is Readonly<VerifiedModeBApproval> => !!value && typeof value==='object' && verifiedApprovals.has(value);
const invalid=(code='INVALID_FORMAT'):never=>{throw new ModeBApprovalError(code);};
export function verifyModeBApproval(input:string, publicKey:KeyObject, expected:ModeBExpected):Readonly<VerifiedModeBApproval> {
 if (typeof input!=='string' || input.length>65536) return invalid('INVALID_FORMAT');
 let parsed:unknown; try { parsed=JSON.parse(input); } catch { return invalid('MALFORMED_JSON'); }
 if (!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return invalid();
 const envelope=parsed as Record<string,unknown>;
 if (Object.keys(envelope).sort().join(',')!==['canonical_manifest_json','manifest','signature_algorithm','signature_bytes','signing_key_id'].sort().join(',') || envelope.signature_algorithm!=='Ed25519' || typeof envelope.signature_bytes!=='string' || typeof envelope.canonical_manifest_json!=='string' || typeof envelope.signing_key_id!=='string') return invalid();
 const raw=envelope.manifest;
 if (!raw || typeof raw!=='object' || Array.isArray(raw) || Object.keys(raw).sort().join(',')!==[...fields].sort().join(',')) return invalid();
 const m=raw as Record<string,unknown>;
 if (fields.filter(k=>k!=='workspace_scope').some(k=>typeof m[k]!=='string' || !(m[k] as string).trim() || (m[k] as string).length>512) || !Array.isArray(m.workspace_scope) || m.workspace_scope.length<1 || m.workspace_scope.length>21 || m.workspace_scope.some(w=>typeof w!=='string' || !w.trim() || w.length>128) || new Set(m.workspace_scope).size!==m.workspace_scope.length) return invalid();
 const snapshot=Object.fromEntries(fields.map(k=>[k,k==='workspace_scope'?[...(m[k] as string[])]:m[k]])) as unknown as ModeBManifest;
 if (!publicKey || publicKey.type!=='public' || publicKey.asymmetricKeyType!=='ed25519' || !/^[a-f0-9]{64}$/.test(expected.publicKeySha256)) return invalid('INVALID_TRUSTED_KEY');
 const fingerprint=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest();
 if (!timingSafeEqual(fingerprint,Buffer.from(expected.publicKeySha256,'hex'))) return invalid('KEY_FINGERPRINT_MISMATCH');
 let canonical:string; try { canonical=canonicalizeJson(snapshot); } catch (error) { if (error instanceof ManifestValidationError) return invalid('INVALID_JSON_VALUE'); throw error; }
 const sig=Buffer.from(envelope.signature_bytes,'base64url');
 if (canonical!==envelope.canonical_manifest_json || sig.toString('base64url')!==envelope.signature_bytes || !verify(null,Buffer.from(canonical),publicKey,sig)) return invalid('INVALID_SIGNATURE');
 const timestamp=(s:string)=>/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString()===s;
 if (!Number.isFinite(expected.nowMs) || !timestamp(snapshot.issued_at) || !timestamp(snapshot.expires_at) || Date.parse(snapshot.issued_at)>expected.nowMs || Date.parse(snapshot.expires_at)<=Date.parse(snapshot.issued_at)) return invalid('INVALID_VALIDITY_WINDOW');
 if (Date.parse(snapshot.expires_at)<=expected.nowMs) return invalid('EXPIRED_APPROVAL');
 if (Date.parse(snapshot.expires_at)-Date.parse(snapshot.issued_at)>60*60*1000) return invalid('VALIDITY_WINDOW_TOO_LONG');
 if (snapshot.account_id!==expected.accountId || snapshot.target_id!==expected.databaseId) return invalid('TARGET_MISMATCH');
 if (!expected.workspaceIds.length || new Set(expected.workspaceIds).size!==expected.workspaceIds.length || snapshot.workspace_scope.length!==expected.workspaceIds.length || expected.workspaceIds.some(w=>!snapshot.workspace_scope.includes(w))) return invalid('WORKSPACE_SCOPE_MISMATCH');
 if (snapshot.domain!=='CABMS/MODE-B/v1' || snapshot.permitted_action!=='bootstrap_super_admin' || !OPERATION_ID_UUID_REGEX.test(snapshot.operation_id) || snapshot.target_user_id!==expected.userId || snapshot.operator_email!==expected.email || snapshot.operator_uid!==expected.uid || snapshot.signing_key_id!==expected.keyId || envelope.signing_key_id!==expected.keyId) return invalid('APPROVAL_SCOPE_MISMATCH');
 Object.freeze(snapshot.workspace_scope);
 Object.freeze(snapshot);
 const result=Object.freeze({manifest:snapshot,signature_algorithm:'Ed25519' as const,signature_bytes:envelope.signature_bytes,canonical_manifest_json:canonical,signing_key_id:envelope.signing_key_id,audit_reference:computeAuditReference(canonical,envelope.signature_bytes)});
 verifiedApprovals.add(result);
 return result;
}
