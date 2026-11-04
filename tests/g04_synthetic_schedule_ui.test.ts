import {test,mock} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {SessionContext,type Session} from '../src/context/G01Session.tsx';
import {CabmsProvider, useCabms} from '../src/context/CabmsContext.tsx';
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
 let injectCode:string|undefined=undefined;
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(injectStatus && request.method==='POST' && new URL(request.url).pathname.endsWith('/demo-appointments')){
   return Response.json({detail:injectDetail,code:injectCode},{status:injectStatus});
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
 injectCode='ACCESS_DENIED';
 injectDetail='You do not have access to this workspace';
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();
 assert.match(container.textContent!,/Save rejected: permission denied/);
 assert.doesNotMatch(container.textContent!,/Changes are locked/);
 assert.equal(Array.from(container.querySelectorAll('button')).some(b=>b.disabled),false,'form buttons remain unlocked on 403 rejection');

 // 403 post-write Permission changed locks the UI because write outcome is uncertain
 injectStatus=403;
 injectCode='PERMISSION_CHANGED';
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

 function TechnicianScopingRig(){
  const {createJob}=useCabms();
  const createdRef=React.useRef(false);
  React.useEffect(()=>{
   if(createdRef.current)return;
   createdRef.current=true;
   createJob({
    brandId:'solarcell',
    title:'Solar Inverter Inspection by Alex',
    scheduledDate:'2026-11-02',
    scheduledTime:'11:00',
    appointmentStatus:'SCHEDULED',
    assignedTechId:'TECH-002',
    assignedTechName:'Alex Taylor',
    status:'IN_PROGRESS',
   });
   createJob({
    brandId:'solarcell',
    title:'Unscheduled Solar Maintenance by Alex',
    appointmentStatus:'UNSCHEDULED',
    assignedTechId:'TECH-002',
    assignedTechName:'Alex Taylor',
    status:'IN_PROGRESS',
   });
  },[createJob]);
  return React.createElement(ScheduleView);
 }

 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(TechnicianScopingRig))));});await flush();

 assert.match(container.textContent!,/Field Service Dispatch & Calendar Scheduling/);
 assert.doesNotMatch(container.textContent!,/Synthetic demo appointments/);

 // Technician scoping: assigned jobs for TECH-001 (Dave Miller) in solarcell are visible
 assert.match(container.textContent!,/JOB-2026-101/,'technician sees own assigned job');
 assert.match(container.textContent!,/Dave Miller/,'technician sees own assignment name');

 // Technician scoping: other technician's jobs (TECH-002 / Alex Taylor) in the SAME authorized solarcell workspace are strictly hidden
 assert.doesNotMatch(container.textContent!,/Solar Inverter Inspection by Alex/,'technician cannot view another technician scheduled job in same workspace');
 assert.doesNotMatch(container.textContent!,/Unscheduled Solar Maintenance by Alex/,'technician cannot view another technician unscheduled job in same workspace');
 assert.doesNotMatch(container.textContent!,/Alex Taylor/,'technician cannot view another technician name in dispatch');
 assert.doesNotMatch(container.textContent!,/TECH-002/,'technician cannot view other technician ID');

 await act(async()=>root.unmount());
});

