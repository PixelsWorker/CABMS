import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import type {D1Database} from '../../backend/db/d1.ts';
import type {Env} from '../../backend/types.ts';

export async function signingJourney(url:string,base:string,db:D1Database,bucket:NonNullable<Env['PRIVATE_EVIDENCE']>,
 roles:{technician:string;office:string;owner:string;superAdmin:string;staleTech:string}){
 const {technician,office,owner}=roles;
 const techId='test_g01_usr_technician';
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64');
 const call=(path:string,method:string,token:string,key:string,body?:unknown,extra={})=>fetch(new URL(path,url),{
   method,headers:{Authorization:token,'Content-Type':'application/json','Idempotency-Key':key,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const expect=async(response:Response,status:number)=>assert.equal(response.status,status,await response.clone().text());
 const create=async(type:string,policy:string,assign=true)=>{
   const r=await call(base,'POST',office,randomUUID(),{job_type_id:type,expected_policy_id:policy,title:'Signing fixture',assignee_id:assign?techId:null});
   await expect(r,201);return (await r.json() as {job_id:string}).job_id;
 };
 const complete=(id:string,key:string,token=office,version=1,extra={})=>call(base+'/'+id+'/complete','POST',token,key,{expected_job_version:version},extra);
 const codes=async(r:Response,code:string,slot?:string)=>{
   await expect(r,409);const data=await r.json() as {request_id:string;code:string;blockers:{code:string;occurrence_key?:string}[]};
   assert.match(data.request_id,/^req_/);
   assert.equal(r.headers.get('X-Request-Id'),data.request_id);
   assert.equal(data.code,r.url.endsWith('/complete')?'COMPLETION_BLOCKED':'SIGNOFF_BLOCKED');
   assert.ok(data.blockers.some(b=>b.code===code && (!slot||slot===b.occurrence_key)),JSON.stringify(data));
 };
 await codes(await complete('missing','missing-slot'),'INSTANCE_REQUIRED','catalog:invoice-with-slot');
 await codes(await complete('empty-job','empty-policy'),'EMPTY_POLICY');
 const invoice=await create('jt-solar-service','pol-solar-service-v1',false);
 const invoiceRace=await Promise.all([complete(invoice,'invoice-a'),complete(invoice,'invoice-b')]);
 assert.deepEqual(invoiceRace.map(r=>r.status).sort(),[200,409]);
 assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_audit WHERE target_id=? AND action='COMPLETE'").bind(invoice).first('n'),1);
 await db.prepare("UPDATE job_types SET current_policy_version_id='invoice-with-slot' WHERE id='jt-solar-install'").run();
 const job=await create('jt-solar-install','invoice-with-slot'),slot='catalog:invoice-with-slot',repeat='visit-2';
 const jobPath=base+'/'+job;
 const form=(s:string)=>jobPath+'/forms/'+encodeURIComponent(s);
 const save=async(s:string,v:number,answers:unknown)=>expect(await call(jobPath,'PATCH',technician,randomUUID(),
   {occurrence_key:s,expected_answer_version:v,answers},{'If-Match':'"1"'}),200);
 const sign=(s:string,key:string,body:unknown,token=technician,extra={})=>call(form(s)+'/sign','POST',token,key,body,extra);
 const input=(v:number,id?:string)=>({expected_job_version:1,answer_version:v,intent_version:'cabms-form-attestation-v1',evidence_by_field:id?{proof:[id]}:{}});
 const photo=async(s:string,v:number)=>{
   const r=await fetch(new URL(form(s)+'/evidence',url),{method:'POST',headers:{Authorization:technician,'Content-Type':'image/png','If-Match':'"1"','X-Answer-Version':String(v)},body:png});
   await expect(r,201);return (await r.json() as {upload_id:string}).upload_id;
 };
 const finalize=async(s:string,id:string)=>expect(await call(form(s)+'/evidence/'+id+'/finalize','POST',technician,randomUUID()),200);
 await codes(await complete(job,'unsigned'),'SIGNOFF_REQUIRED',slot);
 await expect(await complete(job,'wrong-role',technician),403);
 await expect(await complete(job,'stale-job',office,8),412);
 await save(slot,0,{});
 await expect(await sign(slot,'no-grant',input(1)),403);
 await db.prepare("INSERT INTO compliance_signer_grants VALUES('solarcell','guard-rev',?)").bind(techId).run();
 await codes(await sign(slot,'expired-auth',input(1),roles.staleTech),'RECENT_SIGN_IN_REQUIRED');
 await codes(await sign(slot,'missing',input(1)),'ANSWER_INVALID',slot);
 await save(slot,1,{result:'FAIL'});
 await codes(await sign(slot,'conditional',input(2)),'ANSWER_INVALID',slot);
 await codes(await sign(slot,'failed',input(2)),'FAILED_ANSWER',slot);
 await save(slot,2,{result:'PASS',reason:'Hidden value must be discarded'});
 const saved=await db.prepare('SELECT answers_json FROM compliance_answers WHERE job_id=? AND occurrence_key=? AND version=3')
   .bind(job,slot).first<string>('answers_json');
 assert.deepEqual(JSON.parse(saved!),{result:'PASS'});
 await expect(await sign(slot,'stale',input(2)),412);
 await expect(await sign(slot,'stale-job',{...input(3),expected_job_version:2}),412);
 await expect(await sign(slot,'forged',{...input(3),digest:'a'.repeat(64)}),422);
 await expect(await sign(slot,'forged-user',{...input(3),signer:techId}),422);
 await expect(await sign(slot,'admin',input(3),owner),403);
 const other=await create('jt-solar-install','invoice-with-slot',false);
 await expect(await call(base+'/'+other+'/forms/'+slot+'/sign','POST',technician,'unassigned',input(3)),404);
 await expect(await call(form(slot).replace('solarcell','cctv')+'/sign','POST',roles.superAdmin,'scope',input(3)),404);
 await codes(await sign(slot,'no-proof',input(3)),'EVIDENCE_REQUIRED',slot);
 await codes(await complete(job,'no-evidence'),'EVIDENCE_REQUIRED',slot);
 const id=await photo(slot,3);
 await codes(await sign(slot,'staged',input(3,id)),'EVIDENCE_REFERENCE_INVALID');
 await finalize(slot,id);
 const storage=await db.prepare('SELECT storage_key FROM compliance_evidence WHERE id=?').bind(id).first<string>('storage_key');assert.ok(storage);
 await bucket.delete(storage);
 await codes(await sign(slot,'missing-object',input(3,id)),'EVIDENCE_INVALID');
 await bucket.put(storage,png);
 const mutation=async(action:string,op:string,sql:string,...args:string[])=>db.batch([
   db.prepare('INSERT INTO compliance_operations VALUES(?,?,?,?,?,?,?)').bind(op,'solarcell','job-fixture',action,job,1,'a'.repeat(64)),
   db.prepare(sql).bind(...args)]);
 await mutation('FINDING','r3-finding',"INSERT INTO compliance_findings VALUES('r3','solarcell',?,?,'Unsafe finding','r3-finding')",job,slot);
 await codes(await sign(slot,'finding',input(3,id)),'UNRESOLVED_FINDING',slot);
 await codes(await complete(job,'finding'),'UNRESOLVED_FINDING',slot);
 await mutation('FINDING','r3-resolve',"INSERT INTO compliance_resolutions VALUES('r3','Correction confirmed','r3-resolve')");
 await expect(await sign(slot,'lost',input(3,id),technician,{'X-Test-Response-Loss':'after-commit'}),504);
 const record=await call(form(slot)+'/sign','GET',technician,'lost');
 await expect(record,200);
 assert.deepEqual(await record.json(),await (await sign(slot,'lost',input(3,id))).json());
 const snap=await db.prepare('SELECT snapshot_json,digest FROM compliance_signoffs WHERE job_id=? AND occurrence_key=?').bind(job,slot).first<{snapshot_json:string;digest:string}>();assert.ok(snap);
 assert.equal(createHash('sha256').update(snap.snapshot_json).digest('hex'),snap.digest);
 assert.deepEqual(JSON.parse(snap.snapshot_json).answers,{result:'PASS'});
 assert.equal(JSON.parse(snap.snapshot_json).evidence_by_field.proof[0],id);
 await expect(await sign(slot,'conflict',input(3,id)),409);
 await save(slot,3,{result:'PASS'});
 await codes(await complete(job,'edited'),'SIGNOFF_REQUIRED',slot);
 assert.deepEqual(
  {...await db.prepare('SELECT snapshot_json,digest FROM compliance_signoffs WHERE job_id=? AND occurrence_key=? AND answer_version=3').bind(job,slot).first<{snapshot_json:string;digest:string}>()},
  {...snap},
 );
 const updated=await photo(slot,4);await finalize(slot,updated);
 const racers=await Promise.all(['sign-a','sign-b'].map(key=>sign(slot,key,input(4,updated))));
 assert.equal(racers.filter(r=>r.ok).length,1);
 assert.ok(racers.some(r=>[409,412].includes(r.status)));
 await mutation('ADD','r3-repeat',"INSERT INTO compliance_requirements VALUES('solarcell',?,?,'guard-rev','ADDITIONAL',1,'Second circuit','r3-repeat')",job,repeat);
 await codes(await complete(job,'repeat-blocks'),'SIGNOFF_REQUIRED',repeat);
 await save(repeat,0,{result:'PASS'});
 await codes(await sign(repeat,'foreign-photo',input(1,updated)),'EVIDENCE_REFERENCE_INVALID',repeat);
 const second=await photo(repeat,1);await finalize(repeat,second);
 await expect(await sign(repeat,'repeat-sign',input(1,second)),200);
 const secondKey=await db.prepare('SELECT storage_key FROM compliance_evidence WHERE id=?').bind(second).first<string>('storage_key');assert.ok(secondKey);
 await bucket.put(secondKey,Buffer.from('corrupt'));await codes(await complete(job,'corrupt'),'EVIDENCE_INVALID',repeat);
 await bucket.put(secondKey,png);
 const finished=await Promise.all([complete(job,'finish',office,1,{'X-Test-Response-Loss':'after-commit'}),complete(job,'finish',office,1,{'X-Test-Response-Loss':'after-commit'})]);
 for(const r of finished)await expect(r,504);
 const recovered=await call(jobPath+'/complete','GET',office,'finish');await expect(recovered,200);
 assert.deepEqual(await recovered.json(),await (await complete(job,'finish')).json());
 assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_audit WHERE target_id=? AND action='COMPLETE'").bind(job).first('n'),1);
 await codes(await complete(job,'other-key'),'JOB_COMPLETED');
 // Simulate an immutable answer and signature saved by the previous server.
 const historical=await create('jt-solar-install','invoice-with-slot');
 const retiredAnswers={result:'PASS',reason:'Earlier hidden answer'};
 await db.batch([
   db.prepare("INSERT INTO compliance_operations VALUES('historical-save','solarcell',?,'SAVE',?,1,?)").bind(techId,historical,'f'.repeat(64)),
   db.prepare("INSERT INTO compliance_answers VALUES('solarcell',?,?,1,?,'historical-save')").bind(historical,slot,JSON.stringify(retiredAnswers)),
 ]);
 const olderDetail=await call(base+'/'+historical,'GET',technician,'older-detail');
 await expect(olderDetail,200);
 const {requirements}=await olderDetail.json() as {requirements:{answers:unknown;needs_answer_review:boolean}[]};
 assert.deepEqual(requirements[0].answers,{result:'PASS'});
 assert.equal(requirements[0].needs_answer_review,true);
 await codes(await call(base+'/'+historical+'/forms/'+encodeURIComponent(slot)+'/sign','POST',technician,'review-old',input(1)),'ANSWER_REVIEW_REQUIRED',slot);
 const previousSnapshot=JSON.stringify({...JSON.parse(snap.snapshot_json),job_id:historical,answer_version:1,answers:retiredAnswers,evidence:[],evidence_by_field:{}});
 await db.batch([
   db.prepare("INSERT INTO compliance_operations VALUES('historical-sign','solarcell',?,'SIGN',?,1,?)").bind(techId,historical,'e'.repeat(64)),
   db.prepare("INSERT INTO compliance_signoffs VALUES('solarcell',?,?,1,?,?,'historical-sign')")
    .bind(historical,slot,previousSnapshot,createHash('sha256').update(previousSnapshot).digest('hex')),
 ]);
 await codes(await complete(historical,'review-old-completion'),'ANSWER_REVIEW_REQUIRED',slot);
 assert.equal(await db.prepare('SELECT snapshot_json FROM compliance_signoffs WHERE job_id=?').bind(historical).first('snapshot_json'),previousSnapshot);
 await db.batch([db.prepare("INSERT INTO compliance_operations VALUES('cancel-r3','solarcell','job-fixture','CANCEL',?,1,?)").bind(other,'b'.repeat(64)),
   db.prepare("UPDATE compliance_jobs SET version=2,status='CANCELLED',operation_id='cancel-r3' WHERE id=?").bind(other)]);
 await codes(await complete(other,'cancel'),'JOB_CANCELLED');
}
