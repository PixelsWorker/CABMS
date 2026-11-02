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
