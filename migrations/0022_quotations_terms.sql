-- CABMS Migration 0022: Quotations, Immutable Terms Snapshots & Follow-Up Scheduling
-- D1 / SQLite schema for persistent quotation lifecycle

CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  customer_id TEXT,
  brand_id TEXT NOT NULL,
  external_myob_ref TEXT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents >= 0),
  gst_cents INTEGER NOT NULL CHECK(gst_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
  terms_template_id TEXT,
  terms_revision_id TEXT,
  terms_version TEXT,
  terms_content_snapshot TEXT,
  frozen_issuer_snapshot TEXT,
  acceptance_status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK(acceptance_status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REFUSED', 'EXPIRED', 'REVOKED', 'SUPERSEDED')),
  acceptance_token_hash TEXT,
  issued_at TEXT,
  expires_at TEXT,
  accepted_at TEXT,
  accepted_by_name TEXT,
  refused_at TEXT,
  refusal_reason TEXT,
  revoked_at TEXT,
  revocation_reason TEXT,
  supersedes_quote_id TEXT REFERENCES quotations(id),
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotation_line_items (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_order INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL CHECK(length(trim(description)) > 0),
  quantity REAL NOT NULL CHECK(quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
  total_cents INTEGER NOT NULL CHECK(total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS quotation_follow_ups (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK(stage IN ('STAGE_1_COURTESY', 'STAGE_2_EXPIRY')),
  scheduled_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED', 'SENT', 'CANCELLED')),
  sent_at TEXT,
  channel TEXT NOT NULL DEFAULT 'EMAIL_SIMULATED',
  email_delivery_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT,
  UNIQUE(quote_id, stage)
);

CREATE TABLE IF NOT EXISTS quotation_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_user_id TEXT,
  actor_name TEXT NOT NULL,
  request_id TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quotations_workspace_job ON quotations(workspace_id, job_id);
CREATE INDEX IF NOT EXISTS idx_quotations_workspace_status ON quotations(workspace_id, acceptance_status);
CREATE INDEX IF NOT EXISTS idx_quotations_token_hash ON quotations(acceptance_token_hash);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quote ON quotation_line_items(quote_id, line_order);
CREATE INDEX IF NOT EXISTS idx_quotation_followups_quote ON quotation_follow_ups(quote_id, stage);
CREATE INDEX IF NOT EXISTS idx_quotation_events_quote ON quotation_events(quote_id, created_at);

-- Immutability guards: once a quotation leaves DRAFT, commercial totals and frozen snapshots cannot be altered.
CREATE TRIGGER IF NOT EXISTS quotations_no_mutate_snapshot_after_send
BEFORE UPDATE ON quotations
WHEN OLD.acceptance_status != 'DRAFT'
 AND (NEW.title != OLD.title
   OR NEW.subtotal_cents != OLD.subtotal_cents
   OR NEW.gst_cents != OLD.gst_cents
   OR NEW.total_cents != OLD.total_cents
   OR COALESCE(NEW.terms_template_id, '') != COALESCE(OLD.terms_template_id, '')
   OR COALESCE(NEW.terms_revision_id, '') != COALESCE(OLD.terms_revision_id, '')
   OR COALESCE(NEW.terms_version, '') != COALESCE(OLD.terms_version, '')
   OR COALESCE(NEW.terms_content_snapshot, '') != COALESCE(OLD.terms_content_snapshot, '')
   OR COALESCE(NEW.frozen_issuer_snapshot, '') != COALESCE(OLD.frozen_issuer_snapshot, '')
   OR COALESCE(NEW.issued_at, '') != COALESCE(OLD.issued_at, ''))
BEGIN
  SELECT RAISE(ABORT, 'Quotation commercial terms and snapshots are immutable after sending');
END;

CREATE TRIGGER IF NOT EXISTS quotation_items_no_insert_after_send
BEFORE INSERT ON quotation_line_items
WHEN EXISTS (SELECT 1 FROM quotations WHERE id = NEW.quote_id AND acceptance_status != 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'Quotation line items are immutable after sending');
END;

CREATE TRIGGER IF NOT EXISTS quotation_items_no_update_after_send
BEFORE UPDATE ON quotation_line_items
WHEN EXISTS (SELECT 1 FROM quotations WHERE id = OLD.quote_id AND acceptance_status != 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'Quotation line items are immutable after sending');
END;

CREATE TRIGGER IF NOT EXISTS quotation_items_no_delete_after_send
BEFORE DELETE ON quotation_line_items
WHEN EXISTS (SELECT 1 FROM quotations WHERE id = OLD.quote_id AND acceptance_status != 'DRAFT')
BEGIN
  SELECT RAISE(ABORT, 'Quotation line items are immutable after sending');
END;
