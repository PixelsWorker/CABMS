-- Review proposal only. Apply only to disposable targets until separately authorized.
CREATE TABLE compliance_operations (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL CHECK(action IN ('CREATE','ASSIGN','CANCEL','ADD','SAVE','EVIDENCE','FINDING','SIGN','REQUEST_WITHDRAW','WITHDRAW','COMPLETE')),
 target_id TEXT NOT NULL,
 expected_version INTEGER NOT NULL CHECK(expected_version>=0),
 fingerprint TEXT NOT NULL CHECK(length(fingerprint)=64 AND fingerprint NOT GLOB '*[^0-9a-f]*')
);
CREATE TABLE compliance_receipts (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES compliance_operations(id),
 occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE VIEW compliance_pending_operations AS
 SELECT o.*, m.role FROM compliance_operations o
 JOIN workspace_memberships m ON m.workspace_id=o.workspace_id AND m.user_id=o.actor_id
 JOIN users u ON u.id=o.actor_id AND u.disabled=0
 WHERE NOT EXISTS (SELECT 1 FROM compliance_receipts r WHERE r.operation_id=o.id);

CREATE TABLE compliance_legacy_mappings (
 legacy_rule_id TEXT PRIMARY KEY NOT NULL REFERENCES job_type_required_forms(id),
 workspace_id TEXT NOT NULL,
 revision_id TEXT NOT NULL,
 approved_by TEXT NOT NULL REFERENCES users(id),
 approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES form_revisions(workspace_id,id)
);
CREATE TRIGGER compliance_mapping_scope BEFORE INSERT ON compliance_legacy_mappings
WHEN NOT EXISTS (
 SELECT 1 FROM job_type_required_forms l JOIN job_type_compliance_policies p ON p.id=l.policy_version_id
 JOIN job_types t ON t.id=p.job_type_id AND t.workspace_id=NEW.workspace_id
 JOIN form_revisions r ON r.workspace_id=t.workspace_id AND r.id=NEW.revision_id AND r.status='PUBLISHED'
 JOIN form_definitions f ON f.workspace_id=r.workspace_id AND f.id=r.form_definition_id AND f.brand_id=t.brand_id AND f.status='ACTIVE'
 JOIN workspace_memberships m ON m.workspace_id=t.workspace_id AND m.user_id=NEW.approved_by AND m.role IN ('owner_admin','super_admin')
 JOIN users u ON u.id=m.user_id AND u.disabled=0 WHERE l.id=NEW.legacy_rule_id
) BEGIN SELECT RAISE(ABORT,'FORM_RULE_INVALID'); END;

CREATE TABLE compliance_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 job_type_id TEXT NOT NULL REFERENCES job_types(id),
 policy_id TEXT NOT NULL REFERENCES job_type_compliance_policies(id),
 title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 500),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','CANCELLED','COMPLETED')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 assignee_id TEXT REFERENCES users(id),
 operation_id TEXT NOT NULL REFERENCES compliance_operations(id),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 UNIQUE(workspace_id,id)
);
CREATE INDEX compliance_jobs_dashboard ON compliance_jobs(workspace_id,status,updated_at,id);
CREATE INDEX compliance_jobs_technician ON compliance_jobs(workspace_id,assignee_id,status,updated_at,id);

