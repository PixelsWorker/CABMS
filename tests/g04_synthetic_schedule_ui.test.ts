import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {SessionContext,type Session} from '../src/context/G01Session.tsx';
import {CabmsProvider} from '../src/context/CabmsContext.tsx';
import {ScheduleView} from '../src/views/ScheduleView.tsx';
import {setApiBase,resetApiBase} from '../src/services/g01Client.ts';
import {createLocalD1Database,type LocalD1Database} from '../backend/db/d1.ts';
import {runLocalMigrations} from '../backend/db/migrate.ts';
import {createWorker} from '../backend/index.ts';
import {createAuthenticationService} from '../backend/workers/auth.ts';
import {createFirebaseFixture} from './support/firebaseTokens.ts';
import {G01_TEST_AUTH,installG01TestAuthFixtures} from './support/g01SyntheticFixtures.ts';

test('authenticated synthetic scheduling creates, reschedules with new times and cancels the same saved job appointment',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const direct=(path:string,body:unknown)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await direct('enquiries',{customer_name:'Synthetic',service:'Synthetic appointment'})).json() as {id:string};
 const job=await (await direct(`enquiries/${e.id}/conversion`,{})).json() as {id:string};
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});
 let failAppointmentRefresh=false;
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(failAppointmentRefresh && request.method==='GET' && new URL(request.url).pathname.endsWith('/demo-appointments')) return Response.json({detail:'Synthetic refresh failure'},{status:503});
  return worker.fetch(request,env);
 });setApiBase('http://localhost');
 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();
 assert.match(container.textContent!,/Local demo records only/);assert.match(container.textContent!,/not connected/);
 const select=container.querySelector('select')!; const k=Object.keys(select).find(key=>key.startsWith('__reactProps$'))!;
 await act(async()=>{(select as any)[k].onChange({target:{value:job.id}});});
 const inputs=Array.from(container.querySelectorAll('input'));
 const start=inputs[0]!, end=inputs[1]!;
 const startProps=Object.keys(start).find(key=>key.startsWith('__reactProps$'))!;
 const endProps=Object.keys(end).find(key=>key.startsWith('__reactProps$'))!;
 await act(async()=>{(start as any)[startProps].onChange({target:{value:'invalid'}});});
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});
 assert.match(container.textContent!,/Enter valid UTC start and end times/);assert.doesNotMatch(container.textContent!,/outcome is unknown/);
 await act(async()=>{(start as any)[startProps].onChange({target:{value:'2026-11-05T01:00:00.000Z'}});});
 failAppointmentRefresh=true;
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Saved\. \(List refresh failed; displaying confirmed save\.\)/);
 assert.match(container.textContent!,new RegExp(job.id),'confirmed appointment remains visible when follow-up read fails');
 assert.match(container.textContent!,/scheduled - version 1/,'confirmed status remains visible when follow-up read fails');
 assert.doesNotMatch(container.textContent!,/outcome is unknown/);
 assert.equal(Array.from(container.querySelectorAll('button')).some(button=>button.disabled),false,'confirmed save remains unlocked when only the follow-up read fails');
 failAppointmentRefresh=false;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Refresh appointments')!.click();});await flush();
 assert.match(container.textContent!,new RegExp(job.id));assert.match(container.textContent!,/scheduled - version 1/);
 assert.doesNotMatch(container.textContent!,/List refresh failed/);
 const click=async(label:string)=>{await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent===label)!.click();});await flush();};
 // Reschedule regression: change actual UTC start and end times and assert persisted and displayed values
 await act(async()=>{(start as any)[startProps].onChange({target:{value:'2026-11-06T03:00:00.000Z'}});});
 await act(async()=>{(end as any)[endProps].onChange({target:{value:'2026-11-06T04:00:00.000Z'}});});
 await click('Reschedule using UTC fields');
 assert.match(container.textContent!,/scheduled - version 2/);
 assert.match(container.textContent!,/2026-11-06T03:00:00.000Z to 2026-11-06T04:00:00.000Z/);
 const persisted=await db.prepare('SELECT starts_at, ends_at, version, status FROM demo_appointments WHERE job_id=?').bind(job.id).first<{starts_at:string;ends_at:string;version:number;status:string}>();
 assert.equal(persisted?.starts_at,'2026-11-06T03:00:00.000Z');
 assert.equal(persisted?.ends_at,'2026-11-06T04:00:00.000Z');
 assert.equal(persisted?.version,2);
 assert.equal(persisted?.status,'scheduled');
 await click('Cancel appointment');assert.match(container.textContent!,/cancelled - version 3/);
 await act(async()=>root.unmount());
});

