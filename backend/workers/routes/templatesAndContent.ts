/**
 * HTTP Route handlers for Templates & Content:
 * - /api/v1/workspaces/:workspace/job-types
 * - /api/v1/workspaces/:workspace/templates
 */

import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import {
  accessDeniedResponse,
  authenticationRequiredResponse,
  createProblemResponse,
  validationErrorResponse,
  resourceNotFoundResponse,
} from '../problem.ts';
import {
  listJobTypes,
  getJobType,
  createJobType,
  updateJobType,
  setJobTypeStatus,
  deleteJobTypeDraft,
  createJobTypePolicyDraft,
  submitJobTypePolicyReview,
  approveJobTypePolicy,
  listTemplates,
  getTemplate,
  createTemplate,
  setTemplateStatus,
  deleteTemplateDraft,
  createTemplateRevisionDraft,
  submitTemplateRevisionReview,
  approveTemplateRevision,
} from '../../modules/templates/templatesRepo.ts';

export async function handleJobTypesRoute(
  request: Request,
  env: Env,
  workspace: string,
  jobTypeId: string | undefined,
  subAction: string | undefined,
  subId: string | undefined,
  action: string | undefined,
  requestId: string,
  authentication: AuthenticationService
): Promise<Response> {
  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required', requestId);

  const membership = await authorizeWorkspaceAccess(env.DB, workspace, auth);
  if (!membership) return accessDeniedResponse('You do not have access to this workspace', requestId);

  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'X-Request-Id': requestId } });

  // 1. GET /job-types (list)
  if (request.method === 'GET' && !jobTypeId) {
    const list = await listJobTypes(env.DB, workspace, auth);
    return reply(list);
  }

  // 2. GET /job-types/:id (details)
  if (request.method === 'GET' && jobTypeId && !subAction) {
    const jt = await getJobType(env.DB, workspace, auth, jobTypeId);
    if (!jt) return resourceNotFoundResponse('Job type not found', requestId);
    return reply(jt);
  }

  // Technician role cannot make any modifications
  if (membership.role === 'technician') {
    return accessDeniedResponse('Technicians cannot modify job types or compliance policies', requestId);
  }

  // 3. POST /job-types (create)
  if (request.method === 'POST' && !jobTypeId) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    if (!input || typeof input !== 'object' || !input.name || !input.brandId) {
      return validationErrorResponse('Name and brandId are required', [], requestId);
    }
    const res = await createJobType(env.DB, workspace, auth, input);
    if (!res) return createProblemResponse(400, 'CREATION_FAILED', 'creation-failed', 'Creation Failed', 'Could not create job type', requestId);
    return reply(res, 201);
  }

  // 4. PATCH /job-types/:id (update / archive / restore)
  if (request.method === 'PATCH' && jobTypeId && !subAction) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    if (!input || typeof input !== 'object') return validationErrorResponse('Invalid input', [], requestId);

    if (input.action === 'archive') {
      const ok = await setJobTypeStatus(env.DB, workspace, auth, jobTypeId, 'ARCHIVED');
      return ok ? reply({ success: true }) : resourceNotFoundResponse('Job type not found', requestId);
    }
    if (input.action === 'restore') {
      const ok = await setJobTypeStatus(env.DB, workspace, auth, jobTypeId, 'ACTIVE');
      return ok ? reply({ success: true }) : resourceNotFoundResponse('Job type not found', requestId);
    }

    const ok = await updateJobType(env.DB, workspace, auth, jobTypeId, input);
    return ok ? reply({ success: true }) : resourceNotFoundResponse('Job type not found', requestId);
  }

  // 5. DELETE /job-types/:id (delete draft)
  if (request.method === 'DELETE' && jobTypeId && !subAction) {
    const res = await deleteJobTypeDraft(env.DB, workspace, auth, jobTypeId);
    if (!res.success) {
      return createProblemResponse(400, 'DELETE_FAILED', 'delete-failed', 'Delete Failed', res.error || 'Cannot delete job type', requestId);
    }
    return reply({ success: true });
  }

  // 6. POST /job-types/:id/policies (create policy draft)
  if (request.method === 'POST' && jobTypeId && subAction === 'policies' && !subId) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    const res = await createJobTypePolicyDraft(env.DB, workspace, auth, jobTypeId, input || {});
    if (!res) return resourceNotFoundResponse('Job type not found', requestId);
    return reply(res, 201);
  }

  // 7. POST /job-types/:id/policies/:policyId/review
  if (request.method === 'POST' && jobTypeId && subAction === 'policies' && subId && action === 'review') {
    const ok = await submitJobTypePolicyReview(env.DB, workspace, auth, jobTypeId, subId);
    return ok ? reply({ success: true }) : createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Invalid State', 'Policy cannot be submitted for review', requestId);
  }

  // 8. POST /job-types/:id/policies/:policyId/approve (only owner_admin and super_admin)
  if (request.method === 'POST' && jobTypeId && subAction === 'policies' && subId && action === 'approve') {
    if (membership.role !== 'owner_admin' && membership.role !== 'super_admin') {
      return accessDeniedResponse('Only owner_admin or super_admin can approve and publish compliance policies', requestId);
    }
    const ok = await approveJobTypePolicy(env.DB, workspace, auth, jobTypeId, subId);
    return ok ? reply({ success: true }) : createProblemResponse(400, 'APPROVAL_FAILED', 'approval-failed', 'Approval Failed', 'Policy approval failed', requestId);
  }

  return new Response('Method Not Allowed', { status: 405 });
}

