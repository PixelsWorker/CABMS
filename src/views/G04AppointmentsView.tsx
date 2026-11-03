/** Authenticated local synthetic scheduling prototype. No provider or technician assignment. */
import React from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { useWorkspaceDemoData, demoDataMessage } from '../hooks/useWorkspaceDemoData.ts';
import { buildApiUrl } from '../services/g01Client.ts';
import { validDemoAppointmentRange, type DemoAppointment } from '../../contracts/demoAppointments.ts';

async function request<T>(workspace:string, token:string, path:string, method='GET', body?:unknown):Promise<T> {
 const response=await fetch(buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(workspace)}/demo-appointments${path}`),{method,signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 if (!response.ok) throw new Error(`Request failed (HTTP ${response.status}).`);
 return response.json() as Promise<T>;
}
export function G04AppointmentsView() {
 const session=useG01Session()!; const workspace=session.workspaceId; const data=useWorkspaceDemoData(false);
 const role=session.profile?.memberships.find(m=>m.workspace_id===workspace)?.role; const eligible=!!role && role!=='technician';
 const [appointments,setAppointments]=React.useState<DemoAppointment[]>([]); const [jobId,setJobId]=React.useState('');
 const [start,setStart]=React.useState('2026-11-05T01:00:00.000Z'),[end,setEnd]=React.useState('2026-11-05T02:00:00.000Z');
 const [message,setMessage]=React.useState('Loading synthetic appointments...'),[busy,setBusy]=React.useState(false),[locked,setLocked]=React.useState(false);
 const epoch=React.useRef(0), inFlight=React.useRef(false);
 const refresh=React.useCallback(async()=>{ if(!workspace || !eligible)return; const n=++epoch.current; try {const token=await session.token(); const rows=await request<DemoAppointment[]>(workspace,token,'');if(n===epoch.current){setAppointments(rows);setMessage('');}} catch {if(n===epoch.current){setAppointments([]);setMessage('Unable to load synthetic appointments.');}} },[workspace,session.profile?.user.id,role]);
 React.useEffect(()=>{setAppointments([]);if(eligible)void refresh();else setMessage('');return()=>{epoch.current++;};},[refresh,eligible]);
 const mutate=async(path:string,method:string,body:unknown)=>{
  if(!workspace || inFlight.current || locked)return;
  if (body && typeof body === 'object' && 'starts_at' in body && 'ends_at' in body && !validDemoAppointmentRange(body.starts_at,body.ends_at)) {setMessage('Enter valid UTC start and end times, with the end after the start.');return;}
  inFlight.current=true;setBusy(true);setMessage('Saving synthetic appointment...');
  let token:string;
  try {token=await session.token();}
  catch {setMessage('Session could not be verified; no change was sent.');inFlight.current=false;setBusy(false);return;}
  try {await request(workspace,token,path,method,body);setMessage('Saved. Refreshing...');await refresh();}
  catch {setLocked(true);setMessage('Save outcome is unknown. Do not retry until the outcome is independently verified; refresh alone may not establish it.');}
  finally {inFlight.current=false;setBusy(false);}
 };
 const allowed=data.status==='ready';
 return <section className="cabms-card p-5 space-y-4"><h1>Synthetic demo appointments</h1>
  <p>Local demo records only. Technician assignment, calendar sync and email are not connected. Times must be UTC, for example 2026-11-05T01:00:00.000Z.</p>
  {demoDataMessage(data) && <p role="alert">{demoDataMessage(data)}</p>}{message && <p role="status">{message}</p>}
  {locked && <p role="alert">Changes are locked in this view because the prior outcome may be uncertain. Navigating away clears this lock; do not retry until the outcome is verified.</p>}
  {allowed && <form onSubmit={e=>{e.preventDefault();void mutate('','POST',{job_id:jobId,starts_at:start,ends_at:end});}} className="space-y-2">
   <label>Saved synthetic job <select value={jobId} required onChange={e=>setJobId(e.target.value)}><option value="">Select job</option>{data.jobs.map(j=><option key={j.id} value={j.id}>{j.title} - {j.id}</option>)}</select></label>
   <label>UTC start <input value={start} required onChange={e=>setStart(e.target.value)} /></label><label>UTC end <input value={end} required onChange={e=>setEnd(e.target.value)} /></label>
   <button type="submit" disabled={busy||locked}>Create synthetic appointment</button>
  </form>}
  {eligible && <button type="button" disabled={busy} onClick={()=>void refresh()}>Refresh appointments</button>}
  {allowed && <ul>{appointments.map(a=><li key={a.id}>{a.job_id} - {a.starts_at} to {a.ends_at} - {a.status} - version {a.version}
    {a.status==='scheduled' && <><button type="button" disabled={busy||locked} onClick={()=>void mutate('/'+encodeURIComponent(a.id),'PATCH',{version:a.version,starts_at:start,ends_at:end})}>Reschedule using UTC fields</button><button type="button" disabled={busy||locked} onClick={()=>void mutate('/'+encodeURIComponent(a.id),'PATCH',{version:a.version,status:'cancelled'})}>Cancel appointment</button></>}
  </li>)}</ul>}
 </section>;
}
