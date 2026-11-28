-- CABMS Website Enquiries & Intake Persistence (Cloudflare D1 / SQLite)
-- Migration 0023: Persistent D1-backed website enquiry intake, workspace routing,
-- idempotency/duplicate guard, customer/job conversion, acknowledgement email status, and audit trail.

CREATE TABLE IF NOT EXISTS website_enquiries (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_website TEXT NOT NULL DEFAULT 'website_form' CHECK(length(trim(source_website)) BETWEEN 1 AND 200),
  customer_name TEXT NOT NULL CHECK(length(trim(customer_name)) BETWEEN 1 AND 120),
  email TEXT NOT NULL CHECK(length(trim(email)) BETWEEN 3 AND 254),
  phone TEXT NOT NULL CHECK(length(trim(phone)) BETWEEN 4 AND 40),
  site_address TEXT CHECK(site_address IS NULL OR length(trim(site_address)) <= 500),
  service_requested TEXT NOT NULL CHECK(length(trim(service_requested)) BETWEEN 1 AND 500),
  notes TEXT CHECK(notes IS NULL OR length(notes) <= 2000),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW'
    CHECK(status IN ('PENDING_REVIEW', 'CONVERTED_TO_JOB', 'DISMISSED', 'SPAM_BLOCKED')),
  intake_channel TEXT NOT NULL DEFAULT 'PUBLIC_FORM'
    CHECK(intake_channel IN ('PUBLIC_FORM', 'STAFF_MANUAL', 'SIMULATED')),
  idempotency_key TEXT CHECK(idempotency_key IS NULL OR length(trim(idempotency_key)) BETWEEN 1 AND 128),
  dedup_fingerprint TEXT NOT NULL CHECK(length(dedup_fingerprint) = 64 AND dedup_fingerprint NOT GLOB '*[^0-9a-f]*'),
  matched_customer_id TEXT,
  converted_job_id TEXT,
  converted_job_type_id TEXT,
  acknowledgement_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(acknowledgement_status IN ('PENDING', 'SENT', 'SANDBOX_SIMULATED', 'FAILED', 'SKIPPED')),
  acknowledgement_message_id TEXT,
  acknowledgement_error TEXT,
  spam_score INTEGER NOT NULL DEFAULT 0 CHECK(spam_score >= 0),
  spam_reason TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  reviewed_by_user_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(workspace_id, id),
  UNIQUE(workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_website_enquiries_workspace_status
  ON website_enquiries(workspace_id, status, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_website_enquiries_dedup
  ON website_enquiries(workspace_id, dedup_fingerprint, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_website_enquiries_email
  ON website_enquiries(workspace_id, email);

CREATE TABLE IF NOT EXISTS website_enquiry_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  enquiry_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'INTAKE_CREATED',
    'INTAKE_DUPLICATE_REPLAYED',
    'INTAKE_SPAM_BLOCKED',
    'ENQUIRY_CONVERTED',
    'ENQUIRY_DISMISSED',
    'ACK_EMAIL_DISPATCHED',
    'ACK_EMAIL_FAILED'
  )),
  actor_user_id TEXT REFERENCES users(id),
  request_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY(workspace_id, enquiry_id) REFERENCES website_enquiries(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_website_enquiry_audit_workspace
  ON website_enquiry_audit_events(workspace_id, enquiry_id, created_at DESC);