CREATE TABLE compliance_requirements (
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL CHECK(length(trim(occurrence_key)) BETWEEN 1 AND 200),
 revision_id TEXT NOT NULL,
 origin TEXT NOT NULL CHECK(origin IN ('LEGACY','CATALOG','ADDITIONAL')),
 required INTEGER NOT NULL CHECK(required IN (0,1)),
 reason TEXT,
 operation_id TEXT NOT NULL REFERENCES compliance_operations(id),
 PRIMARY KEY(workspace_id,job_id,occurrence_key),
 FOREIGN KEY(workspace_id,job_id) REFERENCES compliance_jobs(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES form_revisions(workspace_id,id),
 CHECK(origin<>'ADDITIONAL' OR length(trim(coalesce(reason,'')))>0)
);
CREATE TABLE compliance_answers (
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1),
 answers_json TEXT NOT NULL CHECK(json_valid(answers_json) AND json_type(answers_json)='object'),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 PRIMARY KEY(workspace_id,job_id,occurrence_key,version),
 FOREIGN KEY(workspace_id,job_id,occurrence_key) REFERENCES compliance_requirements(workspace_id,job_id,occurrence_key)
);
CREATE TABLE compliance_photo_limits (
 workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id),
 max_bytes INTEGER NOT NULL CHECK(max_bytes>0),
 validated_at TEXT NOT NULL,
 validated_by TEXT NOT NULL REFERENCES users(id),
 max_photos INTEGER NOT NULL DEFAULT 20 CHECK(max_photos=20)
);
CREATE TABLE compliance_evidence (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL,
 answer_version INTEGER NOT NULL,
 byte_length INTEGER NOT NULL CHECK(byte_length>0),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 storage_key TEXT NOT NULL UNIQUE,
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 FOREIGN KEY(workspace_id,job_id,occurrence_key,answer_version) REFERENCES compliance_answers(workspace_id,job_id,occurrence_key,version)
);
CREATE INDEX compliance_evidence_job ON compliance_evidence(workspace_id,job_id);
CREATE TABLE compliance_findings (
 id TEXT PRIMARY KEY NOT NULL,
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 FOREIGN KEY(workspace_id,job_id,occurrence_key) REFERENCES compliance_requirements(workspace_id,job_id,occurrence_key)
);
CREATE INDEX compliance_findings_job ON compliance_findings(workspace_id,job_id);
CREATE TABLE compliance_signoffs (
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL,
 answer_version INTEGER NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
 digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 PRIMARY KEY(workspace_id,job_id,occurrence_key,answer_version),
 FOREIGN KEY(workspace_id,job_id,occurrence_key,answer_version) REFERENCES compliance_answers(workspace_id,job_id,occurrence_key,version)
);
CREATE TABLE compliance_decisions (
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 occurrence_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('WITHDRAW','EXCEPTION')),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 requested_by TEXT NOT NULL REFERENCES users(id),
 later_review INTEGER NOT NULL CHECK(later_review IN (0,1)),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 PRIMARY KEY(workspace_id,job_id,occurrence_key,kind),
 FOREIGN KEY(workspace_id,job_id,occurrence_key) REFERENCES compliance_requirements(workspace_id,job_id,occurrence_key)
);

CREATE VIEW compliance_policy_form_slots AS
 SELECT r.policy_version_id,r.workspace_id,'catalog:'||r.id AS occurrence_key,r.form_revision_id AS revision_id,r.required
 FROM policy_catalog_form_rules r
 UNION ALL
 SELECT l.policy_version_id,t.workspace_id,'legacy:'||l.id,m.revision_id,l.required
 FROM job_type_required_forms l JOIN job_type_compliance_policies p ON p.id=l.policy_version_id
 JOIN job_types t ON t.id=p.job_type_id LEFT JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=t.workspace_id;
CREATE TRIGGER compliance_archive_dependency BEFORE UPDATE OF status ON form_definitions
WHEN NEW.status='ARCHIVED' AND OLD.status IS NOT NEW.status AND EXISTS (
 SELECT 1 FROM form_revisions r WHERE r.workspace_id=OLD.workspace_id AND r.form_definition_id=OLD.id AND (
 EXISTS (SELECT 1 FROM compliance_policy_form_slots s JOIN job_types t ON t.workspace_id=s.workspace_id AND t.current_policy_version_id=s.policy_version_id
 JOIN job_type_compliance_policies p ON p.id=s.policy_version_id AND p.job_type_id=t.id AND p.status='PUBLISHED'
 WHERE t.status='ACTIVE' AND s.workspace_id=r.workspace_id AND s.revision_id=r.id)
 OR EXISTS (SELECT 1 FROM template_revision_output o JOIN template_revisions v ON v.id=o.revision_id AND v.status='PUBLISHED'
 JOIN document_templates t ON t.id=v.template_id AND t.current_revision_id=v.id AND t.status='ACTIVE'
 WHERE o.workspace_id=r.workspace_id AND t.workspace_id=r.workspace_id AND o.linked_form_revision_id=r.id)))
