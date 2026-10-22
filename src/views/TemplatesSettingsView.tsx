/**
 * Area C: Owner/Admin Content and Template Settings
 * Bounded template management, versioning workflow (Draft -> Review -> Published),
 * required-forms-by-job-type matrix, and synthetic sample library preview.
 * Strictly enforces unconditional hook declarations (G00-008).
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  Sliders,
  FileText,
  FileCheck2,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  ShieldCheck,
  Upload,
  AlertTriangle,
  Eye,
  Plus,
} from 'lucide-react';
import { TemplateSetting } from '../types/cabms.ts';

export const TemplatesSettingsView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    templates,
    publishTemplateVersion,
    createTemplateDraftRevision,
    demoClock,
  } = useCabms();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('TPL-001');
  const [editingContent, setEditingContent] = useState<string>('');
  const [previewModalDoc, setPreviewModalDoc] = useState<TemplateSetting | null>(null);

  // Role Gate: Owner/Admin or Super Admin only (evaluated AFTER hooks)
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Compliance Templates & Terms Management"
        requiredRoleDescription="Owner / Admin or Super Admin"
        customExplanation="Technicians cannot alter master compliance forms or standard Terms of Service."
      />
    );
  }

  const currentTemplate = templates.find(t => t.id === selectedTemplateId) || templates[0];

  const handleStartDraft = () => {
    createTemplateDraftRevision(
      currentTemplate.id,
      editingContent || currentTemplate.content + ' [Draft Revision Update]'
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Sliders className="w-5 h-5 text-amber-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Owner / Admin Content & Template Settings
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Bounded form field configuration, draft-to-published versioning, and required-forms job matrix.
            </p>
          </div>

          <div className="bg-slate-950 border border-slate-800 text-xs px-3 py-1.5 rounded-lg text-slate-300">
            Role: <strong className="text-sky-400">{persona.toUpperCase()}</strong>
          </div>
        </div>
      </div>

      {/* SECTION 1: REQUIRED FORMS BY JOB TYPE MATRIX (Section C) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
            Compliance Gating Policy (Synthetic Matrix)
          </span>
          <h2 className="text-base font-bold text-white mt-0.5">
            Required Compliance Documents by Demo Job Type
          </h2>
          <p className="text-xs text-slate-400">
            Rules governing operational completion requirements. Demonstrates both multi-document compliance and the direct-to-invoice exception.
          </p>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
              <tr>
                <th className="p-3">Job Type Category</th>
                <th className="p-3">Primary Brand</th>
                <th className="p-3">Required Compliance Forms</th>
                <th className="p-3">Matrix Version</th>
                <th className="p-3">Completion Rule</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
              <tr>
                <td className="p-3 font-semibold text-white">Commercial Solar PV Installation</td>
                <td className="p-3 text-amber-400">Solarcell</td>
                <td className="p-3 font-mono text-sky-400">JSA + Electrical Cert (Part A)</td>
                <td className="p-3 text-slate-400 font-mono">v4.2 - Oct 2026</td>
                <td className="p-3 text-emerald-400 font-semibold">Requires Tech Sign-Off</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Residential Smoke Safety Audit</td>
                <td className="p-3 text-sky-400">GC Smart Home Solutions</td>
                <td className="p-3 font-mono text-sky-400">JSA + Smoke Alarm Certificate</td>
                <td className="p-3 text-slate-400 font-mono">v3.0 - Oct 2026</td>
                <td className="p-3 text-emerald-400 font-semibold">Requires Tech Sign-Off</td>
              </tr>
              <tr>
                <td className="p-3 font-semibold text-white">Enterprise CCTV & Cabling Inspection</td>
                <td className="p-3 text-emerald-400">Gold Coast CCTV</td>
                <td className="p-3 font-mono text-sky-400">JSA + TCA1 + TCA2 (if defect)</td>
                <td className="p-3 text-slate-400 font-mono">v2.1 - Oct 2026</td>
                <td className="p-3 text-amber-400 font-semibold">Revisit on Defect</td>
              </tr>
              <tr className="bg-slate-900/60">
                <td className="p-3 font-semibold text-white">Direct-to-Invoice Service Call</td>
                <td className="p-3 text-slate-300">All Brands</td>
                <td className="p-3 text-slate-400 italic">None (No forms required)</td>
                <td className="p-3 text-slate-400 font-mono">Standard Service</td>
                <td className="p-3 text-sky-400 font-semibold">Direct Operational Completion</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: TEMPLATE LIBRARY & VERSIONING WORKFLOW (Draft -> Review -> Published) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Template Catalog (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
            Template Library & Sample Selection
          </h3>
          <p className="text-xs text-slate-400">
            Select built-in synthetic templates to inspect content snapshots and version states.
          </p>

          <div className="space-y-2 max-h-[500px] overflow-y-auto">
            {templates.map(tpl => {
              const isSelected = tpl.id === selectedTemplateId;
              return (
                <div
                  key={tpl.id}
                  onClick={() => {
                    setSelectedTemplateId(tpl.id);
                    setEditingContent(tpl.content);
                  }}
                  className={`p-3.5 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800 border-amber-500 shadow'
                      : 'bg-slate-950 border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <FileText className="w-4 h-4 text-amber-400" />
                        <span className="font-bold text-white text-xs">{tpl.name}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-400 mt-1">
                        Version: <strong className="text-sky-400">{tpl.currentVersion}</strong>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        tpl.activeStatus === 'PUBLISHED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {tpl.activeStatus}
                    </span>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span>File: {tpl.sampleFileName}</span>
                    <span className="text-sky-400 font-medium">{tpl.mappingStatus}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Template Editor & Versioning Actions (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  Version Lifecycle: Draft → Review → Published
                </span>
              </div>
              <h3 className="text-base font-bold text-white mt-0.5">
                {currentTemplate.name} ({currentTemplate.currentVersion})
              </h3>
              <span className="text-xs text-slate-400">
                Active Status: <strong className="text-sky-400">{currentTemplate.activeStatus}</strong> • Revisions: {currentTemplate.revisions?.length || 1}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPreviewModalDoc(currentTemplate)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center space-x-1"
              >
                <Eye className="w-3.5 h-3.5" />
                <span>Preview Document</span>
              </button>
            </div>
          </div>

          {/* Bounded Text Content Editor */}
          <div className="space-y-2 text-xs">
            <label className="block text-slate-300 font-semibold">
              Supported Standard Wording & Form Clauses (Non-legal demonstration text):
            </label>
            <textarea
              rows={6}
              value={editingContent || currentTemplate.content}
              onChange={e => setEditingContent(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-slate-200 text-xs focus:outline-none focus:border-amber-500 font-sans leading-relaxed"
            />
            <p className="text-[11px] text-slate-500 italic">
              Notice: Editing template text creates a new Draft revision. Historical signed documents and accepted quotations will continue to render their original frozen version snapshot.
            </p>
          </div>

          {/* Workflow Action Controls */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <button
                onClick={handleStartDraft}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg transition cursor-pointer"
              >
                Save as Draft Revision
              </button>
            </div>

            <div>
              <button
                onClick={() => publishTemplateVersion(currentTemplate.id)}
                disabled={persona === 'office_staff'}
                className={`px-4 py-2 rounded-lg font-bold text-xs transition cursor-pointer flex items-center space-x-1.5 ${
                  persona === 'office_staff'
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow'
                }`}
                title={persona === 'office_staff' ? 'Office staff cannot publish master templates' : 'Publish this template version'}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Publish Active Version</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Synthetic Document Preview Modal */}
      {previewModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white">{previewModalDoc.name}</h3>
                <span className="text-xs text-sky-400 font-mono">
                  Version: {previewModalDoc.currentVersion} ({previewModalDoc.activeStatus})
                </span>
              </div>
              <button
                onClick={() => setPreviewModalDoc(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 text-xs text-slate-300 space-y-3 font-sans leading-relaxed">
              <div className="text-[11px] font-mono text-slate-500 uppercase">
                Sample File: {previewModalDoc.sampleFileName} • Mapping: {previewModalDoc.mappingStatus}
              </div>
              <p className="bg-slate-900/60 p-3 rounded border border-slate-800/80">
                {previewModalDoc.content}
              </p>
              <div className="text-[10px] text-amber-300/80 bg-amber-950/30 p-2 rounded border border-amber-800/40">
                Demonstration Notice: Uploading or viewing sample templates does not establish statutory or legal compliance.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setPreviewModalDoc(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
