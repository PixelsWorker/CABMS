import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { DashboardView } from '../src/views/DashboardView.tsx';
import { useWorkspaceDemoData, demoDataMessage } from '../src/hooks/useWorkspaceDemoData.ts';
import { DemoJourneyError, demoJourneyRequest } from '../src/services/demoJourneyClient.ts';
import { setApiBase, resetApiBase } from '../src/services/g01Client.ts';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

test('saved-data errors retain only valid request references, with header fallback', async t => {
 t.after(()=>{mock.restoreAll();resetApiBase();}); setApiBase('http://localhost');
 let response=Response.json({detail:'Unavailable',request_id:'req_body-123'},{status:503,headers:{'X-Request-Id':'req_header-456'}});
 mock.method(globalThis,'fetch',async()=>response);
 await assert.rejects(()=>demoJourneyRequest('solarcell','test-token','jobs'),(e:unknown)=>e instanceof DemoJourneyError && e.requestId==='req_body-123' && e.message.includes('Ref: req_body-123'));
 response=Response.json({detail:'Unavailable',request_id:'unsafe reference'},{status:503,headers:{'X-Request-Id':'req_header-456'}});
 await assert.rejects(()=>demoJourneyRequest('solarcell','test-token','jobs'),(e:unknown)=>e instanceof DemoJourneyError && e.requestId==='req_header-456');
 response=Response.json({detail:'Unavailable',request_id:'unsafe reference'},{status:503,headers:{'X-Request-Id':'unsafe header'}});
 await assert.rejects(()=>demoJourneyRequest('solarcell','test-token','jobs'),(e:unknown)=>e instanceof DemoJourneyError && e.requestId===undefined && !e.message.includes('unsafe'));
});

test('authenticated UI saves enquiry, converts it, and reloads persisted records', async t => {
 const db=createLocalD1Database() as LocalD1Database; t.after(()=>db.getSqliteHandle().close());
 await runLocalMigrations(db,{disposableTest:true}); await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(), worker=createWorker(createAuthenticationService(fixture.transport));
 const env={DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'}, actor=G01_TEST_AUTH.officeStaff;
 const token=await fixture.token(actor.uid,actor.email);
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const key of keys){const d=saved.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key];}});
 let rejectNext = false; let rejectStep = false;
 mock.method(globalThis,'fetch',async (input: RequestInfo | URL, init?: RequestInit)=>{ if(rejectNext){rejectNext=false;return Response.json({detail:'Demo service unavailable'},{status:422});} if(rejectStep && init?.method==='PATCH'){rejectStep=false;return Response.json({detail:'Step conflict'},{status:409});} return worker.fetch(new Request(input,init),env); });
 setApiBase('http://localhost');
 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=>token,login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!;
 let root=createRoot(container);
 const render=async (view:React.ReactNode)=>act(async()=>{root.render(React.createElement(SessionContext.Provider, {value:session}, React.createElement(CabmsProvider, null, view)));await new Promise(r=>setTimeout(r,20));});
 const input=(node:HTMLInputElement,value:string)=>{const k=Object.keys(node).find(k=>k.startsWith('__reactProps$'))!;(node as any)[k].onChange({target:{value}});};
 await render(React.createElement(Navigation));
 const inboxButton=Array.from(container.querySelectorAll('button')).find(button=>button.title==='Website Enquiries');
 assert.ok(inboxButton);
 assert.equal(inboxButton.getAttribute('aria-label'),'Website Enquiries');
 assert.equal(inboxButton.querySelector('.cabms-nav-badge'),null);
 await render(React.createElement(WebsiteInboxView));
 const inputs=container.querySelectorAll('input');
 await act(async()=>{input(inputs[0],'Synthetic customer');input(inputs[1],'Synthetic installation');});
 rejectNext=true;
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Demo service unavailable/);
 assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM demo_enquiries').first<{count:number}>())?.count,0);
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Synthetic customer/);
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent?.includes('Convert to job'))!.click();});
 for (let i=0; i<100 && !container.textContent?.includes('Converted to job'); i++) await act(async()=>{await new Promise(r=>setTimeout(r,20));});
 assert.match(container.textContent!,/Converted to job/);
 await act(async()=>root.unmount()); root=createRoot(container);
 await render(React.createElement(WebsiteInboxView)); await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Synthetic customer/);assert.match(container.textContent!,/Converted to job/);
 await render(React.createElement(JobsView));await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Synthetic installation/);
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Open job')!.click(); await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Review job details/);
 rejectStep=true;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Mark step complete')!.click(); await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Step conflict/); assert.doesNotMatch(container.textContent!,/could not be confirmed/);
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Open job')!.click();});
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Open job')!.click(); await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Mark step complete')!.click(); await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Completed/);
 session.profile!.memberships[0].role='technician';
 await render(React.createElement(JobsView));
 assert.doesNotMatch(container.textContent!,/Review job details/);
 session.profile!.memberships[0].role='office_staff';
 await act(async()=>root.unmount()); root=createRoot(container); await render(React.createElement(JobsView)); await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Open job')!.click(); await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Completed/);
 await render(React.createElement(DashboardView)); await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Saved enquiries:\s*1/); assert.match(container.textContent!,/Saved jobs:\s*1/);
 await render(React.createElement(JobsView)); await act(async()=>{await new Promise(r=>setTimeout(r,30));});
 assert.match(container.textContent!,/Synthetic installation/);
 await act(async()=>root.unmount());
});