BEGIN SELECT RAISE(ABORT,'FORM_IN_USE'); END;
CREATE TRIGGER compliance_create_job BEFORE INSERT ON compliance_jobs BEGIN
 SELECT CASE WHEN NEW.status<>'OPEN' OR NEW.version<>1 OR NOT EXISTS (
  SELECT 1 FROM compliance_pending_operations o WHERE o.id=NEW.operation_id AND o.workspace_id=NEW.workspace_id AND o.target_id=NEW.id AND o.expected_version=0 AND o.action='CREATE' AND o.role<>'technician'
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM job_types t JOIN job_type_compliance_policies p ON p.job_type_id=t.id AND p.id=t.current_policy_version_id
  WHERE t.id=NEW.job_type_id AND t.workspace_id=NEW.workspace_id AND t.status='ACTIVE' AND p.id=NEW.policy_id AND p.status='PUBLISHED'
 ) THEN RAISE(ABORT,'POLICY_UNAVAILABLE') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM job_type_required_forms l LEFT JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=NEW.workspace_id
  WHERE l.policy_version_id=NEW.policy_id AND l.required=1 AND m.legacy_rule_id IS NULL
 ) THEN RAISE(ABORT,'LEGACY_MAPPING_REQUIRED') END;
 SELECT CASE WHEN NEW.assignee_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id AND u.disabled=0
  WHERE m.user_id=NEW.assignee_id AND m.workspace_id=NEW.workspace_id AND m.role='technician'
 ) THEN RAISE(ABORT,'ASSIGNEE_INELIGIBLE') END;
END;
CREATE TRIGGER compliance_snapshot AFTER INSERT ON compliance_jobs BEGIN
 INSERT INTO compliance_requirements(workspace_id,job_id,occurrence_key,revision_id,origin,required,operation_id)
 SELECT NEW.workspace_id,NEW.id,'legacy:'||l.id,m.revision_id,'LEGACY',l.required,NEW.operation_id
 FROM job_type_required_forms l JOIN compliance_legacy_mappings m ON m.legacy_rule_id=l.id AND m.workspace_id=NEW.workspace_id
 WHERE l.policy_version_id=NEW.policy_id
 UNION ALL
 SELECT NEW.workspace_id,NEW.id,'catalog:'||r.id,r.form_revision_id,'CATALOG',r.required,NEW.operation_id
 FROM policy_catalog_form_rules r WHERE r.policy_version_id=NEW.policy_id AND r.workspace_id=NEW.workspace_id;
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;
CREATE VIEW compliance_audit AS
 SELECT o.*,r.occurred_at FROM compliance_operations o JOIN compliance_receipts r ON r.operation_id=o.id;
CREATE TABLE compliance_resolutions (
 finding_id TEXT PRIMARY KEY NOT NULL REFERENCES compliance_findings(id),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id)
);
CREATE VIEW compliance_active_requirements AS
 SELECT q.* FROM compliance_requirements q
 WHERE NOT EXISTS (SELECT 1 FROM compliance_decisions d WHERE d.workspace_id=q.workspace_id AND d.job_id=q.job_id AND d.occurrence_key=q.occurrence_key AND d.kind='WITHDRAW');
CREATE VIEW compliance_completion_blockers AS
 SELECT q.workspace_id,q.job_id,q.occurrence_key,'SIGNOFF_REQUIRED' AS code FROM compliance_active_requirements q
 WHERE q.required=1 AND NOT EXISTS (
  SELECT 1 FROM compliance_signoffs s WHERE s.workspace_id=q.workspace_id AND s.job_id=q.job_id AND s.occurrence_key=q.occurrence_key AND s.answer_version=(
   SELECT max(a.version) FROM compliance_answers a WHERE a.workspace_id=q.workspace_id AND a.job_id=q.job_id AND a.occurrence_key=q.occurrence_key))
 UNION ALL SELECT j.workspace_id,j.id,s.occurrence_key,'INSTANCE_REQUIRED'
 FROM compliance_jobs j JOIN compliance_policy_form_slots s ON s.policy_version_id=j.policy_id AND s.workspace_id=j.workspace_id
 WHERE s.required=1 AND NOT EXISTS (SELECT 1 FROM compliance_requirements q WHERE q.workspace_id=j.workspace_id AND q.job_id=j.id
 AND q.occurrence_key=s.occurrence_key AND q.revision_id=s.revision_id AND q.required=1 AND q.origin IN ('CATALOG','LEGACY'))
 UNION ALL SELECT f.workspace_id,f.job_id,f.occurrence_key,'UNRESOLVED_FINDING' FROM compliance_findings f
 WHERE NOT EXISTS (SELECT 1 FROM compliance_resolutions r WHERE r.finding_id=f.id);

