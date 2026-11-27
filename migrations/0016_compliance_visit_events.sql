-- Unregistered proposal, disposable verification only.
CREATE TABLE compliance_visit_events (
 workspace_id TEXT NOT NULL,
 visit_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version >= 1),
 job_id TEXT NOT NULL,
 technician_id TEXT NOT NULL REFERENCES users(id),
 starts_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SCHEDULED','CANCELLED')),
 reason TEXT NOT NULL CHECK(status<>'CANCELLED' OR length(trim(reason))>0),
 actor_id TEXT NOT NULL REFERENCES users(id),
 operation_key TEXT NOT NULL,
 occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(workspace_id,visit_id,version),
 UNIQUE(workspace_id,actor_id,operation_key),
 FOREIGN KEY(workspace_id,job_id) REFERENCES compliance_jobs(workspace_id,id)
);