test('401 or 403 access denial during mutation clears previously loaded appointment records',async t=>{
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

 let injectStatus:number|null=null;
 let injectDetail:string='Access denied';
 let injectCode:string|undefined=undefined;
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(injectStatus && (request.method==='POST' || request.method==='PATCH') && new URL(request.url).pathname.includes('/demo-appointments')){
   return Response.json({detail:injectDetail,code:injectCode},{status:injectStatus});
  }
  return worker.fetch(request,env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 // Confirm appointment is loaded initially
 assert.match(container.textContent!,new RegExp(job.id));
 assert.match(container.textContent!,/scheduled - version 1/);
 assert.equal(container.querySelectorAll('li').length,1);

 // 1. HTTP 401 during mutation: clears records, shows session error, remains unlocked
 injectStatus=401;
 injectCode='AUTHENTICATION_REQUIRED';
 injectDetail='Unauthorized';
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Cancel appointment')!.click();});await flush();
 assert.match(container.textContent!,/Session could not be verified; sign in again\./);
 assert.equal(container.querySelectorAll('li').length,0,'appointments list is cleared on 401 mutation failure');
 assert.doesNotMatch(container.textContent!,/Changes are locked/,'401 error does not lock form as uncertain');

 // Restore appointment for next check
 injectStatus=null;
 injectCode=undefined;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Refresh appointments')!.click();});await flush();
 assert.match(container.textContent!,new RegExp(job.id));
 assert.equal(container.querySelectorAll('li').length,1);

 // 2. HTTP 403 pre-write rejection during mutation with ACCESS_DENIED and custom detail text:
 // Clears records, shows permission denied including custom text, remains unlocked
 injectStatus=403;
 injectCode='ACCESS_DENIED';
 injectDetail='Custom pre-write rejection detail';
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Cancel appointment')!.click();});await flush();
 assert.match(container.textContent!,/Save rejected: permission denied\. \(Custom pre-write rejection detail\)/);
 assert.equal(container.querySelectorAll('li').length,0,'appointments list is cleared on 403 pre-write rejection');
 assert.doesNotMatch(container.textContent!,/Changes are locked/,'403 pre-write rejection does not lock form as uncertain');

 // Restore appointment for next check
 injectStatus=null;
 injectCode=undefined;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Refresh appointments')!.click();});await flush();
 assert.match(container.textContent!,new RegExp(job.id));
 assert.equal(container.querySelectorAll('li').length,1);

 // 3. HTTP 403 post-write permission revocation during mutation with PERMISSION_CHANGED and custom detail text:
 // Clears records, locks UI as uncertain, safety does NOT depend on human-readable detail text
 injectStatus=403;
 injectCode='PERMISSION_CHANGED';
 injectDetail='Custom permission revoked detail';
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Cancel appointment')!.click();});await flush();
 assert.match(container.textContent!,/Save outcome is unknown/);
 assert.match(container.textContent!,/Changes are locked/);
 assert.equal(container.querySelectorAll('li').length,0,'appointments list is cleared on 403 post-write revocation');

 // 4. HTTP 403 with missing or unknown code is handled conservatively as uncertain outcome:
 // Simulating navigating away and back to clear the view-level lock per design
 await act(async()=>root.unmount());
 const container2=dom.window.document.getElementById('root')!,root2=createRoot(container2);
 injectStatus=null;
 injectCode=undefined;
 await act(async()=>{root2.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();
 assert.match(container2.textContent!,new RegExp(job.id));
 assert.equal(container2.querySelectorAll('li').length,1);

 injectStatus=403;
 injectCode=undefined;
 injectDetail='Unrecognized error without structured code';
 await act(async()=>{Array.from(container2.querySelectorAll('button')).find(b=>b.textContent==='Cancel appointment')!.click();});await flush();
 assert.match(container2.textContent!,/Save outcome is unknown/);
 assert.match(container2.textContent!,/Changes are locked/);
 assert.equal(container2.querySelectorAll('li').length,0,'missing 403 code conservatively clears records and locks form');

 await act(async()=>root2.unmount());
});

test('disabled-environment state persists across same-workspace profile and role refreshes even when subsequent read fails',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'production',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 let failWith500=false;
 let recoverWith200=false;
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(request.method==='GET' && new URL(request.url).pathname.includes('/demo-appointments')){
   if(recoverWith200){
    return Response.json([]);
   }
   if(failWith500){
    return Response.json({detail:'Internal Server Outage'},{status:500});
   }
  }
  if(request.method==='GET' && new URL(request.url).pathname.includes('/jobs')){
   return Response.json([{id:'JOB-RECOVERED-01',title:'Recovered Solar Job'}]);
  }
  return worker.fetch(request,env);
 });setApiBase('http://localhost');

 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 // Initial 404 disables synthetic scheduling and displays fallback simulated calendar
 assert.match(container.textContent!,/Synthetic scheduling is disabled in this environment/);
 assert.equal(container.querySelector('form'),null,'creation form is suppressed in disabled environment');
 assert.match(container.textContent!,/Field Service Dispatch & Calendar Scheduling/,'simulated fallback calendar is rendered');

 // Profile refresh with role update where subsequent read encounters transient 500 failure
 failWith500=true;
 const updatedSession:Session={...session,profile:{...session.profile!,memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'owner_admin'}]}};
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:updatedSession},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 // Disabled environment state and message persist across same-workspace role update and non-404 failure
 assert.match(container.textContent!,/Synthetic scheduling is disabled in this environment/,'disabled message preserved across role update and transient failure');
 assert.equal(container.querySelector('form'),null,'creation form remains suppressed');
 assert.match(container.textContent!,/Field Service Dispatch & Calendar Scheduling/,'fallback calendar remains rendered');
 assert.doesNotMatch(container.textContent!,/Unable to load synthetic appointments/,'generic load error does not overwrite disabled environment status');

 // Environment recovery: subsequent read succeeds with 200
 failWith500=false;
 recoverWith200=true;

 // Assert probe button is available and mutation form remains suppressed before probe
 const probeBtn=Array.from(container.querySelectorAll('button')).find(b=>b.textContent==='Check availability');
 assert.ok(probeBtn,'availability probe button is reachable while environment is disabled');
 assert.equal(container.querySelector('form'),null,'mutation controls remain suppressed before retry succeeds');

 await act(async()=>{
  probeBtn!.click();
 });await flush();

 // Assert that a successful API response clears the disabled state and restores the expected controls
 assert.doesNotMatch(container.textContent!,/Synthetic scheduling is disabled in this environment/,'disabled message cleared on recovery');
 assert.notEqual(container.querySelector('form'),null,'creation form is restored after recovery');
 assert.notEqual(container.querySelector('input'),null,'UTC inputs are restored after recovery');
 assert.equal(Array.from(container.querySelectorAll('button')).some(b=>b.textContent==='Refresh appointments'),true,'Refresh appointments button restored');
 assert.doesNotMatch(container.textContent!,/Field Service Dispatch & Calendar Scheduling/,'fallback simulated calendar is unmounted once live controls recover');

 await act(async()=>root.unmount());
});

