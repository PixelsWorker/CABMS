-- CABMS Communications & Email Delivery Schema (Cloudflare D1 / SQLite)
-- Migration 0020: Persistent email deliveries, redacted delivery audit events, and review request lifecycle

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK(category IN ('TEST_EMAIL', 'REVIEW_REQUEST', 'CERTIFICATE', 'REMINDER', 'QUOTE', 'ENQUIRY_REPLY', 'GENERAL')),
  job_id TEXT,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  sender_name TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  reply_to_email TEXT,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  transport_mode TEXT NOT NULL CHECK(transport_mode IN ('SANDBOX_SYNTHETIC', 'HTTPS_RELAY', 'SMTP_TCP')),
  status TEXT NOT NULL CHECK(status IN ('QUEUED', 'SENT', 'FAILED', 'UNCERTAIN')),
  provider_message_id TEXT,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_attempt_at TEXT NOT NULL,
  sent_at TEXT,
  created_by_user_id TEXT REFERENCES users(id),
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_delivery_audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  delivery_id TEXT REFERENCES email_deliveries(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'EMAIL_QUEUED',
    'EMAIL_SENT',
    'EMAIL_FAILED',
    'EMAIL_UNCERTAIN',
    'EMAIL_RETRIED',
    'TEST_EMAIL_SENT',
    'TEST_EMAIL_FAILED',
    'REVIEW_DISPATCHED',
    'REVIEW_DEDUP_BLOCKED',
    'REVIEW_RECONCILED',
    'REVIEW_RETRIED'
  )),
  transport_mode TEXT NOT NULL CHECK(transport_mode IN ('SANDBOX_SYNTHETIC', 'HTTPS_RELAY', 'SMTP_TCP')),
  actor_user_id TEXT REFERENCES users(id),
  request_id TEXT NOT NULL,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS review_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  review_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('NOT_SENT', 'PENDING', 'SENT', 'FAILED', 'UNCERTAIN')),
  delivery_id TEXT REFERENCES email_deliveries(id),
  uncertain_reconciliation_needed INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  reconciled_by_user_id TEXT REFERENCES users(id),
  reconciled_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_workspace_created
  ON email_deliveries(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_workspace_status
  ON email_deliveries(workspace_id, status);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_workspace_job
  ON email_deliveries(workspace_id, job_id);

CREATE INDEX IF NOT EXISTS idx_email_audit_workspace_created
  ON email_delivery_audit_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_audit_delivery
  ON email_delivery_audit_events(delivery_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_review_requests_workspace_job
  ON review_requests(workspace_id, job_id);
