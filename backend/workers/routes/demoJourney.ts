import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { accessDeniedResponse, authenticationRequiredResponse, createProblemResponse, validationErrorResponse } from '../problem.ts';
import { createEnquiry, convertEnquiry, listEnquiries, listJobs } from '../../modules/demoJourney/demoJourneyRepo.ts';

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
