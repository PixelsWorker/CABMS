import type { Env } from '../../types.ts';
import type { D1PreparedStatement } from '../../db/d1.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { approvedMembership } from '../privilegedApproval.ts';
import { accessDeniedResponse, authenticationRequiredResponse, createProblemResponse, resourceNotFoundResponse, validationErrorResponse } from '../problem.ts';
import { validateFormDefinition } from '../../modules/forms/formSchema.ts';

const allowed = (roles: string) => `EXISTS (SELECT 1 FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id AND u.disabled=0 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase' WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=? AND wm.role IN (${roles}) AND ${approvedMembership})`;
const staff = allowed("'super_admin','owner_admin','office_staff'");
const approver = allowed("'super_admin','owner_admin'");
type Field = { key:string; label:string; type:string; required?:boolean; instructions?:string; choices?:string[]; validation?:object; visible_when?:object; autofill_source?:string };
type Section = { title:string; description?:string; repeatable?:boolean; fields:Field[] };

function comparePublishedRevisions(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const approvedA = String(a.approved_at || '');
  const approvedB = String(b.approved_at || '');
  if (approvedA !== approvedB) return approvedA.localeCompare(approvedB);
  const createdA = String(a.created_at || '');
  const createdB = String(b.created_at || '');
  if (createdA !== createdB) return createdA.localeCompare(createdB);
  return String(a.id || '').localeCompare(String(b.id || ''));
}

function computeDisplayVersions(revisions: Array<Record<string, unknown>>): void {
  const published = revisions.filter(rev => rev.status === 'PUBLISHED').sort(comparePublishedRevisions);
  published.forEach((rev, index) => {
    rev.display_version = `Revision ${index + 1}`;
  });
  for (const rev of revisions) {
    if (rev.status === 'PUBLISHED') continue;
    if (rev.status === 'REVIEW') {
      rev.display_version = 'Awaiting approval';
    } else if (rev.status === 'DRAFT') {
      rev.display_version = 'Draft revision';
    } else {
      rev.display_version = typeof rev.version === 'string' && !rev.version.startsWith('draft-') ? rev.version : 'Revision';
    }
  }
}

