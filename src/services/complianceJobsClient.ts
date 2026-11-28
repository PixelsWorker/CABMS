import { buildApiUrl } from './g01Client.ts';
import { generateUuid } from '../utils/uuid.ts';

export type Membership={workspace_id:string;role:string;name:string};
export type Job={started?:number;scheduled?:number|null;id:string;workspace_id:string;title:string;status:string;version:number;policy_id:string;assignee_id:string|null;technician:string|null;photo_cap:number|null;photo_count:number;customer_name?:string|null;site_address?:string|null};
export type VisitWrite={visit_id:string;version:number;job_id:string;technician_id:string;starts_at:string;duration_minutes:number;status:'SCHEDULED'|'CANCELLED';reason:string};
export type Visit=VisitWrite & {title:string;technician:string;job_status:string};
export type Field={key:string;label:string;type:string;required?:boolean;choices?:string[];visible_when?:{field:string;equals:unknown};validation?:{columns?:Field[];max_rows?:number}};
export type Finding={id:string;reason:string;resolution:string|null};
export type Requirement={occurrence_key:string;revision_id:string;title:string;origin:string;required:number;answer_version:number;signed_digest:string|null;has_signed_history?:number;withdrawal_reason?:string|null;may_sign:number;answers:Record<string,unknown>;needs_answer_review?:boolean;fields:Field[];photos:{id:string;bytes:number}[];findings?:Finding[]};
type VisitEvent=Pick<Visit,'visit_id'|'version'|'status'|'reason'|'starts_at'|'technician'|'duration_minutes'> & {actor:string;occurred_at:string};
export type Detail={history?:{operation_id?:string;action:string;actor:string;occurred_at:string}[];visit_history?:VisitEvent[];job:Job;requirements:Requirement[]};
export type Blocker={code:string;occurrence_key?:string;field?:string;evidence_id?:string};
type Problem={code?:string;detail?:string;request_id?:string;blockers?:Blocker[]};
export class JobError extends Error {
 constructor(readonly status:number,readonly problem:Problem,readonly reconcile?:()=>Promise<void>){super(problem.detail||({
  401:'Sign in again to continue.',403:'You do not have access to this action.',404:'This job or form is unavailable.',
  412:'Another change was saved. Review the latest version before continuing.',503:'The compliance service is unavailable in this environment.'
 } as Record<number,string>)[status]||'The request could not be confirmed.');}
}
export function isConfirmedRejection(error:unknown){
 return error instanceof JobError && [400,409,412,413,422,428].includes(error.status);
}
export const signIntent='I confirm the saved answers and linked evidence for this form occurrence.';
export const part=encodeURIComponent;
export function jobsClient(token:()=>Promise<string>){
 async function request<T>(path:string,method='GET',body?:unknown,headers:Record<string,string>={}):Promise<T>{
  let authToken:string;
  try{authToken=await token();}
  catch(err){throw new JobError(401,{detail:err instanceof Error?err.message:'Sign in again to continue.'});}
  const binary=body instanceof Blob;
  const response=await fetch(buildApiUrl('/api/v1/workspaces/'+path),{method,cache:'no-store',signal:AbortSignal.timeout(20000),
   headers:{Authorization:'Bearer '+authToken,...(body===undefined?{}:{'Content-Type':binary?body.type:'application/json'}),...headers},
   body:body===undefined?undefined:binary?body:JSON.stringify(body)});
  const json=await response.json().catch(()=>({}));
  if(!response.ok)throw new JobError(response.status,json);
  return json as T;
 }
 const path=(w:string,j?:string)=>part(w)+'/compliance-jobs'+(j?'/'+part(j):'');
 const form=(w:string,j:string,s:string)=>path(w,j)+'/forms/'+part(s);
 async function mutation(url:string,method:string,data:unknown,key:string,lookup:string,headers:Record<string,string>={}){
  const write=()=>request(url,method,data,{'Idempotency-Key':key,...headers});
  const read=()=>request(lookup,'GET',undefined,{'Idempotency-Key':key});
  try {await write();}
  catch(e){
   if(e instanceof JobError && e.status<500)throw e;
   try{await read();}
   catch{
    throw new JobError(503,{code:'UNKNOWN_RESULT',detail:'Save outcome unknown. Recover this operation using its original reference.'},async()=>{
     try{await read();}
     catch(receiptError){
      if(!(receiptError instanceof JobError)||receiptError.status!==404)throw receiptError;
      await write();
     }
    });
   }
  }
 }
 return {
  visits:(w:string)=>request<Visit[]>(part(w)+'/visits'),
  saveVisit:(w:string,data:VisitWrite,key:string)=>mutation(part(w)+'/visits','POST',data,key,part(w)+'/visits'),
  publishedTypes:(w:string)=>request<{id:string;name:string;current_policy_version_id:string;missing_mandatory_forms:string[]}[]>(path(w)+'?view=creation-options'),
  updateJob:(job:Job,action:'ASSIGN'|'CANCEL'|'ADD',input:Record<string,unknown>,key:string)=>{
    const url=path(job.workspace_id,job.id)+'?operation='+action;
    return mutation(url,'POST',input,key,url,{'If-Match':'"'+job.version+'"'});
  },
  formOptions:(job:Job)=>request<{id:string;title:string;version:string}[]>(path(job.workspace_id,job.id)+'?view=form-options'),
  technicians:(w:string)=>request<{id:string;display_name:string}[]>(path(w)+'?view=technicians'),
  create:(w:string,title:string,type:string,policy:string,key:string,assignee:string|null,customer_name:string,site_address:string)=>request<{job_id:string}>(path(w),'POST',
   {title,job_type_id:type,expected_policy_id:policy,assignee_id:assignee,customer_name,site_address},{'Idempotency-Key':key}),
  async list(w:string){let after:string|null=null;const rows:Job[]=[];
   do{const page:{jobs:Job[];after:string|null}=await request(path(w)+(after?'?after='+part(after):''));rows.push(...page.jobs);after=page.after;}while(after);
   return rows;
  },
  detail:(w:string,j:string)=>request<Detail>(path(w,j)),
  withdraw:(job:Job,r:Requirement,decision:boolean,reason:string,key:string)=>{
   const url=form(job.workspace_id,job.id,r.occurrence_key)+(decision?'/withdrawal-decision':'/withdrawal-request');
   return mutation(url,'POST',{reason,expected_job_version:job.version},key,url);
  },
  finding:(job:Job,r:Requirement,reason:string,key:string,findingId?:string)=>{
   const url=form(job.workspace_id,job.id,r.occurrence_key)+(findingId?'/finding-resolution':'/finding');
   return mutation(url,'POST',{reason,expected_job_version:job.version,...(findingId?{finding_id:findingId}:{})},key,url);
  },
  save:(job:Job,r:Requirement,answers:Record<string,unknown>,key:string)=>mutation(path(job.workspace_id,job.id),'PATCH',
   {occurrence_key:r.occurrence_key,expected_answer_version:r.answer_version,answers},key,form(job.workspace_id,job.id,r.occurrence_key)+'/answer-receipt',{'If-Match':'"'+job.version+'"'}),
  sign:(job:Job,r:Requirement,links:Record<string,string[]>,key:string)=>{
   const url=form(job.workspace_id,job.id,r.occurrence_key)+'/sign';return mutation(url,'POST',{expected_job_version:job.version,answer_version:r.answer_version,intent_version:'cabms-form-attestation-v1',evidence_by_field:links},key,url);
  },
  complete:(job:Job,key:string)=>{const url=path(job.workspace_id,job.id)+'/complete';return mutation(url,'POST',{expected_job_version:job.version},key,url);},
  async photo(workspace:string,jobId:string,occurrence:string,id:string,signal:AbortSignal){
   const pathToPhoto=form(workspace,jobId,occurrence)+'/evidence/'+part(id)+'/content';
   const response=await fetch(buildApiUrl('/api/v1/workspaces/'+pathToPhoto),{
    cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),headers:{Authorization:'Bearer '+await token()},
   });
   if(!response.ok)throw new JobError(response.status,await response.json().catch(()=>({})));
   return response.blob();
  },
  async upload(job:Job,r:Requirement,blob:Blob){
   const url=form(job.workspace_id,job.id,r.occurrence_key)+'/evidence';
   const key=generateUuid();
   const stage=()=>request<{upload_id:string;status:string}>(url,'POST',blob,{
    'If-Match':'"'+job.version+'"','X-Answer-Version':String(r.answer_version),'Idempotency-Key':key,
   });
   const finalize=async(upload:{upload_id:string;status:string})=>{
    if(upload.status==='verified')return;
    const record=url+'/'+part(upload.upload_id);
    try{await request(record+'/finalize','POST');}
    catch(e){
     if(e instanceof JobError&&e.status<500)throw e;
     const current=await request<{status:string}>(record);
     if(current.status!=='verified')throw e;
    }
   };
   try{await finalize(await stage());}
   catch(e){
    if(e instanceof JobError&&e.status<500)throw e;
    try{await finalize(await stage());}
    catch(retry){
     if(retry instanceof JobError&&retry.status<500)throw retry;
     throw new JobError(503,{detail:'Photo upload could not be confirmed. Recover the operation to retry the same upload.'},async()=>{await finalize(await stage());});
    }
   }
  }
 };
}
export type JobsClient=ReturnType<typeof jobsClient>;

export async function resizePhoto(file:File,cap:number):Promise<Blob>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a JPEG, PNG or WebP photo.');
 const target=Math.min(500*1024,cap);
 if(file.size<=target)return file;
 const image=await createImageBitmap(file);
 try{
  let scale=Math.min(1,2000/Math.max(image.width,image.height));
  for(let i=0;i<8;i++){
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
   const ctx=canvas.getContext('2d');if(!ctx)break;
   ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',0.82));
   if(blob && blob.size<=target)return blob;
   scale*=0.75;
  }
  throw Error('This photo exceeds the configured upload limit after resizing.');
 }finally{image.close();}
}
