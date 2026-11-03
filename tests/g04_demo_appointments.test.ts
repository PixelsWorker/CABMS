import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

test('synthetic appointments enforce workspace access, valid times and optimistic transitions', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true}); await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const staff=await fixture.token(G01_TEST_AUTH.officeStaff.uid,G01_TEST_AUTH.officeStaff.email);
 const tech=await fixture.token(G01_TEST_AUTH.technician.uid,G01_TEST_AUTH.technician.email);
 const admin=await fixture.token(G01_TEST_AUTH.superAdmin.uid,G01_TEST_AUTH.superAdmin.email);
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'};
 const call=(path:string,method='GET',body?:unknown,token=staff,envOverride=env)=>worker.fetch(new Request(`http://local/api/v1/workspaces/${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),envOverride);
 const e=await (await call('solarcell/enquiries','POST',{customer_name:'Synthetic',service:'Demo'})).json() as {id:string};
 const j=await (await call(`solarcell/enquiries/${e.id}/conversion`,'POST')).json() as {id:string};
 const base={job_id:j.id,starts_at:'2026-11-05T01:00:00.000Z',ends_at:'2026-11-05T02:00:00.000Z'};
 assert.equal((await call('solarcell/demo-appointments','GET',undefined,'bad')).status,401);
 assert.equal((await call('cctv/demo-appointments')).status,403);
 assert.equal((await call('solarcell/demo-appointments','GET',undefined,tech)).status,403);
 assert.equal((await call('solarcell/demo-appointments','POST',{...base,starts_at:'2026-02-30T01:00:00.000Z'})).status,422);
 assert.equal((await call('solarcell/demo-appointments','POST',{...base,ends_at:base.starts_at})).status,422);
 assert.equal((await call('solarcell/demo-appointments','POST',{...base,job_id:'wrong'})).status,409);
 const created=await call('solarcell/demo-appointments','POST',base); assert.equal(created.status,201);
 const a=await created.json() as {id:string;version:number;job_id:string}; assert.equal(a.job_id,j.id);assert.equal(a.version,1);
 // Even an actor authorized in both workspaces cannot cross-link or mutate another workspace's records.
 assert.equal((await call('cctv/demo-appointments','POST',base,admin)).status,409);
 assert.equal((await call(`cctv/demo-appointments/${a.id}`,'PATCH',{version:1,status:'cancelled'},admin)).status,409);
 assert.deepEqual(await (await call('cctv/demo-appointments','GET',undefined,admin)).json(),[]);
 const changed={version:1,starts_at:'2026-11-06T01:00:00.000Z',ends_at:'2026-11-06T02:00:00.000Z'};
 const concurrent=await Promise.all([call(`solarcell/demo-appointments/${a.id}`,'PATCH',changed),call(`solarcell/demo-appointments/${a.id}`,'PATCH',changed)]);
 assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
 assert.equal((await call(`cctv/demo-appointments/${a.id}`,'PATCH',{version:2,status:'cancelled'})).status,403);
 assert.equal((await call(`solarcell/demo-appointments/${a.id}`,'PATCH',{version:2,status:'cancelled'})).status,200);
 assert.equal((await call(`solarcell/demo-appointments/${a.id}`,'PATCH',{...changed,version:3})).status,409);
 const list=await (await call('solarcell/demo-appointments')).json() as Array<{status:string;version:number}>;assert.equal(list[0].status,'cancelled');assert.equal(list[0].version,3);
 assert.equal((await call('solarcell/demo-appointments','GET',undefined,staff,{...env,ENVIRONMENT:'production'})).status,404);
});


test('revocation immediately before the appointment insert denies the write', async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport)),actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'};
 const call=(path:string,body:unknown)=>worker.fetch(new Request(`http://local/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await call('enquiries',{customer_name:'Synthetic',service:'Demo'})).json() as {id:string};
 const j=await (await call(`enquiries/${e.id}/conversion`,{})).json() as {id:string};let revoked=false;
 const guarded={prepare:(sql:string)=>{if(!revoked && sql.includes('INSERT INTO demo_appointments')){db.getSqliteHandle().prepare('DELETE FROM workspace_memberships WHERE user_id=? AND workspace_id=?').run(actor.userId,'solarcell');revoked=true;}return db.prepare(sql);},exec:(sql:string)=>db.exec(sql),dump:()=>db.dump(),batch:db.batch.bind(db)};
 const response=await worker.fetch(new Request('http://local/api/v1/workspaces/solarcell/demo-appointments',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({job_id:j.id,starts_at:'2026-11-05T01:00:00.000Z',ends_at:'2026-11-05T02:00:00.000Z'})}),{...env,DB:guarded});
 assert.equal(revoked,true);assert.equal(response.status,403);assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM demo_appointments').first<{count:number}>())?.count,0);
});

test('revocation immediately before an appointment update denies the write', async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport)),actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'};
 const call=(path:string,body:unknown)=>worker.fetch(new Request(`http://local/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await call('enquiries',{customer_name:'Synthetic',service:'Demo'})).json() as {id:string};
 const j=await (await call(`enquiries/${e.id}/conversion`,{})).json() as {id:string};
 const a=await (await call('demo-appointments',{job_id:j.id,starts_at:'2026-11-05T01:00:00.000Z',ends_at:'2026-11-05T02:00:00.000Z'})).json() as {id:string};let revoked=false;
 const guarded={prepare:(sql:string)=>{if(!revoked && sql.includes('UPDATE demo_appointments')){db.getSqliteHandle().prepare('DELETE FROM workspace_memberships WHERE user_id=? AND workspace_id=?').run(actor.userId,'solarcell');revoked=true;}return db.prepare(sql);},exec:(sql:string)=>db.exec(sql),dump:()=>db.dump(),batch:db.batch.bind(db)};
 const response=await worker.fetch(new Request(`http://local/api/v1/workspaces/solarcell/demo-appointments/${a.id}`,{method:'PATCH',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({version:1,status:'cancelled'})}),{...env,DB:guarded});
 assert.equal(revoked,true);assert.equal(response.status,403);
 const row=await db.prepare('SELECT status, version FROM demo_appointments WHERE id=?').bind(a.id).first<{status:string;version:number}>();assert.equal(row?.status,'scheduled');assert.equal(row?.version,1);
});
