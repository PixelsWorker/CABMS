import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import type {TestContext} from 'node:test';
import type {D1Database} from '../../backend/db/d1.ts';
import {G01_TEST_AUTH} from '../support/g01SyntheticFixtures.ts';

export async function atomicJourney(t:TestContext,url:string,base:string,db:D1Database,roles:{office:string;owner:string;technician:string;superAdmin:string}){
 const {office,owner,technician}=roles;
 const http=(path:string,actor:string,key:string,body?:unknown,method=body?'POST':'GET',extra:Record<string,string>={})=>
  fetch(new URL(path,url),{method,headers:{Authorization:actor,'Idempotency-Key':key,'Content-Type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const check=async(r:Response,code:number)=>assert.equal(r.status,code,await r.clone().text());
 const created=await http(base,office,randomUUID(),{job_type_id:'jt-solar-install',expected_policy_id:'invoice-with-slot',title:'Atomic journey',assignee_id:G01_TEST_AUTH.technician.userId});
 await check(created,201);
 const id=(await created.json() as {job_id:string}).job_id;
 const job=base+'/'+id,slot='catalog:invoice-with-slot',form=job+'/forms/'+encodeURIComponent(slot);
 const extra=job+'/forms/review-extra';
 await check(await http(job+'?operation=ADD',office,randomUUID(),{revision_id:'guard-rev',occurrence_key:'review-extra',required:true,reason:'Second inspection location'},'POST',{'If-Match':'"1"'}),200);
 const tables=(await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'compliance_%' ORDER BY name").all<{name:string}>()).results;
 async function databaseState(){
  const state=[];
  for(const {name} of tables){
   assert.match(name,/^compliance_[a-z_]+$/);
   const rows=(await db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()).results;
   state.push([name,rows.length,createHash('sha256').update(JSON.stringify(rows)).digest('hex')]);
  }
  return state;
 }
 async function prove(action:string,path:string,lookup:string,actor:string,actorId:string,input:Record<string,unknown>,different:Record<string,unknown>,method='POST',headers:Record<string,string>={}){
  const key=randomUUID();
  // Each route writes its operation and one domain row. Its AFTER trigger writes the receipt.
  // BEFORE receipt insertion is after the domain row and before the final write.
  for(const [boundary,clause] of [['operation','AFTER INSERT ON compliance_operations'],['domain row','BEFORE INSERT ON compliance_receipts'],['receipt','AFTER INSERT ON compliance_receipts']]){
   await t.test(action+' rollback after '+boundary,async()=>{
    const before=await databaseState();
    await db.prepare("CREATE TRIGGER disposable_interrupt "+clause+" BEGIN SELECT RAISE(ABORT,'OPERATION_UNCONFIRMED'); END").run();
    try{
     const r=await http(path,actor,key,input,method,headers);await check(r,500);
     const problem=await r.json() as {code:string;request_id:string};
     assert.equal(problem.code,'OPERATION_UNCONFIRMED');assert.equal(problem.request_id,r.headers.get('X-Request-Id'));
     await check(await http(lookup,actor,key),404);
     assert.deepEqual(await databaseState(),before);
    }finally{await db.prepare('DROP TRIGGER disposable_interrupt').run();}
   });
  }
  await t.test(action+' committed response loss, read-only receipt, replay and conflicting input',async()=>{
   await check(await http(path,actor,key,input,method,{...headers,'X-Test-Response-Loss':'after-commit'}),504);
   const committed=await databaseState();
   const receipt=await http(lookup,actor,key);await check(receipt,200);
   const saved=await receipt.json() as {operation_id:string};assert.ok(saved.operation_id);
   const replay=await http(path,actor,key,input,method,headers);await check(replay,200);
   assert.equal((await replay.json() as {operation_id:string}).operation_id,saved.operation_id);
   const conflict=await http(path,actor,key,different,method,headers);await check(conflict,409);
   assert.equal((await conflict.json() as {code:string}).code,'IDEMPOTENCY_KEY_REUSED');
   assert.deepEqual(await databaseState(),committed);
   assert.deepEqual((await db.prepare('SELECT actor_id,action FROM compliance_audit WHERE id=?').bind(saved.operation_id).all()).results,[{actor_id:actorId,action}]);
  });
 }
 const answers={occurrence_key:slot,expected_answer_version:0,answers:{result:'PASS'}};
 await prove('SAVE',job,form+'/answer-receipt',technician,G01_TEST_AUTH.technician.userId,answers,{...answers,answers:{result:'FAIL'}},'PATCH',{'If-Match':'"1"'});
 const withdrawal={expected_job_version:1,reason:'Wrong location'};
 await prove('REQUEST_WITHDRAW',extra+'/withdrawal-request',extra+'/withdrawal-request',office,G01_TEST_AUTH.officeStaff.userId,withdrawal,{...withdrawal,reason:'Other'});
 await prove('WITHDRAW',extra+'/withdrawal-decision',extra+'/withdrawal-decision',owner,G01_TEST_AUTH.ownerAdmin.userId,withdrawal,{...withdrawal,reason:'Other'});
 await t.test('competing authorized withdrawal decisions return one winner and one immutable-history conflict',async()=>{
  const slot='race-extra',route=job+'/forms/'+slot;
  await check(await http(job+'?operation=ADD',office,randomUUID(),{revision_id:'guard-rev',occurrence_key:slot,required:true,reason:'Review this visit'},'POST',{'If-Match':'"1"'}),200);
  await check(await http(route+'/withdrawal-request',office,randomUUID(),withdrawal),200);
  const responses=await Promise.all([owner,roles.superAdmin].map(actor=>http(route+'/withdrawal-decision',actor,randomUUID(),withdrawal)));
  assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
  const loser=responses.find(r=>!r.ok)!;
  const problem=await loser.json() as {code:string;request_id:string};
  assert.equal(problem.code,'HISTORY_IMMUTABLE');assert.equal(problem.request_id,loser.headers.get('X-Request-Id'));
  const winner=responses.findIndex(r=>r.ok);
  assert.deepEqual((await db.prepare(`SELECT a.actor_id FROM compliance_decisions d JOIN compliance_audit a ON a.id=d.operation_id
   WHERE d.workspace_id='solarcell' AND d.job_id=? AND d.occurrence_key=?`).bind(id,slot).all()).results,[{actor_id:winner===0?G01_TEST_AUTH.ownerAdmin.userId:G01_TEST_AUTH.superAdmin.userId}]);
 });
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64');
 const upload=await fetch(new URL(form+'/evidence',url),{method:'POST',headers:{Authorization:technician,'Content-Type':'image/png','If-Match':'"1"','X-Answer-Version':'1'},body:png});await check(upload,201);
 const photo=(await upload.json() as {upload_id:string}).upload_id;
 await check(await http(form+'/evidence/'+photo+'/finalize',technician,randomUUID(),{}),200);
 const signature={expected_job_version:1,answer_version:1,intent_version:'cabms-form-attestation-v1',evidence_by_field:{proof:[photo]}};
 await prove('SIGN',form+'/sign',form+'/sign',technician,G01_TEST_AUTH.technician.userId,signature,{...signature,answer_version:2});
 await prove('COMPLETE',job+'/complete',job+'/complete',office,G01_TEST_AUTH.officeStaff.userId,{expected_job_version:1},{expected_job_version:2});
}
