/**
 * CABMS PAAR-P0 — Mode A Private Local-Only CLI Wrapper
 *
 * Implements:
 * - Child process environment allowlist (replaces credential stripping)
 * - Canonical fresh temporary path validation (rejects symlinks, junctions, traversals)
 * - Loopback egress tripwire & telemetry suppression
 * - Isolated D1 binding via getPlatformProxy({ remoteBindings: false })
 * - Non-secret signed audit receipt export
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import net from 'node:net';
import {
  verifyApprovalManifest,
  OPERATION_ID_UUID_REGEX,
  type SignedApprovalManifest,
  type VerifiedApprovalManifest,
} from './approvalManifest.ts';
import {
  enrollFirstSuperAdmin,
  reconcileEnrollmentStatus,
  type EnrollmentOutcome,
  type ReconciliationOutcome,
} from './firstSuperAdminEnrollment.ts';
import { isDisposableInMemoryD1, type D1Database } from '../../backend/db/d1.ts';

export const ALLOWLISTED_ENV_VARS = [
  'PATH',
  'SystemRoot',
  'WINDIR',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'CI',
  'NO_COLOR',
  'WRANGLER_SEND_METRICS',
] as const;

export interface CliIsolationContext {
  disposableDir: string;
  sanitizedEnv: Record<string, string>;
  tripwire: LoopbackTripwire;
  receiptPath?: string;
}

export class SecurityBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityBoundaryError';
  }
}

/**
 * Validates and creates a fresh canonical temporary directory.
 * Rejects traversals, symlinks, junctions/reparse-point escapes.
 */
export function createVerifiedTempDir(prefix: string): string {
  if (!prefix || typeof prefix !== 'string' || prefix.includes('/') || prefix.includes('\\') || prefix.includes('..')) {
    throw new SecurityBoundaryError(`Invalid disposable directory prefix: ${prefix}`);
  }
  const osTempReal = fs.realpathSync(os.tmpdir());
  const freshDir = fs.mkdtempSync(path.join(osTempReal, prefix));
  const freshReal = fs.realpathSync(freshDir);

  const relative = path.relative(osTempReal, freshReal);
  if (!relative || path.isAbsolute(relative) || relative.startsWith('..') || !relative.startsWith(prefix)) {
    throw new SecurityBoundaryError(`Unsafe disposable directory path: ${freshReal}`);
  }

  // Verify not a symlink
  const lstat = fs.lstatSync(freshReal);
  if (lstat.isSymbolicLink()) {
    throw new SecurityBoundaryError('Disposable directory cannot be a symbolic link');
  }

  return freshReal;
}

/**
 * Builds child process environment exclusively from reviewed allowlist.
 */
export function buildAllowlistedChildEnv(disposableDir: string): Record<string, string> {
  const env: Record<string, string> = {};

  // Pass allowed OS essential variables if present in parent
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'NO_COLOR']) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key]!;
    }
  }

  // Point all temporary and profile directories to fresh disposable directory
  const homeDir = path.join(disposableDir, 'home');
  const appDataDir = path.join(disposableDir, 'appdata');
  const tempDir = path.join(disposableDir, 'temp');
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });

  env.TEMP = tempDir;
  env.TMP = tempDir;
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.APPDATA = appDataDir;
  env.LOCALAPPDATA = appDataDir;

  // Strict local telemetry & CI suppression
  env.CI = '1';
  env.WRANGLER_SEND_METRICS = 'false';

  return env;
}

/**
 * Asserts exact set equality of allowlisted keys in child environment.
 */
export function assertChildEnvAllowlist(childEnv: Record<string, string>): void {
  const presentKeys = Object.keys(childEnv).sort();
  const forbiddenPrefixes = ['CLOUDFLARE_', 'CF_', 'NODE_OPTIONS', 'AWS_', 'FIREBASE_'];

  for (const key of presentKeys) {
    for (const prefix of forbiddenPrefixes) {
      if (key.toUpperCase().startsWith(prefix)) {
        throw new SecurityBoundaryError(`Forbidden credential variable inherited: ${key}`);
      }
    }
    // Must be in allowlist (case-insensitive for Windows)
    const isAllowed = ALLOWLISTED_ENV_VARS.some(a => a.toLowerCase() === key.toLowerCase());
    if (!isAllowed) {
      throw new SecurityBoundaryError(`Disallowed variable in child environment: ${key}`);
    }
  }
}

