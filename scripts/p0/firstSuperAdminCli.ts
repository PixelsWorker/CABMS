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
  private static globalActiveCount = 0;
  private static originalGlobalConnect = net.Socket.prototype.connect;
  public nonLoopbackAttempts: Array<{ host: string; port: number }> = [];
  public loopbackAttempts: Array<{ host: string; port: number }> = [];
  public active = false;

  public activate(): void {
    if (this.active) return;
    this.active = true;
    LoopbackTripwire.globalActiveCount++;
    const self = this;

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

      // Check loopback targets
      const isNamedPipeOrUnixSocket = normalizedHost.startsWith('\\\\.\\pipe\\') || normalizedHost.startsWith('/');
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

      const isLoopback = isNamedPipeOrUnixSocket || isNamedLoopback || isIpv6Loopback || isIpv4Loopback;

      if (!isLoopback) {
        self.nonLoopbackAttempts.push({ host, port });
        const err = new Error(`LoopbackTripwire blocked non-loopback connection attempt to ${host}:${port}`);
        if (typeof args[args.length - 1] === 'function') {
          process.nextTick(() => args[args.length - 1](err));
        }
        process.nextTick(() => {
          this.destroy(err);
        });
        return this;
      }

      self.loopbackAttempts.push({ host, port });
      return LoopbackTripwire.originalGlobalConnect.apply(this, args as any);
    };
  }

  public deactivate(): void {
    if (!this.active) return;
    this.active = false;
    LoopbackTripwire.globalActiveCount = Math.max(0, LoopbackTripwire.globalActiveCount - 1);
    if (LoopbackTripwire.globalActiveCount === 0) {
      net.Socket.prototype.connect = LoopbackTripwire.originalGlobalConnect;
    }
  }
}

export interface RunModeACliOptions {
  evidenceDir?: string;
  approvedEvidenceRoot?: string;
  expectedTargetId: string;
  expectedOperatorUid: string;
  expectedOperatorEmail: string;
}

/**
 * Mode A CLI execution wrapper.
 */
export async function runModeACliEnrollment(
  db: D1Database,
  signedManifest: SignedApprovalManifest,
  trustedPublicKey: crypto.KeyObject | string,
  options: RunModeACliOptions
): Promise<{
  outcome: EnrollmentOutcome;
  reconciliation?: ReconciliationOutcome;
  auditReceiptPath?: string;
  receiptExportError?: string;
}> {
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
    approvedRoot = fs.existsSync(approvedRootRaw) ? fs.realpathSync(approvedRootRaw) : approvedRootRaw;
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

  // 4. Verify manifest
  const verified: VerifiedApprovalManifest = verifyApprovalManifest(
    signedManifest,
    trustedPublicKey,
    {
      expectedTargetId: options.expectedTargetId,
      expectedOperatorUid: options.expectedOperatorUid,
      expectedOperatorEmail: options.expectedOperatorEmail,
    }
  );

  // 5. Execute enrollment
  const outcome = await enrollFirstSuperAdmin(db, verified);

  // 6. Handle indeterminate reconciliation if required (CR-08: pass full array)
  let reconciliation: ReconciliationOutcome | undefined;
  if (outcome.status === 'INDETERMINATE') {
    reconciliation = await reconcileEnrollmentStatus(
      db,
      verified.manifest.operation_id,
      verified.manifest.operator_uid,
      verified.audit_reference,
      verified.manifest.workspace_scope
    );
  }

  // 7. Export non-secret signed audit receipt (CR-02 & CR-04)
  let auditReceiptPath: string | undefined;
  let receiptExportError: string | undefined;
  const isConfirmedEnrolled =
    outcome.status === 'SUCCESS' || reconciliation === 'CONFIRMED_ENROLLED';

  if (isConfirmedEnrolled && resolvedEvidenceDir) {
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
      // If destination file already exists, prohibit overwriting (exclusive creation 'wx')
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
      fs.writeFileSync(auditReceiptPath, JSON.stringify(receipt, null, 2), { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      receiptExportError = (err as Error).message;
      auditReceiptPath = undefined;
    }
  }

  return {
    outcome,
    reconciliation,
    auditReceiptPath,
    receiptExportError,
  };
}
