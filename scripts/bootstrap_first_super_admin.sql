-- CABMS G01 / PAAR-P0 — Retired Legacy Super Admin Bootstrap Script
--
-- RETIREMENT NOTICE:
-- This script has been retired and made permanently fail-closed.
-- Privileged first Super Admin enrollment must be performed exclusively via the
-- PAAR-P0 authorized runner (scripts/p0/firstSuperAdminEnrollment.ts).
--
-- Executing this script always fails closed and unconditionally aborts:
-- on schemas with g01_security_assertions (migration 0006+) it fails with a CHECK constraint failure;
-- on pre-0006 schemas it fails with "no such table: g01_security_assertions".
-- In all cases, it performs ZERO insertions into users, user_identity_mappings, or workspace_memberships.

INSERT INTO g01_security_assertions (value)
VALUES (1);
