import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { D1Database } from '../../backend/db/d1.ts';
import type { Env } from '../../backend/types.ts';
import {reconcileEvidenceInventory,type EvidenceListing} from '../../backend/modules/compliance/evidenceReconciliation.ts';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWP4z8AAAAMBAQCc479ZAAAAAElFTkSuQmCC','base64');

export async function evidenceJourney(url:string,jobPath:string,db:D1Database,bucket:NonNullable<Env['PRIVATE_EVIDENCE']>,
  roles:{technician:string;office:string;owner:string;superAdmin:string}) {
  const job=jobPath.split('/').at(-1)!;
  const base=jobPath+'/forms/route-slot/evidence';
  const call=(path:string,method='GET',token=roles.technician,headers:Record<string,string>={},body?:Uint8Array<ArrayBuffer>)=>
    fetch(new URL(path,url),{method,headers:{Authorization:token,...headers},body});
  const stage=(token=roles.technician,bytes=png,media='image/png',extra={})=>call(base,'POST',token,{
    'Content-Type':media,'If-Match':'"2"','X-Answer-Version':'4',...extra},Uint8Array.from(bytes));
  const fresh=async(token=roles.technician)=>{
    const res=await stage(token);assert.equal(res.status,201,await res.clone().text());
    return (await res.json() as {upload_id:string}).upload_id;
  };
  const finalize=(id:string,token=roles.technician,headers={})=>call(base+'/'+id+'/finalize','POST',token,headers);
  const count=()=>db.prepare('SELECT count(*) n FROM compliance_evidence WHERE job_id=?').bind(job).first('n');
  await db.prepare("DELETE FROM compliance_photo_limits WHERE workspace_id='solarcell'").run();
  assert.equal((await stage()).status,422);
  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id,max_bytes,validated_at,validated_by) VALUES('solarcell',200,'fixture','job-fixture')").run();
  assert.equal((await stage('Bearer invalid')).status,401);
  assert.equal((await stage(roles.technician,Buffer.alloc(201))).status,413);
  assert.equal((await stage(roles.technician,png,'image/jpeg')).status,422);
  assert.equal((await stage(roles.technician,png.subarray(0,32))).status,422);
  assert.equal((await stage(roles.technician,Buffer.alloc(0))).status,422);
  assert.equal((await stage(roles.technician,png,'image/png',{'X-Answer-Version':'3'})).status,412);
  const uploadKey={'Idempotency-Key':'stage-replay'};
  const sameStage=await Promise.all([stage(roles.technician,png,'image/png',uploadKey),stage(roles.technician,png,'image/png',uploadKey)]);
  for(const res of sameStage)assert.equal(res.status,201,await res.clone().text());
  const firstStage=await sameStage[0].json() as {upload_id:string};
  assert.deepEqual(await sameStage[1].json(),firstStage);
  assert.equal((await stage(roles.technician,png,'image/png',{...uploadKey,'X-Answer-Version':'3'})).status,409);
  assert.equal((await call(base+'/'+firstStage.upload_id,'DELETE')).status,204);
  const broken=await fresh();
  await db.prepare("DELETE FROM compliance_photo_limits WHERE workspace_id='solarcell'").run();
  assert.equal((await finalize(broken)).status,422);
  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id,max_bytes,validated_at,validated_by) VALUES('solarcell',200,'fixture','job-fixture')").run();
  await bucket.delete('stage/'+broken);
  assert.equal((await finalize(broken)).status,404);
  // Different valid image bytes with the same dimensions and media type.
  const changed=Buffer.from(png);
  changed.writeUInt32BE(999,41);
  const {crc32}=await import('node:zlib');
  changed.writeUInt32BE(crc32(changed.subarray(37,50)),50);
  await bucket.put('stage/'+broken,changed);
  assert.equal((await finalize(broken)).status,422);
  await bucket.put('stage/'+broken,png);
  assert.equal((await finalize(broken,roles.technician,{'X-Test-Storage-Failure':'put'})).status,503);
  assert.equal((await call(base+'/'+broken+'/content')).status,404);
  assert.deepEqual(await (await call(base+'/'+broken)).json(),{status:'staged',upload_id:broken});
  assert.equal(await count(),0);
  assert.equal((await call(base+'/'+broken,'DELETE')).status,204);
  assert.equal(await bucket.get('stage/'+broken),null);

  const first=await fresh();
  assert.equal((await finalize(first,roles.owner)).status,404);
  assert.equal((await call(base.replace('solarcell','cctv')+'/'+first,'GET',roles.superAdmin)).status,404);
  assert.equal((await call(base+'/'+first+'/content')).status,404);
  assert.equal((await finalize(first,roles.technician,{'X-Test-Response-Loss':'after-commit'})).status,504);
  const recovered=await (await call(base+'/'+first)).json();
  assert.equal(await count(),1);
  const dup=await Promise.all([finalize(first),finalize(first)]);
  for(const res of dup)assert.equal(res.status,200,await res.clone().text());
  const status=await (await call(base+'/'+first)).json() as {operation_id:string;sha256:string};
  assert.deepEqual(recovered,status);
  assert.deepEqual(await dup[0].json(),status);
  assert.deepEqual(await dup[1].json(),status);
  assert.equal(status.sha256,createHash('sha256').update(png).digest('hex'));
  const audit=await db.prepare("SELECT actor_id FROM compliance_audit WHERE id=? AND target_id=? AND action='EVIDENCE'").bind(status.operation_id,job).first<string>('actor_id');
  assert.equal(audit,'test_g01_usr_technician');
  assert.equal(await bucket.get('stage/'+first),null);
  const content=await call(base+'/'+first+'/content');
  assert.equal(content.status,200);assert.match(content.headers.get('Cache-Control')??'',/\bno-store\b/);
  assert.deepEqual(Buffer.from(await content.arrayBuffer()),png);
  const officeContent=await call(base+'/'+first+'/content','GET',roles.office);
  assert.equal(officeContent.status,200);
  assert.deepEqual(Buffer.from(await officeContent.arrayBuffer()),png);
  assert.equal((await call(base.replace('solarcell','cctv')+'/'+first+'/content','GET',roles.superAdmin)).status,404);
  const storage=await db.prepare('SELECT storage_key FROM compliance_evidence WHERE id=?').bind(first).first<string>('storage_key');
  assert.equal((await fetch(new URL('/asset-fixture',url))).status,200);
  assert.equal((await fetch(new URL('/'+storage,url))).status,404);
  assert.equal((await fetch(new URL('/stage/'+first,url))).status,404);
  assert.ok(storage);
  await bucket.put(storage,changed);
  assert.equal((await call(base+'/'+first+'/content')).status,422);
  await bucket.put(storage,png);
  for(const ref of [first,broken,'private/arbitrary']){
    const invalidRef=await call(jobPath,'PATCH',roles.technician,{'If-Match':'"2"','Idempotency-Key':'reject-ref'},
      new TextEncoder().encode(JSON.stringify({occurrence_key:'route-slot',expected_answer_version:4,answers:{result:'PASS'},evidence_ids:[ref]})));
    assert.equal(invalidRef.status,422);
  }
  await db.prepare("INSERT INTO compliance_job_byte_limits VALUES('solarcell',?)").bind(png.length*2).run();
  const ids=await Promise.all([fresh(),fresh()]);
  const limited=await Promise.all(ids.map(id=>finalize(id)));
  assert.deepEqual(limited.map(r=>r.status).sort(),[200,422]);
  await db.prepare("UPDATE compliance_job_byte_limits SET max_job_bytes=10000").run();
  await finalize(ids[limited.findIndex(r=>r.status===422)]);
  const same=await fresh();
  const simultaneous=await Promise.all([finalize(same),finalize(same)]);
  for(const r of simultaneous)assert.equal(r.status,200,await r.clone().text());
  assert.equal(await count(),4);
  const contenders=[];
  for(let i=0;i<17;i++)contenders.push(await fresh());
  const burst=await Promise.all(contenders.map(id=>finalize(id)));
  assert.equal(burst.filter(r=>r.status===200).length,16);
  assert.equal(burst.filter(r=>r.status===422).length,1);
  assert.equal(await count(),20);
  const pending=contenders[burst.findIndex(r=>r.status===422)];
  const officeId=await fresh(roles.office);
  await bucket.put('private/reconciliation-fixture',png);
  await bucket.put('stage/'+first,png);
  await bucket.delete(storage);
  const inventory=await reconcileEvidenceInventory(db,bucket as typeof bucket & EvidenceListing);
  assert.ok(inventory.missing_verified_keys.includes(storage));
  assert.ok(inventory.objects.some(row=>row.key==='stage/'+pending&&row.state==='pending_upload'));
  assert.ok(inventory.objects.some(row=>row.key==='stage/'+first&&row.state==='retained_stage'));
  assert.ok(inventory.objects.some(row=>row.key==='private/reconciliation-fixture'&&row.state==='unreferenced'));
  assert.ok(await bucket.get('private/reconciliation-fixture'));
  await bucket.put(storage,png);
  const change=async(action:string,version:number,fields:string)=>{
    const op='photo-'+action;
    await db.batch([db.prepare('INSERT INTO compliance_operations VALUES(?,?,?,?,?,?,?)').bind(op,'solarcell','job-fixture',action,job,version,'a'.repeat(64)),
      db.prepare('UPDATE compliance_jobs SET '+fields+', version=version+1,operation_id=? WHERE id=?').bind(op,job)]);
  };
  await change('ASSIGN',2,'assignee_id=NULL');
  assert.equal((await stage()).status,404);
  assert.equal((await finalize(pending)).status,404);
  assert.equal((await call(base+'/'+first+'/content')).status,404);
  assert.equal((await finalize(officeId,roles.office)).status,412);
  await change('CANCEL',3,"status='CANCELLED'");
  assert.equal((await finalize(officeId,roles.office)).status,409);
  assert.equal((await stage(roles.owner)).status,409);
}
