-- PROPOSAL ONLY: do not apply without exact-file and environment approvals.
-- Mandatory operator collision inventory is described in G01-SYNTHETIC-IDENTITY-PROPOSAL.md.
-- The exact IDs below must not have been repurposed; stop if they have.
UPDATE users SET disabled = 1, status_updated_at = datetime('now')
WHERE id IN ('usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician');
DELETE FROM workspace_memberships
WHERE user_id IN ('usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician');
DELETE FROM user_identity_mappings
WHERE provider_id = 'firebase'
  AND user_id IN ('usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician');
