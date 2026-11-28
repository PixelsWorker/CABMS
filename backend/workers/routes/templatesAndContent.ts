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
  updateTemplateDraftContent,
  previewTemplate,
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
    if (input.formRules !== undefined) {
      if (input.brandId !== workspace || !Array.isArray(input.formRules) || input.formRules.length > 100 || input.formRules.some((r: any) => !r || typeof r.form_revision_id !== 'string' || typeof r.required !== 'boolean') || new Set(input.formRules.map((r: any) => r.form_revision_id)).size !== input.formRules.length || (input.isDirectToInvoice && input.formRules.some((r: any) => r.required))) return validationErrorResponse('Invalid policy form rules',[],requestId);
      if (input.formRules.length && !await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first()) return createProblemResponse(503,'CATALOG_NOT_READY','catalog-not-ready','Form catalog unavailable','The form catalog has not been initialized for this environment.',requestId);
      for (const rule of input.formRules) {
        const applicable = await env.DB.prepare(`SELECT r.id FROM form_revisions r JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id WHERE r.id=? AND r.workspace_id=? AND r.status='PUBLISHED' AND f.status='ACTIVE' AND f.brand_id=?`).bind(rule.form_revision_id,workspace,input.brandId).first();
        if (!applicable) return validationErrorResponse('Every form rule must reference an applicable published form',[],requestId);
      }
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
      if (!ok) {
        const jt = await getJobType(env.DB, workspace, auth, jobTypeId);
        if (!jt) return resourceNotFoundResponse('Job type not found', requestId);
        return createProblemResponse(400, 'ACTIVATION_FAILED', 'activation-failed', 'Activation Failed', 'Cannot activate job type without a published compliance policy', requestId);
      }
      return reply({ success: true });
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
    if (!input || typeof input !== 'object' || Array.isArray(input) || (input.formRules !== undefined && (!Array.isArray(input.formRules) || input.formRules.length > 100 || input.formRules.some((rule: any) => !rule || typeof rule.form_revision_id !== 'string' || typeof rule.required !== 'boolean') || new Set(input.formRules.map((rule: any) => rule.form_revision_id)).size !== input.formRules.length)) || (input.isDirectToInvoice && input.formRules?.some((rule: any) => rule.required))) {
      return validationErrorResponse('Invalid policy form rules', [], requestId);
    }
    if (input.formRules?.length && !await env.DB.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first()) {
      return createProblemResponse(503, 'CATALOG_NOT_READY', 'catalog-not-ready', 'Form catalog unavailable', 'The form catalog has not been initialized for this environment.', requestId);
    }
    for (const rule of input.formRules || []) {
      const applicable = await env.DB.prepare(`SELECT r.id FROM form_revisions r JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id JOIN job_types jt ON jt.workspace_id=r.workspace_id AND jt.brand_id=f.brand_id WHERE r.id=? AND r.workspace_id=? AND r.status='PUBLISHED' AND f.status='ACTIVE' AND jt.id=?`).bind(rule.form_revision_id,workspace,jobTypeId).first();
      if (!applicable) return validationErrorResponse('Every form rule must reference an applicable published form',[],requestId);
    }
    const res = await createJobTypePolicyDraft(env.DB, workspace, auth, jobTypeId, input || {});
    if (!res) return resourceNotFoundResponse('Job type not found', requestId);
    if ('error' in res) {
      if (res.code === 'VERSION_CONFLICT') {
        return createProblemResponse(409, 'VERSION_CONFLICT', 'version-conflict', 'Policy conflict', res.detail || 'The policy draft is based on a policy that is no longer current.', requestId);
      }
      return validationErrorResponse(res.error, [], requestId);
    }
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
    if (!ok.success) {
      if (ok.code === 'LEGACY_MAPPING_REQUIRED') {
        return Response.json({
          code: 'LEGACY_MAPPING_REQUIRED',
          title: 'Legacy Mapping Required',
          detail: ok.error,
          blockers: ok.blockers,
          request_id: requestId,
        }, {
          status: 409,
          headers: { 'X-Request-Id': requestId, 'Content-Type': 'application/problem+json' },
        });
      }
      return createProblemResponse(400, 'APPROVAL_FAILED', 'approval-failed', 'Approval Failed', ok.error || 'Policy approval requires a reviewed policy, eligible published forms and operational job enforcement for catalog rules.', requestId);
    }
    return reply({ success: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}

async function validateTemplateOutput(
  db: Env['DB'],
  workspace: string,
  out: any,
  requestId: string
): Promise<Response | null> {
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (
    !object(out) ||
    !['Compliance', 'Terms', 'Email', 'Contract'].includes(out.category) ||
    out.brand_id !== workspace ||
    !object(out.layout) ||
    !object(out.dynamic_fields) ||
    JSON.stringify(out).length > 16000 ||
    (out.linked_form_revision_id != null && typeof out.linked_form_revision_id !== 'string')
  ) {
    return validationErrorResponse('Invalid output configuration', [], requestId);
  }
  if (!await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='template_revision_output'`).first()) {
    return createProblemResponse(503, 'CATALOG_NOT_READY', 'catalog-not-ready', 'Form catalog unavailable', 'The form catalog has not been initialized for this environment.', requestId);
  }
  if (out.document_type_id != null) {
    if (typeof out.document_type_id !== 'string') return validationErrorResponse('Invalid document type reference', [], requestId);
    const documentType = await db.prepare(`SELECT id FROM document_type_catalog WHERE id=? AND workspace_id=? AND status='PUBLISHED'`).bind(out.document_type_id, workspace).first();
    if (!documentType) return validationErrorResponse('Document type must be published in this workspace', [], requestId);
  }
  if (out.linked_form_revision_id) {
    const form = await db.prepare(`SELECT r.id FROM form_revisions r JOIN form_definitions d ON d.id=r.form_definition_id AND d.workspace_id=r.workspace_id WHERE r.id=? AND r.workspace_id=? AND r.status='PUBLISHED' AND d.status='ACTIVE' AND d.brand_id=?`).bind(out.linked_form_revision_id, workspace, out.brand_id).first();
    if (!form) return validationErrorResponse('Linked form revision must be published and in this workspace and business', [], requestId);
  }
  return null;
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

  // 2b. GET or POST /templates/:id/preview (simulated document preview)
  if ((request.method === 'GET' || request.method === 'POST') && templateId && subAction === 'preview' && !subId) {
    let options: { revisionId?: string; content?: string; dynamicFields?: Record<string, unknown>; sampleData?: Record<string, string> } = {};
    if (request.method === 'POST') {
      let body: any;
      try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON', [], requestId); }
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        options = {
          revisionId: typeof body.revisionId === 'string' ? body.revisionId : undefined,
          content: typeof body.content === 'string' ? body.content : undefined,
          dynamicFields: body.dynamicFields && typeof body.dynamicFields === 'object' && !Array.isArray(body.dynamicFields) ? body.dynamicFields : undefined,
          sampleData: body.sampleData && typeof body.sampleData === 'object' && !Array.isArray(body.sampleData) ? body.sampleData : undefined,
        };
      }
    }
    const preview = await previewTemplate(env.DB, workspace, auth, templateId, options);
    if (!preview) return resourceNotFoundResponse('Template not found', requestId);
    return reply(preview);
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
    if (input.output !== undefined) {
      const outputErr = await validateTemplateOutput(env.DB, workspace, input.output, requestId);
      if (outputErr) return outputErr;
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
      if (!ok) {
        const tpl = await getTemplate(env.DB, workspace, auth, templateId);
        if (!tpl) return resourceNotFoundResponse('Template not found', requestId);
        return createProblemResponse(400, 'ACTIVATION_FAILED', 'activation-failed', 'Activation Failed', 'Cannot activate template without a published revision', requestId);
      }
      return reply({ success: true });
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

  // Update only a draft and require the exact server revision timestamp.
  if (request.method === 'PUT' && templateId && subAction === 'revisions' && subId && !action) {
    const match = request.headers.get('If-Match');
    if (!match) return createProblemResponse(428,'PRECONDITION_REQUIRED','precondition-required','Precondition Required','If-Match is required to save a draft',requestId);
    const parsed = /^"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)"$/.exec(match);
    if (!parsed || !Number.isFinite(Date.parse(parsed[1]))) return validationErrorResponse('Invalid draft version',[],requestId);
    let input:unknown; try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }
    const body = input as { content?: unknown; sampleFileName?: unknown; mappingStatus?: unknown; output?: unknown };
    if (!input || typeof input !== 'object' || Array.isArray(input) || typeof body.content !== 'string' || !body.content.trim() || body.content.length > 100000) return validationErrorResponse('Content is required and must be at most 100000 characters',[],requestId);
    if (body.mappingStatus !== undefined && !['Mapped', 'Pending Review', 'Unsupported'].includes(String(body.mappingStatus))) {
      return validationErrorResponse('Invalid mappingStatus', [], requestId);
    }
    if (body.output !== undefined) {
      const outputErr = await validateTemplateOutput(env.DB, workspace, body.output, requestId);
      if (outputErr) return outputErr;
    }
    const updated = await updateTemplateDraftContent(env.DB,workspace,auth,templateId,subId,parsed[1],body.content, {
      sampleFileName: typeof body.sampleFileName === 'string' ? body.sampleFileName : undefined,
      mappingStatus: body.mappingStatus as 'Mapped' | 'Pending Review' | 'Unsupported' | undefined,
      output: body.output as any,
    });
    return updated ? reply({updated_at:updated}) : createProblemResponse(412,'PRECONDITION_FAILED','precondition-failed','Precondition Failed','Draft changed or is no longer editable. Reload before saving.',requestId);
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
    return ok ? reply({ success: true }) : createProblemResponse(400, 'APPROVAL_FAILED', 'approval-failed', 'Approval Failed', 'Revision must be in REVIEW status before approval', requestId);
  }

  return new Response('Method Not Allowed', { status: 405 });
}
