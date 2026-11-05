-- Synthetic demo appointments only. No technician assignments or provider sync.
CREATE TABLE demo_appointments (
 id TEXT PRIMARY KEY,
 workspace_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('scheduled','cancelled')),
 version INTEGER NOT NULL CHECK(version >= 1),
 FOREIGN KEY(workspace_id, job_id) REFERENCES demo_jobs(workspace_id, id)
);
CREATE INDEX demo_appointments_workspace ON demo_appointments(workspace_id, starts_at, id);
