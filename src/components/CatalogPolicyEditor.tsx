import React, { useEffect, useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { apiCreateJobTypePolicyDraft, apiFormCatalog } from '../services/g01Client.ts';
import type { JobTypeConfig } from '../types/cabms.ts';

type PublishedForm = { id:string; title:string; code:string; brand_id:string; published_revision_id:string };
/** Edits are persisted as a new draft; no checkbox changes the effective policy. */
export function CatalogPolicyEditor({ jobType, close }: { jobType:JobTypeConfig; close:()=>void }) {
 const session = useG01Session();
 const [forms, setForms] = useState<PublishedForm[]>([]);
 const [rulesMap, setRulesMap] = useState<Record<string, { required: boolean }>>(() => {
   const initial: Record<string, { required: boolean }> = {};
   for (const f of jobType.catalogForms || []) {
     initial[f.revision_id] = { required: f.required === 1 };
   }
   return initial;
 });
 const [status, setStatus] = useState(''), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);

 useEffect(() => {
   let alive = true;
   setLoading(true);
   setStatus('');
   // Pre-populate existing rules from jobType
   const initial: Record<string, { required: boolean }> = {};
   for (const f of jobType.catalogForms || []) {
     initial[f.revision_id] = { required: f.required === 1 };
   }
   setRulesMap(initial);

   async function load() {
     try {
       if (!session?.workspaceId || !session.profile) throw new Error('A verified workspace session is required.');
       const res = await apiFormCatalog<PublishedForm[]>(session.workspaceId, await session.token(), '?published=1');
       if (!res.ok || !res.data) throw new Error(res.problem?.detail || 'Could not load published forms.');
       if (alive) setForms(res.data.filter(f => f.brand_id === jobType.brandId));
     } catch (e) {
       if (alive) setStatus(e instanceof Error ? e.message : 'Could not load forms.');
     } finally {
       if (alive) setLoading(false);
     }
   }
   void load();
   return () => { alive = false; };
 }, [session?.workspaceId, session?.profile?.user.id, jobType.id, jobType.brandId, jobType.catalogForms]);

 const toggleForm = (revId: string, checked: boolean) => {
   setRulesMap(prev => {
     const next = { ...prev };
     if (checked) {
       next[revId] = next[revId] || { required: true };
     } else {
       delete next[revId];
     }
     return next;
   });
 };

 const toggleRequired = (revId: string, required: boolean) => {
   setRulesMap(prev => {
     if (!prev[revId]) return prev;
     return { ...prev, [revId]: { required } };
   });
 };

 async function save() {
   setSaving(true);
   setStatus('');
   try {
     if (!session?.workspaceId || !session.profile) throw new Error('A verified workspace session is required.');
     const selectedKeys = Object.keys(rulesMap);
     if (!selectedKeys.length) throw new Error('Select at least one published form.');
     const formRules = selectedKeys.map(id => ({
       form_revision_id: id,
       required: rulesMap[id]?.required ?? true,
     }));
     const result = await apiCreateJobTypePolicyDraft(session.workspaceId, jobType.id, await session.token(), {
       base_policy_id: jobType.currentPolicyId,
       isDirectToInvoice: false,
       formsRequired: jobType.formsRequired,
       formRules,
     });
     if (!result.ok || !result.data) throw new Error(result.problem?.detail || 'The policy draft was not saved.');
     setStatus(`Policy draft ${result.data.version} saved. Existing catalog and legacy requirements were preserved. Review and approve to activate.`);
   } catch (e) {
     setStatus(e instanceof Error ? e.message : 'Could not save policy draft.');
   } finally {
     setSaving(false);
   }
 }

  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    previousFocusRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const target = dialog.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || dialog;
      target.focus();
    }
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const focusables = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'));
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

 return <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4" onKeyDown={handleKeyDown}>
  <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="catalog-policy-editor-title" className="cabms-card max-w-lg w-full p-6 space-y-3">
    <h3 id="catalog-policy-editor-title" className="font-bold">Configure {jobType.name}</h3>
    <p className="text-xs">Existing legacy requirements: {jobType.formsRequired.join(', ') || 'none'}. Manage catalog forms in this draft policy:</p>
    {loading ? <p>Loading published forms…</p> : forms.length === 0 ? <p>No published forms are available for this business.</p> : (
      <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
        {forms.map(form => {
          const isSelected = !!rulesMap[form.published_revision_id];
          const isReq = rulesMap[form.published_revision_id]?.required ?? true;
          return (
            <div key={form.id} className="flex items-center justify-between p-2 rounded border cabms-border text-xs">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={e => toggleForm(form.published_revision_id, e.target.checked)}
                />
                <span>{form.title} <span className="font-mono text-slate-400">({form.code})</span></span>
              </label>
              {isSelected && (
                <label className="flex items-center gap-1 text-[11px] text-amber-400">
                  <input
                    type="checkbox"
                    checked={isReq}
                    onChange={e => toggleRequired(form.published_revision_id, e.target.checked)}
                  />
                  <span>Mandatory</span>
                </label>
              )}
            </div>
          );
        })}
      </div>
    )}
    {status && <p role="status" className="text-xs text-amber-300">{status}</p>}
    <div className="flex gap-2 pt-2 border-t cabms-border">
      <button disabled={saving || loading} onClick={() => void save()} className="rounded border px-3 py-1 font-semibold hover:border-amber-500">Save Draft Policy</button>
      <button onClick={close} className="rounded border px-3 py-1">Close</button>
    </div>
  </div>
 </div>;
}
