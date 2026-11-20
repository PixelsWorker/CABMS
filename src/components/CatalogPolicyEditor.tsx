import React, { useEffect, useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { apiCreateJobTypePolicyDraft, apiFormCatalog } from '../services/g01Client.ts';
import type { JobTypeConfig } from '../types/cabms.ts';

type PublishedForm = { id:string; title:string; code:string; brand_id:string; published_revision_id:string };
/** Edits are persisted as a new draft; no checkbox changes the effective policy. */
export function CatalogPolicyEditor({ jobType, close }: { jobType:JobTypeConfig; close:()=>void }) {
 const session=useG01Session();
 const [forms,setForms]=useState<PublishedForm[]>([]), [selected,setSelected]=useState<string[]>([]);
 const [status,setStatus]=useState(''), [loading,setLoading]=useState(true), [saving,setSaving]=useState(false);
 useEffect(()=>{ let alive=true; setLoading(true); setSelected([]); setStatus('');
  async function load(){ try { if(!session?.workspaceId || !session.profile) throw new Error('A verified workspace session is required.');
   const res=await apiFormCatalog<PublishedForm[]>(session.workspaceId,await session.token(),'?published=1');
   if(!res.ok || !res.data) throw new Error(res.problem?.detail || 'Could not load published forms.');
   if(alive) setForms(res.data.filter(f=>f.brand_id===jobType.brandId));
  } catch(e) { if(alive) setStatus(e instanceof Error?e.message:'Could not load forms.'); } finally {if(alive)setLoading(false);} }
  void load(); return ()=>{alive=false;};
 },[session?.workspaceId,session?.profile?.user.id,jobType.id,jobType.brandId]);
 async function save(){ setSaving(true);setStatus('');try{
  if(!session?.workspaceId || !session.profile) throw new Error('A verified workspace session is required.');
  if(!selected.length) throw new Error('Select at least one published form.');
  const result=await apiCreateJobTypePolicyDraft(session.workspaceId,jobType.id,await session.token(),{isDirectToInvoice:false,formsRequired:jobType.formsRequired,formRules:selected.map(id=>({form_revision_id:id,required:true}))});
  if(!result.ok || !result.data) throw new Error(result.problem?.detail || 'The policy draft was not saved.');
  setStatus(`Policy draft ${result.data.version} saved. Existing requirements were retained. Publication is unavailable until job enforcement is complete.`);
 } catch(e){setStatus(e instanceof Error?e.message:'Could not save policy draft.');}finally{setSaving(false);} }
 return <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4"><div role="dialog" aria-label={`Configure ${jobType.name}`} className="cabms-card max-w-lg w-full p-6 space-y-3"><h3 className="font-bold">Configure {jobType.name}</h3>
 <p className="text-xs">Existing requirements are retained: {jobType.formsRequired.join(', ') || 'none'}. Select published catalog forms to add to a draft policy.</p>
 {loading ? <p>Loading published forms…</p> : forms.length===0 ? <p>No published forms are available for this brand.</p> : forms.map(form=><label key={form.id} className="block"><input type="checkbox" checked={selected.includes(form.published_revision_id)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,form.published_revision_id]:prev.filter(id=>id!==form.published_revision_id))}/> {form.title} ({form.code})</label>)}
 {status && <p role="status">{status}</p>}<div className="flex gap-2"><button disabled={saving || loading} onClick={()=>void save()} className="rounded border px-3 py-1">Save Draft Policy</button><button onClick={close} className="rounded border px-3 py-1">Close</button></div>
 </div></div>;
}
