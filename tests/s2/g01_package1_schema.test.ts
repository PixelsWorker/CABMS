// Proposal: execute only with separately authorized disposable SQLite tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, LocalD1Database } from '../../backend/db/d1.ts';
import { loadVerifiedMigrations, planLocalMigrations, runLocalMigrations } from '../../backend/db/migrate.ts';

async function setup() {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await db.exec("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('schema_owner','schema-owner@example.invalid','Schema test','2026','2026')");
    return db;
  } catch (error) { db.getSqliteHandle().close(); throw error; }
}
const identity = "INSERT INTO g01_protected_super_admin(singleton,user_id,provider_id,provider_subject_id,assigned_at,assigned_by) VALUES (1,'schema_owner','firebase','original_uid','2026','operator')";
const marker = "INSERT INTO g01_bootstrap_completion(singleton,original_firebase_uid,completed_at,completed_by,operation_id,request_id,audit_reference) VALUES (1,'original_uid','2026','operator','bootstrap_op','bootstrap_req','bootstrap_audit')";
const conflictForms = (sql: string, update: string) => [
  sql, sql.replace('INSERT INTO', 'INSERT OR REPLACE INTO'), sql.replace('INSERT INTO', 'INSERT OR IGNORE INTO'),
  sql.replace('INSERT INTO', 'INSERT OR FAIL INTO'), sql.replace('INSERT INTO', 'INSERT OR ROLLBACK INTO'),
  `${sql} ON CONFLICT DO UPDATE SET ${update}`, `${sql} ON CONFLICT DO NOTHING`,
];
async function rows(db: LocalD1Database, table: string) {
  const result = await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
  return JSON.stringify(result.results);
}
async function databaseState(db: LocalD1Database) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all<{name:string}>();
  const result: Record<string,string> = {};
  for (const {name} of tables.results) {
    assert.match(name, /^[a-zA-Z0-9_]+$/);
    result[name] = await rows(db, name);
  }
  return JSON.stringify(result);
}
const securityErrors: Record<string, readonly string[]> = {
  g01_protected_super_admin: ['protected identity already exists', 'protected identity is immutable', 'protected authority cannot be deleted'],
  g01_bootstrap_completion: ['bootstrap completion already exists', 'bootstrap identity mismatch', 'bootstrap completion is immutable'],
  g01_super_admin_recovery_events: ['invalid recovery data', 'recovery replay key already exists', 'bootstrap reference missing', 'invalid recovery sequence', 'invalid prior uid', 'recovery uid cannot be reused', 'recovery history is immutable'],
  privileged_identity_approvals: ['approval history key already exists', 'approval may only be revoked once', 'approval history cannot be deleted', 'super admin approval does not match protected identity'],
};
async function rejectedUnchanged(db: LocalD1Database, sql: string, table: string) {
  const before = await databaseState(db);
  const expected = securityErrors[table];
  assert.ok(expected, `no expected security errors for ${table}`);
  await assert.rejects(() => db.exec(sql), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(expected.some(message => error.message.includes(message)), `unexpected SQL error: ${error.message}`);
    return true;
  });
  assert.equal(await databaseState(db), before, `state changed after: ${sql}`);
}
function event(seq: number, previous: number, prior: string, next: string, op: string, req: string, audit: string) {
  return `INSERT INTO g01_super_admin_recovery_events (seq,previous_seq,operation_id,request_id,prior_uid,replacement_uid,operator_identity,reason,occurred_at,bootstrap_operation_id,audit_reference) VALUES (${seq},${previous},'${op}','${req}','${prior}','${next}','operator','replacement','2026','bootstrap_op','${audit}')`;
}
async function effective(db: LocalD1Database) {
  return (await db.prepare('SELECT provider_subject_id FROM g01_effective_super_admin_uid').first<{provider_subject_id:string}>())?.provider_subject_id;
}

