/** Explicitly local-only development bootstrap. No Cloudflare or network bindings. */
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync,openSync,closeSync,chmodSync,mkdirSync} from 'node:fs';
import {DatabaseSync,backup} from 'node:sqlite';
import path from 'node:path';
import {LocalD1Database} from '../../backend/db/d1.ts';
import {loadVerifiedMigrations} from '../../backend/db/migrate.ts';
import {canonicalizeJson} from './approvalManifest.ts';
import {verifyModeBApproval} from './modeBContract.ts';
import {buildLocalDevBootstrapStatements} from './localDevBootstrap.ts';
import {reconcileModeB} from './modeBReconcile.ts';
import {readModeBClock} from './modeBClock.ts';

const root='/home/rockson/Projects/Projects/CABMS/DB';
const database=path.join(root,'v3/d1/miniflare-D1DatabaseObject/6a8d1842713795abb9329b2450df812b24d9e39538311b83c3e2088e14e09f70.sqlite');
const evidence='/home/rockson/Projects/Projects/CABMS/evidence/local-db-backups';
async function main() {
 if (process.argv.length!==3 || process.argv[2]!=='--local') throw new Error('Exactly --local is required; no remote target is supported');
 for(const p of [root,path.join(root,'v3'),path.join(root,'v3/d1'),path.dirname(database),database]) if(lstatSync(p).isSymbolicLink() || realpathSync(p)!==p) throw new Error('Local path must not contain symlinks');
 if (!lstatSync(database).isFile() || lstatSync(database).nlink!==1) throw new Error('Expected a single local SQLite database file');
 const uid=readFileSync(0,'utf8').trim();
 if (!/^[A-Za-z0-9_-]{5,128}$/.test(uid)) throw new Error('Invalid Firebase UID');
 const sqlite=new DatabaseSync(database);const db=new LocalD1Database(sqlite);
 try {
  sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const integrity=sqlite.prepare('PRAGMA integrity_check').get() as Record<string,unknown>;
  if (integrity.integrity_check!=='ok') throw new Error('Local SQLite integrity check failed');
  const ledger=sqlite.prepare('SELECT name FROM d1_migrations ORDER BY id').all() as Array<{name:string}>;
  const expected=loadVerifiedMigrations().map(m=>m.name);
  if (ledger.length!==expected.length || ledger.some((r,i)=>r.name!==expected[i])) throw new Error('Local migration ledger does not match verified repository migrations');
  mkdirSync(evidence,{recursive:true,mode:0o700});
  if (lstatSync(evidence).isSymbolicLink() || realpathSync(evidence)!==evidence) throw new Error('Invalid backup directory');
  const backupPath=path.join(evidence,`local-before-admin-${randomUUID()}.sqlite`);
  const fd=openSync(backupPath,'wx',0o600);closeSync(fd);
  await backup(sqlite,backupPath);chmodSync(backupPath,0o600);
  const now=Date.now(), scope=['solarcell','smart_home','cctv'], keys=generateKeyPairSync('ed25519');
  const m={domain:'CABMS/MODE-B/v1',operation_id:`op_${randomUUID()}`,nonce:randomUUID(),account_id:'LOCAL-DEVELOPMENT-ONLY',target_id:'local-cabms-db',target_user_id:'usr_primary_super_admin',operator_email:'admin@chinedigital.com.au',operator_uid:uid,workspace_scope:scope,permitted_action:'bootstrap_super_admin',issued_at:new Date(now-60000).toISOString(),expires_at:new Date(now+300000).toISOString(),signing_key_id:'LOCAL-TEST-KEY',approval_identity:'LOCAL-TEST-ONLY-NOT-CLOUD'};
  const canonical=canonicalizeJson(m), signature=sign(null,Buffer.from(canonical),keys.privateKey).toString('base64url');
  const approval=verifyModeBApproval(JSON.stringify({manifest:m,signature_algorithm:'Ed25519',signature_bytes:signature,signing_key_id:m.signing_key_id,canonical_manifest_json:canonical}),keys.publicKey,{accountId:m.account_id,databaseId:m.target_id,userId:m.target_user_id,email:m.operator_email,uid:m.operator_uid,workspaceIds:scope,keyId:m.signing_key_id,publicKeySha256:createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now});
  if (!(await readModeBClock(db,approval)).ok) throw new Error('Local clock is outside the safe approval window');
  try {await db.batch(buildLocalDevBootstrapStatements(db,approval));}
  catch {throw new Error('Local bootstrap failed; no retry was attempted. Inspect the local database and backup.');}
  const status=await reconcileModeB(db,approval,{settled:true});
  if (status!=='CONFIRMED_ENROLLED') throw new Error(`Local bootstrap could not be confirmed: ${status}`);
  console.log('Local development Super Admin confirmed for all three workspaces.');
  console.log(`Local database backup: ${backupPath}`);
 } finally {sqlite.close();}
}
main().catch((error:unknown)=>{console.error(error instanceof Error ? error.message : 'Local bootstrap failed');process.exitCode=1;});
