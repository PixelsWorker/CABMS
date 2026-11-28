import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { signApprovalManifest, type ApprovalManifest } from '../scripts/p0/approvalManifest.ts';
import { verifyCloudEnrollmentPreflight } from '../scripts/p0/cloudEnrollmentPreflight.ts';

test('cloud preflight binds signed approval to target, identity and full workspace scope', () => {
 const keys=generateKeyPairSync('ed25519');
 const manifest:ApprovalManifest={operation_id:'op_11111111-1111-4111-8111-111111111111',nonce:'nonce-1',target_id:'bd4b58de-1c1c-4cad-a9bc-a34757546081',operator_email:'admin@example.invalid',operator_uid:'firebase-uid',workspace_scope:['solarcell','smart_home','cctv'],permitted_action:'bootstrap_super_admin',issued_at:'2026-11-23T00:00:00Z',expires_at:'2026-11-24T00:00:00Z',signing_key_id:'test-key',approval_identity:'test-approver'};
 const expected={databaseId:manifest.target_id,operatorEmail:manifest.operator_email,operatorUid:manifest.operator_uid,signingKeyId:'test-key',workspaceIds:['solarcell','smart_home','cctv'],nowMs:Date.parse('2026-11-23T12:00:00Z')};
 const signed=signApprovalManifest(manifest,keys.privateKey);
 assert.equal(verifyCloudEnrollmentPreflight(signed,keys.publicKey,expected).manifest.target_id,manifest.target_id);
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,keys.publicKey,{...expected,databaseId:'other'}));
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,keys.publicKey,{...expected,operatorUid:'other'}));
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,keys.publicKey,{...expected,signingKeyId:'other'}));
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,keys.publicKey,{...expected,workspaceIds:['solarcell']}));
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,keys.publicKey,{...expected,nowMs:Date.parse('2026-11-25T00:00:00Z')}));
 assert.throws(()=>verifyCloudEnrollmentPreflight(signed,generateKeyPairSync('ed25519').publicKey,expected));
});
