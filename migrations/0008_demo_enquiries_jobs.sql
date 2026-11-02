-- Synthetic demonstration data. No public intake or production data.
CREATE TABLE demo_enquiries (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  customer_name TEXT NOT NULL CHECK(length(customer_name) BETWEEN 1 AND 120),
  service TEXT NOT NULL CHECK(length(service) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  UNIQUE(workspace_id, id)
);
CREATE TABLE demo_jobs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
  enquiry_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(workspace_id, enquiry_id) REFERENCES demo_enquiries(workspace_id, id)
);
