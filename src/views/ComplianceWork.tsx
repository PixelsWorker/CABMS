import {OperationalJobsPanel} from './DashboardView.tsx';
import {ReturnToJob} from './ComplianceFormsView.tsx';
import {JobSearch,WorkOrdersHeader} from './JobsView.tsx';
import {BrandLogo} from '../components/BrandLogo.tsx';
import React,{useEffect,useRef,useState} from 'react';
import {applicableFormAnswers} from '../../contracts/applicableFormAnswers.ts';
import {isConfirmedRejection,JobError,resizePhoto,signIntent,type Detail,type Field,type Job,type JobsClient,type Membership,type Requirement} from '../services/complianceJobsClient.ts';
import {generateUuid} from '../utils/uuid.ts';

type Screen='dashboard'|'jobs'|'compliance';
type Props={actorId:string;initialJob?:Pick<Job,'workspace_id'|'id'>;onForm?:()=>void;activeWorkspace?:string;onWorkspace?:(id:string)=>void;api:JobsClient;memberships:Membership[];screen:Screen;onJobs:()=>void;onLogin:()=>Promise<void>};
const statusLabel={OPEN:'Open',SCHEDULED:'Scheduled',IN_PROGRESS:'In progress',COMPLETED:'Completed',CANCELLED:'Cancelled'};
function jobStatuses(job:Job):string[]{
 if(job.status!=='OPEN')return [job.status];
 return ['OPEN',...(job.scheduled?['SCHEDULED']:[]),...(job.started?['IN_PROGRESS']:[])];
}
const blockerLabel:Record<string,string>={SIGNOFF_REQUIRED:'Sign the current answers',ANSWERS_REQUIRED:'Save the form answers',EVIDENCE_REQUIRED:'Attach verified evidence',
 EVIDENCE_REFERENCE_INVALID:'Choose a verified photo for this field',EVIDENCE_INVALID:'Evidence failed verification',EVIDENCE_UNAVAILABLE:'Evidence storage is unavailable',
 ANSWER_INVALID:'Review the response',FAILED_ANSWER:'Correct the failed check',UNRESOLVED_FINDING:'Resolve the compliance finding',INSTANCE_REQUIRED:'Required form instance is missing',
 EMPTY_POLICY:'Review the empty compliance policy',ANSWER_REVIEW_REQUIRED:'Review and save the applicable answers, then sign again',RECENT_SIGN_IN_REQUIRED:'Sign in again before signing',AUTOFILL_UNAVAILABLE:'Required job or assignee auto-fill details are missing',JOB_CANCELLED:'This job was cancelled',JOB_COMPLETED:'This job is already closed'};
