/**
 * CABMS G01 — Executable Local D1 Settings-and-Audit Atomicity Proof
 *
 * Verifies the 6 mandatory invariants for Cloudflare D1 with the
 * Request-Correlation Nonce Pattern:
 * 1. Successful changes persist the correct audit evidence.
 * 2. Stale or unauthorized changes do not create successful-change audit records.
 * 3. Forced audit insertion failure rolls back the settings mutation.
 * 4. Concurrent requests cannot bypass the version guard.
 * 5. Zero-row updates and no-op requests cannot be reported as successful changes.
 * 6. Audit fields and logs do not expose secrets or disallowed legal values.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, D1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import {
  getWorkspaceSettings,
  getLegalDetails,
  updateWorkspaceSettings,
  updateLegalDetails,
  getAuditEvents,
} from '../backend/modules/settings/settingsRepo.ts';

describe('G01 D1 Atomicity & Audit Invariant Proof', () => {
  let db: D1Database;

  beforeEach(async () => {
    // Create a fresh, disposable in-memory SQLite database wrapped with D1 API
    db = createLocalD1Database(':memory:');
    await runLocalMigrations(db);
  });

  it('Invariant 1: Successful changes persist the correct audit evidence', async () => {
    const initial = await getWorkspaceSettings(db, 'solarcell');
    assert.ok(initial);
    assert.equal(initial.version, 1);
    assert.equal(initial.trading_name, 'Solarcell');

    const result = await updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: {
        trading_name: 'Solarcell Commercial',
        contact_phone: '(07) 5500 9999',
      },
      actorUserId: 'usr_super_admin',
      requestId: 'req_test_inv1',
    });

    assert.equal(result.status, 'SUCCESS');
    if (result.status !== 'SUCCESS') return;
    assert.equal(result.newVersion, 2);

    // Verify settings updated
    const updated = await getWorkspaceSettings(db, 'solarcell');
    assert.ok(updated);
    assert.equal(updated.version, 2);
    assert.equal(updated.trading_name, 'Solarcell Commercial');
    assert.equal(updated.contact_phone, '(07) 5500 9999');
    assert.equal(updated.transition_nonce, result.reqNonce);

    // Verify audit event persisted
    const auditEvents = await getAuditEvents(db, 'solarcell', 'workspace_settings');
    assert.equal(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.equal(event.id, result.auditEventId);
    assert.equal(event.workspace_id, 'solarcell');
    assert.equal(event.resource_type, 'workspace_settings');
    assert.equal(event.event_type, 'SETTINGS_UPDATED');
    assert.equal(event.old_version, 1);
    assert.equal(event.new_version, 2);
    assert.equal(event.actor_user_id, 'usr_super_admin');
    assert.equal(event.request_id, 'req_test_inv1');
    assert.equal(event.transition_nonce, result.reqNonce);

    const oldVals = JSON.parse(event.old_values);
    const newVals = JSON.parse(event.new_values);
    assert.equal(oldVals.trading_name, 'Solarcell');
    assert.equal(oldVals.contact_phone, '[REDACTED]', 'Sensitive contact_phone must be redacted in old_values');
    assert.equal(newVals.trading_name, 'Solarcell Commercial');
    assert.equal(newVals.contact_phone, '[REDACTED]', 'Sensitive contact_phone must be redacted in new_values');
  });

  it('Invariant 2: Stale changes do not create successful-change audit records', async () => {
    // Advance version to 2
    await updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: { trading_name: 'Solarcell v2' },
      actorUserId: 'usr_super_admin',
      requestId: 'req_v1_to_v2',
    });

    const auditBefore = await getAuditEvents(db, 'solarcell');
    assert.equal(auditBefore.length, 1);

    // Attempt update with STALE expectedVersion = 1
    const staleResult = await updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1, // Stale! Current is 2
      patch: { trading_name: 'Solarcell Stale Overwrite' },
      actorUserId: 'usr_owner_admin',
      requestId: 'req_stale',
    });

    assert.equal(staleResult.status, 'PRECONDITION_FAILED');

    // Confirm database unchanged
    const current = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(current?.version, 2);
    assert.equal(current?.trading_name, 'Solarcell v2');

    // Confirm NO audit event was inserted
    const auditAfter = await getAuditEvents(db, 'solarcell');
    assert.equal(auditAfter.length, 1);
    assert.equal(auditAfter[0].new_version, 2);
  });

  it('Invariant 3: Forced audit insertion failure rolls back the settings mutation', async () => {
    const beforeSettings = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(beforeSettings?.version, 1);
    assert.equal(beforeSettings?.trading_name, 'Solarcell');

    // Attempt update with forced audit failure (violates NOT NULL constraint)
    await assert.rejects(
      async () => {
        await updateWorkspaceSettings(db, {
          workspaceId: 'solarcell',
          expectedVersion: 1,
          patch: { trading_name: 'Failed Mutation Attempt' },
          actorUserId: 'usr_super_admin',
          requestId: 'req_forced_fail',
          forcedAuditFailure: true,
        });
      },
      /NOT NULL constraint failed|constraint/i
    );

    // Verify ROLLBACK: workspace_settings must be in its original unmutated state!
    const afterSettings = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(afterSettings?.version, 1, 'Version must remain 1 after rollback');
    assert.equal(afterSettings?.trading_name, 'Solarcell', 'Trading name must not have mutated');
    assert.equal(afterSettings?.transition_nonce, null, 'Nonce must remain null after rollback');

    // Verify no audit records exist
    const auditEvents = await getAuditEvents(db, 'solarcell');
    assert.equal(auditEvents.length, 0, 'No audit events may exist after rollback');
  });

  it('Invariant 4: Concurrent requests cannot bypass the version guard', async () => {
    // Initial version is 1
    const current = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(current?.version, 1);

    // Launch two simultaneous updates both targeting expectedVersion = 1
    const req1 = updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: { trading_name: 'Concurrent Request 1' },
      actorUserId: 'usr_super_admin',
      requestId: 'req_concurrent_1',
    });

    const req2 = updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: { trading_name: 'Concurrent Request 2' },
      actorUserId: 'usr_owner_admin',
      requestId: 'req_concurrent_2',
    });

    const [res1, res2] = await Promise.all([req1, req2]);

    // Exactly one must succeed and one must fail precondition
    const successes = [res1, res2].filter(r => r.status === 'SUCCESS');
    const failures = [res1, res2].filter(r => r.status === 'PRECONDITION_FAILED');

    assert.equal(successes.length, 1, 'Exactly one concurrent request must succeed');
    assert.equal(failures.length, 1, 'The competing concurrent request must fail with PRECONDITION_FAILED');

    // Final version must be 2, not 3
    const finalSettings = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(finalSettings?.version, 2);

    // Exactly one audit event must exist
    const auditEvents = await getAuditEvents(db, 'solarcell');
    assert.equal(auditEvents.length, 1);
    assert.equal(auditEvents[0].new_version, 2);
  });

  it('Invariant 5: Zero-row updates and no-op requests cannot be reported as successful changes', async () => {
    // 5a. Non-existent workspace
    const missingRes = await updateWorkspaceSettings(db, {
      workspaceId: 'unknown_workspace',
      expectedVersion: 1,
      patch: { trading_name: 'Ghost' },
      actorUserId: 'usr_super_admin',
      requestId: 'req_missing',
    });
    assert.equal(missingRes.status, 'NOT_FOUND');

    // 5b. No-op request (submitting identical values)
    const current = (await getWorkspaceSettings(db, 'solarcell'))!;
    const noopRes = await updateWorkspaceSettings(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: {
        trading_name: current.trading_name, // identical
        contact_phone: current.contact_phone, // identical
      },
      actorUserId: 'usr_super_admin',
      requestId: 'req_noop',
    });

    assert.equal(noopRes.status, 'NO_OP');
    if (noopRes.status === 'NO_OP') {
      assert.equal(noopRes.version, 1, 'Version must not increment on NO_OP');
    }

    // Verify version is still 1 and no audit event was created
    const postSettings = await getWorkspaceSettings(db, 'solarcell');
    assert.equal(postSettings?.version, 1);

    const auditEvents = await getAuditEvents(db, 'solarcell');
    assert.equal(auditEvents.length, 0, 'No audit event may be created on NO_OP');
  });

  it('Invariant 6: Audit fields and logs do not expose secrets or disallowed legal values', async () => {
    const initialLegal = await getLegalDetails(db, 'solarcell');
    assert.ok(initialLegal);
    assert.equal(initialLegal.version, 1);

    const result = await updateLegalDetails(db, {
      workspaceId: 'solarcell',
      expectedVersion: 1,
      patch: {
        legal_issuer_name: 'Solarcell Technologies Pty Ltd (Verified)',
        abn: '12 345 678 901',
        electrical_licence: 'Q-ELEC-99999',
      },
      actorUserId: 'usr_super_admin',
      requestId: 'req_legal_privacy',
    });

    assert.equal(result.status, 'SUCCESS');
    if (result.status !== 'SUCCESS') return;

    // Database record stores the updated legal details
    const updatedLegal = await getLegalDetails(db, 'solarcell');
    assert.equal(updatedLegal?.legal_issuer_name, 'Solarcell Technologies Pty Ltd (Verified)');
    assert.equal(updatedLegal?.abn, '12 345 678 901');
    assert.equal(updatedLegal?.electrical_licence, 'Q-ELEC-99999');
    assert.equal(updatedLegal?.version, 2);

    // Audit event MUST REDACT raw ABN and electrical licence!
    const auditEvents = await getAuditEvents(db, 'solarcell', 'legal_issuer');
    assert.equal(auditEvents.length, 1);
    const event = auditEvents[0];
    assert.equal(event.event_type, 'LEGAL_DETAILS_UPDATED');

    const oldVals = JSON.parse(event.old_values);
    const newVals = JSON.parse(event.new_values);

    // Issuer name is recorded
    assert.equal(newVals.legal_issuer_name, 'Solarcell Technologies Pty Ltd (Verified)');

    // Raw ABN and Licence numbers are REDACTED
    assert.equal(newVals.abn, '[REDACTED]', 'Raw ABN must be redacted in audit event');
    assert.equal(newVals.electrical_licence, '[REDACTED]', 'Raw licence must be redacted in audit event');
    assert.doesNotMatch(event.new_values, /12 345 678 901/, 'Raw ABN must never appear in audit JSON string');
    assert.doesNotMatch(event.new_values, /Q-ELEC-99999/, 'Raw licence must never appear in audit JSON string');

    // Check no tokens, passwords or credentials
    assert.equal(newVals.password, undefined);
    assert.equal(newVals.token, undefined);
    assert.equal(newVals.secret, undefined);
  });

  it('Invariant 7: Independent versioning between Workspace Settings and Legal Details', async () => {
    // Initial: both at version 1
    const s1 = await getWorkspaceSettings(db, 'smart_home');
    const l1 = await getLegalDetails(db, 'smart_home');
    assert.equal(s1?.version, 1);
    assert.equal(l1?.version, 1);

    // Update settings only
    await updateWorkspaceSettings(db, {
      workspaceId: 'smart_home',
      expectedVersion: 1,
      patch: { trading_name: 'Smart Home Automation' },
      actorUserId: 'usr_owner_admin',
      requestId: 'req_indep_1',
    });

    const s2 = await getWorkspaceSettings(db, 'smart_home');
    const l2 = await getLegalDetails(db, 'smart_home');
    assert.equal(s2?.version, 2, 'Workspace settings version must advance to 2');
    assert.equal(l2?.version, 1, 'Legal details version must remain 1');

    // Update legal details only
    await updateLegalDetails(db, {
      workspaceId: 'smart_home',
      expectedVersion: 1,
      patch: { legal_issuer_name: 'Gold Coast Smart Home Systems Pty Ltd' },
      actorUserId: 'usr_super_admin',
      requestId: 'req_indep_2',
    });

    const s3 = await getWorkspaceSettings(db, 'smart_home');
    const l3 = await getLegalDetails(db, 'smart_home');
    assert.equal(s3?.version, 2, 'Workspace settings version must remain 2');
    assert.equal(l3?.version, 2, 'Legal details version must advance to 2');
  });
});
