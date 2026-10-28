/**
 * CABMS Worker Structured Logger
 * Emits redacted, structured JSON telemetry with request correlation,
 * UTC timestamps, safe event names, and mandatory credential/sensitive-data redaction.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface StructuredLogEntry {
  timestamp: string; // ISO 8601 UTC
  level: LogLevel;
  event: string;
  request_id: string;
  duration_ms?: number;
  status_code?: number;
  workspace_id?: string;
  user_id?: string;
  message: string;
  fields?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
  };
}

const REDACTED_MARKER = '[REDACTED]';
const EVENTS = new Set(['AUTH_FAILED', 'ACCESS_DENIED', 'SETTINGS_READ', 'INSUFFICIENT_PERMISSIONS', 'PRECONDITION_REQUIRED', 'VALIDATION_FAILED', 'PRECONDITION_FAILED', 'SETTINGS_NO_OP', 'SETTINGS_UPDATED', 'SETTINGS_UPDATE_ERROR', 'LEGAL_READ', 'LEGAL_WRITE_DENIED', 'LEGAL_NO_OP', 'LEGAL_UPDATED', 'LEGAL_UPDATE_ERROR', 'WORKER_UNHANDLED_EXCEPTION']);
const NUMBER_FIELDS = new Set(['version', 'new_version', 'expected_version', 'current_version']);

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /password/i,
  /secret/i,
  /auth/i,
  /credential/i,
  /cookie/i,
  /abn/i,
  /licence/i,
  /license/i,
  /registration/i,
  /key/i,
];

/**
 * Recursively sanitizes structured log fields to exclude credentials,
 * tokens, passwords, and sensitive legal numbers.
 */
export function sanitizeLogFields(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string') {
    // Redact Bearer tokens if accidentally passed
    if (val.startsWith('Bearer ') || val.length > 200) {
      return REDACTED_MARKER;
    }
    return val;
  }
  if (typeof val === 'number' || typeof val === 'boolean') {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(item => sanitizeLogFields(item));
  }
  if (typeof val === 'object') {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERNS.some(pat => pat.test(k))) {
        clean[k] = REDACTED_MARKER;
      } else {
        clean[k] = sanitizeLogFields(v);
      }
    }
    return clean;
  }
  return String(val);
}

export class StructuredLogger {
  constructor(
    private readonly requestId: string,
    private readonly workspaceId?: string,
    private readonly userId?: string
  ) {}

  log(
    level: LogLevel,
    event: string,
    message: string,
    extra?: {
      durationMs?: number;
      statusCode?: number;
      fields?: Record<string, unknown>;
      error?: Error;
    }
  ): StructuredLogEntry {
    // Free-form messages, exception text and arbitrary structured fields are never serialized.
    const safeEvent = EVENTS.has(event) ? event : 'UNKNOWN_EVENT';
    const fields = Object.fromEntries(Object.entries(extra?.fields || {}).filter(([key, value]) =>
      NUMBER_FIELDS.has(key) && typeof value === 'number' && Number.isSafeInteger(value)));
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event: safeEvent,
      request_id: /^req_[0-9a-f-]{36}$/.test(this.requestId) ? this.requestId : 'uncorrelated',
      message: safeEvent,
      ...(['solarcell', 'smart_home', 'cctv'].includes(this.workspaceId || '') ? { workspace_id: this.workspaceId } : {}),
      ...(extra?.durationMs !== undefined ? { duration_ms: extra.durationMs } : {}),
      ...(extra?.statusCode !== undefined ? { status_code: extra.statusCode } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
      ...(extra?.error
        ? {
            error: {
              name: 'Error',
              message: 'Operation failed; inspect privacy-safe request correlation.',
            },
          }
        : {}),
    };

    // Output formatted JSON
    const serialized = JSON.stringify(entry);
    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }

    return entry;
  }

  info(event: string, message: string, extra?: Parameters<StructuredLogger['log']>[3]): StructuredLogEntry {
    return this.log('INFO', event, message, extra);
  }

  warn(event: string, message: string, extra?: Parameters<StructuredLogger['log']>[3]): StructuredLogEntry {
    return this.log('WARN', event, message, extra);
  }

  error(event: string, message: string, extra?: Parameters<StructuredLogger['log']>[3]): StructuredLogEntry {
    return this.log('ERROR', event, message, extra);
  }
}
