/**
 * CABMS PAAR-P0 — Canonical Approval Manifest & Ed25519 Provenance
 *
 * Implements canonical JSON serialization, deterministic Ed25519 signing/verification,
 * and strict policy validation before database dispatch.
 */

import crypto from 'node:crypto';

export interface ApprovalManifest {
  operation_id: string;
  nonce: string;
  target_id: string;
  operator_email: string;
  operator_uid: string;
  workspace_scope: readonly string[];
  permitted_action: 'bootstrap_super_admin';
  issued_at: string;
  expires_at: string;
  signing_key_id: string;
  approval_identity: string;
}

export const OPERATION_ID_UUID_REGEX = /^op_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SignedApprovalManifest {
  manifest: ApprovalManifest;
  signature_algorithm: 'Ed25519';
  signature_bytes: string; // base64url
  signing_key_id: string;
  canonical_manifest_json: string;
}

export interface VerifiedApprovalManifest {
  manifest: ApprovalManifest;
  signature_algorithm: 'Ed25519';
  signature_bytes: string;
  signing_key_id: string;
  canonical_manifest_json: string;
  audit_reference: string;
}

export class ManifestValidationError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'ManifestValidationError';
  }
}

/**
 * Deterministic JSON serialization with sorted keys and compact spacing.
 * Enforces RFC 8785 JSON Canonicalization Scheme (JCS) invariants:
 * rejects undefined values, non-finite numbers, and lone surrogates.
 */