CREATE TRIGGER compliance_update_job BEFORE UPDATE ON compliance_jobs BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.policy_id IS NOT OLD.policy_id OR NEW.job_type_id IS NOT OLD.job_type_id OR NEW.title IS NOT OLD.title
 THEN RAISE(ABORT,'HISTORY_IMMUTABLE') END;
 SELECT CASE WHEN OLD.status<>'OPEN' THEN RAISE(ABORT,'JOB_STATE_CONFLICT') END;
 SELECT CASE WHEN NEW.version<>OLD.version+1 THEN RAISE(ABORT,'VERSION_CONFLICT') END;
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_pending_operations o WHERE o.id=NEW.operation_id AND o.workspace_id=NEW.workspace_id AND o.target_id=NEW.id AND o.expected_version=OLD.version
  AND o.role<>'technician' AND o.action=CASE NEW.status WHEN 'COMPLETED' THEN 'COMPLETE' WHEN 'CANCELLED' THEN 'CANCEL' ELSE 'ASSIGN' END
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
 SELECT CASE WHEN NEW.status<>'OPEN' AND NEW.assignee_id IS NOT OLD.assignee_id THEN RAISE(ABORT,'JOB_STATE_CONFLICT') END;
 SELECT CASE WHEN NEW.status='OPEN' AND NEW.assignee_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM workspace_memberships m JOIN users u ON u.id=m.user_id AND u.disabled=0
  WHERE m.user_id=NEW.assignee_id AND m.workspace_id=NEW.workspace_id AND m.role='technician'
 ) THEN RAISE(ABORT,'ASSIGNEE_INELIGIBLE') END;
 SELECT CASE WHEN NEW.status='COMPLETED' AND (
  EXISTS (SELECT 1 FROM compliance_completion_blockers b WHERE b.workspace_id=NEW.workspace_id AND b.job_id=NEW.id)
  OR (NOT EXISTS (SELECT 1 FROM compliance_active_requirements q WHERE q.workspace_id=NEW.workspace_id AND q.job_id=NEW.id AND q.required=1)
      AND NOT EXISTS (SELECT 1 FROM job_type_compliance_policies p WHERE p.id=NEW.policy_id AND p.is_direct_to_invoice=1))
 ) THEN RAISE(ABORT,'COMPLETION_BLOCKED') END;
END;
CREATE TRIGGER compliance_job_receipt AFTER UPDATE ON compliance_jobs BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_requirement_guard BEFORE INSERT ON compliance_requirements BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN job_types t ON t.id=j.job_type_id
  JOIN form_revisions r ON r.workspace_id=j.workspace_id AND r.id=NEW.revision_id AND r.status='PUBLISHED'
  JOIN form_definitions f ON f.workspace_id=r.workspace_id AND f.id=r.form_definition_id AND f.brand_id=t.brand_id AND f.status='ACTIVE'
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id AND o.role<>'technician'
  AND ((NEW.origin='ADDITIONAL' AND o.action='ADD' AND o.expected_version=j.version) OR (NEW.origin<>'ADDITIONAL' AND o.action='CREATE' AND j.operation_id=o.id))
 ) THEN RAISE(ABORT,'FORM_RULE_INVALID') END;
END;
CREATE TRIGGER compliance_add_receipt AFTER INSERT ON compliance_requirements WHEN NEW.origin='ADDITIONAL' BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;
CREATE TRIGGER compliance_answer_guard BEFORE INSERT ON compliance_answers BEGIN
 SELECT CASE WHEN NEW.version<>1+coalesce((SELECT max(a.version) FROM compliance_answers a WHERE a.workspace_id=NEW.workspace_id AND a.job_id=NEW.job_id AND a.occurrence_key=NEW.occurrence_key),0) THEN RAISE(ABORT,'VERSION_CONFLICT') END;
END;
CREATE TRIGGER compliance_evidence_guard BEFORE INSERT ON compliance_evidence BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
 OR (SELECT count(*) FROM compliance_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.job_id=NEW.job_id)>=(SELECT max_photos FROM compliance_photo_limits WHERE workspace_id=NEW.workspace_id) THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM compliance_signoffs s WHERE s.workspace_id=NEW.workspace_id AND s.job_id=NEW.job_id AND s.occurrence_key=NEW.occurrence_key AND s.answer_version=NEW.answer_version)
 THEN RAISE(ABORT,'HISTORY_IMMUTABLE') END;
