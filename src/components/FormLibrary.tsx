import React, { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faXmark } from '@fortawesome/free-solid-svg-icons';
import { useG01Session } from '../context/G01Session.tsx';
import { apiFormCatalog } from '../services/g01Client.ts';
import { formLibraryStatus, getFormLibraryPage, type FormLibraryScope } from '../utils/formLibraryPagination.ts';
import { formatBusinessTime } from '../utils/businessTime.ts';
import { sanitizeFormAnswers } from '../../backend/modules/forms/formAnswers.ts';

type Column = { key:string; label:string; type:string; required:boolean; choices?:string[] };
type Validation = { min?:number; max?:number; min_length?:number; max_length?:number; max_rows?:number; columns?:Column[] };
type Field = { key: string; label: string; type: string; required: boolean; instructions?:string; choices?: string[]; autofill_source?: string; validation?: Validation; visible_when?: {field:string;equals:string | boolean | number} };
type Section = { title: string; description?: string; repeatable?: boolean; fields: Field[] };
type Revision = { id: string; status: string; version: string; display_version?: string; updated_at?: string; sections: Array<Section & { fields: Field[] }> };
type Form = { id: string; title: string; code: string; description: string; category: string; brand_id: string; status: string; pending_status?: string | null; current_version?: string | null; display_version?: string | null; used_by_job_types?: number; created_at: string; updated_at: string; published_revision_id: string | null; revisions?: Revision[] };
const categories = ['Safety','Electrical','Smoke Alarm','Cabling','Inspection','Custom'];
const types = ['TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','CHECKBOX','MULTIPLE_CHOICE','MULTISELECT','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA','REPEATABLE_TABLE','PHOTO','FILE','SIGNATURE','READONLY_AUTOFILL'];
const columnTypes = ['TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','CHECKBOX','MULTIPLE_CHOICE','MULTISELECT','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA'];
const control = 'w-full p-2.5 cabms-card-subtle rounded border cabms-border text-(--cabms-text-primary) text-xs';
const button = 'px-2 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded text-[11px] font-semibold hover:border-amber-500 transition disabled:opacity-50';

const getPrecedingFields = (sectionsList: Section[], secIdx: number, fldIdx: number): Field[] => {
 const result: Field[] = [];
 for (let s = 0; s <= secIdx; s++) {
  const sFields = sectionsList[s]?.fields || [];
  const limit = s === secIdx ? fldIdx : sFields.length;
  for (let f = 0; f < limit; f++) {
   const field = sFields[f];
   if (field?.key?.trim()) result.push(field);
  }
 }
 return result;
};

const getConditionValueChoices = (targetField?: Field): string[] => {
 if (!targetField) return [];
 switch (targetField.type) {
  case 'PASS_FAIL': return ['PASS', 'FAIL'];
  case 'PASS_FAIL_NA': return ['PASS', 'FAIL', 'NA'];
  case 'YES_NO_NA': return ['YES', 'NO', 'NA'];
  case 'CHECKBOX': return ['true', 'false'];
  case 'DROPDOWN':
  case 'MULTIPLE_CHOICE':
   return (targetField.choices || []).filter(c => c && c.trim().length > 0);
  default:
   return (targetField.choices || []).filter(c => c && c.trim().length > 0);
 }
};

function PreviewControl({field, value, onChange}: {field: Field | Column; value: any; onChange: (value: any)=>void}) {
 const opts = getConditionValueChoices(field as Field);
 if (['PHOTO','FILE','SIGNATURE','READONLY_AUTOFILL'].includes(field.type)) return <p>Simulated {field.type.replaceAll('_',' ')} — no verified record or trusted data is created.</p>;
 if (field.type==='CHECKBOX') return <input aria-label={field.label} type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>;
 if (field.type==='LONG_TEXT') return <textarea aria-label={field.label} className={control} value={value ?? ''} onChange={e=>onChange(e.target.value)}/>;
 if (field.type==='MULTISELECT') return <select multiple aria-label={field.label} className={control} value={value ?? []} onChange={e=>onChange(Array.from(e.target.selectedOptions,option=>option.value))}>{(field.choices ?? []).map(x=><option key={x}>{x}</option>)}</select>;
 if (opts.length) return <select aria-label={field.label} className={control} value={value ?? ''} onChange={e=>onChange(e.target.value)}><option value="">Select an answer</option>{opts.map(x=><option key={x}>{x}</option>)}</select>;
 if (field.type==='REPEATABLE_TABLE') {
  const schema=(field as Field).validation, rows: Record<string,unknown>[] = Array.isArray(value) ? value : [];
  return <div>{rows.map((row,index)=><div key={index} className="border cabms-border p-2">{(schema?.columns ?? []).map(column=><label key={column.key}>{column.label}<PreviewControl field={column} value={row[column.key]} onChange={v=>onChange(rows.map((r,n)=>n===index?{...r,[column.key]:v}:r))}/></label>)}<button type="button" className={button} onClick={()=>onChange(rows.filter((_,n)=>n!==index))}>Remove row</button></div>)}<button type="button" className={button} disabled={rows.length >= (schema?.max_rows ?? 0)} onClick={()=>onChange([...rows,{}])}>Add row</button></div>;
 }
 return <input aria-label={field.label} className={control} type={field.type==='NUMBER'?'number':field.type==='DATE'?'date':field.type==='DATETIME'?'datetime-local':'text'} value={value ?? ''} onChange={e=>onChange(field.type==='NUMBER' ? (e.target.value==='' ? undefined : Number(e.target.value)) : e.target.value)}/>;
}

