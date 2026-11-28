-- CABMS Customer Directory & MYOB Sandbox Integration (Cloudflare D1 / SQLite)
-- Schema migration 0021: Persistent workspace-scoped customers, multi-brand affiliations,
-- and idempotent MYOB sandbox write-through / reconciliation audit log.

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  myob_customer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  sync_status TEXT NOT NULL CHECK(sync_status IN ('SYNCED', 'FAILED', 'UNCERTAIN', 'PENDING')),
  is_recoverable_draft INTEGER NOT NULL DEFAULT 0 CHECK(is_recoverable_draft IN (0, 1)),
  notes TEXT,
  myob_sandbox_mode INTEGER NOT NULL DEFAULT 1 CHECK(myob_sandbox_mode IN (0, 1)),
  last_sync_error TEXT,
  last_synced_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_brand_affiliations (
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  brand_id TEXT NOT NULL CHECK(brand_id IN ('solarcell', 'smart_home', 'cctv')),
  created_at TEXT NOT NULL,
  PRIMARY KEY (customer_id, brand_id)
);

CREATE TABLE IF NOT EXISTS customer_myob_sync_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('CREATE', 'UPDATE', 'RETRY_SYNC', 'RECONCILE_CONFIRM', 'RECONCILE_REJECT')),
  outcome TEXT NOT NULL CHECK(outcome IN ('SYNCED', 'FAILED', 'UNCERTAIN', 'REJECTED')),
  myob_card_id TEXT,
  is_sandbox INTEGER NOT NULL DEFAULT 1 CHECK(is_sandbox IN (0, 1)),
  actor_user_id TEXT NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_customers_workspace_name ON customers(workspace_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_workspace_email ON customers(workspace_id, email);
CREATE INDEX IF NOT EXISTS idx_customers_workspace_myob ON customers(workspace_id, myob_customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_workspace_sync ON customers(workspace_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_customer_brands_lookup ON customer_brand_affiliations(workspace_id, brand_id);
CREATE INDEX IF NOT EXISTS idx_customer_sync_log_customer ON customer_myob_sync_log(customer_id, created_at);