test('confirmed appointment save is preserved in UI when same-user role refresh occurs while save is in flight',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(),worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'},actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const direct=(path:string,body:unknown)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)}),env);
 const e=await (await direct('enquiries',{customer_name:'Synthetic Staff',service:'Solar Inverter'})).json() as {id:string};
 const job=await (await direct(`enquiries/${e.id}/conversion`,{})).json() as {id:string};

 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'}),keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const k of keys)Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:k==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[k]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const k of keys){const d=saved.get(k);if(d)Object.defineProperty(globalThis,k,d);else delete (globalThis as any)[k];}});

 let interceptPost=false;
 let failSubsequentGet=false;
 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const updatedSession:Session={...session,profile:{...session.profile!,memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'owner_admin'}]}};
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{
  const request=new Request(input,init);
  if(interceptPost && request.method==='POST' && new URL(request.url).pathname.endsWith('/demo-appointments')){
   interceptPost=false;
   // Execute backend write to D1
   const res=await worker.fetch(request,env);
   // Simulate a same-user profile and role refresh occurring in the UI before the write response resolves
   await act(async()=>{
    root.render(React.createElement(SessionContext.Provider,{value:updatedSession},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));
   });
   failSubsequentGet=true;
   return res;
  }
  if(failSubsequentGet && request.method==='GET' && new URL(request.url).pathname.endsWith('/demo-appointments')){
   return new Response(JSON.stringify({error:'transient_refresh_failure'}),{status:500,headers:{'Content-Type':'application/json'}});
  }
  return worker.fetch(request,env);
 });setApiBase('http://localhost');
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,40));});
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(ScheduleView))));});await flush();

 for(let i=0;i<50 && !container.querySelector(`select option[value="${job.id}"]`);i++){
  await flush();
 }

 const select=container.querySelector('select')!; const k=Object.keys(select).find(key=>key.startsWith('__reactProps$'))!;
 await act(async()=>{(select as any)[k].onChange({target:{value:job.id}});});

 // Trigger appointment creation with in-flight role refresh simulation
 interceptPost=true;
 await act(async()=>{
  container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
 });await flush();

 for(let i=0;i<50 && container.querySelectorAll('li').length===0;i++){
  await flush();
 }

 // Confirmed write is recorded in state and visible in UI, NOT discarded
 assert.equal(container.querySelectorAll('li').length,1,'confirmed saved appointment is preserved in appointments list');
 assert.match(container.textContent!,new RegExp(job.id),'job ID is present in confirmed appointment list');
 assert.match(container.textContent!,/Saved\. \(List refresh failed; displaying confirmed save\.\)/,'explicit saved-but-refresh-failed status is displayed');
 assert.doesNotMatch(container.textContent!,/Changes are locked/,'UI is not locked as uncertain on confirmed save');

 await act(async()=>root.unmount());
});

