-- CABMS G01 / PAAR-P0 — Retired Legacy Super Admin Bootstrap Script
--
-- RETIREMENT NOTICE:
-- This script has been retired and made permanently fail-closed.
-- Privileged first Super Admin enrollment must be performed exclusively via the
-- PAAR-P0 Mode A authorized runner (scripts/p0/firstSuperAdminCli.ts / scripts/p0/firstSuperAdminEnrollment.ts),
-- backed by migration 0011 immutable audit ledger (WITHOUT ROWID).
--
-- Executing this script always fails closed and unconditionally aborts:
-- on schemas with g01_security_assertions (migration 0006+) it fails with a CHECK constraint failure;
-- on pre-0006 schemas it fails with "no such table: g01_security_assertions".
-- In all cases, it performs ZERO insertions into users, user_identity_mappings, workspace_memberships,
-- or paar_p0_bootstrap_audit_manifests.

INSERT INTO g01_security_assertions (value)
VALUES (1);
