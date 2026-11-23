/** SQL construction only. Calling code must enforce the local database boundary. */
import type {D1Database,D1PreparedStatement} from '../../backend/db/d1.ts';
import {isVerifiedModeBApproval,type VerifiedModeBApproval} from './modeBContract.ts';
import {buildModeBStatements} from './modeBEnrollment.ts';

export function buildLocalDevBootstrapStatements(db:D1Database, approval:Readonly<VerifiedModeBApproval>):D1PreparedStatement[] {
 if (!isVerifiedModeBApproval(approval)) throw new Error('Verified local approval required');
 const m=approval.manifest;
 if (m.account_id!=='LOCAL-DEVELOPMENT-ONLY' || m.target_id!=='local-cabms-db' || m.target_user_id!=='usr_primary_super_admin' || m.signing_key_id!=='LOCAL-TEST-KEY' || m.approval_identity!=='LOCAL-TEST-ONLY-NOT-CLOUD' || m.workspace_scope.length!==3 || !['solarcell','smart_home','cctv'].every(w=>m.workspace_scope.includes(w))) throw new Error('Local development scope required');
 return [
  db.prepare(`INSERT INTO users(id,email,display_name,disabled,created_at,updated_at) SELECT ?,?,'Local Development Super Admin',0,datetime('now'),datetime('now') WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=? OR email=?)`).bind(m.target_user_id,m.operator_email,m.target_user_id,m.operator_email),
  db.prepare(`INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) SELECT 'map_local_primary',?,'firebase',?,datetime('now') WHERE NOT EXISTS(SELECT 1 FROM user_identity_mappings WHERE user_id=?)`).bind(m.target_user_id,m.operator_uid,m.target_user_id),
  ...buildModeBStatements(db,approval),
 ];
}
