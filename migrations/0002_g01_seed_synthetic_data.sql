-- CABMS G01 Seed Synthetic Data (Cloudflare D1 / SQLite)
-- Schema migration 0002: Seed three approved synthetic workspaces, settings, legal issuers, users and memberships

-- Seed the 3 synthetic workspaces
INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES
('solarcell', 'Solarcell', 'solarcell', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('smart_home', 'Smart Home Solutions', 'smart-home', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('cctv', 'Gold Coast CCTV', 'cctv', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');

-- Seed workspace settings
INSERT OR IGNORE INTO workspace_settings (
  workspace_id, trading_name, tagline, primary_color, accent_color, logo_glyph,
  preferred_preset, contact_email, contact_phone, operational_address, operating_hours,
  holiday_region, review_url, calendar_mapping_name, quote_template_name, invoice_template_name,
  version, transition_nonce, updated_at
) VALUES
('solarcell', 'Solarcell', 'Commercial & Residential Solar Energy Systems', '#ffae14', '#fbbf24', 'S',
 'dark_company', 'operations@solarcell.example.invalid', '(07) 5500 0111', '12 Industry Way, Brendale QLD 4500', 'Mon-Fri 7:00 AM - 5:00 PM AEST',
 'brisbane', 'https://demo.google-reviews.invalid/solarcell-goldcoast', 'Solarcell Field Installation Crew Calendar', 'MYOB-TPL-SOLAR-COMM-2026', 'MYOB-INV-SOLAR-STANDARD',
 1, NULL, '2026-10-28T00:00:00.000Z'),
('smart_home', 'Smart Home Solutions', 'Home Automation, Intelligent Lighting & Smoke Safety', '#0284c7', '#38bdf8', 'SHS',
 'dark_company', 'service@gcsmarthome.example.invalid', '(07) 5500 0222', '44 Innovation Boulevard, Bundall QLD 4217', 'Mon-Fri 8:00 AM - 5:30 PM AEST',
 'gold_coast', 'https://demo.google-reviews.invalid/gc-smarthome', 'Smart Home Automation Technicians Calendar', 'MYOB-TPL-SMARTHOME-2026', 'MYOB-INV-SMARTHOME-STANDARD',
 1, NULL, '2026-10-28T00:00:00.000Z'),
('cctv', 'Gold Coast CCTV', 'Enterprise CCTV, Access Control & Cabling Compliance', '#059669', '#34d399', 'C',
 'dark_company', 'security@gccctv.example.invalid', '(07) 5500 0333', '8 Gateway Drive, Molendinar QLD 4214', 'Mon-Fri 7:30 AM - 5:00 PM AEST',
 'gold_coast', 'https://demo.google-reviews.invalid/gc-cctv', 'GC CCTV Security & Cabling Fleet Calendar', 'MYOB-TPL-CCTV-ENTERPRISE', 'MYOB-INV-CCTV-STANDARD',
 1, NULL, '2026-10-28T00:00:00.000Z');

-- Seed legal issuers (1:1 with workspaces for G01)
INSERT OR IGNORE INTO legal_issuers (
  id, workspace_id, legal_issuer_name, abn, electrical_licence, acma_cabler_registration, qbcc_licence,
  version, transition_nonce, updated_at
) VALUES
('iss_solarcell', 'solarcell', 'Solarcell Technologies Pty Ltd (Sample Data)', 'Sample ABN: 12 345 678 901', 'Sample Licence: Q-ELEC-88219', 'Sample ACMA: ACMA-T0842', 'Sample QBCC: QBCC 1500982', 1, NULL, '2026-10-28T00:00:00.000Z'),
('iss_smart_home', 'smart_home', 'Gold Coast Smart Home Systems Pty Ltd (Sample Data)', 'Sample ABN: 23 456 789 012', 'Sample Licence: Q-ELEC-77341', 'Sample ACMA: ACMA-T0915', 'Sample QBCC: QBCC 1622340', 1, NULL, '2026-10-28T00:00:00.000Z'),
('iss_cctv', 'cctv', 'Gold Coast CCTV & Security Pty Ltd (Sample Data)', 'Sample ABN: 34 567 890 123', 'Sample Licence: Q-ELEC-66412', 'Sample ACMA: ACMA-T1004', 'Sample QBCC: QBCC 1711209', 1, NULL, '2026-10-28T00:00:00.000Z');

-- Seed synthetic users
INSERT OR IGNORE INTO users (id, email, display_name, created_at, updated_at) VALUES
('usr_super_admin', 'admin@cabms.example.invalid', 'Synthetic Super Admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('usr_chine_super_admin', 'admin@chine.example.invalid', 'Chine Digital Admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('usr_owner_admin', 'owner@solarcell.example.invalid', 'Synthetic Owner Admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('usr_office_staff', 'staff@solarcell.example.invalid', 'Synthetic Office Staff', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('usr_technician', 'tech@solarcell.example.invalid', 'Synthetic Technician', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');

-- Seed external identity mappings (Firebase Google Auth UIDs)
INSERT OR IGNORE INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES
('map_super_admin', 'usr_super_admin', 'firebase', 'firebase_uid_super_admin', '2026-10-28T00:00:00.000Z'),
('map_owner_admin', 'usr_owner_admin', 'firebase', 'firebase_uid_owner_admin', '2026-10-28T00:00:00.000Z'),
('map_office_staff', 'usr_office_staff', 'firebase', 'firebase_uid_office_staff', '2026-10-28T00:00:00.000Z'),
('map_technician', 'usr_technician', 'firebase', 'firebase_uid_technician', '2026-10-28T00:00:00.000Z');

-- Seed memberships
-- Super Admin is super_admin across all 3 workspaces
INSERT OR IGNORE INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES
('mem_sa_solarcell', 'solarcell', 'usr_super_admin', 'super_admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('mem_sa_smart_home', 'smart_home', 'usr_super_admin', 'super_admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
('mem_sa_cctv', 'cctv', 'usr_super_admin', 'super_admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
-- Owner admin in solarcell
('mem_oa_solarcell', 'solarcell', 'usr_owner_admin', 'owner_admin', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
-- Office staff in solarcell
('mem_os_solarcell', 'solarcell', 'usr_office_staff', 'office_staff', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z'),
-- Technician in solarcell
('mem_tech_solarcell', 'solarcell', 'usr_technician', 'technician', '2026-10-28T00:00:00.000Z', '2026-10-28T00:00:00.000Z');