test('failed enquiry save does not discard a pending initial list', async t => {
 const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const key of keys){const d=saved.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key];}});
 setApiBase('http://localhost');
 let resolveInitial!: (response: Response) => void;
 mock.method(globalThis,'fetch',async (_input:RequestInfo | URL, init?:RequestInit) => {
  if (init?.method === 'POST') return Response.json({detail:'Invalid enquiry'}, {status:422});
  return new Promise<Response>(resolve=>{resolveInitial=resolve;});
 });
 const actor=G01_TEST_AUTH.officeStaff;
 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'test-token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!; const root=createRoot(container);
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(WebsiteInboxView))));await Promise.resolve();});
 assert.equal(typeof resolveInitial,'function');
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));});
 assert.match(container.textContent!,/Invalid enquiry/);
 await act(async()=>{resolveInitial(Response.json([{id:'existing',workspace_id:'solarcell',customer_name:'Existing synthetic customer',service:'Inspection',created_at:'2026',job_id:null}]));await new Promise(r=>setTimeout(r,0));});
 assert.match(container.textContent!,/Existing synthetic customer/);
 await act(async()=>root.unmount());
});

test('successful save with failed reload reports reference, ignores stale read and isolates workspace', async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const key of keys){const d=saved.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key];}});
 setApiBase('http://localhost');
 let resolveOld!: (r:Response)=>void; let reads=0;
 mock.method(globalThis,'fetch',async (url:RequestInfo | URL,init?:RequestInit)=>{
  if(init?.method==='POST') return Response.json({id:'new'},{status:201});
  if(String(url).includes('/cctv/')) return Response.json([{id:'cctv',workspace_id:'cctv',customer_name:'CCTV only',service:'Synthetic',created_at:'2026',job_id:null}]);
  if(++reads===1) return new Promise<Response>(resolve=>{resolveOld=resolve;});
  return Response.json({detail:'Temporarily unavailable'},{status:503,headers:{'X-Request-Id':'req_test-123'}});
 });
 const actor=G01_TEST_AUTH.officeStaff;
 const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'},{workspace_id:'cctv',name:'CCTV',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'test-token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!;const root=createRoot(container);
 const render=async(value:Session)=>act(async()=>{root.render(React.createElement(SessionContext.Provider,{value},React.createElement(CabmsProvider,null,React.createElement(WebsiteInboxView))));await new Promise(r=>setTimeout(r,0));});
 await render(session);
 await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));});
 assert.match(container.textContent!,/Saved, but the enquiry list could not be reloaded/);assert.match(container.textContent!,/Ref: req_test-123/);
 await render({...session,workspaceId:'cctv'});
 assert.match(container.textContent!,/CCTV only/);
 await act(async()=>{resolveOld(Response.json([{id:'old',customer_name:'Stale old result',service:'Synthetic'}]));await new Promise(r=>setTimeout(r,0));});
 assert.match(container.textContent!,/CCTV only/);assert.doesNotMatch(container.textContent!,/Stale old result|req_test-123/);
 await act(async()=>root.unmount());
});

