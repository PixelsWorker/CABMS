-- CABMS C1 — Migration 0012: Templates & Content Management System
-- Job types, compliance policies, required form rules, document templates and revisions

CREATE TABLE IF NOT EXISTS job_types (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT,
  brand_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DRAFT')) DEFAULT 'ACTIVE',
  current_policy_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE(workspace_id, code)
);

CREATE TABLE IF NOT EXISTS job_type_compliance_policies (
  id TEXT PRIMARY KEY NOT NULL,
  job_type_id TEXT NOT NULL REFERENCES job_types(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')) DEFAULT 'DRAFT',
  is_direct_to_invoice INTEGER NOT NULL DEFAULT 0 CHECK (is_direct_to_invoice IN (0, 1)),
  completion_rule TEXT NOT NULL DEFAULT 'ALL_MANDATORY_FORMS_SIGNED',
  effective_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  UNIQUE(job_type_id, version)
);

CREATE TABLE IF NOT EXISTS job_type_required_forms (
  id TEXT PRIMARY KEY NOT NULL,
  policy_version_id TEXT NOT NULL REFERENCES job_type_compliance_policies(id) ON DELETE CASCADE,
  form_type TEXT NOT NULL CHECK (form_type IN ('JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2')),
  required INTEGER NOT NULL DEFAULT 1 CHECK (required IN (0, 1)),
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(policy_version_id, form_type)
);

CREATE TABLE IF NOT EXISTS document_templates (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  template_type TEXT NOT NULL CHECK (template_type IN ('QUOTE_TERMS', 'INVOICE_TERMS', 'COMPLIANCE_DISCLAIMER', 'EMAIL_COVER')),
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'ARCHIVED', 'DRAFT')) DEFAULT 'ACTIVE',
  current_revision_id TEXT,
  sample_file_name TEXT,
  mapping_status TEXT NOT NULL DEFAULT 'Mapped',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  updated_by TEXT,
  UNIQUE(workspace_id, code)
);

CREATE TABLE IF NOT EXISTS template_revisions (
  id TEXT PRIMARY KEY NOT NULL,
  template_id TEXT NOT NULL REFERENCES document_templates(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED')) DEFAULT 'DRAFT',
  content TEXT NOT NULL,
  sample_file_name TEXT,
  effective_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  approved_by TEXT,
  approved_at TEXT,
  UNIQUE(template_id, version)
);

-- Immutability triggers for published compliance policies
CREATE TRIGGER job_type_policy_no_update_published
BEFORE UPDATE ON job_type_compliance_policies
WHEN OLD.status = 'PUBLISHED'
 AND (NEW.version != OLD.version
   OR NEW.is_direct_to_invoice != OLD.is_direct_to_invoice
   OR NEW.completion_rule != OLD.completion_rule
   OR NEW.status = 'DRAFT'
   OR NEW.status = 'REVIEW')
BEGIN
  SELECT RAISE(ABORT, 'published compliance policies are immutable and cannot be edited or downgraded');
END;

CREATE TRIGGER job_type_policy_no_delete_published
BEFORE DELETE ON job_type_compliance_policies
WHEN OLD.status = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'published compliance policies cannot be deleted');
END;

-- Immutability triggers for published template revisions
CREATE TRIGGER template_revision_no_update_published
BEFORE UPDATE ON template_revisions
WHEN OLD.status = 'PUBLISHED'
 AND (NEW.version != OLD.version
   OR NEW.content != OLD.content
   OR NEW.status = 'DRAFT'
   OR NEW.status = 'REVIEW')
BEGIN
  SELECT RAISE(ABORT, 'published template revisions are immutable and cannot be edited or downgraded');
END;

CREATE TRIGGER template_revision_no_delete_published
BEFORE DELETE ON template_revisions
WHEN OLD.status = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'published template revisions cannot be deleted');
END;

-- Required forms cannot be modified if parent policy is published
CREATE TRIGGER required_form_no_update_published
BEFORE UPDATE ON job_type_required_forms
WHEN (SELECT status FROM job_type_compliance_policies WHERE id = OLD.policy_version_id) = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'required forms on published compliance policies cannot be modified');
END;

