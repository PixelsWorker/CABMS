-- CABMS G01 Initial Schema (Cloudflare D1 / SQLite)
-- Schema migration 0001: Core tables for identity, workspaces, settings, legal issuers, and audit events

-- 1. Internal users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 2. External identity mappings (Firebase / Google)
CREATE TABLE IF NOT EXISTS user_identity_mappings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  provider_subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(provider_id, provider_subject_id)
);

-- 3. Workspaces (3 synthetic workspaces for G01)
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 4. Workspace memberships
CREATE TABLE IF NOT EXISTS workspace_memberships (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('super_admin', 'owner_admin', 'office_staff', 'technician')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, user_id)
);

-- 5. Workspace settings (independently versioned resource)
CREATE TABLE IF NOT EXISTS workspace_settings (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  trading_name TEXT NOT NULL,
  tagline TEXT,
  primary_color TEXT NOT NULL,
  accent_color TEXT NOT NULL,
  logo_glyph TEXT NOT NULL,
  preferred_preset TEXT NOT NULL DEFAULT 'dark_company',
  contact_email TEXT,
  contact_phone TEXT,
  operational_address TEXT,
  operating_hours TEXT,
  holiday_region TEXT NOT NULL DEFAULT 'brisbane',
  review_url TEXT,
  calendar_mapping_name TEXT,
  quote_template_name TEXT,
  invoice_template_name TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  transition_nonce TEXT,
  updated_at TEXT NOT NULL
);

-- 6. Legal issuers (1:1 with workspaces for G01, independently versioned resource)
CREATE TABLE IF NOT EXISTS legal_issuers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT UNIQUE NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legal_issuer_name TEXT NOT NULL,
  abn TEXT,
  electrical_licence TEXT,
  acma_cabler_registration TEXT,
  qbcc_licence TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  transition_nonce TEXT,
  updated_at TEXT NOT NULL
);

-- 7. Durable settings audit events
CREATE TABLE IF NOT EXISTS settings_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('workspace_settings', 'legal_issuer')),
  resource_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('SETTINGS_UPDATED', 'LEGAL_DETAILS_UPDATED')),
  old_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  old_values TEXT NOT NULL, -- JSON formatted allowlisted fields
  new_values TEXT NOT NULL, -- JSON formatted allowlisted fields
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  transition_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Indexes for performance and query efficiency
CREATE INDEX IF NOT EXISTS idx_identity_mappings_lookup ON user_identity_mappings(provider_id, provider_subject_id);
CREATE INDEX IF NOT EXISTS idx_memberships_user ON workspace_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON settings_audit_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON settings_audit_events(resource_type, resource_id);
