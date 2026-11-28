import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {createLocalD1Database,type LocalD1Database} from '../backend/db/d1.ts';
import {runLocalMigrations} from '../backend/db/migrate.ts';
import {canonicalizeJson} from '../scripts/p0/approvalManifest.ts';
import {verifyModeBApproval} from '../scripts/p0/modeBContract.ts';
import {buildLocalDevBootstrapStatements} from '../scripts/p0/localDevBootstrap.ts';

test('IN-MEMORY ONLY: local bootstrap preserves identity and rolls back a conflicting mapping',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());await runLocalMigrations(db,{disposableTest:true});
 const keys=generateKeyPairSync('ed25519'),now=Date.now(),scope=['solarcell','smart_home','cctv'];
 const m={domain:'CABMS/MODE-B/v1',operation_id:`op_${randomUUID()}`,nonce:randomUUID(),account_id:'LOCAL-DEVELOPMENT-ONLY',target_id:'local-cabms-db',target_user_id:'usr_primary_super_admin',operator_email:'fixture@example.invalid',operator_uid:'fixture-uid',workspace_scope:scope,permitted_action:'bootstrap_super_admin',issued_at:new Date(now-60000).toISOString(),expires_at:new Date(now+300000).toISOString(),signing_key_id:'LOCAL-TEST-KEY',approval_identity:'LOCAL-TEST-ONLY-NOT-CLOUD'};
 const canonical=canonicalizeJson(m),signature=sign(null,Buffer.from(canonical),keys.privateKey).toString('base64url');
 const approval=verifyModeBApproval(JSON.stringify({manifest:m,signature_algorithm:'Ed25519',signature_bytes:signature,signing_key_id:m.signing_key_id,canonical_manifest_json:canonical}),keys.publicKey,{accountId:m.account_id,databaseId:m.target_id,userId:m.target_user_id,email:m.operator_email,uid:m.operator_uid,workspaceIds:scope,keyId:m.signing_key_id,publicKeySha256:createHash('sha256').update(keys.publicKey.export({type:'spki',format:'der'})).digest('hex'),nowMs:now});
 await db.exec("INSERT INTO users(id,email,disabled,created_at,updated_at) VALUES('other','other@example.invalid',0,'2026','2026'); INSERT INTO user_identity_mappings(id,user_id,provider_id,provider_subject_id,created_at) VALUES('conflict','other','firebase','fixture-uid','2026');");
 await assert.rejects(()=>db.batch(buildLocalDevBootstrapStatements(db,approval)));
 assert.equal((await db.prepare("SELECT count(*) AS n FROM users WHERE id='usr_primary_super_admin'").first<{n:number}>())?.n,0);
 await db.exec("DELETE FROM user_identity_mappings WHERE id='conflict'");
 await db.batch(buildLocalDevBootstrapStatements(db,approval));
 assert.equal((await db.prepare("SELECT count(*) AS n FROM workspace_memberships WHERE user_id='usr_primary_super_admin' AND role='super_admin'").first<{n:number}>())?.n,3);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM g01_bootstrap_completion').first<{n:number}>())?.n,1);
});