export async function handleFormDefinitions(request: Request, env: Env, workspace: string, id: string | undefined, revision: string | undefined, action: string | undefined, requestId: string, authentication: AuthenticationService): Promise<Response> {
 const auth = await authentication.authenticateRequest(env.DB,request,env);
 if (!auth) return authenticationRequiredResponse('Valid staff authentication token is required',requestId);
 const member = await authorizeWorkspaceAccess(env.DB,workspace,auth);
 if (!member || member.role === 'technician') return accessDeniedResponse('Form library access denied',requestId);
 const catalog = await env.DB.prepare(`SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('form_definitions','form_revisions','form_sections','form_fields','policy_catalog_form_rules','template_revision_output')`).first<{count:number}>();
 if (catalog?.count !== 6) return createProblemResponse(503,'CATALOG_NOT_READY','catalog-not-ready','Form catalog unavailable','The form catalog has not been initialized for this environment.',requestId);
 const who = [workspace,auth.userId,auth.providerSubjectId];
 const reply = (data:unknown,status=200) => Response.json(data,{status,headers:{'X-Request-Id':requestId}});
 const fail = () => createProblemResponse(400,'INVALID_STATE','invalid-state','Invalid State','Form revision transition failed',requestId);
 if (request.method === 'GET' && !id) {
  const publishedOnly = new URL(request.url).searchParams.get('published') === '1';
  const rows = await env.DB.prepare(`SELECT f.*, (SELECT version FROM form_revisions WHERE id=f.published_revision_id AND workspace_id=f.workspace_id) AS current_version, (SELECT status FROM form_revisions WHERE workspace_id=f.workspace_id AND form_definition_id=f.id AND status IN ('DRAFT','REVIEW') ORDER BY created_at DESC,id DESC LIMIT 1) AS pending_status, (SELECT COUNT(DISTINCT p.job_type_id) FROM policy_catalog_form_rules cr JOIN job_type_compliance_policies p ON p.id=cr.policy_version_id JOIN form_revisions r ON r.id=cr.form_revision_id AND r.workspace_id=cr.workspace_id WHERE cr.workspace_id=f.workspace_id AND r.form_definition_id=f.id AND p.status='PUBLISHED') AS used_by_job_types FROM form_definitions f WHERE f.workspace_id=? AND ${staff} AND (?=0 OR (f.status='ACTIVE' AND f.published_revision_id IS NOT NULL)) ORDER BY f.title,f.id`).bind(workspace,...who,publishedOnly ? 1 : 0).all<Record<string,unknown>>();
  const publishedRows = (await env.DB.prepare(`SELECT id, form_definition_id, status, version, approved_at, created_at FROM form_revisions WHERE workspace_id=? AND status='PUBLISHED'`).bind(workspace).all<Record<string,unknown>>()).results;
  const byForm = new Map<string, Array<Record<string, unknown>>>();
  for (const pr of publishedRows) {
    const key = String(pr.form_definition_id);
    const list = byForm.get(key) || [];
    list.push(pr);
    byForm.set(key, list);
  }
  for (const revs of byForm.values()) computeDisplayVersions(revs);
  for (const row of rows.results) {
   const revs = byForm.get(String(row.id)) || [];
   const pub = revs.find(r => r.id === row.published_revision_id);
   row.display_version = (pub?.display_version as string | undefined) ?? null;
  }
  return reply(rows.results);
 }
 if (request.method === 'GET' && id && !revision && !action) {
  const form = await env.DB.prepare(`SELECT f.* FROM form_definitions f WHERE f.workspace_id=? AND f.id=? AND ${staff}`).bind(workspace,id,...who).first<Record<string,unknown>>();
  if (!form) return resourceNotFoundResponse('Form definition not found',requestId);
  const revisions = (await env.DB.prepare('SELECT * FROM form_revisions WHERE workspace_id=? AND form_definition_id=? ORDER BY created_at DESC,id DESC').bind(workspace,id).all<Record<string,unknown>>()).results;
  computeDisplayVersions(revisions);
  const publishedRev = revisions.find(r => r.id === form.published_revision_id);
  form.display_version = (publishedRev?.display_version as string | undefined) ?? null;
  for (const rev of revisions) {
   const sections = (await env.DB.prepare('SELECT * FROM form_sections WHERE workspace_id=? AND revision_id=? ORDER BY display_order,id').bind(workspace,rev.id).all<Record<string,unknown>>()).results;
   for (const section of sections) {
    const fields = (await env.DB.prepare('SELECT * FROM form_fields WHERE workspace_id=? AND section_id=? ORDER BY display_order,id').bind(workspace,section.id).all<Record<string,unknown>>()).results;
    section.fields = fields.map(f => ({...f,key:f.field_key,type:f.field_type,choices:JSON.parse(f.choices_json as string),validation:JSON.parse(f.validation_json as string),visible_when:f.visible_when_json ? JSON.parse(f.visible_when_json as string) : undefined}));
   }
   rev.sections = sections;
  }
  return reply({...form,revisions});
 }
 if (request.method === 'DELETE' && id && !revision && !action) {
  const safe = `EXISTS (SELECT 1 FROM form_definitions d WHERE d.id=? AND d.workspace_id=? AND d.status='DRAFT' AND d.published_revision_id IS NULL AND NOT EXISTS (SELECT 1 FROM form_revisions r WHERE r.workspace_id=d.workspace_id AND r.form_definition_id=d.id AND r.status<>'DRAFT'))`;
  const scope = [id,workspace,...who];
  const results = await env.DB.batch([
   env.DB.prepare(`DELETE FROM form_fields WHERE workspace_id=? AND section_id IN (SELECT s.id FROM form_sections s JOIN form_revisions r ON r.id=s.revision_id AND r.workspace_id=s.workspace_id WHERE r.workspace_id=? AND r.form_definition_id=?) AND ${safe} AND ${staff}`).bind(workspace,workspace,id,...scope),
   env.DB.prepare(`DELETE FROM form_sections WHERE workspace_id=? AND revision_id IN (SELECT id FROM form_revisions WHERE workspace_id=? AND form_definition_id=?) AND ${safe} AND ${staff}`).bind(workspace,workspace,id,...scope),
   env.DB.prepare(`DELETE FROM form_revisions WHERE workspace_id=? AND form_definition_id=? AND status='DRAFT' AND ${safe} AND ${staff}`).bind(workspace,id,...scope),
   env.DB.prepare(`DELETE FROM form_definitions WHERE id=? AND workspace_id=? AND status='DRAFT' AND ${safe} AND ${staff}`).bind(id,workspace,...scope),
  ]);
  return results[3]?.meta.changes === 1 && results.every(r=>r.success) ? reply({success:true}) : fail();
 }
 if (request.method === 'PATCH' && id && !revision && !action) {
  let input: unknown; try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }
  if (!input || typeof input !== 'object') return validationErrorResponse('Unsupported action',[],requestId);
  if ((input as {action?:unknown}).action === 'restore') {
   const result = await env.DB.prepare(`UPDATE form_definitions SET status=CASE WHEN published_revision_id IS NULL THEN 'DRAFT' ELSE 'ACTIVE' END,updated_at=? WHERE id=? AND workspace_id=? AND status='ARCHIVED' AND (published_revision_id IS NULL OR EXISTS (SELECT 1 FROM form_revisions r WHERE r.id=form_definitions.published_revision_id AND r.workspace_id=form_definitions.workspace_id AND r.form_definition_id=form_definitions.id AND r.status='PUBLISHED')) AND ${staff}`).bind(new Date().toISOString(),id,workspace,...who).run();
   return result.meta.changes === 1 ? reply({success:true}) : fail();
  }
  if ((input as {action?:unknown}).action !== 'archive') return validationErrorResponse('Unsupported action',[],requestId);
  const result = await env.DB.prepare(`UPDATE form_definitions SET status='ARCHIVED',updated_at=? WHERE id=? AND workspace_id=? AND status<>'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM form_revisions r WHERE r.workspace_id=form_definitions.workspace_id AND r.form_definition_id=form_definitions.id AND (EXISTS (SELECT 1 FROM policy_catalog_form_rules cr JOIN job_types t ON t.workspace_id=cr.workspace_id AND t.id=(SELECT p.job_type_id FROM job_type_compliance_policies p WHERE p.id=cr.policy_version_id) WHERE t.status<>'ARCHIVED' AND cr.workspace_id=r.workspace_id AND cr.form_revision_id=r.id) OR EXISTS (SELECT 1 FROM template_revision_output o JOIN template_revisions v ON v.id=o.revision_id JOIN document_templates t ON t.id=v.template_id WHERE t.status<>'ARCHIVED' AND o.workspace_id=r.workspace_id AND t.workspace_id=r.workspace_id AND o.linked_form_revision_id=r.id))) AND ${staff}`).bind(new Date().toISOString(),id,workspace,...who).run();
  return result.meta.changes === 1 ? reply({success:true}) : fail();
 }
 if (request.method === 'POST' && id && revision && action === 'signer-grants') {
  if (member.role !== 'owner_admin' && member.role !== 'super_admin') return accessDeniedResponse('Admin required to grant signing access',requestId);
  let input: unknown; try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }
  const userId = input && typeof input === 'object' && typeof (input as {user_id?:unknown}).user_id === 'string' ? (input as {user_id:string}).user_id.trim() : '';
  if (!userId) return validationErrorResponse('user_id is required',[],requestId);
  const exists = await env.DB.prepare(`SELECT 1 FROM form_revisions r JOIN workspace_memberships wm ON wm.workspace_id=r.workspace_id AND wm.user_id=? JOIN users u ON u.id=wm.user_id AND u.disabled=0 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase' WHERE r.id=? AND r.workspace_id=? AND r.form_definition_id=? AND ${approvedMembership}`).bind(userId,revision,workspace,id).first();
  if (!exists) return fail();
  await env.DB.prepare(`INSERT OR IGNORE INTO compliance_signer_grants (workspace_id, revision_id, user_id) VALUES (?, ?, ?)`).bind(workspace,revision,userId).run();
  return reply({granted:true, workspace_id:workspace, revision_id:revision, user_id:userId}, 201);
 }
 if (request.method === 'POST' && !id) {
  let input: any; try { input = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }
  if (!input || typeof input.title !== 'string' || !input.title.trim() || input.title.length>160 || typeof input.code !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(input.code) || input.brand_id !== workspace || typeof input.description !== 'string' || !input.description.trim() || input.description.length>4000 || !['Safety','Electrical','Smoke Alarm','Cabling','Inspection','Custom'].includes(input.category)) return validationErrorResponse('Invalid form metadata',[],requestId);
  if (validateFormDefinition(input.schema).length) return validationErrorResponse('Invalid form schema',[],requestId);
  const formId=`form-${crypto.randomUUID()}`, revId=`formrev-${crypto.randomUUID()}`, now=new Date().toISOString();
  const statements:D1PreparedStatement[] = [
   env.DB.prepare(`INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,description,category,status,created_at,updated_at,created_by) SELECT ?,?,?,?,?,?,?,'DRAFT',?,?,? WHERE ${staff}`).bind(formId,workspace,input.brand_id,input.code,input.title.trim(),input.description.trim(),input.category,now,now,auth.userId,...who),
   env.DB.prepare(`INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) SELECT ?,?,?,'v1.0','DRAFT',?,?,? WHERE EXISTS (SELECT 1 FROM form_definitions WHERE id=? AND workspace_id=?) AND ${staff}`).bind(revId,workspace,formId,now,now,auth.userId,formId,workspace,...who),
  ];
  for (const [i,section] of (input.schema.sections as Section[]).entries()) {
   const sid=`section-${crypto.randomUUID()}`;
   statements.push(env.DB.prepare(`INSERT INTO form_sections (id,workspace_id,revision_id,title,description,display_order,repeatable) SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM form_revisions WHERE id=? AND workspace_id=? AND status='DRAFT') AND ${staff}`).bind(sid,workspace,revId,section.title.trim(),section.description || '',i,section.repeatable ? 1 : 0,revId,workspace,...who));
   for (const [j,f] of section.fields.entries()) statements.push(env.DB.prepare(`INSERT INTO form_fields (id,workspace_id,section_id,field_key,label,field_type,required,display_order,instructions,choices_json,validation_json,visible_when_json,autofill_source) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM form_sections WHERE id=? AND workspace_id=?) AND ${staff}`).bind(`field-${crypto.randomUUID()}`,workspace,sid,f.key,f.label.trim(),f.type,f.required ? 1 : 0,j,f.instructions || '',JSON.stringify(f.choices || []),JSON.stringify(f.validation || {}),f.visible_when ? JSON.stringify(f.visible_when) : null,f.autofill_source || null,sid,workspace,...who));
  }
  const result=await env.DB.batch(statements);
  if (result.some(r => !r.success || r.meta.changes !== 1)) return fail();
  return reply({id:formId,revision_id:revId},201);
 }
 if (request.method === 'POST' && id && action === 'new-revision') {
  const form = await env.DB.prepare(`SELECT published_revision_id FROM form_definitions WHERE id=? AND workspace_id=? AND status='ACTIVE' AND ${staff}`).bind(id,workspace,...who).first<{published_revision_id:string}>();
  if (!form?.published_revision_id) return fail();
  const sections = (await env.DB.prepare('SELECT * FROM form_sections WHERE workspace_id=? AND revision_id=? ORDER BY display_order,id').bind(workspace,form.published_revision_id).all<Record<string,unknown>>()).results;
  const revId=`formrev-${crypto.randomUUID()}`, now=new Date().toISOString();
  const statements:D1PreparedStatement[] = [env.DB.prepare(`INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) SELECT ?,?,? ,?,'DRAFT',?,?,? WHERE EXISTS (SELECT 1 FROM form_definitions WHERE id=? AND workspace_id=? AND status='ACTIVE' AND published_revision_id=?) AND ${staff}`).bind(revId,workspace,id,`draft-${crypto.randomUUID()}`,now,now,auth.userId,id,workspace,form.published_revision_id,...who)];
  for (const section of sections) {
   const sid=`section-${crypto.randomUUID()}`;
   statements.push(env.DB.prepare(`INSERT INTO form_sections (id,workspace_id,revision_id,title,description,display_order,repeatable) SELECT ?,?, ?,title,description,display_order,repeatable FROM form_sections WHERE id=? AND workspace_id=? AND EXISTS (SELECT 1 FROM form_revisions WHERE id=? AND workspace_id=? AND status='DRAFT') AND ${staff}`).bind(sid,workspace,revId,section.id,workspace,revId,workspace,...who));
   const fields = (await env.DB.prepare('SELECT id FROM form_fields WHERE workspace_id=? AND section_id=? ORDER BY display_order,id').bind(workspace,section.id).all<{id:string}>()).results;
   for (const field of fields) statements.push(env.DB.prepare(`INSERT INTO form_fields (id,workspace_id,section_id,field_key,label,field_type,required,display_order,instructions,choices_json,validation_json,visible_when_json,autofill_source) SELECT ?,?,?,field_key,label,field_type,required,display_order,instructions,choices_json,validation_json,visible_when_json,autofill_source FROM form_fields WHERE id=? AND workspace_id=? AND EXISTS (SELECT 1 FROM form_revisions WHERE id=? AND workspace_id=? AND status='DRAFT') AND ${staff}`).bind(`field-${crypto.randomUUID()}`,workspace,sid,field.id,workspace,revId,workspace,...who));
  }
  const results = await env.DB.batch(statements);
  return results.every(r=>r.success && r.meta.changes===1) ? reply({revision_id:revId},201) : fail();
 }
 const nextRevisionVersion = () => `${new Date().toISOString()}_${crypto.randomUUID().slice(0,8)}`;
 const parseRevisionPrecondition = (req: Request, body: unknown) => {
  const rawIfMatch = req.headers.get('If-Match');
  const hasIfMatch = rawIfMatch !== null && rawIfMatch.trim() !== '';
  const ifMatch = rawIfMatch?.replace(/^"|"$/g, '').trim() ?? '';
  const rawBodyExpected = body && typeof body === 'object' ? (body as Record<string, unknown>).expected_updated_at : undefined;
  const hasBodyExpected = typeof rawBodyExpected === 'string' && rawBodyExpected.trim() !== '';
  const bodyExpected = typeof rawBodyExpected === 'string' ? rawBodyExpected.trim() : '';
  return { hasIfMatch, ifMatch, hasBodyExpected, bodyExpected };
 };
 if (request.method === 'PUT' && id && revision && !action) {
  let schema: any; try { schema = await request.json(); } catch { return validationErrorResponse('Invalid JSON',[],requestId); }

  const { hasIfMatch, ifMatch, hasBodyExpected, bodyExpected } = parseRevisionPrecondition(request, schema);
  // Fix 1a: Both preconditions absent/null/empty -> 428 Precondition Required (before any DB access)
  if (!hasIfMatch && !hasBodyExpected) {
    return Response.json({ error: 'Version precondition required' }, { status: 428, headers: { 'X-Request-Id': requestId } });
  }
  if (validateFormDefinition(schema).length) return validationErrorResponse('Invalid form schema',[],requestId);

  const currentRev = await env.DB.prepare(
    `SELECT updated_at, status FROM form_revisions WHERE id=? AND workspace_id=? AND form_definition_id=?`
  ).bind(revision, workspace, id).first<{ updated_at: string; status: string }>();
  if (!currentRev) return resourceNotFoundResponse('Form revision not found', requestId);
  if (currentRev.status !== 'DRAFT') return createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Invalid State', 'Only DRAFT form revisions can be edited.', requestId);

  const formDef = await env.DB.prepare(
    `SELECT status FROM form_definitions WHERE id=? AND workspace_id=?`
  ).bind(id, workspace).first<{ status: string }>();
  if (!formDef || formDef.status === 'ARCHIVED') {
    return createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Invalid State', 'Cannot edit draft for archived form.', requestId);
  }

  if ((hasIfMatch && ifMatch !== currentRev.updated_at) || (hasBodyExpected && bodyExpected !== currentRev.updated_at)) {
    return Response.json({ error: 'Conflict', code: 'VERSION_CONFLICT', detail: 'The draft form revision was modified by another session. Please reload to review current changes.' }, { status: 409, headers: { 'X-Request-Id': requestId } });
  }
  const expectedVersion = hasIfMatch ? ifMatch : bodyExpected;

  // Fix 1b: Monotonic version token — combines ISO timestamp with UUID suffix so same-millisecond saves always produce distinct values
  const newVersion = nextRevisionVersion();
  const draftAtNewVersion = `EXISTS (SELECT 1 FROM form_revisions r WHERE r.id=? AND r.workspace_id=? AND r.form_definition_id=? AND r.updated_at=? AND r.status='DRAFT' AND EXISTS (SELECT 1 FROM form_definitions d WHERE d.id=r.form_definition_id AND d.workspace_id=r.workspace_id AND d.status<>'ARCHIVED'))`;
  const revisionScope = [revision,workspace,id,newVersion,...who];

  // Single-batch atomicity: execute revision UPDATE and all dependent DELETE/INSERT statements
  // inside one env.DB.batch() SQLite transaction. Dependent statements require r.updated_at = newVersion
  // so they are no-ops if the UPDATE matches 0 rows (stale/conflict), and any failure rolls back the full transaction.
  const statements: D1PreparedStatement[] = [
   env.DB.prepare(`UPDATE form_revisions SET updated_at=? WHERE id=? AND workspace_id=? AND form_definition_id=? AND status='DRAFT' AND updated_at=? AND EXISTS (SELECT 1 FROM form_definitions d WHERE d.id=form_revisions.form_definition_id AND d.workspace_id=form_revisions.workspace_id AND d.status<>'ARCHIVED') AND ${staff}`).bind(newVersion, revision, workspace, id, expectedVersion, ...who),
   env.DB.prepare(`DELETE FROM form_fields WHERE workspace_id=? AND section_id IN (SELECT id FROM form_sections WHERE workspace_id=? AND revision_id=?) AND ${draftAtNewVersion} AND ${staff}`).bind(workspace,workspace,revision,...revisionScope),
   env.DB.prepare(`DELETE FROM form_sections WHERE workspace_id=? AND revision_id=? AND ${draftAtNewVersion} AND ${staff}`).bind(workspace,revision,...revisionScope),
  ];
  for (const [i,section] of ((schema as { sections: Section[] }).sections).entries()) {
   const sid=`section-${crypto.randomUUID()}`;
   statements.push(env.DB.prepare(`INSERT INTO form_sections (id,workspace_id,revision_id,title,description,display_order,repeatable) SELECT ?,?,?,?,?,?,? WHERE ${draftAtNewVersion} AND ${staff}`).bind(sid,workspace,revision,section.title.trim(),section.description || '',i,section.repeatable ? 1 : 0,...revisionScope));
   for (const [j,f] of section.fields.entries()) statements.push(env.DB.prepare(`INSERT INTO form_fields (id,workspace_id,section_id,field_key,label,field_type,required,display_order,instructions,choices_json,validation_json,visible_when_json,autofill_source) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${draftAtNewVersion} AND ${staff}`).bind(`field-${crypto.randomUUID()}`,workspace,sid,f.key,f.label.trim(),f.type,f.required ? 1 : 0,j,f.instructions || '',JSON.stringify(f.choices || []),JSON.stringify(f.validation || {}),f.visible_when ? JSON.stringify(f.visible_when) : null,f.autofill_source || null,...revisionScope));
  }
  try {
    const results = await env.DB.batch(statements);
    if (results[0]?.meta.changes === 0) {
      return Response.json({ error: 'Conflict', code: 'VERSION_CONFLICT', detail: 'The draft form revision was modified by another session.' }, { status: 409, headers: { 'X-Request-Id': requestId } });
    }
    return results[0]?.meta.changes === 1 && results.every(r => r.success) ? reply({success:true, updated_at: newVersion}) : fail();
  } catch (batchError) {
    // D1 env.DB.batch() wraps all statements in a single SQLite transaction; any failure rolls back the full transaction including form_revisions.
    return Response.json({ error: 'Internal server error during section/field update; full transaction rolled back', detail: String(batchError) }, { status: 500, headers: { 'X-Request-Id': requestId } });
  }
 }
 if (request.method === 'POST' && id && revision && action === 'review') {
  let reviewBody: unknown = null;
  try { reviewBody = await request.json(); } catch {}
  const { hasIfMatch, ifMatch, hasBodyExpected, bodyExpected } = parseRevisionPrecondition(request, reviewBody);

  // Fix 1a: Both preconditions absent/null/empty -> 428 Precondition Required (before any DB access)
  if (!hasIfMatch && !hasBodyExpected) {
    return Response.json({ error: 'Version precondition required' }, { status: 428, headers: { 'X-Request-Id': requestId } });
  }

  const currentRev = await env.DB.prepare(
    `SELECT updated_at, status FROM form_revisions WHERE id=? AND workspace_id=? AND form_definition_id=?`
  ).bind(revision, workspace, id).first<{ updated_at: string; status: string }>();
  if (!currentRev) return resourceNotFoundResponse('Form revision not found', requestId);
  if (currentRev.status !== 'DRAFT') return createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Invalid State', 'Only DRAFT form revisions can be submitted for review.', requestId);

  if ((hasIfMatch && ifMatch !== currentRev.updated_at) || (hasBodyExpected && bodyExpected !== currentRev.updated_at)) {
    return Response.json({ error: 'Conflict', code: 'VERSION_CONFLICT', detail: 'The draft form revision was modified after your inspection. Please reload and review the current draft.' }, { status: 409, headers: { 'X-Request-Id': requestId } });
  }
  const expectedVersion = hasIfMatch ? ifMatch : bodyExpected;

  const hasFields = await env.DB.prepare(
    `SELECT 1 FROM form_sections s JOIN form_fields f ON f.workspace_id=s.workspace_id AND f.section_id=s.id WHERE s.workspace_id=? AND s.revision_id=?`
  ).bind(workspace, revision).first();
  if (!hasFields) {
    return createProblemResponse(400, 'INVALID_STATE', 'invalid-state', 'Cannot submit form', 'Add and save at least one field to an active draft before submitting it for review.', requestId);
  }

  const newVersion = nextRevisionVersion();
  const result = await env.DB.prepare(`UPDATE form_revisions SET status='REVIEW',updated_at=? WHERE id=? AND workspace_id=? AND form_definition_id=? AND status='DRAFT' AND updated_at=? AND EXISTS (SELECT 1 FROM form_definitions d WHERE d.id=form_revisions.form_definition_id AND d.workspace_id=form_revisions.workspace_id AND d.status<>'ARCHIVED') AND ${staff}`).bind(newVersion,revision,workspace,id, expectedVersion,...who).run();
  if (result.meta.changes !== 1) {
    return Response.json({ error: 'Conflict', code: 'VERSION_CONFLICT', detail: 'The draft form revision was modified by another session.' }, { status: 409, headers: { 'X-Request-Id': requestId } });
  }
  return reply({success:true, updated_at: newVersion});
 }
 if (request.method === 'POST' && id && revision && action === 'approve') {
  if (member.role !== 'owner_admin' && member.role !== 'super_admin') return accessDeniedResponse('Only administrators may publish forms',requestId);
  const now = new Date().toISOString();
  const results = await env.DB.batch([
   env.DB.prepare(`UPDATE form_revisions SET status='PUBLISHED',updated_at=?,approved_at=?,approved_by=? WHERE id=? AND workspace_id=? AND form_definition_id=? AND status='REVIEW' AND EXISTS (SELECT 1 FROM form_definitions d WHERE d.id=form_revisions.form_definition_id AND d.workspace_id=form_revisions.workspace_id AND d.status<>'ARCHIVED') AND ${approver}`).bind(now,now,auth.userId,revision,workspace,id,...who),
   env.DB.prepare(`UPDATE form_definitions SET published_revision_id=?,status='ACTIVE',updated_at=? WHERE id=? AND workspace_id=? AND EXISTS (SELECT 1 FROM form_revisions WHERE id=? AND workspace_id=? AND form_definition_id=? AND status='PUBLISHED' AND approved_at=? AND approved_by=?) AND ${approver}`).bind(revision,now,id,workspace,revision,workspace,id,now,auth.userId,...who),
  ]);
  return results.every(r=>r.success && r.meta.changes===1) ? reply({success:true}) : fail();
 }
 return new Response('Method Not Allowed',{status:405});
}
