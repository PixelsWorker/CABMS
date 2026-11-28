import assert from 'node:assert/strict';
import type { D1Database } from '../../backend/db/d1.ts';

export async function policyDrift(db:D1Database) {
  const write=(sql:string,...params:(string|number)[])=>db.prepare(sql).bind(...params).run();
  const policy=async(id:string,invoice:number,withSlot:boolean)=>{
    await write("INSERT INTO job_type_compliance_policies(id,job_type_id,version,status,is_direct_to_invoice,created_at,updated_at) VALUES(?,'jt-solar-install',?,'DRAFT',?,'2026','2026')",id,id,invoice);
    if(withSlot) await write("INSERT INTO policy_catalog_form_rules(id,workspace_id,policy_version_id,form_revision_id,required,display_order) VALUES(?,'solarcell',?,'guard-rev',1,0)",id,id);
    await write("UPDATE job_type_compliance_policies SET status='PUBLISHED' WHERE id=?",id);
    await write("UPDATE job_types SET current_policy_version_id=? WHERE id='jt-solar-install'",id);
  };
  const mutate=(id:string,action:string,query:string,...params:string[])=>db.batch([
    db.prepare("INSERT INTO compliance_operations VALUES(?,'solarcell','job-fixture',?,?,?,?)").bind(action+id,action,id,action==='CREATE'?0:1,'a'.repeat(64)),
    db.prepare(query).bind(...params)]);
  const create=(id:string,policy:string)=>mutate(id,'CREATE',"INSERT INTO compliance_jobs(id,workspace_id,job_type_id,policy_id,title,operation_id) VALUES(?,'solarcell','jt-solar-install',?,'Fixture',?)",id,policy,'CREATE'+id);
  const finish=(id:string)=>mutate(id,'COMPLETE',"UPDATE compliance_jobs SET status='COMPLETED',version=version+1,operation_id=? WHERE id=?",'COMPLETE'+id,id);
  const pinned=()=>db.prepare("SELECT j.policy_id,q.occurrence_key,q.revision_id FROM compliance_jobs j JOIN compliance_requirements q ON q.job_id=j.id WHERE j.id='pinned' ORDER BY q.occurrence_key").all<Record<string,string>>();
  const before=(await pinned()).results;
  assert.deepEqual(before.map(r=>[r.policy_id,r.occurrence_key,r.revision_id]),[['guard-draft','catalog:guard-rule','guard-rev'],['guard-draft','legacy:guard-legacy','guard-rev']]);
  const archive=()=>write("UPDATE form_definitions SET status='ARCHIVED' WHERE id='guard-form'");
  await assert.rejects(archive,/FORM_IN_USE/);
  await policy('invoice-with-slot',1,true);
  assert.deepEqual((await pinned()).results,before);
  await assert.rejects(archive,/FORM_IN_USE/);
  // Model an incomplete historical snapshot on this disposable database only.
  await write("CREATE TRIGGER fixture_omit_instance BEFORE INSERT ON compliance_requirements WHEN NEW.job_id='missing' BEGIN SELECT RAISE(IGNORE); END");
  try { await create('missing','invoice-with-slot'); }
  finally { await write("DROP TRIGGER fixture_omit_instance"); }
  assert.equal(await db.prepare("SELECT count(*) n FROM compliance_requirements WHERE job_id='missing'").first('n'),0);
  assert.deepEqual((await db.prepare("SELECT occurrence_key,code FROM compliance_completion_blockers WHERE job_id='missing'").all<Record<string,string>>()).results.map(row=>[row.occurrence_key,row.code]),[['catalog:invoice-with-slot','INSTANCE_REQUIRED']]);
  await assert.rejects(()=>finish('missing'),/COMPLETION_BLOCKED/);
  await policy('empty-regular',0,false);
  await create('empty-job','empty-regular');
  await assert.rejects(()=>finish('empty-job'),/COMPLETION_BLOCKED/);
  await policy('empty-invoice',1,false);
  await create('invoice-job','empty-invoice');
  await finish('invoice-job');
  assert.equal(await db.prepare("SELECT status FROM compliance_jobs WHERE id='invoice-job'").first('status'),'COMPLETED');
  await archive();
  assert.deepEqual((await pinned()).results,before);
  await write("UPDATE form_definitions SET status='ACTIVE' WHERE id='guard-form'");
}