/**
 * Process-level loopback-only egress tripwire.
 * Intercepts net.Socket connect attempts and records/blocks non-loopback destinations.
 */
export class LoopbackTripwire {
  private static activeInstances = new Set<LoopbackTripwire>();
  private static originalGlobalConnect: typeof net.Socket.prototype.connect | null = null;
  public nonLoopbackAttempts: Array<{ host: string; port: number }> = [];
  public loopbackAttempts: Array<{ host: string; port: number }> = [];
  public active = false;

  public activate(): void {
    if (this.active) return;
    this.active = true;
    if (LoopbackTripwire.activeInstances.size === 0) {
      LoopbackTripwire.originalGlobalConnect = net.Socket.prototype.connect;
    }
    LoopbackTripwire.activeInstances.add(this);

    if (LoopbackTripwire.activeInstances.size === 1) {
      const underlyingConnect = LoopbackTripwire.originalGlobalConnect!;
      net.Socket.prototype.connect = function (...args: any[]) {
        let host: string | undefined;
        let port = 0;

        let firstArg = args[0];
        if (Array.isArray(firstArg)) {
          firstArg = firstArg[0];
        }

        if (typeof firstArg === 'object' && firstArg !== null) {
          host = firstArg.host || firstArg.path;
          port = firstArg.port || 0;
        } else if (typeof firstArg === 'number') {
          port = firstArg;
          if (typeof args[1] === 'string') {
            host = args[1];
          } else if (typeof args[1] === 'object' && args[1] !== null) {
            host = args[1].host || args[1].path;
          }
        } else if (typeof firstArg === 'string') {
          host = firstArg;
        }

        // If host and port cannot be identified (e.g. malformed options or array), fail closed immediately
        if (!host && port === 0) {
          host = 'malformed_unknown';
        }

        if (!host) {
          host = '127.0.0.1';
        }

        // Normalize host string (case-insensitive, strip brackets, strip port suffix)
        let normalizedHost = String(host).trim().toLowerCase();
        if (normalizedHost.startsWith('[') && normalizedHost.endsWith(']')) {
          normalizedHost = normalizedHost.slice(1, -1);
        }
        if (/^[^:]+:\d+$/.test(normalizedHost)) {
          normalizedHost = normalizedHost.split(':')[0];
        }

        // Check IPC destinations (Unix domain sockets, Windows named pipes, and options.path)
        // Mode A rejects IPC destinations by default to prevent socket-based proxy/egress bypass
        const isIpc =
          (typeof firstArg === 'object' && firstArg !== null && 'path' in firstArg) ||
          normalizedHost.startsWith('\\\\.\\pipe\\') ||
          normalizedHost.startsWith('/');

        if (isIpc) {
          for (const inst of LoopbackTripwire.activeInstances) {
            inst.nonLoopbackAttempts.push({ host, port });
          }
          const err = new Error(`LoopbackTripwire blocked IPC destination attempt to ${host}`);
          process.nextTick(() => {
            this.destroy(err);
          });
          return this;
        }

        // Check loopback targets (strictly IPv4/IPv6 loopback literals and canonical loopback hostnames)
        const isNamedLoopback =
          normalizedHost === 'localhost' ||
          normalizedHost === 'ip6-localhost' ||
          normalizedHost === 'ip6-loopback';
        const isIpv6Loopback =
          normalizedHost === '::1' ||
          normalizedHost === '0:0:0:0:0:0:0:1' ||
          normalizedHost === '::ffff:127.0.0.1';

        // IPv4 loopback subnet 127.0.0.0/8 (127.0.0.0 - 127.255.255.255)
        const ipv4Match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(normalizedHost);
        const isIpv4Loopback = !!(
          ipv4Match &&
          Number(ipv4Match[1]) <= 255 &&
          Number(ipv4Match[2]) <= 255 &&
          Number(ipv4Match[3]) <= 255
        );

        const isLoopback = isNamedLoopback || isIpv6Loopback || isIpv4Loopback;

        // Pin named loopback destination directly to loopback IP literal without mutating caller options object
        const delegateArgs = [...args];
        if (isNamedLoopback) {
          const literal = normalizedHost.startsWith('ip6') ? '::1' : '127.0.0.1';
          if (typeof firstArg === 'object' && firstArg !== null) {
            delegateArgs[0] = { ...firstArg, host: literal };
          } else if (typeof args[1] === 'string') {
            delegateArgs[1] = literal;
          } else if (typeof firstArg === 'string') {
            delegateArgs[0] = literal;
          }
        }

        if (!isLoopback) {
          for (const inst of LoopbackTripwire.activeInstances) {
            inst.nonLoopbackAttempts.push({ host, port });
          }
          const err = new Error(`LoopbackTripwire blocked non-loopback connection attempt to ${host}:${port}`);
          process.nextTick(() => {
            this.destroy(err);
          });
          return this;
        }

        for (const inst of LoopbackTripwire.activeInstances) {
          inst.loopbackAttempts.push({ host, port });
        }
        return underlyingConnect.apply(this, delegateArgs as any);
      };
    }
  }

