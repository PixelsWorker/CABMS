-- CABMS G01 Migration 0004: User Account Status & Revocation Tracking
-- Add account deactivation / disabled status to users table

ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN status_updated_at TEXT;
