import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import type { D1Database } from '../../backend/db/d1.ts';

type Batch = [string,...(string|number)[]][];
export async function withdrawalRace(db:D1Database,file?:string) {
  const run=(batch:Batch)=>db.batch(batch.map(([sql,...p])=>db.prepare(sql).bind(...p)));
  async function race(batches:Batch[]) {
    if(!file) return Promise.allSettled(batches.map(run));
    const workers=batches.map(batch=>new Worker(`
      const {workerData,parentPort}=require('node:worker_threads');
      const db=new (require('node:sqlite').DatabaseSync)(workerData.file);
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000');
      parentPort.postMessage('ready');
      parentPort.once('message',()=>{
        try {
          db.exec('BEGIN IMMEDIATE');
          for(const [sql,...params] of workerData.batch) db.prepare(sql).run(...params);
          db.exec('COMMIT');
          parentPort.postMessage(null);
        } catch(e) { parentPort.postMessage(e.message); } finally { db.close(); }
      });`,{eval:true,workerData:{file,batch}}));
    const next=(w:Worker)=>new Promise<unknown>((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);});
    try {
      await Promise.all(workers.map(next));
      return await Promise.allSettled(workers.map(async w=>{const done=next(w);w.postMessage('go');const error=await done;if(error)throw Error(String(error));}));
    } finally { await Promise.all(workers.map(w=>w.terminate())); }
  }
  const owner='job-fixture',other='second-admin',staff='requester';
  const op=(id:string,actor:string,action:string):Batch[number]=>["INSERT INTO compliance_operations VALUES(?,'solarcell',?,?,'fixture',1,?)",id,actor,action,'a'.repeat(64)];
  const request=(slot:string,actor:string)=>run([op('request-'+slot,actor,'REQUEST_WITHDRAW'),["INSERT INTO compliance_withdraw_requests VALUES('solarcell','fixture',?,'Added by mistake',?)",slot,'request-'+slot]]);
  const decide=(slot:string,id:string,actor:string,by:string,flag:number,kind='WITHDRAW'):Batch=>[op(id,actor,'WITHDRAW'),["INSERT INTO compliance_decisions VALUES('solarcell','fixture',?,?,'Added by mistake',?,?,?)",slot,kind,by,flag,id]];
  await run([["INSERT INTO users(id,email,created_at,updated_at) VALUES(?,'requester@example.invalid','2026','2026')",staff],
    ["INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES(?,'solarcell',?,'office_staff','2026','2026')",staff,staff],
    ["UPDATE users SET disabled=0 WHERE id=?",other]]);
  for(const slot of ['race','toggle','sole','signed']) {
    await run([op('add-'+slot,staff,'ADD'),["INSERT INTO compliance_requirements VALUES('solarcell','fixture',?,'guard-rev','ADDITIONAL',0,'Added by mistake',?)",slot,'add-'+slot]]);
    await request(slot,slot==='race'?staff:owner);
  }
  const identity=await createFirebaseFixture();
  const auth=createAuthenticationService(identity.transport);
  const actors:string[]=[];
  for(const id of [owner,other]) {
    const uid='race-uid-'+id;
    await run([["INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES(?,?,'firebase',?,'2026')",uid,id,uid]]);
    const token=await identity.token(uid,id+'@example.invalid');
    const context=await auth.authenticateRequest(db,new Request('https://fixture.invalid',{headers:{Authorization:'Bearer '+token}}),
      {DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'});
    assert.equal(context?.userId,id);
    actors.push(context!.userId);
  }
  const results=await race(actors.map(actor=>decide('race','decide-'+actor,actor,staff,0)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.match(String(results.find(r=>r.status==='rejected')?.reason),/HISTORY_IMMUTABLE/);
  assert.equal(await db.prepare("SELECT count(*) n FROM compliance_audit WHERE id LIKE 'decide-%'").first('n'),1);
  await assert.rejects(()=>run(decide('sole','forge',owner,staff,0)),/EXCEPTION_DENIED/);
  await assert.rejects(()=>run(decide('sole','self',owner,owner,1)),/EXCEPTION_DENIED/);
  await run([["CREATE TABLE fixture_disable_order(decided INTEGER NOT NULL)"]]);
  const disable:Batch=[["INSERT INTO fixture_disable_order SELECT count(*) FROM compliance_decisions WHERE operation_id='toggle-self'"],["UPDATE users SET disabled=1 WHERE id=?",other]];
  const toggle=decide('toggle','toggle-self',owner,owner,1);
  await run([["CREATE TABLE fixture_toggle_order(other_disabled INTEGER NOT NULL)"]]);
  toggle.unshift(["INSERT INTO fixture_toggle_order SELECT disabled FROM users WHERE id=?",other]);
  const [attempt,disabled]=await race([toggle,disable]);
  assert.equal(disabled.status,'fulfilled');
  assert.equal(await db.prepare("SELECT decided FROM fixture_disable_order").first('decided'),0);
  assert.equal(await db.prepare("SELECT other_disabled FROM fixture_toggle_order").first('other_disabled'),attempt.status==='fulfilled'?1:null);
  if(attempt.status==='rejected') { assert.match(String(attempt.reason),/EXCEPTION_DENIED/);await run(toggle); }
  await assert.rejects(()=>run(decide('sole','waive',owner,owner,1,'EXCEPTION')),/EXCEPTION_DENIED/);
  await run(decide('sole','sole-success',owner,owner,1));
  assert.equal(await db.prepare("SELECT later_review FROM compliance_decisions WHERE operation_id='sole-success'").first('later_review'),1);
  await run([op('signed-answer',owner,'SAVE'),["INSERT INTO compliance_answers VALUES('solarcell','fixture','signed',1,'{}','signed-answer')"]]);
  await run([op('signed-form',owner,'SIGN'),["INSERT INTO compliance_signoffs VALUES('solarcell','fixture','signed',1,?,?, 'signed-form')",'{"answers":{}}','a'.repeat(64)]]);
  await assert.rejects(()=>run(decide('signed','signed-self',owner,owner,1)),/EXCEPTION_DENIED/);
  await request('visit-2',owner);
  await run([["UPDATE users SET disabled=0 WHERE id=?",other]]);
  await assert.rejects(()=>run(decide('visit-2','enabled-self',owner,owner,1)),/EXCEPTION_DENIED/);
  await run(disable);
  await run([
    ["INSERT INTO compliance_legacy_mappings(legacy_rule_id,workspace_id,revision_id,approved_by) VALUES('guard-legacy','solarcell','guard-rev',?)",owner],
    ["UPDATE job_types SET current_policy_version_id='guard-draft' WHERE id='jt-solar-install'"],
    ["INSERT INTO compliance_operations VALUES('pinned-create','solarcell',?,'CREATE','pinned',0,?)",owner,'a'.repeat(64)],
    ["INSERT INTO compliance_jobs(id,workspace_id,job_type_id,policy_id,title,operation_id) VALUES('pinned','solarcell','jt-solar-install','guard-draft','Pinned job','pinned-create')"]
  ]);
  await assert.rejects(()=>run([
    ["INSERT INTO compliance_operations VALUES('inherited-withdraw','solarcell',?,'WITHDRAW','pinned',1,?)",owner,'a'.repeat(64)],
    ["INSERT INTO compliance_decisions VALUES('solarcell','pinned','legacy:guard-legacy','WITHDRAW','Mistaken addition',?,1,'inherited-withdraw')",owner]
  ]),/EXCEPTION_DENIED/);
}
