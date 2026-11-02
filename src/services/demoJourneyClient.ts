import type { CreateDemoEnquiry, DemoEnquiry, DemoJob } from '../../contracts/demoJourney.ts';
import { buildApiUrl } from './g01Client.ts';

export class DemoJourneyError extends Error {
 constructor(public readonly status: number, message: string) { super(message); this.name = 'DemoJourneyError'; }
}

export async function demoJourneyRequest<T>(workspace: string, token: string, path: string, method = 'GET', body?: CreateDemoEnquiry): Promise<T> {
 const response = await fetch(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspace)}/${path}`), {
  method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
  ...(body ? {body:JSON.stringify(body)} : {}),
 });
 if (!response.ok) {
  let message = 'Could not save or load demo data. Please retry.';
  try { const problem = await response.json() as {detail?: unknown}; if (typeof problem.detail === 'string') message = problem.detail; } catch { /* generic error */ }
  throw new DemoJourneyError(response.status, message);
 }
 return response.json() as Promise<T>;
}
export type { DemoEnquiry, DemoJob };
