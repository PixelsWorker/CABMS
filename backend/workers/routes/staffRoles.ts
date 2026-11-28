import type { Env } from '../../types.ts';
import { authorizeWorkspaceAccess, type AuthenticationService } from '../auth.ts';
import { approvedMembership } from '../privilegedApproval.ts';
import { accessDeniedResponse, authenticationRequiredResponse, validationErrorResponse } from '../problem.ts';

export async function assignStaffRole(request: Request, env: Env, authentication: AuthenticationService,
  workspace: string, user: string, requestId: string): Promise<Response> {
  const actor = await authentication.authenticateRequest(env.DB, request, env);
  if (!actor) return authenticationRequiredResponse('Staff sign-in required', requestId);
  const membership = await authorizeWorkspaceAccess(env.DB, workspace, actor);
  const denied = () => accessDeniedResponse('Workspace administrator access required', requestId);
  if (!membership || !['owner_admin','super_admin'].includes(membership.role)) return denied();
  const data = await request.json().catch(() => null) as {previous_role?:unknown;role?:unknown} | null;
  const staffRole = (value:unknown):value is string => value === 'technician' || value === 'office_staff';
  if (!staffRole(data?.previous_role) || !staffRole(data?.role) || data.role === data.previous_role) {
    return validationErrorResponse('Choose a different existing staff role. Privileged roles use the privileged approval process.', [], requestId);
  }
  try {
    const result = await env.DB.prepare(`INSERT INTO compliance_staff_role_changes(id,workspace_id,user_id,actor_id,previous_role,next_role)
      SELECT ?,?,?,?,?,? WHERE EXISTS (
      SELECT 1 FROM workspace_memberships wm JOIN users u ON u.id=wm.user_id AND u.disabled=0
      JOIN user_identity_mappings im ON im.user_id=u.id AND im.provider_id='firebase'
      WHERE wm.workspace_id=? AND wm.user_id=? AND im.provider_subject_id=?
      AND wm.role IN ('owner_admin','super_admin') AND ${approvedMembership})`)
      .bind(requestId,workspace,user,actor.userId,data.previous_role,data.role,workspace,actor.userId,actor.providerSubjectId).run();
    if (!result.meta.changes) return denied();
    return Response.json({role:data.role});
  } catch (error) {
    if (!String(error).includes('ROLE_CONFLICT')) throw error;
    return Response.json({code:'ROLE_CONFLICT',message:'Refresh the staff membership before changing its role.'},{status:409});
  }
}
