-- Independent bootstrap closure and append-only protected identity recovery.
CREATE TABLE g01_bootstrap_completion (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  original_firebase_uid TEXT NOT NULL CHECK (length(trim(original_firebase_uid)) BETWEEN 1 AND 128 AND original_firebase_uid = trim(original_firebase_uid)),
  completed_at TEXT NOT NULL CHECK (length(trim(completed_at)) > 0),
  completed_by TEXT NOT NULL CHECK (length(trim(completed_by)) > 0),
  operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
  request_id TEXT NOT NULL UNIQUE CHECK (length(trim(request_id)) > 0),
  audit_reference TEXT NOT NULL UNIQUE CHECK (length(trim(audit_reference)) > 0)
);

CREATE TRIGGER g01_bootstrap_no_reinsert BEFORE INSERT ON g01_bootstrap_completion
WHEN EXISTS (SELECT 1 FROM g01_bootstrap_completion)
BEGIN SELECT RAISE(ABORT, 'bootstrap completion already exists'); END;
CREATE TRIGGER g01_bootstrap_identity_consistency BEFORE INSERT ON g01_bootstrap_completion
WHEN NOT EXISTS (SELECT 1 FROM g01_protected_super_admin p WHERE p.singleton = 1 AND p.provider_id = 'firebase' AND p.provider_subject_id = NEW.original_firebase_uid)
BEGIN SELECT RAISE(ABORT, 'bootstrap identity mismatch'); END;
CREATE TRIGGER g01_bootstrap_no_update BEFORE UPDATE ON g01_bootstrap_completion
BEGIN SELECT RAISE(ABORT, 'bootstrap completion is immutable'); END;
CREATE TRIGGER g01_bootstrap_no_delete BEFORE DELETE ON g01_bootstrap_completion
BEGIN SELECT RAISE(ABORT, 'bootstrap completion is immutable'); END;

CREATE TABLE g01_super_admin_recovery_events (
  seq INTEGER NOT NULL UNIQUE CHECK (typeof(seq) = 'integer' AND seq > 0),
  previous_seq INTEGER NOT NULL CHECK (typeof(previous_seq) = 'integer' AND previous_seq >= 0),
  operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
  request_id TEXT NOT NULL UNIQUE CHECK (length(trim(request_id)) > 0),
  prior_uid TEXT NOT NULL CHECK (length(trim(prior_uid)) BETWEEN 1 AND 128 AND prior_uid = trim(prior_uid)),
  replacement_uid TEXT NOT NULL CHECK (length(trim(replacement_uid)) BETWEEN 1 AND 128 AND replacement_uid = trim(replacement_uid)),
  operator_identity TEXT NOT NULL CHECK (length(trim(operator_identity)) > 0),
  reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  occurred_at TEXT NOT NULL CHECK (length(trim(occurred_at)) > 0),
  bootstrap_operation_id TEXT NOT NULL CHECK (length(trim(bootstrap_operation_id)) > 0),
  audit_reference TEXT NOT NULL UNIQUE CHECK (length(trim(audit_reference)) > 0)
);

-- Explicitly reject all existing unique keys before SQLite can apply any
-- conflict policy, including REPLACE, IGNORE or an UPSERT conflict action.
CREATE TRIGGER g01_recovery_validate BEFORE INSERT ON g01_super_admin_recovery_events
BEGIN
  SELECT CASE WHEN NEW.seq IS NULL OR typeof(NEW.seq) <> 'integer' OR NEW.seq <= 0
    OR NEW.previous_seq IS NULL OR typeof(NEW.previous_seq) <> 'integer' OR NEW.previous_seq < 0
    OR NEW.operation_id IS NULL OR length(trim(NEW.operation_id)) = 0
    OR NEW.request_id IS NULL OR length(trim(NEW.request_id)) = 0
    OR NEW.audit_reference IS NULL OR length(trim(NEW.audit_reference)) = 0
    OR NEW.prior_uid IS NULL OR length(trim(NEW.prior_uid)) NOT BETWEEN 1 AND 128 OR NEW.prior_uid <> trim(NEW.prior_uid)
    OR NEW.replacement_uid IS NULL OR length(trim(NEW.replacement_uid)) NOT BETWEEN 1 AND 128 OR NEW.replacement_uid <> trim(NEW.replacement_uid)
    OR NEW.operator_identity IS NULL OR length(trim(NEW.operator_identity)) = 0
    OR NEW.reason IS NULL OR length(trim(NEW.reason)) = 0
    OR NEW.occurred_at IS NULL OR length(trim(NEW.occurred_at)) = 0
    OR NEW.bootstrap_operation_id IS NULL OR length(trim(NEW.bootstrap_operation_id)) = 0
    THEN RAISE(ABORT, 'invalid recovery data') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM g01_super_admin_recovery_events e
    WHERE e.seq = NEW.seq OR e.operation_id = NEW.operation_id OR e.request_id = NEW.request_id OR e.audit_reference = NEW.audit_reference)
    OR EXISTS (SELECT 1 FROM g01_bootstrap_completion b WHERE b.operation_id = NEW.operation_id OR b.request_id = NEW.request_id OR b.audit_reference = NEW.audit_reference)
    THEN RAISE(ABORT, 'recovery replay key already exists') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM g01_bootstrap_completion b WHERE b.operation_id = NEW.bootstrap_operation_id)
    THEN RAISE(ABORT, 'bootstrap reference missing') END;
  SELECT CASE WHEN NEW.seq <> COALESCE((SELECT MAX(seq) FROM g01_super_admin_recovery_events), 0) + 1
    OR NEW.previous_seq <> COALESCE((SELECT MAX(seq) FROM g01_super_admin_recovery_events), 0)
    THEN RAISE(ABORT, 'invalid recovery sequence') END;
  SELECT CASE WHEN NEW.prior_uid IS NOT COALESCE(
    (SELECT replacement_uid FROM g01_super_admin_recovery_events ORDER BY seq DESC LIMIT 1),
    (SELECT original_firebase_uid FROM g01_bootstrap_completion WHERE singleton = 1))
    THEN RAISE(ABORT, 'invalid prior uid') END;
  SELECT CASE WHEN NEW.replacement_uid = NEW.prior_uid
    OR EXISTS (SELECT 1 FROM g01_bootstrap_completion WHERE original_firebase_uid = NEW.replacement_uid)
    OR EXISTS (SELECT 1 FROM g01_super_admin_recovery_events WHERE prior_uid = NEW.replacement_uid OR replacement_uid = NEW.replacement_uid)
    THEN RAISE(ABORT, 'recovery uid cannot be reused') END;
END;
CREATE TRIGGER g01_recovery_no_update BEFORE UPDATE ON g01_super_admin_recovery_events
BEGIN SELECT RAISE(ABORT, 'recovery history is immutable'); END;
CREATE TRIGGER g01_recovery_no_delete BEFORE DELETE ON g01_super_admin_recovery_events
BEGIN SELECT RAISE(ABORT, 'recovery history is immutable'); END;

-- This view expresses the identity chain only. Authorization still requires
-- a verified token, active user, mapping, membership and UID approval.
CREATE VIEW g01_effective_super_admin_uid AS
SELECT COALESCE((SELECT replacement_uid FROM g01_super_admin_recovery_events ORDER BY seq DESC LIMIT 1), original_firebase_uid) AS provider_subject_id
FROM g01_bootstrap_completion WHERE singleton = 1;