test('workspace data reader isolates identities and workspaces and distinguishes API states', async t => {
 const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const key of keys){const d=saved.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key];}});
 setApiBase('http://localhost');
 const pending: Array<{url:string; resolve:(response:Response)=>void}> = [];
 mock.method(globalThis,'fetch',(input:RequestInfo | URL)=>new Promise<Response>(resolve=>{pending.push({url:String(input),resolve});}));
 const profile=(id:string)=>({user:{id,email:`${id}@example.invalid`,display_name:id},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff' as const},{workspace_id:'cctv',name:'CCTV',role:'office_staff' as const}]});
 const base:Session={profile:profile('a'),workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'test-token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 function Probe() {const state=useWorkspaceDemoData(true);return React.createElement('div',null,state.status === 'ready' ? `ready ${state.enquiries.length} ${state.jobs.map(j=>j.title).join(',')}` : `${state.status} ${demoDataMessage(state)}`);}
 const container=dom.window.document.getElementById('root')!; const root=createRoot(container);
 const render=async(session:Session)=>act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(Probe)));await Promise.resolve();});
 const settle=async(index:number,body:unknown,status=200)=>act(async()=>{pending[index].resolve(Response.json(body,{status}));await Promise.resolve();});
 await render(base); assert.match(container.textContent!,/^loading/); assert.equal(pending.length,2);
 const changed={...base,workspaceId:'cctv' as const}; await render(changed); assert.match(container.textContent!,/^loading/); assert.equal(pending.length,4);
 assert.match(pending[2].url,/workspaces\/cctv\/jobs/);
 await settle(2,[{id:'j2',workspace_id:'cctv',enquiry_id:'e2',title:'CCTV saved',created_at:'now'}]); await settle(3,[]);
 assert.match(container.textContent!,/^ready 0 CCTV saved/);
 await settle(0,[{id:'old',title:'Stale Solarcell'}]); await settle(1,[{id:'old'}]);
 assert.match(container.textContent!,/^ready 0 CCTV saved/); assert.doesNotMatch(container.textContent!,/Stale/);
 await render({...changed,profile:profile('b')}); assert.match(container.textContent!,/^loading/); assert.doesNotMatch(container.textContent!,/CCTV saved/);
 await settle(4,[]); await settle(5,[]); assert.match(container.textContent!,/^ready 0\s*$/);
 for (const [status, expected] of [[401,'unauthenticated'],[403,'forbidden'],[503,'unavailable'],[500,'error']] as const) {
  const before=pending.length; await render({...changed,profile:profile(`user${status}`)}); assert.match(container.textContent!,/^loading/);
  await settle(before,{detail:'failure'},status); assert.match(container.textContent!,new RegExp('^'+expected));
  assert.doesNotMatch(container.textContent!,/CCTV saved|ready 0/);
  await settle(before+1,[]);
 }
 const beforeRoleSwitch=pending.length;
 const sameUser={...base,profile:profile('role-test')};
 await render(sameUser); assert.equal(pending.length,beforeRoleSwitch+2);
 const technician:Session={...sameUser,profile:{...sameUser.profile!,memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'technician'}]}};
 await render(technician);
 assert.match(container.textContent!,/^restricted .*restricted to office staff and administrators/);
 assert.equal(pending.length,beforeRoleSwitch+2, 'technician must not issue saved-data requests');
 await settle(beforeRoleSwitch,[{id:'old',title:'No longer authorized'}]); await settle(beforeRoleSwitch+1,[]);
 assert.match(container.textContent!,/^restricted/); assert.doesNotMatch(container.textContent!,/No longer authorized/);
 await render(sameUser); assert.match(container.textContent!,/^loading/);
 assert.equal(pending.length,beforeRoleSwitch+4, 'restored office membership must refetch');
 await settle(beforeRoleSwitch+2,[]); await settle(beforeRoleSwitch+3,[]); assert.match(container.textContent!,/^ready 0/);
 await act(async()=>root.unmount());
});

