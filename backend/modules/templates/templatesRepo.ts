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
  catalog_forms?: Array<{revision_id:string;title:string;code:string;required:number}>;
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
  const catalogAvailable = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first();

  // Populate required forms for each job type's current policy
  for (const jt of rows) {
    if (jt.current_policy_version_id) {
      const forms = await db.prepare(
        `SELECT form_type FROM job_type_required_forms WHERE policy_version_id = ? ORDER BY display_order ASC`
      ).bind(jt.current_policy_version_id).all<{ form_type: string }>();
      jt.forms_required = forms.results.map(f => f.form_type);
      jt.catalog_forms = catalogAvailable ? (await db.prepare(`SELECT r.id AS revision_id,f.title,f.code,c.required FROM policy_catalog_form_rules c JOIN form_revisions r ON r.id=c.form_revision_id AND r.workspace_id=c.workspace_id JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id WHERE c.workspace_id=? AND c.policy_version_id=? ORDER BY c.display_order,c.id`).bind(workspace,jt.current_policy_version_id).all<{revision_id:string;title:string;code:string;required:number}>()).results : [];
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
  const catalogTable = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first();

  const policiesWithForms = [];
  for (const pol of policies.results) {
    const forms = await db.prepare(
      `SELECT form_type FROM job_type_required_forms WHERE policy_version_id = ? ORDER BY display_order ASC`
    ).bind(pol.id).all<{ form_type: string }>();
    policiesWithForms.push({
      ...pol,
      formsRequired: forms.results.map(f => f.form_type),
      form_rules: catalogTable ? (await db.prepare(`SELECT form_revision_id,required,display_order FROM policy_catalog_form_rules WHERE workspace_id=? AND policy_version_id=? ORDER BY display_order,id`).bind(workspace,pol.id).all()).results : [],
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
    formRules?: Array<{form_revision_id:string;required:boolean}>;
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

  for (const [i, rule] of (data.formRules || []).entries()) {
    statements.push(db.prepare(`INSERT INTO policy_catalog_form_rules (id,workspace_id,policy_version_id,form_revision_id,required,display_order) VALUES (?,?,?,?,?,?)`).bind(`pfr-${crypto.randomUUID()}`,workspace,polId,rule.form_revision_id,rule.required ? 1 : 0,i));
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
  data: {
    isDirectToInvoice?: boolean;
    formsRequired?: string[];
    formRules?: Array<{form_revision_id:string; required:boolean}>;
    base_policy_id?: string;
    basePolicyId?: string;
    mode?: 'ADDITIVE' | 'REPLACE';
  }
): Promise<{ id: string; version: string } | { error: string; code?: string; detail?: string } | null> {
  const jt = await db.prepare(
    `SELECT * FROM job_types WHERE workspace_id = ? AND id = ? AND ${allowedStaff}`
  ).bind(workspace, jobTypeId, ...who(workspace, auth)).first<JobTypeRow>();

  if (!jt) return null;

  const basePolicyId = data.base_policy_id || data.basePolicyId;
  if (basePolicyId && jt.current_policy_version_id && basePolicyId !== jt.current_policy_version_id) {
    return { error: 'STALE_POLICY', code: 'VERSION_CONFLICT', detail: 'The policy draft is based on a policy that is no longer current.' };
  }

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

  // Resolve legacy forms: if formsRequired is omitted, carry forward from predecessor policy
  let finalFormsRequired = data.formsRequired;
  if (finalFormsRequired === undefined && jt.current_policy_version_id) {
    const existingLegacy = await db.prepare(
      `SELECT form_type FROM job_type_required_forms WHERE policy_version_id=? ORDER BY display_order, id`
    ).bind(jt.current_policy_version_id).all<{ form_type: string }>();
    finalFormsRequired = existingLegacy.results.map(r => r.form_type);
  }

  if (!isDirectToInvoice && Array.isArray(finalFormsRequired)) {
    for (let i = 0; i < finalFormsRequired.length; i++) {
      const formType = finalFormsRequired[i];
      const newRuleId = `rf-${crypto.randomUUID()}`;
      statements.push(
        db.prepare(
          `INSERT INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order)
           VALUES (?, ?, ?, 1, ?)`
        ).bind(newRuleId, polId, formType, i + 1)
      );
    }
  }

  // Resolve catalog form rules: preserve existing rules if omitted or in additive mode (F01)
  const catalogAvailable = !!await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first();
  let finalCatalogRules: Array<{ form_revision_id: string; required: boolean }> = [];
  if (catalogAvailable) {
    if (data.formRules === undefined && jt.current_policy_version_id) {
      const existingRules = await db.prepare(
        `SELECT form_revision_id, required FROM policy_catalog_form_rules WHERE workspace_id=? AND policy_version_id=? ORDER BY display_order, id`
      ).bind(workspace, jt.current_policy_version_id).all<{ form_revision_id: string; required: number }>();
      finalCatalogRules = existingRules.results.map(r => ({ form_revision_id: r.form_revision_id, required: r.required === 1 }));
    } else if (data.mode === 'ADDITIVE' && jt.current_policy_version_id) {
      const existingRules = await db.prepare(
        `SELECT form_revision_id, required FROM policy_catalog_form_rules WHERE workspace_id=? AND policy_version_id=? ORDER BY display_order, id`
      ).bind(workspace, jt.current_policy_version_id).all<{ form_revision_id: string; required: number }>();
      const map = new Map<string, boolean>();
      for (const r of existingRules.results) {
        map.set(r.form_revision_id, r.required === 1);
      }
      for (const r of (data.formRules || [])) {
        map.set(r.form_revision_id, r.required);
      }
      finalCatalogRules = Array.from(map.entries()).map(([form_revision_id, required]) => ({ form_revision_id, required }));
    } else if (data.formRules !== undefined) {
      finalCatalogRules = data.formRules;
    }

    for (const [i, rule] of finalCatalogRules.entries()) {
      statements.push(db.prepare(`INSERT INTO policy_catalog_form_rules (id,workspace_id,policy_version_id,form_revision_id,required,display_order) VALUES (?,?,?,?,?,?)`).bind(`pfr-${crypto.randomUUID()}`,workspace,polId,rule.form_revision_id,rule.required ? 1 : 0,i));
    }
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
): Promise<{ success: boolean; code?: string; error?: string; blockers?: any[] }> {
  const now = new Date().toISOString();
  // Fail closed if catalog constraints are unavailable; do not publish an
  // incompletely understood policy against a partially initialized schema.
  if (!await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='policy_catalog_form_rules'`).first()) {
    return { success: false, code: 'CATALOG_NOT_READY', error: 'Catalog table policy_catalog_form_rules is unavailable.' };
  }

  // Policies with catalog rules can become selectable only where the job
  // creation and pinning guards are installed and every reference is eligible.
  const eligibleCatalog = `NOT EXISTS (
    SELECT 1 FROM policy_catalog_form_rules rule
    WHERE rule.policy_version_id=job_type_compliance_policies.id
      AND (
        NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_create_job')
        OR NOT EXISTS (SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='compliance_snapshot')
        OR NOT EXISTS (
          SELECT 1 FROM job_types jt
          JOIN form_revisions r ON r.workspace_id=jt.workspace_id AND r.id=rule.form_revision_id AND r.status='PUBLISHED'
          JOIN form_definitions f ON f.workspace_id=r.workspace_id AND f.id=r.form_definition_id
            AND f.status='ACTIVE' AND f.brand_id=jt.brand_id
          WHERE jt.id=job_type_compliance_policies.job_type_id AND rule.workspace_id=jt.workspace_id
        )
      )
  )`;
  // Only owner_admin and super_admin are authorized to approve policies
  // Strictly require status = 'REVIEW'
  const pol = await db.prepare(
    `SELECT version FROM job_type_compliance_policies
     WHERE id = ? AND job_type_id = ? AND status = 'REVIEW'
       AND ${eligibleCatalog}
       AND EXISTS (SELECT 1 FROM job_types jt WHERE jt.id = ? AND jt.workspace_id = ? AND ${allowedApprover})`
  ).bind(policyId, jobTypeId, jobTypeId, workspace, ...who(workspace, auth)).first<{ version: string }>();

  if (!pol) {
    return { success: false, code: 'APPROVAL_FAILED', error: 'Policy approval requires a reviewed policy, eligible published forms and operational job enforcement for catalog rules.' };
  }

  // Pre-carry-forward check: for any unmapped legacy required forms, check if predecessor policy had an approved mapping
  const jt = await db.prepare(
    `SELECT current_policy_version_id, brand_id FROM job_types WHERE workspace_id=? AND id=?`
  ).bind(workspace, jobTypeId).first<{ current_policy_version_id: string | null; brand_id: string }>();

  if (jt?.current_policy_version_id) {
    const predMappedCount = await db.prepare(
      `SELECT count(*) AS count FROM job_type_required_forms l
       JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=?
       WHERE l.policy_version_id=?`
    ).bind(workspace, jt.current_policy_version_id).first<{ count: number }>();

    const unmapped = await db.prepare(
      `SELECT l.id, l.form_type FROM job_type_required_forms l
       LEFT JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=?
       WHERE l.policy_version_id=? AND l.required=1 AND m.legacy_rule_id IS NULL`
    ).bind(workspace, policyId).all<{ id: string; form_type: string }>();

    for (const rule of unmapped.results) {
      const predMapping = await db.prepare(
        `SELECT m.revision_id FROM job_type_required_forms l
         JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=?
         JOIN form_revisions r ON r.id=m.revision_id AND r.workspace_id=m.workspace_id AND r.status='PUBLISHED'
         JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id AND f.status='ACTIVE' AND f.brand_id=?
         WHERE l.policy_version_id=? AND l.form_type=?`
      ).bind(workspace, jt.brand_id, jt.current_policy_version_id, rule.form_type).first<{ revision_id: string }>();

      if (predMapping) {
        await db.prepare(
          `INSERT INTO compliance_legacy_mappings (legacy_rule_id, workspace_id, revision_id, approved_by, approved_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(rule.id, workspace, predMapping.revision_id, auth.userId, now).run();
      }
    }

    if ((predMappedCount?.count || 0) > 0) {
      const stillUnmapped = await db.prepare(
        `SELECT l.id, l.form_type FROM job_type_required_forms l
         LEFT JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=?
         WHERE l.policy_version_id=? AND l.required=1 AND m.legacy_rule_id IS NULL`
      ).bind(workspace, policyId).all<{ id: string; form_type: string }>();

      if (stillUnmapped.results.length > 0) {
        return {
          success: false,
          code: 'LEGACY_MAPPING_REQUIRED',
          error: 'Every mandatory legacy form requirement must have an approved mapping before publication.',
          blockers: stillUnmapped.results.map(r => ({ code: 'LEGACY_MAPPING_REQUIRED', form_type: r.form_type, rule_id: r.id })),
        };
      }
    }
  }

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
       WHERE id = ? AND job_type_id = ? AND status = 'REVIEW'
         AND ${eligibleCatalog}
         AND EXISTS (SELECT 1 FROM job_types jt WHERE jt.id=job_type_compliance_policies.job_type_id AND jt.workspace_id=? AND jt.status<>'ARCHIVED' AND ${allowedApprover})`
    ).bind(publishedVer, now, auth.userId, now, now, policyId,jobTypeId,workspace,...who(workspace,auth)),
    db.prepare(
      `UPDATE job_types
       SET current_policy_version_id = ?,
           status = CASE WHEN status = 'DRAFT' THEN 'ACTIVE' ELSE status END,
           updated_at = ?,
           updated_by = ?
       WHERE id = ? AND workspace_id = ? AND status<>'ARCHIVED' AND changes()=1 AND ${allowedApprover}`
    ).bind(policyId, now, auth.userId, jobTypeId, workspace,...who(workspace,auth)),
  ];

  const results = await db.batch(statements);
  const ok = results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
  return ok ? { success: true } : { success: false, code: 'APPROVAL_FAILED', error: 'Failed to update policy and job type in database.' };
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

  const hasOutput = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='template_revision_output'`).first();
  const outputByRevision = new Map<string, unknown>();
  if (hasOutput) {
    const outputs = await db.prepare(`SELECT o.* FROM template_revision_output o JOIN template_revisions r ON r.id=o.revision_id WHERE o.workspace_id=? AND r.template_id=?`).bind(workspace,id).all<{revision_id:string; category:string; brand_id:string; linked_form_revision_id:string|null; document_type_id:string|null; layout_json:string; dynamic_fields_json:string}>();
    for (const output of outputs.results) outputByRevision.set(output.revision_id,{category:output.category,brand_id:output.brand_id,linked_form_revision_id:output.linked_form_revision_id,document_type_id:output.document_type_id,layout:JSON.parse(output.layout_json),dynamic_fields:JSON.parse(output.dynamic_fields_json)});
  }

  return {
    ...tpl,
    revisions: revisions.results.map(r=>({...r,output:outputByRevision.get(r.id) || null})),
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
    output?: { category:'Compliance'|'Terms'|'Email'|'Contract'; brand_id:string; linked_form_revision_id?:string|null; document_type_id?:string|null; layout:Record<string,unknown>; dynamic_fields:Record<string,unknown> };
  }
): Promise<{ id: string; revisionId: string; updated_at:string } | null> {
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

  if (data.output) statements.push(db.prepare(`INSERT INTO template_revision_output (revision_id,workspace_id,brand_id,category,linked_form_revision_id,document_type_id,layout_json,dynamic_fields_json) VALUES (?,?,?,?,?,?,?,?)`).bind(revId,workspace,data.output.brand_id,data.output.category,data.output.linked_form_revision_id || null,data.output.document_type_id || null,JSON.stringify(data.output.layout),JSON.stringify(data.output.dynamic_fields)));

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) {
    return null;
  }

  return { id: tplId, revisionId: revId, updated_at: now };
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
): Promise<{ id: string; version: string; updated_at:string } | null> {
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

  const hasOutput = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='template_revision_output'`).first();
  if (hasOutput && tpl.current_revision_id) statements.push(db.prepare(`INSERT INTO template_revision_output (revision_id,workspace_id,brand_id,category,linked_form_revision_id,document_type_id,layout_json,dynamic_fields_json) SELECT ?,workspace_id,brand_id,category,linked_form_revision_id,document_type_id,layout_json,dynamic_fields_json FROM template_revision_output WHERE workspace_id=? AND revision_id=?`).bind(revId,workspace,tpl.current_revision_id));

  const results = await db.batch(statements);
  if (!results[0] || results[0].meta.changes !== 1) return null;

  return { id: revId, version, updated_at: now };
}

export async function updateTemplateDraftContent(db:D1Database,workspace:string,auth:AuthContext,templateId:string,revisionId:string,expectedUpdatedAt:string,content:string):Promise<string|null> {
  const expectedTime=Date.parse(expectedUpdatedAt);
  if (!Number.isFinite(expectedTime)) return null;
  const updatedAt=new Date(Math.max(Date.now(),expectedTime+1)).toISOString();
  const result=await db.prepare(`UPDATE template_revisions SET content=?,updated_at=? WHERE id=? AND template_id=? AND status='DRAFT' AND updated_at=? AND EXISTS (SELECT 1 FROM document_templates t WHERE t.id=template_revisions.template_id AND t.workspace_id=? AND t.status<>'ARCHIVED' AND ${allowedStaff})`).bind(content,updatedAt,revisionId,templateId,expectedUpdatedAt,workspace,...who(workspace,auth)).run();
  return result.meta.changes===1 ? updatedAt : null;
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
       WHERE id = ? AND template_id=? AND status = 'REVIEW'
         AND EXISTS (SELECT 1 FROM document_templates t WHERE t.id=template_revisions.template_id AND t.workspace_id=? AND t.status<>'ARCHIVED' AND ${allowedApprover})`
    ).bind(publishedVer, now, auth.userId, now, now, revisionId,templateId,workspace,...who(workspace,auth)),
    db.prepare(
      `UPDATE document_templates
       SET current_revision_id = ?,
           status = CASE WHEN status = 'DRAFT' THEN 'ACTIVE' ELSE status END,
           updated_at = ?,
           updated_by = ?
       WHERE id = ? AND workspace_id = ? AND status<>'ARCHIVED' AND changes()=1 AND ${allowedApprover}`
    ).bind(revisionId, now, auth.userId, templateId, workspace,...who(workspace,auth)),
  ];

  const results = await db.batch(statements);
  return results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1;
}
