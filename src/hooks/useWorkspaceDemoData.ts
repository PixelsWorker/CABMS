import { useEffect, useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { DemoJourneyError, demoJourneyRequest, type DemoEnquiry, type DemoJob } from '../services/demoJourneyClient.ts';

type State =
 | { status: 'disabled' | 'loading' | 'restricted' }
 | { status: 'ready'; enquiries: DemoEnquiry[]; jobs: DemoJob[] }
 | { status: 'unauthenticated' | 'forbidden' | 'unavailable' | 'error' };

/** Each mounted view reads the API afresh; saved state never comes from G00. */
export function useWorkspaceDemoData(includeEnquiries: boolean): State {
 const session = useG01Session();
 const workspace = session?.workspaceId ?? null;
 const userId = session?.profile?.user.id ?? null;
 const role = session?.profile?.memberships.find(m => m.workspace_id === workspace)?.role ?? null;
 const key = session && workspace && userId && role && role !== 'technician' ? JSON.stringify([userId, workspace, role, includeEnquiries]) : null;
 const [result, setResult] = useState<{ key: string; state: State } | null>(null);
 useEffect(() => {
  if (!session || !workspace || !key) return;
  let active = true;
  setResult({ key, state: { status: 'loading' } });
  void (async () => {
   try {
    const token = await session.token();
    const [jobs, enquiries] = await Promise.all([
     demoJourneyRequest<DemoJob[]>(workspace, token, 'jobs'),
     includeEnquiries ? demoJourneyRequest<DemoEnquiry[]>(workspace, token, 'enquiries') : Promise.resolve([]),
    ]);
    if (active) setResult({ key, state: { status: 'ready', jobs, enquiries } });
   } catch (error) {
    if (!active) return;
    const status = error instanceof DemoJourneyError ? error.status : 0;
    setResult({ key, state: { status: status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 503 ? 'unavailable' : 'error' } });
   }
  })();
  return () => { active = false; };
 }, [key, workspace, userId, includeEnquiries]);
 if (!session) return { status: 'disabled' };
 if (role === 'technician') return { status: 'restricted' };
 if (!key) return { status: 'unauthenticated' };
 return result?.key === key ? result.state : { status: 'loading' };
}

export function demoDataMessage(state: State): string | null {
 switch (state.status) {
  case 'loading': return 'Loading saved demo data…';
  case 'restricted': return 'Saved demo enquiries and jobs are restricted to office staff and administrators.';
  case 'unauthenticated': return 'Your session could not be verified. Sign in again.';
  case 'forbidden': return 'You do not have access to saved demo data in this workspace.';
  case 'unavailable': return 'Saved demo data is temporarily unavailable. Try again later.';
  case 'error': return 'Could not load saved demo data. Please retry.';
  default: return null;
 }
}
