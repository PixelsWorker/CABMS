/**
 * Area C: Owner/Admin Content and Template Settings
 * Bounded template management, versioning workflow (Draft -> Review -> Published),
 * required-forms-by-job-type matrix, and synthetic sample library preview.
 * Strictly enforces unconditional hook declarations (G00-008).
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRight,
  faCircleCheck,
  faClock,
  faEye,
  faFileCircleCheck,
  faFileLines,
  faLayerGroup,
  faPlus,
  faShield,
  faSliders,
  faTriangleExclamation,
  faUpload,
} from '@fortawesome/free-solid-svg-icons';
import { TemplateSetting } from '../types/cabms.ts';

export const TemplatesSettingsView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    templates,
    publishTemplateVersion,
    createTemplateDraftRevision,
    submitTemplateForReview,
    jobTypes,
    updateJobTypeConfig,
    demoClock,
  } = useCabms();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('TPL-001');
  const [editingContent, setEditingContent] = useState<string>('');
  const [previewModalDoc, setPreviewModalDoc] = useState<TemplateSetting | null>(null);
  const [configuringJobType, setConfiguringJobType] = useState<string | null>(null);

  // Role Gate: Owner/Admin or Super Admin only (evaluated AFTER hooks)
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Compliance Templates & Terms Management"
        requiredRoleDescription="Admin or Super Admin"
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
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faSliders} className="w-5 h-5 text-amber-400" />
              <h1 className="text-xl font-bold text-[var(--cabms-text-primary)] tracking-tight">
                Admin Content & Template Settings
              </h1>
            </div>
            <p className="text-xs text-[var(--cabms-text-secondary)] mt-1">
              Bounded form field configuration, draft-to-published versioning, and required-forms job matrix.
            </p>
          </div>

          <div className="cabms-card-subtle text-xs px-3 py-1.5 rounded-lg text-[var(--cabms-text-secondary)]">
            Role: <strong className="text-sky-400">{persona.toUpperCase()}</strong>
          </div>
        </div>
      </div>

      {/* SECTION 1: REQUIRED FORMS BY JOB TYPE MATRIX (Section C - Dynamic Matrix) */}
      <div className="cabms-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Compliance Gating Policy (Dynamically Linked Matrix)
            </span>
            <h2 className="text-base font-bold text-[var(--cabms-text-primary)] mt-0.5">
              Required Compliance Documents by Demo Job Type
            </h2>
            <p className="text-xs text-[var(--cabms-text-secondary)]">
              Rules governing operational completion requirements. Connected directly to work order creation and form validation.
            </p>
          </div>
          <span className="text-xs cabms-surface-subtle px-3 py-1.5 rounded-lg border cabms-border text-[var(--cabms-text-secondary)] font-mono">
            {jobTypes.length} Active Job Type Policies
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs text-[var(--cabms-text-secondary)]">
            <thead className="cabms-surface-subtle text-[var(--cabms-text-secondary)] text-[11px] uppercase border-b cabms-border">
              <tr>
                <th className="p-3">Job Type Category</th>
                <th className="p-3">Brand Affiliation</th>
                <th className="p-3">Required Compliance Forms</th>
                <th className="p-3">Matrix Version</th>
                <th className="p-3">Completion Rule</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cabms-border-base)] bg-transparent">
              {jobTypes.map(jt => (
                <tr key={jt.id} className={jt.isDirectToInvoice ? 'bg-slate-900/40' : ''}>
                  <td className="p-3 font-semibold text-[var(--cabms-text-primary)]">
                    {jt.name}
                    {jt.isDirectToInvoice && (
                      <span className="ml-2 text-[10px] cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] px-1.5 py-0.5 rounded font-mono">
                        Direct-to-Invoice
                      </span>
                    )}
                  </td>
                  <td className="p-3 font-medium text-amber-400">
                    {jt.id.includes('solar') ? 'Solarcell' : jt.id.includes('smart') || jt.id.includes('smoke') ? 'GC Smart Home' : jt.id.includes('cctv') ? 'GC CCTV' : 'Shared Fleet'}
                  </td>
                  <td className="p-3 font-mono text-sky-400">
                    {jt.formsRequired.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {jt.formsRequired.map(f => (
                          <span key={f} className="bg-sky-950/80 border border-sky-800 text-sky-300 text-[10px] px-1.5 py-0.5 rounded">
                            {f}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-500 italic">None (Direct-to-invoice service)</span>
                    )}
                  </td>
                  <td className="p-3 text-[var(--cabms-text-secondary)] font-mono">{jt.version}</td>
                  <td className="p-3 font-semibold">
                    {jt.isDirectToInvoice ? (
                      <span className="text-sky-400">Direct Completion (No Forms)</span>
                    ) : (
                      <span className="text-emerald-400">Requires Signed Forms</span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    <button
                      onClick={() => setConfiguringJobType(jt.id)}
                      className="px-2.5 py-1 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] rounded text-[11px] font-semibold transition cursor-pointer"
                    >
                      Configure
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: TEMPLATE LIBRARY & VERSIONING WORKFLOW (Draft -> Review -> Published) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Template Catalog (5 cols) */}
        <div className="lg:col-span-5 cabms-card p-5 space-y-3">
          <h3 className="text-xs font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider">
            Template Library & Sample Selection
          </h3>
          <p className="text-xs text-[var(--cabms-text-secondary)]">
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
                        <FontAwesomeIcon icon={faFileLines} className="w-4 h-4 text-amber-400" />
                        <span className="font-bold text-white text-xs">{tpl.name}</span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-300 mt-1">
                        Version: <strong className="text-sky-400">{tpl.currentVersion}</strong>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        tpl.activeStatus === 'PUBLISHED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : tpl.activeStatus === 'REVIEW'
                          ? 'bg-purple-950 text-purple-400 border border-purple-800'
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
        <div className="lg:col-span-7 cabms-card p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                  Version Lifecycle: Draft → Review → Published
                </span>
              </div>
              <h3 className="text-base font-bold text-[var(--cabms-text-primary)] mt-0.5">
                {currentTemplate.name} ({currentTemplate.currentVersion})
              </h3>
              <span className="text-xs text-[var(--cabms-text-secondary)]">
                Active Status: <strong className="text-sky-400">{currentTemplate.activeStatus}</strong> • Revisions: {currentTemplate.revisions?.length || 1}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={() => setPreviewModalDoc(currentTemplate)}
                className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] text-xs font-semibold rounded-lg transition cursor-pointer flex items-center space-x-1"
              >
                <FontAwesomeIcon icon={faEye} className="w-3.5 h-3.5" />
                <span>Preview Document</span>
              </button>
            </div>
          </div>

          {/* Bounded Text Content Editor */}
          <div className="space-y-2 text-xs">
            <label className="block text-[var(--cabms-text-secondary)] font-semibold">
              Supported Standard Wording & Form Clauses (Non-legal demonstration text):
            </label>
            <textarea
              rows={5}
              value={editingContent || currentTemplate.content}
              onChange={e => setEditingContent(e.target.value)}
              className="w-full p-3 cabms-card-subtle text-[var(--cabms-text-primary)] text-xs focus:outline-none focus:border-amber-500 font-sans leading-relaxed"
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
                className="px-3 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] font-semibold rounded-lg transition cursor-pointer"
              >
                Save Draft Revision
              </button>

              {currentTemplate.activeStatus === 'DRAFT' && (
                <button
                  onClick={() => submitTemplateForReview(currentTemplate.id)}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition shadow cursor-pointer flex items-center space-x-1"
                >
                  <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5" />
                  <span>Submit for Review</span>
                </button>
              )}
            </div>

            <div>
              <button
                onClick={() => publishTemplateVersion(currentTemplate.id)}
                disabled={persona === 'office_staff' || currentTemplate.activeStatus !== 'REVIEW'}
                className={`px-4 py-2 rounded-lg font-bold text-xs transition flex items-center space-x-1.5 ${
                  persona === 'office_staff' || currentTemplate.activeStatus !== 'REVIEW'
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow cursor-pointer'
                }`}
                title={
                  persona === 'office_staff'
                    ? 'Office staff cannot publish master templates'
                    : currentTemplate.activeStatus !== 'REVIEW'
                    ? 'Template must be submitted for review before it can be published'
                    : 'Approve and publish this template version'
                }
              >
                <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4" />
                <span>
                  {currentTemplate.activeStatus === 'REVIEW'
                    ? 'Approve & Publish'
                    : currentTemplate.activeStatus === 'PUBLISHED'
                    ? 'Currently Published'
                    : 'Submit for Review to Publish'}
                </span>
              </button>
            </div>
          </div>

          {/* Revision History Log */}
          {currentTemplate.revisions && currentTemplate.revisions.length > 0 && (
            <div className="pt-4 border-t border-slate-800 space-y-2 text-xs">
              <span className="font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider text-[10px] block">
                Revision Audit History (Immutable Snapshots)
              </span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {currentTemplate.revisions.map((rev, idx) => (
                  <div key={idx} className="cabms-card-subtle p-2.5 flex items-center justify-between text-[11px]">
                    <div>
                      <span className="font-mono font-bold text-sky-400">{rev.version}</span> • Status: <strong className="text-[var(--cabms-text-primary)]">{rev.status}</strong>
                      <span className="text-slate-500 ml-2">by {rev.updatedBy} ({rev.updatedAt})</span>
                    </div>
                    <span className="text-[var(--cabms-text-secondary)] italic truncate max-w-xs">{rev.content.slice(0, 40)}...</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Synthetic Document Preview Modal */}
      {previewModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-[var(--cabms-text-primary)]">{previewModalDoc.name}</h3>
                <span className="text-xs text-sky-400 font-mono">
                  Version: {previewModalDoc.currentVersion} ({previewModalDoc.activeStatus})
                </span>
              </div>
              <button
                onClick={() => setPreviewModalDoc(null)}
                className="text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="cabms-card-subtle p-4 text-xs text-[var(--cabms-text-secondary)] space-y-3 font-sans leading-relaxed">
              <div className="text-[11px] font-mono text-slate-500 uppercase">
                Sample File: {previewModalDoc.sampleFileName} • Mapping: {previewModalDoc.mappingStatus}
              </div>
              <p className="cabms-surface-subtle p-3 rounded border cabms-border">
                {previewModalDoc.content}
              </p>
              <div className="text-[10px] text-amber-300/80 bg-amber-950/30 p-2 rounded border border-amber-800/40">
                Demonstration Notice: Uploading or viewing sample templates does not establish statutory or legal compliance.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setPreviewModalDoc(null)}
                className="px-4 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Job Type Configuration Modal */}
      {configuringJobType && (() => {
        const targetJt = jobTypes.find(jt => jt.id === configuringJobType);
        if (!targetJt) return null;

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-[var(--cabms-text-primary)]">Configure {targetJt.name}</h3>
                <button
                  onClick={() => setConfiguringJobType(null)}
                  className="text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)] font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Service Classification</label>
                  <label className="flex items-center space-x-2 cursor-pointer cabms-card-subtle p-3">
                    <input
                      type="checkbox"
                      checked={targetJt.isDirectToInvoice}
                      onChange={e => {
                        updateJobTypeConfig(
                          targetJt.id,
                          e.target.checked ? [] : ['JSA'],
                          e.target.checked
                        );
                      }}
                      className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-bold text-[var(--cabms-text-primary)]">Direct-to-Invoice Service Exception</span>
                      <span className="block text-[11px] text-[var(--cabms-text-secondary)]">
                        When enabled, no compliance documentation is required for job sign-off.
                      </span>
                    </div>
                  </label>
                </div>

                {!targetJt.isDirectToInvoice && (
                  <div>
                    <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1.5">
                      Required Compliance Forms (Multi-form Gating)
                    </label>
                    <div className="space-y-1.5 cabms-card-subtle p-3">
                      {(['JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2'] as const).map(formKey => {
                        const isChecked = targetJt.formsRequired.includes(formKey);
                        return (
                          <label key={formKey} className="flex items-center space-x-2 cursor-pointer text-[var(--cabms-text-secondary)]">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                const newForms = e.target.checked
                                  ? [...targetJt.formsRequired, formKey]
                                  : targetJt.formsRequired.filter(f => f !== formKey);
                                updateJobTypeConfig(targetJt.id, newForms, targetJt.isDirectToInvoice);
                              }}
                              className="rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                            />
                            <span className="font-mono text-xs">{formKey}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

                {targetJt.revisionHistory && targetJt.revisionHistory.length > 0 && (
                  <div className="pt-2 border-t border-slate-800 space-y-1.5">
                    <span className="text-[10px] uppercase font-bold text-[var(--cabms-text-secondary)] block">
                      Policy Version {targetJt.version} — Audit History
                    </span>
                    <div className="max-h-24 overflow-y-auto space-y-1">
                      {targetJt.revisionHistory.map((rev, idx) => (
                        <div key={idx} className="cabms-surface-subtle p-2 rounded text-[11px] text-[var(--cabms-text-secondary)] flex items-center justify-between border cabms-border">
                          <span className="font-mono text-sky-400 font-bold">{rev.version}</span>
                          <span className="text-slate-500">by {rev.updatedBy} ({rev.updatedAt.slice(0, 10)})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-800">
                <button
                  onClick={() => setConfiguringJobType(null)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded cursor-pointer"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