test('demo requests time out without retrying a possibly committed write', async t => {
 t.after(()=>{mock.restoreAll();resetApiBase();}); setApiBase('http://localhost');
 let calls=0; const realTimeout=AbortSignal.timeout;
 mock.method(AbortSignal,'timeout',()=>realTimeout(20));
 mock.method(globalThis,'fetch',async (_input:RequestInfo|URL, init?:RequestInit)=>{calls++;return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true}));});
 await assert.rejects(demoJourneyRequest('solarcell','token','jobs'));
 await assert.rejects(demoJourneyRequest('solarcell','token','enquiries','POST',{customer_name:'Synthetic',service:'Demo'}));
 assert.equal(calls,2);
});

test('timed-out enquiry write clears busy without automatic retry', async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const names=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 for(const n of names) Object.defineProperty(globalThis,n,{configurable:true,writable:true,value:n==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[n]});
 const root=createRoot(dom.window.document.getElementById('root')!);
 t.after(async()=>{await act(async()=>root.unmount()); mock.restoreAll();resetApiBase();dom.window.close();for(const n of names){const d=saved.get(n);if(d)Object.defineProperty(globalThis,n,d);else delete (globalThis as any)[n];}});
 const realTimeout=AbortSignal.timeout; mock.method(AbortSignal,'timeout',()=>realTimeout(20)); let writes=0;
 mock.method(globalThis,'fetch',async (_input:RequestInfo|URL,init?:RequestInit)=>{if(init?.method!=='POST')return Response.json([{id:'synthetic-1',workspace_id:'solarcell',customer_name:'Synthetic',service:'Demo',created_at:'2026-01-01',job_id:writes>=2?'synthetic-job':null}]);writes++;return new Promise<Response>((_resolve,reject)=>init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true}));}); setApiBase('http://localhost');
 const actor=G01_TEST_AUTH.officeStaff; const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(WebsiteInboxView))));});
 const doc=dom.window.document; const inputs=doc.querySelectorAll('input');
 await act(async()=>{for(const [index,value] of ['Synthetic','Demo'].entries()){const node=inputs[index];const key=Object.keys(node).find(k=>k.startsWith('__reactProps$'))!;(node as any)[key].onChange({target:{value}});}});
 await act(async()=>{doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,50));});
 assert.equal(writes,1); await act(async()=>{doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));}); assert.equal(writes,1); const save=Array.from(doc.querySelectorAll('button')).find(b=>b.textContent?.includes('Save enquiry'))!;assert.equal(save.disabled,true);assert.match(doc.body.textContent!,/outcome is unknown/);
 const convert=Array.from(doc.querySelectorAll('button')).find(b=>b.textContent?.includes('Convert to job'))!;
 await act(async()=>{convert.click();await new Promise(r=>setTimeout(r,50));});
 assert.equal(writes,2);assert.match(doc.body.textContent!,/Converted to job synthetic-job/);assert.doesNotMatch(doc.body.textContent!,/conversion outcome may still be pending/);assert.equal(save.disabled,true);
});

