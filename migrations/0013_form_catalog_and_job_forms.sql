-- C1 forward-only catalog foundation. Does not alter or backfill migration 0012.
-- Legacy form codes remain authoritative until an approved mapping exists.
CREATE TABLE form_definitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  brand_id TEXT NOT NULL,
  code TEXT NOT NULL CHECK(length(trim(code)) > 0),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Custom' CHECK(category IN ('Safety','Electrical','Smoke Alarm','Cabling','Inspection','Custom')),
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','ARCHIVED')),
  published_revision_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(workspace_id,id), UNIQUE(workspace_id,code),
  FOREIGN KEY(workspace_id,published_revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TABLE form_revisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  form_definition_id TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','REVIEW','PUBLISHED')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  created_by TEXT, approved_by TEXT, approved_at TEXT,
  UNIQUE(workspace_id,id), UNIQUE(form_definition_id,version),
  FOREIGN KEY(workspace_id,form_definition_id) REFERENCES form_definitions(workspace_id,id)
);
CREATE TABLE form_sections (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0), description TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL CHECK(display_order >= 0),
  repeatable INTEGER NOT NULL DEFAULT 0 CHECK(repeatable IN (0,1)),
  UNIQUE(workspace_id,id), FOREIGN KEY(workspace_id,revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TABLE form_fields (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, section_id TEXT NOT NULL,
  field_key TEXT NOT NULL CHECK(length(trim(field_key)) > 0), label TEXT NOT NULL CHECK(length(trim(label)) > 0),
  field_type TEXT NOT NULL CHECK(field_type IN ('TEXT','LONG_TEXT','NUMBER','DATE','DATETIME','DROPDOWN','CHECKBOX','MULTIPLE_CHOICE','MULTISELECT','YES_NO_NA','PASS_FAIL','PASS_FAIL_NA','REPEATABLE_TABLE','PHOTO','FILE','SIGNATURE','READONLY_AUTOFILL')),
  required INTEGER NOT NULL DEFAULT 0 CHECK(required IN (0,1)), display_order INTEGER NOT NULL CHECK(display_order >= 0),
  instructions TEXT NOT NULL DEFAULT '', choices_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(choices_json)),
  validation_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(validation_json)), visible_when_json TEXT CHECK(visible_when_json IS NULL OR json_valid(visible_when_json)), autofill_source TEXT,
  UNIQUE(workspace_id,id), UNIQUE(section_id,field_key),
  FOREIGN KEY(workspace_id,section_id) REFERENCES form_sections(workspace_id,id)
);
CREATE TRIGGER form_revision_initial_draft BEFORE INSERT ON form_revisions
WHEN NEW.status <> 'DRAFT' BEGIN SELECT RAISE(ABORT,'form revisions must start as draft'); END;
CREATE TRIGGER form_revision_state_transition BEFORE UPDATE ON form_revisions
WHEN OLD.status <> 'PUBLISHED' AND NOT (NEW.status = OLD.status OR (OLD.status='DRAFT' AND NEW.status='REVIEW') OR (OLD.status='REVIEW' AND NEW.status='PUBLISHED'))
BEGIN SELECT RAISE(ABORT,'invalid form revision transition'); END;
CREATE TRIGGER form_revision_published_immutable BEFORE UPDATE ON form_revisions
WHEN OLD.status='PUBLISHED' BEGIN SELECT RAISE(ABORT,'published form revision immutable'); END;
CREATE TRIGGER form_revision_published_no_delete BEFORE DELETE ON form_revisions
WHEN OLD.status='PUBLISHED' BEGIN SELECT RAISE(ABORT,'published form revision immutable'); END;
CREATE TRIGGER form_revision_review_immutable BEFORE UPDATE ON form_revisions
WHEN OLD.status='REVIEW' AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.form_definition_id IS NOT OLD.form_definition_id OR NEW.version IS NOT OLD.version
 OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by)