END;
CREATE TRIGGER compliance_signoff_guard BEFORE INSERT ON compliance_signoffs BEGIN
 SELECT CASE WHEN NEW.answer_version IS NOT (SELECT max(a.version) FROM compliance_answers a WHERE a.workspace_id=NEW.workspace_id AND a.job_id=NEW.job_id AND a.occurrence_key=NEW.occurrence_key)
 OR NOT EXISTS(SELECT 1 FROM compliance_answers a WHERE a.workspace_id=NEW.workspace_id AND a.job_id=NEW.job_id AND a.occurrence_key=NEW.occurrence_key AND a.version=NEW.answer_version AND json_type(NEW.snapshot_json,'$.answers')='object'
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(a.answers_json) EXCEPT SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.snapshot_json,'$.answers')))
 AND NOT EXISTS(SELECT fullkey,type,atom FROM json_tree(json_extract(NEW.snapshot_json,'$.answers')) EXCEPT SELECT fullkey,type,atom FROM json_tree(a.answers_json)))
 THEN RAISE(ABORT,'SIGNOFF_BLOCKED') END;
END;
CREATE TABLE compliance_withdraw_requests (
 workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
 reason TEXT NOT NULL CHECK(length(trim(reason))>0),
 operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
 PRIMARY KEY(workspace_id,job_id,occurrence_key),
 FOREIGN KEY(workspace_id,job_id,occurrence_key) REFERENCES compliance_requirements(workspace_id,job_id,occurrence_key)
);
CREATE TRIGGER compliance_request_guard BEFORE INSERT ON compliance_withdraw_requests BEGIN
 SELECT CASE WHEN EXISTS (SELECT 1 FROM compliance_withdraw_requests r WHERE r.operation_id=NEW.operation_id OR
 (r.workspace_id=NEW.workspace_id AND r.job_id=NEW.job_id AND r.occurrence_key=NEW.occurrence_key))
 THEN RAISE(ABORT,'HISTORY_IMMUTABLE') END;
 SELECT CASE WHEN NOT EXISTS (
 SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
 JOIN compliance_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id
 WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND q.occurrence_key=NEW.occurrence_key
 AND q.origin='ADDITIONAL' AND o.id=NEW.operation_id AND o.action='REQUEST_WITHDRAW' AND o.expected_version=j.version
 AND o.role IN ('owner_admin','super_admin','office_staff')) THEN RAISE(ABORT,'EXCEPTION_DENIED') END;
END;
CREATE TRIGGER compliance_request_receipt AFTER INSERT ON compliance_withdraw_requests BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;
CREATE TRIGGER compliance_request_no_update BEFORE UPDATE ON compliance_withdraw_requests BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_request_no_delete BEFORE DELETE ON compliance_withdraw_requests BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_withdraw_guard BEFORE INSERT ON compliance_decisions BEGIN
 SELECT CASE WHEN NEW.kind<>'WITHDRAW' OR NOT EXISTS (
  SELECT 1 FROM compliance_requirements q JOIN compliance_pending_operations o ON o.id=NEW.operation_id
  WHERE q.workspace_id=NEW.workspace_id AND q.job_id=NEW.job_id AND q.occurrence_key=NEW.occurrence_key AND q.origin='ADDITIONAL'
   AND o.role IN ('owner_admin','super_admin')
   AND NOT EXISTS(SELECT 1 FROM compliance_signoffs s WHERE s.workspace_id=q.workspace_id AND s.job_id=q.job_id AND s.occurrence_key=q.occurrence_key)
   AND EXISTS (SELECT 1 FROM compliance_withdraw_requests r JOIN compliance_audit a ON a.id=r.operation_id
    WHERE r.workspace_id=q.workspace_id AND r.job_id=q.job_id AND r.occurrence_key=q.occurrence_key AND a.actor_id=NEW.requested_by)
   AND ((o.actor_id<>NEW.requested_by AND NEW.later_review=0) OR
    (o.actor_id=NEW.requested_by AND o.role='owner_admin' AND NEW.later_review=1 AND
      (SELECT count(*) FROM workspace_memberships m JOIN users u ON u.id=m.user_id AND u.disabled=0 WHERE m.workspace_id=q.workspace_id AND m.role IN ('owner_admin','super_admin'))=1))
 ) THEN RAISE(ABORT,'EXCEPTION_DENIED') END;
