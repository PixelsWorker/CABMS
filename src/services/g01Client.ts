/**
 * CABMS G01 API Client
 * Provides typed access to the Cloudflare Worker G01 endpoints with:
 * - RFC 9457 Problem Details error parsing
 * - Strong ETag and If-Match precondition handling
 * - Independent workspace settings and legal details operations
 */

import type {
  WorkspaceSettingsRow,
  LegalIssuerRow,
  EditableWorkspaceSettings,
  EditableLegalDetails,
  ProblemDetails,
} from '../../contracts/settings.ts';

export type FetchHandler = (request: Request) => Promise<Response>;

let customFetch: FetchHandler = (req: Request) => globalThis.fetch(req);
let apiBase: string | null = null;

export function setApiFetchHandler(handler: FetchHandler): void {
  customFetch = handler;
}

export function resetApiFetchHandler(): void {
  customFetch = (req: Request) => globalThis.fetch(req);
}

export function setApiBase(base: string | null): void {
  apiBase = base;
}

export function resetApiBase(): void {
  apiBase = null;
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (apiBase) {
    return `${apiBase.replace(/\/+$/, '')}${normalizedPath}`;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}${normalizedPath}`;
  }
  return `http://localhost${normalizedPath}`;
}

export interface ApiResponse<T> {
  ok: boolean;
  status: number;
  data?: T;
  etag?: string;
  problem?: ProblemDetails;
  isConflict?: boolean; // 412 Precondition Failed
  isPreconditionRequired?: boolean; // 428
  isForbidden?: boolean; // 403
  isUnauthorized?: boolean; // 401
}

async function parseResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const etag = res.headers.get('ETag') || undefined;

  if (res.ok) {
    try {
      const data = (await res.json()) as T;
      return { ok: true, status: res.status, data, etag };
    } catch {
      return {
        ok: false,
        status: res.status,
        etag,
        problem: {
          type: 'https://api.cabms.example.invalid/errors/invalid-response',
          title: 'Invalid Response',
          status: res.status,
          detail: 'The server response was not valid JSON.',
          code: 'INVALID_RESPONSE',
          retryable: false,
          request_id: res.headers.get('X-Request-Id') || 'unknown',
        },
      };
    }
  }

  let problem: ProblemDetails | undefined;
  try {
    const contentType = res.headers.get('Content-Type') || '';
    if (contentType.includes('problem+json') || contentType.includes('json')) {
      problem = (await res.json()) as ProblemDetails;
    } else {
      problem = {
        type: 'https://api.cabms.example.invalid/errors/unknown',
        title: 'HTTP Error',
        status: res.status,
        detail: await res.text(),
        code: `HTTP_${res.status}`,
        retryable: false,
        request_id: res.headers.get('X-Request-Id') || 'unknown',
      };
    }
  } catch {
    problem = {
      type: 'https://api.cabms.example.invalid/errors/unknown',
      title: 'HTTP Error',
      status: res.status,
      detail: res.statusText || 'Unknown Error',
      code: `HTTP_${res.status}`,
      retryable: false,
      request_id: 'unknown',
    };
  }

  return {
    ok: false,
    status: res.status,
    problem,
    etag,
    isConflict: res.status === 412,
    isPreconditionRequired: res.status === 428,
    isForbidden: res.status === 403,
    isUnauthorized: res.status === 401,
  };
}

export async function apiGetCurrentUser(
  token: string
): Promise<ApiResponse<{ user: { id: string; email: string; display_name: string | null }; memberships: Array<{ workspace_id: string; role: string; name: string }> }>> {
  const req = new Request(buildApiUrl('/api/v1/auth/me'), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/problem+json',
    },
  });
  const res = await customFetch(req);
  return parseResponse(res);
}

export async function apiGetWorkspaceSettings(
  workspaceId: string,
  token: string
): Promise<ApiResponse<WorkspaceSettingsRow>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/problem+json',
    },
  });
  const res = await customFetch(req);
  return parseResponse<WorkspaceSettingsRow>(res);
}

export async function apiPatchWorkspaceSettings(
  workspaceId: string,
  token: string,
  etag: string,
  patch: Partial<EditableWorkspaceSettings>
): Promise<ApiResponse<WorkspaceSettingsRow>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/settings`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'If-Match': etag,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/problem+json',
    },
    body: JSON.stringify(patch),
  });
  const res = await customFetch(req);
  return parseResponse<WorkspaceSettingsRow>(res);
}

export async function apiGetLegalDetails(
  workspaceId: string,
  token: string
): Promise<ApiResponse<LegalIssuerRow>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/legal-details`), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json, application/problem+json',
    },
  });
  const res = await customFetch(req);
  return parseResponse<LegalIssuerRow>(res);
}

export async function apiPatchLegalDetails(
  workspaceId: string,
  token: string,
  etag: string,
  patch: Partial<EditableLegalDetails>
): Promise<ApiResponse<LegalIssuerRow>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/legal-details`), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'If-Match': etag,
      'Content-Type': 'application/json',
      Accept: 'application/json, application/problem+json',
    },
    body: JSON.stringify(patch),
  });
  const res = await customFetch(req);
  return parseResponse<LegalIssuerRow>(res);
}