test('protected identity and marker reject every replacement and conflict policy', async () => {
  const db = await setup();
  try {
    await rejectedUnchanged(db, marker, 'g01_bootstrap_completion');
    await db.exec(identity);
    for (const sql of conflictForms(identity, "provider_subject_id = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_protected_super_admin');
    for (const sql of conflictForms(identity.replace('original_uid', 'other_uid'), "provider_subject_id = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_protected_super_admin');
    await rejectedUnchanged(db, "UPDATE g01_protected_super_admin SET provider_subject_id = 'other_uid'", 'g01_protected_super_admin');
    await rejectedUnchanged(db, 'DELETE FROM g01_protected_super_admin', 'g01_protected_super_admin');
    await db.exec(marker);
    for (const sql of conflictForms(marker, "original_firebase_uid = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_bootstrap_completion');
    for (const sql of conflictForms(marker.replace('original_uid', 'other_uid'), "original_firebase_uid = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_bootstrap_completion');
    await rejectedUnchanged(db, "UPDATE g01_bootstrap_completion SET original_firebase_uid = 'other_uid'", 'g01_bootstrap_completion');
    await rejectedUnchanged(db, 'DELETE FROM g01_bootstrap_completion', 'g01_bootstrap_completion');
    assert.equal(await effective(db), 'original_uid');
  } finally { db.getSqliteHandle().close(); }
});

test('recovery chain rejects malformed, conflicting and replayed transitions without state changes', async () => {
  const db = await setup();
  try {
    await db.exec(identity);
    await rejectedUnchanged(db, event(1, 0, 'original_uid', 'uid_1', 'op_1', 'req_1', 'audit_1'), 'g01_super_admin_recovery_events');
    await db.exec(marker);
    await db.exec(event(1, 0, 'original_uid', 'uid_1', 'op_1', 'req_1', 'audit_1'));
    assert.equal(await effective(db), 'uid_1');
    await db.exec(event(2, 1, 'uid_1', 'uid_2', 'op_2', 'req_2', 'audit_2'));
    assert.equal(await effective(db), 'uid_2');
    const recoveredApproval = "INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES ('recovered_approval','schema_owner','firebase','uid_2','solarcell','super_admin','2026','operator')";
    await rejectedUnchanged(db, recoveredApproval.replace('uid_2', 'original_uid'), 'privileged_identity_approvals');
    await db.exec(recoveredApproval);
    assert.equal((await db.prepare("SELECT provider_subject_id FROM privileged_identity_approvals WHERE id = 'recovered_approval'").first<{provider_subject_id:string}>())?.provider_subject_id, 'uid_2');
    const originalMarker = await rows(db, 'g01_bootstrap_completion');
    const bad = [
      event(4, 2, 'uid_2', 'uid_4', 'op_4', 'req_4', 'audit_4'),
      event(2, 1, 'uid_1', 'uid_other', 'op_other', 'req_other', 'audit_other'),
      event(-1, 2, 'uid_2', 'uid_negative', 'op_neg', 'req_neg', 'audit_neg'),
      event(3, 1, 'uid_2', 'uid_3', 'op_3', 'req_3', 'audit_3'),
      event(3, 2, 'wrong_uid', 'uid_3', 'op_3', 'req_3', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_2', 'op_3', 'req_3', 'audit_3'),
      event(3, 2, 'uid_2', 'original_uid', 'op_3', 'req_3', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_3', 'op_1', 'req_3', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_3', 'op_3', 'req_1', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_3', 'op_3', 'req_3', 'audit_1'),
      event(3, 2, 'uid_2', 'uid_3', 'bootstrap_op', 'req_3', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_3', 'op_3', 'bootstrap_req', 'audit_3'),
      event(3, 2, 'uid_2', 'uid_3', 'op_3', 'req_3', 'bootstrap_audit'),
      event(3, 2, 'uid_2', '', 'op_3', 'req_3', 'audit_3'),
    ];
    for (const candidate of bad) for (const sql of conflictForms(candidate, "replacement_uid = 'hijack'")) {
      await rejectedUnchanged(db, sql, 'g01_super_admin_recovery_events');
      assert.equal(await rows(db, 'g01_bootstrap_completion'), originalMarker);
      assert.equal(await effective(db), 'uid_2');
    }
    await rejectedUnchanged(db, "UPDATE g01_super_admin_recovery_events SET replacement_uid = 'hijack'", 'g01_super_admin_recovery_events');
    await rejectedUnchanged(db, 'DELETE FROM g01_super_admin_recovery_events', 'g01_super_admin_recovery_events');
    const proposals = await Promise.allSettled([
      db.exec(event(3, 2, 'uid_2', 'uid_3a', 'op_3a', 'req_3a', 'audit_3a')),
      db.exec(event(3, 2, 'uid_2', 'uid_3b', 'op_3b', 'req_3b', 'audit_3b')),
    ]);
    assert.equal(proposals.filter(p => p.status === 'fulfilled').length, 1);
    assert.equal(proposals.filter(p => p.status === 'rejected').length, 1);
    const failed = proposals.find(p => p.status === 'rejected');
    assert.ok(failed && failed.status === 'rejected' && failed.reason instanceof Error);
    assert.ok(['recovery replay key already exists', 'invalid recovery sequence'].some(message => failed.reason.message.includes(message)));
    assert.ok(['uid_3a', 'uid_3b'].includes((await effective(db)) ?? ''));
    assert.equal(await rows(db, 'g01_bootstrap_completion'), originalMarker);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM g01_super_admin_recovery_events').first<{n:number}>())?.n, 3);
  } finally { db.getSqliteHandle().close(); }
});

test('migration planning keeps a later migration after the atomic 0006/0007 pair', () => {
  const names = ['0005_before.sql', '0006_g01_privileged_identity_approvals.sql', '0007_g01_bootstrap_completion.sql', '0008_future.sql'];
  const plan = planLocalMigrations(names.map(name => ({ name, bytes: Buffer.from(name) })));
  assert.deepEqual(plan.before.map(item => item.name), [names[0]]);
  assert.deepEqual(plan.pair.map(item => item.name), [names[1], names[2]]);
  assert.deepEqual(plan.after.map(item => item.name), [names[3]]);
  assert.throws(() => planLocalMigrations([names[1], names[0], names[2]].map(name => ({name, bytes: Buffer.alloc(0)}))), /adjacent/);
});

test('approval history cannot be replaced through ID or the active-approval unique index', async () => {
  const db = await setup();
  try {
    const approval = "INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES ('approval_1','schema_owner','firebase','owner_uid','solarcell','owner_admin','2026','operator')";
    await db.exec(approval);
    for (const sql of conflictForms(approval, "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    for (const sql of conflictForms(approval.replace('approval_1', 'approval_other'), "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    await rejectedUnchanged(db, "UPDATE privileged_identity_approvals SET granted_by = 'other' WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await rejectedUnchanged(db, "DELETE FROM privileged_identity_approvals WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await db.exec("UPDATE privileged_identity_approvals SET revoked_at = '2026', revoked_by = 'operator' WHERE id = 'approval_1'");
    for (const sql of conflictForms(approval, "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    await rejectedUnchanged(db, "UPDATE privileged_identity_approvals SET revoked_at = NULL, revoked_by = NULL WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await db.exec(approval.replace('approval_1', 'approval_2'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals').first<{n:number}>())?.n, 2);
    await rejectedUnchanged(db, "DELETE FROM privileged_identity_approvals WHERE id = 'approval_1'", 'privileged_identity_approvals');
  } finally { db.getSqliteHandle().close(); }
});

test('0006 independently protects singleton and approval history with a test-only 0007 view stub', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    // Verified snapshots are executed only on this fresh, private in-memory DB.
    const snapshots = loadVerifiedMigrations();
    assert.equal(snapshots[5]?.name, '0006_g01_privileged_identity_approvals.sql');
    for (const snapshot of snapshots.slice(0, 6)) await db.exec(snapshot.bytes.toString('utf8'));
    // 0006's Super Admin insertion trigger refers to the view introduced in
    // 0007. This empty test-only stub isolates 0006; it is not D1 proof.
    await db.exec('CREATE VIEW g01_effective_super_admin_uid AS SELECT CAST(NULL AS TEXT) AS provider_subject_id WHERE 0');
    await db.exec("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ('schema_owner','schema-owner@example.invalid','Schema test','2026','2026')");
    await db.exec(identity);
    for (const sql of conflictForms(identity, "provider_subject_id = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_protected_super_admin');
    for (const sql of conflictForms(identity.replace('original_uid', 'other_uid'), "provider_subject_id = 'other_uid'")) await rejectedUnchanged(db, sql, 'g01_protected_super_admin');
    await rejectedUnchanged(db, "UPDATE g01_protected_super_admin SET provider_subject_id = 'other_uid'", 'g01_protected_super_admin');
    await rejectedUnchanged(db, 'DELETE FROM g01_protected_super_admin', 'g01_protected_super_admin');
    const approval = "INSERT INTO privileged_identity_approvals(id,user_id,provider_id,provider_subject_id,workspace_id,role,granted_at,granted_by) VALUES ('approval_1','schema_owner','firebase','owner_uid','solarcell','owner_admin','2026','operator')";
    await db.exec(approval);
    for (const sql of conflictForms(approval, "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    for (const sql of conflictForms(approval.replace('approval_1', 'approval_other'), "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    await rejectedUnchanged(db, "UPDATE privileged_identity_approvals SET granted_by = 'other' WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await rejectedUnchanged(db, "DELETE FROM privileged_identity_approvals WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await db.exec("UPDATE privileged_identity_approvals SET revoked_at = '2026', revoked_by = 'operator' WHERE id = 'approval_1'");
    for (const sql of conflictForms(approval, "granted_by = 'other'")) await rejectedUnchanged(db, sql, 'privileged_identity_approvals');
    await rejectedUnchanged(db, "UPDATE privileged_identity_approvals SET revoked_at = NULL, revoked_by = NULL WHERE id = 'approval_1'", 'privileged_identity_approvals');
    await db.exec(approval.replace('approval_1', 'approval_2'));
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals').first<{n:number}>())?.n, 2);
    await rejectedUnchanged(db, "DELETE FROM privileged_identity_approvals WHERE id = 'approval_1'", 'privileged_identity_approvals');
  } finally { db.getSqliteHandle().close(); }
});

test('local runner rolls back the 0006/0007 pair on a statement failure', async () => {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    const exec = db.exec.bind(db);
    let intercepted = false;
    db.exec = async (sql: string) => {
      if (sql.startsWith('BEGIN TRANSACTION;') && sql.includes('CREATE TABLE g01_bootstrap_completion')) {
        intercepted = true;
        assert.ok(sql.endsWith('COMMIT;'));
        return exec(sql.replace(/COMMIT;$/, 'INSERT INTO g01_nonexistent_test_table VALUES (1); COMMIT;'));
      }
      return exec(sql);
    };
    await assert.rejects(() => runLocalMigrations(db, { disposableTest: true }), /no such table: g01_nonexistent_test_table/);
    assert.equal(intercepted, true, 'must intercept the combined migration pair');
    const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('g01_protected_super_admin','privileged_identity_approvals','g01_bootstrap_completion','g01_super_admin_recovery_events')").all();
    assert.deepEqual(tables.results, []);
  } finally { db.getSqliteHandle().close(); }
});