const brands:Record<string,string>={solarcell:'Solarcell',smart_home:'Gold Coast Smart Home Solutions',cctv:'Gold Coast CCTV'};
function Brand({id}:{id:string}){return <span className={'cw-brand cw-'+id}><BrandLogo brandId={id} variant="mark"/>{brands[id]??id}</span>;}
const describe=(e:unknown)=>e instanceof Error?e.message:'The service is unavailable. Try again.';
function Control({field,value,onChange}:{field:Field;value:unknown;onChange:(v:unknown)=>void}){
 const id='cw-field-'+field.key, label=field.label||field.key;
 const opts=field.choices?.length?field.choices:({PASS_FAIL:['PASS','FAIL'],PASS_FAIL_NA:['PASS','FAIL','NA'],YES_NO_NA:['YES','NO','NA']} as Record<string,string[]>)[field.type];
 if(['PHOTO','FILE','SIGNATURE'].includes(field.type))return null;
 if(field.type==='READONLY_AUTOFILL'){
  return <label className="cw-field" htmlFor={id}>{label}{field.required?' (required)':''}<span className="text-xs opacity-75"> · Auto-filled</span>
   <input id={id} type="text" readOnly disabled value={String(value??'')} placeholder="(System auto-filled upon sign-off)"/>
  </label>;
 }
 if(field.type==='REPEATABLE_TABLE'){
  const rows=Array.isArray(value)?value as Record<string,unknown>[]:[];
  return <fieldset><legend>{label}</legend>{rows.map((row,i)=><fieldset key={i}><legend>Row {i+1}</legend>{field.validation?.columns?.map(col=><Control key={col.key} field={{...col,key:field.key+'-'+i+'-'+col.key}} value={row[col.key]} onChange={v=>onChange(rows.map((old,n)=>n===i?{...old,[col.key]:v}:old))}/>)}
   <button type="button" onClick={()=>onChange(rows.filter((_,n)=>n!==i))}>Remove row {i+1}</button></fieldset>)}
   <button disabled={rows.length>=(field.validation?.max_rows??100)} onClick={()=>onChange([...rows,{}])}>Add row</button></fieldset>;
 }
 if(field.type==='CHECKBOX')return <label className="cw-check"><input id={id} type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>{label}{field.required?' (required)':''}</label>;
 const text=String(value??'');
 return <label className="cw-field" htmlFor={id}>{label}{field.required?' (required)':''}
  {field.type==='MULTISELECT'?<select multiple id={id} value={Array.isArray(value)?value as string[]:[]} onChange={e=>onChange(Array.from(e.target.selectedOptions,o=>o.value))}>{field.choices?.map(o=><option key={o}>{o}</option>)}</select>:
  opts?<select id={id} value={text} onChange={e=>onChange(e.target.value)}><option value="">Select a response</option>{opts.map(o=><option key={o}>{o}</option>)}</select>:
  field.type==='LONG_TEXT'?<textarea id={id} value={text} onChange={e=>onChange(e.target.value)}/>:
  <input id={id} type={({NUMBER:'number',DATE:'date',DATETIME:'datetime-local'} as Record<string,string>)[field.type]??'text'} value={field.type==='DATETIME'&&text?toLocalDateTime(text):text}
   onChange={e=>onChange(field.type==='NUMBER'&&e.target.value!==''?Number(e.target.value):field.type==='DATETIME'&&e.target.value?new Date(e.target.value).toISOString():e.target.value)}/>}
 </label>;
}
function toLocalDateTime(value:string){const d=new Date(value);return Number.isNaN(d.getTime())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function ComplianceWork({actorId,api,memberships,screen,onJobs,onLogin,activeWorkspace,onWorkspace,onForm,initialJob}:Props){
 const [business,setBusiness]=useState('all'),[filter,setFilter]=useState('OPEN'),[jobs,setJobs]=useState<Job[]>([]),[selected,select]=useState<Pick<Job,'workspace_id'|'id'>|null>(initialJob??null);
 const [detail,setDetail]=useState<Detail|null>(null),[slot,setSlot]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[tick,reload]=useState(0);
 const [offline,setOffline]=useState(!navigator.onLine);
 useEffect(()=>{const update=()=>setOffline(!navigator.onLine);window.addEventListener('offline',update);window.addEventListener('online',update);return()=>{window.removeEventListener('offline',update);window.removeEventListener('online',update);};},[]);
 const activeJob=useRef(selected);
 activeJob.current=selected;
 useEffect(()=>{
  if(selected&&activeWorkspace&&selected.workspace_id!==activeWorkspace){select(null);setDetail(null);setSlot('');}
 },[activeWorkspace,selected]);
 const list=screen==='dashboard'||!selected;
 const scope=memberships.map(m=>m.workspace_id).join(',');
 useEffect(()=>{
  let live=true;setLoading(true);setError('');
  const work=Promise.all([
   Promise.all(scope.split(',').filter(w=>w&&(business==='all'||business===w)).map(w=>api.list(w))).then(p=>{if(live)setJobs(p.flat());}),
   !list&&selected?api.detail(selected.workspace_id,selected.id).then(d=>{if(live)setDetail(d);}):Promise.resolve()
  ]);
  work.catch(e=>{if(live)setError(describe(e));}).finally(()=>{if(live)setLoading(false);});
  return()=>{live=false;};
 },[api,scope,list,selected,business,tick]);
 const open=(j:Job)=>{onWorkspace?.(j.workspace_id);setDetail(null);select(j);setSlot('');onJobs();};
 const back=()=>{select(null);setSlot('');};
 const role=memberships.find(m=>m.workspace_id===selected?.workspace_id)?.role;
 const [creationWorkspace,setCreationWorkspace]=useState<string|null>(null);
 const workspace=activeWorkspace??memberships[0]?.workspace_id;
 const destination=workspace;
 const allowedDestination=(id:string|undefined|null)=>memberships.some(m=>m.workspace_id===id && m.role!=='technician');
 const [query,setQuery]=useState('');
 const hasStatus=(j:Job,status:string)=>status==='all'||jobStatuses(j).includes(status);
 const matches=jobs.filter(j=>hasStatus(j,filter)&&[j.title,j.customer_name,j.site_address,j.technician].some(value=>value?.toLowerCase().includes(query.trim().toLowerCase())));
 const register=(rows=matches)=><div className="cabms-card cw-panel">{rows.length===0?<p>No jobs match these filters.</p>:rows.map(j=><button className="cw-row" key={j.workspace_id+j.id} onClick={()=>open(j)}><span><Brand id={j.workspace_id}/><strong>{j.title}</strong><small>{j.technician||j.assignee_id||'Unassigned'}</small></span><span className="flex flex-wrap justify-end gap-1">{jobStatuses(j).map(status=><span key={status} className="cw-pill">{statusLabel[status as keyof typeof statusLabel]??status}</span>)}</span><span aria-hidden="true">›</span></button>)}</div>;
 return <section className="cw space-y-6" aria-label="Compliance operations">
 {offline&&<p role="status" className="cw-alert">Offline. Draft answers can be edited. Reconnect to save them to the job.</p>}
 {screen!=='dashboard'&&<nav aria-label="Job breadcrumb" className="cw-crumb"><span>Operations</span><span aria-hidden="true">/</span>
 <button onClick={back}>Jobs &amp; Operations</button>{!list&&<><span>/</span><button onClick={()=>setSlot('')}>Job detail</button></>}{!list&&slot&&<span>/ Form</span>}</nav>}
 {screen==='jobs'&&<WorkOrdersHeader operational onCreate={destination&&allowedDestination(destination)?()=>setCreationWorkspace(destination):undefined}/>}
 {creationWorkspace&&screen==='jobs'&&<CreateJob key={creationWorkspace} workspace={creationWorkspace}
  businessName={brands[creationWorkspace]??memberships.find(m=>m.workspace_id===creationWorkspace)?.name??creationWorkspace}
  canSubmit={allowedDestination(creationWorkspace)&&destination===creationWorkspace} api={api}
  close={()=>setCreationWorkspace(null)} created={()=>{setCreationWorkspace(null);reload(n=>n+1);}}/>}
 {screen==='compliance'&&<section className="cabms-card p-5 shadow-sm"><h1 className="text-xl font-bold">Mobile Technician Compliance Forms &amp; Documents</h1><label>Current Work Order <select value={selected?.id??''} onChange={e=>{const j=jobs.find(item=>item.id===e.target.value);if(j){if(j.workspace_id!==workspace)onWorkspace?.(j.workspace_id);setDetail(null);select(j);setSlot('');}else{setDetail(null);select(null);setSlot('');}}}><option value="">Select work order</option>{jobs.map(j=><option key={j.id} value={j.id}>[{brands[j.workspace_id]??j.workspace_id}] {j.title}</option>)}</select></label></section>}
 {screen==='dashboard'&&<><h1 className="cabms-sr-only">Operations dashboard</h1><div className="grid grid-cols-2 lg:grid-cols-5 gap-4">{Object.entries(statusLabel).map(([status,name])=><button className="cabms-card p-5 text-left" aria-pressed={filter===status} key={status} onClick={()=>setFilter(status)}><span>{name} jobs</span><strong className="block text-2xl font-black">{loading||error?'...':jobs.filter(j=>hasStatus(j,status)).length}</strong></button>)}</div><p className="cw-sub">Scheduled and in-progress jobs are included in Open. A job can be both.</p></>}
 {screen==='dashboard'&&<p className="cw-sub">Live MYOB, communications and enquiry metrics are unavailable.</p>}
 {screen!=='compliance'&&<div className="cw-toolbar"><label>Active business<select aria-label="Active business" title="Switch active business (updates header, theme, and new-job destination)" value={workspace??''} onChange={e=>{onWorkspace?.(e.target.value);}}>{memberships.map(m=><option key={m.workspace_id} value={m.workspace_id}>{brands[m.workspace_id]??m.name}</option>)}</select></label>
 <label>Filter jobs by business<select aria-label="Filter jobs by business" title="Filter displayed jobs by business" value={business} onChange={e=>{setBusiness(e.target.value);back();}}><option value="all">All authorized businesses</option>{memberships.map(m=><option key={m.workspace_id} value={m.workspace_id}>{brands[m.workspace_id]??m.name}</option>)}</select></label>
 <label>Status<select aria-label="Status" value={filter} onChange={e=>setFilter(e.target.value)}>{Object.entries(statusLabel).map(([v,label])=><option value={v} key={v}>{label}</option>)}<option value="all">All statuses</option></select></label></div>}
 {loading&&<p role="status">Loading jobs and compliance records…</p>}
 {error&&<div role="alert" className="cw-alert">{error} <button onClick={()=>reload(n=>n+1)}>Retry load</button></div>}
 {screen==='dashboard'&&!loading&&!error&&<><OperationalJobsPanel heading={(brands[(business==='all'?workspace:business)??'']??'Business')+' Operational Jobs'} description={business==='all'?'Current business':'Selected business filter'} onViewAll={()=>{back();onJobs();}} action="View Jobs & Operations">{register(matches.filter(j=>j.workspace_id===(business==='all'?workspace:business)))}</OperationalJobsPanel>
 {memberships.length>1&&business==='all'&&<section className="cabms-card p-6"><h2>Cross-company work orders</h2>{register()}</section>}</>}
 <div className={screen==='jobs'?'grid grid-cols-1 lg:grid-cols-12 gap-6':''}>
 {screen==='jobs'&&<aside className={(!list?'hidden lg:block ':'')+'lg:col-span-5 space-y-3'} aria-label="Job directory"><JobSearch searchQuery={query} setSearchQuery={setQuery}/>{!loading&&!error&&register()}</aside>}
 {screen==='jobs'&&list&&!loading&&!error&&<p className="lg:col-span-7 cabms-card p-6">Select a work order to view job details.</p>}
 {screen==='compliance'&&list&&!loading&&!error&&(jobs.length>0?<p className="cabms-card p-6 text-sm text-(--cabms-text-secondary)">Select a work order above to view its compliance forms and documents.</p>:<p className="cabms-card p-6 text-sm text-(--cabms-text-secondary)">No accessible work orders in this workspace.</p>)}
 <div className={screen==='jobs'&&!list?'lg:col-span-7 cabms-card p-6 space-y-6':''}>
 {!list&&detail&&!error&&<JobWork key={detail.job.id} {...{actorId,detail,slot,role,api,onLogin,offline,back}} setSlot={s=>{setSlot(s);if(s)onForm?.();else onJobs();}} refresh={async()=>{const d=await api.detail(detail.job.workspace_id,detail.job.id);if(activeJob.current?.id===d.job.id&&activeJob.current.workspace_id===d.job.workspace_id){setDetail(d);setJobs(items=>items.map(item=>item.workspace_id===d.job.workspace_id&&item.id===d.job.id?d.job:item));}}}/>}
 </div></div></section>;
}
type WorkProps={actorId:string;detail:Detail;slot:string;setSlot:(s:string)=>void;role?:string;api:JobsClient;onLogin:()=>Promise<void>;offline:boolean;back:()=>void;refresh:()=>Promise<void>};
function JobWork(p:WorkProps){
 const {detail,slot,setSlot,role,api,offline,refresh}=p,{job,requirements}=detail;
 const [busy,setBusy]=useState(false),[notice,message]=useState(''),[problem,setProblem]=useState<JobError|null>(null);
 const latch=useRef(false);
 const formName=(f:Requirement)=>{const occurrences=requirements.filter(other=>other.revision_id===f.revision_id);return occurrences.length>1?f.title+' ('+(occurrences.indexOf(f)+1)+' of '+occurrences.length+')':f.title;};
 const r=requirements.find(f=>f.occurrence_key===slot);
 const run=async(fn:()=>Promise<unknown>,success:string)=>{
  if(latch.current||offline)return false;
  latch.current=true;setBusy(true);message('');
  try{await fn();setProblem(null);try{await refresh();message(success);}catch{message(success+' Refresh the job to see its latest state.');}return true;}
  catch(e){
   message(describe(e));
   setProblem(previous=>previous?.reconcile&&!isConfirmedRejection(e)&&!(e instanceof JobError&&e.reconcile)?previous:e instanceof JobError?e:null);
   return false;
  }
  finally{latch.current=false;setBusy(false);}
 };
 const pick=(s:string)=>{setSlot(s);message('');setProblem(null);};
 const required=requirements.filter(f=>f.required),signed=required.filter(f=>f.signed_digest&&!f.needs_answer_review).length;
 const frozen=offline||busy||!!problem?.reconcile;
 return <><Brand id={job.workspace_id}/><h1 className="cw-work-title">{r?formName(r):job.title}</h1>
 {r?<ReturnToJob label="Back to job" onBack={()=>pick('')}/>:<dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 cabms-card-subtle p-3.5 rounded-lg border cabms-border text-xs my-3">
  <div><dt className="text-(--cabms-text-secondary) font-semibold">Customer</dt><dd className="text-(--cabms-text-primary) font-medium">{job.customer_name || 'Not specified'}</dd></div>
  <div><dt className="text-(--cabms-text-secondary) font-semibold">Service site</dt><dd className="text-(--cabms-text-primary) font-medium">{job.site_address || 'Not specified'}</dd></div>
  <div><dt className="text-(--cabms-text-secondary) font-semibold">Assigned technician</dt><dd className="text-(--cabms-text-primary) font-medium">{job.technician||job.assignee_id||'Unassigned technician'}</dd></div>
  <div><dt className="text-(--cabms-text-secondary) font-semibold">Status</dt><dd className="text-(--cabms-text-primary) font-medium">{jobStatuses(job).map(status=>statusLabel[status as keyof typeof statusLabel]??status).join(' · ')}</dd></div>
 </dl>}
 {notice&&<p className="cw-alert" role={problem?'alert':'status'}>{notice} {problem?.problem.request_id&&<small>Ref. {problem.problem.request_id}</small>}</p>}
 {problem?.reconcile&&<button onClick={()=>void run(problem.reconcile!,'Operation confirmed.')}>Recover operation</button>}
 {problem?.status===412&&<button onClick={()=>void run(refresh,'Latest version loaded. Review before saving.')}>Reload saved version</button>}
 {problem?.problem.blockers?.length? <section className="cw-blockers" aria-label="Completion blockers"><h2>What needs attention</h2><ul>{problem.problem.blockers.map((b,i)=><li key={i}>{blockerLabel[b.code]??b.code.replaceAll('_',' ')}{b.field?' '+(requirements.find(f=>f.occurrence_key===b.occurrence_key)?.fields.find(f=>f.key===b.field)?.label??b.field):''}{b.occurrence_key&&requirements.some(f=>f.occurrence_key===b.occurrence_key)&&<button onClick={()=>{pick(b.occurrence_key!);if(b.field)requestAnimationFrame(()=>document.getElementById('cw-field-'+b.field)?.focus());}}>Open {formName(requirements.find(f=>f.occurrence_key===b.occurrence_key)!)}</button>}</li>)}</ul>
 {problem.problem.blockers.some(b=>b.code==='RECENT_SIGN_IN_REQUIRED')&&<button onClick={()=>void run(p.onLogin,'Signed in. Review the form and confirm again.')}>Sign in again</button>}</section>:null}
 {r?<FormWork key={r.occurrence_key+'-'+r.answer_version} actorId={p.actorId} {...{r,job,api,run,offline}} disabled={busy||!!problem?.reconcile||job.status!=='OPEN'}/>:<>
 <section className="cabms-card cw-panel"><div className="cw-heading"><h2>Required compliance forms</h2><span>{signed} of {required.length} signed</span></div><progress aria-label="Required forms signed" value={signed} max={required.length||1}/>
 {!requirements.length&&<p>No forms assigned. Completion checks the pinned policy.</p>}
 {requirements.map(f=><button key={f.occurrence_key} className="cw-row" onClick={()=>pick(f.occurrence_key)}><span><strong>{formName(f)}</strong><small>{f.origin==='ADDITIONAL'?'Additional':'Inherited'} · {f.required?'Required':'Optional'}</small></span><span className="cw-pill">{f.needs_answer_review?'Review required':f.signed_digest?'Signed':f.withdrawal_reason?'Withdrawal requested':f.answer_version?'In progress':'Not started'}</span><span>›</span></button>)}</section>
 {job.status==='OPEN'&&role&&role!=='technician'&&<JobManagement job={job} api={api} disabled={frozen} run={run}/>}
 <details className="cabms-card cw-panel"><summary className="cursor-pointer font-semibold">Activity history</summary><ol className="mt-3 space-y-2 border-l-2 cabms-border pl-3 text-xs">{detail.history?.map((event,i)=><li key={i} className="space-y-0.5"><div className="font-semibold text-(--cabms-text-primary)"><span className="capitalize">{event.action.toLowerCase().replaceAll('_',' ')}</span> &middot; {event.actor}</div><div className="text-(--cabms-text-secondary)"><time dateTime={event.occurred_at}>{new Date(event.occurred_at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})} AEST</time></div></li>)}</ol></details>
 {!!detail.visit_history?.length&&<details className="cabms-card cw-panel"><summary className="cursor-pointer font-semibold">Visit history</summary><ol className="mt-3 space-y-2 border-l-2 cabms-border pl-3 text-xs">{detail.visit_history.map(event=>
  <li key={event.visit_id+'-'+event.version} className="space-y-0.5"><div className="font-semibold text-(--cabms-text-primary)">{event.status==='CANCELLED'?'Visit cancelled':event.version===1?'Visit scheduled':'Visit rescheduled'}</div><div className="text-(--cabms-text-secondary)">{event.technician} &middot; <time dateTime={event.starts_at}>{new Date(event.starts_at).toLocaleString('en-AU',{timeZone:'Australia/Brisbane'})} AEST</time> &middot; {event.duration_minutes} min &middot; {event.actor}{event.reason&&' · Reason: '+event.reason}</div></li>
 )}</ol></details>}
 <section className="cabms-card cw-panel"><h2>Completion status</h2>
  {job.status==='COMPLETED'
   ?<p className="font-semibold text-(--cabms-text-primary)"><span className="cabms-badge-completed px-2 py-0.5 rounded text-xs mr-2">Completed</span>This job is closed.</p>
   :job.status==='CANCELLED'
    ?<p className="font-semibold text-(--cabms-text-primary)"><span className="cabms-badge-danger px-2 py-0.5 rounded text-xs mr-2">Cancelled</span>This job was cancelled.</p>
    :<>
     <p>{role==='technician'?'Office staff or an administrator completes the job after review.':'Complete the job once all required occurrences are signed and findings resolved.'}</p>
     <button className="cw-primary" disabled={frozen||role==='technician'} onClick={()=>void run(()=>api.complete(job,generateUuid()),'Job completed.')}>Complete job</button>
    </>}
 </section>
 <button className="cw-back" onClick={p.back}>← Back to jobs</button></>}
 {r&&<Findings key={r.occurrence_key} {...{job,r,api,run,role}} disabled={frozen||job.status!=='OPEN'}/>}
 {r&&job.status==='OPEN'&&r.origin==='ADDITIONAL'&&role&&role!=='technician'&&
  <Withdrawal key={r.occurrence_key+'-'+Boolean(r.withdrawal_reason)} {...{job,r,api,run,role}} disabled={frozen} withdrawn={()=>setSlot('')}/>}
 </>;
}
function Findings({job,r,api,run,role,disabled}:{
 job:Job;r:Requirement;api:JobsClient;run:(op:()=>Promise<unknown>,success:string)=>Promise<boolean>;role?:string;disabled:boolean;
}){
 const [reason,setReason]=useState('');
 const [target,setTarget]=useState('');
 const mayResolve=role==='owner_admin'||role==='super_admin';
 const findings=r.findings??[];
 return <section className="cabms-card cw-panel"><h2>Compliance findings</h2>
  {findings.length===0&&<p>No findings recorded.</p>}
  {findings.map(f=><div key={f.id}><p>{f.reason}</p><p>{f.resolution?'Resolved · '+f.resolution:'Open'}</p>
   {mayResolve&&!f.resolution&&job.status==='OPEN'&&<button type="button" disabled={disabled} onClick={()=>{setReason('');setTarget(f.id);}}>Record resolution</button>}
  </div>)}
  {job.status==='OPEN'&&<form onSubmit={async e=>{e.preventDefault();if(!reason.trim())return;
   if(await run(()=>api.finding(job,r,reason.trim(),generateUuid(),target||undefined),target?'Resolution recorded.':'Finding recorded.')){
    setReason('');setTarget('');
   }
  }}>
   <label className="cw-field">{target?'Resolution for '+findings.find(f=>f.id===target)?.reason:'New finding'}
    <textarea value={reason} required maxLength={2000} disabled={disabled} onChange={e=>setReason(e.target.value)}/>
   </label>
   <button disabled={disabled||!reason.trim()} type="submit">{target?'Save resolution':'Record finding'}</button>
   {target&&<button type="button" onClick={()=>{setReason('');setTarget('');}}>Cancel resolution</button>}
  </form>}
 </section>;
}
function Withdrawal({job,r,api,run,role,disabled,withdrawn}:{
 job:Job;r:Requirement;api:JobsClient;run:(op:()=>Promise<unknown>,success:string)=>Promise<boolean>;role:string;disabled:boolean;withdrawn:()=>void;
}){
 const [reason,setReason]=useState('');
 const pending=Boolean(r.withdrawal_reason);
 const signed=Boolean(r.has_signed_history||r.signed_digest);
 const openFindings=r.findings?.some(f=>!f.resolution);
 return <section className="cabms-card cw-panel"><h2>Form withdrawal</h2>
  {pending&&<p>Request: {r.withdrawal_reason}</p>}
  {signed?<p>Signed history is retained. Withdrawal is unavailable for this occurrence.</p>:
   pending&&role==='office_staff'?<p>Awaiting administrator decision.</p>:
   pending&&openFindings?<p>Resolve the open findings before approving this withdrawal.</p>:
   <form onSubmit={async e=>{e.preventDefault();if(!reason.trim())return;
    const saved=await run(()=>api.withdraw(job,r,pending,reason.trim(),generateUuid()),pending?'Form withdrawn.':'Withdrawal requested.');
    if(saved&&pending)withdrawn();
   }}>
    <label className="cw-field">{pending?'Approval reason':'Withdrawal reason'}
     <textarea value={reason} onChange={e=>setReason(e.target.value)} required maxLength={2000} disabled={disabled}/>
    </label>
    <button type="submit" disabled={disabled||!reason.trim()}>{pending?'Approve withdrawal':'Request withdrawal'}</button>
   </form>}
 </section>;
}
function FormWork({actorId,r,job,api,run,offline,disabled}:{
 actorId:string;r:Requirement;job:Job;api:JobsClient;run:(op:()=>Promise<unknown>,success:string)=>Promise<boolean>;offline:boolean;disabled:boolean;
}){
 const draftKey='cabms-form-draft:'+JSON.stringify([actorId,job.workspace_id,job.id,r.occurrence_key,r.answer_version]);
 const [draft,setDraft]=useState<Record<string,unknown>>(()=>{
  try{
   const stored=JSON.parse(sessionStorage.getItem(draftKey)??'null');
   if(stored&&typeof stored==='object'&&!Array.isArray(stored))return applicableFormAnswers(r.fields,stored).answers;
  }catch{/* Storage can be disabled in the browser. */}
  return r.answers;
 });
 const [confirmed,confirm]=useState(false),[editing,edit]=useState(!r.signed_digest||JSON.stringify(draft)!==JSON.stringify(r.answers));
 const [draftStorageError,setDraftStorageError]=useState(false);
 const [links,setLinks]=useState<Record<string,string[]>>({}),[uploading,upload]=useState(false);
 const editableAnswers=(source:Record<string,unknown>)=>Object.fromEntries(
  Object.entries(source).filter(([k])=>!r.fields.some(f=>f.key===k&&f.type==='READONLY_AUTOFILL'))
 );
 const dirty=JSON.stringify(editableAnswers(draft))!==JSON.stringify(editableAnswers(r.answers)),locked=disabled||!editing;
 useEffect(()=>{
  try{if(dirty)sessionStorage.setItem(draftKey,JSON.stringify(draft));else sessionStorage.removeItem(draftKey);setDraftStorageError(false);}
  catch{setDraftStorageError(true);}
 },[dirty,draft,draftKey]);
 const visible=applicableFormAnswers(r.fields,draft).applicable;
 const photoFields=visible.filter(f=>['PHOTO','FILE'].includes(f.type));
 const chosen=(f:string)=>links[f]??(photoFields.length===1?r.photos.map(photo=>photo.id):[]);
 return <><p className="cw-sub">{dirty?'Unsaved changes':r.signed_digest?'Signed':r.answer_version?'Saved version '+r.answer_version:'New form'}</p>
 <section className="cabms-card cw-panel"><h2>Form answers</h2><fieldset disabled={locked}><div className="cw-form-grid">{visible.filter(f=>!['PHOTO','FILE','SIGNATURE'].includes(f.type)).map(f=><div key={f.key} className={['LONG_TEXT','REPEATABLE_TABLE'].includes(f.type)?'cw-field-full':''}><Control field={f} value={draft[f.key]} onChange={v=>{setDraft(old=>applicableFormAnswers(r.fields,{...old,[f.key]:v}).answers);confirm(false);}}/></div>)}</div></fieldset>
 {r.needs_answer_review&&<p role="status">This saved version contains answers for fields that no longer apply. Review and save a new version before signing.</p>}
 {draftStorageError&&<p role="status">Local draft storage is unavailable. Keep this form open until you can save it.</p>}
 {!editing&&r.signed_digest?<button disabled={disabled} onClick={()=>edit(true)}>Start a correction</button>:<button disabled={locked||offline||(!dirty&&!!r.answer_version&&!r.needs_answer_review)} onClick={()=>void run(async()=>{await api.save(job,r,editableAnswers(draft),generateUuid());
  try{sessionStorage.removeItem(draftKey);}catch{/* The answer version still protects against stale drafts. */}
 },'Answers saved.')}>Save answers</button>}</section>
 <section className="cabms-card cw-panel"><div className="cw-heading"><h2>Photo evidence</h2><span>{job.photo_count} / 20</span></div>
 <p>{!job.photo_cap?'Uploads unavailable until this business has a validated file-size limit.':!r.answer_version||dirty?'Save the current answers before adding photos.':r.signed_digest?'Signed evidence is retained with this version.':'Photos are resized toward 500 KiB and verified before signing.'}</p>
 {r.photos.map((photo,i)=><PhotoPreview key={photo.id} api={api} job={job} requirement={r} photo={photo} index={i+1} offline={offline}/>)}
 <label className="cw-field">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked||offline||uploading||dirty||!r.answer_version||!!r.signed_digest||!job.photo_cap||job.photo_count>=20}
 onChange={async e=>{const f=e.target.files?.[0];e.target.value='';if(!f)return;upload(true);await run(async()=>api.upload(job,r,await resizePhoto(f,job.photo_cap!)),'Photo verified.');upload(false);}}/></label>
 {uploading&&<p role="status">Uploading and verifying photo…</p>}
 {photoFields.map(f=><fieldset key={f.key} disabled={locked||!!r.signed_digest}><legend>{f.label}{f.required?' (required)':''}</legend>{r.photos.map((photo,i)=><label className="cw-check" key={photo.id}><input type="checkbox" checked={chosen(f.key).includes(photo.id)} onChange={e=>{setLinks({...links,[f.key]:e.target.checked?[...chosen(f.key),photo.id]:chosen(f.key).filter(id=>id!==photo.id)});confirm(false);}}/>Photo {i+1}</label>)}</fieldset>)}</section>
 <section className="cabms-card cw-panel"><h2>Sign form</h2>{r.signed_digest?<p>{r.needs_answer_review?'Earlier signature retained. Save a corrected answer version to sign again.':'Signed snapshot recorded.'}</p>:<>
 <label className="cw-check"><input type="checkbox" checked={confirmed} disabled={locked||!r.may_sign||dirty||!r.answer_version||r.needs_answer_review} onChange={e=>confirm(e.target.checked)}/>{signIntent}</label>
 {!r.may_sign&&<p>You need signing authorization for this form revision.</p>}
 <button className="cw-primary" disabled={locked||offline||!r.may_sign||!confirmed||dirty||!r.answer_version||r.needs_answer_review} onClick={()=>void run(()=>api.sign(job,r,Object.fromEntries(photoFields.filter(f=>chosen(f.key).length).map(f=>[f.key,chosen(f.key)])),generateUuid()),'Form signed.')}>Sign current version</button></>}</section></>;
}
function PhotoPreview({api,job,requirement,photo,index,offline}:{
 api:JobsClient;job:Job;requirement:Requirement;photo:Requirement['photos'][number];index:number;offline:boolean;
}){
 const [open,setOpen]=useState(false);
 const [preview,setPreview]=useState(''),[error,setError]=useState('');
 const {id}=photo,{occurrence_key}=requirement,{id:jobId,workspace_id}=job;
 useEffect(()=>{
  if(!open)return;
  const abort=new AbortController();
  let url='';
  setError('');setPreview('');
  api.photo(workspace_id,jobId,occurrence_key,id,abort.signal).then(blob=>{
   if(abort.signal.aborted)return;
   url=URL.createObjectURL(blob);setPreview(url);
  }).catch(e=>{if(!abort.signal.aborted)setError(describe(e));});
  return()=>{abort.abort();if(url)URL.revokeObjectURL(url);};
 },[api,open,workspace_id,jobId,occurrence_key,id]);
 return <div><p>Verified photo {index} · {Math.ceil(photo.bytes/1024)} KiB</p>
  <button type="button" disabled={offline&&!open} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide':'Preview'} photo {index}</button>
  {open&&(error?<p role="alert">{error}</p>:preview?<img src={preview} alt={'Verified job evidence photo '+index} className="max-h-64 max-w-full"/>:<p role="status">Loading photo…</p>)}
 </div>;
}

