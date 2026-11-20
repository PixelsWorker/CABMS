import type { TemplateRevision, TemplateSetting } from '../types/cabms.ts';

export function templateDraftContent(editingContent:string,currentContent:string):string {
 return editingContent === '' ? currentContent : editingContent;
}

/** Convert an authorized detail response without guessing revision identifiers or history. */
export function mapTemplateDetail(input: unknown): TemplateSetting | null {
 if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
 const row=input as Record<string,any>;
 if (typeof row.id!=='string' || typeof row.name!=='string' || !Array.isArray(row.revisions)) return null;
 const validStatuses = new Set(['DRAFT','REVIEW','PUBLISHED','ARCHIVED']);
 if (row.revisions.some((r:any)=>!r || typeof r.id!=='string' || !r.id || typeof r.version!=='string' || typeof r.content!=='string' || !validStatuses.has(r.status))) return null;
 const revisions:TemplateRevision[] = row.revisions.map((r:any)=>({id:r.id,version:r.version,status:r.status,content:r.content,updatedAt:r.updated_at || r.created_at || '',updatedBy:r.created_by || 'SYSTEM',approvedBy:r.approved_by || undefined,approvedAt:r.approved_at || undefined}));
 const pointed = row.current_revision_id ? revisions.find(r=>r.id===row.current_revision_id) : undefined;
 if (row.current_revision_id && !pointed) return null;
 if (row.revision_status === 'PUBLISHED' && pointed?.status !== 'PUBLISHED') return null;
 const published = pointed?.status === 'PUBLISHED' ? pointed : undefined;
 const pending = revisions.find(r=>r.status==='DRAFT' || r.status==='REVIEW');
 const editing = pending || published || pointed;
 if (!editing) return null;
 return {id:row.id,code:row.code || undefined,name:row.name,type:(row.template_type==='QUOTE_TERMS' || row.template_type==='INVOICE_TERMS' ? 'TERMS' : 'COMPLIANCE') as TemplateSetting['type'],currentVersion:editing.version,publishedVersion:published?.version,currentRevisionId:published?.id,editingRevisionId:pending?.id,activeStatus:editing.status,status:row.status || 'DRAFT',content:editing.content,description:row.description || undefined,sampleFileName:row.sample_file_name || undefined,mappingStatus:row.mapping_status || 'Mapped',revisions};
}
