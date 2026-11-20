/**
 * CABMS Templates & Content Management Repository
 * Scoped to authorized workspaces with per-query membership and privilege verification.
 */

import type { D1Database, D1PreparedStatement } from '../../db/d1.ts';
import type { AuthContext } from '../../types.ts';
import { approvedMembership } from '../../workers/privilegedApproval.ts';

const allowedStaff = `EXISTS (SELECT 1 FROM workspace_memberships wm
 JOIN users u ON u.id=wm.user_id AND u.disabled=0
 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
 WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
 AND wm.role IN ('super_admin','owner_admin','office_staff') AND ${approvedMembership})`;

const allowedApprover = `EXISTS (SELECT 1 FROM workspace_memberships wm
 JOIN users u ON u.id=wm.user_id AND u.disabled=0
 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
 WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
 AND wm.role IN ('super_admin','owner_admin') AND ${approvedMembership})`;

const who = (workspace: string, auth: AuthContext) => [workspace, auth.userId, auth.providerSubjectId];

export interface JobTypeRow {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  description: string | null;
  brand_id: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  current_policy_version_id: string | null;
  version?: string;
  policy_status?: string;
  is_direct_to_invoice?: number;
  forms_required?: string[];
  created_at: string;
  updated_at: string;
}

export interface DocumentTemplateRow {
  id: string;
  workspace_id: string;
  code: string;
  name: string;
  template_type: string;
  description: string | null;
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  current_revision_id: string | null;
  sample_file_name: string | null;
  mapping_status: string;
  current_version?: string;
  current_content?: string;
  revision_status?: string;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Job Types
// ---------------------------------------------------------------------------

export async function listJobTypes(db: D1Database, workspace: string, auth: AuthContext): Promise<JobTypeRow[]> {
  const sql = `SELECT jt.*, p.version, p.status AS policy_status, p.is_direct_to_invoice
   FROM job_types jt
   LEFT JOIN job_type_compliance_policies p ON p.id = jt.current_policy_version_id
   WHERE jt.workspace_id = ? AND ${allowedStaff}
   ORDER BY jt.created_at ASC, jt.id ASC`;
  const rows = (await db.prepare(sql).bind(workspace, ...who(workspace, auth)).all<JobTypeRow>()).results;

  // Populate required forms for each job type's current policy
  for (const jt of rows) {
    if (jt.current_policy_version_id) {
      const forms = await db.prepare(
        `SELECT form_type FROM job_type_required_forms WHERE policy_version_id = ? ORDER BY display_order ASC`
      ).bind(jt.current_policy_version_id).all<{ form_type: string }>();
      jt.forms_required = forms.results.map(f => f.form_type);
    } else {
      jt.forms_required = [];
    }
  }
  return rows;
}

export async function getJobType(db: D1Database, workspace: string, auth: AuthContext, id: string) {
  const jt = await db.prepare(
    `SELECT jt.*, p.version, p.status AS policy_status, p.is_direct_to_invoice
     FROM job_types jt
     LEFT JOIN job_type_compliance_policies p ON p.id = jt.current_policy_version_id
     WHERE jt.workspace_id = ? AND jt.id = ? AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).first<JobTypeRow>();

  if (!jt) return null;

  const policies = await db.prepare(
    `SELECT * FROM job_type_compliance_policies WHERE job_type_id = ? ORDER BY created_at DESC`
  ).bind(id).all<{ id: string; version: string; status: string; is_direct_to_invoice: number; effective_at: string | null }>();

  const policiesWithForms = [];
  for (const pol of policies.results) {
    const forms = await db.prepare(
      `SELECT form_type FROM job_type_required_forms WHERE policy_version_id = ? ORDER BY display_order ASC`
    ).bind(pol.id).all<{ form_type: string }>();
    policiesWithForms.push({
      ...pol,
      formsRequired: forms.results.map(f => f.form_type),
      form_rules: (await db.prepare(`SELECT form_revision_id,required,display_order FROM policy_catalog_form_rules WHERE workspace_id=? AND policy_version_id=? ORDER BY display_order,id`).bind(workspace,pol.id).all()).results,
    });
  }

  return {
    ...jt,
    policies: policiesWithForms,
  };
}

export async function createJobType(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  data: {
    name: string;
    code?: string;
    description?: string;
    brandId: string;
    isDirectToInvoice?: boolean;
    formsRequired?: string[];
    status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  }
): Promise<{ id: string; policyId: string } | null> {
  const jtId = `jt-${crypto.randomUUID()}`;
  const polId = `pol-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const code = data.code?.trim() || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const isDirectToInvoice = data.isDirectToInvoice ? 1 : 0;
  // All new job types start in DRAFT status with a DRAFT compliance policy
  const initialStatus = 'DRAFT';
  const initialPolicyStatus = 'DRAFT';

  const statements: D1PreparedStatement[] = [
    // 1. Insert Job Type in DRAFT status
    db.prepare(
      `INSERT INTO job_types (id, workspace_id, code, name, description, brand_id, status, current_policy_version_id, created_at, updated_at, created_by, updated_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${allowedStaff}`
    ).bind(jtId, workspace, code, data.name.trim(), data.description?.trim() || null, data.brandId, initialStatus, polId, now, now, auth.userId, auth.userId, ...who(workspace, auth)),

    // 2. Insert Initial Policy in DRAFT status with null approval metadata
    db.prepare(
      `INSERT INTO job_type_compliance_policies (id, job_type_id, version, status, is_direct_to_invoice, completion_rule, effective_at, created_at, updated_at, created_by, approved_by, approved_at)
       VALUES (?, ?, 'v1.0', ?, ?, 'ALL_MANDATORY_FORMS_SIGNED', NULL, ?, ?, ?, NULL, NULL)`
    ).bind(polId, jtId, initialPolicyStatus, isDirectToInvoice, now, now, auth.userId),
  ];

  // 3. Insert required forms if any
  if (!isDirectToInvoice && Array.isArray(data.formsRequired)) {
    for (let i = 0; i < data.formsRequired.length; i++) {
      const formType = data.formsRequired[i];
      statements.push(
        db.prepare(
          `INSERT INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order)
           VALUES (?, ?, ?, 1, ?)`
        ).bind(`rf-${crypto.randomUUID()}`, polId, formType, i + 1)
      );
    }
  }

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) {
    return null;
  }

  return { id: jtId, policyId: polId };
}

export async function updateJobType(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  id: string,
  updates: { name?: string; description?: string; brandId?: string; code?: string }
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE job_types
     SET name = COALESCE(?, name),
         description = COALESCE(?, description),
         brand_id = COALESCE(?, brand_id),
         code = COALESCE(?, code),
         updated_at = ?,
         updated_by = ?
     WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(updates.name?.trim() || null, updates.description?.trim() || null, updates.brandId || null, updates.code?.trim() || null, now, auth.userId, workspace, id, ...who(workspace, auth)).run();

  return res.meta.changes === 1;
}

export async function setJobTypeStatus(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  id: string,
  status: 'ACTIVE' | 'ARCHIVED'
): Promise<boolean> {
  const now = new Date().toISOString();
  // Block premature activation: restoring to ACTIVE requires the current policy to be PUBLISHED
  const res = await db.prepare(
    `UPDATE job_types
     SET status = ?, updated_at = ?, updated_by = ?
     WHERE workspace_id = ? AND id = ? AND ${allowedStaff}
       AND (? != 'ACTIVE' OR EXISTS (
         SELECT 1 FROM job_type_compliance_policies p
         WHERE p.id = job_types.current_policy_version_id AND p.status = 'PUBLISHED'
       ))`
  ).bind(status, now, auth.userId, workspace, id, ...who(workspace, auth), status).run();

  return res.meta.changes === 1;
}

export async function deleteJobTypeDraft(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  id: string
): Promise<{ success: boolean; error?: string }> {
  const target = await db.prepare(
    `SELECT * FROM job_types WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).first<JobTypeRow>();

  if (!target) return { success: false, error: 'Job type not found' };
  if (target.status !== 'DRAFT') return { success: false, error: 'Only DRAFT job types can be deleted. Use Archive for active job types.' };

  const del = await db.prepare(
    `DELETE FROM job_types WHERE workspace_id = ? AND id = ? AND status = 'DRAFT' AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).run();

  return { success: del.meta.changes === 1 };
}

export async function createJobTypePolicyDraft(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  jobTypeId: string,
  data: { isDirectToInvoice: boolean; formsRequired: string[]; formRules?: Array<{form_revision_id:string; required:boolean}> }
): Promise<{ id: string; version: string } | null> {
  const jt = await db.prepare(
    `SELECT * FROM job_types WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(workspace, jobTypeId, ...who(workspace, auth)).first<JobTypeRow>();

  if (!jt) return null;

  const policies = await db.prepare(
    `SELECT version FROM job_type_compliance_policies WHERE job_type_id = ?`
  ).bind(jobTypeId).all<{ version: string }>();

  const nextVerNum = (policies.results.length + 1).toFixed(1);
  const version = `v${nextVerNum}-draft`;
  const polId = `pol-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const isDirectToInvoice = data.isDirectToInvoice ? 1 : 0;

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO job_type_compliance_policies (id, job_type_id, version, status, is_direct_to_invoice, completion_rule, effective_at, created_at, updated_at, created_by)
       SELECT ?, ?, ?, 'DRAFT', ?, 'ALL_MANDATORY_FORMS_SIGNED', NULL, ?, ?, ? WHERE EXISTS (SELECT 1 FROM job_types WHERE id=? AND workspace_id=?) AND ${allowedStaff}`
    ).bind(polId, jobTypeId, version, isDirectToInvoice, now, now, auth.userId,jobTypeId,workspace,...who(workspace,auth)),
  ];

  if (!isDirectToInvoice && Array.isArray(data.formsRequired)) {
    for (let i = 0; i < data.formsRequired.length; i++) {
      statements.push(
        db.prepare(
          `INSERT INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order)
           VALUES (?, ?, ?, 1, ?)`
        ).bind(`rf-${crypto.randomUUID()}`, polId, data.formsRequired[i], i + 1)
      );
    }
  }

  for (const [i, rule] of (data.formRules || []).entries()) {
    statements.push(db.prepare(`INSERT INTO policy_catalog_form_rules (id,workspace_id,policy_version_id,form_revision_id,required,display_order) VALUES (?,?,?,?,?,?)`).bind(`pfr-${crypto.randomUUID()}`,workspace,polId,rule.form_revision_id,rule.required ? 1 : 0,i));
  }

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) return null;

  return { id: polId, version };
}

export async function submitJobTypePolicyReview(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  jobTypeId: string,
  policyId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE job_type_compliance_policies
     SET status = 'REVIEW', updated_at = ?
     WHERE id = ? AND job_type_id = ? AND status = 'DRAFT'
       AND EXISTS (SELECT 1 FROM job_types jt WHERE jt.id = ? AND jt.workspace_id = ? AND ${allowedStaff})`
  ).bind(now, policyId, jobTypeId, jobTypeId, workspace, ...who(workspace, auth)).run();