  public deactivate(): void {
    if (!this.active) return;
    this.active = false;
    LoopbackTripwire.activeInstances.delete(this);
    if (LoopbackTripwire.activeInstances.size === 0 && LoopbackTripwire.originalGlobalConnect) {
      net.Socket.prototype.connect = LoopbackTripwire.originalGlobalConnect;
      LoopbackTripwire.originalGlobalConnect = null;
    }
  }
}

export interface RecoverReceiptOptions {
  evidenceDir?: string;
  approvedEvidenceRoot?: string;
  expectedTargetId: string;
  expectedOperatorUid: string;
  expectedOperatorEmail: string;
  allowExpiredForRecovery?: boolean;
  nowMs?: number;
  /** Operator must affirmatively attest that any prior write has terminated. Default: false (fail closed). */
  settled?: boolean;
}

export type RecoverReceiptResult = {
  status: 'RECOVERED' | 'NOT_ENROLLED' | 'INCONSISTENT' | 'INDETERMINATE' | 'SECURITY_VIOLATION';
  auditReceiptPath?: string;
  error?: string;
  securityViolation?: string;
  receiptExportWarning?: string;
};

export type CliEnrollmentOutcome =
  | EnrollmentOutcome
  | { status: 'SECURITY_VIOLATION'; error: string; dbState: 'COMMITTED' | 'UNCOMMITTED' | 'INDETERMINATE' };

export interface RunModeACliOptions {
  evidenceDir?: string;
  approvedEvidenceRoot?: string;
  expectedTargetId: string;
  expectedOperatorUid: string;
  expectedOperatorEmail: string;
}

export interface RunModeACliResult {
  outcome: CliEnrollmentOutcome;
  reconciliation?: ReconciliationOutcome;
  auditReceiptPath?: string;
  securityViolation?: string;
  receiptExportError?: string;
  receiptExportWarning?: string;
}

/**
 * Publishes an audit receipt atomically to resolvedEvidenceDir using linkSync.
 * Prohibits overwriting existing receipt, verifies containment before and after publication,
 * and cleans up only the temporary file owned by this invocation.
 */
