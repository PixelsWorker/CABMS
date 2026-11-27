-- CABMS Forward Migration Proposal 0018: Independent Review Remediation Candidate
-- Scopes upload capacity to active answer version and supports verified evidence carry-forward for corrections.

PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS compliance_upload_capacity;
DROP TRIGGER IF EXISTS compliance_verified_upload_retained;
DROP TRIGGER IF EXISTS compliance_evidence_guard;
DROP TRIGGER IF EXISTS compliance_evidence_no_replace;
DROP TRIGGER IF EXISTS compliance_total_evidence_bytes;
DROP TRIGGER IF EXISTS compliance_evidence_actor;
DROP TRIGGER IF EXISTS compliance_evidence_receipt;
DROP TRIGGER IF EXISTS compliance_evidence_no_update;
DROP TRIGGER IF EXISTS compliance_evidence_no_delete;

CREATE TABLE compliance_evidence_v2 (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  occurrence_key TEXT NOT NULL,
  answer_version INTEGER NOT NULL,
  byte_length INTEGER NOT NULL CHECK(byte_length>0),
  digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
  storage_key TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE REFERENCES compliance_operations(id),
  UNIQUE(workspace_id, job_id, occurrence_key, answer_version, storage_key),
  FOREIGN KEY(workspace_id,job_id,occurrence_key,answer_version) REFERENCES compliance_answers(workspace_id,job_id,occurrence_key,version)
);

INSERT INTO compliance_evidence_v2 SELECT * FROM compliance_evidence;
DROP TABLE compliance_evidence;
ALTER TABLE compliance_evidence_v2 RENAME TO compliance_evidence;
CREATE INDEX IF NOT EXISTS compliance_evidence_job ON compliance_evidence(workspace_id,job_id);

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

CREATE TRIGGER compliance_evidence_no_update BEFORE UPDATE ON compliance_evidence BEGIN
 SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;

CREATE TRIGGER compliance_evidence_no_delete BEFORE DELETE ON compliance_evidence BEGIN
 SELECT RAISE(ABORT,'HISTORY_IMMUTABLE');
END;

CREATE TRIGGER compliance_upload_capacity BEFORE INSERT ON compliance_uploads BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
  OR (SELECT count(*) FROM compliance_uploads u WHERE u.job_id=NEW.job_id AND u.answer_version=NEW.answer_version AND NOT EXISTS(SELECT 1 FROM compliance_evidence e WHERE e.id=u.id))>=20
  THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
END;

CREATE TRIGGER compliance_verified_upload_retained BEFORE DELETE ON compliance_uploads
WHEN EXISTS(SELECT 1 FROM compliance_evidence WHERE id=OLD.id)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_evidence_guard BEFORE INSERT ON compliance_evidence BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM compliance_photo_limits l WHERE l.workspace_id=NEW.workspace_id AND NEW.byte_length<=l.max_bytes)
  OR (
    NOT EXISTS(SELECT 1 FROM compliance_evidence exist WHERE exist.workspace_id=NEW.workspace_id AND exist.job_id=NEW.job_id AND exist.storage_key=NEW.storage_key)
    AND (SELECT count(DISTINCT e.storage_key) FROM compliance_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.job_id=NEW.job_id)>=(SELECT max_photos FROM compliance_photo_limits WHERE workspace_id=NEW.workspace_id)
  ) THEN RAISE(ABORT,'EVIDENCE_INVALID') END;
  SELECT CASE WHEN EXISTS(SELECT 1 FROM compliance_signoffs s WHERE s.workspace_id=NEW.workspace_id AND s.job_id=NEW.job_id AND s.occurrence_key=NEW.occurrence_key AND s.answer_version=NEW.answer_version)
  THEN RAISE(ABORT,'HISTORY_IMMUTABLE') END;
END;

CREATE TRIGGER compliance_evidence_no_replace BEFORE INSERT ON compliance_evidence
WHEN EXISTS (SELECT 1 FROM compliance_evidence old WHERE
  old.id=NEW.id
  OR old.operation_id=NEW.operation_id
  OR (old.storage_key=NEW.storage_key AND old.workspace_id=NEW.workspace_id AND old.job_id=NEW.job_id AND old.occurrence_key=NEW.occurrence_key AND old.answer_version=NEW.answer_version)
  OR (old.storage_key=NEW.storage_key AND (old.workspace_id!=NEW.workspace_id OR old.job_id!=NEW.job_id OR old.occurrence_key!=NEW.occurrence_key))
)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_total_evidence_bytes BEFORE INSERT ON compliance_evidence
WHEN EXISTS(SELECT 1 FROM compliance_job_byte_limits l WHERE l.workspace_id=NEW.workspace_id AND
  (CASE WHEN EXISTS(SELECT 1 FROM compliance_evidence exist WHERE exist.workspace_id=NEW.workspace_id AND exist.job_id=NEW.job_id AND exist.storage_key=NEW.storage_key) THEN 0 ELSE NEW.byte_length END) +
  coalesce((SELECT sum(max_b) FROM (SELECT max(e.byte_length) as max_b FROM compliance_evidence e WHERE e.workspace_id=NEW.workspace_id AND e.job_id=NEW.job_id GROUP BY e.storage_key)), 0) > l.max_job_bytes)
BEGIN SELECT RAISE(ABORT,'EVIDENCE_INVALID'); END;

PRAGMA foreign_keys = ON;