export async function handleTemplatesRoute(
  request: Request,
  env: Env,
  workspace: string,
  templateId: string | undefined,
  subAction: string | undefined,
  subId: string | undefined,
  action: string | undefined,
  requestId: string,
  authentication: AuthenticationService
): Promise<Response> {
  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required', requestId);

  const membership = await authorizeWorkspaceAccess(env.DB, workspace, auth);
  if (!membership) return accessDeniedResponse('You do not have access to this workspace', requestId);

  const reply = (value: unknown, status = 200) =>
    Response.json(value, { status, headers: { 'X-Request-Id': requestId } });

  // 1. GET /templates (list)
  if (request.method === 'GET' && !templateId) {
    const list = await listTemplates(env.DB, workspace, auth);
    return reply(list);
  }

  // 2. GET /templates/:id (details)
  if (request.method === 'GET' && templateId && !subAction) {
    const tpl = await getTemplate(env.DB, workspace, auth, templateId);
    if (!tpl) return resourceNotFoundResponse('Template not found', requestId);
    return reply(tpl);
  }

  // Technician role cannot make any modifications
  if (membership.role === 'technician') {
    return accessDeniedResponse('Technicians cannot modify document templates', requestId);
  }

  // 3. POST /templates (create)
  if (request.method === 'POST' && !templateId) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    if (!input || typeof input !== 'object' || !input.name || !input.templateType || !input.content) {
      return validationErrorResponse('Name, templateType, and content are required', [], requestId);
    }
    const res = await createTemplate(env.DB, workspace, auth, input);
    if (!res) return createProblemResponse(400, 'CREATION_FAILED', 'creation-failed', 'Creation Failed', 'Could not create template', requestId);
    return reply(res, 201);
  }

  // 4. PATCH /templates/:id (archive / restore)
  if (request.method === 'PATCH' && templateId && !subAction) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    if (input?.action === 'archive') {
      const ok = await setTemplateStatus(env.DB, workspace, auth, templateId, 'ARCHIVED');
      return ok ? reply({ success: true }) : resourceNotFoundResponse('Template not found', requestId);
    }
    if (input?.action === 'restore') {
      const ok = await setTemplateStatus(env.DB, workspace, auth, templateId, 'ACTIVE');
      return ok ? reply({ success: true }) : resourceNotFoundResponse('Template not found', requestId);
    }
    return validationErrorResponse('Unsupported action', [], requestId);
  }

  // 5. DELETE /templates/:id (delete draft)
  if (request.method === 'DELETE' && templateId && !subAction) {
    const res = await deleteTemplateDraft(env.DB, workspace, auth, templateId);
    if (!res.success) {
      return createProblemResponse(400, 'DELETE_FAILED', 'delete-failed', 'Delete Failed', res.error || 'Cannot delete template', requestId);
    }
    return reply({ success: true });
  }

  // 6. POST /templates/:id/revisions (create revision draft)
  if (request.method === 'POST' && templateId && subAction === 'revisions' && !subId) {
    let input: any;
    try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
    if (!input?.content || !input.content.trim()) return validationErrorResponse('Content is required', [], requestId);

    const res = await createTemplateRevisionDraft(env.DB, workspace, auth, templateId, input.content.trim());
    if (!res) return resourceNotFoundResponse('Template not found', requestId);
    return reply(res, 201);
  }

  // 7. POST /templates/:id/revisions/:revId/review
  if (request.method === 'POST' && templateId && subAction === 'revisions' && subId && action === 'review') {
    const ok = await submitTemplateRevisionReview(env.DB, workspace, auth, templateId, subId);
    return ok ? reply({ success: true }) : createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Invalid State', 'Revision cannot be submitted for review', requestId);
  }

  // 8. POST /templates/:id/revisions/:revId/approve
  if (request.method === 'POST' && templateId && subAction === 'revisions' && subId && action === 'approve') {
    if (membership.role !== 'owner_admin' && membership.role !== 'super_admin') {
      return accessDeniedResponse('Only owner_admin or super_admin can approve and publish document template revisions', requestId);
    }
    const ok = await approveTemplateRevision(env.DB, workspace, auth, templateId, subId);
    return ok ? reply({ success: true }) : createProblemResponse(400, 'APPROVAL_FAILED', 'approval-failed', 'Approval Failed', 'Revision approval failed', requestId);
  }

  return new Response('Method Not Allowed', { status: 405 });
}
