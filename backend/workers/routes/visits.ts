import type {Env} from '../../types.ts';
import {authorizeWorkspaceAccess,type AuthenticationService} from '../auth.ts';
import {currentMembership} from './complianceJobs.ts';
import {complianceProblem} from '../../modules/compliance/problems.ts';

type Visit={visit_id:string;job_id:string;technician_id:string;starts_at:string;duration_minutes:number;status:'SCHEDULED'|'CANCELLED';reason:string;version:number};
const current=`v.version=(SELECT max(h.version) FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id)`;

export async function handleVisits(request:Request,env:Env,workspace:string,requestId:string,authentication:AuthenticationService){
 const problem=(code:Parameters<typeof complianceProblem>[0])=>complianceProblem(code,requestId);
 const reply=(data:unknown)=>Response.json(data,{headers:{'X-Request-Id':requestId,'Cache-Control':'no-store'}});
 const auth=await authentication.authenticateRequest(env.DB,request,env);
 if(!auth)return problem('AUTHENTICATION_REQUIRED');
 const member=await authorizeWorkspaceAccess(env.DB,workspace,auth);
 if(!member)return problem('ACTION_DENIED');
 const who=[workspace,auth.userId,auth.providerSubjectId,member.role];
 if(!await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_visit_events_no_update'").first())return problem('OPERATIONAL_STORAGE_NOT_READY');
 const key=request.headers.get('Idempotency-Key');
 const receipt=()=>env.DB.prepare(`SELECT visit_id,job_id,technician_id,starts_at,duration_minutes,status,reason,version FROM compliance_visit_events WHERE workspace_id=? AND actor_id=? AND operation_key=? AND ${currentMembership}`).bind(workspace,auth.userId,key,...who).first<Visit>();
 if(request.method==='GET'){
  if(key){if(member.role==='technician')return problem('ACTION_DENIED');const row=await receipt();return row?reply(row):problem('RESOURCE_NOT_FOUND');}
  const rows=await env.DB.prepare(`SELECT v.visit_id,v.job_id,v.starts_at,v.duration_minutes,
   CASE WHEN v.status='SCHEDULED' AND j.status IN ('CANCELLED','COMPLETED') THEN 'CANCELLED' ELSE v.status END AS status,
   v.version,v.technician_id,v.reason,j.title,j.status AS job_status,u.display_name AS technician
   FROM compliance_visit_events v JOIN compliance_jobs j ON j.workspace_id=v.workspace_id AND j.id=v.job_id JOIN users u ON u.id=v.technician_id
   WHERE v.workspace_id=? AND ${current} AND (?<>'technician' OR (v.technician_id=? AND j.assignee_id=?)) AND ${currentMembership}
   ORDER BY v.starts_at,v.visit_id`).bind(workspace,member.role,auth.userId,auth.userId,...who).all();
  return reply(rows.results);
 }
 if(request.method!=='POST')return new Response(null,{status:405});
 if(member.role==='technician')return problem('ACTION_DENIED');
 const body=await request.json().catch(()=>null) as Visit|null;
 if(!key||key.length>128||!body||typeof body!=='object'||!Number.isSafeInteger(body.version)||body.version<1||
  ![body.visit_id,body.job_id,body.technician_id].every(s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(s))||
  typeof body.starts_at!=='string'||!Number.isFinite(Date.parse(body.starts_at))||new Date(body.starts_at).toISOString()!==body.starts_at||
  !Number.isInteger(body.duration_minutes)||body.duration_minutes<1||body.duration_minutes>1440||
  !['SCHEDULED','CANCELLED'].includes(body.status)||typeof body.reason!=='string'||body.reason.length>1000||
  (body.status==='CANCELLED'&&(!body.reason.trim()||body.version===1)))return problem('INVALID_FIELD');
 const reconcile=async()=>{const row=await receipt();if(!row)return null;return Object.keys(row).every(k=>row[k as keyof Visit]===body[k as keyof Visit])?reply(row):problem('IDEMPOTENCY_KEY_REUSED');};
 try{
  const saved=await reconcile();if(saved)return saved;
  const result=await env.DB.prepare(`INSERT INTO compliance_visit_events(workspace_id,visit_id,version,job_id,technician_id,starts_at,duration_minutes,status,reason,actor_id,operation_key)
   SELECT ?,?,?,?,?,?,?,?,?,?,? FROM compliance_jobs j WHERE j.workspace_id=? AND j.id=? AND (?='CANCELLED' OR j.status='OPEN') AND ${currentMembership}
   AND (?='CANCELLED' OR EXISTS(SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id
      WHERE m.workspace_id=j.workspace_id AND m.user_id=j.assignee_id AND m.user_id=? AND m.role='technician' AND u.disabled=0))
   AND ?=1+coalesce((SELECT max(version) FROM compliance_visit_events WHERE workspace_id=j.workspace_id AND visit_id=?),0)
   AND (?=1 OR EXISTS(SELECT 1 FROM compliance_visit_events v WHERE v.workspace_id=j.workspace_id AND v.job_id=j.id AND v.visit_id=? AND v.version=? AND v.status='SCHEDULED'
      AND (?<>'CANCELLED' OR (v.starts_at=? AND v.technician_id=? AND v.duration_minutes=?))))`).bind(workspace,body.visit_id,body.version,body.job_id,body.technician_id,body.starts_at,body.duration_minutes,body.status,body.reason,auth.userId,key,
     workspace,body.job_id,body.status,...who,body.status,body.technician_id,body.version,body.visit_id,body.version,body.visit_id,body.version-1,body.status,body.starts_at,body.technician_id,body.duration_minutes).run();
  const savedAfterWrite=await reconcile();
  if(savedAfterWrite)return savedAfterWrite;
  if(result.meta.changes)return problem('OPERATION_UNCONFIRMED');
  if(body.status==='SCHEDULED' && await env.DB.prepare(`SELECT 1 FROM compliance_jobs j
    WHERE j.workspace_id=? AND j.id=? AND j.status='OPEN' AND j.assignee_id IS NOT ? AND ${currentMembership}`)
    .bind(workspace,body.job_id,body.technician_id,...who).first())return problem('VISIT_ASSIGNEE_MISMATCH');
  return problem('VERSION_CONFLICT');
 }catch{return await reconcile().catch(()=>null)??problem('OPERATION_UNCONFIRMED');}
}
