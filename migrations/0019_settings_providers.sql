-- CABMS Migration 0019: Workspace Provider & Integration Settings
-- Adds D1 persistence for SMTP/email sender identity, MYOB sandbox config,
-- calendar mapping, server-side-only secrets, and redacted audit events.

CREATE TABLE IF NOT EXISTS workspace_provider_configs (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  -- SMTP / Email Sender Identity
  sender_name TEXT NOT NULL DEFAULT 'CABMS Operations',
  sender_email TEXT,
  reply_to_email TEXT,
  smtp_host TEXT,
  smtp_port INTEGER NOT NULL DEFAULT 587 CHECK(smtp_port >= 1 AND smtp_port <= 65535),
  smtp_username TEXT,
  smtp_use_tls INTEGER NOT NULL DEFAULT 1 CHECK(smtp_use_tls IN (0, 1)),
  smtp_transport_mode TEXT NOT NULL DEFAULT 'sandbox' CHECK(smtp_transport_mode IN ('sandbox', 'smtp_relay', 'http_relay')),
  smtp_last_test_status TEXT NOT NULL DEFAULT 'UNTESTED' CHECK(smtp_last_test_status IN ('UNTESTED', 'PASSED_SANDBOX', 'PASSED_LIVE', 'FAILED')),
  smtp_last_test_at TEXT,
  smtp_last_test_message TEXT,
  -- MYOB Sandbox Configuration
  myob_enabled INTEGER NOT NULL DEFAULT 0 CHECK(myob_enabled IN (0, 1)),
  myob_environment TEXT NOT NULL DEFAULT 'sandbox' CHECK(myob_environment IN ('sandbox', 'production_disabled')),
  myob_company_file_id TEXT,
  myob_company_file_name TEXT,
  myob_client_id TEXT,
  myob_connection_status TEXT NOT NULL DEFAULT 'DISCONNECTED' CHECK(myob_connection_status IN ('DISCONNECTED', 'CONNECTED_SANDBOX', 'FAILED')),
  myob_last_test_at TEXT,
  myob_last_test_message TEXT,
  -- Calendar Mapping Configuration
  calendar_provider TEXT NOT NULL DEFAULT 'sandbox_local' CHECK(calendar_provider IN ('sandbox_local', 'google_calendar_sandbox')),
  primary_hub_calendar TEXT DEFAULT 'CABMS Operations Master Calendar',
  fleet_calendar_name TEXT,
  fleet_calendar_id TEXT,
  holiday_region TEXT NOT NULL DEFAULT 'brisbane' CHECK(holiday_region IN ('brisbane', 'gold_coast')),
  calendar_sync_status TEXT NOT NULL DEFAULT 'UNCONFIGURED' CHECK(calendar_sync_status IN ('UNCONFIGURED', 'SYNCED_SANDBOX', 'ERROR')),
  calendar_last_test_at TEXT,
  calendar_last_test_message TEXT,
  -- Optimistic concurrency & metadata
  version INTEGER NOT NULL DEFAULT 1,
  transition_nonce TEXT,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id)
);

-- Server-side-only provider secrets (NEVER selected into client responses or audit logs)
CREATE TABLE IF NOT EXISTS workspace_provider_secrets (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  secret_key TEXT NOT NULL CHECK(secret_key IN ('smtp_secret', 'myob_client_secret')),
  secret_value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_user_id TEXT REFERENCES users(id),
  PRIMARY KEY (workspace_id, secret_key)
);

-- Redacted audit trail for provider configuration changes & connection tests
CREATE TABLE IF NOT EXISTS provider_config_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('smtp', 'myob', 'calendar', 'all')),
  event_type TEXT NOT NULL CHECK(event_type IN ('PROVIDER_CONFIG_UPDATED', 'PROVIDER_CONNECTION_TESTED', 'PROVIDER_SECRET_UPDATED', 'PROVIDER_SECRET_CLEARED')),
  old_version INTEGER NOT NULL,
  new_version INTEGER NOT NULL,
  old_values TEXT NOT NULL,
  new_values TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  transition_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_audit_workspace ON provider_config_audit_events(workspace_id, created_at);

-- Seed default sandbox provider configurations for existing synthetic workspaces
INSERT OR IGNORE INTO workspace_provider_configs (
  workspace_id, sender_name, sender_email, smtp_host, smtp_port, smtp_transport_mode,
  myob_enabled, myob_environment, myob_company_file_name, myob_connection_status,
  calendar_provider, primary_hub_calendar, fleet_calendar_name, holiday_region, calendar_sync_status,
  version, transition_nonce, updated_at
) VALUES
('solarcell', 'Solarcell Operations', 'operations@solarcell.example.invalid', 'smtp.sandbox.cabms.invalid', 587, 'sandbox',
 1, 'sandbox', 'CABMS Solarcell Sandbox File', 'DISCONNECTED',
 'sandbox_local', 'CABMS Operations Master Calendar', 'Solarcell Field Installation Crew Calendar', 'brisbane', 'SYNCED_SANDBOX',
 1, NULL, '2026-10-28T00:00:00.000Z'),
('smart_home', 'Smart Home Solutions', 'service@gcsmarthome.example.invalid', 'smtp.sandbox.cabms.invalid', 587, 'sandbox',
 1, 'sandbox', 'CABMS Smart Home Sandbox File', 'DISCONNECTED',
 'sandbox_local', 'CABMS Operations Master Calendar', 'Smart Home Automation Technicians Calendar', 'gold_coast', 'SYNCED_SANDBOX',
 1, NULL, '2026-10-28T00:00:00.000Z'),
('cctv', 'Gold Coast CCTV', 'security@gccctv.example.invalid', 'smtp.sandbox.cabms.invalid', 587, 'sandbox',
 1, 'sandbox', 'CABMS CCTV Sandbox File', 'DISCONNECTED',
 'sandbox_local', 'CABMS Operations Master Calendar', 'GC CCTV Security & Cabling Fleet Calendar', 'gold_coast', 'SYNCED_SANDBOX',
 1, NULL, '2026-10-28T00:00:00.000Z');