test('committed enquiry with lost response is not automatically retried', async t => {
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>{mock.restoreAll();resetApiBase();db.getSqliteHandle().close();});
 await runLocalMigrations(db,{disposableTest:true});await installG01TestAuthFixtures(db);
 const fixture=await createFirebaseFixture(), worker=createWorker(createAuthenticationService(fixture.transport));const actor=G01_TEST_AUTH.officeStaff;const token=await fixture.token(actor.uid,actor.email);let posts=0;setApiBase('http://localhost');
 const originalTimeout=AbortSignal.timeout; mock.method(AbortSignal,'timeout',()=>originalTimeout(50));
 mock.method(globalThis,'fetch',async(input:RequestInfo|URL,init?:RequestInit)=>{posts++;const result=await worker.fetch(new Request(input,init),{DB:db,ENVIRONMENT:'test',FIREBASE_PROJECT_ID:'cabms-test'});assert.equal(result.status,201);return new Promise<Response>((_resolve,reject)=>{if(init!.signal!.aborted)reject(init!.signal!.reason);else init!.signal!.addEventListener('abort',()=>reject(init!.signal!.reason),{once:true});});});
 await assert.rejects(demoJourneyRequest('solarcell',token,'enquiries','POST',{customer_name:'Synthetic',service:'Demo'}));
 assert.equal(posts,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM demo_enquiries').first<{n:number}>())?.n,1);
});