  return res.meta.changes === 1;
}

export async function approveJobTypePolicy(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  jobTypeId: string,
  policyId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  // Only owner_admin and super_admin are authorized to approve policies
  // Strictly require status = 'REVIEW'
  const pol = await db.prepare(
    `SELECT version FROM job_type_compliance_policies
     WHERE id = ? AND job_type_id = ? AND status = 'REVIEW'
       AND NOT EXISTS (SELECT 1 FROM policy_catalog_form_rules WHERE policy_version_id = job_type_compliance_policies.id)
       AND EXISTS (SELECT 1 FROM job_types jt WHERE jt.id = ? AND jt.workspace_id = ? AND ${allowedApprover})`
  ).bind(policyId, jobTypeId, jobTypeId, workspace, ...who(workspace, auth)).first<{ version: string }>();

  if (!pol) return false;

  const publishedVer = pol.version.replace('-draft', '');

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE job_type_compliance_policies
       SET status = 'PUBLISHED',
           version = ?,
           effective_at = ?,
           approved_by = ?,
           approved_at = ?,
           updated_at = ?
       WHERE id = ? AND status = 'REVIEW'`
    ).bind(publishedVer, now, auth.userId, now, now, policyId),
    db.prepare(
      `UPDATE job_types
       SET current_policy_version_id = ?,
           status = CASE WHEN status = 'DRAFT' THEN 'ACTIVE' ELSE status END,
           updated_at = ?,
           updated_by = ?
       WHERE id = ? AND workspace_id = ?`
    ).bind(policyId, now, auth.userId, jobTypeId, workspace),
  ];

  const results = await db.batch(statements);
  return results[0]?.meta.changes === 1;
}

// ---------------------------------------------------------------------------
// Document Templates
// ---------------------------------------------------------------------------

export async function listTemplates(db: D1Database, workspace: string, auth: AuthContext): Promise<DocumentTemplateRow[]> {
  const sql = `SELECT t.*, r.version AS current_version, r.status AS revision_status, r.content AS current_content
   FROM document_templates t
   LEFT JOIN template_revisions r ON r.id = t.current_revision_id
   WHERE t.workspace_id = ? AND ${allowedStaff}
   ORDER BY t.created_at ASC, t.id ASC`;

  return (await db.prepare(sql).bind(workspace, ...who(workspace, auth)).all<DocumentTemplateRow>()).results;
}

export async function getTemplate(db: D1Database, workspace: string, auth: AuthContext, id: string) {
  const tpl = await db.prepare(
    `SELECT t.*, r.version AS current_version, r.status AS revision_status, r.content AS current_content
     FROM document_templates t
     LEFT JOIN template_revisions r ON r.id = t.current_revision_id
     WHERE t.workspace_id = ? AND t.id = ? AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).first<DocumentTemplateRow>();

  if (!tpl) return null;

  const revisions = await db.prepare(
    `SELECT * FROM template_revisions WHERE template_id = ? ORDER BY created_at DESC`
  ).bind(id).all<{ id: string; version: string; status: string; content: string; effective_at: string | null }>();

  return {
    ...tpl,
    revisions: revisions.results,
  };
}

