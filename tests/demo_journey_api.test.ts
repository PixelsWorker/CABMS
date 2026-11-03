import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import { createEnquiry } from '../backend/modules/demoJourney/demoJourneyRepo.ts';

test('demo enquiry conversion persists once, isolates workspaces, and rejects unauthorised users', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true}); await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(); const worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'};
 const staff=await fixture.token(G01_TEST_AUTH.officeStaff.uid,G01_TEST_AUTH.officeStaff.email);
 const technician=await fixture.token(G01_TEST_AUTH.technician.uid,G01_TEST_AUTH.technician.email);
 const call=(path:string,method='GET',body?:unknown,token=staff)=>worker.fetch(new Request(`http://local/api/v1/workspaces/${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(body ? {'Content-Type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})}),env);
 assert.equal((await call('solarcell/enquiries','GET',undefined,'bad')).status,401);
 assert.equal((await call('cctv/enquiries')).status,403);
 for (const path of ['solarcell/jobs/%ZZ','solarcell/jobs/valid/steps/%ZZ']) { const response=await call(path); assert.equal(response.status,400); assert.ok(response.headers.get('X-Request-Id')); }
 assert.equal((await call('solarcell/enquiries','GET',undefined,technician)).status,403);
 assert.equal((await call('solarcell/enquiries','POST',{customer_name:'',service:'Demo'})).status,422);
 const created=await call('solarcell/enquiries','POST',{customer_name:'Synthetic Client',service:'Demo service'}); assert.equal(created.status,201);
 const {id}=await created.json() as {id:string};
 assert.equal((await call(`cctv/enquiries/${id}/conversion`,'POST')).status,403);
 const results=await Promise.all([call(`solarcell/enquiries/${id}/conversion`,'POST'),call(`solarcell/enquiries/${id}/conversion`,'POST')]);
 assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
 const enquiries=await (await call('solarcell/enquiries')).json() as Array<{id:string;job_id:string}>;
 const jobs=await (await call('solarcell/jobs')).json() as Array<{id:string;enquiry_id:string}>;
 assert.equal(jobs.length,1); assert.equal(enquiries[0].job_id,jobs[0].id); assert.equal(jobs[0].enquiry_id,id);
 const jobId=jobs[0].id;
 const detailResponse=await call(`solarcell/jobs/${jobId}`); assert.ok(detailResponse.headers.get('X-Request-Id'));
 const detail=await detailResponse.json() as {steps:Array<{id:string;state:string;required:number}>};
 assert.equal(detail.steps[0].state,'pending'); assert.equal(detail.steps[0].required,1);
 const step=encodeURIComponent(detail.steps[0].id);
 assert.equal((await call(`cctv/jobs/${jobId}/steps/${step}`,'PATCH',{state:'done'})).status,403);
 assert.equal((await call(`solarcell/jobs/${jobId}/steps/${step}`,'PATCH',{state:'done'},technician)).status,403);
 const completed=await call(`solarcell/jobs/${jobId}/steps/${step}`,'PATCH',{state:'done'}); assert.equal(completed.status,200); assert.ok(completed.headers.get('X-Request-Id'));
 const refreshed=await (await call(`solarcell/jobs/${jobId}`)).json() as {steps:Array<{state:string;required:number}>};
 assert.equal(refreshed.steps[0].state,'done'); assert.equal(refreshed.steps[0].required,1);
 const previous = await (await call(`solarcell/jobs/${jobId}`)).json() as {steps:Array<{updated_at:string}>};
 assert.equal((await call(`solarcell/jobs/${jobId}/steps/${step}`,'PATCH',{state:'done'})).status,200);
 const again = await (await call(`solarcell/jobs/${jobId}`)).json() as {steps:Array<{updated_at:string}>};
 assert.equal(again.steps[0].updated_at,previous.steps[0].updated_at);
 await db.prepare("UPDATE demo_job_steps SET state='skipped' WHERE id=?").bind(detail.steps[0].id).run();
 assert.equal((await call(`solarcell/jobs/${jobId}/steps/${step}`,'PATCH',{state:'done'})).status,409);
 const skipped=await db.prepare('SELECT state FROM demo_job_steps WHERE id=?').bind(detail.steps[0].id).first<{state:string}>();
 assert.equal(skipped?.state,'skipped');

});

test('failed job insertion leaves the enquiry unconverted and no partial job', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true}); await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(), worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'}, token=await fixture.token(G01_TEST_AUTH.officeStaff.uid,G01_TEST_AUTH.officeStaff.email);
 const call=(path:string,method='GET',body?:unknown)=>worker.fetch(new Request(`http://local/api/v1/workspaces/solarcell/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body ? {body:JSON.stringify(body)}:{})}),env);
 const created=await call('enquiries','POST',{customer_name:'Synthetic',service:'Install'}); const {id}=await created.json() as {id:string};
 await db.exec("CREATE TRIGGER test_reject_demo_job BEFORE INSERT ON demo_jobs BEGIN SELECT RAISE(ABORT, 'forced failure'); END;");
 assert.equal((await call(`enquiries/${id}/conversion`,'POST')).status,500);
 assert.equal((await (await call('jobs')).json() as unknown[]).length,0);
 assert.equal((await (await call('enquiries')).json() as Array<{job_id:null}>)[0].job_id,null);
});

test('write boundary refuses an identity whose membership was revoked after an earlier check', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true}); await installG01TestAuthFixtures(db);
 const actor=G01_TEST_AUTH.officeStaff;
 const auth={userId:actor.userId,email:actor.email,displayName:actor.name,providerId:'firebase',providerSubjectId:actor.uid};
 await db.prepare('DELETE FROM workspace_memberships WHERE workspace_id=? AND user_id=?').bind('solarcell',actor.userId).run();
 assert.equal(await createEnquiry(db,'solarcell',auth,{customer_name:'Synthetic',service:'test'}),null);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM demo_enquiries').first<{count:number}>())?.count,0);
});

test('migration 0009 backfills existing jobs on a disposable database', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 const {loadVerifiedMigrations}=await import('../backend/db/migrate.ts');
 const migrations=loadVerifiedMigrations();
 for (const m of migrations.filter(m=>m.name!=='0009_demo_job_steps.sql')) await db.exec(m.bytes.toString('utf8'));
 await db.exec("INSERT INTO demo_enquiries (id,workspace_id,customer_name,service,created_at) VALUES ('e','solarcell','Synthetic','Demo','2026-01-01'); INSERT INTO demo_jobs (id,workspace_id,enquiry_id,title,created_at) VALUES ('j','solarcell','e','Demo','2026-01-01');");
 await db.exec(migrations.find(m=>m.name==='0009_demo_job_steps.sql')!.bytes.toString('utf8'));
 const step=await db.prepare("SELECT job_id, required, state FROM demo_job_steps WHERE job_id='j'").first<{job_id:string;required:number;state:string}>();
 assert.deepEqual({...step},{job_id:'j',required:1,state:'pending'});
});
