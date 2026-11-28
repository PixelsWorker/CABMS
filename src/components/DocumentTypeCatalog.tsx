import React, { useEffect, useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { apiDocumentTypes } from '../services/g01Client.ts';
type Item={id:string;code:string;title:string;status:'DRAFT'|'REVIEW'|'PUBLISHED'};
export function DocumentTypeCatalog() {
 const session=useG01Session(), workspace=session?.workspaceId;
 const [items,setItems]=useState<Item[]>([]),[title,setTitle]=useState(''),[code,setCode]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function request<T>(path='',method='GET',body?:unknown){if(!workspace || !session?.profile)throw new Error('Verified workspace required');const result=await apiDocumentTypes<T>(workspace,await session.token(),path,method,body);if(!result.ok || !result.data)throw new Error(result.problem?.detail || 'Document type request failed');return result.data;}
 async function refresh(){setItems(await request<Item[]>());}
 async function run(fn:()=>Promise<void>){setMessage('');setBusy(true);try{await fn();}catch(e){setMessage(e instanceof Error?e.message:'Request failed');}finally{setBusy(false);}}
 useEffect(()=>{setItems([]);if(workspace && session?.profile)void run(refresh);},[workspace,session?.profile?.user.id]);
 if(!workspace || !session?.profile)return null;
 return <div className="space-y-2 border-t border-slate-700 pt-3"><h3 className="font-semibold">Document Types</h3><p className="text-xs">Create a draft type, submit it for review, and publish it before selecting it for a template.</p>
 <div className="flex flex-wrap gap-2"><input className="cabms-card-subtle p-2" aria-label="Document type name" placeholder="Type name" value={title} onChange={e=>setTitle(e.target.value)}/><input className="cabms-card-subtle p-2" aria-label="Document type code" placeholder="TYPE-001" value={code} onChange={e=>setCode(e.target.value)}/><button className="border rounded px-2" disabled={busy} onClick={()=>void run(async()=>{await request('','POST',{title,code});await refresh();setTitle('');setCode('');setMessage('Document type draft saved.');})}>Add Type</button></div>
 {message && <p role="status">{message}</p>}{items.map(item=><div key={item.id} className="flex flex-wrap gap-2 items-center"><span>{item.title} ({item.code}) — {item.status}</span>{item.status==='DRAFT' && <button className="border rounded px-2" disabled={busy} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(item.id)}/review`,'POST');await refresh();setMessage('Submitted for review.');})}>Submit Review</button>}{item.status==='REVIEW' && <button className="border rounded px-2" disabled={busy} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(item.id)}/publish`,'POST');await refresh();setMessage('Document type published.');})}>Publish</button>}</div>)}
 </div>;
}