export async function createTemplate(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  data: {
    name: string;
    code?: string;
    templateType: 'QUOTE_TERMS' | 'INVOICE_TERMS' | 'COMPLIANCE_DISCLAIMER' | 'EMAIL_COVER';
    content: string;
    description?: string;
    sampleFileName?: string;
    status?: 'ACTIVE' | 'ARCHIVED' | 'DRAFT';
  }
): Promise<{ id: string; revisionId: string } | null> {
  const tplId = `tpl-${crypto.randomUUID()}`;
  const revId = `rev-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const code = data.code?.trim() || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  // All new document templates start in DRAFT status with a DRAFT revision
  const initialStatus = 'DRAFT';
  const initialRevStatus = 'DRAFT';

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO document_templates (id, workspace_id, code, name, template_type, description, status, current_revision_id, sample_file_name, mapping_status, created_at, updated_at, created_by, updated_by)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Mapped', ?, ?, ?, ?
       WHERE ${allowedStaff}`
    ).bind(tplId, workspace, code, data.name.trim(), data.templateType, data.description?.trim() || null, initialStatus, revId, data.sampleFileName || `${code}.docx`, now, now, auth.userId, auth.userId, ...who(workspace, auth)),

    db.prepare(
      `INSERT INTO template_revisions (id, template_id, version, status, content, sample_file_name, effective_at, created_at, updated_at, created_by, approved_by, approved_at)
       VALUES (?, ?, 'v1.0', ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`
    ).bind(revId, tplId, initialRevStatus, data.content, data.sampleFileName || `${code}.docx`, now, now, auth.userId),
  ];

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) {
    return null;
  }

  return { id: tplId, revisionId: revId };
}

