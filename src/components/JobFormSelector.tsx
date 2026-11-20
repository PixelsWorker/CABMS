import React, { useState } from 'react';
import {getJobFormPage} from '../utils/jobFormPagination.ts';

type PublishedForm = {id:string;title:string;code:string;created_at?:string;published_revision_id:string};
export function JobFormSelector({forms,selected,onChange}:{forms:PublishedForm[];selected:string[];onChange:(ids:string[])=>void}) {
 const [search,setSearch]=useState(''), [page,setPage]=useState(1);
 const result=getJobFormPage(forms,search,page);
 const button='px-2 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded text-[11px] font-semibold hover:border-amber-500 transition disabled:opacity-50';
 return <div className="space-y-2">
  <input type="search" aria-label="Search required forms" placeholder="Search forms by name or code" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}} className="w-full p-2 cabms-card-subtle rounded border cabms-border text-(--cabms-text-primary)"/>
  <p className="text-[11px] text-(--cabms-text-secondary)">{selected.length} selected</p>
  {result.items.length ? <div className="space-y-1.5">{result.items.map(form=><label key={form.id} className="flex items-start gap-2 cursor-pointer text-(--cabms-text-secondary)"><input type="checkbox" value={form.published_revision_id} checked={selected.includes(form.published_revision_id)} onChange={e=>onChange(e.target.checked?[...selected,form.published_revision_id]:selected.filter(id=>id!==form.published_revision_id))}/><span>{form.title} ({form.code})</span></label>)}</div> : <p className="text-(--cabms-text-secondary)">No forms match your search.</p>}
  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-(--cabms-text-secondary)" aria-label="Required forms pagination"><span>{result.total ? `Showing ${(result.page-1)*10+1}–${Math.min(result.page*10,result.total)} of ${result.total}` : 'No matching forms'}</span><div className="flex items-center gap-2"><button type="button" className={button} disabled={result.page<=1} onClick={()=>setPage(result.page-1)}>Previous</button><span>Page {result.page} of {result.pages}</span><button type="button" className={button} disabled={result.page>=result.pages} onClick={()=>setPage(result.page+1)}>Next</button></div></div>
 </div>;
}
