-- DRAFT ONLY: not a registered migration. Requires review and exact-file approval.
-- Forward-only additional triggers preserve existing 0012/0013 bytes and existing data.
CREATE TRIGGER job_type_policy_published_metadata_nullsafe
BEFORE UPDATE ON job_type_compliance_policies
WHEN OLD.status='PUBLISHED' AND (
 NEW.created_by IS NOT OLD.created_by OR NEW.approved_by IS NOT OLD.approved_by OR
 NEW.approved_at IS NOT OLD.approved_at OR NEW.effective_at IS NOT OLD.effective_at OR
 NEW.job_type_id IS NOT OLD.job_type_id OR NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at
)
BEGIN SELECT RAISE(ABORT,'published policy metadata immutable'); END;

CREATE TRIGGER template_revision_published_metadata_nullsafe
BEFORE UPDATE ON template_revisions
WHEN OLD.status='PUBLISHED' AND (
 NEW.created_by IS NOT OLD.created_by OR NEW.approved_by IS NOT OLD.approved_by OR
 NEW.approved_at IS NOT OLD.approved_at OR NEW.effective_at IS NOT OLD.effective_at OR NEW.template_id IS NOT OLD.template_id OR
 NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at OR
 NEW.sample_file_name IS NOT OLD.sample_file_name
)
BEGIN SELECT RAISE(ABORT,'published template metadata immutable'); END;

CREATE TRIGGER job_type_required_forms_published_insert_guard
BEFORE INSERT ON job_type_required_forms
WHEN EXISTS (SELECT 1 FROM job_type_compliance_policies WHERE id=NEW.policy_version_id AND status='PUBLISHED')
BEGIN SELECT RAISE(ABORT,'published policy forms immutable'); END;
