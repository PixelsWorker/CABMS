/**
 * S2 proposal: denied Firebase email linking must not persist a mapping.
 * Run only after separate approval, against fresh disposable in-memory D1.
 * Uses the S1b fixture-owned transport and authentication service.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createLocalD1Database, LocalD1Database, type D1Database, type D1PreparedStatement } from '../../backend/db/d1.ts';
import { runLocalMigrations } from '../../backend/db/migrate.ts';
import { createWorker } from '../../backend/index.ts';
import { createAuthenticationService } from '../../backend/workers/auth.ts';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';

type Snapshot = Record<string, string[]>;
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

async function snapshot(db: D1Database): Promise<Snapshot> {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all<{ name: string }>();
  const state: Snapshot = {};
  for (const { name } of tables.results) {
    const rows = await db.prepare(`SELECT * FROM ${quote(name)}`).all();
    state[name] = rows.results.map(row => JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? value.toString() : value)).sort();
  }
  return state;
}

async function firebaseMappings(db: D1Database, uid: string): Promise<Array<{ user_id: string; provider_subject_id: string }>> {
  const rows = await db.prepare("SELECT user_id, provider_subject_id FROM user_identity_mappings WHERE provider_id = 'firebase' AND provider_subject_id = ? ORDER BY user_id")
    .bind(uid).all<{ user_id: string; provider_subject_id: string }>();
  return rows.results.map(row => ({ user_id: row.user_id, provider_subject_id: row.provider_subject_id }));
}

async function userFirebaseMappings(db: D1Database, userId: string): Promise<Array<{ provider_subject_id: string }>> {
  const rows = await db.prepare("SELECT provider_subject_id FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ? ORDER BY provider_subject_id")
    .bind(userId).all<{ provider_subject_id: string }>();
  return rows.results.map(row => ({ provider_subject_id: row.provider_subject_id }));
}

/** Proves the test target has an exact email, one staff role, and no privileged role. */
async function assertEligibleStaff(db: D1Database, userId: string, email: string, disabled: number): Promise<void> {
  const user = await db.prepare('SELECT email, disabled FROM users WHERE id = ?').bind(userId).first<{ email: string; disabled: number }>();
  assert.ok(user);
  assert.equal(user.email, email);
  assert.equal(user.disabled, disabled);
  const memberships = await db.prepare('SELECT role FROM workspace_memberships WHERE user_id = ? ORDER BY role').bind(userId).all<{ role: string }>();
  assert.deepEqual(memberships.results.map(row => row.role), [userId === G01_TEST_AUTH.officeStaff.userId ? 'office_staff' : 'technician']);
}

async function harness() {
  const db = createLocalD1Database() as LocalD1Database;
  try {
    await runLocalMigrations(db, { disposableTest: true });
    await installG01TestAuthFixtures(db);
    const fixture = await createFirebaseFixture();
    const worker = createWorker(createAuthenticationService(fixture.transport));
    return { db, fixture, worker, close: () => db.getSqliteHandle().close() };
  } catch (error) {
    db.getSqliteHandle().close();
    throw error;
  }
}

async function request(h: Awaited<ReturnType<typeof harness>>, db: D1Database, uid: string, email: string, emailVerified = true): Promise<Response> {
  const token = await h.fixture.token(uid, email, { email_verified: emailVerified });
  return h.worker.fetch(new Request('http://localhost/api/v1/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  }), { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' });
}

