import type {Env} from '../../types.ts';
import {authorizeWorkspaceAccess,type AuthenticationService} from '../auth.ts';
import {complianceProblem,complianceStorageProblem,type ComplianceProblemCode} from '../../modules/compliance/problems.ts';
import {currentMembership,fingerprint} from './complianceJobs.ts';

export async function handleFormOperation(request:Request,env:Env,authentication:AuthenticationService,requestId:string,route:RegExpExecArray) {
  const [,workspace,job,encoded,endpoint]=route;
  const slot=decodeURIComponent(encoded);
  const fail=(code:ComplianceProblemCode)=>complianceProblem(code,requestId);
  const auth=await authentication.authenticateRequest(env.DB,request,env);
  if(!auth)return fail('AUTHENTICATION_REQUIRED');
  const member=await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if(!member)return fail('ACTION_DENIED');
  const readAnswer=endpoint==='answer-receipt',decision=endpoint==='withdrawal-decision';
  const finding=endpoint==='finding',resolution=endpoint==='finding-resolution';
  if((!readAnswer&&!finding&&member.role==='technician')||
    ((decision||resolution)&&!['owner_admin','super_admin'].includes(member.role)))return fail('ACTION_DENIED');
  const scope=[workspace,job,slot],who=[workspace,auth.userId,auth.providerSubjectId,member.role];
  const access=`FROM compliance_jobs j JOIN compliance_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id
    WHERE j.workspace_id=? AND j.id=? AND q.occurrence_key=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}`;
  const args=[...scope,member.role,auth.userId,...who];
  const state=await env.DB.prepare(`SELECT j.status,j.version ${access}`).bind(...args).first<{version:number;status:string}>();
  if(!state)return fail('RESOURCE_NOT_FOUND');
  const key=request.headers.get('Idempotency-Key');
  if(!key || !/^[\w-]{1,128}$/.test(key))return fail('INVALID_FIELD');
  const action=readAnswer?'SAVE':finding||resolution?'FINDING':decision?'WITHDRAW':'REQUEST_WITHDRAW';
  const operation=await fingerprint(readAnswer?[workspace,auth.userId,action,key]:
    [workspace,job,slot,auth.userId,finding||resolution?endpoint:action,key]);
  const table=readAnswer?'compliance_answers':finding?'compliance_findings':resolution?'compliance_resolutions':
    decision?'compliance_decisions':'compliance_withdraw_requests';
  const findingJoin=resolution?'JOIN compliance_findings f ON f.id=m.finding_id':'';
  const alias=resolution?'f':'m';
  const reconcile=async(expected?:string)=>{
    const row=await env.DB.prepare(`SELECT o.fingerprint,${readAnswer?'m.version':'NULL'} AS answer_version FROM compliance_audit o
      JOIN ${table} m ON m.operation_id=o.id ${findingJoin}
      WHERE o.id=? AND o.actor_id=? AND o.action=? AND ${alias}.workspace_id=? AND ${alias}.job_id=? AND ${alias}.occurrence_key=?
      AND EXISTS(SELECT 1 ${access})`).bind(operation,auth.userId,action,...scope,...args).first<{fingerprint:string;answer_version:number|null}>();
    if(!row)return null;
    if(expected && row.fingerprint!==expected)return fail('IDEMPOTENCY_KEY_REUSED');
    return Response.json({operation_id:operation,...(readAnswer?{answer_version:row.answer_version}:{occurrence_key:slot,action})},{headers:{'X-Request-Id':requestId}});
  };
  if(request.method==='GET')return await reconcile()??fail('RESOURCE_NOT_FOUND');
  if(readAnswer || request.method!=='POST')return new Response(null,{status:405});
  const body=await request.json().catch(()=>null) as {reason?:unknown;expected_job_version?:unknown;finding_id?:unknown}|null;
  if(!body || Object.keys(body).some(k=>k!=='reason' && k!=='expected_job_version' && !(resolution&&k==='finding_id')) || typeof body.reason!=='string' ||
    (resolution&&(typeof body.finding_id!=='string'||!/^[-\w]{1,128}$/.test(body.finding_id)))||
    !body.reason.trim() || body.reason.length>2000 || !Number.isSafeInteger(body.expected_job_version))return fail('INVALID_FIELD');
  const reason=body.reason.trim();
  const digest=await fingerprint([body.expected_job_version,reason,...(resolution?[body.finding_id]:[])]);
  try{
    const prior=await reconcile(digest);
    if(prior)return prior;
    if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
    if(state.version!==body.expected_job_version)return fail('VERSION_CONFLICT');
    if(resolution&&!await env.DB.prepare(`SELECT 1 FROM compliance_findings WHERE id=? AND workspace_id=? AND job_id=? AND occurrence_key=?
      AND EXISTS(SELECT 1 ${access})`).bind(body.finding_id,...scope,...args).first())return fail('RESOURCE_NOT_FOUND');
    const requester=decision?await env.DB.prepare(`SELECT a.actor_id FROM compliance_withdraw_requests r JOIN compliance_audit a ON a.id=r.operation_id
      WHERE r.workspace_id=? AND r.job_id=? AND r.occurrence_key=?`).bind(...scope).first<string>('actor_id'):auth.userId;
    if(!requester)return fail('EXCEPTION_DENIED');
    const mutation=finding
      ?env.DB.prepare('INSERT INTO compliance_findings(id,workspace_id,job_id,occurrence_key,reason,operation_id) VALUES(?,?,?,?,?,?)')
        .bind(operation,...scope,reason,operation)
      :resolution?env.DB.prepare('INSERT INTO compliance_resolutions(finding_id,reason,operation_id) VALUES(?,?,?)').bind(body.finding_id,reason,operation)
      :decision
      ?env.DB.prepare("INSERT INTO compliance_decisions VALUES(?,?,?,'WITHDRAW',?,?,?,?)").bind(...scope,reason,requester,Number(requester===auth.userId),operation)
      :env.DB.prepare('INSERT INTO compliance_withdraw_requests VALUES(?,?,?,?,?)').bind(...scope,reason,operation);
    try{
      await env.DB.batch([env.DB.prepare(`INSERT INTO compliance_operations SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 ${access} AND j.status='OPEN' AND j.version=?)`)
        .bind(operation,workspace,auth.userId,action,job,state.version,digest,...args,state.version),mutation]);
    }catch(error){
      return await reconcile(digest)??fail(complianceStorageProblem(error));
    }
    return await reconcile(digest)??fail('OPERATION_UNCONFIRMED');
  }catch{return fail('OPERATION_UNCONFIRMED');}
}