BEGIN SELECT RAISE(ABORT,'review form revision immutable'); END;
CREATE TRIGGER form_definition_initial_pointer BEFORE INSERT ON form_definitions
WHEN NEW.published_revision_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'published form pointer must start empty'); END;
CREATE TRIGGER form_definition_published_pointer BEFORE UPDATE OF published_revision_id ON form_definitions
WHEN NEW.published_revision_id IS NOT NULL AND NOT EXISTS (
 SELECT 1 FROM form_revisions r WHERE r.id=NEW.published_revision_id AND r.workspace_id=NEW.workspace_id AND r.form_definition_id=NEW.id AND r.status='PUBLISHED'
) BEGIN SELECT RAISE(ABORT,'published form pointer requires published revision'); END;
CREATE TRIGGER form_section_insert_draft BEFORE INSERT ON form_sections
WHEN (SELECT status FROM form_revisions WHERE id=NEW.revision_id AND workspace_id=NEW.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;
CREATE TRIGGER form_section_update_draft BEFORE UPDATE ON form_sections
WHEN (SELECT status FROM form_revisions WHERE id=OLD.revision_id AND workspace_id=OLD.workspace_id) <> 'DRAFT'
 OR (SELECT status FROM form_revisions WHERE id=NEW.revision_id AND workspace_id=NEW.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;
CREATE TRIGGER form_section_delete_draft BEFORE DELETE ON form_sections
WHEN (SELECT status FROM form_revisions WHERE id=OLD.revision_id AND workspace_id=OLD.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;
CREATE TRIGGER form_field_insert_draft BEFORE INSERT ON form_fields
WHEN (SELECT r.status FROM form_sections s JOIN form_revisions r ON r.id=s.revision_id AND r.workspace_id=s.workspace_id WHERE s.id=NEW.section_id AND s.workspace_id=NEW.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;
CREATE TRIGGER form_field_update_draft BEFORE UPDATE ON form_fields
WHEN (SELECT r.status FROM form_sections s JOIN form_revisions r ON r.id=s.revision_id AND r.workspace_id=s.workspace_id WHERE s.id=OLD.section_id AND s.workspace_id=OLD.workspace_id) <> 'DRAFT'
 OR (SELECT r.status FROM form_sections s JOIN form_revisions r ON r.id=s.revision_id AND r.workspace_id=s.workspace_id WHERE s.id=NEW.section_id AND s.workspace_id=NEW.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;
CREATE TRIGGER form_field_delete_draft BEFORE DELETE ON form_fields
WHEN (SELECT r.status FROM form_sections s JOIN form_revisions r ON r.id=s.revision_id AND r.workspace_id=s.workspace_id WHERE s.id=OLD.section_id AND s.workspace_id=OLD.workspace_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'form revision immutable outside draft'); END;

-- Catalog rules supplement legacy 0012 rules; existing rows remain untouched.
CREATE TABLE policy_catalog_form_rules (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, policy_version_id TEXT NOT NULL REFERENCES job_type_compliance_policies(id),
  form_revision_id TEXT NOT NULL, required INTEGER NOT NULL CHECK(required IN (0,1)), display_order INTEGER NOT NULL CHECK(display_order >= 0),
  UNIQUE(policy_version_id,form_revision_id),
  FOREIGN KEY(workspace_id,form_revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TRIGGER policy_catalog_rule_insert_guard BEFORE INSERT ON policy_catalog_form_rules
WHEN NOT EXISTS (SELECT 1 FROM job_type_compliance_policies p JOIN job_types j ON j.id=p.job_type_id
 JOIN form_revisions r ON r.id=NEW.form_revision_id AND r.workspace_id=NEW.workspace_id AND r.status='PUBLISHED'
 JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id AND f.status='ACTIVE' AND f.brand_id=j.brand_id
 WHERE p.id=NEW.policy_version_id AND p.status='DRAFT' AND j.workspace_id=NEW.workspace_id)
BEGIN SELECT RAISE(ABORT,'catalog rule requires a draft policy and published matching form'); END;
CREATE TRIGGER policy_catalog_rule_update_guard BEFORE UPDATE ON policy_catalog_form_rules
BEGIN SELECT RAISE(ABORT,'catalog rules must be replaced while draft'); END;
CREATE TRIGGER policy_catalog_rule_delete_guard BEFORE DELETE ON policy_catalog_form_rules
WHEN (SELECT status FROM job_type_compliance_policies WHERE id=OLD.policy_version_id) <> 'DRAFT'
BEGIN SELECT RAISE(ABORT,'reviewed catalog rules are immutable'); END;

-- Catalog placeholders only: no legal content or approved applicability is inferred.
INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,description,category,status,created_at,updated_at,created_by)
SELECT 'seed-form-' || w.id || '-' || c.code,w.id,w.id,c.code,c.title,'Draft catalog placeholder; source content requires review.',c.category,'DRAFT','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','SYSTEM'
FROM workspaces w CROSS JOIN (
 SELECT 'JSA-001' AS code,'JSA Risk Assessment' AS title,'Safety' AS category UNION ALL
 SELECT 'ELEC-001','Electrical Certificate','Electrical' UNION ALL
 SELECT 'SMOKE-001','Smoke Alarm Certificate','Smoke Alarm' UNION ALL
 SELECT 'TCA1-001','TCA1','Cabling' UNION ALL
 SELECT 'TCA2-001','TCA2 Non-compliance Notice','Cabling'
) c WHERE w.id IN ('solarcell','smart_home','cctv');
INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by)
SELECT 'seed-rev-' || id,workspace_id,id,'v1.0','DRAFT',created_at,updated_at,'SYSTEM' FROM form_definitions WHERE id LIKE 'seed-form-%';

-- Output configuration belongs to a template revision, never to the form itself.
CREATE TABLE template_revision_output (
  revision_id TEXT PRIMARY KEY REFERENCES template_revisions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  brand_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('Compliance','Terms','Email','Contract')),
  linked_form_revision_id TEXT,
  document_type_id TEXT,
  layout_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(layout_json)),
  dynamic_fields_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(dynamic_fields_json)),
  FOREIGN KEY(workspace_id,linked_form_revision_id) REFERENCES form_revisions(workspace_id,id),
  FOREIGN KEY(workspace_id,document_type_id) REFERENCES document_type_catalog(workspace_id,id)
);
CREATE TRIGGER template_output_insert_guard BEFORE INSERT ON template_revision_output
WHEN NOT EXISTS (SELECT 1 FROM template_revisions r JOIN document_templates t ON t.id=r.template_id WHERE r.id=NEW.revision_id AND t.workspace_id=NEW.workspace_id AND r.status='DRAFT')
 OR (NEW.linked_form_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM form_revisions f JOIN form_definitions d ON d.id=f.form_definition_id AND d.workspace_id=f.workspace_id WHERE f.id=NEW.linked_form_revision_id AND f.workspace_id=NEW.workspace_id AND f.status='PUBLISHED' AND d.brand_id=NEW.brand_id))
 OR (NEW.document_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_type_catalog x WHERE x.id=NEW.document_type_id AND x.workspace_id=NEW.workspace_id AND x.status='PUBLISHED'))
 OR NEW.brand_id<>NEW.workspace_id