function CreateJob({workspace,businessName,canSubmit,api,close,created}:{workspace:string;businessName:string;canSubmit:boolean;api:JobsClient;close:()=>void;created:()=>void}){
 const [types,setTypes]=useState<Awaited<ReturnType<JobsClient['publishedTypes']>>|null>(null);
 const [techs,setTechs]=useState<{id:string;display_name:string}[]>([]),[assignee,setAssignee]=useState('');
 const [type,setType]=useState(''),[title,setTitle]=useState(''),[error,setError]=useState('');
 const [customerName,setCustomerName]=useState(''),[siteAddress,setSiteAddress]=useState('');
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const pending=useRef(false),key=useRef<string|null>(null);
 const request=useRef<Parameters<JobsClient['create']>|null>(null);
 useEffect(()=>{let live=true;Promise.all([api.publishedTypes(workspace),api.technicians(workspace)]).then(([rows,staff])=>{if(live){setTechs(staff);setTypes(rows);setType(rows.find(row=>!row.missing_mandatory_forms.length)?.id??'');}}).catch(e=>{if(live)setError(describe(e));});return()=>{live=false;};},[api,workspace]);
 const selected=types?.find(t=>t.id===type);
 const ready=!!selected&&!selected.missing_mandatory_forms.length;
 const editable=canSubmit&&ready&&!busy&&!uncertain;
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const node=dialog.current;node?.showModal();return ()=>node?.close();},[]);
 return <dialog ref={dialog} aria-labelledby="create-work-order-title" onCancel={e=>{e.preventDefault();if(!busy&&!uncertain)close();}}
  className="cabms-card m-auto max-w-lg w-[min(32rem,90vw)] p-6 shadow-2xl max-h-[90vh] overflow-y-auto backdrop:bg-black/60">
 <form className="space-y-3 text-xs" onSubmit={async e=>{
  e.preventDefault();
  if(pending.current)return;
  if(!request.current){
   if(!canSubmit||!ready||!selected||!title.trim()||!customerName.trim()||!siteAddress.trim())return;
   if(!key.current){try{key.current=generateUuid();}catch(err){setError(describe(err));return;}}
   request.current=[workspace,title.trim(),type,selected.current_policy_version_id,key.current,assignee||null,customerName.trim(),siteAddress.trim()];
  }
  pending.current=true;setBusy(true);setError('');
  try{await api.create(...request.current);created();}
  catch(e){
   const unknown=uncertain?!isConfirmedRejection(e):!(e instanceof JobError)||e.status>=500;
   if(!unknown)request.current=null;
   setUncertain(unknown);setError(unknown?'Creation outcome unknown. Retry the same request to recover the result.':describe(e));
  }
  finally{pending.current=false;setBusy(false);}
 }}>
 <h2 id="create-work-order-title">Create New Work Order</h2><p>Destination business: <strong>{businessName}</strong></p>
 {!canSubmit&&<p role="alert">The business context changed. Close and reopen this dialog to create in the selected business.</p>}
 <label className="cw-field">Published job type<select value={type} disabled={!canSubmit||busy||uncertain||!types} onChange={e=>setType(e.target.value)}>
  <option value="">Choose a job type</option>{types?.map(t=><option key={t.id} value={t.id} disabled={!!t.missing_mandatory_forms.length}>{t.name}{t.missing_mandatory_forms.length?' — unavailable':''}</option>)}</select></label>
 {!!types?.some(t=>t.missing_mandatory_forms.length)&&<ul aria-label="Unavailable job types">{types.filter(t=>t.missing_mandatory_forms.length).map(t=><li key={t.id}>{t.name} needs form mappings for {t.missing_mandatory_forms.join(', ')}.</li>)}</ul>}
 <label className="cw-field">Job title<input required maxLength={500} value={title} disabled={!editable} onChange={e=>setTitle(e.target.value)}/></label>
 <label className="cw-field">Customer name<input required maxLength={200} value={customerName} disabled={!editable} onChange={e=>setCustomerName(e.target.value)}/></label>
 <label className="cw-field">Service site address<input required maxLength={500} value={siteAddress} disabled={!editable} onChange={e=>setSiteAddress(e.target.value)}/></label>
 <label className="cw-field">Assigned technician<select value={assignee} disabled={!editable} onChange={e=>setAssignee(e.target.value)}><option value="">Unassigned</option>{techs.map(t=><option key={t.id} value={t.id}>{t.display_name}</option>)}</select></label>
 {error&&<p role="alert">{error}</p>}
 {!error&&!types&&<p role="status">Loading published job types...</p>}
 {types?.length===0&&<p>No published job policy is available for this business.</p>}
 <button type="submit" disabled={busy||(!uncertain&&(!canSubmit||!ready||!title.trim()||!customerName.trim()||!siteAddress.trim()))}>{uncertain?'Recover creation':'Create job'}</button>
 <button type="button" disabled={busy||uncertain} onClick={close}>Cancel</button></form></dialog>;
}

