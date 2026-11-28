import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createLocalD1Database,type LocalD1Database} from '../backend/db/d1.ts';
import {runLocalMigrations} from '../backend/db/migrate.ts';
import {canonicalizeJson} from '../scripts/p0/approvalManifest.ts';
import {verifyModeBApproval} from '../scripts/p0/modeBContract.ts';
import {executeLocalEnrollment} from '../scripts/p0/adminEnrollmentEngine.ts';

test('shared enrollment rejects wrong identity and reconciles a lost commit response without retry',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());await runLocalMigrations(db,{disposableTest:true});
 const key=generateKeyPairSync('ed25519'),now=Date.now(),scope=['solarcell','smart_home','cctv'];
 const m={domain:'CABMS/MODE-B/v1',operation_id:`op_${randomUUID()}`,nonce:randomUUID(),account_id:'LOCAL-DEVELOPMENT-ONLY',target_id:'local-cabms-db',target_user_id:'usr_primary_super_admin',operator_email:'fixture@example.invalid',operator_uid:'fixture-uid',workspace_scope:scope,permitted_action:'bootstrap_super_admin',issued_at:new Date(now-60000).toISOString(),expires_at:new Date(now+300000).toISOString(),signing_key_id:'LOCAL-TEST-KEY',approval_identity:'LOCAL-TEST-ONLY-NOT-CLOUD'};
 const canonical=canonicalizeJson(m),signature=sign(null,Buffer.from(canonical),key.privateKey).toString('base64url');
 const approval=verifyModeBApproval(JSON.stringify({manifest:m,signature_algorithm:'Ed25519',signature_bytes:signature,signing_key_id:m.signing_key_id,canonical_manifest_json:canonical}),key.publicKey,{accountId:m.account_id,databaseId:m.target_id,userId:m.target_user_id,email:m.operator_email,uid:m.operator_uid,workspaceIds:scope,keyId:m.signing_key_id,publicKeySha256:createHash('sha256').update(key.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now});
 assert.equal((await executeLocalEnrollment(db,approval,{email:m.operator_email,uid:'wrong'})).status,'REJECTED');
 assert.equal((await db.prepare('SELECT count(*) AS n FROM users WHERE id=?').bind(m.target_user_id).first<{n:number}>())?.n,0);
 let attempts=0;const original=db.batch.bind(db);db.batch=async statements=>{attempts++;await original(statements);throw new Error('lost response');};
 assert.equal((await executeLocalEnrollment(db,approval,{email:m.operator_email,uid:m.operator_uid})).status,'CONFIRMED_ENROLLED');
 assert.equal(attempts,1);
 assert.equal((await db.prepare("SELECT count(*) AS n FROM workspace_memberships WHERE user_id=? AND role='super_admin'").bind(m.target_user_id).first<{n:number}>())?.n,3);
});
