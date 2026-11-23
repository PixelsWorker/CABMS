import type {D1Database} from '../../backend/db/d1.ts';
import {isVerifiedModeBApproval,type VerifiedModeBApproval} from './modeBContract.ts';

type Sample={localBefore:number;localAfter:number;d1Time:number;issuedAt:number;expiresAt:number};
/** Conservative preliminary check; it cannot guarantee a later batch arrives within the window. */
export function assessModeBClock(s:Sample):{ok:boolean;reason?:string} {
 if (Object.values(s).some(n=>!Number.isFinite(n)) || s.localAfter<s.localBefore || s.localAfter-s.localBefore>5000) return {ok:false,reason:'CLOCK_SAMPLE_UNRELIABLE'};
 if (Math.max(Math.abs(s.d1Time-s.localBefore),Math.abs(s.d1Time-s.localAfter))>60000) return {ok:false,reason:'CLOCK_SKEW'};
 // Account for the full round trip plus a 30-second processing margin on both edges.
 const margin=30000+(s.localAfter-s.localBefore);
 if (s.d1Time-margin<s.issuedAt || s.d1Time+margin>=s.expiresAt) return {ok:false,reason:'UNSAFE_VALIDITY_WINDOW'};
 return {ok:true};
}
export async function readModeBClock(db:D1Database,approval:Readonly<VerifiedModeBApproval>):Promise<{ok:boolean;reason?:string}> {
 if (!isVerifiedModeBApproval(approval)) return {ok:false,reason:'UNVERIFIED_APPROVAL'};
 try {
  const before=Date.now(), start=performance.now();
  const row=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS d1_time").first<{d1_time:string}>();
  const after=Date.now(), elapsed=performance.now()-start;
  if (!row || typeof row.d1_time!=='string' || Math.abs(elapsed-(after-before))>1000) return {ok:false,reason:'CLOCK_SAMPLE_UNRELIABLE'};
  return assessModeBClock({localBefore:before,localAfter:after,d1Time:Date.parse(row.d1_time),issuedAt:Date.parse(approval.manifest.issued_at),expiresAt:Date.parse(approval.manifest.expires_at)});
 } catch { return {ok:false,reason:'CLOCK_READ_FAILED'}; }
}