function JobManagement({job,api,disabled,run}:{job:Job;api:JobsClient;disabled:boolean;run:(fn:()=>Promise<unknown>,message:string)=>Promise<boolean>}){
 const [expanded,expand]=useState(false),[error,setError]=useState('');
 const [staff,setStaff]=useState<Awaited<ReturnType<JobsClient['technicians']>>>([]);
 const [forms,setForms]=useState<Awaited<ReturnType<JobsClient['formOptions']>>>([]);
 const [ready,setReady]=useState(false),[assignee,assign]=useState(job.assignee_id??'');
 const [revision,setRevision]=useState(''),[reason,setReason]=useState(''),[required,setRequired]=useState(true),[confirm,setConfirm]=useState(false);
 useEffect(()=>{
  if(!expanded)return;
  let live=true;setReady(false);setError('');
  Promise.all([api.technicians(job.workspace_id),api.formOptions(job)]).then(([people,options])=>{
   if(live){setStaff(people);setForms(options);setRevision(options[0]?.id??'');setReady(true);}
  }).catch(e=>{if(live)setError(describe(e));});
  return ()=>{live=false;};
 },[api,expanded,job.workspace_id,job.id]);
 return <section className="cabms-card cw-panel"><button aria-expanded={expanded} onClick={()=>expand(!expanded)}>Manage job</button>
 {expanded&&<fieldset disabled={disabled}><legend>Job actions</legend>
 {error&&<p role="alert">{error}</p>}{!ready&&!error&&<p role="status">Loading available staff and forms...</p>}
 <label className="cw-field">Assigned technician<select value={assignee} onChange={e=>assign(e.target.value)}><option value="">Unassigned</option>{staff.map(t=><option key={t.id} value={t.id}>{t.display_name}</option>)}</select></label>
 <button disabled={!ready||assignee===(job.assignee_id??'')} onClick={()=>void run(()=>api.updateJob(job,'ASSIGN',{assignee_id:assignee||null},generateUuid()),'Assignment saved.')}>Save assignment</button>
 <label className="cw-field">Additional form<select value={revision} onChange={e=>setRevision(e.target.value)}>{forms.map(f=><option key={f.id} value={f.id}>{f.title} ({f.version})</option>)}</select></label>
 <label className="cw-field">Reason for addition<input maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <label className="cw-check"><input type="checkbox" checked={required} onChange={e=>setRequired(e.target.checked)}/>Required for completion</label>
 <button disabled={!ready||!revision||!reason.trim()} onClick={async()=>{if(await run(()=>api.updateJob(job,'ADD',{revision_id:revision,occurrence_key:generateUuid(),reason:reason.trim(),required},generateUuid()),'Form added.'))setReason('');}}>Add form occurrence</button>
 {confirm?<><p>Cancel this whole job? Its forms and evidence stay in the job history.</p><button onClick={()=>void run(()=>api.updateJob(job,'CANCEL',{},generateUuid()),'Job cancelled.')}>Confirm job cancellation</button><button onClick={()=>setConfirm(false)}>Keep job open</button></>:<button onClick={()=>setConfirm(true)}>Cancel whole job</button>}
 </fieldset>}</section>;
}
