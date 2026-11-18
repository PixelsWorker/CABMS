-- CABMS G01 / PAAR-P0 — Migration 0011: Immutable Bootstrap Audit Manifest Ledger
--
-- Preserves canonical signed approval manifest bytes, Ed25519 cryptographic signature,
-- signing key ID, independent unique nonce, unique operation ID, and execution provenance.
-- Provides trigger-enforced completion prerequisite and strict immutability.

CREATE TABLE IF NOT EXISTS paar_p0_bootstrap_audit_manifests (
  id TEXT PRIMARY KEY NOT NULL,
  operation_id TEXT NOT NULL UNIQUE CHECK (length(trim(operation_id)) > 0),
  nonce TEXT NOT NULL UNIQUE CHECK (length(trim(nonce)) > 0),
  target_id TEXT NOT NULL CHECK (length(trim(target_id)) > 0),
  operator_email TEXT NOT NULL CHECK (length(trim(operator_email)) > 0),
  operator_uid TEXT NOT NULL CHECK (length(trim(operator_uid)) BETWEEN 1 AND 128),
  workspace_scope TEXT NOT NULL CHECK (length(trim(workspace_scope)) > 0),
  permitted_action TEXT NOT NULL CHECK (permitted_action = 'bootstrap_super_admin'),
  signing_key_id TEXT NOT NULL CHECK (length(trim(signing_key_id)) > 0),
  signature_algorithm TEXT NOT NULL CHECK (signature_algorithm = 'Ed25519'),
  signature_bytes TEXT NOT NULL CHECK (length(trim(signature_bytes)) > 0),
  canonical_manifest_json TEXT NOT NULL CHECK (length(trim(canonical_manifest_json)) > 0),
  audit_reference TEXT NOT NULL UNIQUE CHECK (length(trim(audit_reference)) > 0),
  created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0)
);

-- Immutability triggers: audit manifests can never be updated, deleted, or replaced
CREATE TRIGGER IF NOT EXISTS paar_p0_audit_no_update
BEFORE UPDATE ON paar_p0_bootstrap_audit_manifests
BEGIN
  SELECT RAISE(ABORT, 'audit manifest records are immutable');
END;

CREATE TRIGGER IF NOT EXISTS paar_p0_audit_no_delete
BEFORE DELETE ON paar_p0_bootstrap_audit_manifests
BEGIN
  SELECT RAISE(ABORT, 'audit manifest records cannot be deleted');
END;

-- Explicit BEFORE INSERT conflict rejection trigger:
-- Blocks INSERT OR REPLACE, INSERT OR IGNORE, and conflicting UPSERT
-- regardless of whether PRAGMA recursive_triggers is OFF or ON.
CREATE TRIGGER IF NOT EXISTS paar_p0_audit_no_insert_conflict
BEFORE INSERT ON paar_p0_bootstrap_audit_manifests
WHEN EXISTS (
  SELECT 1 FROM paar_p0_bootstrap_audit_manifests
  WHERE id = NEW.id
     OR operation_id = NEW.operation_id
     OR nonce = NEW.nonce
     OR audit_reference = NEW.audit_reference
)
BEGIN
  SELECT RAISE(ABORT, 'audit manifest records cannot be replaced or inserted with conflicting unique keys');
END;

-- Completion prerequisite trigger:
-- Completion record cannot be inserted unless a matching audit manifest row already exists.
CREATE TRIGGER IF NOT EXISTS paar_p0_completion_requires_audit
BEFORE INSERT ON g01_bootstrap_completion
WHEN NOT EXISTS (
  SELECT 1 FROM paar_p0_bootstrap_audit_manifests a
  WHERE a.operation_id = NEW.operation_id
    AND a.audit_reference = NEW.audit_reference
    AND a.operator_uid = NEW.original_firebase_uid
)
BEGIN
  SELECT RAISE(ABORT, 'bootstrap completion requires matching pre-inserted audit manifest');
END;
