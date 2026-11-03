import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { accessDeniedResponse, authenticationRequiredResponse, createProblemResponse, validationErrorResponse, resourceNotFoundResponse } from '../problem.ts';
import { createEnquiry, convertEnquiry, listEnquiries, listJobs, getJob, getJobSteps, completeJobStep } from '../../modules/demoJourney/demoJourneyRepo.ts';

export async function handleDemoJourney(request: Request, env: Env, workspace: string, resource: string, enquiry: string | undefined, requestId: string, authentication: AuthenticationService): Promise<Response> {
 const auth = await authentication.authenticateRequest(env.DB,request,env);
 if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required',requestId);
 const membership = await authorizeWorkspaceAccess(env.DB,workspace,auth);
 if (!membership || membership.role === 'technician') return accessDeniedResponse('You do not have access to this workspace',requestId);
 const reply = (value: unknown,status=200) => Response.json(value,{status,headers:{'X-Request-Id':requestId}});
 if (request.method === 'GET' && !enquiry) return reply(resource === 'enquiries' ? await listEnquiries(env.DB,workspace,auth) : await listJobs(env.DB,workspace,auth));
 if (request.method === 'POST' && resource === 'enquiries' && !enquiry) {
  let input: unknown; try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !['customer_name','service'].includes(k))) return validationErrorResponse('Invalid enquiry',[],requestId);
  const value = input as Record<string,unknown>;
  if (typeof value.customer_name !== 'string' || typeof value.service !== 'string' || !value.customer_name.trim() || value.customer_name.trim().length > 120 || !value.service.trim() || value.service.trim().length > 500) return validationErrorResponse('A customer name and service are required',[],requestId);
  const id = await createEnquiry(env.DB,workspace,auth,{customer_name:value.customer_name.trim(),service:value.service.trim()});
  return id ? reply({id},201) : accessDeniedResponse('Permission changed',requestId);
 }
 if (request.method === 'POST' && resource === 'enquiries' && enquiry) {
  const id = await convertEnquiry(env.DB,workspace,auth,enquiry);
  if (id) return reply({id},201);
  const current = await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if (!current || current.role === 'technician') return accessDeniedResponse('Permission changed',requestId);
  return createProblemResponse(409,'CONFLICT','conflict','Conflict','Enquiry unavailable or already converted',requestId);
 }
 return new Response('Method Not Allowed',{status:405});
}

export async function handleDemoJob(request: Request, env: Env, workspace: string, jobId: string, stepId: string | undefined, requestId: string, authentication: AuthenticationService): Promise<Response> {
 const auth = await authentication.authenticateRequest(env.DB, request, env);
 if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
 const membership = await authorizeWorkspaceAccess(env.DB, workspace, auth);
 if (!membership || membership.role === 'technician') return accessDeniedResponse('You do not have access to this workspace', requestId);
 const job = await getJob(env.DB, workspace, auth, jobId);
 if (!job) {
  const current = await authorizeWorkspaceAccess(env.DB, workspace, auth);
  if (!current || current.role === 'technician') return accessDeniedResponse('Permission changed', requestId);
  return resourceNotFoundResponse('Job unavailable', requestId);
 }
 const replyWithSteps = async () => {
  const steps = await getJobSteps(env.DB, workspace, auth, jobId);
  const current = await authorizeWorkspaceAccess(env.DB, workspace, auth);
  if (!current || current.role === 'technician') return accessDeniedResponse('Permission changed', requestId);
  return Response.json({job, steps}, {headers:{'X-Request-Id':requestId}});
 };
 if (request.method === 'GET' && !stepId) return replyWithSteps();
 if (request.method === 'PATCH' && stepId) {
  let body: unknown; try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || (body as {state?: unknown}).state !== 'done') return validationErrorResponse('Only completion is supported', [], requestId);
  if (!await completeJobStep(env.DB, workspace, auth, jobId, stepId)) {
   const current = await authorizeWorkspaceAccess(env.DB, workspace, auth);
   if (!current || current.role === 'technician') return accessDeniedResponse('Permission changed', requestId);
   const steps = await getJobSteps(env.DB, workspace, auth, jobId) as Array<{id: string; step_key: string; state: string}>;
   if (steps.some(step => step.id === stepId && step.step_key === 'review_details')) return createProblemResponse(409, 'CONFLICT', 'conflict', 'Conflict', 'Step cannot be completed from its current state', requestId);
   return resourceNotFoundResponse('Step unavailable', requestId);
  }
  return replyWithSteps();
 }
 return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Method not allowed for this resource', requestId, undefined, undefined, {Allow: stepId ? 'PATCH' : 'GET'});
}