CREATE TRIGGER required_form_no_delete_published
BEFORE DELETE ON job_type_required_forms
WHEN (SELECT status FROM job_type_compliance_policies WHERE id = OLD.policy_version_id) = 'PUBLISHED'
BEGIN
  SELECT RAISE(ABORT, 'required forms on published compliance policies cannot be deleted');
END;

-- Seed Solarcell Job Types & Templates
INSERT OR IGNORE INTO job_types (id, workspace_id, code, name, description, brand_id, status, current_policy_version_id, created_at, updated_at, created_by, updated_by) VALUES
('jt-solar-install', 'solarcell', 'solar_pv_install', '10kW Commercial Solar PV System', 'Standard commercial rooftop solar installation with safety signoff and electrical certs.', 'solarcell', 'ACTIVE', 'pol-solar-install-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('jt-inverter-rep', 'solarcell', 'inverter_replacement', 'Inverter Replacement & Grid Recommissioning', 'Solar inverter swap-out, test and recommission.', 'solarcell', 'ACTIVE', 'pol-inverter-rep-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('jt-solar-service', 'solarcell', 'solar_panel_clean_inspect', 'Solar Panel Clean & Inspection', 'Routine direct-to-invoice solar maintenance.', 'solarcell', 'ACTIVE', 'pol-solar-service-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM');

INSERT OR IGNORE INTO job_type_compliance_policies (id, job_type_id, version, status, is_direct_to_invoice, completion_rule, effective_at, created_at, updated_at, created_by, approved_by, approved_at) VALUES
('pol-solar-install-v1', 'jt-solar-install', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('pol-inverter-rep-v1', 'jt-inverter-rep', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('pol-solar-service-v1', 'jt-solar-service', 'v1.0', 'PUBLISHED', 1, 'NONE', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z');

INSERT OR IGNORE INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order) VALUES
('rf-sol-1', 'pol-solar-install-v1', 'JSA', 1, 1),
('rf-sol-2', 'pol-solar-install-v1', 'ELECTRICAL', 1, 2),
('rf-sol-3', 'pol-solar-install-v1', 'TCA2', 1, 3),
('rf-inv-1', 'pol-inverter-rep-v1', 'JSA', 1, 1),
('rf-inv-2', 'pol-inverter-rep-v1', 'ELECTRICAL', 1, 2);

-- Seed Smart Home Job Types & Templates
INSERT OR IGNORE INTO job_types (id, workspace_id, code, name, description, brand_id, status, current_policy_version_id, created_at, updated_at, created_by, updated_by) VALUES
('jt-automation-hub', 'smart_home', 'smart_hub_setup', 'Smart Automation Hub & Wiring Integration', 'Central smart home controller configuration.', 'smart_home', 'ACTIVE', 'pol-automation-hub-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('jt-smoke-safety', 'smart_home', 'smoke_alarm_compliance', 'Interconnected Smoke Alarm Safety Cert', 'QLD 2022 legislation compliant photoelectric smoke alarm inspection.', 'smart_home', 'ACTIVE', 'pol-smoke-safety-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM');

INSERT OR IGNORE INTO job_type_compliance_policies (id, job_type_id, version, status, is_direct_to_invoice, completion_rule, effective_at, created_at, updated_at, created_by, approved_by, approved_at) VALUES
('pol-automation-hub-v1', 'jt-automation-hub', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('pol-smoke-safety-v1', 'jt-smoke-safety', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z');

INSERT OR IGNORE INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order) VALUES
('rf-sh-1', 'pol-automation-hub-v1', 'JSA', 1, 1),
('rf-sh-2', 'pol-automation-hub-v1', 'ELECTRICAL', 1, 2),
('rf-sh-3', 'pol-automation-hub-v1', 'TCA1', 1, 3),
('rf-sm-1', 'pol-smoke-safety-v1', 'JSA', 1, 1),
('rf-sm-2', 'pol-smoke-safety-v1', 'SMOKE_ALARM', 1, 2);

-- Seed CCTV Job Types & Templates
INSERT OR IGNORE INTO job_types (id, workspace_id, code, name, description, brand_id, status, current_policy_version_id, created_at, updated_at, created_by, updated_by) VALUES
('jt-cctv-enterprise', 'cctv', 'commercial_cctv_deployment', 'Commercial IP CCTV & NVR Deployment', 'Enterprise NVR and multi-camera security surveillance cabling.', 'cctv', 'ACTIVE', 'pol-cctv-enterprise-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('jt-intercom-access', 'cctv', 'access_control_intercom', 'Access Control & Video Intercom Setup', 'Electronic strike, key fob reader and video intercom setup.', 'cctv', 'ACTIVE', 'pol-intercom-access-v1', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM');

INSERT OR IGNORE INTO job_type_compliance_policies (id, job_type_id, version, status, is_direct_to_invoice, completion_rule, effective_at, created_at, updated_at, created_by, approved_by, approved_at) VALUES
('pol-cctv-enterprise-v1', 'jt-cctv-enterprise', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('pol-intercom-access-v1', 'jt-intercom-access', 'v1.0', 'PUBLISHED', 0, 'ALL_MANDATORY_FORMS_SIGNED', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z');

INSERT OR IGNORE INTO job_type_required_forms (id, policy_version_id, form_type, required, display_order) VALUES
('rf-cc-1', 'pol-cctv-enterprise-v1', 'JSA', 1, 1),
('rf-cc-2', 'pol-cctv-enterprise-v1', 'TCA1', 1, 2),
('rf-cc-3', 'pol-cctv-enterprise-v1', 'TCA2', 1, 3),
('rf-ia-1', 'pol-intercom-access-v1', 'JSA', 1, 1),
('rf-ia-2', 'pol-intercom-access-v1', 'TCA1', 1, 2);

-- Seed Document Templates
INSERT OR IGNORE INTO document_templates (id, workspace_id, code, name, template_type, description, status, current_revision_id, sample_file_name, mapping_status, created_at, updated_at, created_by, updated_by) VALUES
('tpl-solar-quote', 'solarcell', 'terms_solar_standard', 'Standard Solar Quote Terms & Conditions', 'QUOTE_TERMS', 'Mandatory 10-year workmanship warranty and grid connection terms.', 'ACTIVE', 'rev-solar-quote-v1', 'solar-quote-terms-2026.docx', 'Mapped', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('tpl-solar-inv', 'solarcell', 'inv_terms_solar', 'Solar Payment Terms & Warranties', 'INVOICE_TERMS', '14-day commercial payment schedule and STC rebate terms.', 'ACTIVE', 'rev-solar-inv-v1', 'solar-invoice-terms-2026.docx', 'Mapped', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('tpl-smarthome-quote', 'smart_home', 'terms_smarthome', 'Smart Home Automation SLA & Warranty', 'QUOTE_TERMS', 'Equipment warranty and ongoing configuration support clauses.', 'ACTIVE', 'rev-sh-quote-v1', 'smarthome-quote-terms.docx', 'Mapped', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM'),
('tpl-cctv-quote', 'cctv', 'terms_cctv_enterprise', 'Enterprise Security & Cabling Warranty', 'QUOTE_TERMS', 'Commercial CCTV hardware and ACMA cabling certification warranties.', 'ACTIVE', 'rev-cctv-quote-v1', 'cctv-enterprise-terms.docx', 'Mapped', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'SYSTEM');

INSERT OR IGNORE INTO template_revisions (id, template_id, version, status, content, sample_file_name, effective_at, created_at, updated_at, created_by, approved_by, approved_at) VALUES
('rev-solar-quote-v1', 'tpl-solar-quote', 'v1.0', 'PUBLISHED', 'All solar installations include a 10-year workmanship warranty and 25-year panel performance guarantee. Grid connection subject to Energex approval.', 'solar-quote-terms-2026.docx', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('rev-solar-inv-v1', 'tpl-solar-inv', 'v1.0', 'PUBLISHED', 'Payment due within 14 days of commercial sign-off and certificate of electrical safety dispatch.', 'solar-invoice-terms-2026.docx', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('rev-sh-quote-v1', 'tpl-smarthome-quote', 'v1.0', 'PUBLISHED', 'Home automation systems include 12 months complimentary firmware and remote tuning support.', 'smarthome-quote-terms.docx', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z'),
('rev-cctv-quote-v1', 'tpl-cctv-quote', 'v1.0', 'PUBLISHED', 'Enterprise security hardware is covered by manufacturer advance replacement. Cabling certified under ACMA AS/CA S009.', 'cctv-enterprise-terms.docx', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z', 'SYSTEM', 'OWNER_ADMIN', '2026-10-28T00:00:00.000Z');
