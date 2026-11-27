import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync,readdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {build} from 'esbuild';
import {proposalPath} from '../support/proposalPath.ts';
import type {D1Database} from '../../backend/db/d1.ts';

export async function browserJourney(workerUrl:string,base:string,office:string,technician:string,admin:string,db:D1Database){
 const receipts:{method:string;path:string;status:number}[]=[];
 const workspace=base.slice(0,base.lastIndexOf('/'));
 const getJson=async<T>(path:string,actor:string):Promise<T>=>{
  const response=await fetch(new URL(path,workerUrl),{headers:{Authorization:actor}});
  assert.equal(response.status,200,await response.clone().text());
  return response.json() as Promise<T>;
 };
 const post=async<T>(path:string,actor:string,status:number,body?:unknown,headers:Record<string,string>={}):Promise<T>=>{
  const response=await fetch(new URL(path,workerUrl),{method:'POST',headers:{Authorization:actor,'Content-Type':'application/json',...headers},
   body:body===undefined?undefined:JSON.stringify(body)});
  receipts.push({method:'POST',path,status:response.status});
  assert.equal(response.status,status,await response.clone().text());
  return response.json() as Promise<T>;
 };
 const {id:form,revision_id}=await post<{id:string;revision_id:string}>(workspace+'/form-definitions',office,201,{
  title:'Switchboard safety inspection',code:'SYNC-FORM-001',description:'Disposable synchronization fixture',category:'Custom',brand_id:'solarcell',
  schema:{sections:[{title:'Inspection',fields:[
   {key:'result',label:'Result',type:'PASS_FAIL',required:true},
   {key:'reason',label:'Explain failure',type:'TEXT',required:true,visible_when:{field:'result',equals:'FAIL'}},
   {key:'proof',label:'Proof',type:'PHOTO',required:true},
  ]}]},
 });
 const typeInput={name:'Synchronization inspection fixture',code:'SYNC-TYPE-001',brandId:'solarcell',
  isDirectToInvoice:false,formRules:[{form_revision_id:revision_id,required:true}]};
 await post(workspace+'/job-types',office,422,typeInput);
 const formPath=workspace+'/form-definitions/'+form+'/revisions/'+revision_id;
 const formDetail=await getJson<{revisions:Array<{id:string;updated_at:string}>}>(workspace+'/form-definitions/'+form,office);
 await post(formPath+'/review',office,200,{expected_updated_at:formDetail.revisions.find(r=>r.id===revision_id)?.updated_at});
 await post(formPath+'/approve',office,403);
 await post(formPath+'/approve',admin,200);
 const {id:type,policyId}=await post<{id:string;policyId:string}>(workspace+'/job-types',office,201,typeInput);
 const policyPath=workspace+'/job-types/'+type+'/policies/'+policyId;
 await post(policyPath+'/review',office,200);
 await post(policyPath+'/approve',admin,200);
 const {job_id}=await post<{job_id:string}>(base,office,201,
  {title:'Switchboard inspection',job_type_id:type,expected_policy_id:policyId,customer_name:'Fixture Customer',site_address:'1 Fixture Street'},
  {'Idempotency-Key':'browser-inspection'});
 const {revision_id:nextRevision}=await post<{revision_id:string}>(workspace+'/form-definitions/'+form+'/revisions',office,201);
 const nextFormPath=workspace+'/form-definitions/'+form+'/revisions/'+nextRevision;
 const nextFormDetail=await getJson<{revisions:Array<{id:string;updated_at:string}>}>(workspace+'/form-definitions/'+form,office);
 await post(nextFormPath+'/review',office,200,{expected_updated_at:nextFormDetail.revisions.find(r=>r.id===nextRevision)?.updated_at});
 await post(nextFormPath+'/approve',admin,200);
 const {id:nextPolicy}=await post<{id:string}>(workspace+'/job-types/'+type+'/policies',office,201,{
  isDirectToInvoice:false,formRules:[{form_revision_id:nextRevision,required:true}],
 });
 await post(workspace+'/job-types/'+type+'/policies/'+nextPolicy+'/review',office,200);
 await post(workspace+'/job-types/'+type+'/policies/'+nextPolicy+'/approve',admin,200);
 assert.equal(await db.prepare('SELECT current_policy_version_id FROM job_types WHERE id=?').bind(type).first('current_policy_version_id'),nextPolicy);
 await post(base,office,409,{title:'Stale selected policy',job_type_id:type,expected_policy_id:policyId,
  customer_name:'Fixture Customer',site_address:'1 Fixture Street'},{'Idempotency-Key':'browser-stale-policy'});
 await post(base+'/'+job_id+'?operation=ASSIGN',office,200,{assignee_id:'test_g01_usr_technician'},
  {'Idempotency-Key':'sync-browser-assignment','If-Match':'"1"'});
 await db.prepare("INSERT INTO compliance_signer_grants(workspace_id,revision_id,user_id) VALUES('solarcell',?,'test_g01_usr_technician')").bind(revision_id).run();
 await post(workspace+'/visits',office,200,{visit_id:'browser-inspection-visit',job_id,version:1,technician_id:'test_g01_usr_technician',
  starts_at:'2025-01-01T00:00:00.000Z',duration_minutes:60,status:'SCHEDULED',reason:''},{'Idempotency-Key':'browser-inspection-visit'});
 const bundle=await build({entryPoints:['tests/support/complianceBrowserEntry.tsx'],bundle:true,write:false,platform:'browser',jsx:'automatic',plugins:[{name:'local-auth',setup(b){b.onResolve({filter:/services\/firebase\.ts$/},()=>({path:'local',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const auth={}; export const googleAuthProvider={}; export const selectAccountGoogleProvider={};'}));}}],define:{'process.env.NODE_ENV':'"production"'}});
 const assets=readdirSync('dist/assets').filter(name=>name.endsWith('.css'));assert.equal(assets.length,1);
 const css=readFileSync('dist/assets/'+assets[0]);
 const html='<!doctype html><html lang="en"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>CABMS compliance fixture</title><link rel=stylesheet href=/work.css></head><body><div id="root"></div><script src="/ui.js"></script></body></html>';
 const server=createServer(async(req,res)=>{
  try{
   const path=new URL(req.url!,'http://localhost');
   if(path.pathname==='/fixture-token'){res.setHeader('Cache-Control','no-store');res.end(path.searchParams.get('actor')==='office'?office.slice(7):path.searchParams.get('actor')==='admin'?admin.slice(7):technician.slice(7));return;}
   if(path.pathname==='/ui.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);return;}
   if(path.pathname==='/work.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
   if(path.pathname==='/fixture-dashboard-counts'){
    const counts=await db.prepare(`SELECT
      count(*) FILTER(WHERE j.status='OPEN') AS open,
      count(*) FILTER(WHERE j.status='COMPLETED') AS completed,
      count(*) FILTER(WHERE j.status='CANCELLED') AS cancelled,
      count(*) FILTER(WHERE j.status='OPEN' AND EXISTS(
        SELECT 1 FROM compliance_answers a WHERE a.workspace_id=j.workspace_id AND a.job_id=j.id
      )) AS in_progress,
      count(*) FILTER(WHERE j.status='OPEN' AND EXISTS(
        SELECT 1 FROM compliance_visit_events AS v
        WHERE v.workspace_id=j.workspace_id AND v.job_id=j.id AND v.status='SCHEDULED'
        AND v.version=(SELECT max(h.version) FROM compliance_visit_events h WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id)
      )) AS scheduled FROM compliance_jobs j WHERE j.workspace_id='solarcell'`).first();
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(counts));return;
   }
   if(path.pathname.startsWith('/api/v1/')){
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);
    const headers=new Headers();for(const name of ['Authorization','Content-Type','If-Match','Idempotency-Key','X-Answer-Version']){
     const value=req.headers[name.toLowerCase()];if(typeof value==='string')headers.set(name,value);
    }
    const resp=await fetch(new URL(path.pathname+path.search,workerUrl),{method:req.method,headers,body:chunks.length?Buffer.concat(chunks):undefined});
    if(path.pathname.includes('/compliance-jobs')||path.pathname.endsWith('/visits')){
     receipts.push({method:req.method??'GET',path:path.pathname+(path.searchParams.has('view')?'?view='+path.searchParams.get('view'):''),status:resp.status});
    }
    res.writeHead(resp.status,{'Content-Type':resp.headers.get('Content-Type')??'application/json'});res.end(Buffer.from(await resp.arrayBuffer()));return;
   }
   res.setHeader('Content-Type','text/html');res.end(html);
  }catch{res.writeHead(500);res.end('Fixture request failed');}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const out=process.env.CABMS_COMPLIANCE_BROWSER_OUTPUT??proposalPath('..','four-screen-completion-sprint','browser-disposable');mkdirSync(out,{recursive:true});
  try{
   await promisify(execFile)('python',['tests/support/compliance_browser.py','http://127.0.0.1:'+address.port,out],{timeout:120000});
   const stored=await db.prepare(`SELECT j.id,j.workspace_id,j.policy_id,j.status,q.revision_id,q.occurrence_key,
      (SELECT count(*) FROM compliance_evidence e WHERE e.workspace_id=j.workspace_id AND e.job_id=j.id) AS evidence_count,
      s.answer_version,(SELECT status FROM compliance_visit_events v WHERE v.job_id=j.id ORDER BY version DESC LIMIT 1) AS visit_status
      FROM compliance_jobs j JOIN compliance_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id
      JOIN compliance_signoffs s ON s.workspace_id=q.workspace_id AND s.job_id=q.job_id AND s.occurrence_key=q.occurrence_key
      WHERE j.id=?`).bind(job_id).first();
   assert.deepEqual(stored&&{...stored},{id:job_id,workspace_id:'solarcell',policy_id:policyId,status:'COMPLETED',
    revision_id,occurrence_key:await db.prepare('SELECT occurrence_key FROM compliance_requirements WHERE job_id=?').bind(job_id).first('occurrence_key'),
    evidence_count:3,answer_version:1,visit_status:'CANCELLED'});
   writeFileSync(join(out,'database-assertions.json'),JSON.stringify(stored,null,2));
  }finally{writeFileSync(join(out,'http-receipts.json'),JSON.stringify(receipts,null,2));}
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