BEGIN SELECT RAISE(ABORT,'output requires a draft template and an in-scope published form'); END;
CREATE TRIGGER template_output_update_guard BEFORE UPDATE ON template_revision_output
WHEN (SELECT status FROM template_revisions WHERE id=OLD.revision_id)<>'DRAFT'
 OR NEW.revision_id<>OLD.revision_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.brand_id<>OLD.brand_id
 OR (NEW.linked_form_revision_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM form_revisions f JOIN form_definitions d ON d.id=f.form_definition_id AND d.workspace_id=f.workspace_id WHERE f.id=NEW.linked_form_revision_id AND f.workspace_id=NEW.workspace_id AND f.status='PUBLISHED' AND d.brand_id=NEW.brand_id))
 OR (NEW.document_type_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM document_type_catalog x WHERE x.id=NEW.document_type_id AND x.workspace_id=NEW.workspace_id AND x.status='PUBLISHED'))
BEGIN SELECT RAISE(ABORT,'template output immutable or invalid reference'); END;
CREATE TRIGGER template_output_delete_guard BEFORE DELETE ON template_revision_output
WHEN (SELECT status FROM template_revisions WHERE id=OLD.revision_id)<>'DRAFT'
BEGIN SELECT RAISE(ABORT,'template output immutable outside draft'); END;

