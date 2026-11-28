/** Target guard for the separately authorized Windows local development enrollment. */
import path from 'node:path';

export interface WindowsLocalTargetConfig {
  root: string;
  database: string;
  uid: string;
  email: string;
}

const WINDOWS_DRIVE_ROOT_RE = /^[A-Za-z]:\\/;
const SQLITE_FILENAME_RE = /^[A-Za-z0-9._-]+\.sqlite$/;
const UID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requireNonEmpty(value: string | undefined, name: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    throw new Error(`Missing or blank ${name} in private runtime configuration`);
  }
  return trimmed;
}

export function assertValidTargetConfig(config: WindowsLocalTargetConfig): WindowsLocalTargetConfig {
  const root = requireNonEmpty(config.root, 'CABMS_WINDOWS_LOCAL_ROOT');
  if (
    !WINDOWS_DRIVE_ROOT_RE.test(root) ||
    root.startsWith('\\\\') ||
    root.includes('..') ||
    /^[a-zA-Z]+:\/\//.test(root)
  ) {
    throw new Error('Malformed CABMS_WINDOWS_LOCAL_ROOT: absolute Windows drive path required');
  }
  const database = requireNonEmpty(config.database, 'CABMS_WINDOWS_LOCAL_DATABASE');
  if (!SQLITE_FILENAME_RE.test(database) || database.includes('/') || database.includes('\\') || database.includes('..')) {
    throw new Error('Malformed CABMS_WINDOWS_LOCAL_DATABASE: single .sqlite filename required');
  }
  const uid = requireNonEmpty(config.uid, 'CABMS_WINDOWS_LOCAL_UID');
  if (!UID_RE.test(uid)) {
    throw new Error('Malformed CABMS_WINDOWS_LOCAL_UID');
  }
  const email = requireNonEmpty(config.email, 'CABMS_WINDOWS_LOCAL_EMAIL');
  if (!EMAIL_RE.test(email)) {
    throw new Error('Malformed CABMS_WINDOWS_LOCAL_EMAIL');
  }
  return {
    root: path.win32.normalize(root),
    database,
    uid,
    email,
  };
}

/** Load owner-controlled private Windows target configuration from runtime environment outside Git. */
export function loadWindowsLocalTargetConfig(
  env: Record<string, string | undefined> = process.env
): WindowsLocalTargetConfig {
  return assertValidTargetConfig({
    root: env.CABMS_WINDOWS_LOCAL_ROOT ?? '',
    database: env.CABMS_WINDOWS_LOCAL_DATABASE ?? '',
    uid: env.CABMS_WINDOWS_LOCAL_UID ?? '',
    email: env.CABMS_WINDOWS_LOCAL_EMAIL ?? '',
  });
}

/** Validate caller-supplied values against an independently loaded target before inspecting or opening any database. */
export function validateWindowsLocalTarget(
  input: { root: string; database?: string; uid: string; email: string; local: boolean },
  expected: WindowsLocalTargetConfig
): void {
  if (process.platform !== 'win32') throw new Error('Windows local target required');
  const trusted = assertValidTargetConfig(expected);
  const suppliedRoot = requireNonEmpty(input.root, 'input.root');
  if (
    !WINDOWS_DRIVE_ROOT_RE.test(suppliedRoot) ||
    suppliedRoot.startsWith('\\\\') ||
    suppliedRoot.includes('..')
  ) {
    throw new Error('Invalid local database root');
  }
  if (input.local !== true || path.win32.normalize(suppliedRoot).toLowerCase() !== trusted.root.toLowerCase()) {
    throw new Error('Unexpected local database root');
  }
  if (input.database !== undefined && input.database !== trusted.database) {
    throw new Error('Unexpected local database target');
  }
  if (input.uid !== trusted.uid || input.email !== trusted.email) {
    throw new Error('Unexpected local identity');
  }
}