function publishAuditReceipt(
  verified: VerifiedApprovalManifest,
  resolvedEvidenceDir: string,
  approvedRoot?: string
): { auditReceiptPath?: string; receiptExportError?: string; receiptExportWarning?: string } {
  let fd: number | undefined;
  let ownedTempPath: string | undefined;
  let auditReceiptPath: string | undefined;
  let receiptExportError: string | undefined;
  let receiptExportWarning: string | undefined;

  try {
    if (!OPERATION_ID_UUID_REGEX.test(verified.manifest.operation_id)) {
      throw new SecurityBoundaryError('operation_id must strictly match agreed format op_<UUID>');
    }
    fs.mkdirSync(resolvedEvidenceDir, { recursive: true });
    if (approvedRoot) {
      const realCreatedDir = fs.realpathSync(resolvedEvidenceDir);
      const relCreated = path.relative(approvedRoot, realCreatedDir);
      if (relCreated.startsWith('..') || path.isAbsolute(relCreated)) {
        throw new SecurityBoundaryError('Evidence directory canonical realpath escapes approved root boundary');
      }
    }
    const receiptFilename = `p0_audit_receipt_${verified.manifest.operation_id}.json`;
    auditReceiptPath = path.join(resolvedEvidenceDir, receiptFilename);
    const relReceipt = path.relative(resolvedEvidenceDir, auditReceiptPath);
    if (relReceipt.startsWith('..') || path.isAbsolute(relReceipt) || path.dirname(auditReceiptPath) !== resolvedEvidenceDir) {
      throw new SecurityBoundaryError('Receipt destination path escapes evidence directory');
    }
    if (fs.existsSync(auditReceiptPath)) {
      throw new SecurityBoundaryError(`Receipt destination file already exists: ${receiptFilename}`);
    }
    const receipt = {
      operation_id: verified.manifest.operation_id,
      nonce: verified.manifest.nonce,
      target_id: verified.manifest.target_id,
      operator_email: verified.manifest.operator_email,
      operator_uid: verified.manifest.operator_uid,
      workspace_scope: verified.manifest.workspace_scope,
      permitted_action: verified.manifest.permitted_action,
      signing_key_id: verified.signing_key_id,
      signature_algorithm: verified.signature_algorithm,
      signature_bytes: verified.signature_bytes,
      audit_reference: verified.audit_reference,
      canonical_manifest_json: verified.canonical_manifest_json,
      recorded_at: new Date().toISOString(),
    };

    const tempFilename = `.tmp_p0_receipt_${verified.manifest.operation_id}_${crypto.randomUUID()}.json`;
    const tempPath = path.join(resolvedEvidenceDir, tempFilename);

    fd = fs.openSync(tempPath, 'wx');
    ownedTempPath = tempPath;

    if (approvedRoot) {
      let realParent: string;
      try {
        realParent = fs.realpathSync(resolvedEvidenceDir);
      } catch {
        throw new SecurityBoundaryError('Evidence directory disappeared or was swapped');
      }
      const relParent = path.relative(approvedRoot, realParent);
      if (relParent.startsWith('..') || path.isAbsolute(relParent)) {
        throw new SecurityBoundaryError('Evidence directory canonical realpath escapes approved root boundary (swapped or redirected)');
      }
      if (!fs.existsSync(tempPath)) {
        throw new SecurityBoundaryError('Temporary file missing after open: directory was swapped or redirected');
      }

      const realTemp = fs.realpathSync(tempPath);
      const relTemp = path.relative(approvedRoot, realTemp);
      if (relTemp.startsWith('..') || path.isAbsolute(relTemp)) {
        throw new SecurityBoundaryError('Receipt destination file canonical realpath escapes approved root boundary');
      }

      const realTempParent = fs.realpathSync(path.dirname(tempPath));
      if (realTempParent !== realParent) {
        throw new SecurityBoundaryError('Receipt parent directory was swapped during file creation');
      }
    }

    fs.writeSync(fd, JSON.stringify(receipt, null, 2), null, 'utf8');
    fs.closeSync(fd);
    fd = undefined;

    if (approvedRoot) {
      const realDestDir = fs.realpathSync(resolvedEvidenceDir);
      const relDest = path.relative(approvedRoot, realDestDir);
      if (relDest.startsWith('..') || path.isAbsolute(relDest)) {
        throw new SecurityBoundaryError('Evidence directory canonical realpath was redirected before publication');
      }
    }

    // Exclusive atomic publication via linkSync (fails if destination exists; never falls back to renameSync)
    fs.linkSync(tempPath, auditReceiptPath);

    try {
      fs.unlinkSync(tempPath);
      ownedTempPath = undefined;
    } catch (cleanErr) {
      receiptExportWarning = `Receipt published successfully, but temporary file cleanup failed: ${(cleanErr as Error).message}`;
    }

    if (approvedRoot) {
      const realPublished = fs.realpathSync(auditReceiptPath);
      const relPublished = path.relative(approvedRoot, realPublished);
      if (relPublished.startsWith('..') || path.isAbsolute(relPublished)) {
        try { fs.unlinkSync(auditReceiptPath); } catch {}
        throw new SecurityBoundaryError('Receipt destination file canonical realpath escapes approved root boundary');
      }
      const realParent = fs.realpathSync(path.dirname(auditReceiptPath));
      const expectedParent = fs.realpathSync(resolvedEvidenceDir);
      if (realParent !== expectedParent) {
        try { fs.unlinkSync(auditReceiptPath); } catch {}
        throw new SecurityBoundaryError('Receipt parent directory was swapped during file publication');
      }
    }

    return { auditReceiptPath, receiptExportWarning };
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
      fd = undefined;
    }
    if (ownedTempPath && fs.existsSync(ownedTempPath)) {
      try { fs.unlinkSync(ownedTempPath); } catch {}
    }
    receiptExportError = (err as Error).message;
    return { receiptExportError };
  }
}