END;

CREATE TRIGGER compliance_answers_actor BEFORE INSERT ON compliance_answers BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id AND q.occurrence_key=NEW.occurrence_key
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id
   AND o.expected_version=j.version AND o.action='SAVE'
   AND (o.role<>'technician' OR (o.actor_id=j.assignee_id AND o.action<>'WITHDRAW'))
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
END;
CREATE TRIGGER compliance_answers_receipt AFTER INSERT ON compliance_answers BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_evidence_actor BEFORE INSERT ON compliance_evidence BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id AND q.occurrence_key=NEW.occurrence_key
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id
   AND o.expected_version=j.version AND o.action='EVIDENCE'
   AND (o.role<>'technician' OR (o.actor_id=j.assignee_id AND o.action<>'WITHDRAW'))
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
END;
CREATE TRIGGER compliance_evidence_receipt AFTER INSERT ON compliance_evidence BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_findings_actor BEFORE INSERT ON compliance_findings BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id AND q.occurrence_key=NEW.occurrence_key
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id
   AND o.expected_version=j.version AND o.action='FINDING'
   AND (o.role<>'technician' OR (o.actor_id=j.assignee_id AND o.action<>'WITHDRAW'))
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
END;
CREATE TRIGGER compliance_findings_receipt AFTER INSERT ON compliance_findings BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_signoffs_actor BEFORE INSERT ON compliance_signoffs BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id AND q.occurrence_key=NEW.occurrence_key
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id
   AND o.expected_version=j.version AND o.action='SIGN'
   AND (o.role<>'technician' OR (o.actor_id=j.assignee_id AND o.action<>'WITHDRAW'))
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
END;
CREATE TRIGGER compliance_signoffs_receipt AFTER INSERT ON compliance_signoffs BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_decisions_actor BEFORE INSERT ON compliance_decisions BEGIN
 SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM compliance_jobs j JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
  JOIN compliance_active_requirements q ON q.workspace_id=j.workspace_id AND q.job_id=j.id AND q.occurrence_key=NEW.occurrence_key
  WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN' AND o.id=NEW.operation_id
   AND o.expected_version=j.version AND o.action='WITHDRAW'
   AND (o.role<>'technician' OR (o.actor_id=j.assignee_id AND o.action<>'WITHDRAW'))
 ) THEN RAISE(ABORT,'ACTION_DENIED') END;
END;
CREATE TRIGGER compliance_decisions_receipt AFTER INSERT ON compliance_decisions BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;
CREATE TRIGGER compliance_operations_no_update BEFORE UPDATE ON compliance_operations BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_operations_no_delete BEFORE DELETE ON compliance_operations BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_receipts_no_update BEFORE UPDATE ON compliance_receipts BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_receipts_no_delete BEFORE DELETE ON compliance_receipts BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_legacy_mappings_no_update BEFORE UPDATE ON compliance_legacy_mappings BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_legacy_mappings_no_delete BEFORE DELETE ON compliance_legacy_mappings BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_requirements_no_update BEFORE UPDATE ON compliance_requirements BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_requirements_no_delete BEFORE DELETE ON compliance_requirements BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_answers_no_update BEFORE UPDATE ON compliance_answers BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_answers_no_delete BEFORE DELETE ON compliance_answers BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_evidence_no_update BEFORE UPDATE ON compliance_evidence BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_evidence_no_delete BEFORE DELETE ON compliance_evidence BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_findings_no_update BEFORE UPDATE ON compliance_findings BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_findings_no_delete BEFORE DELETE ON compliance_findings BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_resolutions_no_update BEFORE UPDATE ON compliance_resolutions BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_resolutions_no_delete BEFORE DELETE ON compliance_resolutions BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_signoffs_no_update BEFORE UPDATE ON compliance_signoffs BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_signoffs_no_delete BEFORE DELETE ON compliance_signoffs BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_decisions_no_update BEFORE UPDATE ON compliance_decisions BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_decisions_no_delete BEFORE DELETE ON compliance_decisions BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_jobs_no_delete BEFORE DELETE ON compliance_jobs BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
-- Prevent reparenting a draft legacy rule into a frozen policy.
CREATE TRIGGER compliance_legacy_rule_frozen_destination BEFORE UPDATE OF policy_version_id ON job_type_required_forms
WHEN EXISTS (SELECT 1 FROM job_type_compliance_policies p WHERE p.id=NEW.policy_version_id AND p.status='PUBLISHED')
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_resolution_guard BEFORE INSERT ON compliance_resolutions
WHEN NOT EXISTS (
 SELECT 1 FROM compliance_findings f JOIN compliance_jobs j ON j.workspace_id=f.workspace_id AND j.id=f.job_id
 JOIN compliance_pending_operations o ON o.workspace_id=j.workspace_id AND o.target_id=j.id
 WHERE f.id=NEW.finding_id AND j.status='OPEN' AND o.expected_version=j.version AND o.action='FINDING' AND o.id=NEW.operation_id AND o.role IN ('owner_admin','super_admin')
) BEGIN SELECT RAISE(ABORT,'ACTION_DENIED'); END;
CREATE TRIGGER compliance_resolution_receipt AFTER INSERT ON compliance_resolutions BEGIN
 INSERT INTO compliance_receipts(operation_id) VALUES(NEW.operation_id);
