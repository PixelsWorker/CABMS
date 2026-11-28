import { validateFormAnswers } from '../../modules/forms/formAnswers.ts';
import { applicableFormAnswers } from '../../../contracts/applicableFormAnswers.ts';
﻿import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { approvedMembership } from '../privilegedApproval.ts';
import { complianceProblem, complianceStorageProblem } from '../../modules/compliance/problems.ts';

export const currentMembership = `EXISTS (
 SELECT 1 FROM workspace_memberships wm
 JOIN users u ON u.id=wm.user_id AND u.disabled=0
 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
 WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
 AND wm.role=? AND ${approvedMembership}
)`;

interface Job {
  id: string;
  workspace_id: string;
  job_type_id: string;
  policy_id: string;
  title: string;
  status: string;
  version: number;
  assignee_id: string | null;
  customer_name?: string | null;
  site_address?: string | null;
}

const keyPattern = /^[A-Za-z0-9_-]{1,128}$/;
const isKey = (value: unknown): value is string => typeof value === 'string' && keyPattern.test(value);

export async function fingerprint(value: unknown) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

/** Separate operational namespace, to preserve the existing demo /jobs route. */
export async function handleComplianceJobs(
  request: Request, env: Env, workspace: string, id: string | undefined,
  requestId: string, authentication: AuthenticationService,
): Promise<Response> {
  const respond = (data: unknown,status = 200) => Response.json(data,{status,headers:{'X-Request-Id':requestId}});
  const auth = await authentication.authenticateRequest(env.DB,request,env);
  if (!auth) return complianceProblem('AUTHENTICATION_REQUIRED',requestId);
  const member = await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if (!member) return complianceProblem('ACTION_DENIED',requestId);
  const schema = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='view' AND name='compliance_completion_blockers'").first();
  if (!schema) return complianceProblem('OPERATIONAL_STORAGE_NOT_READY',requestId);
  const who = [workspace,auth.userId,auth.providerSubjectId,member.role];
  const view=new URL(request.url).searchParams.get('view');

  if (!id && request.method==='GET' && view==='creation-options') {
    if (member.role==='technician') return complianceProblem('ACTION_DENIED',requestId);
    const rows=await env.DB.prepare(`SELECT t.id,t.name,p.id AS current_policy_version_id,
      (SELECT json_group_array(l.form_type ORDER BY l.display_order,l.id) FROM job_type_required_forms l
       LEFT JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=t.workspace_id
       WHERE l.policy_version_id=p.id AND l.required=1 AND m.legacy_rule_id IS NULL) AS missing
      FROM job_types t JOIN job_type_compliance_policies p ON p.id=t.current_policy_version_id AND p.job_type_id=t.id
      WHERE t.workspace_id=? AND t.status='ACTIVE' AND p.status='PUBLISHED' AND ${currentMembership}
      ORDER BY t.name,t.id`).bind(workspace,...who).all<{id:string;name:string;current_policy_version_id:string;missing:string}>();
    return respond(rows.results.map(({missing,...row})=>({...row,missing_mandatory_forms:JSON.parse(missing)})));
  }

  if (!id && request.method==='GET' && view==='technicians') {
    if (member.role==='technician') return complianceProblem('ACTION_DENIED',requestId);
    const rows=await env.DB.prepare(`SELECT u.id,u.display_name FROM workspace_memberships m
      JOIN users u ON m.user_id=u.id WHERE m.workspace_id=? AND m.role='technician'
      AND u.disabled=0 AND ${currentMembership} ORDER BY u.display_name,u.id`).bind(workspace,...who).all();
    return respond(rows.results);
  }

  if (id && request.method==='GET' && view==='form-options') {
    if (member.role==='technician') return complianceProblem('ACTION_DENIED',requestId);
    const rows=await env.DB.prepare(`SELECT r.id,d.title,r.version FROM compliance_jobs j
      JOIN job_types t ON t.id=j.job_type_id AND t.workspace_id=j.workspace_id
      JOIN form_definitions d ON d.workspace_id=j.workspace_id AND d.brand_id=t.brand_id AND d.status='ACTIVE'
      JOIN form_revisions r ON r.workspace_id=d.workspace_id AND r.form_definition_id=d.id AND r.status='PUBLISHED'
      WHERE j.workspace_id=? AND j.id=? AND j.status='OPEN' AND ${currentMembership} ORDER BY d.title,r.id`).bind(workspace,id,...who).all();
    return respond(rows.results);
  }

  const action=new URL(request.url).searchParams.get('operation');
  if (id && action) {
    if (member.role==='technician') return complianceProblem('ACTION_DENIED',requestId);
    if (!['ASSIGN','CANCEL','ADD'].includes(action)) return complianceProblem('INVALID_FIELD',requestId);
    const key=request.headers.get('Idempotency-Key');
    if (!isKey(key)) return complianceProblem('INVALID_FIELD',requestId);
    const op=await fingerprint([workspace,auth.userId,id,action,key]);
    const receipt=()=>env.DB.prepare(`SELECT o.fingerprint FROM compliance_operations o
      JOIN compliance_receipts r ON r.operation_id=o.id WHERE o.id=? AND ${currentMembership}`).bind(op,...who).first<{fingerprint:string}>();
    if (request.method==='GET') return await receipt()?respond({operation_id:op}):complianceProblem('RESOURCE_NOT_FOUND',requestId);
    if (request.method!=='POST') return new Response(null,{status:405});
    const match=/^"([1-9][0-9]*)"$/.exec(request.headers.get('If-Match')??'');
    if (!match) return complianceProblem('VERSION_REQUIRED',requestId);
    const version=Number(match[1]);
    const input=await request.json().catch(()=>null) as Record<string,unknown>|null;
    if (!Number.isSafeInteger(version)||!input||typeof input!=='object'||Array.isArray(input)) return complianceProblem('INVALID_FIELD',requestId);
    const fields=action==='ASSIGN'?['assignee_id']:action==='ADD'?['revision_id','occurrence_key','reason','required']:[];
    if (Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k))) return complianceProblem('INVALID_FIELD',requestId);
    if (action==='ASSIGN'&&input.assignee_id!==null&&!isKey(input.assignee_id)) return complianceProblem('INVALID_FIELD',requestId);
    if (action==='ADD'&&(!isKey(input.revision_id)||typeof input.occurrence_key!=='string'||!input.occurrence_key.trim()||input.occurrence_key.length>200||
      typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>1000||typeof input.required!=='boolean')) return complianceProblem('INVALID_FIELD',requestId);
    const digest=await fingerprint([version,...fields.map(k=>input[k])]);
    const reconcile=async()=>{
      const saved=await receipt();
      return saved?(saved.fingerprint===digest?respond({operation_id:op}):complianceProblem('IDEMPOTENCY_KEY_REUSED',requestId)):null;
    };
    try {
      const prior=await reconcile();
      if (prior) return prior;
      const job=await env.DB.prepare(`SELECT status,version FROM compliance_jobs WHERE workspace_id=? AND id=? AND ${currentMembership}`).bind(workspace,id,...who).first<Job>();
      if (!job) return complianceProblem('RESOURCE_NOT_FOUND',requestId);
      if (job.status!=='OPEN') return complianceProblem('JOB_STATE_CONFLICT',requestId);
      if (job.version!==version) return complianceProblem('VERSION_CONFLICT',requestId);
      const hasVisitEvents=action==='ASSIGN' && await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compliance_visit_events'").first();
      const assignmentGuard=hasVisitEvents?`AND NOT EXISTS (
        SELECT 1 FROM compliance_visit_events v WHERE v.workspace_id=? AND v.job_id=?
        AND v.status='SCHEDULED' AND v.technician_id IS NOT ?
        AND NOT EXISTS(SELECT 1 FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id AND h.version>v.version)
      )`:'';
      const write=action==='ADD'?env.DB.prepare(`INSERT INTO compliance_requirements(workspace_id,job_id,occurrence_key,revision_id,origin,required,reason,operation_id)
        VALUES(?,?,?,?,'ADDITIONAL',?,?,?)`).bind(workspace,id,input.occurrence_key,input.revision_id,Number(input.required),input.reason,op):
        env.DB.prepare(`UPDATE compliance_jobs SET operation_id=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        status=CASE WHEN ?='CANCEL' THEN 'CANCELLED' ELSE status END,assignee_id=CASE WHEN ?='ASSIGN' THEN ? ELSE assignee_id END
        WHERE workspace_id=? AND id=? AND EXISTS(SELECT 1 FROM compliance_operations WHERE compliance_operations.id=?)`).bind(op,action,action,input.assignee_id??null,workspace,id,op);
      const batchWrites=[env.DB.prepare(`INSERT INTO compliance_operations(id,workspace_id,actor_id,action,target_id,expected_version,fingerprint)
        SELECT ?,?,?,?,?,?,? WHERE ${currentMembership} ${assignmentGuard}`)
        .bind(op,workspace,auth.userId,action,id,version,digest,...who,...(hasVisitEvents?[workspace,id,input.assignee_id]:[])),write];
      if(action==='CANCEL'){
        const hasVisits=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compliance_visit_events'").first();
        if(hasVisits){
          batchWrites.push(env.DB.prepare(`INSERT INTO compliance_visit_events(workspace_id,visit_id,version,job_id,technician_id,starts_at,duration_minutes,status,reason,actor_id,operation_key)
            SELECT v.workspace_id,v.visit_id,v.version+1,v.job_id,v.technician_id,v.starts_at,v.duration_minutes,'CANCELLED','Job cancelled',?,? || ':' || v.visit_id
            FROM compliance_visit_events v
            WHERE v.workspace_id=? AND v.job_id=? AND v.status='SCHEDULED'
              AND v.version=(SELECT max(h.version) FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id)
              AND EXISTS(SELECT 1 FROM compliance_operations WHERE id=?)`)
            .bind(auth.userId,op,workspace,id,op));
        }
      }
      const [operation]=await env.DB.batch(batchWrites);
      if(hasVisitEvents && !operation.meta.changes) {
        const stillAuthorized=await env.DB.prepare(`SELECT 1 WHERE ${currentMembership}`).bind(...who).first();
        return complianceProblem(stillAuthorized?'SCHEDULED_VISIT_ASSIGNMENT_CONFLICT':'ACTION_DENIED',requestId);
      }
      return await reconcile()??complianceProblem('OPERATION_UNCONFIRMED',requestId);
    } catch(error) {
      try{return await reconcile()??complianceProblem(complianceStorageProblem(error),requestId);}
      catch{return complianceProblem('OPERATION_UNCONFIRMED',requestId);}
    }
  }

  if (id && request.method === 'PATCH') {
    const key = request.headers.get('Idempotency-Key');
    const match = /^"([1-9][0-9]*)"$/.exec(request.headers.get('If-Match') ?? '');
    if (!match) return complianceProblem('VERSION_REQUIRED',requestId);
    const version = Number(match[1]);
    let input: unknown;
    try { input = await request.json(); } catch { return complianceProblem('INVALID_FIELD',requestId); }
    if (!isKey(key) || !Number.isSafeInteger(version) || !input || typeof input !== 'object' || Array.isArray(input)) {
      return complianceProblem('INVALID_FIELD',requestId);
    }
    if (Object.keys(input).some(k=>!['occurrence_key','expected_answer_version','answers'].includes(k))) return complianceProblem('INVALID_FIELD',requestId);
    const {occurrence_key, expected_answer_version, answers} = input as Record<string,unknown>;
    if (typeof occurrence_key !== 'string' || !occurrence_key.trim() || occurrence_key.length > 200 ||
      typeof expected_answer_version !== 'number' || !Number.isSafeInteger(expected_answer_version) || expected_answer_version < 0 ||
      !answers || typeof answers !== 'object' || Array.isArray(answers)) return complianceProblem('INVALID_FIELD',requestId);
    const serialized = JSON.stringify(answers);
    if (new TextEncoder().encode(serialized).length > 65536) return complianceProblem('INVALID_FIELD',requestId);
    const job = await env.DB.prepare(`SELECT j.version,j.status,q.revision_id FROM compliance_jobs j JOIN compliance_active_requirements q
      ON q.workspace_id=j.workspace_id AND q.job_id=j.id WHERE j.workspace_id=? AND j.id=? AND q.occurrence_key=?
      AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}`)
      .bind(workspace,id,occurrence_key,member.role,auth.userId,...who).first<{version:number;status:string;revision_id:string}>();
    if (!job) return complianceProblem('RESOURCE_NOT_FOUND',requestId);
    const operationId = await fingerprint([workspace,auth.userId,'SAVE',key]);
    const digest = await fingerprint([id,occurrence_key,version,expected_answer_version,serialized]);
    const next = expected_answer_version+1;
    const currentAnswerVersion = () => env.DB.prepare(`SELECT coalesce(max(a.version),0) AS version
      FROM compliance_jobs j LEFT JOIN compliance_answers a ON a.workspace_id=j.workspace_id AND a.job_id=j.id AND a.occurrence_key=?
      WHERE j.workspace_id=? AND j.id=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership} GROUP BY j.id`)
      .bind(occurrence_key,workspace,id,member.role,auth.userId,...who).first<number>('version');
    const reconcile = async () => {
      const prior = await env.DB.prepare(`SELECT o.fingerprint,a.version FROM compliance_operations o
        JOIN compliance_receipts r ON r.operation_id=o.id
        JOIN compliance_answers a ON a.operation_id=o.id
        WHERE o.id=? AND o.workspace_id=? AND o.actor_id=? AND ${currentMembership}`)
        .bind(operationId,workspace,auth.userId,...who).first<{fingerprint:string;version:number}>();
      if (!prior) return null;
      return prior.fingerprint === digest ? respond({answer_version:prior.version,operation_id:operationId})
        : complianceProblem('IDEMPOTENCY_KEY_REUSED',requestId);
    };
    try {
      const prior = await reconcile();
      if (prior) return prior;
      if (job.status !== 'OPEN') return complianceProblem('JOB_STATE_CONFLICT',requestId);
      if (job.version !== version) return complianceProblem('VERSION_CONFLICT',requestId);
      if (await currentAnswerVersion() !== expected_answer_version) return complianceProblem('VERSION_CONFLICT',requestId);
      type Field = Parameters<typeof validateFormAnswers>[0][number] & {autofill_source?: string};
      const schemaRows = await env.DB.prepare(`SELECT f.field_key AS key,f.field_type AS type,f.required,f.choices_json,f.validation_json,f.visible_when_json,f.autofill_source
        FROM form_fields f JOIN form_sections s ON s.id=f.section_id AND s.workspace_id=f.workspace_id
        WHERE s.workspace_id=? AND s.revision_id=? ORDER BY s.display_order,f.display_order,f.id`)
        .bind(workspace,job.revision_id).all<{key:string;type:string;required:number;choices_json:string;validation_json:string;visible_when_json:string|null;autofill_source:string|null}>();
      const supplied = answers as Record<string,unknown>;
      const fields: Field[] = schemaRows.results.map(row => ({
        key:row.key,type:row.type,required:!!row.required,choices:JSON.parse(row.choices_json),
        validation:JSON.parse(row.validation_json),visible_when:row.visible_when_json ? JSON.parse(row.visible_when_json) : undefined,
        autofill_source: row.autofill_source || undefined,
      }));
      if (fields.some(f => ['PHOTO','FILE','SIGNATURE','READONLY_AUTOFILL'].includes(f.type) && Object.hasOwn(supplied,f.key)) ||
        validateFormAnswers(fields,supplied).some(error => !/:( required| signature required| evidence required)$/.test(error))) {
        return complianceProblem('INVALID_FIELD',requestId);
      }

      const { answers: visibleSupplied, applicable } = applicableFormAnswers(fields, supplied);
      const autofillFields = applicable.filter(f => f.type === 'READONLY_AUTOFILL' && f.autofill_source);
      const trustedAutofill: Record<string, string> = {};
      if (autofillFields.length > 0) {
        const jobRecord = await env.DB.prepare(`
          SELECT j.id AS job_id, j.title AS job_title, j.customer_name, j.site_address,
                 w.name AS business_name, u.display_name AS tech_name, u.email AS tech_email
          FROM compliance_jobs j
          JOIN workspaces w ON w.id = j.workspace_id
          LEFT JOIN users u ON u.id = j.assignee_id
          WHERE j.workspace_id = ? AND j.id = ?
        `).bind(workspace, id).first<{
          job_id: string;
          job_title: string;
          customer_name: string;
          site_address: string;
          business_name: string | null;
          tech_name: string | null;
          tech_email: string | null;
        }>();

        for (const f of autofillFields) {
          let val: string | null = null;
          if (jobRecord) {
            switch (f.autofill_source) {
              case 'job.id': val = jobRecord.job_id || null; break;
              case 'job.title': val = jobRecord.job_title || null; break;
              case 'customer.name': val = jobRecord.customer_name || null; break;
              case 'site.address': val = jobRecord.site_address || null; break;
              case 'business.name': val = jobRecord.business_name || null; break;
              case 'technician.name': val = jobRecord.tech_name || jobRecord.tech_email || null; break;
            }
          }
          if (val !== null && val !== undefined && val.trim().length > 0) {
            trustedAutofill[f.key] = val;
          }
        }
      }
      const resolvedAnswers = { ...visibleSupplied, ...trustedAutofill };

      let carryWrites: any[] = [];
      if (expected_answer_version > 0) {
        const carryForwardTrigger = await env.DB.prepare(
          "SELECT sql FROM sqlite_master WHERE type='trigger' AND name='compliance_evidence_guard'"
        ).first<{ sql: string | null }>();
        if (carryForwardTrigger?.sql?.includes('DISTINCT')) {
          const priorEv = await env.DB.prepare(`SELECT e.id,e.byte_length,e.digest,e.storage_key,coalesce(u.media_type,'image/jpeg') AS media_type
            FROM compliance_evidence e
            LEFT JOIN compliance_uploads u ON u.id=e.id AND u.workspace_id=e.workspace_id AND u.job_id=e.job_id AND u.occurrence_key=e.occurrence_key
            JOIN compliance_receipts r ON r.operation_id=e.operation_id
            WHERE e.workspace_id=? AND e.job_id=? AND e.occurrence_key=? AND e.answer_version=?`)
            .bind(workspace,id,occurrence_key,expected_answer_version).all<{id:string;byte_length:number;digest:string;storage_key:string;media_type:string}>();
          for (const pe of priorEv.results) {
            const newEvId = crypto.randomUUID();
            carryWrites.push(
              env.DB.prepare(`INSERT INTO compliance_uploads(id,workspace_id,job_id,occurrence_key,actor_id,job_version,answer_version,media_type,byte_length,digest)
                VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(newEvId,workspace,id,occurrence_key,auth.userId,version,next,pe.media_type,pe.byte_length,pe.digest),
              env.DB.prepare(`INSERT INTO compliance_operations(id,workspace_id,actor_id,action,target_id,expected_version,fingerprint)
                VALUES(?,?,?,'EVIDENCE',?,?,?)`).bind(newEvId,workspace,auth.userId,id,version,pe.digest),
              env.DB.prepare('INSERT INTO compliance_evidence VALUES(?,?,?,?,?,?,?,?,?)').bind(newEvId,workspace,id,occurrence_key,next,pe.byte_length,pe.digest,pe.storage_key,newEvId)
            );
          }
        }
      }

      const saveBatch = [
        env.DB.prepare(`INSERT INTO compliance_operations(id,workspace_id,actor_id,action,target_id,expected_version,fingerprint)
          SELECT ?,?,?,'SAVE',?,?,? WHERE ${currentMembership}`).bind(operationId,workspace,auth.userId,id,version,digest,...who),
        env.DB.prepare('INSERT INTO compliance_answers(workspace_id,job_id,occurrence_key,version,answers_json,operation_id) VALUES(?,?,?,?,?,?)')
          .bind(workspace,id,occurrence_key,next,JSON.stringify(resolvedAnswers),operationId),
      ];
      if (carryWrites.length > 0) {
        await env.DB.batch([...saveBatch, ...carryWrites]);
      } else {
        await env.DB.batch(saveBatch);
      }
      return await reconcile() ?? complianceProblem('OPERATION_UNCONFIRMED',requestId);
    } catch (error) {
      try {
        const prior = await reconcile();
        if (prior) return prior;
        const savedVersion = await currentAnswerVersion();
        if (savedVersion !== null && savedVersion > expected_answer_version) return complianceProblem('VERSION_CONFLICT',requestId);
        const code = complianceStorageProblem(error);
        // An existing immutable answer version is a stale edit at this endpoint.
        return complianceProblem(code === 'HISTORY_IMMUTABLE' ? 'VERSION_CONFLICT' : code,requestId);
      } catch {
        return complianceProblem('OPERATION_UNCONFIRMED',requestId);
      }
    }
  }

  if (request.method === 'GET') {
    const hasSnapshot=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_job_site_snapshot_create'").first();
    const hasVisits=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_visit_events_no_update'").first();
    const scheduled=hasVisits?`EXISTS(SELECT 1 FROM compliance_visit_events v WHERE v.workspace_id=compliance_jobs.workspace_id AND v.job_id=compliance_jobs.id
      AND v.status='SCHEDULED' AND NOT EXISTS(SELECT 1 FROM compliance_visit_events later WHERE later.workspace_id=v.workspace_id AND later.visit_id=v.visit_id AND later.version>v.version))`:'NULL';
    const jobs = await env.DB.prepare(`SELECT id,workspace_id,job_type_id,policy_id,title,status,version,assignee_id,
      ${hasSnapshot?'customer_name,site_address':'NULL AS customer_name,NULL AS site_address'},
      EXISTS(SELECT 1 FROM compliance_answers a WHERE a.workspace_id=compliance_jobs.workspace_id AND a.job_id=compliance_jobs.id) AS started,
      ${scheduled} AS scheduled,
      (SELECT display_name FROM users WHERE users.id=compliance_jobs.assignee_id) AS technician,
      (SELECT max_bytes FROM compliance_photo_limits WHERE workspace_id=compliance_jobs.workspace_id) AS photo_cap,
      (SELECT count(DISTINCT storage_key) FROM compliance_evidence WHERE workspace_id=compliance_jobs.workspace_id AND job_id=compliance_jobs.id) AS photo_count
      FROM compliance_jobs WHERE workspace_id=? AND (? IS NULL OR id=?)
      AND (?<>'technician' OR assignee_id=?) AND ${currentMembership} AND id>?
      ORDER BY id LIMIT 101`).bind(workspace,id??null,id??null,member.role,auth.userId,...who,id?'':new URL(request.url).searchParams.get('after')??'').all<Job>();
    if (!id) return respond({jobs:jobs.results.slice(0,100),after:jobs.results.length>100?jobs.results[99].id:null});
    if (!jobs.results[0]) return complianceProblem('RESOURCE_NOT_FOUND',requestId);
    const requirements = await env.DB.prepare(`SELECT q.occurrence_key,q.revision_id,q.origin,q.required,d.title,
      coalesce(a.version,0) AS answer_version,a.answers_json,s.digest AS signed_digest,
      EXISTS(SELECT 1 FROM compliance_signoffs signed WHERE signed.workspace_id=q.workspace_id AND signed.job_id=q.job_id
        AND signed.occurrence_key=q.occurrence_key) AS has_signed_history,
      wr.reason AS withdrawal_reason,
      (SELECT json_group_array(json_object('id',f.id,'reason',f.reason,'resolution',resolution.reason) ORDER BY f.id)
       FROM compliance_findings f LEFT JOIN compliance_resolutions resolution ON resolution.finding_id=f.id
       WHERE f.workspace_id=q.workspace_id AND f.job_id=q.job_id AND f.occurrence_key=q.occurrence_key) AS findings_json,
      EXISTS(SELECT 1 FROM compliance_signer_grants g WHERE g.workspace_id=q.workspace_id AND g.revision_id=q.revision_id AND g.user_id=?) AS may_sign,
      (SELECT json_group_array(json_object('key',f.field_key,'label',f.label,'type',f.field_type,'required',f.required,
        'choices',json(f.choices_json),'visible_when',json(f.visible_when_json),'validation',json(f.validation_json)) ORDER BY sec.display_order,f.display_order,f.id)
       FROM form_sections sec JOIN form_fields f ON f.section_id=sec.id AND f.workspace_id=sec.workspace_id
       WHERE sec.workspace_id=q.workspace_id AND sec.revision_id=q.revision_id) AS fields_json,
      (SELECT json_group_array(json_object('id',e.id,'bytes',e.byte_length) ORDER BY e.id) FROM compliance_evidence e JOIN compliance_receipts r ON r.operation_id=e.operation_id
       WHERE e.workspace_id=q.workspace_id AND e.job_id=q.job_id AND e.occurrence_key=q.occurrence_key AND e.answer_version=a.version) AS photos_json
      FROM compliance_active_requirements q JOIN compliance_jobs j ON j.workspace_id=q.workspace_id AND j.id=q.job_id
      JOIN form_revisions rev ON rev.workspace_id=q.workspace_id AND rev.id=q.revision_id
      JOIN form_definitions d ON d.id=rev.form_definition_id AND d.workspace_id=q.workspace_id
      LEFT JOIN compliance_withdraw_requests wr ON wr.workspace_id=q.workspace_id AND wr.job_id=q.job_id AND wr.occurrence_key=q.occurrence_key
      LEFT JOIN compliance_answers a ON a.workspace_id=q.workspace_id AND a.job_id=q.job_id AND a.occurrence_key=q.occurrence_key AND a.version=(
        SELECT max(v.version) FROM compliance_answers v WHERE v.workspace_id=q.workspace_id AND v.job_id=q.job_id AND v.occurrence_key=q.occurrence_key)
      LEFT JOIN compliance_signoffs s ON s.workspace_id=q.workspace_id AND s.job_id=q.job_id AND s.occurrence_key=q.occurrence_key AND s.answer_version=a.version
      WHERE q.workspace_id=? AND q.job_id=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}
      ORDER BY q.occurrence_key`).bind(auth.userId,workspace,id,member.role,auth.userId,...who).all<{fields_json:string;answers_json:string|null;photos_json:string;findings_json:string}>();
    const history=await env.DB.prepare(`SELECT o.id AS operation_id,o.action,u.display_name AS actor,r.occurred_at
      FROM compliance_operations o JOIN compliance_receipts r ON r.operation_id=o.id
      JOIN compliance_jobs j ON j.workspace_id=o.workspace_id AND j.id=o.target_id JOIN users u ON u.id=o.actor_id
      WHERE j.workspace_id=? AND j.id=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}
      ORDER BY r.occurred_at,o.id`).bind(workspace,id,member.role,auth.userId,...who).all();
    const visitHistory=hasVisits?await env.DB.prepare(`SELECT v.visit_id,v.version,v.status,v.starts_at,v.duration_minutes,v.reason,
      v.occurred_at,actor.display_name AS actor,tech.display_name AS technician
      FROM compliance_visit_events v JOIN compliance_jobs j ON j.workspace_id=v.workspace_id AND j.id=v.job_id
      JOIN users actor ON actor.id=v.actor_id JOIN users tech ON tech.id=v.technician_id
      WHERE v.workspace_id=? AND v.job_id=? AND (?<>'technician' OR (j.assignee_id=? AND v.technician_id=?)) AND ${currentMembership}
      ORDER BY v.occurred_at,v.visit_id,v.version`).bind(workspace,id,member.role,auth.userId,auth.userId,...who).all():null;
    return respond({job: jobs.results[0],history:history.results,visit_history:visitHistory?.results??[],
      requirements:requirements.results.map(({fields_json,answers_json,photos_json,findings_json,...row})=>{
        const fields=JSON.parse(fields_json);
        const saved=JSON.parse(answers_json??'{}');
        const {answers}=applicableFormAnswers(fields,saved);
        return {...row,fields,answers,needs_answer_review:Object.keys(saved).length!==Object.keys(answers).length,
          photos:JSON.parse(photos_json),findings:JSON.parse(findings_json)};
      })});
  }
  if (request.method !== 'POST' || id) return new Response('Method Not Allowed',{status:405});
  if (member.role === 'technician') return complianceProblem('ACTION_DENIED',requestId);

  const key = request.headers.get('Idempotency-Key');
  let value: unknown;
  try { value = await request.json(); } catch { return complianceProblem('INVALID_FIELD',requestId); }
  if (!isKey(key) || !value || typeof value !== 'object' || Array.isArray(value)) return complianceProblem('INVALID_FIELD',requestId);
  const { job_type_id, expected_policy_id, title, assignee_id = null, customer_name, site_address } = value as Record<string,unknown>;
  const hasSnapshot=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_job_site_snapshot_create'").first();
  const validText=(input:unknown,max:number):input is string=>typeof input==='string'&&input.trim().length>0&&input.trim().length<=max;
  if (!isKey(job_type_id) || !isKey(expected_policy_id) || (assignee_id !== null && !isKey(assignee_id))
    || !validText(title,500)) return complianceProblem('INVALID_FIELD',requestId);
  let snapshot:string[]=[];
  if (customer_name!==undefined || site_address!==undefined) {
    if (!validText(customer_name,200)||!validText(site_address,500)) return complianceProblem('INVALID_FIELD',requestId);
    if (!hasSnapshot) return complianceProblem('OPERATIONAL_STORAGE_NOT_READY',requestId);
    snapshot=[customer_name.trim(),site_address.trim()];
  }

  const operationId = await fingerprint([workspace,auth.userId,'CREATE',key]);
  const digest = await fingerprint([job_type_id,expected_policy_id,title.trim(),assignee_id,...snapshot]);
  const jobId = crypto.randomUUID();
  const reconcile = async () => {
    const prior = await env.DB.prepare(`SELECT o.fingerprint,r.operation_id,o.target_id FROM compliance_operations o
      LEFT JOIN compliance_receipts r ON r.operation_id=o.id
      WHERE o.id=? AND o.workspace_id=? AND o.actor_id=? AND ${currentMembership}`)
      .bind(operationId,workspace,auth.userId,...who).first<{fingerprint:string;operation_id:string|null;target_id:string}>();
    if (!prior) return null;
    if (prior.fingerprint !== digest) return complianceProblem('IDEMPOTENCY_KEY_REUSED',requestId);
    if (!prior.operation_id) return complianceProblem('OPERATION_UNCONFIRMED',requestId);
    return respond({job_id:prior.target_id, operation_id:prior.operation_id},201);
  };

  try {
    const prior = await reconcile();
    if (prior) return prior;
    if (hasSnapshot && !snapshot.length) return complianceProblem('INVALID_FIELD',requestId);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO compliance_operations(id,workspace_id,actor_id,action,target_id,expected_version,fingerprint)
        SELECT ?,?,?,'CREATE',?,0,? WHERE ${currentMembership}`)
        .bind(operationId,workspace,auth.userId,jobId,digest,...who),
      env.DB.prepare(`INSERT INTO compliance_jobs(id,workspace_id,job_type_id,policy_id,title,assignee_id,operation_id${hasSnapshot?',customer_name,site_address':''})
        VALUES(?,?,?,?,?,?,?${hasSnapshot?',?,?':''})`).bind(jobId,workspace,job_type_id,expected_policy_id,title.trim(),assignee_id,operationId,...snapshot),
    ]);
    return await reconcile() ?? complianceProblem('OPERATION_UNCONFIRMED',requestId);
  } catch (error) {
    try {
      return await reconcile() ?? complianceProblem(complianceStorageProblem(error),requestId);
    } catch {
      return complianceProblem('OPERATION_UNCONFIRMED',requestId);
    }
  }
}
