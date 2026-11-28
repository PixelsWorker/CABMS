import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {CabmsProvider,useCabms} from '../src/context/CabmsContext.tsx';
import {SessionContext,type Session} from '../src/context/G01Session.tsx';
import {setApiFetchHandler,resetApiFetchHandler} from '../src/services/g01Client.ts';

test('authenticated template reload retains server draft and published history',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
 const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator}))Object.defineProperty(globalThis,key,{configurable:true,value});
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const session:Session={profile:{user:{id:'owner',email:'owner@example.invalid',display_name:null},memberships:[{workspace_id:'solarcell',role:'owner_admin',name:'Solarcell'}]},loading:false,error:'',login:async()=>{},logout:async()=>{},token:async()=>'test-token',workspaceId:'solarcell',selectWorkspace:()=>{},invalidate:()=>{}};
 const detail={id:'tpl-server',code:'terms',name:'Terms',template_type:'QUOTE_TERMS',status:'ACTIVE',current_revision_id:'pub-id',current_version:'v1.0',current_content:'Approved',revision_status:'PUBLISHED',updated_at:'2026-01-01T00:00:00Z',revisions:[{id:'draft-id',version:'v2.0-draft',status:'DRAFT',content:'Draft wording',created_at:'2026-02-01T00:00:00.000Z',updated_at:'2026-02-01T00:00:00.000Z'},{id:'pub-id',version:'v1.0',status:'PUBLISHED',content:'Approved',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}]};
 const paths:string[]=[];let updates=0;setApiFetchHandler(async req=>{const p=new URL(req.url).pathname;paths.push(p);if(req.method==='PATCH' && p.endsWith('/job-types/jt-pending'))return Response.json({detail:'Duplicate code'},{status:409});if(p.endsWith('/job-types/jt-pending'))return Response.json({policies:[{id:'draft-policy',version:'v2.0',status:'DRAFT',formsRequired:[],is_direct_to_invoice:0,updated_at:'2026-02-01',created_by:'owner'},{id:'published-policy',version:'v1.0',status:'PUBLISHED',formsRequired:[],is_direct_to_invoice:0,updated_at:'2026-01-01',created_by:'owner'}]});if(req.method==='PUT' && p.endsWith('/templates/tpl-server/revisions/draft-id')) {updates++;assert.equal(req.headers.get('If-Match'),'"2026-02-01T00:00:00.000Z"');return Response.json({updated_at:'2026-02-01T00:00:00.001Z'});}if(p.endsWith('/job-types'))return Response.json([{id:'jt-pending',name:'Pending',code:'pending',brand_id:'solarcell',forms_required:[],is_direct_to_invoice:0,version:'v1.0',status:'DRAFT',policy_status:'PUBLISHED',current_policy_version_id:'published-policy',updated_at:'2026-01-01T00:00:00.000Z'}]);if(p.endsWith('/templates/tpl-server'))return Response.json(detail);if(p.endsWith('/templates'))return Response.json([detail]);return Response.json([]);});
 let ctx!:ReturnType<typeof useCabms>;function Capture(){ctx=useCabms();return null;}
 const root=createRoot(dom.window.document.getElementById('root')!);
 try{
  await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(CabmsProvider,null,React.createElement(Capture))));});
  await act(async()=>{ctx.setActiveTab('templates');});
  await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  assert.ok(paths.some(p=>p.endsWith('/templates/tpl-server')),'full history must be loaded from the server');
  assert.ok(paths.some(p=>p.endsWith('/job-types/jt-pending')),'policy history must be loaded from the server');
  assert.equal(ctx.jobTypes.find(j=>j.id==='jt-pending')?.revisionHistory?.find(r=>r.status==='DRAFT')?.id,'draft-policy');
  assert.equal(ctx.jobTypes.find(j=>j.id==='jt-pending')?.currentPolicyId,'published-policy');
  await act(async()=>{ctx.submitJobTypePolicyForReview('jt-pending');await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  assert.ok(paths.some(p=>p.endsWith('/job-types/jt-pending/policies/draft-policy/review')),'review uses the server draft ID');
  assert.equal(ctx.jobTypes.find(j=>j.id==='jt-pending')?.currentPolicyId,'published-policy');
  const form=ctx.templates.find(t=>t.id==='tpl-server');assert.ok(form);
  assert.equal(form.editingRevisionId,'draft-id');assert.equal(form.currentRevisionId,'pub-id');assert.equal(form.publishedVersion,'v1.0');assert.equal(form.content,'Draft wording');assert.equal(form.revisions.length,2);
  await act(async()=>{ctx.createTemplateDraftRevision('tpl-server','Saved draft');await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  assert.equal(updates,1);const saved=ctx.templates.find(t=>t.id==='tpl-server')!;
  assert.equal(saved.content,'Saved draft');assert.equal(saved.currentRevisionId,'pub-id');assert.equal(saved.revisions[0].updatedAt,'2026-02-01T00:00:00.001Z');
  let quote:ReturnType<typeof ctx.prepareQuoteForJob> | undefined;
  await act(async()=>{quote=ctx.prepareQuoteForJob('JOB-2026-101','Draft test',[{id:'1',description:'Synthetic item',quantity:1,unitPrice:100,total:100}]);});
  assert.equal(quote?.termsVersion,'v1.0');
  assert.equal(quote?.termsContentSnapshot,'Approved');
  await act(async()=>{const result=await ctx.editJobType('jt-pending',{name:'Rejected'});assert.equal(result.success,false);});
  assert.equal(ctx.jobTypes.find(j=>j.id==='jt-pending')?.name,'Pending');
  assert.equal(ctx.demoNotification?.type,'error');
  await act(async()=>{assert.throws(()=>ctx.createJob({brandId:'solarcell',jobType:'jt-pending'}),/published policy/i);});
  setApiFetchHandler(async req=>{const p=new URL(req.url).pathname;if(p.endsWith('/templates/tpl-server'))return Response.json({detail:'Unavailable'},{status:503});if(p.endsWith('/templates'))return Response.json([detail]);return Response.json([]);});
  await act(async()=>{ctx.setActiveTab('dashboard');});
  await act(async()=>{ctx.setActiveTab('templates');});
  await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});
  assert.equal(ctx.templates.length,0,'failed history reload must not show stale or demo templates');
  assert.equal(ctx.demoNotification?.type,'error');
 }finally{await act(async()=>root.unmount());resetApiFetchHandler();dom.window.close();for(const [key,value] of Object.entries(previous))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
