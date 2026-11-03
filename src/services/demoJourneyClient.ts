import type { CreateDemoEnquiry, DemoEnquiry, DemoJob } from '../../contracts/demoJourney.ts';
import { buildApiUrl } from './g01Client.ts';

export class DemoJourneyError extends Error {
 constructor(public readonly status: number, message: string, public readonly requestId?: string) { super(requestId ? `${message} (Ref: ${requestId})` : message); this.name = 'DemoJourneyError'; }
}

export async function demoJourneyRequest<T>(workspace: string, token: string, path: string, method = 'GET', body?: CreateDemoEnquiry): Promise<T> {
 const response = await fetch(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspace)}/${path}`), {
  method, signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? {body:JSON.stringify(body)} : {}),
 });
 if (!response.ok) {
  let message = 'Could not save or load demo data. Please retry.';
  const validId = (value: unknown): value is string => typeof value === 'string' && /^req_[a-zA-Z0-9-]{1,80}$/.test(value);
  let requestId: string | undefined;
  try { const problem = await response.json() as {detail?: unknown; request_id?: unknown}; if (typeof problem.detail === 'string') message = problem.detail; if (validId(problem.request_id)) requestId = problem.request_id; } catch { /* generic error */ }
  const header = response.headers.get('X-Request-Id');
  if (!requestId && validId(header)) requestId = header;
  throw new DemoJourneyError(response.status, message, requestId);
 }
 return response.json() as Promise<T>;
}
export type { DemoEnquiry, DemoJob };
