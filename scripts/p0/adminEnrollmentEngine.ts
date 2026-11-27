/** Shared transaction driver. Callers must independently attest the local binding. */
import type {D1Database} from '../../backend/db/d1.ts';
import {buildLocalDevBootstrapStatements} from './localDevBootstrap.ts';
import {isVerifiedModeBApproval,type VerifiedModeBApproval} from './modeBContract.ts';
import {reconcileModeB,type ModeBReconciliation} from './modeBReconcile.ts';
import {readModeBClock} from './modeBClock.ts';

export type LocalEnrollmentResult = {status:'CONFIRMED_ENROLLED'|'REJECTED'|'INDETERMINATE'; reason:string};

/** One batch at most. A rejected response is reconciled; it is never retried. */
export async function executeLocalEnrollment(db:D1Database,approval:Readonly<VerifiedModeBApproval>,expected:{email:string;uid:string}):Promise<LocalEnrollmentResult> {
 if(!isVerifiedModeBApproval(approval)) return {status:'REJECTED',reason:'unverified approval'};
 const m=approval.manifest;
 if(m.operator_email!==expected.email || m.operator_uid!==expected.uid) return {status:'REJECTED',reason:'identity mismatch'};
 if(!(await readModeBClock(db,approval)).ok) return {status:'REJECTED',reason:'unreliable approval clock'};
 let sent=false;
 try {
  const statements=buildLocalDevBootstrapStatements(db,approval);
  const results=await db.batch(statements);sent=true;
  if(results.length!==statements.length || results.some(result=>!result.success)) return {status:'INDETERMINATE',reason:'batch did not confirm success'};
 } catch {
  // A transport failure can occur after commit. Never infer rollback or retry.
  const reconciled:ModeBReconciliation=await reconcileModeB(db,approval,{settled:false});
  return reconciled==='CONFIRMED_ENROLLED' ? {status:'CONFIRMED_ENROLLED',reason:'confirmed after uncertain response'} : {status:'INDETERMINATE',reason:'batch outcome not proven'};
 }
 if(!sent) return {status:'INDETERMINATE',reason:'batch outcome not proven'};
 const status=await reconcileModeB(db,approval,{settled:true});
 return status==='CONFIRMED_ENROLLED' ? {status:'CONFIRMED_ENROLLED',reason:'reconciled'} : {status:'INDETERMINATE',reason:`reconciliation: ${status}`};
}