export async function setTemplateStatus(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  id: string,
  status: 'ACTIVE' | 'ARCHIVED'
): Promise<boolean> {
  const now = new Date().toISOString();
  // Block premature activation: restoring to ACTIVE requires current revision to be PUBLISHED
  const res = await db.prepare(
    `UPDATE document_templates
     SET status = ?, updated_at = ?, updated_by = ?
     WHERE workspace_id = ? AND id = ? AND ${allowedStaff}
       AND (? != 'ACTIVE' OR EXISTS (
         SELECT 1 FROM template_revisions r
         WHERE r.id = document_templates.current_revision_id AND r.status = 'PUBLISHED'
       ))`
  ).bind(status, now, auth.userId, workspace, id, ...who(workspace, auth), status).run();

  return res.meta.changes === 1;
}

export async function deleteTemplateDraft(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  id: string
): Promise<{ success: boolean; error?: string }> {
  const target = await db.prepare(
    `SELECT * FROM document_templates WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).first<DocumentTemplateRow>();

  if (!target) return { success: false, error: 'Template not found' };
  if (target.status !== 'DRAFT') return { success: false, error: 'Only DRAFT templates can be deleted. Use Archive for active templates.' };

  const del = await db.prepare(
    `DELETE FROM document_templates WHERE workspace_id = ? AND id = ? AND status = 'DRAFT' AND ${allowedStaff}`
  ).bind(workspace, id, ...who(workspace, auth)).run();

  return { success: del.meta.changes === 1 };
}

export async function createTemplateRevisionDraft(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  templateId: string,
  content: string
): Promise<{ id: string; version: string } | null> {
  const tpl = await db.prepare(
    `SELECT * FROM document_templates WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(workspace, templateId, ...who(workspace, auth)).first<DocumentTemplateRow>();

  if (!tpl) return null;

  const revisions = await db.prepare(
    `SELECT version FROM template_revisions WHERE template_id = ?`
  ).bind(templateId).all<{ version: string }>();

  const nextVerNum = (revisions.results.length + 1).toFixed(1);
  const version = `v${nextVerNum}-draft`;
  const revId = `rev-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO template_revisions (id, template_id, version, status, content, sample_file_name, effective_at, created_at, updated_at, created_by)
       VALUES (?, ?, ?, 'DRAFT', ?, ?, NULL, ?, ?, ?)`
    ).bind(revId, templateId, version, content, tpl.sample_file_name, now, now, auth.userId),
  ];

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) return null;

  return { id: revId, version };
}