export function canonicalizeJson(obj: unknown): string {
  if (obj === undefined) {
    throw new ManifestValidationError('Undefined values not permitted in canonical JSON', 'INVALID_JSON_VALUE');
  }
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) {
      throw new ManifestValidationError('Non-finite numbers not permitted in canonical JSON', 'INVALID_JSON_VALUE');
    }
    return JSON.stringify(obj);
  }
  if (typeof obj === 'string') {
    if (typeof (obj as any).toWellFormed === 'function' && (obj as any).toWellFormed() !== obj) {
      throw new ManifestValidationError('Strings containing lone surrogates not permitted in canonical JSON', 'INVALID_JSON_VALUE');
    }
    return JSON.stringify(obj);
  }
  if (obj === null || typeof obj === 'boolean') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalizeJson).join(',')}]`;
  }
  if (typeof obj === 'object') {
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of keys) {
      if ((obj as Record<string, unknown>)[key] === undefined) {
        throw new ManifestValidationError(`Property '${key}' has undefined value`, 'INVALID_JSON_VALUE');
      }
    }
    const pairs = keys.map(
      key => `${JSON.stringify(key)}:${canonicalizeJson((obj as Record<string, unknown>)[key])}`
    );
    return `{${pairs.join(',')}}`;
  }
  throw new ManifestValidationError(`Unsupported JSON type: ${typeof obj}`, 'INVALID_JSON_VALUE');
}

/**
 * Computes deterministic audit reference SHA-256 digest over canonical manifest and signature.
 */
export function computeAuditReference(canonicalJson: string, signatureBytes: string): string {
  return crypto
    .createHash('sha256')
    .update(canonicalJson)
    .update(':')
    .update(signatureBytes)
    .digest('hex');
}

/**
 * Signs an ApprovalManifest using Ed25519 (for test harness & authorized signers).
 */
export function signApprovalManifest(
  manifest: ApprovalManifest,
  privateKey: crypto.KeyObject | string
): SignedApprovalManifest {
  let keyObj: crypto.KeyObject;
  if (typeof privateKey === 'string' || Buffer.isBuffer(privateKey)) {
    try {
      keyObj = crypto.createPrivateKey(privateKey);
    } catch (err) {
      throw new ManifestValidationError(`Failed to parse private key: ${(err as Error).message}`, 'INVALID_PRIVATE_KEY');
    }
  } else if (typeof privateKey === 'object' && privateKey !== null && 'asymmetricKeyType' in privateKey) {
    keyObj = privateKey as crypto.KeyObject;
  } else {
    throw new ManifestValidationError('Invalid private key format', 'INVALID_PRIVATE_KEY');
  }

  if (keyObj.asymmetricKeyType !== 'ed25519') {
    throw new ManifestValidationError(
      `Unsupported private key type '${keyObj.asymmetricKeyType}'. Mode A strictly pins Ed25519 keys.`,
      'KEY_TYPE_REJECTED'
    );
  }

  const canonicalJson = canonicalizeJson(manifest);
  const canonicalBytes = Buffer.from(canonicalJson, 'utf8');

  // In Node.js, Ed25519 requires null digest algorithm
  const signature = crypto.sign(null, canonicalBytes, keyObj);
  const signatureBytes = signature.toString('base64url');

  return {
    manifest,
    signature_algorithm: 'Ed25519',
    signature_bytes: signatureBytes,
    signing_key_id: manifest.signing_key_id,
    canonical_manifest_json: canonicalJson,
  };
}

export interface VerifyManifestOptions {
  expectedTargetId: string;
  expectedOperatorUid: string;
  expectedOperatorEmail: string;
  expectedAction?: string;
  nowMs?: number;
}

/**
 * Strictly verifies a SignedApprovalManifest before dispatching to D1.batch().
 */
export function verifyApprovalManifest(
  signed: SignedApprovalManifest,
  trustedPublicKey: crypto.KeyObject | string,
  options: VerifyManifestOptions
): VerifiedApprovalManifest {
  if (!signed || typeof signed !== 'object') {
    throw new ManifestValidationError('Signed manifest must be an object', 'INVALID_FORMAT');
  }

  // Mandatory verification options in Mode A
  if (!options || typeof options !== 'object' || !options.expectedTargetId) {
    throw new ManifestValidationError('expectedTargetId is strictly mandatory in Mode A', 'TARGET_REQUIRED');
  }
  if (!options.expectedOperatorUid) {
    throw new ManifestValidationError('expectedOperatorUid is strictly mandatory in Mode A', 'OPERATOR_UID_REQUIRED');
  }
  if (!options.expectedOperatorEmail) {
    throw new ManifestValidationError('expectedOperatorEmail is strictly mandatory in Mode A', 'OPERATOR_EMAIL_REQUIRED');
  }

  // 1. Pinned algorithm check
  if (signed.signature_algorithm !== 'Ed25519') {
    throw new ManifestValidationError(
      `Unsupported signature algorithm: ${signed.signature_algorithm}. Mode A strictly pins Ed25519.`,
      'ALGORITHM_REJECTED'
    );
  }

  // Snapshot envelope fields into primitives to prevent getter-based TOCTOU
  const envelopeSignatureBytes = String(signed.signature_bytes ?? '');
  const envelopeSigningKeyId = String(signed.signing_key_id ?? '');
  const envelopeCanonicalJson = String(signed.canonical_manifest_json ?? '');

  const rawManifest = signed.manifest;
  if (!rawManifest || typeof rawManifest !== 'object') {
    throw new ManifestValidationError('Manifest payload missing', 'MISSING_MANIFEST');
  }

  // Create an immediate detached plain data snapshot to prevent getter manipulation or mutating accessors
  const manifest: ApprovalManifest = {
    operation_id: String((rawManifest as any).operation_id ?? ''),
    nonce: String((rawManifest as any).nonce ?? ''),
    target_id: String((rawManifest as any).target_id ?? ''),
    operator_email: String((rawManifest as any).operator_email ?? ''),
    operator_uid: String((rawManifest as any).operator_uid ?? ''),
    workspace_scope: Array.isArray((rawManifest as any).workspace_scope)
      ? [...(rawManifest as any).workspace_scope].map(String)
      : (rawManifest as any).workspace_scope,
    permitted_action: (rawManifest as any).permitted_action,
    issued_at: String((rawManifest as any).issued_at ?? ''),
    expires_at: String((rawManifest as any).expires_at ?? ''),
    signing_key_id: String((rawManifest as any).signing_key_id ?? ''),
    approval_identity: String((rawManifest as any).approval_identity ?? ''),
  };

  // 2. Canonical JSON consistency check
  const recalculatedJson = canonicalizeJson(manifest);
  if (envelopeCanonicalJson !== recalculatedJson) {
    throw new ManifestValidationError(
      'canonical_manifest_json does not match canonical serialization of manifest',
      'CANONICALIZATION_MISMATCH'
    );
  }

  // 3. Cryptographic signature verification with strict Ed25519 key type enforcement
  let keyObj: crypto.KeyObject;
  if (typeof trustedPublicKey === 'string' || Buffer.isBuffer(trustedPublicKey)) {
    try {
      keyObj = crypto.createPublicKey(trustedPublicKey);
    } catch (err) {
      throw new ManifestValidationError(`Failed to parse public key: ${(err as Error).message}`, 'INVALID_PUBLIC_KEY');
    }
  } else if (typeof trustedPublicKey === 'object' && trustedPublicKey !== null && 'asymmetricKeyType' in trustedPublicKey) {
    keyObj = trustedPublicKey as crypto.KeyObject;
  } else {
    throw new ManifestValidationError('Invalid public key format', 'INVALID_PUBLIC_KEY');
  }

  if (keyObj.asymmetricKeyType !== 'ed25519') {
    throw new ManifestValidationError(
      `Unsupported public key type '${keyObj.asymmetricKeyType}'. Mode A strictly pins Ed25519 keys.`,
      'KEY_TYPE_REJECTED'
    );
  }

  const canonicalBytes = Buffer.from(recalculatedJson, 'utf8');
  let signatureBuffer: Buffer;
  try {
    signatureBuffer = Buffer.from(envelopeSignatureBytes, 'base64url');
  } catch {
    throw new ManifestValidationError('Invalid signature encoding', 'INVALID_SIGNATURE_ENCODING');
  }

  // Strictly enforce canonical, unpadded base64url representation
  if (signatureBuffer.toString('base64url') !== envelopeSignatureBytes) {
    throw new ManifestValidationError(
      'Signature must be canonical unpadded base64url without whitespace or padding',
      'NON_CANONICAL_SIGNATURE_ENCODING'
    );
  }

  let signatureValid = false;
  try {
    signatureValid = crypto.verify(null, canonicalBytes, keyObj, signatureBuffer);
  } catch (err) {
    throw new ManifestValidationError(
      `Signature verification threw error: ${(err as Error).message}`,
      'SIGNATURE_VERIFICATION_ERROR'
    );
  }

  if (!signatureValid) {
    throw new ManifestValidationError('Cryptographic signature verification failed', 'INVALID_SIGNATURE');
  }

  // 4. Signing key ID match
  if (envelopeSigningKeyId !== manifest.signing_key_id) {
    throw new ManifestValidationError(
      'Manifest signing_key_id does not match envelope signing_key_id',
      'KEY_ID_MISMATCH'
    );
  }

  // 5. Expiry check with strict finite clock validation
  if (options.nowMs !== undefined && (!Number.isFinite(options.nowMs) || Number.isNaN(options.nowMs))) {
    throw new ManifestValidationError('nowMs option must be a finite number', 'INVALID_CLOCK');
  }
  const now = options.nowMs ?? Date.now();
  const expiresAt = Date.parse(manifest.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt <= now) {
    throw new ManifestValidationError('Approval manifest has expired', 'EXPIRED_MANIFEST');
  }

  // 6. Action check
  const expectedAction = options.expectedAction ?? 'bootstrap_super_admin';
  if (manifest.permitted_action !== expectedAction) {
    throw new ManifestValidationError(
      `Permitted action '${manifest.permitted_action}' does not match expected action '${expectedAction}'`,
      'ACTION_MISMATCH'
    );
  }

  // 7. Target check
  if (manifest.target_id !== options.expectedTargetId) {
    throw new ManifestValidationError(
      `Target '${manifest.target_id}' does not match expected target '${options.expectedTargetId}'`,
      'TARGET_MISMATCH'
    );
  }

  // 8. Operator UID check
  if (manifest.operator_uid !== options.expectedOperatorUid) {
    throw new ManifestValidationError(
      `Operator UID '${manifest.operator_uid}' does not match expected '${options.expectedOperatorUid}'`,
      'OPERATOR_UID_MISMATCH'
    );
  }

  // 9. Operator Email check
  if (manifest.operator_email !== options.expectedOperatorEmail) {
    throw new ManifestValidationError(
      `Operator email '${manifest.operator_email}' does not match expected '${options.expectedOperatorEmail}'`,
      'OPERATOR_EMAIL_MISMATCH'
    );
  }

  // 10. Required fields validation
  if (!manifest.operation_id || !manifest.operation_id.trim()) {
    throw new ManifestValidationError('Missing operation_id', 'MISSING_OPERATION_ID');
  }
  if (!OPERATION_ID_UUID_REGEX.test(manifest.operation_id)) {
    throw new ManifestValidationError(
      `operation_id '${manifest.operation_id}' does not match agreed format op_<UUID>`,
      'INVALID_OPERATION_ID'
    );
  }
  if (!manifest.nonce || !manifest.nonce.trim()) {
    throw new ManifestValidationError('Missing nonce', 'MISSING_NONCE');
  }
  if (!manifest.operator_uid || !manifest.operator_uid.trim() || manifest.operator_uid.length > 128) {
    throw new ManifestValidationError(
      'operator_uid must be non-empty, non-whitespace, and at most 128 chars',
      'INVALID_UID_LENGTH'
    );
  }
  if (!manifest.signing_key_id || !manifest.signing_key_id.trim()) {
    throw new ManifestValidationError('signing_key_id must be non-empty string', 'MISSING_SIGNING_KEY_ID');
  }
  if (!Array.isArray(manifest.workspace_scope) || manifest.workspace_scope.length === 0) {
    throw new ManifestValidationError('workspace_scope must be non-empty array', 'INVALID_WORKSPACE_SCOPE');
  }

  const auditReference = computeAuditReference(recalculatedJson, envelopeSignatureBytes);

  // Return deeply frozen immutable detached snapshot
  const frozenManifest: ApprovalManifest = Object.freeze({
    operation_id: manifest.operation_id,
    nonce: manifest.nonce,
    target_id: manifest.target_id,
    operator_email: manifest.operator_email,
    operator_uid: manifest.operator_uid,
    workspace_scope: Object.freeze([...manifest.workspace_scope]),
    permitted_action: manifest.permitted_action,
    issued_at: manifest.issued_at,
    expires_at: manifest.expires_at,
    signing_key_id: manifest.signing_key_id,
    approval_identity: manifest.approval_identity,
  });

  return Object.freeze({
    manifest: frozenManifest,
    signature_algorithm: 'Ed25519' as const,
    signature_bytes: envelopeSignatureBytes,
    signing_key_id: envelopeSigningKeyId,
    canonical_manifest_json: recalculatedJson,
    audit_reference: auditReference,
  });
}
