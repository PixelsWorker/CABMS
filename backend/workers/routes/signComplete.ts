import type {Env} from '../../types.ts';
import {authorizeWorkspaceAccess,type AuthenticationService} from '../auth.ts';
import {validateFormAnswers} from '../../modules/forms/formAnswers.ts';
import {applicableFormAnswers} from '../../../contracts/applicableFormAnswers.ts';
import {photoDigest} from '../../modules/compliance/photoEvidence.ts';
import {complianceProblem} from '../../modules/compliance/problems.ts';
import {currentMembership} from './complianceJobs.ts';

const intent='I confirm the saved answers and linked evidence for this form occurrence.';
const revision='cabms-form-attestation-v1';
type Blocker={code:string;occurrence_key?:string;field?:string;evidence_id?:string};
type Field=Parameters<typeof validateFormAnswers>[0][number] & {autofill_source?:string};
type Evidence={id:string;sha256:string;byte_length:number;media_type:string};
function canonical(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value!==null && typeof value==='object'){
    const record=value as Record<string,unknown>;
    return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k])).join(',')+'}';
  }
  return JSON.stringify(value);
}
const hash=(value:unknown)=>photoDigest(new TextEncoder().encode(canonical(value)));
function failedAnswer(field:Field,value:unknown):boolean {
  if(['PASS_FAIL','PASS_FAIL_NA'].includes(field.type))return value==='FAIL';
  return field.type==='REPEATABLE_TABLE' && Array.isArray(value) && value.some(row=>
    row && field.validation?.columns?.some(column=>failedAnswer(column,row[column.key])));
}
async function verifyEvidence(env:Env,workspace:string,job:string,slot:string,version:number,blockers:Blocker[]){
  const rows=await env.DB.prepare(`SELECT e.id,e.digest AS sha256,e.byte_length,e.storage_key,u.media_type,u.digest AS staged_digest,
    a.actor_id AS finalized_by,u.actor_id AS staged_by FROM compliance_evidence e
    LEFT JOIN compliance_uploads u ON u.id=e.id AND u.workspace_id=e.workspace_id AND u.job_id=e.job_id AND u.occurrence_key=e.occurrence_key AND u.answer_version=e.answer_version
    LEFT JOIN compliance_audit a ON a.id=e.operation_id AND a.action='EVIDENCE' AND a.workspace_id=e.workspace_id AND a.target_id=e.job_id
    WHERE e.workspace_id=? AND e.job_id=? AND e.occurrence_key=? AND e.answer_version=? ORDER BY e.id`)
    .bind(workspace,job,slot,version).all<Evidence & {storage_key:string;staged_digest:string;finalized_by:string;staged_by:string}>();
  const verified:Evidence[]=[];
  for(const row of rows.results){
    let contentHash:string|null=null;
    try {
      const object=await env.PRIVATE_EVIDENCE?.get(row.storage_key);
      if(object && object.size===row.byte_length)contentHash=await photoDigest(new Uint8Array(await object.arrayBuffer()));
    } catch {
      blockers.push({code:'EVIDENCE_UNAVAILABLE',occurrence_key:slot,evidence_id:row.id});
      continue;
    }
    if(contentHash!==row.sha256 || row.sha256!==row.staged_digest || !row.staged_by || row.finalized_by!==row.staged_by){
      blockers.push({code:'EVIDENCE_INVALID',occurrence_key:slot,evidence_id:row.id});
    }else verified.push({id:row.id,sha256:row.sha256,byte_length:row.byte_length,media_type:row.media_type});
  }
  return verified;
}
async function fieldsFor(env:Env,workspace:string,form:string):Promise<Field[]>{
  const {results}=await env.DB.prepare(`SELECT f.field_key,f.field_type,f.required,f.choices_json,f.validation_json,f.visible_when_json,f.autofill_source FROM form_fields f
    JOIN form_sections s ON s.id=f.section_id AND s.workspace_id=f.workspace_id WHERE s.workspace_id=? AND s.revision_id=? ORDER BY s.display_order,f.display_order,f.id`)
    .bind(workspace,form).all<{field_key:string;field_type:string;required:number;choices_json:string;validation_json:string;visible_when_json:string|null;autofill_source:string|null}>();
  return results.map(f=>({key:f.field_key,type:f.field_type,required:!!f.required,choices:JSON.parse(f.choices_json),
    validation:JSON.parse(f.validation_json),visible_when:f.visible_when_json?JSON.parse(f.visible_when_json):undefined,autofill_source:f.autofill_source||undefined}));
}

