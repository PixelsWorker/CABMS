import type { D1Database } from '../../db/d1.ts';
import type { AuthContext } from '../../types.ts';
import { approvedMembership } from '../../workers/privilegedApproval.ts';
import type { DemoAppointment } from '../../../contracts/demoAppointments.ts';

// Evaluate current Firebase mapping, enabled account, membership and privileged approval in each statement.
const allowed = `EXISTS (SELECT 1 FROM workspace_memberships wm
 JOIN users u ON u.id=wm.user_id AND u.disabled=0
 JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
 WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
 AND wm.role IN ('super_admin','owner_admin','office_staff') AND ${approvedMembership})`;
const who = (workspace: string, auth: AuthContext) => [workspace,auth.userId,auth.providerSubjectId];
export async function listAppointments(db: D1Database, workspace: string, auth: AuthContext) {
 return (await db.prepare(`SELECT a.* FROM demo_appointments a WHERE a.workspace_id=? AND ${allowed} ORDER BY a.starts_at,a.id`).bind(workspace,...who(workspace,auth)).all<DemoAppointment>()).results;
}
export async function createAppointment(db: D1Database, workspace: string, auth: AuthContext, job: string, start: string, end: string) {
 const id=crypto.randomUUID();
 return db.prepare(`INSERT INTO demo_appointments(id,workspace_id,job_id,starts_at,ends_at,status,version)
 SELECT ?,j.workspace_id,j.id,?,?,'scheduled',1 FROM demo_jobs j WHERE j.workspace_id=? AND j.id=? AND ${allowed} RETURNING *`).bind(id,start,end,workspace,job,...who(workspace,auth)).first<DemoAppointment>();
}
export async function updateAppointment(db: D1Database, workspace: string, auth: AuthContext, id: string, version: number, change: {starts_at:string;ends_at:string}|{status:'cancelled'}) {
 const isCancel='status' in change;
 const fields=isCancel ? "status='cancelled',version=version+1" : 'starts_at=?,ends_at=?,version=version+1';
 const values=isCancel ? [] : [change.starts_at,change.ends_at];
 return db.prepare(`UPDATE demo_appointments SET ${fields} WHERE workspace_id=? AND id=? AND version=? AND status='scheduled' AND ${allowed} RETURNING *`).bind(...values,workspace,id,version,...who(workspace,auth)).first<DemoAppointment>();
}
