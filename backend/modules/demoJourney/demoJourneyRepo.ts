import type { D1Database } from '../../db/d1.ts';
import type { AuthContext } from '../../types.ts';
import { approvedMembership } from '../../workers/privilegedApproval.ts';
import type { CreateDemoEnquiry, DemoEnquiry, DemoJob } from '../../../contracts/demoJourney.ts';

// Re-evaluate account, Firebase mapping, membership, role and privilege approval
// within each SQL statement, including writes.
const allowed = `EXISTS (SELECT 1 FROM workspace_memberships wm
 JOIN users u ON u.id=wm.user_id AND u.disabled=0
 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
 WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
 AND wm.role IN ('super_admin','owner_admin','office_staff') AND ${approvedMembership})`;
const who = (workspace: string, auth: AuthContext) => [workspace, auth.userId, auth.providerSubjectId];
export async function listEnquiries(db: D1Database, workspace: string, auth: AuthContext) {
 return (await db.prepare(`SELECT e.*, j.id AS job_id FROM demo_enquiries e LEFT JOIN demo_jobs j ON j.workspace_id=e.workspace_id AND j.enquiry_id=e.id WHERE e.workspace_id=? AND ${allowed} ORDER BY e.created_at DESC, e.id`).bind(workspace,...who(workspace,auth)).all<DemoEnquiry>()).results;
}
export async function listJobs(db: D1Database, workspace: string, auth: AuthContext) {
 return (await db.prepare(`SELECT j.* FROM demo_jobs j WHERE j.workspace_id=? AND ${allowed} ORDER BY j.created_at DESC, j.id`).bind(workspace,...who(workspace,auth)).all<DemoJob>()).results;
}
export async function createEnquiry(db: D1Database, workspace: string, auth: AuthContext, input: CreateDemoEnquiry) {
 const id = crypto.randomUUID();
 const r = await db.prepare(`INSERT INTO demo_enquiries (id,workspace_id,customer_name,service,created_at) SELECT ?,?,?,?,? WHERE ${allowed}`).bind(id,workspace,input.customer_name,input.service,new Date().toISOString(),...who(workspace,auth)).run();
 return r.meta.changes === 1 ? id : null;
}
export async function convertEnquiry(db: D1Database, workspace: string, auth: AuthContext, enquiry: string) {
 const id = crypto.randomUUID();
 // A single INSERT is atomic. The unique enquiry_id constraint rejects races.
 const row = await db.prepare(`INSERT INTO demo_jobs (id,workspace_id,enquiry_id,title,created_at) SELECT ?,e.workspace_id,e.id,e.service,? FROM demo_enquiries e WHERE e.workspace_id=? AND e.id=? AND ${allowed} ON CONFLICT(enquiry_id) DO NOTHING RETURNING id`).bind(id,new Date().toISOString(),workspace,enquiry,...who(workspace,auth)).first<{id:string}>();
 return row?.id ?? null;
}

export async function getJob(db: D1Database, workspace: string, auth: AuthContext, job: string) {
 return db.prepare(`SELECT j.* FROM demo_jobs j WHERE j.workspace_id=? AND j.id=? AND ${allowed}`).bind(workspace,job,...who(workspace,auth)).first();
}
export async function getJobSteps(db: D1Database, workspace: string, auth: AuthContext, job: string) {
 return (await db.prepare(`SELECT s.* FROM demo_job_steps s WHERE s.workspace_id=? AND s.job_id=? AND ${allowed} ORDER BY s.step_key`).bind(workspace,job,...who(workspace,auth)).all()).results;
}
export async function completeJobStep(db: D1Database, workspace: string, auth: AuthContext, job: string, step: string) {
 const result = await db.prepare(`UPDATE demo_job_steps SET updated_at=CASE WHEN state='done' THEN updated_at ELSE ? END, state='done' WHERE workspace_id=? AND job_id=? AND id=? AND step_key='review_details' AND state IN ('pending','done') AND ${allowed}`).bind(new Date().toISOString(),workspace,job,step,...who(workspace,auth)).run();
 return result.meta.changes === 1;
}
