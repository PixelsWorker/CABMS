-- Proposed only. Existing jobs predate the staff-entered customer and site snapshot.
ALTER TABLE compliance_jobs ADD COLUMN customer_name TEXT
 CHECK(customer_name IS NULL OR length(trim(customer_name)) BETWEEN 1 AND 200);
ALTER TABLE compliance_jobs ADD COLUMN site_address TEXT
 CHECK(site_address IS NULL OR length(trim(site_address)) BETWEEN 1 AND 500);
ALTER TABLE compliance_visit_events ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60
 CHECK(typeof(duration_minutes)='integer' AND duration_minutes BETWEEN 1 AND 1440);

CREATE TRIGGER compliance_job_site_snapshot_create BEFORE INSERT ON compliance_jobs
WHEN NEW.customer_name IS NULL OR NEW.site_address IS NULL
BEGIN SELECT RAISE(ABORT,'INVALID_FIELD'); END;

CREATE TRIGGER compliance_job_site_snapshot_immutable BEFORE UPDATE ON compliance_jobs
WHEN OLD.customer_name IS NOT NEW.customer_name OR OLD.site_address IS NOT NEW.site_address
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_visit_events_no_update BEFORE UPDATE ON compliance_visit_events
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_visit_events_no_delete BEFORE DELETE ON compliance_visit_events
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_visit_events_no_replace BEFORE INSERT ON compliance_visit_events
WHEN EXISTS(
 SELECT 1 FROM compliance_visit_events v WHERE v.workspace_id=NEW.workspace_id AND
 ((v.visit_id=NEW.visit_id AND v.version=NEW.version) OR (v.actor_id=NEW.actor_id AND v.operation_key=NEW.operation_key))
)
BEGIN SELECT RAISE(ABORT,'HISTORY_IMMUTABLE'); END;

CREATE TRIGGER compliance_visit_assignee BEFORE INSERT ON compliance_visit_events
WHEN NEW.status='SCHEDULED' AND NOT EXISTS(
 SELECT 1 FROM compliance_jobs j JOIN workspace_memberships m
   ON m.workspace_id=j.workspace_id AND m.user_id=j.assignee_id
 JOIN users u ON u.id=m.user_id
 WHERE j.workspace_id=NEW.workspace_id AND j.id=NEW.job_id AND j.status='OPEN'
 AND j.assignee_id=NEW.technician_id AND u.disabled=0 AND m.role='technician'
)
BEGIN SELECT RAISE(ABORT,'VISIT_ASSIGNEE_MISMATCH'); END;

CREATE TRIGGER compliance_job_visit_assignee BEFORE UPDATE ON compliance_jobs
WHEN OLD.assignee_id IS NOT NEW.assignee_id AND EXISTS(
 SELECT 1 FROM compliance_visit_events v
 WHERE v.workspace_id=OLD.workspace_id AND v.job_id=OLD.id AND v.status='SCHEDULED'
 AND v.technician_id IS NOT NEW.assignee_id
 AND NOT EXISTS(SELECT 1 FROM compliance_visit_events h
   WHERE h.workspace_id=v.workspace_id AND h.visit_id=v.visit_id AND h.version>v.version)
)
BEGIN SELECT RAISE(ABORT,'SCHEDULED_VISIT_ASSIGNMENT_CONFLICT'); END;

CREATE TRIGGER compliance_withdraw_open_finding BEFORE INSERT ON compliance_decisions
WHEN EXISTS(
 SELECT 1 FROM compliance_findings f WHERE f.workspace_id=NEW.workspace_id AND f.job_id=NEW.job_id
 AND f.occurrence_key=NEW.occurrence_key
 AND NOT EXISTS(SELECT 1 FROM compliance_resolutions r WHERE r.finding_id=f.id)
)
BEGIN SELECT RAISE(ABORT,'FINDING_RESOLUTION_REQUIRED'); END;
