/** Authenticated local synthetic scheduling prototype. No provider or technician assignment. */
import React from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { useWorkspaceDemoData, demoDataMessage } from '../hooks/useWorkspaceDemoData.ts';
import { buildApiUrl } from '../services/g01Client.ts';
import { validDemoAppointmentRange, type DemoAppointment } from '../../contracts/demoAppointments.ts';

export class AppointmentApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'AppointmentApiError';
  }
}

async function request<T>(workspace:string, token:string, path:string, method='GET', body?:unknown):Promise<T> {
  const response=await fetch(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspace)}/demo-appointments${path}`),{method,signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if (!response.ok) {
    let detail = '';
    let code: string | undefined;
    try {
      const data = await response.json() as { detail?: string; title?: string; code?: string };
      detail = data.detail || data.title || '';
      code = data.code;
    } catch {}
    throw new AppointmentApiError(response.status, detail || `Request failed (HTTP ${response.status}).`, code);
  }
  return response.json() as Promise<T>;
}

export function G04AppointmentsView({ fallback }: { fallback?: React.ReactNode } = {}) {
  const session=useG01Session()!; const workspace=session.workspaceId; const data=useWorkspaceDemoData(false);
  const role=session.profile?.memberships.find(m=>m.workspace_id===workspace)?.role; const eligible=!!role && role!=='technician';
  const [appointments,setAppointments]=React.useState<DemoAppointment[]>([]); const [jobId,setJobId]=React.useState('');
  const [start,setStart]=React.useState('2026-11-05T01:00:00.000Z'),[end,setEnd]=React.useState('2026-11-05T02:00:00.000Z');
  const [message,setMessage]=React.useState('Loading synthetic appointments...'),[busy,setBusy]=React.useState(false),[locked,setLocked]=React.useState(false);
  const [isEnvironmentDisabled,setIsEnvironmentDisabled]=React.useState(false);
  const epoch=React.useRef(0), viewEpoch=React.useRef(0), authEpoch=React.useRef(0), inFlight=React.useRef(false), environmentDisabledRef=React.useRef(false);

  React.useEffect(()=>{
    return()=>{viewEpoch.current++;};
  },[workspace, session.profile?.user?.id, eligible]);

  const refresh=React.useCallback(async()=>{
    if(!workspace || !eligible)return;
    const activeWorkspace=workspace;
    const currentViewEpoch=viewEpoch.current;
    const currentAuthEpoch=authEpoch.current;
    const n=++epoch.current;
    let token:string;
    try {
      token=await session.token();
    } catch {
      if(n===epoch.current && viewEpoch.current===currentViewEpoch && session.workspaceId===activeWorkspace){
        authEpoch.current++;
        epoch.current++;
        setAppointments([]);
        setMessage('Session could not be verified; sign in again.');
      }
      return;
    }
    try {
      const rows=await request<DemoAppointment[]>(activeWorkspace,token,'');
      if(n===epoch.current && viewEpoch.current===currentViewEpoch && session.workspaceId===activeWorkspace && authEpoch.current===currentAuthEpoch){
        environmentDisabledRef.current=false;
        setIsEnvironmentDisabled(false);
        setAppointments(rows);
        setMessage('');
      }
    } catch (error: unknown) {
      if(n===epoch.current && viewEpoch.current===currentViewEpoch && session.workspaceId===activeWorkspace && authEpoch.current===currentAuthEpoch){
        if (error instanceof AppointmentApiError && error.status === 404) {
          setAppointments([]);
          environmentDisabledRef.current=true;
          setIsEnvironmentDisabled(true);
          setMessage('Synthetic scheduling is disabled in this environment.');
        } else if (environmentDisabledRef.current) {
          setAppointments([]);
          setIsEnvironmentDisabled(true);
          setMessage('Synthetic scheduling is disabled in this environment.');
        } else if (error instanceof AppointmentApiError && (error.status === 401 || error.status === 403)) {
          authEpoch.current++;
          epoch.current++;
          setAppointments([]);
          setMessage('Access denied. Synthetic appointments are unavailable.');
        } else {
          setMessage(prev => prev.startsWith('Saved') ? prev : 'Unable to load synthetic appointments.');
        }
      }
    }
  },[workspace,session.profile?.user?.id,role]);

  React.useEffect(()=>{
    setAppointments([]);
  },[workspace]);

  React.useEffect(()=>{
    if(!eligible){
      authEpoch.current++;
      epoch.current++;
      setAppointments([]);
      setMessage('');
    }
  },[eligible]);

  React.useEffect(()=>{
    if(eligible)void refresh();
  },[refresh,eligible]);

  const mutate=async(path:string,method:string,body:unknown)=>{
    if(!workspace || inFlight.current || locked)return;
    if (body && typeof body === 'object' && 'starts_at' in body && 'ends_at' in body && !validDemoAppointmentRange(body.starts_at,body.ends_at)) {setMessage('Enter valid UTC start and end times, with the end after the start.');return;}
    const activeWorkspace=workspace;
    const mutationViewEpoch=viewEpoch.current;
    const mutationAuthEpoch=authEpoch.current;
    const mutationEpoch=++epoch.current;
    inFlight.current=true;setBusy(true);setMessage('Saving synthetic appointment...');
    let token:string;
    try {token=await session.token();}
    catch {authEpoch.current++;epoch.current++;setAppointments([]);setMessage('Session could not be verified; no change was sent.');inFlight.current=false;setBusy(false);return;}
    try {
      const saved=await request<DemoAppointment>(activeWorkspace,token,path,method,body);
      if(mutationViewEpoch!==viewEpoch.current || session.workspaceId!==activeWorkspace || mutationAuthEpoch!==authEpoch.current)return;
      setAppointments(prev=>{
        const remaining=prev.filter(a=>a.id!==saved.id);
        return [...remaining,saved].sort((a,b)=>a.starts_at.localeCompare(b.starts_at)||a.id.localeCompare(b.id));
      });
      setMessage('Saved. Refreshing...');
      const n=++epoch.current;
      try {
        const rows=await request<DemoAppointment[]>(activeWorkspace,token,'');
        if(n===epoch.current && session.workspaceId===activeWorkspace && mutationViewEpoch===viewEpoch.current && mutationAuthEpoch===authEpoch.current){
          environmentDisabledRef.current=false;
          setIsEnvironmentDisabled(false);
          setAppointments(rows);
          setMessage('');
        }
      } catch (refreshError: unknown) {
        if(n===epoch.current && session.workspaceId===activeWorkspace && mutationViewEpoch===viewEpoch.current){
          if(refreshError instanceof AppointmentApiError && refreshError.status===404){
            setAppointments([]);
            environmentDisabledRef.current=true;
            setIsEnvironmentDisabled(true);
            setMessage('Synthetic scheduling is disabled in this environment.');
          } else if (environmentDisabledRef.current) {
            setAppointments([]);
            setIsEnvironmentDisabled(true);
            setMessage('Synthetic scheduling is disabled in this environment.');
          } else if (refreshError instanceof AppointmentApiError && (refreshError.status === 401 || refreshError.status === 403)) {
            authEpoch.current++;
            epoch.current++;
            setAppointments([]);
            setMessage('Saved, but subsequent access was denied. Cleared synthetic appointments.');
          } else {
            setMessage('Saved. (List refresh failed; displaying confirmed save.)');
          }
        }
      }
    } catch (error: unknown) {
      if(mutationViewEpoch!==viewEpoch.current || session.workspaceId!==activeWorkspace)return;
      if (error instanceof AppointmentApiError) {
        if (error.status === 401) {
          authEpoch.current++;
          epoch.current++;
          setAppointments([]);
          setMessage('Session could not be verified; sign in again.');
          return;
        }
        if (error.status === 403) {
          authEpoch.current++;
          epoch.current++;
          setAppointments([]);
          if (error.code === 'ACCESS_DENIED') {
            setMessage(`Save rejected: permission denied. (${error.message})`);
            return;
          }
          setLocked(true);
          setMessage('Save outcome is unknown. Do not retry until the outcome is independently verified; refresh alone may not establish it.');
          return;
        }
        if (error.status === 404) {
          setAppointments([]);
          environmentDisabledRef.current=true;
          setIsEnvironmentDisabled(true);
          setMessage('Synthetic scheduling is disabled in this environment.');
          return;
        }
      }
      if(mutationEpoch!==epoch.current){
        const definite=error instanceof AppointmentApiError && [400,409,422].includes(error.status);
        if(!definite){
          setLocked(true);
          setMessage('Save outcome is unknown. Do not retry until the outcome is independently verified; refresh alone may not establish it.');
          return;
        }
      }
      if (error instanceof AppointmentApiError) {
        if (error.status === 409) {
          setMessage(`Save rejected: conflict or stale appointment version. (${error.message})`);
          return;
        }
        if (error.status === 422 || error.status === 400) {
          setMessage(`Save rejected: invalid appointment parameters. (${error.message})`);
          return;
        }
      }
      setLocked(true);
      setMessage('Save outcome is unknown. Do not retry until the outcome is independently verified; refresh alone may not establish it.');
    } finally {
      inFlight.current=false;
      setBusy(false);
    }
  };

  const allowed=data.status==='ready';

  return (
    <div className="space-y-6">
      <section className="cabms-card p-5 space-y-4">
        <h1>Synthetic demo appointments</h1>
        <p>Local demo records only. Technician assignment, calendar sync and email are not connected. Times must be UTC, for example 2026-11-05T01:00:00.000Z.</p>
        {demoDataMessage(data) && <p role="alert">{demoDataMessage(data)}</p>}{message && <p role="status">{message}</p>}
        {locked && <p role="alert">Changes are locked in this view because the prior outcome may be uncertain. Navigating away clears this lock; do not retry until the outcome is verified.</p>}
        {!isEnvironmentDisabled && eligible && <div className="space-y-2">
          <label>UTC start <input value={start} required onChange={e=>setStart(e.target.value)} /></label><label>UTC end <input value={end} required onChange={e=>setEnd(e.target.value)} /></label>
        </div>}
        {!isEnvironmentDisabled && allowed && <form onSubmit={e=>{e.preventDefault();void mutate('','POST',{job_id:jobId,starts_at:start,ends_at:end});}} className="space-y-2">
          <label>Saved synthetic job <select value={jobId} required onChange={e=>setJobId(e.target.value)}><option value="">Select job</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.title} - {j.id}</option>)}</select></label>
          <button type="submit" disabled={busy||locked}>Create synthetic appointment</button>
        </form>}
        {!isEnvironmentDisabled && eligible && <button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh appointments</button>}
        {isEnvironmentDisabled && eligible && <button type="button" disabled={busy} onClick={()=>void refresh()}>Check availability</button>}
        {!isEnvironmentDisabled && eligible && <ul>{appointments.map(a=><li key={a.id}>{a.job_id} - {a.starts_at} to {a.ends_at} - {a.status} - version {a.version}
          {a.status==='scheduled' && <><button type="button" disabled={busy||locked} onClick={()=>void mutate('/'+encodeURIComponent(a.id),'PATCH',{version:a.version,starts_at:start,ends_at:end})}>Reschedule using UTC fields</button><button type="button" disabled={busy||locked} onClick={()=>void mutate('/'+encodeURIComponent(a.id),'PATCH',{version:a.version,status:'cancelled'})}>Cancel appointment</button></>}
        </li>)}</ul>}
      </section>
      {(!eligible || isEnvironmentDisabled) && fallback}
    </div>
  );
}
