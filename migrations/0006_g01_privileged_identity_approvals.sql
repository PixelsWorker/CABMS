-- G01 privileged UID approval history and protected identity.
CREATE TABLE g01_protected_super_admin (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (provider_id = 'firebase'),
  provider_subject_id TEXT NOT NULL CHECK (length(provider_subject_id) BETWEEN 1 AND 128),
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL CHECK (length(trim(assigned_by)) > 0)
);

-- This singleton records the original bootstrap identity, never the current UID.
CREATE TRIGGER g01_protected_super_admin_no_reinsert
BEFORE INSERT ON g01_protected_super_admin
WHEN EXISTS (SELECT 1 FROM g01_protected_super_admin)
BEGIN SELECT RAISE(ABORT, 'protected identity already exists'); END;
CREATE TRIGGER g01_protected_super_admin_no_update
BEFORE UPDATE ON g01_protected_super_admin
BEGIN SELECT RAISE(ABORT, 'protected identity is immutable'); END;

CREATE TRIGGER g01_protected_super_admin_no_delete
BEFORE DELETE ON g01_protected_super_admin
BEGIN SELECT RAISE(ABORT, 'protected authority cannot be deleted'); END;

CREATE TABLE privileged_identity_approvals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_id TEXT NOT NULL CHECK (provider_id = 'firebase'),
  provider_subject_id TEXT NOT NULL CHECK (length(provider_subject_id) BETWEEN 1 AND 128),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'owner_admin')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL CHECK (length(trim(granted_by)) > 0),
  revoked_at TEXT,
  revoked_by TEXT,
  CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR
         (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND length(trim(revoked_by)) > 0))
);

CREATE UNIQUE INDEX g01_one_active_privileged_approval
ON privileged_identity_approvals(user_id, provider_id, provider_subject_id, workspace_id, role)
WHERE revoked_at IS NULL;

CREATE TRIGGER g01_super_admin_approval_requires_protected_identity
BEFORE INSERT ON privileged_identity_approvals
WHEN NEW.role = 'super_admin' AND NOT EXISTS (
  SELECT 1 FROM g01_protected_super_admin p
  WHERE p.singleton = 1 AND p.user_id = NEW.user_id
    AND p.provider_id = NEW.provider_id
    AND NEW.provider_subject_id = COALESCE((SELECT provider_subject_id FROM g01_effective_super_admin_uid), p.provider_subject_id)
)
BEGIN SELECT RAISE(ABORT, 'super admin approval does not match protected identity'); END;

-- REPLACE must not erase approval history through either unique key.
CREATE TRIGGER g01_approval_no_conflict_insert
BEFORE INSERT ON privileged_identity_approvals
WHEN EXISTS (
  SELECT 1 FROM privileged_identity_approvals a WHERE a.id = NEW.id
    OR (NEW.revoked_at IS NULL AND a.revoked_at IS NULL AND a.user_id = NEW.user_id
      AND a.provider_id = NEW.provider_id AND a.provider_subject_id = NEW.provider_subject_id
      AND a.workspace_id = NEW.workspace_id AND a.role = NEW.role)
)
BEGIN SELECT RAISE(ABORT, 'approval history key already exists'); END;

CREATE TRIGGER g01_approval_no_delete
BEFORE DELETE ON privileged_identity_approvals
BEGIN SELECT RAISE(ABORT, 'approval history cannot be deleted'); END;

CREATE TRIGGER g01_approval_revoke_only
BEFORE UPDATE ON privileged_identity_approvals
WHEN OLD.revoked_at IS NOT NULL
  OR NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id
  OR NEW.provider_id IS NOT OLD.provider_id OR NEW.provider_subject_id IS NOT OLD.provider_subject_id
  OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.role IS NOT OLD.role
  OR NEW.granted_at IS NOT OLD.granted_at OR NEW.granted_by IS NOT OLD.granted_by
  OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL
BEGIN SELECT RAISE(ABORT, 'approval may only be revoked once'); END;

-- Constraint-backed assertions must be executed inside the same D1 batch as
-- their protected mutations. This table is not an authorization boundary.
CREATE TABLE g01_security_assertions (
  value INTEGER NOT NULL CHECK (value = 0)
);
