import { validDemoAppointmentRange } from '../../../contracts/demoAppointments.ts';
/** Local synthetic appointments only; no real assignments or calendar synchronization. */
import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { accessDeniedResponse, authenticationRequiredResponse, createProblemResponse, validationErrorResponse } from '../problem.ts';
import { listAppointments, createAppointment, updateAppointment } from '../../modules/scheduling/demoAppointmentRepo.ts';

export async function handleDemoAppointments(request: Request, env: Env, workspace: string, id: string | undefined, requestId: string, authentication: AuthenticationService): Promise<Response> {
 if (!['development','test'].includes(env.ENVIRONMENT ?? '')) return createProblemResponse(404,'RESOURCE_NOT_FOUND','resource-not-found','Resource Not Found','Resource unavailable',requestId);
 const auth=await authentication.authenticateRequest(env.DB,request,env);
 if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required',requestId);
 const role=await authorizeWorkspaceAccess(env.DB,workspace,auth);
 if (!role || role.role==='technician') return accessDeniedResponse('You do not have access to this workspace',requestId);
 const reply=async(data:unknown,status=200)=>{ const current=await authorizeWorkspaceAccess(env.DB,workspace,auth); if(!current || current.role==='technician') return accessDeniedResponse('Permission changed',requestId); return Response.json(data,{status,headers:{'X-Request-Id':requestId}}); };
 if (request.method==='GET' && !id) return reply(await listAppointments(env.DB,workspace,auth));
 if ((request.method==='POST' && !id) || (request.method==='PATCH' && id)) {
  let input:unknown; try {input=await request.json();} catch {return validationErrorResponse('Invalid JSON',[],requestId);}
  if (!input || typeof input!=='object' || Array.isArray(input)) return validationErrorResponse('Invalid appointment',[],requestId);
  const data=input as Record<string,unknown>;
  if (request.method==='POST') {
   if (Object.keys(data).sort().join(',')!=='ends_at,job_id,starts_at' || typeof data.job_id!=='string' || !data.job_id || data.job_id.length>100 || !validDemoAppointmentRange(data.starts_at,data.ends_at)) return validationErrorResponse('Synthetic job and valid UTC start and end are required',[],requestId);
   const created=await createAppointment(env.DB,workspace,auth,data.job_id,data.starts_at,data.ends_at as string);
   if (created) return reply(created,201);
  } else {
   if (!Number.isSafeInteger(data.version) || (data.version as number)<1) return validationErrorResponse('A positive version is required',[],requestId);
   const keys=Object.keys(data).sort().join(',');
   if (!(keys==='status,version' && data.status==='cancelled') && !(keys==='ends_at,starts_at,version' && validDemoAppointmentRange(data.starts_at,data.ends_at))) return validationErrorResponse('Invalid appointment change',[],requestId);
   const change=keys==='status,version' ? {status:'cancelled' as const} : {starts_at:data.starts_at as string,ends_at:data.ends_at as string};
   const updated=await updateAppointment(env.DB,workspace,auth,id!,data.version as number,change);
   if (updated) return reply(updated);
  }
  const current=await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if (!current || current.role==='technician') return accessDeniedResponse('Permission changed',requestId);
  return createProblemResponse(409,'CONFLICT','conflict','Conflict','Synthetic job or appointment unavailable, stale or cancelled',requestId);
 }
 return createProblemResponse(405,'METHOD_NOT_ALLOWED','method-not-allowed','Method Not Allowed','Method not allowed for this resource',requestId,undefined,undefined,{Allow:id?'PATCH':'GET, POST'});
}
