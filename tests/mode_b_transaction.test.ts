import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createLocalD1Database,type LocalD1Database} from '../backend/db/d1.ts';
import {runLocalMigrations} from '../backend/db/migrate.ts';
import {canonicalizeJson} from '../scripts/p0/approvalManifest.ts';
import {verifyModeBApproval} from '../scripts/p0/modeBContract.ts';
import {enrollModeBExistingUser,buildModeBStatements} from '../scripts/p0/modeBEnrollment.ts';
import {reconcileModeB} from '../scripts/p0/modeBReconcile.ts';
import {readModeBClock} from '../scripts/p0/modeBClock.ts';

test('IN-MEMORY ONLY: existing identity is asserted, preserved, and enrolled atomically',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());await runLocalMigrations(db,{disposableTest:true});
 await db.exec("INSERT INTO users(id,email,disabled,created_at,updated_at) VALUES('existing','fixture@example.invalid',0,'2026','2026'); INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES('mapping','existing','firebase','fixture-uid','2026');");
 const key=generateKeyPairSync('ed25519'), now=Date.now(), workspaces=['solarcell','smart_home','cctv'];
 const manifest={domain:'CABMS/MODE-B/v1',operation_id:`op_${randomUUID()}`,nonce:randomUUID(),account_id:'account',target_id:'database',target_user_id:'existing',operator_email:'fixture@example.invalid',operator_uid:'fixture-uid',workspace_scope:workspaces,permitted_action:'bootstrap_super_admin',issued_at:new Date(now-60000).toISOString(),expires_at:new Date(now+300000).toISOString(),signing_key_id:'fixture-key',approval_identity:'fixture-approver'};
 const canonical=canonicalizeJson(manifest),sig=sign(null,Buffer.from(canonical),key.privateKey).toString('base64url');
 const approval=verifyModeBApproval(JSON.stringify({manifest,signature_algorithm:'Ed25519',signature_bytes:sig,signing_key_id:'fixture-key',canonical_manifest_json:canonical}),key.publicKey,{accountId:'account',databaseId:'database',userId:'existing',email:'fixture@example.invalid',uid:'fixture-uid',workspaceIds:workspaces,keyId:'fixture-key',publicKeySha256:createHash('sha256').update(key.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now});
 assert.equal((await readModeBClock(db,approval)).ok,true,'read the database clock in an in-memory test');
 const stmts=buildModeBStatements(db,approval);for(const stmt of stmts){assert.equal((stmt.query.match(/\?/g)||[]).length,stmt.params.length);assert.ok(stmt.params.length<=100);}
 assert.equal(await reconcileModeB(db,approval,{settled:false}),'INDETERMINATE');
 assert.equal(await reconcileModeB(db,approval,{settled:true}),'NOT_ENROLLED');
 await db.exec("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES('unexpected','solarcell','existing','office_staff','2026','2026')");
 assert.equal(await reconcileModeB(db,approval,{settled:false}),'INDETERMINATE');
 assert.equal(await reconcileModeB(db,approval,{settled:true}),'INCONSISTENT');
 await db.exec("DELETE FROM workspace_memberships WHERE id='unexpected'");
 const maxManifest={...manifest,workspace_scope:Array.from({length:21},(_,i)=>`workspace_${i}`)}, maxCanonical=canonicalizeJson(maxManifest);
 const maxApproval=verifyModeBApproval(JSON.stringify({manifest:maxManifest,signature_algorithm:'Ed25519',signature_bytes:sign(null,Buffer.from(maxCanonical),key.privateKey).toString('base64url'),signing_key_id:'fixture-key',canonical_manifest_json:maxCanonical}),key.publicKey,{accountId:'account',databaseId:'database',userId:'existing',email:'fixture@example.invalid',uid:'fixture-uid',workspaceIds:maxManifest.workspace_scope,keyId:'fixture-key',publicKeySha256:createHash('sha256').update(key.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now});
 const maxStatements=buildModeBStatements(db,maxApproval);assert.equal(maxStatements.length,47);
 for(const stmt of maxStatements){assert.equal((stmt.query.match(/\?/g)||[]).length,stmt.params.length);assert.ok(stmt.params.length<=100);}
 assert.equal(Math.max(...maxStatements.map(s=>s.params.length)),28);
 const nonexistent=await enrollModeBExistingUser(db,maxApproval);
 assert.equal(nonexistent.status,'NOT_ENROLLED','unknown workspace scope must fail before privileges are created');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM g01_bootstrap_completion').first<{n:number}>())?.n,0);
 const uncertain=createLocalD1Database() as LocalD1Database;
 try {
  await runLocalMigrations(uncertain,{disposableTest:true});
  await uncertain.exec("INSERT INTO users(id,email,disabled,created_at,updated_at) VALUES('existing','fixture@example.invalid',0,'2026','2026'); INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES('mapping','existing','firebase','fixture-uid','2026');");
  const original=uncertain.batch.bind(uncertain);let attempts=0;
  uncertain.batch=async statements=>{attempts++;await original(statements);throw new Error('network timeout after commit');};
  assert.equal((await enrollModeBExistingUser(uncertain,approval)).status,'INDETERMINATE');
  assert.equal(attempts,1,'a lost response must not trigger another write');
  assert.equal(await reconcileModeB(uncertain,approval,{settled:false}),'CONFIRMED_ENROLLED');
 } finally {uncertain.getSqliteHandle().close();}
 const tooMany={...manifest,workspace_scope:Array.from({length:22},(_,i)=>`workspace_${i}`)}, tooManyCanonical=canonicalizeJson(tooMany);
 assert.throws(()=>verifyModeBApproval(JSON.stringify({manifest:tooMany,signature_algorithm:'Ed25519',signature_bytes:sign(null,Buffer.from(tooManyCanonical),key.privateKey).toString('base64url'),signing_key_id:'fixture-key',canonical_manifest_json:tooManyCanonical}),key.publicKey,{accountId:'account',databaseId:'database',userId:'existing',email:'fixture@example.invalid',uid:'fixture-uid',workspaceIds:tooMany.workspace_scope,keyId:'fixture-key',publicKeySha256:createHash('sha256').update(key.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now}));
 const badCases=["UPDATE users SET email='wrong@example.invalid' WHERE id='existing'", "UPDATE users SET disabled=1 WHERE id='existing'", "UPDATE user_identity_mappings SET provider_subject_id='wrong' WHERE id='mapping'", "INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES('other','existing','other','uid2','2026')", "INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES('prior','solarcell','existing','office_staff','2026','2026')", "INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES('prior','existing','firebase','fixture-uid','solarcell','owner_admin','2026','fixture')"];
 for(const bad of badCases){const candidate=createLocalD1Database() as LocalD1Database;try{await runLocalMigrations(candidate,{disposableTest:true});await candidate.exec("INSERT INTO users(id,email,disabled,created_at,updated_at) VALUES('existing','fixture@example.invalid',0,'2026','2026'); INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES('mapping','existing','firebase','fixture-uid','2026');");await candidate.exec(bad);assert.equal(await reconcileModeB(candidate,approval,{settled:true}),'INCONSISTENT');assert.equal((await enrollModeBExistingUser(candidate,approval)).status,'NOT_ENROLLED');assert.equal((await candidate.prepare('SELECT count(*) AS n FROM g01_bootstrap_completion').first<{n:number}>())?.n,0);}finally{candidate.getSqliteHandle().close();}}
 const outcome=await enrollModeBExistingUser(db,approval);assert.equal(outcome.status,'SUCCESS');
 assert.equal(await reconcileModeB(db,approval,{settled:true}),'CONFIRMED_ENROLLED');
 assert.equal((await db.prepare("SELECT count(*) AS n FROM workspace_memberships WHERE user_id='existing'").first<{n:number}>())?.n,3);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM user_identity_mappings WHERE id='mapping'").first<{n:number}>())?.n,1);
 const originalPrepare=db.prepare.bind(db);db.prepare=()=>{throw new Error('simulated read timeout');};
 assert.equal(await reconcileModeB(db,approval,{settled:true}),'INDETERMINATE');db.prepare=originalPrepare;
 assert.equal((await enrollModeBExistingUser(db,approval)).status,'NOT_ENROLLED');
});