/** Server-backed catalog editor. Job assignment and completion are separate workflows. */
export function FormLibrary() {
 const session = useG01Session();
 const [forms,setForms] = useState<Form[]>([]), [selected,setSelected] = useState<Form | null>(null);
 const [revision,setRevision] = useState<string | null>(null), [sections,setSections] = useState<Section[]>([]);
 const [draftUpdatedAt,setDraftUpdatedAt] = useState<string | null>(null);
 const [hasConflict,setHasConflict] = useState(false);
 const [viewRevision,setViewRevision] = useState<string | null>(null);
 const [title,setTitle] = useState(''), [code,setCode] = useState(''), [description,setDescription] = useState('');
 const [category,setCategory] = useState('Custom'), [search,setSearch] = useState(''), [categoryFilter,setCategoryFilter] = useState(''), [statusFilter,setStatusFilter] = useState('');
 const [scope,setScope] = useState<FormLibraryScope>('ACTIVE'), [page,setPage] = useState(1);
 const [message,setMessage] = useState(''), [busy,setBusy] = useState(false), [preview,setPreview] = useState(false), [dirty,setDirty] = useState(false);
 const [previewAnswers,setPreviewAnswers] = useState<Record<string, any>>({});
 const [inspectorTab,setInspectorTab] = useState<'preview'|'details'>('preview');
 const [confirmDelete,setConfirmDelete] = useState(false), [isCreateOpen,setCreateOpen] = useState(false);
 const workspace = session?.workspaceId;
 const activeRole = session?.profile?.memberships?.find(m => m.workspace_id === workspace)?.role;
 const canPublish = activeRole === 'owner_admin' || activeRole === 'super_admin';
 async function request<T>(path = '', method = 'GET', body?: unknown, headers?: Record<string, string>): Promise<T> {
  if (!workspace || !session?.profile) throw new Error('A verified workspace session is required.');
  const response = await apiFormCatalog<T>(workspace,await session.token(),path,method,body,headers);
  if (!response.ok || response.data === undefined) {
    if (response.status === 409 || response.problem?.code === 'VERSION_CONFLICT') {
      const err = new Error('CONFLICT: ' + (response.problem?.detail || 'This draft was modified by another session.'));
      (err as any).isConflict = true;
      throw err;
    }
    throw new Error(response.problem?.detail || 'The server did not confirm the request.');
  }
  return response.data;
 }
 async function list() { setForms(await request<Form[]>()); }
 async function open(id: string) {
  const form = await request<Form>(`/${encodeURIComponent(id)}`);
  setSelected(form);
  setPreviewAnswers({});
  setConfirmDelete(false);
  const draft = form.revisions?.find(r => r.status === 'DRAFT');
  setRevision(draft?.id || null);
  setDraftUpdatedAt(draft?.updated_at || null);
  setHasConflict(false);
  setViewRevision(draft?.id || form.revisions?.find(r=>r.status==='REVIEW')?.id || form.published_revision_id || null);
  setSections(draft?.sections.map(s => ({ title:s.title,description:s.description || '',repeatable:!!s.repeatable,fields:s.fields.map(f => ({key:f.key,label:f.label,type:f.type,required:!!f.required,choices:f.choices || [],...(f.instructions ? {instructions:f.instructions} : {}),...(f.autofill_source ? {autofill_source:f.autofill_source} : {}),...(f.validation ? {validation:f.validation} : {}),...(f.visible_when ? {visible_when:f.visible_when} : {})})) })) || []);
  setDirty(false);
 }
 async function run(fn: () => Promise<void>) {
   setBusy(true);
   setMessage('');
   try {
     await fn();
   } catch (error) {
     if (error && typeof error === 'object' && (error as any).isConflict) {
       setHasConflict(true);
       setMessage((error as Error).message);
     } else {
       setMessage(error instanceof Error ? error.message : 'Request failed.');
     }
   } finally {
     setBusy(false);
   }
 }
 useEffect(() => { setForms([]); setSelected(null); setRevision(null); setDraftUpdatedAt(null); setHasConflict(false); setSections([]); setCreateOpen(false); setPage(1); if (workspace && session?.profile) void run(list); }, [workspace, session?.profile?.user.id]);
 const updateSections = (next: Section[]) => {
  const cleaned = next.map((section,i)=>({...section,fields:section.fields.map((field,j)=>{
   if (!field.visible_when) return field;
   const source=getPrecedingFields(next,i,j).find(x=>x.key===field.visible_when!.field);
   const options=getConditionValueChoices(source);
   const value=field.visible_when.equals;
   const compatible=source && (source.type==='CHECKBOX' ? typeof value==='boolean' : source.type==='NUMBER' ? typeof value==='number' && Number.isFinite(value) : options.length ? typeof value==='string' && options.includes(value) : ['TEXT','LONG_TEXT','DATE','DATETIME'].includes(source.type) && typeof value==='string');
   return compatible ? field : {...field,visible_when:undefined};
  })}));
  setSections(cleaned); setPreviewAnswers(previous=>sanitizeFormAnswers(cleaned.flatMap(x=>x.fields),previous)); setDirty(true);
 };
 const updateSection = (i:number, changes:Partial<Section>) => updateSections(sections.map((s,n)=>n===i?{...s,...changes}:s));
 const updateField = (i:number,j:number,changes:Partial<Field>) => {
  const old=sections[i].fields[j];
  const typeChanged=changes.type !== undefined && changes.type !== old.type;
  const next=sections.map((section,si)=>({...section,fields:section.fields.map((field,fi)=>{
   if(si===i && fi===j) return {...field,...changes};
   if(typeChanged && old.key && field.visible_when?.field===old.key) return {...field,visible_when:undefined};
   return field;
  })}));
  updateSections(next);
 };
 const swap = <T,>(items:T[], i:number, step:number):T[] => { const copy=[...items], n=i+step; if(n<0||n>=copy.length) return copy; [copy[i],copy[n]]=[copy[n],copy[i]]; return copy; };
 const endpoint = selected && revision ? `/${encodeURIComponent(selected.id)}/revisions/${encodeURIComponent(revision)}` : '';
 const catalogPage = getFormLibraryPage(forms,{scope,page,search,category:categoryFilter,status:statusFilter});
 const inspectedRevision = selected?.revisions?.find(r=>r.id===viewRevision);
 return <section id="form-definitions" className="cabms-card p-6 space-y-4" aria-label="Form Definitions">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3"><h2 className="text-base font-bold text-(--cabms-text-primary)">Form Definitions</h2><div className="inline-flex self-start rounded-lg border border-(--cabms-border-base) p-0.5 text-[11px]" aria-label="Form library scope">{(['ACTIVE','ARCHIVED','ALL'] as const).map(tab=><button key={tab} type="button" aria-pressed={scope===tab} onClick={()=>{setScope(tab);setStatusFilter('');setPage(1);}} className={`px-2.5 py-1 rounded-md font-semibold transition ${scope===tab?'bg-amber-500 text-slate-950 shadow-xs':'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'}`}>{tab==='ACTIVE'?'Active':tab==='ARCHIVED'?'Archived':`All (${forms.length})`}</button>)}</div></div>
  {message && !isCreateOpen && !selected && <p role="status" className="text-amber-400">{message}</p>}
  {!workspace || !session?.profile ? <p>A verified workspace session is required to manage forms.</p> : <>
   <button type="button" className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition cursor-pointer shadow-sm disabled:opacity-50" disabled={busy || dirty} onClick={()=>{setMessage('');setCreateOpen(true);}}>+ Add Form</button>
   <div className="grid gap-2 md:grid-cols-3"><input className={control} aria-label="Search forms" placeholder="Search forms" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/><select className={control} aria-label="Filter category" value={categoryFilter} onChange={e=>{setCategoryFilter(e.target.value);setPage(1);}}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select><select className={control} aria-label="Filter status" value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setPage(1);}}><option value="">All statuses</option>{['DRAFT','REVIEW','PUBLISHED','ARCHIVED'].map(s=><option key={s}>{s}</option>)}</select></div>
   <div className="overflow-x-auto border cabms-border rounded-xl"><table className="w-full text-left text-xs text-(--cabms-text-secondary)"><thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border"><tr>{['Form Name','Form Code','Category','Brand Affiliation','Current Version','Status','Used by Job Types','Last Updated','Actions'].map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{catalogPage.items.map(f=><tr key={f.id} className="border-b cabms-border last:border-b-0"><td className="p-3 font-semibold text-(--cabms-text-primary)">{f.title}</td><td className="p-3 font-mono">{f.code}</td><td className="p-3">{f.category}</td><td className="p-3 font-medium text-amber-400">{f.brand_id}</td><td className="p-3">{f.display_version || '—'}</td><td className="p-3">{formLibraryStatus(f)}</td><td className="p-3">{f.used_by_job_types ?? 0}</td><td className="p-3 whitespace-nowrap">{f.updated_at ? formatBusinessTime(f.updated_at) : '—'}</td><td className="p-3"><button type="button" className={button} disabled={busy || dirty} onClick={()=>void run(()=>open(f.id))}>View / Edit</button></td></tr>)}{catalogPage.total===0 && <tr><td className="p-3 italic" colSpan={9}>No forms match the selected filters.</td></tr>}</tbody></table></div>
   <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-(--cabms-text-secondary)" aria-label="Form library pagination"><span>{catalogPage.total===0 ? 'No forms' : `Showing ${(catalogPage.page-1)*10+1}–${Math.min(catalogPage.page*10,catalogPage.total)} of ${catalogPage.total}`}</span><div className="flex items-center gap-2"><button type="button" className={button} disabled={catalogPage.page<=1} onClick={()=>setPage(catalogPage.page-1)}>Previous</button><span>Page {catalogPage.page} of {catalogPage.pages}</span><button type="button" className={button} disabled={catalogPage.page>=catalogPage.pages} onClick={()=>setPage(catalogPage.page+1)}>Next</button></div></div>
   {isCreateOpen && <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4" onKeyDown={e=>{if(e.key==='Escape' && !busy)setCreateOpen(false);}}>
    <div role="dialog" aria-modal="true" aria-label="Add Form Definition" className="cabms-card max-w-md w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4 text-xs">
     <div className="flex items-center justify-between border-b cabms-border pb-3"><h3 className="text-base font-bold text-(--cabms-text-primary)">Add Form Definition</h3><button type="button" aria-label="Close add form" disabled={busy} onClick={()=>setCreateOpen(false)} className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) cursor-pointer"><FontAwesomeIcon icon={faXmark} className="w-4 h-4" /></button></div>
     {message && <p role="status" className="text-amber-400">{message}</p>}
     <form className="space-y-4" onSubmit={e=>{e.preventDefault();void run(async()=>{const created=await request<{id:string;revision_id:string}>('', 'POST',{title,code,description,category,brand_id:workspace,schema:{sections:[]}}); await list(); setScope('ACTIVE'); setSearch(''); setCategoryFilter(''); setStatusFilter(''); setPage(1); await open(created.id); setTitle('');setCode('');setDescription('');setCreateOpen(false);setMessage('Draft created.');});}}>
      <label className="block font-semibold text-(--cabms-text-secondary)">Form Title <span className="text-rose-400">*</span><input autoFocus required className={control} aria-label="Form title" placeholder="Form title" value={title} onChange={e=>setTitle(e.target.value)} /></label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3"><label className="block font-semibold text-(--cabms-text-secondary)">Form Code <span className="text-rose-400">*</span><input required className={control} aria-label="Form code" placeholder="CUSTOM-001" value={code} onChange={e=>setCode(e.target.value)} /></label><label className="block font-semibold text-(--cabms-text-secondary)">Category<select className={control} aria-label="Form category" value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(c=><option key={c}>{c}</option>)}</select></label></div>
      <label className="block font-semibold text-(--cabms-text-secondary)">Brand Affiliation<input className={control} aria-label="Brand affiliation" value={workspace} readOnly /></label>
      <label className="block font-semibold text-(--cabms-text-secondary)">Description <span className="text-rose-400">*</span><textarea required rows={3} className={control} aria-label="Form description" placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)} /></label>
      <div className="flex justify-end gap-2 pt-2 border-t cabms-border"><button type="button" className={button} disabled={busy} onClick={()=>setCreateOpen(false)}>Cancel</button><button type="submit" disabled={busy} className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg disabled:opacity-50">Add Form</button></div>
     </form>
    </div>
   </div>}
   {selected && <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4" onKeyDown={e=>{if(e.key==='Escape' && !busy && !dirty){setSelected(null);setRevision(null);setSections([]);setPreview(false);setConfirmDelete(false);setMessage('');}}}>
    <div role="dialog" aria-modal="true" aria-label="View or edit form definition" className="cabms-card max-w-3xl w-full max-h-[90vh] flex flex-col p-6 shadow-2xl space-y-3 text-xs">
    <div className="flex items-center justify-between border-b cabms-border pb-3 shrink-0"><h3 className="text-base font-bold text-(--cabms-text-primary)">View / Edit Form Definition</h3><button type="button" aria-label="Close form editor" className="p-1.5 rounded text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) cursor-pointer" disabled={busy || dirty} onClick={()=>{setSelected(null);setRevision(null);setSections([]);setPreview(false);setConfirmDelete(false);setMessage('');}}><FontAwesomeIcon icon={faXmark} className="w-4 h-4" /></button></div>
    <div className="overflow-y-auto flex-1 space-y-3 pr-1">
    {message && <p role="status" className="cabms-brand-accent-text">{message}</p>}
    {dirty && <p className="rounded cabms-card-subtle p-3 text-(--cabms-text-secondary)">You have unsaved changes. Save or discard them before closing.</p>}
    <div className="cabms-card-subtle p-4 space-y-2"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold text-(--cabms-text-primary)">{selected.title}</h3><p className="text-(--cabms-text-secondary)">{selected.code} · {selected.category} · {selected.brand_id}</p></div><span className="rounded border cabms-border px-2 py-1 font-semibold">{formLibraryStatus(selected)}</span></div><p className="text-(--cabms-text-secondary)">{selected.description}</p><p className="text-(--cabms-text-secondary)">Published version: {selected.revisions?.find(r=>r.id===selected.published_revision_id)?.display_version || 'Not published'}</p><div className="flex flex-wrap gap-2">{selected.revisions?.map(r=><button type="button" key={r.id} className={button} disabled={dirty || busy} aria-pressed={viewRevision===r.id} onClick={()=>setViewRevision(r.id)}>{r.status === 'REVIEW' ? 'View review' : r.status === 'DRAFT' ? 'View draft' : `View ${r.display_version || r.version}`}</button>)}</div></div>
    {inspectedRevision && inspectedRevision.id!==revision && <div className="cabms-card-subtle p-4 space-y-3" aria-label="Read-only form revision">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b cabms-border pb-2">
        <h4 className="font-bold text-(--cabms-text-primary)">{inspectedRevision.display_version || inspectedRevision.version} · {inspectedRevision.status}</h4>
        <div className="flex gap-1.5" role="tablist" aria-label="Form revision view mode">
          <button type="button" role="tab" aria-selected={inspectorTab==='preview'} onClick={()=>setInspectorTab('preview')} className={`px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer ${inspectorTab==='preview' ? 'cabms-tab-active' : 'cabms-surface-subtle cabms-border text-(--cabms-text-secondary)'}`}>Form preview</button>
          <button type="button" role="tab" aria-selected={inspectorTab==='details'} onClick={()=>setInspectorTab('details')} className={`px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer ${inspectorTab==='details' ? 'cabms-tab-active' : 'cabms-surface-subtle cabms-border text-(--cabms-text-secondary)'}`}>Definition details</button>
        </div>
      </div>
      {inspectorTab === 'preview' ? (
        <div className="space-y-4">
          {inspectedRevision.sections.map((section,index)=>(
            <div key={index} className="cabms-surface rounded-lg border cabms-border p-3 space-y-2.5">
              <div>
                <h5 className="text-xs font-bold text-(--cabms-text-primary)">{section.title}</h5>
                {section.description && <p className="text-[11px] text-(--cabms-text-secondary) mt-0.5">{section.description}</p>}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {section.fields.map((field,n)=>(
                  <div key={n} className={`space-y-1 ${['LONG_TEXT','REPEATABLE_TABLE','PHOTO','FILE','SIGNATURE'].includes(field.type) ? 'md:col-span-2' : ''}`}>
                    <label className="block font-semibold text-(--cabms-text-primary)">{field.label}{field.required ? ' *' : ''}</label>
                    {field.instructions && <p className="text-[11px] text-(--cabms-text-secondary)">{field.instructions}</p>}
                    <div className="cabms-card-subtle rounded border cabms-border px-2.5 py-1.5 text-[11px] text-(--cabms-text-secondary)">
                      {field.type === 'READONLY_AUTOFILL' ? `System autofill (${field.autofill_source || 'job record'})` : field.type === 'REPEATABLE_TABLE' ? `Repeatable table (${field.validation?.columns?.length || 0} columns)` : field.choices?.length ? field.choices.join(' / ') : field.type.replaceAll('_',' ')}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {inspectedRevision.sections.map((section,index)=>(
            <div key={index} className="space-y-1.5">
              <strong className="text-(--cabms-text-primary)">{section.title}</strong>
              {section.description && <p className="text-(--cabms-text-secondary)">{section.description}</p>}
              <ul className="list-disc pl-5 space-y-1 text-(--cabms-text-secondary)">
                {section.fields.map((field,n)=>(
                  <li key={n}>
                    <span className="font-semibold text-(--cabms-text-primary)">{field.label}</span> (<code>{field.key}</code>) — {field.type}
                    {field.required ? ' · Required' : ''}
                    {field.autofill_source ? ` · autofill: ${field.autofill_source}` : ''}
                    {field.choices?.length ? ` · options: [${field.choices.join(', ')}]` : ''}
                    {field.validation && Object.keys(field.validation).length ? ` · validation: ${JSON.stringify(field.validation)}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>}
    <div className="flex flex-wrap items-center justify-end gap-2">
    {selected.status !== 'ARCHIVED' && <button className={button} disabled={busy || dirty} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(selected.id)}`,'PATCH',{action:'archive'});await list();await open(selected.id);setMessage('Form archived.');})}>Archive</button>}
    {selected.status === 'ARCHIVED' && <button className={button} disabled={busy} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(selected.id)}`,'PATCH',{action:'restore'});await list();await open(selected.id);setScope('ACTIVE');setStatusFilter('');setPage(1);setMessage('Form restored.');})}>Restore</button>}
    {selected.status === 'DRAFT' && !selected.published_revision_id && selected.revisions?.every(r=>r.status==='DRAFT') && (confirmDelete ? <span> Delete this unused draft? <button className={button} disabled={busy || dirty} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(selected.id)}`,'DELETE');setSelected(null);setRevision(null);setSections([]);setConfirmDelete(false);await list();setMessage('Unused draft deleted.');})}>Confirm Delete</button>{' '}<button className={button} onClick={()=>setConfirmDelete(false)}>Cancel</button></span> : <button className={button} disabled={busy || dirty} onClick={()=>setConfirmDelete(true)}>Delete Unused Draft</button>)}
    {!revision && selected.published_revision_id && selected.status !== 'ARCHIVED' && <button className={button} disabled={busy} onClick={()=>void run(async()=>{ await request(`/${encodeURIComponent(selected.id)}/revisions`,'POST'); await open(selected.id); setMessage('Draft revision created.'); })}>New Draft</button>}
    </div>
    {revision && viewRevision===revision && selected.status !== 'ARCHIVED' && <>
     <div className="flex flex-wrap items-center justify-between gap-2 border-t cabms-border pt-4"><div><h4 className="text-sm font-bold text-(--cabms-text-primary)">Form Sections</h4><p className="text-(--cabms-text-secondary)">Organize the questions staff will complete.</p></div><button type="button" className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg font-bold disabled:opacity-50" disabled={busy} onClick={()=>updateSections([...sections,{title:'',fields:[]}])}>Add Section</button></div>
     {sections.length === 0 && <div className="cabms-card-subtle p-4 text-(--cabms-text-secondary)"><p className="font-semibold text-(--cabms-text-primary)">No sections yet</p><p>Add a section, give it a name, and add fields before saving the draft.</p></div>}
     {sections.map((s,i)=><div key={i} className="space-y-2 rounded border cabms-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-bold text-(--cabms-text-primary)">Section {i+1}</h5><div className="flex gap-2"><button type="button" className={button} aria-label={`Move section ${i+1} up`} disabled={i===0} onClick={()=>updateSections(swap(sections,i,-1))}>↑</button><button type="button" className={button} aria-label={`Move section ${i+1} down`} disabled={i===sections.length-1} onClick={()=>updateSections(swap(sections,i,1))}>↓</button><button type="button" className={button} onClick={()=>updateSections(sections.filter((_,n)=>n!==i))}>Remove section</button></div></div>
      <label className="block font-semibold text-(--cabms-text-secondary)">Section name <span className="text-rose-400">*</span><input className={control} aria-label={`Section ${i+1} title`} placeholder="e.g. Job and site details" value={s.title} onChange={e=>updateSection(i,{title:e.target.value})} /></label>
      <label className="block font-semibold text-(--cabms-text-secondary)">Instructions <span className="font-normal">(optional)</span><textarea rows={2} className={control} aria-label={`Section ${i+1} description`} placeholder="Instructions for completing this section" value={s.description || ''} onChange={e=>updateSection(i,{description:e.target.value})} /></label>
      <label className="flex items-center gap-2 text-(--cabms-text-secondary)"><input type="checkbox" checked={!!s.repeatable} onChange={e=>updateSection(i,{repeatable:e.target.checked})}/> Repeat this section for multiple entries</label>
      {s.fields.map((f,j)=><div key={j} className="space-y-2 rounded border cabms-border p-2">
       <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-(--cabms-text-primary)">Field {j+1}</strong><div className="flex gap-2"><button type="button" className={button} aria-label={`Move field ${j+1} up`} disabled={j===0} onClick={()=>updateSection(i,{fields:swap(s.fields,j,-1)})}>↑</button><button type="button" className={button} aria-label={`Move field ${j+1} down`} disabled={j===s.fields.length-1} onClick={()=>updateSection(i,{fields:swap(s.fields,j,1)})}>↓</button><button type="button" className={button} onClick={()=>updateSection(i,{fields:s.fields.filter((_,n)=>n!==j)})}>Remove field</button></div></div>
       <div className="grid gap-2 md:grid-cols-3"><label className="font-semibold text-(--cabms-text-secondary)">Field key <span className="text-rose-400">*</span><input className={control} aria-label="Field key" placeholder="field_key" value={f.key} onChange={e=>updateField(i,j,{key:e.target.value})}/></label><label className="font-semibold text-(--cabms-text-secondary)">Question / label <span className="text-rose-400">*</span><input className={control} aria-label="Field label" placeholder="e.g. Site address" value={f.label} onChange={e=>updateField(i,j,{label:e.target.value})}/></label><label className="font-semibold text-(--cabms-text-secondary)">Field type<select className={control} aria-label="Field type" value={f.type} onChange={e=>updateField(i,j,{type:e.target.value,choices:[],validation:e.target.value==='REPEATABLE_TABLE'?{max_rows:10,columns:[]}:{}})}>{types.map(t=><option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select></label></div>
       {(['DROPDOWN','MULTIPLE_CHOICE','MULTISELECT'].includes(f.type)) && <input className={control} aria-label="Choices" placeholder="Comma-separated choices" value={(f.choices||[]).join(',')} onChange={e=>updateField(i,j,{choices:e.target.value.split(',')})}/>}
       <label className="block">Field instructions (optional)<textarea aria-label="Field instructions" className={control} value={f.instructions || ''} onChange={e=>updateField(i,j,{instructions:e.target.value})}/></label>
       <details aria-label="Advanced field settings" className="rounded border cabms-border cabms-card-subtle p-3">
        <summary className="cursor-pointer font-semibold text-(--cabms-text-primary)">Advanced settings{f.visible_when ? ' · Condition configured' : ''}</summary>
        <div className="mt-3 space-y-3"><div>Show this field when (optional)<div className="flex gap-2"><select className={control} aria-label="Condition field key" value={f.visible_when?.field ?? ''} onChange={e=>{const source=getPrecedingFields(sections,i,j).find(x=>x.key===e.target.value); const options=getConditionValueChoices(source); updateField(i,j,{visible_when:source ? {field:source.key,equals:source.type==='CHECKBOX' ? true : source.type==='NUMBER' ? 0 : options[0] ?? ''} : undefined});}}><option value="">Always show</option>{getPrecedingFields(sections,i,j).filter(x=>['TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','MULTIPLE_CHOICE','CHECKBOX','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA'].includes(x.type) && (!['DROPDOWN','MULTIPLE_CHOICE'].includes(x.type) || getConditionValueChoices(x).length)).map(x=><option key={x.key} value={x.key}>{x.label || x.key}</option>)}</select>{(()=>{const source=getPrecedingFields(sections,i,j).find(x=>x.key===f.visible_when?.field); const options=getConditionValueChoices(source); return source && (options.length ? <select className={control} aria-label="Condition value" value={String(f.visible_when?.equals ?? '')} onChange={e=>updateField(i,j,{visible_when:{field:source.key,equals:source.type==='CHECKBOX' ? e.target.value==='true' : e.target.value}})}>{options.map(x=><option key={x} value={x}>{x}</option>)}</select> : <input className={control} aria-label="Condition value" type={source.type==='NUMBER'?'number':source.type==='DATE'?'date':'text'} value={String(f.visible_when?.equals ?? '')} onChange={e=>updateField(i,j,{visible_when:{field:source.key,equals:source.type==='NUMBER' ? Number(e.target.value) : e.target.value}})}/>);})()}</div></div>
        {(['TEXT','LONG_TEXT','NUMBER'].includes(f.type)) && <div className="flex gap-2">{(f.type==='NUMBER'?['min','max'] as const:['min_length','max_length'] as const).map(key=><label key={key}>{({min:'Minimum value',max:'Maximum value',min_length:'Minimum characters',max_length:'Maximum characters'} as const)[key]}<input className={control} type="number" value={f.validation?.[key] ?? ''} onChange={e=>{const next={...(f.validation || {})}; if(e.target.value==='') delete next[key]; else next[key]=Number(e.target.value); updateField(i,j,{validation:next});}}/></label>)}</div>}
        </div>
       </details>
       {f.type==='REPEATABLE_TABLE' && <div className="space-y-2 rounded border cabms-border p-2"><label>Maximum rows<input aria-label="Maximum rows" className={control} type="number" min="1" max="100" value={f.validation?.max_rows ?? 10} onChange={e=>updateField(i,j,{validation:{...f.validation,max_rows:Number(e.target.value)}})}/></label>{(f.validation?.columns || []).map((column,k)=>{const edit=(changes:Partial<Column>)=>updateField(i,j,{validation:{...f.validation,columns:(f.validation?.columns || []).map((c,n)=>n===k?{...c,...changes}:c)}}); return <div key={k} className="space-y-2 border cabms-border p-2"><input aria-label="Column key" className={control} placeholder="Column key" value={column.key} onChange={e=>edit({key:e.target.value})}/><input aria-label="Column label" className={control} placeholder="Column label" value={column.label} onChange={e=>edit({label:e.target.value})}/><select aria-label="Column type" className={control} value={column.type} onChange={e=>edit({type:e.target.value,choices:[]})}>{columnTypes.map(t=><option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select>{['DROPDOWN','MULTIPLE_CHOICE','MULTISELECT'].includes(column.type) && <input aria-label="Column choices" className={control} placeholder="Comma-separated choices" value={(column.choices || []).join(',')} onChange={e=>edit({choices:e.target.value.split(',')})}/>}<label><input type="checkbox" checked={column.required} onChange={e=>edit({required:e.target.checked})}/> Required column</label> <button type="button" className={button} onClick={()=>updateField(i,j,{validation:{...f.validation,columns:(f.validation?.columns || []).filter((_,n)=>n!==k)}})}>Remove column</button></div>;})}<button type="button" className={button} onClick={()=>updateField(i,j,{validation:{...f.validation,max_rows:f.validation?.max_rows ?? 10,columns:[...(f.validation?.columns || []),{key:'',label:'',type:'TEXT',required:false}]}})}>+ Add column</button></div>}
       <label className="block font-semibold text-(--cabms-text-secondary)">Auto-fill source<select className={control} aria-label="Auto-fill source" value={f.autofill_source || ''} onChange={e=>updateField(i,j,{autofill_source:e.target.value || undefined})}><option value="">No auto-fill</option>{['job.id','job.title','customer.name','site.address','business.name','technician.name'].map(source=><option key={source}>{source}</option>)}</select></label>
       <label className="flex items-center gap-2 text-(--cabms-text-secondary)"><input type="checkbox" checked={f.required} onChange={e=>updateField(i,j,{required:e.target.checked})}/> Required field</label>
      </div>)}
      {s.fields.length === 0 && <p className="text-(--cabms-text-secondary)">No fields added to this section.</p>}
      <button type="button" className={button} onClick={()=>updateSection(i,{fields:[...s.fields,{key:'',label:'',type:'TEXT',required:false}]})}>+ Add Field</button>
     </div>)}
     {hasConflict && (
      <div className="p-3 rounded border border-rose-500 bg-rose-950/40 text-rose-300 text-xs space-y-2">
        <p><strong>Concurrent edit conflict:</strong> Another user modified this draft while you were editing. Your unsaved edits are preserved above.</p>
        <div className="flex gap-2">
          <button type="button" className={button} onClick={()=>void run(async()=>{ if(selected) await open(selected.id); setMessage('Reloaded latest draft from server.'); })}>Reload Server Draft</button>
          <button type="button" className={button} onClick={()=>setHasConflict(false)}>Dismiss</button>
        </div>
      </div>
     )}
     <div className="flex flex-wrap items-center justify-end gap-2 border-t cabms-border pt-4">
     <button className={button} disabled={busy || !dirty} onClick={()=>void run(async()=>{await request(endpoint,'PUT',{sections,expected_updated_at:draftUpdatedAt},draftUpdatedAt ? {'If-Match':`"${draftUpdatedAt}"`} : {}); await open(selected.id); setMessage('Draft saved.');})}>Save Draft</button>{' '}
     <button className={button} disabled={busy || !dirty} onClick={()=>void run(()=>open(selected.id))}>Discard Changes</button>{' '}
     <button className={button} onClick={()=>setPreview(!preview)}>Preview</button>{' '}
     <button className={button} disabled={busy || dirty || !sections.some(s=>s.fields.length > 0)} onClick={()=>void run(async()=>{await request(`${endpoint}/review`,'POST',{expected_updated_at:draftUpdatedAt},draftUpdatedAt ? {'If-Match':`"${draftUpdatedAt}"`} : {});await open(selected.id);setMessage('Submitted for review.');})}>Submit Review</button>
     </div>
     {!sections.some(s=>s.fields.length > 0) && <p className="text-xs">Add a section and at least one field, then save the draft before submitting for review.</p>}
     {preview && <div className="space-y-2 border cabms-border p-3"><strong>Draft preview — simulated, answers are not saved</strong> <button type="button" className={button} onClick={()=>setPreviewAnswers({})}>Reset Preview</button>{sections.map((s,i)=><div key={i}><h4>{s.title}</h4>{s.fields.map((f,j)=>{const clean=sanitizeFormAnswers(sections.flatMap(x=>x.fields),previewAnswers); if(f.visible_when && clean[f.visible_when.field]!==f.visible_when.equals) return null; return <div key={j}><label>{f.label} {f.required ? '*' : ''}</label>{f.instructions && <p>{f.instructions}</p>}<PreviewControl field={f} value={clean[f.key]} onChange={value=>setPreviewAnswers(previous=>sanitizeFormAnswers(sections.flatMap(x=>x.fields),{...previous,[f.key]:value}))}/></div>;})}</div>)}</div>}
    </>}
    {canPublish && selected.status !== 'ARCHIVED' && selected.revisions?.filter(r=>r.status==='REVIEW').map(r=><button key={r.id} className={button} disabled={busy} onClick={()=>void run(async()=>{await request(`/${encodeURIComponent(selected.id)}/revisions/${encodeURIComponent(r.id)}/approve`,'POST');await list();await open(selected.id);setMessage('Revision published.');})}>Approve &amp; Publish</button>)}
    </div>
    <div className="flex justify-end border-t cabms-border pt-3 shrink-0"><button type="button" className={button} disabled={busy || dirty} onClick={()=>{setSelected(null);setRevision(null);setSections([]);setPreview(false);setConfirmDelete(false);setMessage('');}}>Close</button></div>
    </div>
   </div>}
  </>}
 </section>;
}
