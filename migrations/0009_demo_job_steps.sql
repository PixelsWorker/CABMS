CREATE UNIQUE INDEX demo_jobs_workspace_id ON demo_jobs(workspace_id, id);
CREATE TABLE demo_job_steps (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, job_id TEXT NOT NULL,
 step_key TEXT NOT NULL, label TEXT NOT NULL, required INTEGER NOT NULL CHECK(required IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('pending','done','skipped','n/a')), updated_at TEXT NOT NULL,
 UNIQUE(job_id, step_key), FOREIGN KEY(workspace_id, job_id) REFERENCES demo_jobs(workspace_id, id)
);
INSERT INTO demo_job_steps SELECT 'review:' || id, workspace_id, id, 'review_details', 'Review job details', 1, 'pending', created_at FROM demo_jobs;
CREATE TRIGGER demo_job_initial_step AFTER INSERT ON demo_jobs BEGIN
 INSERT INTO demo_job_steps VALUES ('review:' || NEW.id, NEW.workspace_id, NEW.id, 'review_details', 'Review job details', 1, 'pending', NEW.created_at);
END;
