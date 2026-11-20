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
      if (!res.headers.get('Content-Type')?.includes('application/json')) throw new Error('Unexpected content type');
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
        detail: 'The server returned an unexpected response. Use the request ID for support.',
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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(10000),
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

// ---------------------------------------------------------------------------
// Job Types & Compliance Policies Client API
// ---------------------------------------------------------------------------

export async function apiListJobTypes(workspaceId: string, token: string): Promise<ApiResponse<any[]>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types`), {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any[]>(await customFetch(req));
}

export async function apiGetJobType(workspaceId: string, id: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}`), {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiCreateJobType(workspaceId: string, token: string, data: any): Promise<ApiResponse<{ id: string; policyId: string }>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  return parseResponse<{ id: string; policyId: string }>(await customFetch(req));
}

export async function apiPatchJobType(workspaceId: string, id: string, token: string, updates: any): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiDeleteJobType(workspaceId: string, id: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiCreateJobTypePolicyDraft(workspaceId: string, id: string, token: string, data: any): Promise<ApiResponse<{ id: string; version: string }>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}/policies`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  return parseResponse<{ id: string; version: string }>(await customFetch(req));
}

export async function apiSubmitJobTypePolicyReview(workspaceId: string, id: string, policyId: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}/policies/${encodeURIComponent(policyId)}/review`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiApproveJobTypePolicy(workspaceId: string, id: string, policyId: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/job-types/${encodeURIComponent(id)}/policies/${encodeURIComponent(policyId)}/approve`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

// ---------------------------------------------------------------------------
// Document Templates & Revisions Client API
// ---------------------------------------------------------------------------

export async function apiListTemplates(workspaceId: string, token: string): Promise<ApiResponse<any[]>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates`), {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any[]>(await customFetch(req));
}

export async function apiGetTemplate(workspaceId: string, id: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}`), {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiCreateTemplate(workspaceId: string, token: string, data: any): Promise<ApiResponse<{ id: string; revisionId: string }>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(data),
  });
  return parseResponse<{ id: string; revisionId: string }>(await customFetch(req));
}

export async function apiPatchTemplate(workspaceId: string, id: string, token: string, updates: any): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(updates),
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiDeleteTemplate(workspaceId: string, id: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiCreateTemplateRevisionDraft(workspaceId: string, id: string, token: string, content: string): Promise<ApiResponse<{ id: string; version: string }>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}/revisions`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ content }),
  });
  return parseResponse<{ id: string; version: string }>(await customFetch(req));
}

export async function apiSubmitTemplateRevisionReview(workspaceId: string, id: string, revId: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}/review`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

export async function apiApproveTemplateRevision(workspaceId: string, id: string, revId: string, token: string): Promise<ApiResponse<any>> {
  const req = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/templates/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revId)}/approve`), {
    method: 'POST',
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return parseResponse<any>(await customFetch(req));
}

/** Form catalog requests use the same transport and problem handling as G01. */
export async function apiFormCatalog<T>(workspaceId: string, token: string, path = '', method = 'GET', body?: unknown): Promise<ApiResponse<T>> {
  const request = new Request(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/form-definitions${path}`), {
    method,
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, application/problem+json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return parseResponse<T>(await customFetch(request));
}