-- Workspace-owned document type catalog; publication is an explicit transition.
CREATE TABLE document_type_catalog (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), code TEXT NOT NULL, title TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('DRAFT','REVIEW','PUBLISHED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 created_by TEXT NOT NULL, approved_by TEXT, approved_at TEXT,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,code)
);
CREATE TRIGGER document_type_insert_draft BEFORE INSERT ON document_type_catalog WHEN NEW.status<>'DRAFT'
BEGIN SELECT RAISE(ABORT,'document type must start as draft'); END;
CREATE TRIGGER document_type_immutable BEFORE UPDATE ON document_type_catalog WHEN OLD.status='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'published document type immutable'); END;
CREATE TRIGGER document_type_no_delete BEFORE DELETE ON document_type_catalog WHEN OLD.status='PUBLISHED'
BEGIN SELECT RAISE(ABORT,'published document type immutable'); END;
CREATE TRIGGER document_type_state BEFORE UPDATE ON document_type_catalog
WHEN NOT (NEW.status=OLD.status OR (OLD.status='DRAFT' AND NEW.status='REVIEW') OR (OLD.status='REVIEW' AND NEW.status='PUBLISHED'))
BEGIN SELECT RAISE(ABORT,'invalid document type transition'); END;
CREATE TRIGGER document_type_review_immutable BEFORE UPDATE ON document_type_catalog
WHEN OLD.status='REVIEW' AND (NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.code IS NOT OLD.code OR NEW.title IS NOT OLD.title OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by)
BEGIN SELECT RAISE(ABORT,'review document type immutable'); END;
CREATE TRIGGER document_type_review_no_delete BEFORE DELETE ON document_type_catalog WHEN OLD.status='REVIEW'
BEGIN SELECT RAISE(ABORT,'review document type immutable'); END;

-- Additive immutability guard triggers for published policies and template revisions (closing ownership and metadata gaps in 0012)
CREATE TRIGGER job_type_policy_published_metadata_immutable
BEFORE UPDATE ON job_type_compliance_policies
WHEN OLD.status = 'PUBLISHED'
 AND (NEW.created_by != OLD.created_by
   OR NEW.approved_by != OLD.approved_by
   OR NEW.approved_at != OLD.approved_at
   OR NEW.effective_at != OLD.effective_at
   OR NEW.job_type_id != OLD.job_type_id
   OR NEW.id != OLD.id
   OR NEW.created_at != OLD.created_at)
BEGIN
  SELECT RAISE(ABORT, 'published compliance policy ownership, approval metadata and identity are immutable');
END;

CREATE TRIGGER template_revision_published_metadata_immutable
BEFORE UPDATE ON template_revisions
WHEN OLD.status = 'PUBLISHED'
 AND (NEW.created_by != OLD.created_by
   OR NEW.approved_by != OLD.approved_by
   OR NEW.approved_at != OLD.approved_at
   OR NEW.template_id != OLD.template_id
   OR NEW.id != OLD.id
   OR NEW.created_at != OLD.created_at
   OR NEW.sample_file_name != OLD.sample_file_name)
BEGIN
  SELECT RAISE(ABORT, 'published template revision ownership, approval metadata and identity are immutable');
END;