/**
 * Dedicated read-only receipt recovery entry point.
 * Recovers audit receipt for an already-completed enrollment without executing any write calls to D1.
 */
export async function recoverAuditReceipt(
  db: D1Database,
  signedManifest: SignedApprovalManifest,
  trustedPublicKey: crypto.KeyObject | string,
  options: RecoverReceiptOptions
): Promise<RecoverReceiptResult> {
  // 1. Enforce verified disposable local database boundary
  if (!db || !isDisposableInMemoryD1(db) || typeof db.prepare !== 'function') {
    throw new SecurityBoundaryError('Mode A CLI requires verified disposable local database boundary from trusted factory');
  }

  // 2. Validate mandatory options
  if (!options || typeof options !== 'object') {
    throw new SecurityBoundaryError('Recovery options are mandatory in Mode A');
  }
  if (!options.expectedTargetId) {
    throw new SecurityBoundaryError('expectedTargetId is mandatory for receipt recovery');
  }
  if (!options.expectedOperatorUid) {
    throw new SecurityBoundaryError('expectedOperatorUid is mandatory for receipt recovery');
  }
  if (!options.expectedOperatorEmail) {
    throw new SecurityBoundaryError('expectedOperatorEmail is mandatory for receipt recovery');
  }

  // 3. Resolve evidence dir & approved root
  let resolvedEvidenceDir: string | undefined;
  let approvedRoot: string | undefined;
  if (options.evidenceDir) {
    const rawDir = options.evidenceDir;
    if (rawDir.includes('..')) {
      throw new SecurityBoundaryError('Evidence directory path escapes approved boundary');
    }
    const approvedRootRaw = path.resolve(options.approvedEvidenceRoot ?? 'evidence/paar-p0-mode-a');
    if (!fs.existsSync(approvedRootRaw)) {
      fs.mkdirSync(approvedRootRaw, { recursive: true });
    }
    approvedRoot = fs.realpathSync(approvedRootRaw);
    resolvedEvidenceDir = path.resolve(rawDir);
    const rel = path.relative(approvedRoot, resolvedEvidenceDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SecurityBoundaryError('Evidence directory path escapes approved evidence root boundary');
    }
    let ancestor = resolvedEvidenceDir;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (fs.existsSync(ancestor)) {
      const realAncestor = fs.realpathSync(ancestor);
      const relReal = path.relative(approvedRoot, realAncestor);
      if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
        throw new SecurityBoundaryError('Evidence directory canonical realpath escapes approved root boundary');
      }
    }
  }

  // 4. Validate Ed25519 key
  let validatedKeyObj: crypto.KeyObject;
  if (typeof trustedPublicKey === 'string' || Buffer.isBuffer(trustedPublicKey)) {
    try {
      validatedKeyObj = crypto.createPublicKey(trustedPublicKey);
    } catch (err) {
      throw new SecurityBoundaryError(`Failed to parse trusted public key: ${(err as Error).message}`);
    }
  } else if (typeof trustedPublicKey === 'object' && trustedPublicKey !== null && 'asymmetricKeyType' in trustedPublicKey) {
    validatedKeyObj = trustedPublicKey as crypto.KeyObject;
  } else {
    throw new SecurityBoundaryError('Invalid trusted public key format');
  }
  if (validatedKeyObj.asymmetricKeyType !== 'ed25519') {
    throw new SecurityBoundaryError(`Unsupported public key type '${validatedKeyObj.asymmetricKeyType}'. Mode A strictly pins Ed25519 keys.`);
  }

  // 5. Verify manifest
  const verified = verifyApprovalManifest(signedManifest, validatedKeyObj, {
    expectedTargetId: options.expectedTargetId,
    expectedOperatorUid: options.expectedOperatorUid,
    expectedOperatorEmail: options.expectedOperatorEmail,
    allowExpiredForRecovery: options.allowExpiredForRecovery,
    nowMs: options.nowMs,
  });

  // 6. Deep read-only reconciliation under tripwire (ZERO write statements sent to D1)
  const tripwire = new LoopbackTripwire();
  tripwire.activate();
  let reconStatus: ReconciliationOutcome;
  try {
    reconStatus = await reconcileEnrollmentStatus(
      db,
      verified.manifest.operation_id,
      verified.manifest.operator_uid,
      verified.audit_reference,
      verified.manifest.workspace_scope,
      { settled: options.settled === true }
    );

    if (tripwire.nonLoopbackAttempts.length > 0) {
      return {
        status: 'SECURITY_VIOLATION',
        securityViolation: `Egress tripwire triggered during recovery: ${JSON.stringify(tripwire.nonLoopbackAttempts)}`,
      };
    }
  } finally {
    tripwire.deactivate();
  }

  if (reconStatus !== 'CONFIRMED_ENROLLED') {
    return {
      status: reconStatus,
      error:
        reconStatus === 'INDETERMINATE'
          ? 'Receipt recovery rejected: database is empty or uncommitted, and operator settlement was not attested'
          : `Receipt recovery rejected: database status is ${reconStatus}`,
    };
  }

  // 6.5 Re-verify persisted audit row fields match verified manifest exactly
  const persistedAudit = await db
    .prepare('SELECT operation_id, audit_reference, canonical_manifest_json, created_at FROM paar_p0_bootstrap_audit_manifests WHERE operation_id = ?')
    .bind(verified.manifest.operation_id)
    .first<{ operation_id: string; audit_reference: string; canonical_manifest_json: string; created_at: string }>();

  if (
    !persistedAudit ||
    persistedAudit.operation_id !== verified.manifest.operation_id ||
    persistedAudit.audit_reference !== verified.audit_reference ||
    persistedAudit.canonical_manifest_json !== verified.canonical_manifest_json
  ) {
    return {
      status: 'INCONSISTENT',
      error: 'Persisted audit record does not match authenticated manifest signature or canonical bytes',
    };
  }

  // 6.6 For expired manifest recovery, verify persisted audit record occurred within manifest validity window
  if (options.allowExpiredForRecovery) {
    const rawCreatedAt = persistedAudit.created_at.trim();
    const isoRecordedAt = rawCreatedAt.includes('T')
      ? (rawCreatedAt.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(rawCreatedAt) ? rawCreatedAt : rawCreatedAt + 'Z')
      : rawCreatedAt.replace(' ', 'T') + 'Z';
    const auditRecordedAt = Date.parse(isoRecordedAt);
    const issuedAt = Date.parse(verified.manifest.issued_at);
    const expiresAt = Date.parse(verified.manifest.expires_at);

    if (
      Number.isNaN(auditRecordedAt) ||
      auditRecordedAt < issuedAt ||
      auditRecordedAt > expiresAt
    ) {
      return {
        status: 'INCONSISTENT',
        error: `Persisted audit record created_at (${persistedAudit.created_at}) falls outside manifest validity window (${verified.manifest.issued_at} to ${verified.manifest.expires_at})`,
      };
    }
  }

  // 7. Publish receipt if evidence dir provided
  if (!resolvedEvidenceDir) {
    return {
      status: 'RECOVERED',
    };
  }

  const pubResult = publishAuditReceipt(verified, resolvedEvidenceDir, approvedRoot);
  if (pubResult.receiptExportError) {
    return {
      status: 'INDETERMINATE',
      error: `Receipt recovery failed during publication: ${pubResult.receiptExportError}`,
    };
  }

  return {
    status: 'RECOVERED',
    auditReceiptPath: pubResult.auditReceiptPath,
    receiptExportWarning: pubResult.receiptExportWarning,
  };
}