test('definite 409 conflict and 422 rejection do not lock the UI as uncertain',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const direct=(path:string,body:unknown)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await direct('enquiries',{customer_name:'Synthetic',service:'Synthetic appointment'})).json() as {id:string};
 const job=await (await direct(`enquiries/${e.id}/conversion`,{})).json() as {id:string};
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 let injectStatus:number|null=null;
 let injectDetail:string='Synthetic simulated rejection';
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(injectStatus && request.method==='POST' && new URL(request.url).pathname.endsWith('/demo-appointments')){
   return Response.json({detail:injectDetail},{status:injectStatus});
  }
  return worker.fetch(request,env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 const select=container.querySelector('select')!; const k=Object.keys(select).find(key=>key.startsWith('__reactProps$'))!;
 await act(async()=>{(select as any)[k].onChange({target:{value:job.id}});});

 // 409 conflict
 injectStatus=409;
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Save rejected: conflict or stale appointment version/);
 assert.doesNotMatch(container.textContent!,/Changes are locked/);
 assert.equal(Array.from(container.querySelectorAll('button')).some(b=>b.disabled),false,'form buttons remain unlocked on 409 conflict');

 // 422 validation failure
 injectStatus=422;
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Save rejected: invalid appointment parameters/);
 assert.doesNotMatch(container.textContent!,/Changes are locked/);
 assert.equal(Array.from(container.querySelectorAll('button')).some(b=>b.disabled),false,'form buttons remain unlocked on 422 rejection');

 // 403 permission denial (pre-write)
 injectStatus=403;
 injectDetail='You do not have access to this workspace';
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Save rejected: permission denied/);
 assert.doesNotMatch(container.textContent!,/Changes are locked/);
 assert.equal(Array.from(container.querySelectorAll('button')).some(b=>b.disabled),false,'form buttons remain unlocked on 403 rejection');

 // 403 post-write Permission changed locks the UI because write outcome is uncertain
 injectStatus=403;
 injectDetail='Permission changed';
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Save outcome is unknown/);
 assert.match(container.textContent!,/Changes are locked/);

 await act(async()=>root.unmount());
});

test('independent appointment loading renders appointments even when jobs list query fails',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const direct=(path:string,body:unknown)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await direct('enquiries',{customer_name:'Synthetic',service:'Synthetic appointment'})).json() as {id:string};
 const job=await (await direct(`enquiries/${e.id}/conversion`,{})).json() as {id:string};
 await direct('demo-appointments',{job_id:job.id,starts_at:'2026-11-05T01:00:00.000Z',ends_at:'2026-11-05T02:00:00.000Z'});

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(request.method==='GET' && new URL(request.url).pathname.endsWith('/jobs')) return Response.json({detail:'Simulated jobs outage'},{status:500});
  return worker.fetch(request,env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 // Appointments list is displayed despite jobs query failing
 assert.match(container.textContent!,new RegExp(job.id));
 assert.match(container.textContent!,/2026-11-05T01:00:00.000Z to 2026-11-05T02:00:00.000Z/);
 assert.match(container.textContent!,/scheduled - version 1/);
 const actionButtons=Array.from(container.querySelectorAll('button')).filter(b=>b.textContent==='Reschedule using UTC fields' || b.textContent==='Cancel appointment');
 assert.equal(actionButtons.length,2,'reschedule and cancel actions remain available when jobs request fails');
 const inputs=Array.from(container.querySelectorAll('input'));
 assert.equal(inputs.length,2,'UTC start and end inputs remain available when jobs request fails');
 assert.equal(container.querySelector('form'),null,'creation form remains hidden when jobs request fails');
 const startProps=Object.keys(inputs[0]!).find(key=>key.startsWith('__reactProps'))!;
 const endProps=Object.keys(inputs[1]!).find(key=>key.startsWith('__reactProps'))!;
 await act(async()=>{(inputs[0] as any)[startProps].onChange({target:{value:'2026-11-06T05:00:00.000Z'}});});
 await act(async()=>{(inputs[1] as any)[endProps].onChange({target:{value:'2026-11-06T06:00:00.000Z'}});});
 await act(async()=>{actionButtons.find(b=>b.textContent==='Reschedule using UTC fields')!.click();});await flush();
 assert.match(container.textContent!,/scheduled - version 2/);
 assert.match(container.textContent!,/2026-11-06T05:00:00.000Z to 2026-11-06T06:00:00.000Z/);
 await act(async()=>root.unmount());
});

test('production environment 404 displays disabled message and suppresses appointment creation controls',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'production',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  return worker.fetch(new Request(input,init),env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 assert.match(container.textContent!,/Synthetic scheduling is disabled in this environment/);
 assert.equal(container.querySelector('form'),null,'creation form is not displayed in production environment');
 assert.match(container.textContent!,/Field Service Dispatch & Calendar Scheduling/,'production session retains simulated dispatch calendar view');
 await act(async()=>root.unmount());
});

test('revocation or 403 access denial clears cached appointments list',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const direct=(path:string,body:unknown)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await direct('enquiries',{customer_name:'Synthetic',service:'Synthetic appointment'})).json() as {id:string};
 const job=await (await direct(`enquiries/${e.id}/conversion`,{})).json() as {id:string};
 await direct('demo-appointments',{job_id:job.id,starts_at:'2026-11-05T01:00:00.000Z',ends_at:'2026-11-05T02:00:00.000Z'});

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 let denyAccess=false;
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(denyAccess && request.method==='GET' && new URL(request.url).pathname.endsWith('/demo-appointments')){
   return Response.json({detail:'Access denied'},{status:403});
  }
  return worker.fetch(request,env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 assert.match(container.textContent!,new RegExp(job.id));
 denyAccess=true;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Refresh appointments')!.click();});await flush();
 assert.match(container.textContent!,/Access denied\. Synthetic appointments are unavailable\./);
 assert.equal(container.querySelectorAll('li').length, 0, 'appointments list is empty on 403 access denial');
 assert.doesNotMatch(container.textContent!,/scheduled - version 1/,'scheduled appointment record is removed on 403 access denial');

 await act(async()=>root.unmount());
});

test('authenticated technician session routes to simulated schedule view with technician scoping',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.technician;
 const token=await fixture.token(actor.uid,actor.email);

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  return worker.fetch(new Request(input,init),env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'technician'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 assert.match(container.textContent!,/Field Service Dispatch & Calendar Scheduling/);
 assert.doesNotMatch(container.textContent!,/Synthetic demo appointments/);
 await act(async()=>root.unmount());
});
