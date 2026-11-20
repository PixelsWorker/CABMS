-- REVIEW CANDIDATE ONLY. Not a registered migration; never run against persistent D1.
-- App authorization, transactional creation and verified signing are still required.
CREATE TABLE cabms_jobs (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 brand_id TEXT NOT NULL,
 job_type_id TEXT NOT NULL REFERENCES job_types(id),
 policy_id TEXT NOT NULL REFERENCES job_type_compliance_policies(id),
 customer_reference TEXT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED')),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 completed_at TEXT,
 completed_by TEXT REFERENCES users(id),
 UNIQUE(workspace_id,id)
);
CREATE TRIGGER cabms_job_create_guard BEFORE INSERT ON cabms_jobs
BEGIN
 SELECT CASE WHEN NEW.status<>'OPEN' OR NEW.completed_at IS NOT NULL OR NEW.completed_by IS NOT NULL
  THEN RAISE(ABORT,'job must start open') END;
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM job_types j JOIN job_type_compliance_policies p ON p.id=j.current_policy_version_id AND p.job_type_id=j.id
  WHERE j.id=NEW.job_type_id AND j.workspace_id=NEW.workspace_id AND j.brand_id=NEW.brand_id AND j.status='ACTIVE' AND p.id=NEW.policy_id AND p.status='PUBLISHED')
  THEN RAISE(ABORT,'job requires the active workspace policy') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM job_type_required_forms WHERE policy_version_id=NEW.policy_id AND required=1)
  THEN RAISE(ABORT,'legacy mandatory form mapping required') END;
END;
CREATE TRIGGER cabms_job_identity_immutable BEFORE UPDATE ON cabms_jobs
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.brand_id IS NOT OLD.brand_id OR NEW.job_type_id IS NOT OLD.job_type_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT,'job ownership and policy immutable'); END;
CREATE TRIGGER cabms_job_completed_immutable BEFORE UPDATE ON cabms_jobs
WHEN OLD.status='COMPLETED' BEGIN SELECT RAISE(ABORT,'completed job immutable'); END;
CREATE TRIGGER cabms_job_no_delete BEFORE DELETE ON cabms_jobs
BEGIN SELECT RAISE(ABORT,'job history cannot be deleted'); END;

CREATE TABLE cabms_job_forms (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 form_revision_id TEXT NOT NULL,
 policy_rule_id TEXT REFERENCES policy_catalog_form_rules(id),
 origin TEXT NOT NULL CHECK(origin IN ('POLICY','ADDITIONAL')),
 answers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(answers_json) AND json_type(answers_json)='object'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,id), UNIQUE(job_id,policy_rule_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES cabms_jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,form_revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TRIGGER cabms_job_form_insert_guard BEFORE INSERT ON cabms_job_forms
BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cabms_jobs j JOIN form_revisions r ON r.id=NEW.form_revision_id AND r.workspace_id=j.workspace_id AND r.status='PUBLISHED' JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id AND f.brand_id=j.brand_id
  WHERE j.id=NEW.job_id AND j.workspace_id=NEW.workspace_id AND j.status='OPEN') THEN RAISE(ABORT,'invalid job form scope') END;
 SELECT CASE WHEN (NEW.origin='POLICY' AND NOT EXISTS (SELECT 1 FROM cabms_jobs j JOIN policy_catalog_form_rules c ON c.policy_version_id=j.policy_id AND c.workspace_id=j.workspace_id WHERE j.id=NEW.job_id AND j.workspace_id=NEW.workspace_id AND c.id=NEW.policy_rule_id AND c.form_revision_id=NEW.form_revision_id)) OR (NEW.origin='ADDITIONAL' AND NEW.policy_rule_id IS NOT NULL)
  THEN RAISE(ABORT,'invalid policy form reference') END;
END;
CREATE TRIGGER cabms_job_form_identity_immutable BEFORE UPDATE ON cabms_job_forms
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.job_id IS NOT OLD.job_id OR NEW.form_revision_id IS NOT OLD.form_revision_id OR NEW.policy_rule_id IS NOT OLD.policy_rule_id OR NEW.origin IS NOT OLD.origin OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by OR NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM cabms_jobs j WHERE j.id=OLD.job_id AND j.workspace_id=OLD.workspace_id AND j.status='OPEN')
BEGIN SELECT RAISE(ABORT,'invalid job form update'); END;
CREATE TRIGGER cabms_job_form_no_delete BEFORE DELETE ON cabms_job_forms
BEGIN SELECT RAISE(ABORT,'job form history cannot be deleted'); END;

CREATE TABLE cabms_job_form_signatures (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 job_form_id TEXT NOT NULL,
 form_version INTEGER NOT NULL CHECK(form_version>0),
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
 snapshot_sha256 TEXT NOT NULL CHECK(length(snapshot_sha256)=64),
 signer_id TEXT NOT NULL REFERENCES users(id),
 signed_at TEXT NOT NULL,
 FOREIGN KEY(workspace_id,job_form_id) REFERENCES cabms_job_forms(workspace_id,id)
);
CREATE TRIGGER cabms_signature_insert_guard BEFORE INSERT ON cabms_job_form_signatures
WHEN NOT EXISTS (SELECT 1 FROM cabms_job_forms f JOIN cabms_jobs j ON j.id=f.job_id AND j.workspace_id=f.workspace_id WHERE f.id=NEW.job_form_id AND f.workspace_id=NEW.workspace_id AND f.version=NEW.form_version AND j.status='OPEN' AND json_type(NEW.snapshot_json,'$.answers')='object' AND json_extract(NEW.snapshot_json,'$.answers')=json(f.answers_json))
BEGIN SELECT RAISE(ABORT,'signature requires current open form'); END;
CREATE TRIGGER cabms_signature_no_update BEFORE UPDATE ON cabms_job_form_signatures BEGIN SELECT RAISE(ABORT,'signed snapshots immutable'); END;
CREATE TRIGGER cabms_signature_no_delete BEFORE DELETE ON cabms_job_form_signatures BEGIN SELECT RAISE(ABORT,'signed snapshots immutable'); END;
CREATE TRIGGER cabms_job_complete_guard BEFORE UPDATE OF status ON cabms_jobs
WHEN NEW.status='COMPLETED'
BEGIN
 SELECT CASE WHEN NEW.completed_at IS NULL OR NEW.completed_by IS NULL THEN RAISE(ABORT,'completion metadata required') END;
 SELECT CASE WHEN EXISTS (SELECT 1 FROM policy_catalog_form_rules c WHERE c.workspace_id=NEW.workspace_id AND c.policy_version_id=NEW.policy_id AND c.required=1 AND NOT EXISTS (SELECT 1 FROM cabms_job_forms f JOIN cabms_job_form_signatures s ON s.workspace_id=f.workspace_id AND s.job_form_id=f.id AND s.form_version=f.version WHERE f.workspace_id=NEW.workspace_id AND f.job_id=NEW.id AND f.policy_rule_id=c.id AND f.form_revision_id=c.form_revision_id)) THEN RAISE(ABORT,'mandatory form unsigned') END;
END;