export async function submitTemplateRevisionReview(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  templateId: string,
  revisionId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE template_revisions
     SET status = 'REVIEW', updated_at = ?
     WHERE id = ? AND template_id = ? AND status = 'DRAFT'
       AND EXISTS (SELECT 1 FROM document_templates t WHERE t.id = ? AND t.workspace_id = ? AND ${allowedStaff})`
  ).bind(now, revisionId, templateId, templateId, workspace, ...who(workspace, auth)).run();

  return res.meta.changes === 1;
}

export async function approveTemplateRevision(
  db: D1Database,
  workspace: string,
  auth: AuthContext,
  templateId: string,
  revisionId: string
): Promise<boolean> {
  const now = new Date().toISOString();
  // Only owner_admin and super_admin are authorized to approve revisions
  // Strictly require status = 'REVIEW'
  const rev = await db.prepare(
    `SELECT version FROM template_revisions
     WHERE id = ? AND template_id = ? AND status = 'REVIEW'
       AND EXISTS (SELECT 1 FROM document_templates t WHERE t.id = ? AND t.workspace_id = ? AND ${allowedApprover})`
  ).bind(revisionId, templateId, templateId, workspace, ...who(workspace, auth)).first<{ version: string }>();

  if (!rev) return false;

  const publishedVer = rev.version.replace('-draft', '');

  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE template_revisions
       SET status = 'PUBLISHED',
           version = ?,
           effective_at = ?,
           approved_by = ?,
           approved_at = ?,
           updated_at = ?
       WHERE id = ? AND status = 'REVIEW'`
    ).bind(publishedVer, now, auth.userId, now, now, revisionId),
    db.prepare(
      `UPDATE document_templates
       SET current_revision_id = ?,
           status = CASE WHEN status = 'DRAFT' THEN 'ACTIVE' ELSE status END,
           updated_at = ?,
           updated_by = ?
       WHERE id = ? AND workspace_id = ?`
    ).bind(revisionId, now, auth.userId, templateId, workspace),
  ];

  const results = await db.batch(statements);
  return results[0]?.meta.changes === 1;
}
