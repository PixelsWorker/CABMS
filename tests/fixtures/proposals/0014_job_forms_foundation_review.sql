-- DRAFT REVIEW PROPOSAL ONLY: 0014 persistent job/form foundation.
-- Not registered as a migration. Never apply to a persistent database without
-- exact-file approval and separate execution authorization. Does not implement
-- verified signing, evidence, waivers, or completion of jobs requiring forms.
-- Create job and all inherited forms in the SAME D1 batch/transaction. The API
-- must authenticate, authorize, assign actors, and check affected-row counts.

CREATE TABLE cabms_jobs (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 brand_id TEXT NOT NULL,
 job_type_id TEXT NOT NULL REFERENCES job_types(id),
 policy_id TEXT NOT NULL REFERENCES job_type_compliance_policies(id),
 customer_reference TEXT,
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','IN_PROGRESS','COMPLETED','CANCELLED')),
 assigned_technician_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id),
 completed_at TEXT, completed_by TEXT REFERENCES users(id),
 cancelled_at TEXT, cancelled_by TEXT REFERENCES users(id), cancellation_reason TEXT,
 UNIQUE(workspace_id,id),
 CHECK((status='COMPLETED' AND completed_at IS NOT NULL AND completed_by IS NOT NULL) OR (status<>'COMPLETED' AND completed_at IS NULL AND completed_by IS NULL)),
 CHECK((status='CANCELLED' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND length(trim(coalesce(cancellation_reason,'')))>0) OR (status<>'CANCELLED' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL))
);
CREATE TRIGGER cabms_job_create_guard BEFORE INSERT ON cabms_jobs BEGIN
 SELECT CASE WHEN NEW.status<>'OPEN' OR NOT EXISTS (
  SELECT 1 FROM job_types j JOIN job_type_compliance_policies p ON p.id=j.current_policy_version_id AND p.job_type_id=j.id
  WHERE j.id=NEW.job_type_id AND j.workspace_id=NEW.workspace_id AND j.brand_id=NEW.brand_id AND j.status='ACTIVE' AND p.id=NEW.policy_id AND p.status='PUBLISHED'
 ) THEN RAISE(ABORT,'job requires active published workspace policy') END;
 -- No inferred mapping from legacy codes to unreviewed 0013 draft placeholders.
 SELECT CASE WHEN EXISTS (SELECT 1 FROM job_type_required_forms WHERE policy_version_id=NEW.policy_id AND required=1)
  THEN RAISE(ABORT,'legacy mandatory requirements require approved mapping') END;
END;
CREATE TRIGGER cabms_job_identity_guard BEFORE UPDATE ON cabms_jobs
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.brand_id IS NOT OLD.brand_id OR NEW.job_type_id IS NOT OLD.job_type_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by
BEGIN SELECT RAISE(ABORT,'job identity and policy immutable'); END;
CREATE TRIGGER cabms_job_terminal_guard BEFORE UPDATE ON cabms_jobs
WHEN OLD.status IN ('COMPLETED','CANCELLED')
BEGIN SELECT RAISE(ABORT,'terminal job immutable'); END;
CREATE TRIGGER cabms_job_transition_guard BEFORE UPDATE OF status ON cabms_jobs
WHEN NOT (NEW.status=OLD.status OR (OLD.status='OPEN' AND NEW.status IN ('IN_PROGRESS','COMPLETED','CANCELLED')) OR (OLD.status='IN_PROGRESS' AND NEW.status IN ('COMPLETED','CANCELLED')))
BEGIN SELECT RAISE(ABORT,'invalid job transition'); END;
CREATE TRIGGER cabms_job_no_delete BEFORE DELETE ON cabms_jobs BEGIN SELECT RAISE(ABORT,'job history cannot be deleted'); END;

