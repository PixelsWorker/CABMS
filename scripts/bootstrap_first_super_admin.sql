-- CABMS G01 — Controlled One-Time Super Admin Operator Bootstrap
--
-- This script enrolls an initial real-world operator Firebase UID as Super Admin across all workspaces.
-- CRITICAL SAFETY GUARANTEE:
-- Guarded by NOT EXISTS to strictly enforce that it can only execute when NO prior operator Super Admin
-- identity mapping exists in the database. Once bootstrapped, subsequent role assignments must occur
-- through authenticated admin workflows, preventing persistent public bootstrap or uninvited takeover.
--
-- Usage:
--   wrangler d1 execute cabms-d1 [--local | --remote] --file ./scripts/bootstrap_first_super_admin.sql

-- 1. Insert operator user record if not present
INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at)
SELECT
  'usr_primary_super_admin',
  'admin@chinedigital.com.au',
  'Primary Super Admin',
  datetime('now'),
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM user_identity_mappings m
  JOIN workspace_memberships wm ON m.user_id = wm.user_id
  WHERE wm.role = 'super_admin' AND m.provider_subject_id NOT LIKE 'firebase_uid_synthetic_%' AND m.provider_subject_id != 'firebase_uid_super_admin'
)
AND 'OPERATOR_FIREBASE_UID_PLACEHOLDER' NOT LIKE 'OPERATOR_FIREBASE_UID_%';

-- 2. Bind external Firebase UID (replace OPERATOR_FIREBASE_UID_PLACEHOLDER with authorized provider UID)
-- Guarded: will only insert if no existing real operator super_admin mapping exists
INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
SELECT
  'map_primary_super_admin',
  'usr_primary_super_admin',
  'firebase',
  'OPERATOR_FIREBASE_UID_PLACEHOLDER',
  datetime('now')
WHERE NOT EXISTS (
  SELECT 1 FROM user_identity_mappings m
  JOIN workspace_memberships wm ON m.user_id = wm.user_id
  WHERE wm.role = 'super_admin' AND m.provider_subject_id NOT LIKE 'firebase_uid_synthetic_%' AND m.provider_subject_id != 'firebase_uid_super_admin'
)
AND 'OPERATOR_FIREBASE_UID_PLACEHOLDER' NOT LIKE 'OPERATOR_FIREBASE_UID_%';

-- 3. Assign super_admin memberships in all three approved operational workspaces
INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
SELECT 'mem_sa_primary_solarcell', 'solarcell', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM user_identity_mappings WHERE id = 'map_primary_super_admin');

INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
SELECT 'mem_sa_primary_smart_home', 'smart_home', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM user_identity_mappings WHERE id = 'map_primary_super_admin');

INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
SELECT 'mem_sa_primary_cctv', 'cctv', 'usr_primary_super_admin', 'super_admin', datetime('now'), datetime('now')
WHERE EXISTS (SELECT 1 FROM user_identity_mappings WHERE id = 'map_primary_super_admin');