/**
 * Mode A CLI execution wrapper.
 */
export async function runModeACliEnrollment(
  db: D1Database,
  signedManifest: SignedApprovalManifest,
  trustedPublicKey: crypto.KeyObject | string,
  options: RunModeACliOptions
): Promise<RunModeACliResult> {
  // 1. Enforce verified disposable local database boundary from trusted factory (Finding F-03)
  if (!db || !isDisposableInMemoryD1(db) || typeof db.prepare !== 'function') {
    throw new SecurityBoundaryError('Mode A CLI requires verified disposable local database boundary from trusted factory');
  }

  // 2. Enforce strictly mandatory verification options (Finding F-02, F-04)
  if (!options || typeof options !== 'object') {
    throw new SecurityBoundaryError('CLI enrollment options are mandatory in Mode A');
  }
  if (!options.expectedTargetId) {
    throw new SecurityBoundaryError('expectedTargetId is mandatory for Mode A CLI enrollment');
  }
  if (!options.expectedOperatorUid) {
    throw new SecurityBoundaryError('expectedOperatorUid is mandatory for Mode A CLI enrollment');
  }
  if (!options.expectedOperatorEmail) {
    throw new SecurityBoundaryError('expectedOperatorEmail is mandatory for Mode A CLI enrollment');
  }

  // 3. Evidence directory traversal & positive approved evidence root containment (Finding F-08 & CR-03)
  let resolvedEvidenceDir: string | undefined;
  let approvedRoot: string | undefined;
  if (options.evidenceDir) {
    const rawDir = options.evidenceDir;
    if (rawDir.includes('..')) {
      throw new SecurityBoundaryError('Evidence directory path escapes approved boundary');
    }
    const approvedRootRaw = path.resolve(options.approvedEvidenceRoot ?? 'evidence/paar-p0-mode-a');
    if (!fs.existsSync(approvedRootRaw)) {
      fs.mkdirSync(approvedRootRaw, { recursive: true });
    }
    approvedRoot = fs.realpathSync(approvedRootRaw);
    resolvedEvidenceDir = path.resolve(rawDir);
    const rel = path.relative(approvedRoot, resolvedEvidenceDir);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new SecurityBoundaryError('Evidence directory path escapes approved evidence root boundary');
    }
    // Validate nearest existing ancestor's realpath against approvedRoot to prevent symlink/junction escape
    let ancestor = resolvedEvidenceDir;
    while (!fs.existsSync(ancestor)) {
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    if (fs.existsSync(ancestor)) {
      const realAncestor = fs.realpathSync(ancestor);
      const relReal = path.relative(approvedRoot, realAncestor);
      if (relReal.startsWith('..') || path.isAbsolute(relReal)) {
        throw new SecurityBoundaryError('Evidence directory canonical realpath escapes approved root boundary');
      }
    }
  }

  // 3.5 Strictly validate trusted public key asymmetric type as Ed25519
  let validatedKeyObj: crypto.KeyObject;
  if (typeof trustedPublicKey === 'string' || Buffer.isBuffer(trustedPublicKey)) {
    try {
      validatedKeyObj = crypto.createPublicKey(trustedPublicKey);
    } catch (err) {
      throw new SecurityBoundaryError(`Failed to parse trusted public key: ${(err as Error).message}`);
    }
  } else if (typeof trustedPublicKey === 'object' && trustedPublicKey !== null && 'asymmetricKeyType' in trustedPublicKey) {
    validatedKeyObj = trustedPublicKey as crypto.KeyObject;
  } else {
    throw new SecurityBoundaryError('Invalid trusted public key format');
  }

  if (validatedKeyObj.asymmetricKeyType !== 'ed25519') {
    throw new SecurityBoundaryError(
      `Unsupported public key type '${validatedKeyObj.asymmetricKeyType}'. Mode A strictly pins Ed25519 keys.`
    );
  }

  // 4. Verify manifest, execute enrollment, and reconcile under active LoopbackTripwire
  const tripwire = new LoopbackTripwire();
  tripwire.activate();
  let verified: VerifiedApprovalManifest;
  let outcome: CliEnrollmentOutcome;
  let reconciliation: ReconciliationOutcome | undefined;
  let securityViolation: string | undefined;

  try {
    verified = verifyApprovalManifest(
      signedManifest,
      validatedKeyObj,
      {
        expectedTargetId: options.expectedTargetId,
        expectedOperatorUid: options.expectedOperatorUid,
        expectedOperatorEmail: options.expectedOperatorEmail,
      }
    );

    // 5. Execute enrollment
    outcome = await enrollFirstSuperAdmin(db, verified);

    // 6. Handle indeterminate reconciliation if required (CR-08: pass full array)
    if (outcome.status === 'INDETERMINATE') {
      reconciliation = await reconcileEnrollmentStatus(
        db,
        verified.manifest.operation_id,
        verified.manifest.operator_uid,
        verified.audit_reference,
        verified.manifest.workspace_scope
      );
    }

    if (tripwire.nonLoopbackAttempts.length > 0) {
      securityViolation = `Egress tripwire triggered during Mode A execution: ${JSON.stringify(tripwire.nonLoopbackAttempts)}`;
      const dbState = outcome.status === 'SUCCESS'
        ? 'COMMITTED'
        : outcome.status === 'INDETERMINATE'
          ? 'INDETERMINATE'
          : 'UNCOMMITTED';
      outcome = {
        status: 'SECURITY_VIOLATION',
        error: securityViolation,
        dbState,
      };
    }
  } finally {
    tripwire.deactivate();
  }

  // 7. Export non-secret signed audit receipt (linkSync publication)
  let auditReceiptPath: string | undefined;
  let receiptExportError: string | undefined;
  let receiptExportWarning: string | undefined;
  const isConfirmedEnrolled =
    !securityViolation &&
    (outcome.status === 'SUCCESS' || reconciliation === 'CONFIRMED_ENROLLED');

  if (isConfirmedEnrolled && resolvedEvidenceDir) {
    const pubResult = publishAuditReceipt(verified, resolvedEvidenceDir, approvedRoot);
    auditReceiptPath = pubResult.auditReceiptPath;
    receiptExportError = pubResult.receiptExportError;
    receiptExportWarning = pubResult.receiptExportWarning;
  }

  return {
    outcome,
    reconciliation,
    auditReceiptPath,
    securityViolation,
    receiptExportError,
    receiptExportWarning,
  };
}

/**
 * Maps Mode A execution outcome to canonical process exit code.
 * Exported status-mapping contract for automation wrappers.
 * Exits non-zero on:
 * - 2: SECURITY_VIOLATION (loopback egress tripwire tripped)
 * - 3: INDETERMINATE (transport dropped, database state unsettled)
 * - 1: NOT_ENROLLED (validation failure, transaction rollback, or unexpected status)
 * - 4: RECEIPT_EXPORT_ERROR (database committed, but mandatory audit receipt is missing)
 * - 0: Complete operational success (enrolled and audit receipt populated)
 */
export function getCliExitCode(result: RunModeACliResult): number {
  if (result.outcome.status === 'SECURITY_VIOLATION') return 2;
  if (result.outcome.status === 'INDETERMINATE') return 3;
  if (result.outcome.status === 'NOT_ENROLLED') return 1;
  if (result.outcome.status === 'SUCCESS') {
    // Committed to D1, but mandatory audit receipt is missing (export failed or destination omitted)
    if (result.receiptExportError || !result.auditReceiptPath) return 4;
    return 0;
  }
  return 1;
}