CREATE TABLE cabms_job_forms (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL,
 form_revision_id TEXT NOT NULL, policy_rule_id TEXT REFERENCES policy_catalog_form_rules(id),
 origin TEXT NOT NULL CHECK(origin IN ('POLICY','ADDITIONAL')),
 required INTEGER NOT NULL CHECK(required IN (0,1)),
 answers_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(answers_json) AND json_type(answers_json)='object'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
 updated_at TEXT NOT NULL, updated_by TEXT NOT NULL REFERENCES users(id),
 UNIQUE(workspace_id,id), UNIQUE(job_id,policy_rule_id), UNIQUE(job_id,form_revision_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES cabms_jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,form_revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TRIGGER cabms_job_form_create_guard BEFORE INSERT ON cabms_job_forms BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM cabms_jobs j JOIN form_revisions r ON r.id=NEW.form_revision_id AND r.workspace_id=j.workspace_id AND r.status='PUBLISHED' JOIN form_definitions f ON f.id=r.form_definition_id AND f.workspace_id=r.workspace_id AND f.brand_id=j.brand_id AND f.status='ACTIVE' WHERE j.id=NEW.job_id AND j.workspace_id=NEW.workspace_id AND j.status IN ('OPEN','IN_PROGRESS')) THEN RAISE(ABORT,'invalid job form scope') END;
 SELECT CASE WHEN (NEW.origin='POLICY' AND NOT EXISTS (SELECT 1 FROM cabms_jobs j JOIN policy_catalog_form_rules c ON c.policy_version_id=j.policy_id AND c.workspace_id=j.workspace_id WHERE j.id=NEW.job_id AND j.workspace_id=NEW.workspace_id AND c.id=NEW.policy_rule_id AND c.form_revision_id=NEW.form_revision_id AND c.required=NEW.required)) OR (NEW.origin='ADDITIONAL' AND NEW.policy_rule_id IS NOT NULL) THEN RAISE(ABORT,'invalid policy form reference') END;
END;
CREATE TRIGGER cabms_job_form_update_guard BEFORE UPDATE ON cabms_job_forms
WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.job_id IS NOT OLD.job_id OR NEW.form_revision_id IS NOT OLD.form_revision_id OR NEW.policy_rule_id IS NOT OLD.policy_rule_id OR NEW.origin IS NOT OLD.origin OR NEW.required IS NOT OLD.required OR NEW.created_at IS NOT OLD.created_at OR NEW.created_by IS NOT OLD.created_by OR NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM cabms_jobs j WHERE j.id=OLD.job_id AND j.workspace_id=OLD.workspace_id AND j.status IN ('OPEN','IN_PROGRESS'))
BEGIN SELECT RAISE(ABORT,'invalid job form update'); END;
CREATE TRIGGER cabms_job_form_no_delete BEFORE DELETE ON cabms_job_forms BEGIN SELECT RAISE(ABORT,'job form history cannot be deleted'); END;

-- Immutable audit facts. API authenticates actors and supplies reason for changes;
-- triggers record inserts and modifications, including direct SQL changes.
CREATE TABLE cabms_job_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('JOB_CREATED','JOB_UPDATED','FORM_ADDED','FORM_UPDATED')),
 form_id TEXT, actor_id TEXT NOT NULL REFERENCES users(id), occurred_at TEXT NOT NULL,
 details_json TEXT NOT NULL CHECK(json_valid(details_json) AND json_type(details_json)='object'),
 FOREIGN KEY(workspace_id,job_id) REFERENCES cabms_jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,form_id) REFERENCES cabms_job_forms(workspace_id,id)
);
CREATE TRIGGER cabms_job_event_created AFTER INSERT ON cabms_jobs BEGIN
 INSERT INTO cabms_job_events(workspace_id,job_id,event_type,actor_id,occurred_at,details_json) VALUES(NEW.workspace_id,NEW.id,'JOB_CREATED',NEW.created_by,NEW.created_at,json_object('policy_id',NEW.policy_id));
