/**
 * Area C: Owner/Admin Content and Template Settings
 * Full CRUD & Lifecycle Integration:
 * - Job Types, Compliance Policies, and Required Form Rules
 * - Document Templates and Immutable Revision Snapshots
 * - Bounded form field configuration, draft-to-published versioning, and matrix table.
 * Strictly enforces unconditional hook declarations (G00-008).
 */

import React, { useEffect, useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FormLibrary } from '../components/FormLibrary.tsx';
import { CatalogPolicyEditor } from '../components/CatalogPolicyEditor.tsx';
import { JobFormSelector } from '../components/JobFormSelector.tsx';
import { useG01Session } from '../context/G01Session.tsx';
import {
  apiApproveTemplateRevision,
  apiDocumentTypes,
  apiFormCatalog,
  apiGetTemplate,
  apiListTemplates,
  apiPatchTemplate,
  apiSubmitTemplateRevisionReview,
} from '../services/g01Client.ts';
import { DocumentTypeCatalog } from '../components/DocumentTypeCatalog.tsx';
import { mapTemplateDetail, templateDraftContent } from '../utils/templateServerMapping.ts';
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

const TEMPLATE_MAPPING_SOURCES = [
  'business.name',
  'business.abn',
  'customer.name',
  'customer.email',
  'job.id',
  'job.title',
  'site.address',
  'technician.name',
  'quote.total',
  'date',
] as const;

const DEFAULT_PREVIEW_SAMPLE_DATA: Record<string, string> = {
  'business.name': 'Solarcell Electrical & Solar',
  'business.abn': '12 345 678 901',
  'customer.name': 'Brisbane Commercial Properties Pty Ltd',
  'customer.email': 'facilities@brisbanecommercial.example',
  'job.id': 'JOB-2026-101',
  'job.title': '10kW Commercial Solar PV System',
  'site.address': '42 Creek Street, Brisbane QLD 4000',
  'technician.name': 'Alex Mercer',
  'quote.total': '$18,450.00 (incl. GST)',
  'date': '2026-11-28',
};

type OutputCategory = 'Compliance' | 'Terms' | 'Email' | 'Contract';

interface TemplateOutputDraft {
  category: OutputCategory;
  brand_id: string;
  linked_form_revision_id: string | null;
  document_type_id: string | null;
  layout: Record<string, unknown>;
}

function inferOutputCategory(typeOrRaw: string | undefined): OutputCategory {
  if (typeOrRaw === 'QUOTE_TERMS' || typeOrRaw === 'INVOICE_TERMS' || typeOrRaw === 'TERMS') return 'Terms';
  if (typeOrRaw === 'EMAIL_COVER' || typeOrRaw === 'EMAIL_CONFIRMATION' || typeOrRaw === 'REVIEW_REQUEST' || typeOrRaw === 'QUOTE_FOLLOWUP') return 'Email';
  return 'Compliance';
}

function getActiveServerRevision(detail: any) {
  const revisions = Array.isArray(detail?.revisions) ? detail.revisions : [];
  const pending = revisions.find((r: any) => r.status === 'DRAFT' || r.status === 'REVIEW');
  const current = detail?.current_revision_id ? revisions.find((r: any) => r.id === detail.current_revision_id) : undefined;
  return pending || current || revisions[0];
}

function extractStringMappings(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

function computeAutoMappingStatus(
  content: string,
  mappings: Record<string, string>,
  currentStatus?: TemplateSetting['mappingStatus']
): TemplateSetting['mappingStatus'] {
  const placeholders = extractTemplatePlaceholders(content);
  if (placeholders.length === 0) return currentStatus || 'Mapped';
  const hasUnmapped = placeholders.some(ph => {
    if (Object.prototype.hasOwnProperty.call(mappings, ph)) return !mappings[ph];
    return !(TEMPLATE_MAPPING_SOURCES as readonly string[]).includes(ph);
  });
  return hasUnmapped ? 'Pending Review' : 'Mapped';
}

export function extractTemplatePlaceholders(content: string): string[] {
  return Array.from(new Set(Array.from(content.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g), m => m[1])));
}

export function renderSimulatedDocumentPreview(
  content: string,
  fieldMappings: Record<string, string> = {},
  sampleData: Record<string, string> = {}
) {
  const placeholders = extractTemplatePlaceholders(content);
  const unmappedPlaceholders: string[] = [];
  const resolvedValues: Record<string, string> = {};

  for (const key of placeholders) {
    const mappedSource = fieldMappings[key] || key;
    const value = sampleData[key] ?? sampleData[mappedSource] ?? DEFAULT_PREVIEW_SAMPLE_DATA[mappedSource];
    if (value !== undefined && value !== '') {
      resolvedValues[key] = value;
    } else {
      unmappedPlaceholders.push(key);
    }
  }

  const renderedText = content.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) =>
    resolvedValues[key] !== undefined ? resolvedValues[key] : match
  );

  return {
    renderedText,
    placeholders,
    resolvedValues,
    unmappedPlaceholders,
  };
}

export const TemplateModal: React.FC<{
  onClose: () => void;
  titleId: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}> = ({ onClose, titleId, maxWidthClass = 'max-w-lg', children }) => {
  const previousFocusRef = React.useRef<HTMLElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    previousFocusRef.current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const dialog = dialogRef.current;
    if (dialog) {
      const target = dialog.querySelector<HTMLElement>('[autofocus], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || dialog;
      target.focus();
    }
    return () => {
      previousFocusRef.current?.focus?.();
    };
  }, []);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
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
  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onKeyDown={handleKeyDown}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`cabms-card w-full ${maxWidthClass} max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4`}
      >
        {children}
      </div>
    </div>
  );
};