END;

CREATE TRIGGER compliance_legacy_mappings_no_replace BEFORE INSERT ON compliance_legacy_mappings
WHEN EXISTS (SELECT 1 FROM compliance_legacy_mappings old WHERE (old.legacy_rule_id=NEW.legacy_rule_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_jobs_no_replace BEFORE INSERT ON compliance_jobs
WHEN EXISTS (SELECT 1 FROM compliance_jobs old WHERE (old.id=NEW.id))
BEGIN SELECT RAISE(ABORT,'RECORD_CONFLICT'); END;

CREATE TRIGGER compliance_requirements_no_replace BEFORE INSERT ON compliance_requirements
WHEN EXISTS (SELECT 1 FROM compliance_requirements old WHERE (old.workspace_id=NEW.workspace_id AND old.job_id=NEW.job_id AND old.occurrence_key=NEW.occurrence_key))
BEGIN SELECT RAISE(ABORT,'FORM_ALREADY_ASSIGNED'); END;

CREATE TRIGGER compliance_answers_no_replace BEFORE INSERT ON compliance_answers
WHEN EXISTS (SELECT 1 FROM compliance_answers old WHERE (old.workspace_id=NEW.workspace_id AND old.job_id=NEW.job_id AND old.occurrence_key=NEW.occurrence_key AND old.version=NEW.version) OR (old.operation_id=NEW.operation_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_evidence_no_replace BEFORE INSERT ON compliance_evidence
WHEN EXISTS (SELECT 1 FROM compliance_evidence old WHERE (old.id=NEW.id) OR (old.operation_id=NEW.operation_id) OR (old.storage_key=NEW.storage_key))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_findings_no_replace BEFORE INSERT ON compliance_findings
WHEN EXISTS (SELECT 1 FROM compliance_findings old WHERE (old.id=NEW.id) OR (old.operation_id=NEW.operation_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_resolutions_no_replace BEFORE INSERT ON compliance_resolutions
WHEN EXISTS (SELECT 1 FROM compliance_resolutions old WHERE (old.finding_id=NEW.finding_id) OR (old.operation_id=NEW.operation_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_signoffs_no_replace BEFORE INSERT ON compliance_signoffs
WHEN EXISTS (SELECT 1 FROM compliance_signoffs old WHERE (old.workspace_id=NEW.workspace_id AND old.job_id=NEW.job_id AND old.occurrence_key=NEW.occurrence_key AND old.answer_version=NEW.answer_version) OR (old.operation_id=NEW.operation_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_decisions_no_replace BEFORE INSERT ON compliance_decisions
WHEN EXISTS (SELECT 1 FROM compliance_decisions old WHERE (old.workspace_id=NEW.workspace_id AND old.job_id=NEW.job_id AND old.occurrence_key=NEW.occurrence_key AND old.kind=NEW.kind) OR (old.operation_id=NEW.operation_id))
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_operations_no_replace BEFORE INSERT ON compliance_operations
WHEN EXISTS (SELECT 1 FROM compliance_operations WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'IDEMPOTENCY_KEY_REUSED'); END;

CREATE TRIGGER compliance_receipts_no_replace BEFORE INSERT ON compliance_receipts
WHEN EXISTS (SELECT 1 FROM compliance_receipts WHERE operation_id=NEW.operation_id)
BEGIN SELECT RAISE(ABORT,'OPERATION_UNCONFIRMED'); END;

ALTER TABLE workspace_settings ADD COLUMN contract_threshold_cents INTEGER NOT NULL DEFAULT 330000 CHECK(typeof(contract_threshold_cents)='integer' AND contract_threshold_cents>=0 AND contract_threshold_cents<=9007199254740991);

CREATE TABLE compliance_staff_role_changes (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 user_id TEXT NOT NULL REFERENCES users(id), actor_id TEXT NOT NULL REFERENCES users(id),
 previous_role TEXT NOT NULL CHECK(previous_role IN ('office_staff','technician')),
 next_role TEXT NOT NULL CHECK(next_role IN ('office_staff','technician') AND next_role<>previous_role),
 occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TRIGGER compliance_staff_role_apply AFTER INSERT ON compliance_staff_role_changes BEGIN
 UPDATE workspace_memberships SET role=NEW.next_role,updated_at=NEW.occurred_at
 WHERE workspace_id=NEW.workspace_id AND user_id=NEW.user_id AND role=NEW.previous_role
 AND NOT EXISTS(SELECT 1 FROM g01_protected_super_admin WHERE user_id=NEW.user_id)
 AND EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND disabled=0);
 SELECT CASE WHEN changes()<>1 THEN RAISE(ABORT,'ROLE_CONFLICT') END;
END;
CREATE TRIGGER compliance_staff_role_no_update BEFORE UPDATE ON compliance_staff_role_changes BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_staff_role_no_delete BEFORE DELETE ON compliance_staff_role_changes BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_staff_role_no_replace BEFORE INSERT ON compliance_staff_role_changes
WHEN EXISTS(SELECT 1 FROM compliance_staff_role_changes WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TABLE compliance_uploads (
 id TEXT PRIMARY KEY NOT NULL, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id), job_version INTEGER NOT NULL, answer_version INTEGER NOT NULL,
 media_type TEXT NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp')),
 byte_length INTEGER NOT NULL CHECK(byte_length>0), digest TEXT NOT NULL CHECK(length(digest)=64),
 FOREIGN KEY(workspace_id,job_id,occurrence_key,answer_version) REFERENCES compliance_answers(workspace_id,job_id,occurrence_key,version)
);
CREATE INDEX compliance_upload_scope ON compliance_uploads(workspace_id,job_id,occurrence_key,actor_id);
CREATE TRIGGER compliance_upload_capacity BEFORE INSERT ON compliance_uploads BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
 OR (SELECT count(*) FROM compliance_uploads u WHERE u.job_id=NEW.job_id AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=u.id))>=20
 THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
END;

CREATE TABLE compliance_job_byte_limits (
 workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES compliance_photo_limits(workspace_id),
 max_job_bytes INTEGER NOT NULL CHECK(max_job_bytes>0)
);
CREATE TRIGGER compliance_total_evidence_bytes BEFORE INSERT ON compliance_evidence
WHEN EXISTS(SELECT 1 FROM compliance_job_byte_limits l WHERE l.workspace_id=NEW.workspace_id AND
 NEW.byte_length+coalesce((SELECT sum(e.byte_length) FROM compliance_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.job_id=NEW.job_id),0)>l.max_job_bytes)
BEGIN SELECT RAISE(ABORT,'EVIDENCE_INVALID'); END;

CREATE TRIGGER compliance_upload_immutable BEFORE UPDATE ON compliance_uploads
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_upload_no_replace BEFORE INSERT ON compliance_uploads
WHEN EXISTS(SELECT 1 FROM compliance_uploads WHERE id=NEW.id)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;
CREATE TRIGGER compliance_verified_upload_retained BEFORE DELETE ON compliance_uploads
WHEN EXISTS(SELECT 1 FROM compliance_evidence WHERE id=OLD.id)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TABLE compliance_signer_grants (
 workspace_id TEXT NOT NULL, revision_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id),
 PRIMARY KEY(workspace_id,revision_id,user_id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES form_revisions(workspace_id,id)
);