export async function handleSignComplete(request:Request,env:Env,authService:AuthenticationService,requestId:string,match:RegExpExecArray){
  const [,workspace,job,encoded]=match;
  const slot=encoded?decodeURIComponent(encoded):null;
  const action=slot?'SIGN':'COMPLETE';
  const fail=(code:Parameters<typeof complianceProblem>[0])=>complianceProblem(code,requestId);
  const blocked=(blockers:Blocker[])=>Response.json({code:slot?'SIGNOFF_BLOCKED':'COMPLETION_BLOCKED',blockers,request_id:requestId},{status:409,headers:{'X-Request-Id':requestId,'Content-Type':'application/problem+json'}});
  const auth=await authService.authenticateRequest(env.DB,request,env);
  if(!auth)return fail('AUTHENTICATION_REQUIRED');
  const member=await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if(!member || (!slot && member.role==='technician'))return fail('ACTION_DENIED');
  const who=[workspace,auth.userId,auth.providerSubjectId,member.role];
  const scope=[workspace,job];
  const access=`FROM compliance_jobs j WHERE j.workspace_id=? AND j.id=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}`;
  const args=[...scope,member.role,auth.userId,...who];
  const epoch="(SELECT count(*) FROM compliance_audit a WHERE a.workspace_id=j.workspace_id AND a.target_id=j.id)";
  const read=()=>env.DB.prepare(`SELECT j.version,j.status,j.policy_id,${epoch} AS epoch,
    (SELECT is_direct_to_invoice FROM job_type_compliance_policies WHERE id=j.policy_id AND job_type_id=j.job_type_id) AS invoice
    ${access}`).bind(...args).first<{version:number;status:string;policy_id:string;epoch:number;invoice:number|null}>();
  const state=await read();
  if(!state)return fail('RESOURCE_NOT_FOUND');
  const key=request.headers.get('Idempotency-Key');
  if(!key || !/^[\w-]{1,128}$/.test(key))return fail('INVALID_FIELD');
  const op=await hash([workspace,job,slot,auth.userId,action,key]);
  const prior=()=>env.DB.prepare(`SELECT o.fingerprint,o.expected_version,s.digest FROM compliance_audit o LEFT JOIN compliance_signoffs s ON s.operation_id=o.id
    WHERE o.id=? AND o.workspace_id=? AND o.target_id=? AND o.actor_id=? AND EXISTS(SELECT 1 ${access})`)
    .bind(op,...scope,auth.userId,...args).first<{fingerprint:string;expected_version:number;digest:string|null}>();
  const receipt=(p:{expected_version:number;digest:string|null})=>Response.json({operation_id:op,job_id:job,...(slot?{occurrence_key:slot,digest:p.digest}:{status:'COMPLETED',job_version:p.expected_version+1})});
  if(request.method==='GET'){const p=await prior();return p?receipt(p):fail('RESOURCE_NOT_FOUND');}
  if(request.method!=='POST')return new Response(null,{status:405});
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  const allowed=slot?['expected_job_version','answer_version','intent_version','evidence_by_field']:['expected_job_version'];
  if(!body || Array.isArray(body) || typeof body!=='object' || Object.keys(body).some(k=>!allowed.includes(k)) ||
     !Number.isSafeInteger(body.expected_job_version) || (slot && (!Number.isSafeInteger(body.answer_version) || body.intent_version!==revision)))return fail('INVALID_FIELD');
  const fingerprint=await hash(body);
  const replay=async()=>{const p=await prior();return p?(p.fingerprint===fingerprint?receipt(p):fail('IDEMPOTENCY_KEY_REUSED')):null;};
  const saved=await replay();
  if(saved)return saved;
  if(state.status!=='OPEN')return blocked([{code:'JOB_'+state.status}]);
  if(state.version!==body.expected_job_version)return fail('VERSION_CONFLICT');
  const blockers:Blocker[]=[];
  const grant='EXISTS(SELECT 1 FROM compliance_signer_grants WHERE workspace_id=? AND revision_id=? AND user_id=?)';
  const gate=await env.DB.prepare('SELECT occurrence_key,code FROM compliance_completion_blockers WHERE workspace_id=? AND job_id=?').bind(...scope).all<Blocker>();
  const rows=await env.DB.prepare(`SELECT q.occurrence_key,q.revision_id,q.required,a.version,a.answers_json,s.digest,s.snapshot_json,
    o.actor_id AS signer FROM compliance_active_requirements q LEFT JOIN compliance_answers a
    ON a.workspace_id=q.workspace_id AND a.job_id=q.job_id AND a.occurrence_key=q.occurrence_key AND a.version=(SELECT max(b.version) FROM compliance_answers b WHERE b.workspace_id=q.workspace_id AND b.job_id=q.job_id AND b.occurrence_key=q.occurrence_key)
    LEFT JOIN compliance_signoffs s ON s.workspace_id=q.workspace_id AND s.job_id=q.job_id AND s.occurrence_key=q.occurrence_key AND s.answer_version=a.version
    LEFT JOIN compliance_audit o ON o.id=s.operation_id AND o.action='SIGN'
    WHERE q.workspace_id=? AND q.job_id=? AND (? IS NULL OR q.occurrence_key=?) ORDER BY q.occurrence_key`)
    .bind(...scope,slot,slot).all<{occurrence_key:string;revision_id:string;required:number;version:number|null;answers_json:string|null;digest:string|null;snapshot_json:string|null;signer:string|null}>();
  const writes=[];
  let form='';
  if(slot){
    const row=rows.results[0];
    if(!row)return fail('RESOURCE_NOT_FOUND');
    form=row.revision_id;
    if(!await env.DB.prepare('SELECT 1 WHERE '+grant).bind(workspace,form,auth.userId).first())return fail('ACTION_DENIED');
    const token=request.headers.get('Authorization')!.slice(7);
    const identity=await authService.decodeAndValidateToken(token,env);
    if(!identity || Date.now()/1000-identity.authTime>300)return blocked([{code:'RECENT_SIGN_IN_REQUIRED',occurrence_key:slot}]);
    if(row.version===null)return blocked([{code:'ANSWERS_REQUIRED',occurrence_key:slot}]);
    if(row.version!==body.answer_version)return fail('VERSION_CONFLICT');
    if(row.digest)return blocked([{code:'ALREADY_SIGNED',occurrence_key:slot}]);
    blockers.push(...gate.results.filter(b=>b.occurrence_key===slot && b.code==='UNRESOLVED_FINDING'));
    const fields=await fieldsFor(env,workspace,form);
    const saved=JSON.parse(row.answers_json!);
    const {answers,applicable}=applicableFormAnswers(fields,saved);
    if(canonical(saved)!==canonical(answers))blockers.push({code:'ANSWER_REVIEW_REQUIRED',occurrence_key:slot});
    const evidence=await verifyEvidence(env,workspace,job,slot,row.version!,blockers);
    const autofillFields = applicable.filter(f => f.type === 'READONLY_AUTOFILL');
    const trustedAutofill: Record<string, string> = {};
    if (autofillFields.length > 0) {
      const jobRecord = await env.DB.prepare(`
        SELECT j.id AS job_id, j.title AS job_title, j.customer_name, j.site_address,
               w.name AS business_name, u.display_name AS tech_name, u.email AS tech_email
        FROM compliance_jobs j
        JOIN workspaces w ON w.id = j.workspace_id
        LEFT JOIN users u ON u.id = j.assignee_id
        WHERE j.workspace_id = ? AND j.id = ?
      `).bind(workspace, job).first<{
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
        } else if (f.required) {
          blockers.push({ code: 'AUTOFILL_UNAVAILABLE', occurrence_key: slot, field: f.key });
        }
      }
    }
    for(const field of fields){
      if(['PHOTO','FILE','SIGNATURE'].includes(field.type) && Object.hasOwn(answers,field.key)){
        blockers.push({code:'UNVERIFIED_ANSWER',occurrence_key:slot,field:field.key});
      }
      if(field.type === 'READONLY_AUTOFILL' && Object.hasOwn(answers,field.key) && answers[field.key] !== trustedAutofill[field.key]){
        blockers.push({code:'UNVERIFIED_ANSWER',occurrence_key:slot,field:field.key});
      }
    }
    const effectiveAnswers = { ...answers, ...trustedAutofill };
    const links=body.evidence_by_field??{};
    if(typeof links!=='object'||Array.isArray(links))return fail('INVALID_FIELD');
    const used=new Set<string>(),verifiedFields:string[]=[];
    for(const [field,ids] of Object.entries(links)){
      const definition=applicable.find(f=>f.key===field && ['PHOTO','FILE'].includes(f.type));
      if(!definition ||
        !Array.isArray(ids) || !ids.length || ids.some(id=>typeof id!=='string'||used.has(id)||!evidence.some(e=>e.id===id)) || new Set(ids).size!==ids.length){
        blockers.push({code:'EVIDENCE_REFERENCE_INVALID',occurrence_key:slot,field});continue;
      }
      ids.forEach(id=>used.add(id));verifiedFields.push(field);
    }
    const signatureFields=applicable.filter(f=>f.type==='SIGNATURE');
    if(signatureFields.length>1)blockers.push({code:'MULTIPLE_SIGNERS_UNCONFIGURED',occurrence_key:slot});
    for(const error of validateFormAnswers(fields,effectiveAnswers,{verifiedEvidence:verifiedFields,verifiedSignatures:signatureFields.map(f=>f.key)})){
      blockers.push({code:error.endsWith('evidence required')?'EVIDENCE_REQUIRED':'ANSWER_INVALID',field:error.split(':')[0],occurrence_key:slot});
    }
    for(const f of applicable)if(failedAnswer(f,effectiveAnswers[f.key]))blockers.push({code:'FAILED_ANSWER',field:f.key,occurrence_key:slot});
    if(blockers.length)return blocked(blockers);
    const signedAt=await env.DB.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS utc").first<string>('utc');
    const snapshot={schema_version:1,workspace_id:workspace,job_id:job,occurrence_key:slot,policy_id:state.policy_id,form_revision_id:form,
      job_version:state.version,answer_version:row.version,answers:effectiveAnswers,evidence,evidence_by_field:links,signer:auth.userId,provider_subject:auth.providerSubjectId,
      auth_time:identity.authTime,intent_version:revision,intent,signed_at:signedAt};
    writes.push(env.DB.prepare('INSERT INTO compliance_signoffs VALUES(?,?,?,?,?,?,?)').bind(...scope,slot,row.version,canonical(snapshot),await hash(snapshot),op));
  }else{
    blockers.push(...gate.results);
    if(state.invoice===null)blockers.push({code:'POLICY_UNAVAILABLE'});
    if(!state.invoice && !rows.results.some(r=>r.required))blockers.push({code:'EMPTY_POLICY'});
    for(const row of rows.results.filter(r=>r.required && !r.digest)){
      if(row.version===null){blockers.push({code:'ANSWERS_REQUIRED',occurrence_key:row.occurrence_key});continue;}
      const fields=await fieldsFor(env,workspace,row.revision_id);
      const {answers,applicable}=applicableFormAnswers(fields,JSON.parse(row.answers_json!));
      const evidence=await verifyEvidence(env,workspace,job,row.occurrence_key,row.version,blockers);
      for(const field of applicable){
        if(!evidence.length && field.required && ['PHOTO','FILE'].includes(field.type)){
          blockers.push({code:'EVIDENCE_REQUIRED',occurrence_key:row.occurrence_key,field:field.key});
        }
        if(failedAnswer(field,answers[field.key]))blockers.push({code:'FAILED_ANSWER',occurrence_key:row.occurrence_key,field:field.key});
      }
    }
    for(const row of rows.results.filter(r=>r.required && r.digest)){
      const evidence=await verifyEvidence(env,workspace,job,row.occurrence_key,row.version!,blockers);
      const s=JSON.parse(row.snapshot_json!);
      const fields=await fieldsFor(env,workspace,row.revision_id);
      const saved=JSON.parse(row.answers_json!);
      const {answers}=applicableFormAnswers(fields,saved);
      if(canonical(saved)!==canonical(answers))blockers.push({code:'ANSWER_REVIEW_REQUIRED',occurrence_key:row.occurrence_key});
      if(await hash(s)!==row.digest || s.schema_version!==1 || s.workspace_id!==workspace || s.job_id!==job || s.policy_id!==state.policy_id ||
         s.occurrence_key!==row.occurrence_key || s.form_revision_id!==row.revision_id || s.answer_version!==row.version ||
         !row.signer || s.signer!==row.signer || s.intent_version!==revision || canonical(s.answers)!==canonical(answers) ||
         canonical(s.evidence)!==canonical(evidence))blockers.push({code:'SIGNOFF_INVALID',occurrence_key:row.occurrence_key});
    }
    if(blockers.length)return blocked(blockers);
    writes.push(env.DB.prepare("UPDATE compliance_jobs SET version=version+1,status='COMPLETED',operation_id=? WHERE workspace_id=? AND id=?").bind(op,...scope));
    const hasVisits=await env.DB.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='compliance_visit_events'").first();
    if(hasVisits){
      writes.push(env.DB.prepare(`INSERT INTO compliance_visit_events(workspace_id,visit_id,version,job_id,technician_id,starts_at,duration_minutes,status,reason,actor_id,operation_key)
        SELECT v.workspace_id,v.visit_id,v.version+1,v.job_id,v.technician_id,v.starts_at,v.duration_minutes,'CANCELLED','Job completed',?,? || ':' || v.visit_id
        FROM compliance_visit_events v
        WHERE v.workspace_id=? AND v.job_id=? AND v.status='SCHEDULED'
          AND v.version=(SELECT max(h.version) FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id)
          AND EXISTS(SELECT 1 FROM compliance_operations WHERE id=?)`)
        .bind(auth.userId,op,workspace,job,op));
    }
  }
  const condition=slot?' AND '+grant:'';
  const operation=env.DB.prepare(`INSERT INTO compliance_operations SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 ${access}
    AND j.status='OPEN' AND j.version=? AND ${epoch}=? ${condition})`)
    .bind(op,workspace,auth.userId,action,job,state.version,fingerprint,...args,state.version,state.epoch,...(slot?[workspace,form,auth.userId]:[]));
  try {
  try{await env.DB.batch([operation,...writes]);}
  catch{
    const result=await replay();if(result)return result;
    const now=await read();
    if(!now)return fail('RESOURCE_NOT_FOUND');
    if(now.status!=='OPEN')return blocked([{code:'JOB_'+now.status}]);
    if(slot && !await env.DB.prepare('SELECT 1 WHERE '+grant).bind(workspace,form,auth.userId).first())return fail('ACTION_DENIED');
    if(now.epoch!==state.epoch)return fail('VERSION_CONFLICT');
    return fail('OPERATION_UNCONFIRMED');
  }
  return await replay()??fail('OPERATION_UNCONFIRMED');
  } catch { return fail('OPERATION_UNCONFIRMED'); }
}