export const TemplatesSettingsView: React.FC = () => {
  const session = useG01Session();
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    brands,
    activeTab,
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
    showDemoNotification,
    demoClock,
  } = useCabms();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('TPL-001');
  const [editingContent, setEditingContent] = useState<string>('');
  const [hasEditedTemplate, setHasEditedTemplate] = useState(false);
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
  const [jobCatalogForms, setJobCatalogForms] = useState<Array<{id:string;title:string;code:string;brand_id:string;created_at:string;published_revision_id:string}>>([]);
  const [newJtFormRevisions, setNewJtFormRevisions] = useState<string[]>([]);
  const [jobCatalogError, setJobCatalogError] = useState('');

  // Edit Job Type Form
  const [editJtName, setEditJtName] = useState('');
  const [editJtCode, setEditJtCode] = useState('');
  const [editJtBrandId, setEditJtBrandId] = useState<BrandId>('solarcell');
  const [editJtDescription, setEditJtDescription] = useState('');

  // Template Modals & State
  const [isAddTemplateOpen, setIsAddTemplateOpen] = useState(false);
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null);
  const [templateFilter, setTemplateFilter] = useState<'ALL' | 'PUBLISHED' | 'REVIEW' | 'DRAFT' | 'ARCHIVED'>('ALL');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateTypeFilter, setTemplateTypeFilter] = useState<'ALL' | TemplateSetting['type']>('ALL');

  // New Template Form
  const [newTplName, setNewTplName] = useState('');
  const [newTplCode, setNewTplCode] = useState('');
  const [newTplType, setNewTplType] = useState<TemplateSetting['type']>('TERMS');
  const [newTplContent, setNewTplContent] = useState('');
  const [newTplSampleFile, setNewTplSampleFile] = useState('');
  const [newTplDescription, setNewTplDescription] = useState('');
  const [newTplLayoutPaper, setNewTplLayoutPaper] = useState<'A4' | 'LETTER'>('A4');
  const [newTplMappings, setNewTplMappings] = useState<Record<string, string>>({});
  const [templateMappings, setTemplateMappings] = useState<Record<string, Record<string, string>>>({});
  const [templateSampleFiles, setTemplateSampleFiles] = useState<Record<string, string>>({});
  const [templateOutputs, setTemplateOutputs] = useState<Record<string, TemplateOutputDraft>>({});
  const [templateMappingStatuses, setTemplateMappingStatuses] = useState<Record<string, TemplateSetting['mappingStatus']>>({});
  const [serverTemplateDetails, setServerTemplateDetails] = useState<Record<string, any>>({});
  const [standaloneTemplates, setStandaloneTemplates] = useState<TemplateSetting[] | null>(null);
  const [dirtyTemplateMeta, setDirtyTemplateMeta] = useState<Record<string, boolean>>({});
  const [editorPublishedForms, setEditorPublishedForms] = useState<Array<{id:string;title:string;code:string;published_revision_id:string}>>([]);
  const [editorDocumentTypes, setEditorDocumentTypes] = useState<Array<{id:string;title:string;code:string}>>([]);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [templateSaveFeedback, setTemplateSaveFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [templateUploadNotice, setTemplateUploadNotice] = useState('');
  const [previewSampleData, setPreviewSampleData] = useState<Record<string, string>>({});
  const [previewShowRaw, setPreviewShowRaw] = useState(false);
  const [outputCategory, setOutputCategory] = useState<'Compliance'|'Terms'|'Email'|'Contract'>('Compliance');
  const [linkedFormRevision, setLinkedFormRevision] = useState('');
  const [publishedForms, setPublishedForms] = useState<Array<{id:string;title:string;code:string;published_revision_id:string}>>([]);
  const [catalogError, setCatalogError] = useState('');
  const [documentTypes, setDocumentTypes] = useState<Array<{id:string;title:string;code:string}>>([]);
  const [documentTypeId, setDocumentTypeId] = useState('');

  const dirtyTemplateMetaRef = React.useRef<Record<string, boolean>>({});
  dirtyTemplateMetaRef.current = dirtyTemplateMeta;
  const hasEditedTemplateRef = React.useRef(false);
  hasEditedTemplateRef.current = hasEditedTemplate;
  const currentTemplateIdRef = React.useRef<string | undefined>(undefined);
  const latestTemplateMappingsRef = React.useRef<Record<string, Record<string, string>>>({});
  latestTemplateMappingsRef.current = templateMappings;
  const latestTemplateOutputsRef = React.useRef<Record<string, TemplateOutputDraft>>({});
  latestTemplateOutputsRef.current = templateOutputs;
  const latestTemplateSampleFilesRef = React.useRef<Record<string, string>>({});
  latestTemplateSampleFilesRef.current = templateSampleFiles;
  const latestTemplateMappingStatusesRef = React.useRef<Record<string, TemplateSetting['mappingStatus']>>({});
  latestTemplateMappingStatusesRef.current = templateMappingStatuses;

  const hydrateFromServerDetail = (templateId: string, detail: any, force = false) => {
    if (!detail || typeof detail !== 'object') return;
    setServerTemplateDetails(prev => ({ ...prev, [templateId]: detail }));
    const activeRev = getActiveServerRevision(detail);
    const revOutput = activeRev?.output || detail.output || null;
    const savedSampleFile = typeof activeRev?.sample_file_name === 'string' && activeRev.sample_file_name.trim()
      ? activeRev.sample_file_name
      : (typeof detail.sample_file_name === 'string' ? detail.sample_file_name : '');
    const savedMappingStatus = (detail.mapping_status as TemplateSetting['mappingStatus']) || 'Mapped';
    const savedMappings = extractStringMappings(revOutput?.dynamic_fields);
    const savedOutput: TemplateOutputDraft = {
      category: (revOutput?.category as OutputCategory) || inferOutputCategory(detail.template_type),
      brand_id: revOutput?.brand_id || detail.workspace_id || session?.workspaceId || '',
      linked_form_revision_id: revOutput?.linked_form_revision_id ?? null,
      document_type_id: revOutput?.document_type_id ?? null,
      layout: (revOutput?.layout && typeof revOutput.layout === 'object' && !Array.isArray(revOutput.layout))
        ? { paper: 'A4', ...revOutput.layout }
        : { paper: 'A4' },
    };

    if (force || !dirtyTemplateMetaRef.current[templateId]) {
      latestTemplateSampleFilesRef.current = { ...latestTemplateSampleFilesRef.current, [templateId]: savedSampleFile };
      latestTemplateMappingStatusesRef.current = { ...latestTemplateMappingStatusesRef.current, [templateId]: savedMappingStatus };
      latestTemplateMappingsRef.current = { ...latestTemplateMappingsRef.current, [templateId]: savedMappings };
      latestTemplateOutputsRef.current = { ...latestTemplateOutputsRef.current, [templateId]: savedOutput };
      setTemplateSampleFiles(prev => ({ ...prev, [templateId]: savedSampleFile }));
      setTemplateMappingStatuses(prev => ({ ...prev, [templateId]: savedMappingStatus }));
      setTemplateMappings(prev => ({ ...prev, [templateId]: savedMappings }));
      setTemplateOutputs(prev => ({ ...prev, [templateId]: savedOutput }));
    }
    if (force && templateId === currentTemplateIdRef.current && typeof activeRev?.content === 'string') {
      setHasEditedTemplate(false);
      setEditingContent(activeRev.content);
    } else if (!hasEditedTemplateRef.current && templateId === currentTemplateIdRef.current && typeof activeRev?.content === 'string') {
      setEditingContent(activeRev.content);
    }
  };

  useEffect(() => {
    latestTemplateMappingsRef.current = {};
    latestTemplateOutputsRef.current = {};
    latestTemplateSampleFilesRef.current = {};
    latestTemplateMappingStatusesRef.current = {};
    setServerTemplateDetails({});
    setStandaloneTemplates(null);
    setTemplateOutputs({});
    setTemplateMappingStatuses({});
    setTemplateMappings({});
    setTemplateSampleFiles({});
    setDirtyTemplateMeta({});
    setHasEditedTemplate(false);
    setEditingContent('');
    setTemplateUploadNotice('');
    setTemplateSaveFeedback(null);
    setEditorPublishedForms([]);
    setEditorDocumentTypes([]);
  }, [session?.workspaceId, session?.profile?.user.id]);

  useEffect(() => {
    if (!session?.workspaceId || !session?.profile) return;
    let active = true;
    const workspace = session.workspaceId;
    void (async () => {
      try {
        const token = await session.token();
        const [formsRes, typesRes] = await Promise.all([
          apiFormCatalog<Array<{id:string;title:string;code:string;published_revision_id:string}>>(workspace, token, '?published=1'),
          apiDocumentTypes<Array<{id:string;title:string;code:string}>>(workspace, token, '?published=1'),
        ]);
        if (!active) return;
        if (formsRes.ok && Array.isArray(formsRes.data)) setEditorPublishedForms(formsRes.data);
        if (typesRes.ok && Array.isArray(typesRes.data)) setEditorDocumentTypes(typesRes.data);
      } catch {
        // Editor catalog dropdowns remain optional
      }
    })();
    return () => { active = false; };
  }, [session?.workspaceId, session?.profile?.user.id]);

  useEffect(() => {
    if (!session?.workspaceId || !session?.profile || activeTab === 'templates') {
      if (activeTab === 'templates') setStandaloneTemplates(null);
      return;
    }
    let active = true;
    const workspace = session.workspaceId;
    void (async () => {
      try {
        const token = await session.token();
        const listRes = await apiListTemplates(workspace, token);
        if (!active || !listRes.ok || !Array.isArray(listRes.data)) return;
        const details = await Promise.all(listRes.data.map(row => apiGetTemplate(workspace, row.id, token)));
        if (!active) return;
        const mappedList: TemplateSetting[] = [];
        for (const d of details) {
          if (!d.ok || !d.data) continue;
          const mapped = mapTemplateDetail(d.data);
          if (mapped) mappedList.push(mapped);
          hydrateFromServerDetail(d.data.id, d.data);
        }
        setStandaloneTemplates(mappedList);
      } catch {
        // Keep existing template list if standalone load fails
      }
    })();
    return () => { active = false; };
  }, [session?.workspaceId, session?.profile?.user.id, activeTab]);

  useEffect(() => {
    let active = true;
    setJobCatalogForms([]); setNewJtFormRevisions([]); setJobCatalogError('');
    if (!isAddJobTypeOpen || !session?.workspaceId || !session.profile) return () => { active = false; };
    const workspace = session.workspaceId;
    setNewJtBrandId(workspace);
    void (async () => { try {
      const result = await apiFormCatalog<Array<{id:string;title:string;code:string;brand_id:string;created_at:string;published_revision_id:string}>>(workspace,await session.token(),'?published=1');
      if (!result.ok || !result.data) throw new Error(result.problem?.detail || 'Unable to load approved forms.');
      if (active) setJobCatalogForms(result.data.filter(form=>form.brand_id===workspace));
    } catch (error) { if (active) setJobCatalogError(error instanceof Error ? error.message : 'Unable to load approved forms.'); } })();
    return () => { active = false; };
  }, [isAddJobTypeOpen,session?.workspaceId,session?.profile?.user.id]);
  useEffect(() => {
    let active = true;
    setPublishedForms([]); setLinkedFormRevision(''); setDocumentTypes([]); setDocumentTypeId(''); setCatalogError('');
    if (!isAddTemplateOpen || !session?.workspaceId || !session.profile) return () => { active = false; };
    const workspace = session.workspaceId;
    void (async () => { try {
      const result = await apiFormCatalog<Array<{id:string;title:string;code:string;published_revision_id:string}>>(workspace,await session.token(),'?published=1');
      if (!result.ok || !result.data) throw new Error(result.problem?.detail || 'Unable to load approved forms.');
      if (active) setPublishedForms(result.data);
      const types = await apiDocumentTypes<Array<{id:string;title:string;code:string}>>(workspace,await session.token(),'?published=1');
      if (!types.ok || !types.data) throw new Error(types.problem?.detail || 'Unable to load document types.');
      if (active) setDocumentTypes(types.data);
    } catch (error) { if (active) setCatalogError(error instanceof Error ? error.message : 'Unable to load approved forms.'); } })();
    return () => { active = false; };
  }, [isAddTemplateOpen,session?.workspaceId,session?.profile?.user.id]);

  const baseTemplates = (session?.workspaceId && session?.profile && standaloneTemplates !== null)
    ? standaloneTemplates
    : templates;

  const effectiveTemplates = baseTemplates.map(tpl => {
    const detail = serverTemplateDetails[tpl.id];
    if (!detail) return tpl;
    const mapped = mapTemplateDetail(detail);
    if (!mapped) return tpl;
    return {
      ...mapped,
      sampleFileName: templateSampleFiles[tpl.id] || mapped.sampleFileName,
      mappingStatus: templateMappingStatuses[tpl.id] || mapped.mappingStatus,
    };
  });

  const filteredTemplates = effectiveTemplates.filter(t => {
    if (templateTypeFilter !== 'ALL' && t.type !== templateTypeFilter) return false;
    if (templateSearch.trim()) {
      const q = templateSearch.trim().toLowerCase();
      if (!t.name.toLowerCase().includes(q) && !t.code?.toLowerCase().includes(q)) return false;
    }
    if (templateFilter === 'ALL') return true;
    if (templateFilter === 'ARCHIVED') return t.status === 'ARCHIVED';
    if (t.status === 'ARCHIVED') return false;
    return t.activeStatus === templateFilter;
  });

  React.useEffect(() => {
    if (selectedTemplateId && !filteredTemplates.some(t => t.id === selectedTemplateId)) {
      setSelectedTemplateId(filteredTemplates[0]?.id ?? '');
    }
  }, [filteredTemplates, selectedTemplateId]);

  const currentTemplate = filteredTemplates.find(t => t.id === selectedTemplateId) || filteredTemplates[0];
  const currentTemplateId = currentTemplate?.id;
  currentTemplateIdRef.current = currentTemplateId;

  useEffect(() => {
    if (!session?.workspaceId || !session?.profile || !currentTemplateId) return;
    let active = true;
    const workspace = session.workspaceId;
    void (async () => {
      try {
        const token = await session.token();
        const res = await apiGetTemplate(workspace, currentTemplateId, token);
        if (!active || !res.ok || !res.data) return;
        hydrateFromServerDetail(currentTemplateId, res.data);
      } catch {
        // Keep currently loaded template state if detail fetch fails
      }
    })();
    return () => { active = false; };
  }, [session?.workspaceId, session?.profile?.user.id, currentTemplateId]);

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

  const refreshServerTemplate = async (templateId: string, force = false) => {
    if (!session?.workspaceId || !session?.profile) return null;
    const token = await session.token();
    const res = await apiGetTemplate(session.workspaceId, templateId, token);
    if (res.ok && res.data) {
      hydrateFromServerDetail(templateId, res.data, force);
      const mapped = mapTemplateDetail(res.data);
      if (mapped && standaloneTemplates !== null) {
        setStandaloneTemplates(prev => {
          if (!prev) return prev;
          return prev.some(item => item.id === templateId)
            ? prev.map(item => (item.id === templateId ? mapped : item))
            : [...prev, mapped];
        });
      }
      return res.data;
    }
    return null;
  };

  const handleStartDraft = async () => {
    if (!currentTemplate) return;
    const nextContent = templateDraftContent(editingContent, currentTemplate.content, hasEditedTemplate);
    if (!session?.workspaceId || !session?.profile) {
      createTemplateDraftRevision(currentTemplate.id, nextContent);
      setHasEditedTemplate(false);
      setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: false }));
      return;
    }
    if (!nextContent.trim()) {
      const msg = 'Content is required and must be at most 100000 characters';
      setTemplateSaveFeedback({ type: 'error', message: msg });
      showDemoNotification(msg, 'error');
      return;
    }

    setIsSavingDraft(true);
    setTemplateSaveFeedback(null);
    try {
      const token = await session.token();
      let detail = serverTemplateDetails[currentTemplate.id];
      if (!detail) {
        const fetched = await apiGetTemplate(session.workspaceId, currentTemplate.id, token);
        if (!fetched.ok || !fetched.data) {
          const msg = fetched.problem?.detail || 'Unable to load latest template revision before saving.';
          setTemplateSaveFeedback({ type: 'error', message: msg });
          showDemoNotification(msg, 'error');
          return;
        }
        detail = fetched.data;
        hydrateFromServerDetail(currentTemplate.id, detail);
      }

      const revisions = Array.isArray(detail.revisions) ? detail.revisions : [];
      const draftRev = revisions.find((r: any) => r.status === 'DRAFT');
      const activeRev = getActiveServerRevision(detail);
      const activeMappings = latestTemplateMappingsRef.current[currentTemplate.id] || templateMappings[currentTemplate.id] || {};
      const placeholders = extractTemplatePlaceholders(nextContent);
      const dynamicFieldsToSave: Record<string, string> = {};
      for (const [k, v] of Object.entries(activeMappings)) {
        if (typeof v === 'string') {
          dynamicFieldsToSave[k] = v;
        }
      }
      for (const ph of placeholders) {
        if (!Object.prototype.hasOwnProperty.call(dynamicFieldsToSave, ph) && (TEMPLATE_MAPPING_SOURCES as readonly string[]).includes(ph)) {
          dynamicFieldsToSave[ph] = ph;
        }
      }
      const currentOutput = latestTemplateOutputsRef.current[currentTemplate.id] || templateOutputs[currentTemplate.id];
      const outputPayload = {
        category: currentOutput?.category || inferOutputCategory(detail.template_type || currentTemplate.type),
        brand_id: session.workspaceId,
        linked_form_revision_id: currentOutput?.linked_form_revision_id || null,
        document_type_id: currentOutput?.document_type_id || null,
        layout: currentOutput?.layout || { paper: 'A4' },
        dynamic_fields: dynamicFieldsToSave,
      };
      const sampleFileName = (
        latestTemplateSampleFilesRef.current[currentTemplate.id]
        ?? templateSampleFiles[currentTemplate.id]
        ?? detail.sample_file_name
        ?? currentTemplate.sampleFileName
        ?? ''
      ).trim() || undefined;
      const mappingStatus = latestTemplateMappingStatusesRef.current[currentTemplate.id]
        || templateMappingStatuses[currentTemplate.id]
        || computeAutoMappingStatus(nextContent, dynamicFieldsToSave, currentTemplate.mappingStatus);

      const patchBody: Record<string, unknown> = {
        content: nextContent,
        ...(sampleFileName ? { sample_file_name: sampleFileName } : {}),
        mapping_status: mappingStatus,
        output: outputPayload,
        ...(draftRev
          ? { revision_id: draftRev.id, expected_updated_at: draftRev.updated_at }
          : { base_revision_id: detail.current_revision_id || activeRev?.id }),
      };

      const res = await apiPatchTemplate(session.workspaceId, currentTemplate.id, token, patchBody);
      if (!res.ok || !res.data?.updated_at) {
        const msg = res.problem?.detail || 'Draft could not be saved. Reload before saving.';
        setTemplateSaveFeedback({ type: 'error', message: msg });
        showDemoNotification(msg, 'error');
        return;
      }

      const freshDetail = res.data.template || await refreshServerTemplate(currentTemplate.id, true);
      setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: false }));
      if (freshDetail) {
        hydrateFromServerDetail(currentTemplate.id, freshDetail, true);
        const mapped = mapTemplateDetail(freshDetail);
        if (mapped && standaloneTemplates !== null) {
          setStandaloneTemplates(prev => prev ? prev.map(item => (item.id === currentTemplate.id ? mapped : item)) : prev);
        }
      } else {
        setHasEditedTemplate(false);
      }
      const msg = 'Draft template revision, output configuration, and field mappings saved.';
      setTemplateSaveFeedback({ type: 'success', message: msg });
      showDemoNotification(msg, 'success');
    } catch (err: any) {
      const msg = err?.message || 'Could not save template draft.';
      setTemplateSaveFeedback({ type: 'error', message: msg });
      showDemoNotification(msg, 'error');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleSubmitCurrentTemplateReview = async () => {
    if (!currentTemplate) return;
    if (!session?.workspaceId || !session?.profile) {
      submitTemplateForReview(currentTemplate.id);
      return;
    }
    const detail = serverTemplateDetails[currentTemplate.id];
    const draftRev = Array.isArray(detail?.revisions) ? detail.revisions.find((r: any) => r.status === 'DRAFT') : null;
    if (!draftRev?.id) {
      submitTemplateForReview(currentTemplate.id);
      return;
    }
    try {
      const token = await session.token();
      const res = await apiSubmitTemplateRevisionReview(session.workspaceId, currentTemplate.id, draftRev.id, token);
      if (!res.ok) {
        showDemoNotification(res.problem?.detail || 'Failed to submit template revision for review', 'error');
        return;
      }
      await refreshServerTemplate(currentTemplate.id, true);
      showDemoNotification('Template revision submitted for Admin compliance review.', 'info');
    } catch (err: any) {
      showDemoNotification(`Network error submitting revision for review: ${err?.message || 'Unknown error'}`, 'error');
    }
  };

  const handlePublishCurrentTemplate = async () => {
    if (!currentTemplate) return;
    if (!session?.workspaceId || !session?.profile) {
      publishTemplateVersion(currentTemplate.id);
      return;
    }
    const detail = serverTemplateDetails[currentTemplate.id];
    const reviewRev = Array.isArray(detail?.revisions) ? detail.revisions.find((r: any) => r.status === 'REVIEW') : null;
    if (!reviewRev?.id) {
      publishTemplateVersion(currentTemplate.id);
      return;
    }
    try {
      const token = await session.token();
      const res = await apiApproveTemplateRevision(session.workspaceId, currentTemplate.id, reviewRev.id, token);
      if (!res.ok) {
        showDemoNotification(res.problem?.detail || 'Template approval failed on server', 'error');
        return;
      }
      await refreshServerTemplate(currentTemplate.id, true);
      showDemoNotification('Template version published. Full revision and review audit history retained.', 'success');
    } catch (err: any) {
      showDemoNotification(`Network error publishing template: ${err?.message || 'Unknown error'}`, 'error');
    }
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

  const isTemplateDirty = !!currentTemplate && hasEditedTemplate && editingContent !== currentTemplate.content;
  const hasUnsavedTemplateChanges = isTemplateDirty || (!!currentTemplate && !!dirtyTemplateMeta[currentTemplate.id]);
  const confirmDiscardTemplateEdits = () => {
    if (!hasUnsavedTemplateChanges) return true;
    if (typeof window !== 'undefined' && !window.confirm('You have unsaved template edits. Discard changes?')) return false;
    setHasEditedTemplate(false);
    setEditingContent('');
    if (currentTemplate) {
      setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: false }));
      const cached = serverTemplateDetails[currentTemplate.id];
      if (cached) hydrateFromServerDetail(currentTemplate.id, cached, true);
    }
    return true;
  };

  const handleOpenEditJobType = (jt: JobTypeConfig) => {
    setEditingJobTypeId(jt.id);
    setEditJtName(jt.name);
    setEditJtCode(jt.code || jt.id);
    setEditJtBrandId(jt.brandId);
    setEditJtDescription(jt.description || '');
  };

  const handleSaveEditJobType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingJobTypeId) return;
    const result = await editJobType(editingJobTypeId, {
      name: editJtName,
      code: editJtCode,
      brandId: editJtBrandId,
      description: editJtDescription,
    });
    if (result.success) setEditingJobTypeId(null);
  };

  const handleCreateJobType = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await addJobType({
      name: newJtName,
      code: newJtCode,
      brandId: newJtBrandId,
      formsRequired: session?.profile ? [] : (newJtDirectToInvoice ? [] : newJtForms),
      ...(session?.profile ? {formRules: newJtDirectToInvoice ? [] : newJtFormRevisions.map(form_revision_id=>({form_revision_id,required:true}))} : {}),
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
      setNewJtFormRevisions([]);
    }
  };

  const handleSampleFileUpload = async (file: File | undefined, target: 'create' | 'edit') => {
    if (!file) return;
    const isTextLike = /\.(txt|md|html|htm|json|csv)$/i.test(file.name) || file.type.startsWith('text/');
    if (isTextLike) {
      const text = await file.text();
      if (target === 'create') {
        setNewTplSampleFile(file.name);
        if (!newTplContent.trim()) setNewTplContent(text);
        const placeholders = extractTemplatePlaceholders(text);
        if (placeholders.length > 0) {
          const autoMap: Record<string, string> = {};
          for (const p of placeholders) {
            if ((TEMPLATE_MAPPING_SOURCES as readonly string[]).includes(p)) autoMap[p] = p;
          }
          setNewTplMappings(prev => ({ ...autoMap, ...prev }));
        }
      } else if (currentTemplate) {
        const placeholders = extractTemplatePlaceholders(text);
        const existingMappings = latestTemplateMappingsRef.current[currentTemplate.id] || {};
        const autoMap: Record<string, string> = {};
        for (const p of placeholders) {
          if ((TEMPLATE_MAPPING_SOURCES as readonly string[]).includes(p)) autoMap[p] = p;
        }
        const mergedMappings = { ...autoMap, ...existingMappings };
        const nextStatus = computeAutoMappingStatus(text, mergedMappings, latestTemplateMappingStatusesRef.current[currentTemplate.id]);
        latestTemplateSampleFilesRef.current = { ...latestTemplateSampleFilesRef.current, [currentTemplate.id]: file.name };
        latestTemplateMappingsRef.current = { ...latestTemplateMappingsRef.current, [currentTemplate.id]: mergedMappings };
        latestTemplateMappingStatusesRef.current = { ...latestTemplateMappingStatusesRef.current, [currentTemplate.id]: nextStatus };
        setTemplateSampleFiles(prev => ({ ...prev, [currentTemplate.id]: file.name }));
        setTemplateMappings(prev => ({ ...prev, [currentTemplate.id]: mergedMappings }));
        setTemplateMappingStatuses(prev => ({
          ...prev,
          [currentTemplate.id]: nextStatus,
        }));
        setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
        setHasEditedTemplate(true);
        setEditingContent(text);
      }
      setTemplateUploadNotice(`Loaded "${file.name}" (${Math.max(1, Math.round(file.size / 1024))} KB) into template editor.`);
      return;
    }

    if (target === 'create') {
      setNewTplSampleFile(file.name);
    } else if (currentTemplate) {
      latestTemplateSampleFilesRef.current = { ...latestTemplateSampleFilesRef.current, [currentTemplate.id]: file.name };
      setTemplateSampleFiles(prev => ({ ...prev, [currentTemplate.id]: file.name }));
      setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
    }
    setTemplateUploadNotice(
      `Attached "${file.name}" (${Math.max(1, Math.round(file.size / 1024))} KB). Binary DOCX/PDF parsing & rendering are simulated (no binary engine installed).`
    );
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    const createdOutput = session?.workspaceId && session.profile
      ? {
          category: outputCategory,
          brand_id: session.workspaceId,
          linked_form_revision_id: linkedFormRevision || null,
          document_type_id: documentTypeId || null,
          layout: { paper: newTplLayoutPaper },
          dynamic_fields: newTplMappings,
        }
      : undefined;
    const res = await addTemplate({
      name: newTplName,
      code: newTplCode,
      type: newTplType,
      content: newTplContent,
      description: newTplDescription,
      sampleFileName: newTplSampleFile,
      ...(createdOutput ? { output: createdOutput } : {}),
    });
    if (res.success && res.id) {
      const createdId = res.id;
      if (Object.keys(newTplMappings).length > 0) {
        setTemplateMappings(prev => ({ ...prev, [createdId]: newTplMappings }));
      }
      if (newTplSampleFile.trim()) {
        setTemplateSampleFiles(prev => ({ ...prev, [createdId]: newTplSampleFile.trim() }));
      }
      if (createdOutput) {
        setTemplateOutputs(prev => ({
          ...prev,
          [createdId]: {
            category: createdOutput.category,
            brand_id: createdOutput.brand_id,
            linked_form_revision_id: createdOutput.linked_form_revision_id,
            document_type_id: createdOutput.document_type_id,
            layout: createdOutput.layout,
          },
        }));
      }
      setDirtyTemplateMeta(prev => ({ ...prev, [createdId]: false }));
      setIsAddTemplateOpen(false);
      setSelectedTemplateId(createdId);
      setHasEditedTemplate(false);
      setEditingContent(newTplContent);
      setNewTplName('');
      setNewTplCode('');
      setNewTplContent('');
      setNewTplSampleFile('');
      setNewTplDescription('');
      setNewTplMappings({});
      setTemplateUploadNotice('');
      if (session?.workspaceId && session.profile) {
        void refreshServerTemplate(createdId, true);
      }
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

        <div className="overflow-x-auto border cabms-border rounded-xl">
          <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
            <thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border">
              <tr>
                <th className="p-3">Job Type Category</th>
                <th className="p-3">Business</th>
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
                    className={`${jt.isDirectToInvoice ? 'cabms-surface-subtle' : ''} ${
                      isArchived ? 'opacity-60 cabms-surface-subtle' : ''
                    }`}
                  >
                    <td className="p-3 font-semibold text-(--cabms-text-primary)">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{jt.name}</span>
                        {jt.isDirectToInvoice && (
                          <span className="text-[10px] cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) px-1.5 py-0.5 rounded font-mono">
                            Direct-to-Invoice
                          </span>
                        )}
                        {isArchived && (
                          <span className="text-[10px] cabms-surface-subtle text-(--cabms-text-secondary) border cabms-border px-1.5 py-0.5 rounded font-mono">
                            Archived
                          </span>
                        )}
                        {isDraft && (
                          <span className="text-[10px] cabms-badge-warning px-1.5 py-0.5 rounded font-mono">
                            Draft
                          </span>
                        )}
                      </div>
                      {jt.description && (
                        <p className="text-[11px] text-(--cabms-text-secondary) mt-0.5 wrap-break-word max-w-xs font-normal">
                          {jt.description}
                        </p>
                      )}
                    </td>
                    <td className="p-3 font-medium cabms-brand-accent-text">
                      {brandDisplayName}
                    </td>
                    <td className="p-3 font-mono text-sky-400">
                      {(jt.formsRequired.length > 0 || (jt.catalogForms?.length || 0) > 0) ? (
                        <div className="flex flex-wrap gap-1">
                          {jt.formsRequired.map(f => (
                            <span
                              key={f}
                              className="bg-sky-950/80 border border-sky-800 text-sky-300 text-[10px] px-1.5 py-0.5 rounded"
                            >
                              {f}
                            </span>
                          ))}
                          {jt.catalogForms?.map(f => <span key={f.revision_id} className="bg-sky-950/80 border border-sky-800 text-sky-300 text-[10px] px-1.5 py-0.5 rounded">{f.title}{f.required ? ' (required)' : ' (optional)'}</span>)}
                        </div>
                      ) : (
                        <span className="text-slate-500 italic">{jt.isDirectToInvoice ? 'None (Direct-to-invoice service)' : 'None configured'}</span>
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
              className="px-2.5 py-1 cabms-btn-primary rounded text-xs font-bold transition flex items-center space-x-1 cursor-pointer"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3 h-3" />
              <span>Add Template</span>
            </button>
          </div>

          <p className="text-xs text-(--cabms-text-secondary)">
            Select built-in synthetic templates to inspect content snapshots and version states.
          </p>

          <DocumentTypeCatalog />

          {/* Search & Type Filter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="search"
              aria-label="Search templates"
              placeholder="Search templates..."
              value={templateSearch}
              onChange={e => { if (confirmDiscardTemplateEdits()) setTemplateSearch(e.target.value); }}
              className="w-full px-2.5 py-1.5 cabms-input rounded text-xs"
            />
            <select
              aria-label="Filter templates by type"
              value={templateTypeFilter}
              onChange={e => { if (confirmDiscardTemplateEdits()) setTemplateTypeFilter(e.target.value as 'ALL' | TemplateSetting['type']); }}
              className="w-full px-2.5 py-1.5 cabms-input rounded text-xs"
            >
              <option value="ALL">All Types</option>
              {Array.from(new Set(effectiveTemplates.map(t => t.type))).map(type => (
                <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>
              ))}
            </select>
          </div>

          {/* Filter options */}
          <div className="flex items-center gap-1.5 overflow-x-auto text-[10px] pb-1">
            {(['ALL', 'PUBLISHED', 'REVIEW', 'DRAFT', 'ARCHIVED'] as const).map(tab => (
              <button
                key={tab}
                type="button"
                onClick={() => { if (confirmDiscardTemplateEdits()) setTemplateFilter(tab); }}
                className={`px-2 py-0.5 rounded font-semibold border transition cursor-pointer ${
                  templateFilter === tab
                    ? 'cabms-tab-active'
                    : 'cabms-surface-subtle cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="space-y-2 max-h-125 overflow-y-auto">
            {filteredTemplates.length === 0 && (
              <p className="cabms-card-subtle p-4 text-xs text-(--cabms-text-secondary)">
                No templates match the current search or filter.
              </p>
            )}
            {filteredTemplates.map(tpl => {
              const isSelected = tpl.id === selectedTemplateId;
              const isArchived = tpl.status === 'ARCHIVED';

              return (
                <div
                  key={tpl.id}
                  onClick={() => {
                    if (tpl.id !== selectedTemplateId && !confirmDiscardTemplateEdits()) return;
                    setSelectedTemplateId(tpl.id);
                    setHasEditedTemplate(false);
                    setTemplateUploadNotice('');
                    setTemplateSaveFeedback(null);
                    setEditingContent(tpl.content);
                    if (session?.workspaceId && session?.profile) {
                      const cached = serverTemplateDetails[tpl.id];
                      if (cached) hydrateFromServerDetail(tpl.id, cached);
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'cabms-row-selected shadow'
                      : 'cabms-surface-subtle cabms-border hover:border-(--cabms-border-focus)'
                  } ${isArchived ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <FontAwesomeIcon icon={faFileLines} className="w-4 h-4 cabms-brand-icon" />
                        <span className="font-bold text-(--cabms-text-primary) text-xs">{tpl.name}</span>
                      </div>
                      <div className="font-mono text-[11px] text-(--cabms-text-secondary) mt-1">
                        Version: <strong className="cabms-accent-info">{tpl.currentVersion}</strong>
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
        {currentTemplate ? <div className="lg:col-span-7 cabms-card p-6 space-y-5">
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
                onClick={() => setPreviewModalDoc({
                  ...currentTemplate,
                  content: hasEditedTemplate ? editingContent : currentTemplate.content,
                  sampleFileName: templateSampleFiles[currentTemplate.id] || currentTemplate.sampleFileName,
                  mappingStatus: templateMappingStatuses[currentTemplate.id] || currentTemplate.mappingStatus,
                })}
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

              {!(session?.profile && currentTemplate.status !== 'DRAFT') && (currentTemplate.status === 'DRAFT' || currentTemplate.activeStatus === 'DRAFT') && (
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

          {/* Template Upload, Metadata & Field Mapping */}
          {(() => {
            const activeContent = hasEditedTemplate ? editingContent : currentTemplate.content;
            const placeholders = extractTemplatePlaceholders(activeContent);
            const activeMappings = templateMappings[currentTemplate.id] || {};
            const activeSampleFile = templateSampleFiles[currentTemplate.id] || currentTemplate.sampleFileName || 'custom-template.docx';
            const activeMappingStatus = templateMappingStatuses[currentTemplate.id] || currentTemplate.mappingStatus;
            const currentOutput = templateOutputs[currentTemplate.id] || {
              category: inferOutputCategory(currentTemplate.type),
              brand_id: session?.workspaceId || '',
              linked_form_revision_id: null,
              document_type_id: null,
              layout: { paper: 'A4' },
            };
            return (
              <div className="cabms-card-subtle p-3.5 rounded-lg border cabms-border space-y-2.5 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-(--cabms-text-secondary)">
                      Sample File &amp; Dynamic Field Mapping
                    </span>
                    <div className="text-(--cabms-text-primary) font-medium mt-0.5">
                      File: <span className="font-mono">{activeSampleFile}</span> • Mapping:{' '}
                      <span className="text-sky-400 font-semibold">{activeMappingStatus}</span>
                    </div>
                  </div>
                  <label className="px-2.5 py-1 cabms-surface-subtle border cabms-border rounded text-[11px] font-semibold text-(--cabms-text-primary) hover:border-amber-500 cursor-pointer">
                    Upload Sample File
                    <input
                      type="file"
                      aria-label="Upload sample template file"
                      accept=".txt,.md,.html,.htm,.json,.docx,.pdf"
                      className="sr-only"
                      onChange={e => { void handleSampleFileUpload(e.target.files?.[0], 'edit'); e.target.value = ''; }}
                    />
                  </label>
                </div>
                {templateUploadNotice && (
                  <p role="status" className="text-[11px] text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded px-2.5 py-1.5">
                    {templateUploadNotice}
                  </p>
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-slate-800/60">
                  <label className="text-[11px] text-(--cabms-text-secondary) space-y-1">
                    <span className="block font-semibold">Output Category</span>
                    <select
                      aria-label="Template output category"
                      value={currentOutput.category}
                      onChange={e => {
                        const category = e.target.value as OutputCategory;
                        const base = latestTemplateOutputsRef.current[currentTemplate.id] || currentOutput;
                        const nextOutput = { ...base, category };
                        latestTemplateOutputsRef.current = { ...latestTemplateOutputsRef.current, [currentTemplate.id]: nextOutput };
                        setTemplateOutputs(prev => ({ ...prev, [currentTemplate.id]: nextOutput }));
                        setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                      }}
                      className="w-full cabms-input rounded px-2 py-1 text-[11px]"
                    >
                      {(['Compliance', 'Terms', 'Email', 'Contract'] as const).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-(--cabms-text-secondary) space-y-1">
                    <span className="block font-semibold">Paper Layout</span>
                    <select
                      aria-label="Template paper layout"
                      value={String(currentOutput.layout?.paper || 'A4')}
                      onChange={e => {
                        const paper = e.target.value;
                        const base = latestTemplateOutputsRef.current[currentTemplate.id] || currentOutput;
                        const nextOutput = { ...base, layout: { ...base.layout, paper } };
                        latestTemplateOutputsRef.current = { ...latestTemplateOutputsRef.current, [currentTemplate.id]: nextOutput };
                        setTemplateOutputs(prev => ({ ...prev, [currentTemplate.id]: nextOutput }));
                        setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                      }}
                      className="w-full cabms-input rounded px-2 py-1 text-[11px]"
                    >
                      <option value="A4">A4</option>
                      <option value="LETTER">Letter</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-(--cabms-text-secondary) space-y-1">
                    <span className="block font-semibold">Mapping Status</span>
                    <select
                      aria-label="Template mapping status"
                      value={activeMappingStatus}
                      onChange={e => {
                        const nextStatus = e.target.value as TemplateSetting['mappingStatus'];
                        latestTemplateMappingStatusesRef.current = { ...latestTemplateMappingStatusesRef.current, [currentTemplate.id]: nextStatus };
                        setTemplateMappingStatuses(prev => ({ ...prev, [currentTemplate.id]: nextStatus }));
                        setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                      }}
                      className="w-full cabms-input rounded px-2 py-1 text-[11px]"
                    >
                      <option value="Mapped">Mapped</option>
                      <option value="Pending Review">Pending Review</option>
                      <option value="Unsupported">Unsupported</option>
                    </select>
                  </label>
                </div>
                {session?.profile && (editorDocumentTypes.length > 0 || editorPublishedForms.length > 0 || currentOutput.document_type_id || currentOutput.linked_form_revision_id) && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="text-[11px] text-(--cabms-text-secondary) space-y-1">
                      <span className="block font-semibold">Approved Document Type</span>
                      <select
                        aria-label="Template document type"
                        value={currentOutput.document_type_id || ''}
                        onChange={e => {
                          const docId = e.target.value || null;
                          const base = latestTemplateOutputsRef.current[currentTemplate.id] || currentOutput;
                          const nextOutput = { ...base, document_type_id: docId };
                          latestTemplateOutputsRef.current = { ...latestTemplateOutputsRef.current, [currentTemplate.id]: nextOutput };
                          setTemplateOutputs(prev => ({ ...prev, [currentTemplate.id]: nextOutput }));
                          setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                        }}
                        className="w-full cabms-input rounded px-2 py-1 text-[11px]"
                      >
                        <option value="">No document type selected</option>
                        {editorDocumentTypes.map(t => (
                          <option key={t.id} value={t.id}>{t.title} ({t.code})</option>
                        ))}
                      </select>
                    </label>
                    <label className="text-[11px] text-(--cabms-text-secondary) space-y-1">
                      <span className="block font-semibold">Linked Form Definition</span>
                      <select
                        aria-label="Template linked form"
                        value={currentOutput.linked_form_revision_id || ''}
                        onChange={e => {
                          const formRevId = e.target.value || null;
                          const base = latestTemplateOutputsRef.current[currentTemplate.id] || currentOutput;
                          const nextOutput = { ...base, linked_form_revision_id: formRevId };
                          latestTemplateOutputsRef.current = { ...latestTemplateOutputsRef.current, [currentTemplate.id]: nextOutput };
                          setTemplateOutputs(prev => ({ ...prev, [currentTemplate.id]: nextOutput }));
                          setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                        }}
                        className="w-full cabms-input rounded px-2 py-1 text-[11px]"
                      >
                        <option value="">No linked form</option>
                        {editorPublishedForms.map(f => (
                          <option key={f.id} value={f.published_revision_id}>{f.title} ({f.code})</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                {placeholders.length > 0 ? (
                  <div className="space-y-1.5 pt-1 border-t border-slate-800/60">
                    <span className="text-[11px] font-semibold text-(--cabms-text-secondary) block">
                      Detected Placeholders ({placeholders.length})
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {placeholders.map(ph => (
                        <label key={ph} className="flex items-center justify-between gap-2 cabms-surface-subtle border cabms-border rounded px-2 py-1 text-[11px]">
                          <span className="font-mono text-amber-400 truncate">{`{{${ph}}}`}</span>
                          <select
                            aria-label={`Map placeholder ${ph}`}
                            value={activeMappings[ph] ?? ((TEMPLATE_MAPPING_SOURCES as readonly string[]).includes(ph) ? ph : '')}
                            onChange={e => {
                              const nextMappings = { ...(latestTemplateMappingsRef.current[currentTemplate.id] || {}), [ph]: e.target.value };
                              const nextStatus = computeAutoMappingStatus(activeContent, nextMappings, latestTemplateMappingStatusesRef.current[currentTemplate.id]);
                              latestTemplateMappingsRef.current = { ...latestTemplateMappingsRef.current, [currentTemplate.id]: nextMappings };
                              latestTemplateMappingStatusesRef.current = { ...latestTemplateMappingStatusesRef.current, [currentTemplate.id]: nextStatus };
                              setTemplateMappings(prev => ({
                                ...prev,
                                [currentTemplate.id]: nextMappings,
                              }));
                              setTemplateMappingStatuses(prev => ({
                                ...prev,
                                [currentTemplate.id]: nextStatus,
                              }));
                              setDirtyTemplateMeta(prev => ({ ...prev, [currentTemplate.id]: true }));
                            }}
                            className="cabms-input rounded px-1.5 py-0.5 text-[11px] max-w-[140px]"
                          >
                            <option value="">Unmapped</option>
                            {TEMPLATE_MAPPING_SOURCES.map(src => (
                              <option key={src} value={src}>{src}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-(--cabms-text-secondary)">
                    Tip: Add placeholders like <code className="font-mono text-amber-400">{'{{customer.name}}'}</code> or <code className="font-mono text-amber-400">{'{{business.name}}'}</code> to test dynamic field mapping and generated-document preview.
                  </p>
                )}
              </div>
            );
          })()}

          {/* Bounded Text Content Editor */}
          <div className="space-y-2 text-xs">
            <label className="block text-(--cabms-text-secondary) font-semibold">
              Supported Standard Wording & Form Clauses (Sample Regulatory Wording):
            </label>
            <textarea
              rows={5}
              value={hasEditedTemplate ? editingContent : currentTemplate.content}
              onChange={e => { setHasEditedTemplate(true); setEditingContent(e.target.value); }}
              className="w-full p-3 cabms-card-subtle text-(--cabms-text-primary) text-xs focus:outline-none focus:border-amber-500 font-sans leading-relaxed rounded-lg"
            />
            <p className="text-[11px] text-slate-500 italic">
              Notice: Editing template text creates a new Draft revision. Historical signed documents and accepted quotations will continue to render their original frozen version snapshot.
            </p>
          </div>

          {templateSaveFeedback && (
            <p
              role="status"
              className={`text-xs rounded px-3 py-2 border ${
                templateSaveFeedback.type === 'error'
                  ? 'text-rose-300 bg-rose-950/30 border-rose-800/50'
                  : 'text-emerald-300 bg-emerald-950/30 border-emerald-800/50'
              }`}
            >
              {templateSaveFeedback.message}
            </p>
          )}

          {/* Workflow Action Controls */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2">
              <button
                type="button"
                disabled={isSavingDraft}
                onClick={() => { void handleStartDraft(); }}
                className="px-3 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded-lg transition cursor-pointer hover:border-amber-500 disabled:opacity-50"
              >
                {isSavingDraft ? 'Saving Draft...' : 'Save Draft Revision'}
              </button>

              {currentTemplate.activeStatus === 'DRAFT' && (
                <button
                  type="button"
                  onClick={() => { void handleSubmitCurrentTemplateReview(); }}
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
                onClick={() => { void handlePublishCurrentTemplate(); }}
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
        </div> : <div className="lg:col-span-7 cabms-card p-6 text-xs text-(--cabms-text-secondary)">No template is available to display.</div>}
      </div>

      {/* Modal 1: Synthetic Generated-Document Preview Modal */}
      {previewModalDoc && (() => {
        const previewMappings = templateMappings[previewModalDoc.id] || {};
        const previewResult = renderSimulatedDocumentPreview(previewModalDoc.content, previewMappings, previewSampleData);
        const sampleFile = templateSampleFiles[previewModalDoc.id] || previewModalDoc.sampleFileName || 'custom.docx';
        const businessName = session?.workspaceId ? getBrandDisplayName(session.workspaceId) : 'Solarcell Electrical & Solar';
        return (
          <TemplateModal onClose={() => { setPreviewModalDoc(null); setPreviewShowRaw(false); }} titleId="sample-preview-title" maxWidthClass="max-w-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 id="sample-preview-title" className="text-base font-bold text-(--cabms-text-primary)">
                    Generated Document Preview: {previewModalDoc.name}
                  </h3>
                  <span className="text-xs text-sky-400 font-mono">
                    Version: {previewModalDoc.currentVersion} ({previewModalDoc.activeStatus}) • Business: {businessName}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label="Close sample preview"
                  onClick={() => { setPreviewModalDoc(null); setPreviewShowRaw(false); }}
                  className="text-(--cabms-text-secondary) hover:text-(--cabms-text-primary) text-lg font-bold"
                >
                  ✕
                </button>
              </div>

              <div className="text-[11px] text-amber-300 bg-amber-950/40 p-2.5 rounded border border-amber-700/60 font-medium">
                Simulated / synthetic document rendering — binary DOCX/PDF engine is not installed in this environment. No live job certificate, quote, or report has been issued.
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="text-[11px] font-mono text-(--cabms-text-secondary)">
                  Sample File: {sampleFile} • Mapping: {previewModalDoc.mappingStatus}
                </div>
                <div className="flex gap-1.5" role="tablist" aria-label="Preview rendering mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!previewShowRaw}
                    onClick={() => setPreviewShowRaw(false)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer ${!previewShowRaw ? 'cabms-tab-active' : 'cabms-surface-subtle cabms-border text-(--cabms-text-secondary)'}`}
                  >
                    Rendered Document
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={previewShowRaw}
                    onClick={() => setPreviewShowRaw(true)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold border cursor-pointer ${previewShowRaw ? 'cabms-tab-active' : 'cabms-surface-subtle cabms-border text-(--cabms-text-secondary)'}`}
                  >
                    Raw Template Source
                  </button>
                </div>
              </div>

              <div className="cabms-card-subtle p-4 text-xs text-(--cabms-text-secondary) space-y-3 font-sans leading-relaxed rounded-lg border cabms-border">
                <div className="border-b cabms-border pb-2 flex items-center justify-between text-[11px]">
                  <span className="font-bold text-(--cabms-text-primary)">{businessName}</span>
                  <span className="font-mono text-(--cabms-text-secondary)">{previewModalDoc.code || previewModalDoc.id}</span>
                </div>
                <div className="cabms-surface-subtle p-3 rounded border cabms-border whitespace-pre-wrap text-(--cabms-text-primary)">
                  {previewShowRaw ? previewModalDoc.content : previewResult.renderedText}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] pt-1 border-t cabms-border">
                  <span>
                    Placeholders detected: <strong>{previewResult.placeholders.length}</strong> • Resolved: <strong>{Object.keys(previewResult.resolvedValues).length}</strong>
                  </span>
                  {previewResult.unmappedPlaceholders.length > 0 && (
                    <span className="text-amber-400 font-mono">
                      Unmapped: {previewResult.unmappedPlaceholders.map(p => `{{${p}}}`).join(', ')}
                    </span>
                  )}
                </div>
              </div>

              {previewResult.placeholders.length > 0 && (
                <details className="cabms-card-subtle p-3 rounded-lg border cabms-border text-xs">
                  <summary className="cursor-pointer font-semibold text-(--cabms-text-primary)">
                    Synthetic Sample Data Overrides
                  </summary>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
                    {['business.name', 'customer.name', 'job.title', 'site.address'].map(key => (
                      <label key={key} className="block text-[11px] text-(--cabms-text-secondary)">
                        {key}
                        <input
                          type="text"
                          aria-label={`Sample value for ${key}`}
                          value={previewSampleData[key] ?? DEFAULT_PREVIEW_SAMPLE_DATA[key] ?? ''}
                          onChange={e => setPreviewSampleData(prev => ({ ...prev, [key]: e.target.value }))}
                          className="w-full mt-0.5 px-2 py-1 cabms-input rounded text-xs"
                        />
                      </label>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => { setPreviewModalDoc(null); setPreviewShowRaw(false); }}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) text-xs font-semibold rounded-lg transition cursor-pointer"
                >
                  Close Preview
                </button>
              </div>
          </TemplateModal>
        );
      })()}

      {/* Modal 2: View Job Type Details & Policy Version History */}
      {viewingJobType && (
        <TemplateModal onClose={() => setViewingJobTypeId(null)} titleId="view-job-type-title" maxWidthClass="max-w-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 id="view-job-type-title" className="text-base font-bold text-(--cabms-text-primary)">
                  {viewingJobType.name}
                </h3>
                <span className="text-xs text-sky-400 font-mono">
                  Code: {viewingJobType.code || viewingJobType.id} • Business: {getBrandDisplayName(viewingJobType.brandId)}
                </span>
              </div>
              <button
                type="button"
                aria-label="Close job type details"
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
                {viewingJobType.formsRequired.length > 0 || (viewingJobType.catalogForms?.length || 0) > 0 ? (
                  <>
                    {viewingJobType.formsRequired.map(f => (
                      <span key={f} className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-950 border border-sky-800 text-sky-300">
                        {f}
                      </span>
                    ))}
                    {viewingJobType.catalogForms?.map(f => (
                      <span key={f.revision_id} className="px-2 py-0.5 rounded text-[11px] font-mono bg-sky-950 border border-sky-800 text-sky-300">
                        {f.title} ({f.code}){f.required ? ' • Required' : ' • Optional'}
                      </span>
                    ))}
                  </>
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
        </TemplateModal>
      )}

      {/* Modal 3: Add Job Type */}
      {isAddJobTypeOpen && (
        <TemplateModal onClose={() => setIsAddJobTypeOpen(false)} titleId="add-job-type-title" maxWidthClass="max-w-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="add-job-type-title" className="text-base font-bold text-(--cabms-text-primary)">Add New Job Type</h3>
              <button
                type="button"
                aria-label="Close add job type dialog"
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
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Business</label>
                  {session?.profile ? (
                    <div className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)">
                      <div className="font-medium">{brands[newJtBrandId]?.name || session.profile.memberships.find(m => m.workspace_id === newJtBrandId)?.name || newJtBrandId}</div>
                      <p className="text-[11px] text-(--cabms-text-secondary) mt-0.5">This job type belongs to the active workspace. Switch businesses using the workspace selector.</p>
                    </div>
                  ) : (
                    <select
                      value={newJtBrandId}
                      onChange={e => setNewJtBrandId(e.target.value as BrandId)}
                      className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                    >
                      <option value="solarcell">Solarcell</option>
                      <option value="smart_home">Gold Coast Smart Home</option>
                      <option value="cctv">Gold Coast CCTV</option>
                    </select>
                  )}
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
                    onChange={e => { setNewJtDirectToInvoice(e.target.checked); if (e.target.checked) setNewJtFormRevisions([]); }}
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
                    {session?.profile ? <>
                      {jobCatalogError && <p role="status">{jobCatalogError}</p>}
                      {!jobCatalogError && jobCatalogForms.length === 0 && <div className="space-y-2"><p>No approved forms are available for this workspace. The starter forms are drafts and need fields and administrator approval before they can be selected.</p><button type="button" className="px-2.5 py-1 rounded border cabms-border text-(--cabms-text-primary) hover:border-amber-500 font-semibold" onClick={()=>{setIsAddJobTypeOpen(false);document.getElementById('form-definitions')?.scrollIntoView({behavior:'smooth',block:'start'});}}>Open Form Definitions</button></div>}
                      {jobCatalogForms.length > 0 && <JobFormSelector forms={jobCatalogForms} selected={newJtFormRevisions} onChange={setNewJtFormRevisions} />}
                      <div role="note" className="cabms-card-subtle border-l-4 border-l-amber-500 p-3 text-xs text-(--cabms-text-primary)">
                        <p className="font-bold">Draft policy notice</p>
                        <p className="mt-1">Selections are saved in a draft policy; publication is blocked until job enforcement is complete.</p>
                      </div>
                    </> : COMPLIANCE_FORM_TYPES.map(formKey => {
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
        </TemplateModal>
      )}

      {/* Modal 4: Edit Job Type */}
      {editingJobTypeId && (
        <TemplateModal onClose={() => setEditingJobTypeId(null)} titleId="edit-job-type-title" maxWidthClass="max-w-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="edit-job-type-title" className="text-base font-bold text-(--cabms-text-primary)">Edit Job Type</h3>
              <button
                type="button"
                aria-label="Close edit job type dialog"
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
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Business</label>
                  {session?.profile ? (
                    <div className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)">
                      <div className="font-medium">{brands[editJtBrandId]?.name || session.profile.memberships.find(m => m.workspace_id === editJtBrandId)?.name || editJtBrandId}</div>
                      <p className="text-[11px] text-(--cabms-text-secondary) mt-0.5">This job type belongs to {brands[editJtBrandId]?.name || editJtBrandId}. Switch businesses using the workspace selector.</p>
                    </div>
                  ) : (
                    <select
                      value={editJtBrandId}
                      onChange={e => setEditJtBrandId(e.target.value as BrandId)}
                      className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                    >
                      <option value="solarcell">Solarcell</option>
                      <option value="smart_home">Gold Coast Smart Home</option>
                      <option value="cctv">Gold Coast CCTV</option>
                    </select>
                  )}
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
        </TemplateModal>
      )}

      {/* Modal 5: Job Type Configuration Modal */}
      {configuringJobTypeId && (() => {
        const targetJt = jobTypes.find(jt => jt.id === configuringJobTypeId);
        if (!targetJt) return null;
        if (session?.profile) return <CatalogPolicyEditor jobType={targetJt} close={() => setConfiguringJobTypeId(null)} />;

        return (
          <TemplateModal onClose={() => setConfiguringJobTypeId(null)} titleId="configure-job-type-title" maxWidthClass="max-w-md">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 id="configure-job-type-title" className="text-base font-bold text-(--cabms-text-primary)">Configure {targetJt.name}</h3>
                <button
                  type="button"
                  aria-label="Close configure job type dialog"
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
          </TemplateModal>
        );
      })()}

      {/* Modal 6: Add Template Modal */}
      {isAddTemplateOpen && (
        <TemplateModal onClose={() => setIsAddTemplateOpen(false)} titleId="add-template-title" maxWidthClass="max-w-md">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 id="add-template-title" className="text-base font-bold text-(--cabms-text-primary)">Add Document Template</h3>
              <button
                type="button"
                aria-label="Close add template dialog"
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
                {session?.profile && <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block font-semibold">Output Category<select className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700" value={outputCategory} onChange={e=>setOutputCategory(e.target.value as typeof outputCategory)}>{['Compliance','Terms','Email','Contract'].map(c=><option key={c}>{c}</option>)}</select></label>
                    <label className="block font-semibold">Paper Layout<select aria-label="Paper layout" className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700" value={newTplLayoutPaper} onChange={e=>setNewTplLayoutPaper(e.target.value as 'A4' | 'LETTER')}><option value="A4">A4</option><option value="LETTER">Letter</option></select></label>
                  </div>
                  <label className="block font-semibold">Approved Document Type (optional)<select className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700" value={documentTypeId} onChange={e=>setDocumentTypeId(e.target.value)}><option value="">No document type selected</option>{documentTypes.map(t=><option key={t.id} value={t.id}>{t.title} ({t.code})</option>)}</select></label>
                  <label className="block font-semibold">Linked Form Definition (optional)<select className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700" value={linkedFormRevision} onChange={e=>setLinkedFormRevision(e.target.value)}><option value="">No linked form</option>{publishedForms.map(f=><option key={f.id} value={f.published_revision_id}>{f.title} ({f.code})</option>)}</select></label>
                  {catalogError && <p role="status">{catalogError}</p>}
                  <p className="text-[11px] text-(--cabms-text-secondary)">Business: {session.workspaceId ? getBrandDisplayName(session.workspaceId) : 'Workspace'} ({session.workspaceId ?? 'unassigned'}).</p>
                </div>}
                <div className="space-y-2 mt-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-(--cabms-text-secondary) block font-semibold">Sample File (upload text/DOCX metadata)</label>
                    <label className="px-2 py-1 cabms-surface-subtle border cabms-border rounded text-[11px] font-semibold text-(--cabms-text-primary) hover:border-amber-500 cursor-pointer">
                      Choose File
                      <input
                        type="file"
                        aria-label="Upload new template sample file"
                        accept=".txt,.md,.html,.htm,.json,.docx,.pdf"
                        className="sr-only"
                        onChange={e => { void handleSampleFileUpload(e.target.files?.[0], 'create'); e.target.value = ''; }}
                      />
                    </label>
                  </div>
                  <input
                    type="text"
                    value={newTplSampleFile}
                    onChange={e => setNewTplSampleFile(e.target.value)}
                    placeholder="e.g. cctv-sla-template-v1.docx"
                    className="w-full p-2.5 cabms-card-subtle rounded border border-slate-700 text-(--cabms-text-primary)"
                  />
                  {templateUploadNotice && (
                    <p role="status" className="text-[11px] text-amber-300">{templateUploadNotice}</p>
                  )}
                </div>
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
        </TemplateModal>
      )}

      {/* Modal 7: Confirm Delete Job Type Draft */}
      {confirmDeleteJobTypeId && (() => {
        const target = jobTypes.find(jt => jt.id === confirmDeleteJobTypeId);
        if (!target) return null;

        return (
          <TemplateModal onClose={() => setConfirmDeleteJobTypeId(null)} titleId="delete-job-type-title" maxWidthClass="max-w-sm">
              <div className="flex items-center space-x-2 text-rose-400">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5" />
                <h3 id="delete-job-type-title" className="text-base font-bold text-(--cabms-text-primary)">Delete Draft Job Type?</h3>
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
          </TemplateModal>
        );
      })()}

      {/* Modal 8: Confirm Delete Template Draft */}
      {confirmDeleteTemplateId && (() => {
        const target = templates.find(t => t.id === confirmDeleteTemplateId);
        if (!target) return null;

        return (
          <TemplateModal onClose={() => setConfirmDeleteTemplateId(null)} titleId="delete-template-title" maxWidthClass="max-w-sm">
              <div className="flex items-center space-x-2 text-rose-400">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5" />
                <h3 id="delete-template-title" className="text-base font-bold text-(--cabms-text-primary)">Delete Draft Template?</h3>
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
          </TemplateModal>
        );
      })()}
    </div>
  );
};