/** Inject a deterministic state change immediately before a mapping INSERT runs. */
function beforeMappingInsert(db: D1Database, hook: () => Promise<void>): D1Database {
  let fired = false;
  const isMappingInsert = (query: string) => /\binsert\b[\s\S]*\buser_identity_mappings\b/i.test(query);
  const fire = async () => { if (!fired) { fired = true; await hook(); } };
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => new Proxy(stmt, {
    get(target, property) {
      if (property === 'bind') return (...values: unknown[]) => wrap(target.bind(...values));
      if (property === 'run' && isMappingInsert(target.query)) return async () => { await fire(); return target.run(); };
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return {
    prepare: (query: string) => wrap(db.prepare(query)),
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      if (statements.some(stmt => isMappingInsert(stmt.query))) await fire();
      return db.batch<T>(statements);
    },
    exec: sql => db.exec(sql),
    dump: () => db.dump(),
  };
}

describe('S2: Firebase email linking and denied-request state', { concurrency: false }, () => {
  test('disabled unmapped staff with verified email returns 401 without writing', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 1);
      const uid = 'test_s2_denied_disabled_unmapped';
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), []);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      const before = await snapshot(h.db);
      assert.equal((await request(h, h.db, uid, staff.email)).status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('disabled staff with an existing mapping cannot link a second UID', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      await h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 1);
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), [{ provider_subject_id: staff.uid }]);
      const uid = 'test_s2_denied_second_uid';
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      const before = await snapshot(h.db);
      assert.equal((await request(h, h.db, uid, staff.email)).status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), [{ provider_subject_id: staff.uid }]);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('enabled unmapped staff with unverified email is denied without writing', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.technician;
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 0);
      const uid = 'test_s2_denied_unverified';
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), []);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      const before = await snapshot(h.db);
      assert.equal((await request(h, h.db, uid, staff.email, false)).status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('enabled unmapped staff with verified email links to the exact user', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.technician;
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 0);
      const uid = 'test_s2_allowed_staff';
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), []);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      const response = await request(h, h.db, uid, staff.email);
      assert.equal(response.status, 200);
      const body = await response.json() as { user: { id: string }; memberships: Array<{ workspace_id: string; role: string }> };
      assert.equal(body.user.id, staff.userId);
      assert.equal(body.memberships.length, 1);
      assert.equal(body.memberships[0].workspace_id, 'solarcell');
      assert.equal(body.memberships[0].role, 'technician');
      assert.deepEqual(await firebaseMappings(h.db, uid), [{ user_id: staff.userId, provider_subject_id: uid }]);
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), [{ provider_subject_id: uid }]);
    } finally { h.close(); }
  });

  test('disabled account with an existing UID is denied without changing its mapping', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      await h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 1);
      const before = await snapshot(h.db);
      assert.equal((await request(h, h.db, staff.uid, staff.email)).status, 401);
      assert.deepEqual(await firebaseMappings(h.db, staff.uid), [{ user_id: staff.userId, provider_subject_id: staff.uid }]);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('privileged verified email cannot create a new Firebase mapping', async () => {
    const h = await harness();
    try {
      const admin = G01_TEST_AUTH.ownerAdmin;
      const uid = 'test_s2_privileged_email_only';
      const membership = await h.db.prepare("SELECT role FROM workspace_memberships WHERE user_id = ?").bind(admin.userId).first<{role:string}>();
      assert.equal(membership?.role, 'owner_admin');
      const before = await snapshot(h.db);
      assert.equal((await request(h, h.db, uid, admin.email)).status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('protected administrator email cannot auto-link an ordinary account during UID discovery', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      const protectedEmail = 'admin@chinedigital.com.au';
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await h.db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(protectedEmail, staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, protectedEmail, 0);
      const uid = 'test_s2_operator_uid_discovery';
      const before = await snapshot(h.db);
      const response = await request(h, h.db, uid, protectedEmail);
      assert.equal(response.status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('UID discovery without a CABMS account creates no user or mapping', async () => {
    const h = await harness();
    try {
      const uid = 'test_s2_operator_uid_without_account';
      const before = await snapshot(h.db);
      const response = await request(h, h.db, uid, 'admin@chinedigital.com.au');
      assert.equal(response.status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('staff disabled immediately before mapping insertion is denied without a mapping', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 0);
      const uid = 'test_s2_disable_at_insert';
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      let hookCount = 0;
      let afterDisable: Snapshot | undefined;
      const intercepted = beforeMappingInsert(h.db, async () => {
        hookCount++;
        await assertEligibleStaff(h.db, staff.userId, staff.email, 0);
        await h.db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').bind(staff.userId).run();
        afterDisable = await snapshot(h.db);
      });
      const response = await request(h, intercepted, uid, staff.email);
      assert.equal(hookCount, 1, 'must intercept the actual mapping insertion path');
      assert.equal(response.status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await userFirebaseMappings(h.db, staff.userId), []);
      assert.ok(afterDisable);
      assert.deepEqual(await snapshot(h.db), afterDisable);
    } finally { h.close(); }
  });

  test('ineligible state introduced inside linking batch rolls back the mapping', async () => {
    const h = await harness();
    try {
      const staff = G01_TEST_AUTH.officeStaff;
      const uid = 'test_s2_after_insert_disable';
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(staff.userId).run();
      await assertEligibleStaff(h.db, staff.userId, staff.email, 0);
      await h.db.exec(`CREATE TRIGGER s2_disable_on_link AFTER INSERT ON user_identity_mappings
        WHEN NEW.provider_subject_id = 'test_s2_after_insert_disable'
        BEGIN UPDATE users SET disabled = 1 WHERE id = NEW.user_id; END;`);
      const before = await snapshot(h.db);
      const response = await request(h, h.db, uid, staff.email);
      assert.equal(response.status, 500);
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      assert.deepEqual(await snapshot(h.db), before);
    } finally { h.close(); }
  });

  test('concurrent UID conflict preserves the mapping created for another user', async () => {
    const h = await harness();
    try {
      const target = G01_TEST_AUTH.officeStaff;
      const other = G01_TEST_AUTH.technician;
      await h.db.prepare("DELETE FROM user_identity_mappings WHERE provider_id = 'firebase' AND user_id = ?").bind(target.userId).run();
      await assertEligibleStaff(h.db, target.userId, target.email, 0);
      await assertEligibleStaff(h.db, other.userId, other.email, 0);
      const uid = 'test_s2_uid_conflict';
      assert.deepEqual(await firebaseMappings(h.db, uid), []);
      let hookCount = 0;
      let afterCompetitor: Snapshot | undefined;
      const intercepted = beforeMappingInsert(h.db, async () => {
        hookCount++;
        await h.db.prepare("INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES (?, ?, 'firebase', ?, datetime('now'))")
          .bind('test_s2_competing_mapping', other.userId, uid).run();
        afterCompetitor = await snapshot(h.db);
      });
      const response = await request(h, intercepted, uid, target.email);
      assert.equal(hookCount, 1, 'must intercept the link insertion');
      assert.equal(response.status, 401);
      assert.deepEqual(await firebaseMappings(h.db, uid), [{ user_id: other.userId, provider_subject_id: uid }]);
      assert.deepEqual(await userFirebaseMappings(h.db, target.userId), []);
      assert.ok(afterCompetitor);
      assert.deepEqual(await snapshot(h.db), afterCompetitor);
    } finally { h.close(); }
  });

});