test('pending appointment read resolving after mutation authorization failure cannot repopulate cleared appointments', async t => {
  const db = createLocalD1Database() as LocalD1Database; t.after(() => db.getSqliteHandle().close());
  await runLocalMigrations(db, { disposableTest: true }); await installG01TestAuthFixtures(db);
  const fixture = await createFirebaseFixture(), worker = createWorker(createAuthenticationService(fixture.transport));
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' }, actor = G01_TEST_AUTH.officeStaff;
  const token = await fixture.token(actor.uid, actor.email);
  const direct = (path: string, body: unknown) => worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env);
  const e = await (await direct('enquiries', { customer_name: 'Race Staff', service: 'Solar Inverter' })).json() as { id: string };
  const job = await (await direct(`enquiries/${e.id}/conversion`, {})).json() as { id: string };
  await direct('demo-appointments', { job_id: job.id, starts_at: '2026-11-05T01:00:00.000Z', ends_at: '2026-11-05T02:00:00.000Z' });

  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' }), keys = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  t.after(() => { mock.restoreAll(); resetApiBase(); dom.window.close(); for (const k of keys) { const d = saved.get(k); if (d) Object.defineProperty(globalThis, k, d); else delete (globalThis as any)[k]; } });

  let resolveHoldGet: ((res: Response) => void) | null = null;
  let interceptGet = false;
  let mutateStatus: number | null = null;

  const session: Session = { profile: { user: { id: actor.userId, email: actor.email, display_name: actor.name }, memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' }] }, workspaceId: 'solarcell', selectWorkspace: () => {}, token: async () => token, login: async () => {}, logout: async () => {}, invalidate: () => {}, loading: false, error: '' };

  mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (interceptGet && request.method === 'GET' && url.pathname.endsWith('/demo-appointments')) {
      interceptGet = false;
      return new Promise<Response>(resolve => {
        resolveHoldGet = resolve;
      });
    }
    if (mutateStatus && request.method === 'PATCH' && url.pathname.includes('/demo-appointments/')) {
      const status = mutateStatus;
      mutateStatus = null;
      return new Response(JSON.stringify({ error: 'access_denied', code: 'ACCESS_DENIED', message: 'User membership was revoked.' }), { status, headers: { 'Content-Type': 'application/json' } });
    }
    return worker.fetch(request, env);
  });
  setApiBase('http://localhost');
  const container = dom.window.document.getElementById('root')!, root = createRoot(container);
  const flush = async () => act(async () => { await new Promise(r => setTimeout(r, 40)); });

  // Initial render: loads existing appointment
  await act(async () => { root.render(React.createElement(SessionContext.Provider, { value: session }, React.createElement(CabmsProvider, null, React.createElement(ScheduleView)))); });
  await flush();

  assert.equal(container.querySelectorAll('li').length, 1, 'initial appointment is rendered');
  assert.match(container.textContent!, new RegExp(job.id));

  // Arm interceptor to hold the next GET pending
  interceptGet = true;
  const refreshBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Refresh appointments');
  assert.ok(refreshBtn, 'refresh button exists');
  await act(async () => { refreshBtn!.click(); });
  await flush();

  // The GET is now held pending in-flight. Trigger a mutation that fails with 403 ACCESS_DENIED
  mutateStatus = 403;
  const cancelBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel appointment');
  assert.ok(cancelBtn, 'cancel appointment button exists');
  await act(async () => { cancelBtn!.click(); });
  await flush();

  // Mutation returned 403: appointment rows cleared and permission denied message shown
  assert.equal(container.querySelectorAll('li').length, 0, 'appointments list cleared on mutation authorization rejection');
  assert.match(container.textContent!, /Save rejected: permission denied/, 'permission denied message is displayed');

  // Allow the old held GET request to finally resolve with 200 and appointment data
  assert.ok(resolveHoldGet, 'resolveHoldGet callback was registered');
  const oldGetResponse = await worker.fetch(new Request('http://localhost/api/v1/workspaces/solarcell/demo-appointments', { headers: { Authorization: `Bearer ${token}` } }), env);
  await act(async () => {
    resolveHoldGet!(oldGetResponse);
  });
  await flush();

  // Assert that authEpoch / epoch invalidation prevented the stale GET from restoring appointments
  assert.equal(container.querySelectorAll('li').length, 0, 'stale GET response cannot repopulate appointments list after authorization failure');
  assert.match(container.textContent!, /Save rejected: permission denied/, 'permission denied message remains preserved');

  await act(async () => root.unmount());
});
