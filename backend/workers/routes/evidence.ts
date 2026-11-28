import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { complianceProblem, complianceStorageProblem } from '../../modules/compliance/problems.ts';
import { finalizePhoto, inspectPhoto, photoDigest } from '../../modules/compliance/photoEvidence.ts';
import { currentMembership, fingerprint } from './complianceJobs.ts';

async function boundedBody(request:Request,limit:number) {
  if (!request.body || Number(request.headers.get('content-length'))>limit) return null;
  const reader=request.body.getReader();
  const parts:Uint8Array[]=[];
  let length=0;
  for (;;) {
    const chunk=await reader.read();
    if(chunk.done) break;
    length+=chunk.value.length;
    if(length>limit){await reader.cancel();return null;}
    parts.push(chunk.value);
  }
  const bytes=new Uint8Array(length);
  let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  return bytes;
}

export async function handleEvidence(request:Request,env:Env,authentication:AuthenticationService,requestId:string,match:RegExpExecArray) {
  const [,workspace,job,encodedSlot,id,action]=match;
  const slot=decodeURIComponent(encodedSlot);
  const fail=(code:Parameters<typeof complianceProblem>[0])=>complianceProblem(code,requestId);
  const auth=await authentication.authenticateRequest(env.DB,request,env);
  if(!auth)return fail('AUTHENTICATION_REQUIRED');
  const member=await authorizeWorkspaceAccess(env.DB,workspace,auth);
  if(!member)return fail('ACTION_DENIED');
  const store=env.PRIVATE_EVIDENCE;
  if(!store)return fail('TEMPORARILY_UNAVAILABLE');
  const db=env.DB;
  const scope=[workspace,job,slot];
  const who=[workspace,auth.userId,auth.providerSubjectId,member.role];
  const access=`FROM compliance_jobs j JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id
    WHERE j.workspace_id=? AND j.id=? AND q.occurrence_key=? AND (?<>'technician' OR j.assignee_id=?) AND ${currentMembership}`;
  const args=[...scope,member.role,auth.userId,...who];
  const latest=`(SELECT max(a.version) FROM compliance_answers a WHERE a.workspace_id=j.workspace_id AND a.job_id=j.id AND a.occurrence_key=q.occurrence_key)`;
  const state=await db.prepare(`SELECT j.status,j.version,j.assignee_id,${latest} AS answer_version,
    (SELECT max_bytes FROM compliance_photo_limits WHERE workspace_id=j.workspace_id) AS cap ${access}`).bind(...args)
    .first<{status:string;version:number;assignee_id:string|null;answer_version:number|null;cap:number|null}>();
  if(!state)return fail('RESOURCE_NOT_FOUND');
  const open=`EXISTS(SELECT 1 ${access} AND j.status='OPEN' AND j.version=? AND ${latest}=?)`;
  const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
  if(action==='carry-forward' || (!id && request.method==='POST' && request.headers.get('content-type')?.includes('application/json'))){
    let sourceId=id;
    if(!sourceId){
      const jsonBody=await request.json().catch(()=>null) as {carry_forward_id?:string;source_id?:string}|null;
      sourceId=jsonBody?.carry_forward_id||jsonBody?.source_id||'';
    }
    if(!sourceId)return fail('INVALID_FIELD');
    if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
    const expectedJob=/^"([1-9][0-9]*)"$/.exec(request.headers.get('If-Match')??'');
    const expectedAnswer=/^[1-9][0-9]*$/.test(request.headers.get('X-Answer-Version')??'')?Number(request.headers.get('X-Answer-Version')):state.answer_version;
    const expectedVersion=expectedJob?Number(expectedJob[1]):state.version;
    if(state.version!==expectedVersion||state.answer_version!==expectedAnswer||!state.answer_version)return fail('VERSION_CONFLICT');
    const source=await db.prepare(`SELECT e.id,e.byte_length,e.digest,e.storage_key,coalesce(u.media_type,'image/jpeg') as media_type
      FROM compliance_evidence e
      LEFT JOIN compliance_uploads u ON u.id=e.id AND u.workspace_id=e.workspace_id AND u.job_id=e.job_id AND u.occurrence_key=e.occurrence_key
      WHERE e.id=? AND e.workspace_id=? AND e.job_id=? AND e.occurrence_key=? AND EXISTS(SELECT 1 ${access})`).bind(sourceId,...scope,...args)
      .first<{id:string;byte_length:number;digest:string;storage_key:string;media_type:string}>();
    if(!source)return fail('RESOURCE_NOT_FOUND');
    const existing=await db.prepare(`SELECT e.id,e.operation_id,e.digest FROM compliance_evidence e
      WHERE e.workspace_id=? AND e.job_id=? AND e.occurrence_key=? AND e.answer_version=? AND e.storage_key=?`)
      .bind(workspace,job,slot,state.answer_version,source.storage_key).first<{id:string;operation_id:string;digest:string}>();
    if(existing)return respond({status:'verified',evidence_id:existing.id,operation_id:existing.operation_id,sha256:existing.digest},200);
    const newId=crypto.randomUUID();
    try{
      await db.batch([
        db.prepare(`INSERT INTO compliance_uploads SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${open}`).bind(
          newId,...scope,auth.userId,state.version,state.answer_version,source.media_type,source.byte_length,source.digest,...args,state.version,state.answer_version
        ),
        db.prepare(`INSERT INTO compliance_operations SELECT ?,?,?,'EVIDENCE',?,?,? WHERE ${open}
          AND EXISTS(SELECT 1 FROM compliance_uploads WHERE id=?)`).bind(
          newId,workspace,auth.userId,job,state.version,source.digest,...args,state.version,state.answer_version,newId
        ),
        db.prepare('INSERT INTO compliance_evidence VALUES(?,?,?,?,?,?,?,?,?)').bind(
          newId,...scope,state.answer_version,source.byte_length,source.digest,source.storage_key,newId
        )
      ]);
      return respond({status:'verified',evidence_id:newId,operation_id:newId,sha256:source.digest},201);
    }catch(error){
      return fail(complianceStorageProblem(error));
    }
  }
  if(!id && request.method==='POST'){
    if(!state.cap)return fail('EVIDENCE_INVALID');
    const expectedJob=/^"([1-9][0-9]*)"$/.exec(request.headers.get('If-Match')??'');
    const expectedAnswer=/^[1-9][0-9]*$/.test(request.headers.get('X-Answer-Version')??'')?Number(request.headers.get('X-Answer-Version')):NaN;
    const expectedVersion=Number(expectedJob?.[1]);
    if(!Number.isSafeInteger(expectedVersion)||!Number.isSafeInteger(expectedAnswer))return fail('VERSION_CONFLICT');
    const operationKey=request.headers.get('Idempotency-Key');
    if(operationKey!==null&&!/^[\w-]{1,128}$/.test(operationKey))return fail('INVALID_FIELD');
    const bytes=await boundedBody(request,state.cap);
    if(!bytes)return fail('UPLOAD_TOO_LARGE');
    const media=request.headers.get('Content-Type')??'';
    const inspected=inspectPhoto(bytes,media,state.cap);
    if('error' in inspected)return fail(inspected.error);
    const digest=await photoDigest(bytes);
    const upload=operationKey?await fingerprint(['UPLOAD',...scope,auth.userId,operationKey]):crypto.randomUUID();
    const key='stage/'+upload;
    const savedUpload=()=>db.prepare(`SELECT u.digest,u.media_type,u.job_version,u.answer_version,
      EXISTS(SELECT 1 FROM compliance_evidence e JOIN compliance_receipts r ON r.operation_id=e.operation_id WHERE e.id=u.id) AS verified
      FROM compliance_uploads u WHERE u.id=? AND u.workspace_id=? AND u.job_id=? AND u.occurrence_key=? AND u.actor_id=?
      AND EXISTS(SELECT 1 ${access})`).bind(upload,...scope,auth.userId,...args)
      .first<{digest:string;media_type:string;job_version:number;answer_version:number;verified:number}>();
    try {
      let reservation=await savedUpload();
      if(!reservation){
        if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
        if(state.version!==expectedVersion||state.answer_version!==expectedAnswer)return fail('VERSION_CONFLICT');
        try{
          // Automatically reclaim obsolete unfinalized uploads for this job from older answer versions or obsolete job versions
          const stale=await db.prepare(`SELECT u.id FROM compliance_uploads u WHERE u.workspace_id=? AND u.job_id=?
            AND (u.answer_version < ? OR u.job_version < ?)
            AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=u.id)`).bind(workspace,job,expectedAnswer,expectedVersion).all<{id:string}>();
          for(const s of stale.results){
            await store.delete('stage/'+s.id).catch(()=>{});
            await db.prepare('DELETE FROM compliance_uploads WHERE id=? AND NOT EXISTS(SELECT 1 FROM compliance_evidence WHERE id=?)').bind(s.id,s.id).run().catch(()=>{});
          }
        }catch{/* best-effort reclamation */}
        try{
          await db.prepare(`INSERT INTO compliance_uploads SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${open}`)
            .bind(upload,...scope,auth.userId,expectedVersion,expectedAnswer,media,bytes.length,digest,...args,expectedVersion,expectedAnswer).run();
        }catch(error){
          reservation=await savedUpload();
          if(!reservation)return fail(complianceStorageProblem(error));
        }
        reservation??=await savedUpload();
      }
      if(!reservation)return fail('VERSION_CONFLICT');
      if(reservation.digest!==digest||reservation.media_type!==media||
         reservation.job_version!==expectedVersion||reservation.answer_version!==expectedAnswer)return fail('IDEMPOTENCY_KEY_REUSED');
      if(!reservation.verified){
        if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
        if(state.version!==expectedVersion||state.answer_version!==expectedAnswer)return fail('VERSION_CONFLICT');
        await store.put(key,bytes);
      }
      return respond({upload_id:upload,status:reservation.verified?'verified':'staged'},201);
    } catch(error){
      return fail(complianceStorageProblem(error)==='EVIDENCE_INVALID'?'EVIDENCE_INVALID':'TEMPORARILY_UNAVAILABLE');
    }
  }
  if(!id)return new Response(null,{status:405});
  if(request.method==='GET' && action==='content'){
    const evidence=await db.prepare(`SELECT e.storage_key,e.byte_length,e.digest,u.media_type FROM compliance_evidence e
      JOIN compliance_audit a ON a.id=e.operation_id
      JOIN compliance_uploads u ON u.id=e.id AND u.workspace_id=e.workspace_id AND u.job_id=e.job_id AND u.occurrence_key=e.occurrence_key
      WHERE e.id=? AND e.workspace_id=? AND e.job_id=? AND e.occurrence_key=? AND EXISTS(SELECT 1 ${access})`)
      .bind(id,...scope,...args).first<{storage_key:string;byte_length:number;digest:string;media_type:string}>();
    if(!evidence)return fail('RESOURCE_NOT_FOUND');
    try {
      const object=await store.get(evidence.storage_key);
      if(!object)return fail('TEMPORARILY_UNAVAILABLE');
      if(object.size!==undefined && object.size!==evidence.byte_length)return fail('EVIDENCE_INVALID');
      const bytes=await object.arrayBuffer();
      if(bytes.byteLength!==evidence.byte_length || await photoDigest(new Uint8Array(bytes))!==evidence.digest)return fail('EVIDENCE_INVALID');
      return new Response(bytes,{headers:{'Content-Type':evidence.media_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'attachment'}});
    } catch{return fail('TEMPORARILY_UNAVAILABLE');}
  }
  const isFinalize=request.method==='POST' && action==='finalize';
  // Fix C1: Cross-actor finalization blocked — only the original actor may finalize their upload
  const upload=await db.prepare(`SELECT u.* FROM compliance_uploads u
    WHERE u.id=? AND u.workspace_id=? AND u.job_id=? AND u.occurrence_key=?${isFinalize?' AND u.actor_id=?':''}
    AND EXISTS(SELECT 1 ${access})`).bind(...(isFinalize?[id,...scope,auth.userId,...args]:[id,...scope,...args]))
    .first<{actor_id:string;digest:string;media_type:string;byte_length:number;job_version:number;answer_version:number}>();
  if(!upload)return fail('RESOURCE_NOT_FOUND');
  const committed=()=>db.prepare(`SELECT e.id,e.operation_id,e.digest,e.storage_key,e.byte_length FROM compliance_evidence e
    JOIN compliance_audit a ON a.id=e.operation_id WHERE e.id=? AND EXISTS(SELECT 1 ${access})`)
    .bind(id,...args).first<{id:string;operation_id:string;digest:string;storage_key:string;byte_length:number}>();
  const receipt=(row:{id:string;operation_id:string;digest:string})=>respond({status:'verified',evidence_id:row.id,operation_id:row.operation_id,sha256:row.digest});
  const prior=await committed();
  const staged='stage/'+id;
  if(request.method==='GET' && !action)return prior?receipt(prior):respond({status:'staged',upload_id:id});
  if(request.method==='DELETE' && !action && !prior){
    if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
    // Remove temporary bytes first so a failed object delete can be retried by an authorized cleaner.
    // Allowed only for office/admin or the current job assignee on an OPEN job (original uploader status alone is never sufficient).
    const canDelete=member.role!=='technician'||state.assignee_id===auth.userId;
    if(!canDelete)return fail('ACTION_DENIED');
    await store.delete(staged).catch(()=>{});
    const discarded=await db.prepare(`DELETE FROM compliance_uploads WHERE id=? AND NOT EXISTS(SELECT 1 FROM compliance_evidence WHERE id=?) AND EXISTS(SELECT 1 ${access} AND j.status='OPEN')`).bind(id,id,...args).run();
    if(!discarded.meta.changes)return fail('JOB_STATE_CONFLICT');
    return new Response(null,{status:204});
  }
  if(request.method!=='POST'||action!=='finalize')return new Response(null,{status:405});
  if(prior){await store.delete(staged);return receipt(prior);}
  if(state.status!=='OPEN')return fail('JOB_STATE_CONFLICT');
  if(!state.cap)return fail('EVIDENCE_INVALID');
  if(upload.job_version!==state.version || upload.answer_version!==state.answer_version)return fail('VERSION_CONFLICT');
  const candidate='private/'+crypto.randomUUID();
  let submitted=false;
  try {
    const result=await finalizePhoto(store,staged,candidate,upload.media_type,state.cap,upload.digest);
    if('error' in result){
      const raced=await committed();
      return raced?receipt(raced):fail(result.error!);
    }
    if(result.byteLength!==upload.byte_length){await store.delete(candidate);return fail('EVIDENCE_INVALID');}
    submitted=true;
    await db.batch([
      db.prepare(`INSERT INTO compliance_operations SELECT ?,?,?,'EVIDENCE',?,?,? WHERE ${open}
        AND EXISTS(SELECT 1 FROM compliance_uploads WHERE id=?)`).bind(id,workspace,auth.userId,job,state.version,upload.digest,...args,state.version,state.answer_version,id),
      db.prepare('INSERT INTO compliance_evidence VALUES(?,?,?,?,?,?,?,?,?)').bind(id,...scope,state.answer_version,result.byteLength,result.sha256,candidate,id)
    ]);
    const row=await committed();
    if(!row)return fail('OPERATION_UNCONFIRMED');
    await store.delete(staged);
    return receipt(row);
  } catch(error){
    const row=await committed();
    if(row){
      if(candidate!==row.storage_key)await store.delete(candidate);
      await store.delete(staged);
      return receipt(row);
    }
    const code=complianceStorageProblem(error);
    if(!submitted || code!=='OPERATION_UNCONFIRMED')await store.delete(candidate);
    return fail(submitted?code:'TEMPORARILY_UNAVAILABLE');
  }
}