async function recoveryHarness(t: import('node:test').TestContext, postStatus: number | 'lost') {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const names=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
 for(const n of names) Object.defineProperty(globalThis,n,{configurable:true,writable:true,value:n==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[n]});
 const root=createRoot(dom.window.document.getElementById('root')!);const doc=dom.window.document;
 t.after(async()=>{await act(async()=>root.unmount());mock.restoreAll();resetApiBase();dom.window.close();for(const n of names){const d=saved.get(n);if(d)Object.defineProperty(globalThis,n,d);else delete (globalThis as any)[n];}});
 setApiBase('http://localhost');let posts=0,gets=0;let rows:any[]=[];let failGet=false;let pendingGet:Promise<Response>|null=null;
 mock.method(globalThis,'fetch',async(_input:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST'){posts++;if(postStatus==='lost')throw Error('connection lost');return Response.json({detail:'Request failed'},{status:postStatus});}
  gets++;if(pendingGet){const value=pendingGet;pendingGet=null;return value;}if(failGet)return Response.json({detail:'List unavailable'},{status:503});return Response.json(rows);
 });
 const actor=G01_TEST_AUTH.officeStaff;const session:Session={profile:{user:{id:actor.userId,email:actor.email,display_name:actor.name},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'},{workspace_id:'cctv',name:'CCTV',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const render=async(value:Session|null)=>act(async()=>{root.render(React.createElement(SessionContext.Provider,{value},React.createElement(CabmsProvider,null,React.createElement(WebsiteInboxView))));await new Promise(r=>setTimeout(r,0));});
 await render(session);
 const input=async()=>act(async()=>{const inputs=doc.querySelectorAll('input');for(const [i,value] of ['Synthetic','Demo'].entries()){const node=inputs[i];const key=Object.keys(node).find(k=>k.startsWith('__reactProps$'))!;(node as any)[key].onChange({target:{value}});}});
 const submit=async()=>act(async()=>{doc.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await new Promise(r=>setTimeout(r,0));});
 const button=(name:string)=>Array.from(doc.querySelectorAll('button')).find(b=>b.textContent?.includes(name))!;
 const click=async(name:string)=>act(async()=>{button(name).focus();button(name).click();await new Promise(r=>setTimeout(r,0));});
 return {doc,session,render,input,submit,button,click,get posts(){return posts;},get gets(){return gets;},setRows:(value:any[])=>{rows=value;},setFail:(value:boolean)=>{failGet=value;},setPending:(value:Promise<Response>)=>{pendingGet=value;}};
}

test('uncertain save refreshes GET only and never unlocks on empty or matching results',async t=>{
 const h=await recoveryHarness(t,'lost');await h.input();await h.submit();
 assert.equal(h.posts,1);assert.equal(h.gets,2);assert.equal(h.button('Save enquiry').disabled,true);
 assert.match(h.doc.body.textContent!,/may have succeeded/);assert.match(h.doc.body.textContent!,/does not resubmit/);assert.match(h.doc.body.textContent!,/connection lost/);
 assert.equal(h.doc.querySelectorAll('input')[0].value,'Synthetic');assert.equal(h.doc.querySelectorAll('input')[1].value,'Demo');
 h.setFail(true);await h.click('Refresh saved enquiries');assert.match(h.doc.body.textContent!,/save outcome is unknown.*could not be reloaded/i);assert.equal(h.button('Save enquiry').disabled,true);
 h.setFail(false);h.setRows([{id:'unrelated',workspace_id:'solarcell',customer_name:'Synthetic',service:'Demo',created_at:'2026',job_id:null}]);
 const refresh=h.button('Refresh saved enquiries');assert.equal(refresh.type,'button');refresh.focus();assert.equal(h.doc.activeElement,refresh);await h.click('Refresh saved enquiries');
 assert.match(h.doc.body.textContent!,/Synthetic — Demo/);assert.equal(h.button('Save enquiry').disabled,true);await h.submit();assert.equal(h.posts,1);
 // Model the original request committing only after the first empty reconciliation GET.
 const delayedCommit=()=>h.setRows([{id:'late',workspace_id:'solarcell',customer_name:'Synthetic',service:'Demo',created_at:'2026',job_id:null}]);
 delayedCommit();await h.click('Refresh saved enquiries');assert.match(h.doc.body.textContent!,/Synthetic — Demo/);assert.equal(h.button('Save enquiry').disabled,true);assert.equal(h.posts,1);
});
for(const status of [408,503,422] as const) test(`save HTTP ${status} ${status===422?'remains correctable':'remains uncertain'}`,async t=>{
 const h=await recoveryHarness(t,status);await h.input();await h.submit();assert.equal(h.posts,1);assert.equal(h.button('Save enquiry').disabled,status!==422);assert.equal(h.doc.querySelectorAll('input')[0].value,'Synthetic');assert.equal(h.gets,2, 'refreshes the authorized list without repeating the write');if(status===422)assert.match(h.doc.body.textContent!,/Request failed/);else {assert.match(h.doc.body.textContent!,/outcome is unknown/);assert.match(h.doc.body.textContent!,/Request failed/);}
});

test('late refresh from previous workspace and user does not replace current data',async t=>{
 const h=await recoveryHarness(t,'lost');await h.input();await h.submit();assert.equal(h.button('Save enquiry').disabled,true);let release!:(r:Response)=>void;h.setPending(new Promise<Response>(resolve=>{release=resolve;}));
 await act(async()=>{h.button('Refresh saved enquiries').click();await Promise.resolve();});
 const changed={...h.session,workspaceId:'cctv' as const,profile:{...h.session.profile!,user:{...h.session.profile!.user,id:'different-user'}}};h.setRows([{id:'new',workspace_id:'cctv',customer_name:'Current user',service:'CCTV',created_at:'2026',job_id:null}]);await h.render(changed);assert.match(h.doc.body.textContent!,/Current user/);
 await act(async()=>{release(Response.json([{id:'old',workspace_id:'solarcell',customer_name:'Old private record',service:'Old',created_at:'2026',job_id:null}]));await new Promise(r=>setTimeout(r,0));});assert.doesNotMatch(h.doc.body.textContent!,/Old private record/);assert.match(h.doc.body.textContent!,/Current user/);
});

test('uncertain conversion remains locked until its own job is confirmed',async t=>{
 const h=await recoveryHarness(t,'lost');h.setRows([{id:'e1',workspace_id:'solarcell',customer_name:'Customer',service:'Demo',created_at:'2026',job_id:null}]);await h.click('Refresh saved enquiries');await h.click('Convert to job');assert.equal(h.posts,1);assert.equal(h.button('Convert to job').disabled,true);
 h.setFail(true);await h.click('Refresh saved enquiries');assert.match(h.doc.body.textContent!,/could not be reloaded/);h.setFail(false);
 await h.click('Refresh saved enquiries');assert.equal(h.button('Convert to job').disabled,true);assert.equal(h.posts,1);
 h.setRows([{id:'e1',workspace_id:'solarcell',customer_name:'Customer',service:'Demo',created_at:'2026',job_id:'job1'}]);await h.click('Refresh saved enquiries');assert.match(h.doc.body.textContent!,/Converted to job job1/);assert.doesNotMatch(h.doc.body.textContent!,/conversion outcome may still be pending/);assert.equal(h.posts,1);
});

for(const change of ['identity','workspace','signout'] as const) test(`stale refresh is ignored after ${change}`,async t=>{
 const h=await recoveryHarness(t,'lost');await h.input();await h.submit();let release!:(r:Response)=>void;h.setPending(new Promise<Response>(resolve=>{release=resolve;}));
 await act(async()=>{h.button('Refresh saved enquiries').click();await Promise.resolve();});
 h.setRows([{id:'new',workspace_id:change==='workspace'?'cctv':'solarcell',customer_name:'Fresh scoped row',service:'Synthetic',created_at:'2026',job_id:null}]);
 const next=change==='signout'?null:change==='workspace'?{...h.session,workspaceId:'cctv' as const}:{...h.session,profile:{...h.session.profile!,user:{...h.session.profile!.user,id:'new-identity'}}};
 await h.render(next);if(next)assert.match(h.doc.body.textContent!,/Fresh scoped row/);
 await act(async()=>{release(Response.json([{id:'old',workspace_id:'solarcell',customer_name:'Stale scoped row',service:'Synthetic',created_at:'2026',job_id:null}]));await new Promise(r=>setTimeout(r,0));});
 assert.doesNotMatch(h.doc.body.textContent!,/Stale scoped row/);if(next)assert.match(h.doc.body.textContent!,/Fresh scoped row/);
});

for (const status of [500, 502, 504] as const) test(`save HTTP ${status} stays locked and refresh is GET only`, async t => {
 const h=await recoveryHarness(t,status);await h.input();await h.submit();
 assert.equal(h.posts,1);assert.equal(h.button('Save enquiry').disabled,true);assert.match(h.doc.body.textContent!,/outcome is unknown/);
 const refresh=h.button('Refresh saved enquiries');assert.equal(refresh.type,'button');assert.equal(refresh.closest('form'),null);assert.equal(refresh.tabIndex,0);assert.equal(refresh.disabled,false);refresh.focus();assert.equal(h.doc.activeElement,refresh);
 const before=h.gets;await h.click('Refresh saved enquiries');assert.equal(h.gets,before+1);assert.equal(h.posts,1);assert.equal(h.button('Save enquiry').disabled,true);
});


test('authenticated enquiry badge follows saved inbox and hides on failed or unauthorized workspace loads', async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 const keys=['window','document','navigator','HTMLElement','HTMLInputElement','IS_REACT_ACT_ENVIRONMENT'];
 const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 for(const key of keys) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value:key==='IS_REACT_ACT_ENVIRONMENT'?true:(dom.window as any)[key]});
 t.after(()=>{mock.restoreAll();resetApiBase();dom.window.close();for(const key of keys){const d=saved.get(key);if(d)Object.defineProperty(globalThis,key,d);else delete (globalThis as any)[key];}});
 let rows: Array<{id:string;customer_name:string;service:string;job_id:string|null}> = [];
 let fail=false; let rejectWrite=false; let holdRead=false; let releaseRead: ((response:Response)=>void) | null=null;
 const channels: Array<any> = [];
 class FakeBroadcastChannel { onmessage: ((event:{data:unknown})=>void)|null=null; constructor(public name:string){channels.push(this);} postMessage(data:unknown){for(const channel of channels) if(channel!==this && channel.name===this.name) channel.onmessage?.({data});} close(){const i=channels.indexOf(this);if(i>=0)channels.splice(i,1);} }
 Object.defineProperty(dom.window,'BroadcastChannel',{value:FakeBroadcastChannel,configurable:true});
 mock.method(globalThis,'fetch',async (input:RequestInfo|URL,init?:RequestInit)=>{
  const req=new Request(input,init), path=new URL(req.url).pathname;
  if(path.includes('/cctv/')) return Response.json({detail:'Forbidden'},{status:403});
  if(req.method==='GET') { if(holdRead){holdRead=false;return await new Promise<Response>(resolve=>{releaseRead=resolve;});} return fail ? Response.json({detail:'Unavailable'},{status:503}) : Response.json(rows); }
  if(req.method==='POST' && path.endsWith('/enquiries')) {if(rejectWrite) return Response.json({detail:'Rejected'},{status:422});const body=await req.json() as {customer_name:string;service:string};rows.push({id:String(rows.length+1),...body,job_id:null});return Response.json({id:rows.length},{status:201});}
  if(req.method==='POST' && path.endsWith('/conversion')) {const id=path.split('/').at(-2);rows=rows.map(row=>row.id===id?{...row,job_id:'job-'+id}:row);return Response.json({id:'job-'+id},{status:201});}
  throw new Error('Unexpected request');
 });
 setApiBase('http://localhost');
 const session:Session={profile:{user:{id:'test-user',email:'synthetic@example.invalid',display_name:'Demo'},memberships:[{workspace_id:'solarcell',name:'Solarcell',role:'office_staff'},{workspace_id:'cctv',name:'CCTV',role:'office_staff'}]},workspaceId:'solarcell',selectWorkspace:()=>{},token:async()=> 'token',login:async()=>{},logout:async()=>{},invalidate:()=>{},loading:false,error:''};
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 const render=async(value:Session|null)=>act(async()=>{root.render(React.createElement(SessionContext.Provider,{value},React.createElement(CabmsProvider,null,value?.profile && React.createElement(Navigation),value?.profile && React.createElement(WebsiteInboxView))));await new Promise(r=>setTimeout(r,30));});
 const flush=async()=>act(async()=>{await new Promise(r=>setTimeout(r,30));});
 const button=()=>Array.from(container.querySelectorAll('button')).find(x=>x.title==='Website Enquiries')!;
 const badge=()=>button().querySelector('.cabms-nav-badge')?.textContent ?? null;
 const change=(input:HTMLInputElement,value:string)=>{const key=Object.keys(input).find(k=>k.startsWith('__reactProps$'))!;(input as any)[key].onChange({target:{value}});};
 await render(session); await flush(); assert.equal(badge(),null);
 const add=async(name:string)=>{const inputs=container.querySelectorAll('input');await act(async()=>{change(inputs[0],name);change(inputs[1],'Synthetic service');});await act(async()=>{container.querySelector('form')!.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));});await flush();};
 await add('Synthetic one');assert.equal(badge(),'1');
 await add('Synthetic two');assert.equal(badge(),'2');
 const oldRows=structuredClone(rows); holdRead=true;
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Refresh saved enquiries')!.click();await new Promise(r=>setTimeout(r,10));});
 rows.push({id:'external',customer_name:'Other tab',service:'Synthetic',job_id:null});
 await act(async()=>{const other=new dom.window.BroadcastChannel('cabms:enquiry-count-invalidated');other.postMessage({workspace:'solarcell',userId:'other-user',count:999});other.close();});await flush();assert.equal(badge(),'3');
 assert.ok(releaseRead); await act(async()=>{(releaseRead as (response:Response)=>void)(Response.json(oldRows));});await flush();assert.equal(badge(),'3', 'an older inbox response cannot overwrite the newer authorized count');
 rows=rows.filter(row=>row.id!=='external');await act(async()=>{dom.window.dispatchEvent(new dom.window.Event('focus'));});await flush();assert.equal(badge(),'2');
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Convert to job')!.click();});await flush();assert.equal(badge(),'1');
 await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Refresh saved enquiries')!.click();});await flush();assert.equal(badge(),'1');
 rejectWrite=true;await add('Rejected synthetic');assert.equal(badge(),'1');rejectWrite=false;
 fail=true;await act(async()=>{Array.from(container.querySelectorAll('button')).find(x=>x.textContent==='Refresh saved enquiries')!.click();});await flush();assert.equal(badge(),null);
 fail=false;await render({...session,workspaceId:'cctv'});await flush();assert.equal(badge(),null);
 await render(session);await flush();assert.equal(badge(),'1');
 await render({...session,profile:null,workspaceId:null});await flush();assert.equal(container.querySelector('.cabms-nav-badge'),null);
 await render(null); await act(async()=>root.unmount());
});