END;
CREATE TRIGGER cabms_job_event_updated AFTER UPDATE ON cabms_jobs BEGIN
 INSERT INTO cabms_job_events(workspace_id,job_id,event_type,actor_id,occurred_at,details_json) VALUES(NEW.workspace_id,NEW.id,'JOB_UPDATED',NEW.updated_by,NEW.updated_at,json_object('old_status',OLD.status,'new_status',NEW.status,'old_assignee',OLD.assigned_technician_id,'new_assignee',NEW.assigned_technician_id,'cancellation_reason',NEW.cancellation_reason));
END;
CREATE TRIGGER cabms_form_event_created AFTER INSERT ON cabms_job_forms BEGIN
 INSERT INTO cabms_job_events(workspace_id,job_id,event_type,form_id,actor_id,occurred_at,details_json) VALUES(NEW.workspace_id,NEW.job_id,'FORM_ADDED',NEW.id,NEW.created_by,NEW.created_at,json_object('origin',NEW.origin,'required',NEW.required,'revision',NEW.form_revision_id));
END;
CREATE TRIGGER cabms_form_event_updated AFTER UPDATE ON cabms_job_forms BEGIN
 INSERT INTO cabms_job_events(workspace_id,job_id,event_type,form_id,actor_id,occurred_at,details_json) VALUES(NEW.workspace_id,NEW.job_id,'FORM_UPDATED',NEW.id,NEW.updated_by,NEW.updated_at,json_object('old_version',OLD.version,'new_version',NEW.version));
END;
CREATE TRIGGER cabms_event_no_update BEFORE UPDATE ON cabms_job_events BEGIN SELECT RAISE(ABORT,'job events immutable'); END;
CREATE TRIGGER cabms_event_no_delete BEFORE DELETE ON cabms_job_events BEGIN SELECT RAISE(ABORT,'job events immutable'); END;

-- Fail closed: completion of jobs with any form is unavailable until a later
-- reviewed migration and API enforce validated answers, signatures and evidence.
-- Only published direct-to-invoice policies with zero catalog/legacy rules and
-- zero job forms can complete under this foundation.
CREATE TRIGGER cabms_job_completion_guard BEFORE UPDATE OF status ON cabms_jobs
WHEN NEW.status='COMPLETED' BEGIN
 SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM job_type_compliance_policies p WHERE p.id=NEW.policy_id AND p.is_direct_to_invoice=1)
  OR EXISTS (SELECT 1 FROM policy_catalog_form_rules c WHERE c.workspace_id=NEW.workspace_id AND c.policy_version_id=NEW.policy_id)
  OR EXISTS (SELECT 1 FROM job_type_required_forms f WHERE f.policy_version_id=NEW.policy_id)
  OR EXISTS (SELECT 1 FROM cabms_job_forms f WHERE f.workspace_id=NEW.workspace_id AND f.job_id=NEW.id)
 THEN RAISE(ABORT,'completion requires verified form workflow') END;
END;
-- SQLite executes this trigger inside the job INSERT statement: a rejected form
-- rolls the job and its audit entries back. IDs are length-prefixed to avoid
-- ambiguous concatenation. Historical revisions remain pinned to the job.
CREATE TRIGGER cabms_job_inherit_policy_forms AFTER INSERT ON cabms_jobs BEGIN
 INSERT INTO cabms_job_forms(id,workspace_id,job_id,form_revision_id,policy_rule_id,origin,required,created_at,created_by,updated_at,updated_by)
 SELECT 'policy:' || length(NEW.id) || ':' || NEW.id || ':' || c.id,NEW.workspace_id,NEW.id,c.form_revision_id,c.id,'POLICY',c.required,NEW.created_at,NEW.created_by,NEW.updated_at,NEW.updated_by
 FROM policy_catalog_form_rules c WHERE c.workspace_id=NEW.workspace_id AND c.policy_version_id=NEW.policy_id ORDER BY c.display_order,c.id;
END;
