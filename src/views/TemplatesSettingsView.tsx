/**
 * Area C: Owner/Admin Content and Template Settings
 * Full CRUD & Lifecycle Integration:
 * - Job Types, Compliance Policies, and Required Form Rules
 * - Document Templates and Immutable Revision Snapshots
 * - Bounded form field configuration, draft-to-published versioning, and matrix table.
 * Strictly enforces unconditional hook declarations (G00-008).
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FormLibrary } from '../components/FormLibrary.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBoxArchive,
  faCheck,
  faCircleCheck,
  faClock,
  faEye,
  faFileCircleCheck,
  faFileLines,
  faLayerGroup,
  faPenToSquare,
  faPlus,
  faRotateLeft,
  faShield,
  faSliders,
  faTrashCan,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { JobTypeConfig, TemplateSetting, BrandId } from '../types/cabms.ts';

const COMPLIANCE_FORM_TYPES = ['JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2'] as const;

export const TemplatesSettingsView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    brands,
    templates,
    publishTemplateVersion,
    createTemplateDraftRevision,
    submitTemplateForReview,
    addTemplate,
    archiveTemplate,
    restoreTemplate,
    deleteTemplateDraft,
    jobTypes,
    updateJobTypeConfig,
    addJobType,
    editJobType,
    archiveJobType,
    restoreJobType,
    deleteJobTypeDraft,
    createJobTypePolicyDraft,
    submitJobTypePolicyForReview,
    approveJobTypePolicy,
    demoClock,
  } = useCabms();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('TPL-001');
  const [editingContent, setEditingContent] = useState<string>('');
  const [previewModalDoc, setPreviewModalDoc] = useState<TemplateSetting | null>(null);

  // Job Type Modals & State
  const [configuringJobTypeId, setConfiguringJobTypeId] = useState<string | null>(null);
  const [viewingJobTypeId, setViewingJobTypeId] = useState<string | null>(null);
  const [editingJobTypeId, setEditingJobTypeId] = useState<string | null>(null);
  const [isAddJobTypeOpen, setIsAddJobTypeOpen] = useState(false);
  const [confirmDeleteJobTypeId, setConfirmDeleteJobTypeId] = useState<string | null>(null);
  const [jobTypeFilter, setJobTypeFilter] = useState<'ALL' | 'ACTIVE' | 'ARCHIVED'>('ACTIVE');

  // New Job Type Form
  const [newJtName, setNewJtName] = useState('');
  const [newJtCode, setNewJtCode] = useState('');
  const [newJtBrandId, setNewJtBrandId] = useState<BrandId>('solarcell');
  const [newJtDirectToInvoice, setNewJtDirectToInvoice] = useState(false);
  const [newJtForms, setNewJtForms] = useState<('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[]>(['JSA']);
  const [newJtDescription, setNewJtDescription] = useState('');

  // Edit Job Type Form
  const [editJtName, setEditJtName] = useState('');
  const [editJtCode, setEditJtCode] = useState('');
  const [editJtBrandId, setEditJtBrandId] = useState<BrandId>('solarcell');
  const [editJtDescription, setEditJtDescription] = useState('');

  // Template Modals & State
  const [isAddTemplateOpen, setIsAddTemplateOpen] = useState(false);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<'ALL' | 'PUBLISHED' | 'REVIEW' | 'DRAFT' | 'ARCHIVED'>('ALL');

  // New Template Form
  const [newTplName, setNewTplName] = useState('');
  const [newTplCode, setNewTplCode] = useState('');
  const [newTplType, setNewTplType] = useState<TemplateSetting['type']>('TERMS');
  const [newTplContent, setNewTplContent] = useState('');
  const [newTplSampleFile, setNewTplSampleFile] = useState('');
  const [newTplDescription, setNewTplDescription] = useState('');

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

  const getBrandDisplayName = (brandId: string) => {
    if (brands[brandId]?.name) return brands[brandId].name;
    if (brandId === 'solarcell') return 'Solarcell';
    if (brandId === 'smart_home') return 'Gold Coast Smart Home';
    if (brandId === 'cctv') return 'Gold Coast CCTV';
    return 'Shared Fleet';
  };

  const filteredJobTypes = jobTypes.filter(jt => {
    if (jobTypeFilter === 'ACTIVE') return jt.status !== 'ARCHIVED';
    if (jobTypeFilter === 'ARCHIVED') return jt.status === 'ARCHIVED';
    return true;
  });

  const filteredTemplates = templates.filter(t => {
    if (templateFilter === 'ALL') return true;
    if (templateFilter === 'ARCHIVED') return t.status === 'ARCHIVED';
    if (t.status === 'ARCHIVED') return false;
    return t.activeStatus === templateFilter;
  });

  const handleOpenEditJobType = (jt: JobTypeConfig) => {
    setEditingJobTypeId(jt.id);
    setEditJtName(jt.name);
    setEditJtCode(jt.code || jt.id);
    setEditJtBrandId(jt.brandId);
    setEditJtDescription(jt.description || '');
  };

  const handleSaveEditJobType = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJobTypeId) return;
    editJobType(editingJobTypeId, {
      name: editJtName,
      code: editJtCode,
      brandId: editJtBrandId,
      description: editJtDescription,
    });
    setEditingJobTypeId(null);
  };

  const handleCreateJobType = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addJobType({
      name: newJtName,
      code: newJtCode,
      brandId: newJtBrandId,
      formsRequired: newJtDirectToInvoice ? [] : newJtForms,
      isDirectToInvoice: newJtDirectToInvoice,
      description: newJtDescription,
    });
    if (res.success) {
      setIsAddJobTypeOpen(false);
      setNewJtName('');
      setNewJtCode('');
      setNewJtDescription('');
      setNewJtDirectToInvoice(false);
      setNewJtForms(['JSA']);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addTemplate({
      name: newTplName,
      code: newTplCode,
      type: newTplType,
      content: newTplContent,
      description: newTplDescription,
      sampleFileName: newTplSampleFile,
    });
    if (res.success && res.id) {
      setIsAddTemplateOpen(false);
      setSelectedTemplateId(res.id);
      setNewTplName('');
      setNewTplCode('');
      setNewTplContent('');
      setNewTplSampleFile('');
      setNewTplDescription('');
    }
  };

  const viewingJobType = jobTypes.find(jt => jt.id === viewingJobTypeId);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faSliders} className="w-5 h-5 text-amber-400" />
              <h1 className="text-xl font-bold text-(--cabms-text-primary) tracking-tight">
                Admin Content & Template Settings
              </h1>
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              Bounded form field configuration, draft-to-published versioning, and required-forms job matrix.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="cabms-card-subtle text-xs px-3 py-1.5 rounded-lg text-(--cabms-text-secondary)">
              Role: <strong className="text-sky-400">{persona.toUpperCase()}</strong>
            </span>
          </div>
        </div>
      </div>

      <FormLibrary />

      {/* SECTION 1: REQUIRED FORMS BY JOB TYPE MATRIX */}
      <div className="cabms-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Compliance Gating Policy (Dynamically Linked Matrix)
            </span>
            <h2 className="text-base font-bold text-(--cabms-text-primary) mt-0.5">
              Required Compliance Documents by Job Type
            </h2>
            <p className="text-xs text-(--cabms-text-secondary)">
              Rules governing operational completion requirements. Connected directly to work order creation and form validation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Filter buttons */}
            <div className="inline-flex rounded-lg border border-(--cabms-border-base) p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setJobTypeFilter('ACTIVE')}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  jobTypeFilter === 'ACTIVE'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setJobTypeFilter('ARCHIVED')}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  jobTypeFilter === 'ARCHIVED'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                Archived
              </button>
              <button
                type="button"
                onClick={() => setJobTypeFilter('ALL')}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  jobTypeFilter === 'ALL'
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                All ({jobTypes.length})
              </button>
            </div>

            {/* Add Job Type Button */}
            <button
              type="button"
              onClick={() => setIsAddJobTypeOpen(true)}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition flex items-center space-x-1.5 cursor-pointer shadow-sm"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              <span>Add Job Type</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto border border-slate-800 rounded-xl">
          <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
            <thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border">
              <tr>
                <th className="p-3">Job Type Category</th>
                <th className="p-3">Brand Affiliation</th>
                <th className="p-3">Required Compliance Forms</th>
                <th className="p-3">Matrix Version</th>
                <th className="p-3">Completion Rule</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--cabms-border-base) bg-transparent">
              {filteredJobTypes.map(jt => {
                const isArchived = jt.status === 'ARCHIVED';
                const isDraft = jt.status === 'DRAFT' || jt.policyStatus === 'DRAFT';
                const isReview = jt.policyStatus === 'REVIEW';
                const brandDisplayName = getBrandDisplayName(jt.brandId);

                return (
                  <tr
                    key={jt.id}
                    className={`${jt.isDirectToInvoice ? 'bg-slate-900/40' : ''} ${
                      isArchived ? 'opacity-60 bg-slate-950/40' : ''
                    }`}
                  >
                    <td className="p-3 font-semibold text-(--cabms-text-primary)">
                      <div className="flex items-center gap-2">
                        <span>{jt.name}</span>
                        {jt.isDirectToInvoice && (
                          <span className="text-[10px] cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) px-1.5 py-0.5 rounded font-mono">
                            Direct-to-Invoice
                          </span>
                        )}
                        {isArchived && (
                          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
                            Archived
                          </span>
                        )}
                        {isDraft && (
                          <span className="text-[10px] bg-amber-950/80 text-amber-400 border border-amber-800 px-1.5 py-0.5 rounded font-mono">
                            Draft
                          </span>
                        )}
                      </div>
                      {jt.description && (
                        <p className="text-[11px] text-(--cabms-text-secondary) mt-0.5 truncate max-w-xs font-normal">
                          {jt.description}
                        </p>
                      )}
                    </td>
                    <td className="p-3 font-medium text-amber-400">
                      {brandDisplayName}
                    </td>
                    <td className="p-3 font-mono text-sky-400">
                      {jt.formsRequired.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {jt.formsRequired.map(f => (
                            <span
                              key={f}
                              className="bg-sky-950/80 border border-sky-800 text-sky-300 text-[10px] px-1.5 py-0.5 rounded"
                            >
                              {f}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">None (Direct-to-invoice service)</span>
                      )}
                    </td>
                    <td className="p-3 text-(--cabms-text-secondary) font-mono">
                      <div className="flex items-center gap-1.5">
                        <span>{jt.version}</span>
                        {isReview && (
                          <span className="text-[10px] bg-purple-950 text-purple-300 border border-purple-800 px-1 py-0.2 rounded font-bold">
                            Review
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="p-3 font-semibold">
                      {jt.isDirectToInvoice ? (
                        <span className="text-sky-400">Direct Completion (No Forms)</span>
                      ) : (
                        <span className="text-emerald-400">Requires Signed Forms</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1 flex-wrap">
                        {/* View Button */}
                        <button
                          type="button"
                          onClick={() => setViewingJobTypeId(jt.id)}
                          className="px-2 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded text-[11px] font-semibold hover:border-amber-500 transition cursor-pointer"
                          title="View job type policy details and version history"
                        >
                          <FontAwesomeIcon icon={faEye} className="w-3 h-3 mr-1" />
                          View
                        </button>

                        {/* Configure Child Forms */}
                        <button
                          type="button"
                          onClick={() => setConfiguringJobTypeId(jt.id)}
                          className="px-2 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded text-[11px] font-semibold hover:border-amber-500 transition cursor-pointer"
                          title="Configure required child forms & completion rule"
                        >
                          Configure
                        </button>

                        {/* Edit metadata */}
                        <button
                          type="button"
                          onClick={() => handleOpenEditJobType(jt)}
                          className="px-2 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) rounded text-[11px] transition cursor-pointer"
                          title="Edit job type title and description"
                        >
                          <FontAwesomeIcon icon={faPenToSquare} className="w-3 h-3" />
                        </button>

                        {/* Draft Policy button */}
                        {!isDraft && !isReview && (
                          <button
                            type="button"
                            onClick={() => createJobTypePolicyDraft(jt.id)}
                            className="px-2 py-1 cabms-surface-subtle border cabms-border text-amber-400 rounded text-[11px] font-semibold transition cursor-pointer hover:border-amber-400"
                            title="Create new draft policy revision from current policy"
                          >
                            New Draft
                          </button>
                        )}

                        {/* Submit for Review */}
                        {isDraft && (
                          <button
                            type="button"
                            onClick={() => submitJobTypePolicyForReview(jt.id)}
                            className="px-2 py-1 bg-purple-700 hover:bg-purple-600 text-white rounded text-[11px] font-bold transition cursor-pointer"
                            title="Submit draft policy for review"
                          >
                            Submit Review
                          </button>
                        )}

                        {/* Approve & Publish */}
                        {isReview && (
                          <button
                            type="button"
                            onClick={() => approveJobTypePolicy(jt.id)}
                            disabled={persona === 'office_staff'}
                            className={`px-2 py-1 rounded text-[11px] font-bold transition cursor-pointer ${
                              persona === 'office_staff'
                                ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-sm'
                            }`}
                            title={persona === 'office_staff' ? 'Office staff cannot publish policies' : 'Approve and publish policy'}
                          >
                            Publish
                          </button>
                        )}

                        {/* Archive / Restore */}
                        {isArchived ? (
                          <button
                            type="button"
                            onClick={() => restoreJobType(jt.id)}
                            className="px-2 py-1 text-emerald-400 hover:text-emerald-300 rounded text-[11px] transition cursor-pointer"
                            title="Restore archived job type"
                          >
                            <FontAwesomeIcon icon={faRotateLeft} className="w-3 h-3" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => archiveJobType(jt.id)}
                            className="px-2 py-1 text-slate-400 hover:text-amber-400 rounded text-[11px] transition cursor-pointer"
                            title="Archive job type"
                          >
                            <FontAwesomeIcon icon={faBoxArchive} className="w-3 h-3" />
                          </button>
                        )}

                        {/* Delete Draft (Only if status is DRAFT) */}
                        {jt.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteJobTypeId(jt.id)}
                            className="px-2 py-1 text-rose-400 hover:text-rose-300 rounded text-[11px] transition cursor-pointer"
                            title="Delete draft job type"
                          >
                            <FontAwesomeIcon icon={faTrashCan} className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SECTION 2: TEMPLATE LIBRARY & VERSIONING WORKFLOW */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Template Catalog (5 cols) */}
        <div className="lg:col-span-5 cabms-card p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-(--cabms-text-secondary) uppercase tracking-wider">
              Template Library & Sample Selection
            </h3>
            <button
              type="button"
              onClick={() => setIsAddTemplateOpen(true)}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
              <span>Add Template</span>
            </button>
          </div>

          <p className="text-xs text-(--cabms-text-secondary)">
            Select built-in synthetic templates to inspect content snapshots and version states.
          </p>

          {/* Filter options */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] pb-1">
            {(['ALL', 'PUBLISHED', 'REVIEW', 'DRAFT', 'ARCHIVED'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => setTemplateFilter(tab)}
                className={`px-2 py-0.5 rounded font-semibold transition ${
                  templateFilter === tab
                    ? 'bg-amber-500 text-slate-950'
                    : 'cabms-surface-subtle text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-125 overflow-y-auto">
            {filteredTemplates.map(tpl => {
              const isSelected = tpl.id === selectedTemplateId;
              const isArchived = tpl.status === 'ARCHIVED';

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
                  } ${isArchived ? 'opacity-60' : ''}`}
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

                    <div className="flex items-center gap-1">
                      {isArchived ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                          ARCHIVED
                        </span>
                      ) : (
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
                      )}
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400">
                    <span>File: {tpl.sampleFileName || 'custom-template.docx'}</span>
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
              <h3 className="text-base font-bold text-(--cabms-text-primary) mt-0.5">
                {currentTemplate.name} ({currentTemplate.currentVersion})
              </h3>
              <span className="text-xs text-(--cabms-text-secondary)">
                Active Status: <strong className="text-sky-400">{currentTemplate.activeStatus}</strong> • Revisions: {currentTemplate.revisions?.length || 1}
                {currentTemplate.status === 'ARCHIVED' && ' • (Archived)'}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setPreviewModalDoc(currentTemplate)}
                className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) text-xs font-semibold rounded-lg transition cursor-pointer flex items-center space-x-1 hover:border-amber-500"
              >
                <FontAwesomeIcon icon={faEye} className="w-3.5 h-3.5" />
                <span>Preview Document</span>
              </button>

              {currentTemplate.status === 'ARCHIVED' ? (
                <button
                  type="button"
                  onClick={() => restoreTemplate(currentTemplate.id)}
                  className="px-3 py-1.5 text-emerald-400 border border-emerald-800/60 rounded-lg text-xs font-semibold hover:bg-emerald-950 transition cursor-pointer"
                >
                  Restore
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => archiveTemplate(currentTemplate.id)}
                  className="px-3 py-1.5 text-slate-400 border border-slate-700 rounded-lg text-xs font-semibold hover:text-amber-400 transition cursor-pointer"
                >
                  Archive
                </button>
              )}

              {(currentTemplate.status === 'DRAFT' || currentTemplate.activeStatus === 'DRAFT') && (
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTemplateId(currentTemplate.id)}
                  className="px-3 py-1.5 text-rose-400 border border-rose-800/60 rounded-lg text-xs font-semibold hover:bg-rose-950 transition cursor-pointer"
                >
                  Delete Draft
                </button>
              )}
            </div>
          </div>

          {/* Bounded Text Content Editor */}
          <div className="space-y-2 text-xs">
            <label className="block text-(--cabms-text-secondary) font-semibold">
              Supported Standard Wording & Form Clauses (Sample Regulatory Wording):
            </label>
            <textarea
              rows={5}
              value={editingContent !== '' ? editingContent : currentTemplate.content}
              onChange={e => setEditingContent(e.target.value)}
              className="w-full p-3 cabms-card-subtle text-(--cabms-text-primary) text-xs focus:outline-none focus:border-amber-500 font-sans leading-relaxed rounded-lg"
            />
            <p className="text-[11px] text-slate-500 italic">
              Notice: Editing template text creates a new Draft revision. Historical signed documents and accepted quotations will continue to render their original frozen version snapshot.
            </p>
          </div>

          {/* Workflow Action Controls */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={handleStartDraft}
                className="px-3 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg transition cursor-pointer hover:border-amber-500"
              >
                Save Draft Revision
              </button>

              {currentTemplate.activeStatus === 'DRAFT' && (
                <button
                  type="button"
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
                type="button"
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
              <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[10px] block">
                Revision Audit History (Immutable Snapshots)
              </span>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {currentTemplate.revisions.map((rev, idx) => (
                  <div key={idx} className="cabms-card-subtle p-2.5 flex items-center justify-between text-[11px] rounded-lg">
                    <div>
                      <span className="font-mono font-bold text-sky-400">{rev.version}</span> • Status: <strong className="text-(--cabms-text-primary)">{rev.status}</strong>
                      <span className="text-slate-500 ml-2">by {rev.updatedBy} ({rev.updatedAt})</span>
                    </div>
                    <span className="text-(--cabms-text-secondary) italic truncate max-w-xs">{rev.content.slice(0, 40)}...</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal 1: Synthetic Document Preview Modal */}
      {previewModalDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-(--cabms-text-primary)">{previewModalDoc.name}</h3>
                <span className="text-xs text-sky-400 font-mono">
                  Version: {previewModalDoc.currentVersion} ({previewModalDoc.activeStatus})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModalDoc(null)}
                className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <div className="cabms-card-subtle p-4 text-xs text-(--cabms-text-secondary) space-y-3 font-sans leading-relaxed rounded-lg">
              <div className="text-[11px] font-mono text-slate-500 uppercase">
                Sample File: {previewModalDoc.sampleFileName || 'custom.docx'} • Mapping: {previewModalDoc.mappingStatus}
              </div>
              <p className="cabms-surface-subtle p-3 rounded border cabms-border">
                {previewModalDoc.content}
              </p>
              <div className="text-[10px] text-amber-300/80 bg-amber-950/30 p-2 rounded border border-amber-800/40">
                Compliance Notice: Sample template clauses must be reviewed and published under corporate governance.
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewModalDoc(null)}
                className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: View Job Type Details & Policy Version History */}
      {viewingJobType && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-2xl w-full p-6 shadow-2xl space-y-5 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-(--cabms-text-primary)">
                  {viewingJobType.name}
                </h3>
                <span className="text-xs text-sky-400 font-mono">
                  Code: {viewingJobType.code || viewingJobType.id} • Brand: {getBrandDisplayName(viewingJobType.brandId)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setViewingJobTypeId(null)}
                className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="cabms-card-subtle p-3 rounded-lg space-y-1">
                <span className="text-[10px] text-(--cabms-text-secondary) font-bold uppercase">Completion Rule</span>
                <p className="font-semibold text-(--cabms-text-primary)">
                  {viewingJobType.isDirectToInvoice ? 'Direct Completion (No Forms)' : 'Requires Signed Forms'}
                </p>
              </div>
              <div className="cabms-card-subtle p-3 rounded-lg space-y-1">
                <span className="text-[10px] text-(--cabms-text-secondary) font-bold uppercase">Current Policy Version</span>
                <p className="font-mono font-bold text-amber-400">
                  {viewingJobType.version}
                </p>
              </div>
            </div>

            {viewingJobType.description && (
              <div className="cabms-card-subtle p-3 rounded-lg space-y-1">
                <span className="text-[10px] text-(--cabms-text-secondary) font-bold uppercase">Description</span>
                <p className="text-(--cabms-text-secondary)">{viewingJobType.description}</p>
              </div>
            )}

            <div className="space-y-1.5">
              <span className="text-[10px] text-(--cabms-text-secondary) font-bold uppercase">Currently Required Forms</span>
              <div className="flex flex-wrap gap-1.5">
                {viewingJobType.formsRequired.length > 0 ? (
                  viewingJobType.formsRequired.map(f => (
                    <span key={f} className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-950 border border-sky-800 text-sky-300">
                      {f}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-500 italic">Direct-to-invoice service exception (zero required forms).</span>
                )}
              </div>
            </div>

            {/* Policy Version History Table */}
            <div className="space-y-2">
              <span className="text-[10px] text-(--cabms-text-secondary) font-bold uppercase">
                Immutable Policy Version History & Audit Ledger
              </span>
              <div className="border border-slate-800 rounded-lg overflow-x-auto max-h-48 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <thead className="cabms-surface-subtle border-b cabms-border text-slate-400 uppercase text-[10px]">
                    <tr>
                      <th className="p-2">Version</th>
                      <th className="p-2">Status</th>
                      <th className="p-2">Forms</th>
                      <th className="p-2">Rule</th>
                      <th className="p-2">Recorded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800 text-(--cabms-text-secondary)">
                    {(viewingJobType.revisionHistory || []).map((rev, idx) => (
                      <tr key={idx}>
                        <td className="p-2 font-mono font-bold text-sky-400">{rev.version}</td>
                        <td className="p-2">
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-slate-900 border border-slate-700">
                            {rev.status || 'PUBLISHED'}
                          </span>
                        </td>
                        <td className="p-2 font-mono text-[10px]">
                          {rev.formsRequired.length > 0 ? rev.formsRequired.join(', ') : 'None'}
                        </td>
                        <td className="p-2">
                          {rev.isDirectToInvoice ? 'Direct-to-Invoice' : 'Requires Forms'}
                        </td>
                        <td className="p-2 text-slate-500">
                          {rev.updatedBy} ({rev.updatedAt})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setViewingJobTypeId(null)}
                className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Add Job Type */}
      {isAddJobTypeOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-(--cabms-text-primary)">Add New Job Type</h3>
              <button
                type="button"
                onClick={() => setIsAddJobTypeOpen(false)}
                className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateJobType} className="space-y-4">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">
                  Category Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newJtName}
                  onChange={e => setNewJtName(e.target.value)}
                  placeholder="e.g. Commercial Heat Pump Service"
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Code / Identifier</label>
                  <input
                    type="text"
                    value={newJtCode}
                    onChange={e => setNewJtCode(e.target.value)}
                    placeholder="e.g. HEAT_PUMP_COMM"
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  />
                </div>

                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Brand Affiliation</label>
                  <select
                    value={newJtBrandId}
                    onChange={e => setNewJtBrandId(e.target.value as BrandId)}
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  >
                    <option value="solarcell">Solarcell</option>
                    <option value="smart_home">Gold Coast Smart Home</option>
                    <option value="cctv">Gold Coast CCTV</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newJtDescription}
                  onChange={e => setNewJtDescription(e.target.value)}
                  placeholder="Brief description of work order scope..."
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Service Classification</label>
                <label className="flex items-center space-x-2 cursor-pointer cabms-card-subtle p-3 rounded">
                  <input
                    type="checkbox"
                    checked={newJtDirectToInvoice}
                    onChange={e => setNewJtDirectToInvoice(e.target.checked)}
                    className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                  />
                  <div>
                    <span className="font-bold text-(--cabms-text-primary)">Direct-to-Invoice Service Exception</span>
                    <span className="block text-[11px] text-(--cabms-text-secondary)">
                      When checked, zero compliance documentation is required for job sign-off.
                    </span>
                  </div>
                </label>
              </div>

              {!newJtDirectToInvoice && (
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1.5">
                    Required Compliance Forms (Multi-form Gating)
                  </label>
                  <div className="space-y-1.5 cabms-card-subtle p-3 rounded">
                    {COMPLIANCE_FORM_TYPES.map(formKey => {
                      const isChecked = newJtForms.includes(formKey);
                      return (
                        <label key={formKey} className="flex items-center space-x-2 cursor-pointer text-(--cabms-text-secondary)">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={e => {
                              setNewJtForms(prev =>
                                e.target.checked ? [...prev, formKey] : prev.filter(f => f !== formKey)
                              );
                            }}
                            className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                          />
                          <span className="font-mono text-sky-300 font-semibold">{formKey}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddJobTypeOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg shadow-sm"
                >
                  Create Job Type
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Edit Job Type */}
      {editingJobTypeId && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-(--cabms-text-primary)">Edit Job Type</h3>
              <button
                type="button"
                onClick={() => setEditingJobTypeId(null)}
                className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEditJobType} className="space-y-4">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">
                  Category Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editJtName}
                  onChange={e => setEditJtName(e.target.value)}
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Code</label>
                  <input
                    type="text"
                    value={editJtCode}
                    onChange={e => setEditJtCode(e.target.value)}
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  />
                </div>

                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Brand Affiliation</label>
                  <select
                    value={editJtBrandId}
                    onChange={e => setEditJtBrandId(e.target.value as BrandId)}
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  >
                    <option value="solarcell">Solarcell</option>
                    <option value="smart_home">Gold Coast Smart Home</option>
                    <option value="cctv">Gold Coast CCTV</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Description</label>
                <textarea
                  rows={3}
                  value={editJtDescription}
                  onChange={e => setEditJtDescription(e.target.value)}
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingJobTypeId(null)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg shadow-sm"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Job Type Configuration Modal */}
      {configuringJobTypeId && (() => {
        const targetJt = jobTypes.find(jt => jt.id === configuringJobTypeId);
        if (!targetJt) return null;

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-base font-bold text-(--cabms-text-primary)">Configure {targetJt.name}</h3>
                <button
                  type="button"
                  onClick={() => setConfiguringJobTypeId(null)}
                  className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Service Classification</label>
                  <label className="flex items-center space-x-2 cursor-pointer cabms-card-subtle p-3 rounded">
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
                      <span className="font-bold text-(--cabms-text-primary)">Direct-to-Invoice Service Exception</span>
                      <span className="block text-[11px] text-(--cabms-text-secondary)">
                        When enabled, no compliance documentation is required for job sign-off.
                      </span>
                    </div>
                  </label>
                </div>

                {!targetJt.isDirectToInvoice && (
                  <div>
                    <label className="text-(--cabms-text-secondary) block font-semibold mb-1.5">
                      Required Compliance Forms (Multi-form Gating)
                    </label>
                    <div className="space-y-1.5 cabms-card-subtle p-3 rounded">
                      {COMPLIANCE_FORM_TYPES.map(formKey => {
                        const isChecked = targetJt.formsRequired.includes(formKey);
                        return (
                          <label key={formKey} className="flex items-center space-x-2 cursor-pointer text-(--cabms-text-secondary)">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={e => {
                                const newForms = e.target.checked
                                  ? [...targetJt.formsRequired, formKey]
                                  : targetJt.formsRequired.filter(f => f !== formKey);
                                updateJobTypeConfig(targetJt.id, newForms, targetJt.isDirectToInvoice);
                              }}
                              className="rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                            />
                            <span className="font-mono text-sky-300">{formKey}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setConfiguringJobTypeId(null)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 6: Add Template Modal */}
      {isAddTemplateOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-(--cabms-text-primary)">Add Document Template</h3>
              <button
                type="button"
                onClick={() => setIsAddTemplateOpen(false)}
                className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">
                  Template Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newTplName}
                  onChange={e => setNewTplName(e.target.value)}
                  placeholder="e.g. Master CCTV Maintenance SLA"
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Code / Key</label>
                  <input
                    type="text"
                    value={newTplCode}
                    onChange={e => setNewTplCode(e.target.value)}
                    placeholder="e.g. CCTV_MAINT_SLA"
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  />
                </div>

                <div>
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Document Type</label>
                  <select
                    value={newTplType}
                    onChange={e => setNewTplType(e.target.value as TemplateSetting['type'])}
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  >
                    <option value="TERMS">Standard Terms & Conditions</option>
                    <option value="JSA">Safe Work Method Statement (JSA)</option>
                    <option value="ELECTRICAL">Electrical Safety Certificate</option>
                    <option value="SMOKE_ALARM">Smoke Alarm Certificate</option>
                    <option value="TCA1">TCA1 Cabling Compliance</option>
                    <option value="TCA2">TCA2 Non-Compliance Report</option>
                    <option value="EMAIL_CONFIRMATION">Booking Confirmation</option>
                    <option value="REVIEW_REQUEST">Review Request Notification</option>
                    <option value="QUOTE_FOLLOWUP">Quote Expiration Reminder</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Sample File Name</label>
                <input
                  type="text"
                  value={newTplSampleFile}
                  onChange={e => setNewTplSampleFile(e.target.value)}
                  placeholder="e.g. cctv-sla-template-v1.docx"
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">
                  Initial Standard Clauses & Form Text
                </label>
                <textarea
                  rows={4}
                  required
                  value={newTplContent}
                  onChange={e => setNewTplContent(e.target.value)}
                  placeholder="Standard regulatory terms and conditions text..."
                  className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddTemplateOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg shadow-sm"
                >
                  Add Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 7: Confirm Delete Job Type Draft */}
      {confirmDeleteJobTypeId && (() => {
        const target = jobTypes.find(jt => jt.id === confirmDeleteJobTypeId);
        if (!target) return null;

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="cabms-card max-w-sm w-full p-6 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center space-x-2 text-rose-400">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5" />
                <h3 className="text-base font-bold text-(--cabms-text-primary)">Delete Draft Job Type?</h3>
              </div>
              <p className="text-(--cabms-text-secondary)">
                Are you sure you want to permanently delete draft job type <strong>{target.name}</strong>?
                This action cannot be undone. Only drafts with zero associated jobs can be deleted.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteJobTypeId(null)}
                  className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteJobTypeDraft(target.id);
                    setConfirmDeleteJobTypeId(null);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal 8: Confirm Delete Template Draft */}
      {confirmDeleteTemplateId && (() => {
        const target = templates.find(t => t.id === confirmDeleteTemplateId);
        if (!target) return null;

        return (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="cabms-card max-w-sm w-full p-6 shadow-2xl space-y-4 text-xs">
              <div className="flex items-center space-x-2 text-rose-400">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5" />
                <h3 className="text-base font-bold text-(--cabms-text-primary)">Delete Draft Template?</h3>
              </div>
              <p className="text-(--cabms-text-secondary)">
                Are you sure you want to delete draft template <strong>{target.name}</strong>?
                Published and active templates cannot be physically deleted; archive them instead to preserve historical contracts.
              </p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteTemplateId(null)}
                  className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    deleteTemplateDraft(target.id);
                    setConfirmDeleteTemplateId(null);
                  }}
                  className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg shadow-sm"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
