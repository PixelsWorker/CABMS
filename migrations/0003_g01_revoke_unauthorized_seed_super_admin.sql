-- CABMS G01 Migration 0003: Revoke Unauthorized Seed Super Admin Grants
-- Schema migration 0003: Compensating revocation of synthetic/accidental seed super_admin grants
-- Preserves the user record ('usr_chine_super_admin') to maintain foreign-key and audit log referential integrity

-- 1. Remove any workspace memberships granting super_admin or other roles to the seed user
DELETE FROM workspace_memberships WHERE user_id = 'usr_chine_super_admin';

-- 2. Remove any provider identity mappings linked to the seed user
DELETE FROM user_identity_mappings WHERE user_id = 'usr_chine_super_admin';

-- 3. Update existing seed user email to synthetic address if previously seeded with real address
UPDATE users
SET email = 'admin@chine.example.invalid', updated_at = datetime('now')
WHERE id = 'usr_chine_super_admin' AND email = 'admin@chinedigital.com.au';
