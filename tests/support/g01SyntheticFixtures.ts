/**
 * G01 disposable-test identities only. NEVER import from backend/ or src/.
 * Not a production migration and not a user bootstrap mechanism.
 *
 * One canonical collection of identity rows generates parameterized
 * INSERT statements for D1.batch() and an equivalent temporary Wrangler SQL
 * representation. A second installation fails on primary-key collisions.
 */
import type { D1Database, D1PreparedStatement } from '../../backend/db/d1.ts';

export const G01_TEST_AUTH = {
  superAdmin: {
    userId: 'test_g01_usr_super_admin',
    uid: 'test_g01_uid_super_admin',
    email: 'test-g01-super-admin@example.invalid',
    name: 'Test G01 Super Admin',
  },
  ownerAdmin: {
    userId: 'test_g01_usr_owner_admin',
    uid: 'test_g01_uid_owner_admin',
    email: 'test-g01-owner-admin@example.invalid',
    name: 'Test G01 Owner Admin',
  },
  officeStaff: {
    userId: 'test_g01_usr_office_staff',
    uid: 'test_g01_uid_office_staff',
    email: 'test-g01-office-staff@example.invalid',
    name: 'Test G01 Office Staff',
  },
  technician: {
    userId: 'test_g01_usr_technician',
    uid: 'test_g01_uid_technician',
    email: 'test-g01-technician@example.invalid',
    name: 'Test G01 Technician',
  },
} as const;

const users = Object.values(G01_TEST_AUTH);
const memberships = [
  ['test_g01_mem_sa_solarcell', 'solarcell', G01_TEST_AUTH.superAdmin.userId, 'super_admin'],
  ['test_g01_mem_sa_smart_home', 'smart_home', G01_TEST_AUTH.superAdmin.userId, 'super_admin'],
  ['test_g01_mem_sa_cctv', 'cctv', G01_TEST_AUTH.superAdmin.userId, 'super_admin'],
  ['test_g01_mem_oa_solarcell', 'solarcell', G01_TEST_AUTH.ownerAdmin.userId, 'owner_admin'],
  ['test_g01_mem_os_solarcell', 'solarcell', G01_TEST_AUTH.officeStaff.userId, 'office_staff'],
  ['test_g01_mem_tech_solarcell', 'solarcell', G01_TEST_AUTH.technician.userId, 'technician'],
] as const;

interface StatementSpec {
  readonly sql: string;
  readonly params: readonly string[];
}

/** Statements in FK-safe user, mapping, membership, protected identity and approval order. */
export function g01TestAuthStatementSpecs(): readonly StatementSpec[] {
  return [
    {
      sql: `INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ${users.map(() => "(?, ?, ?, datetime('now'), datetime('now'))").join(', ')}`,
      params: users.flatMap(user => [user.userId, user.email, user.name]),
    },
    {
      sql: `INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at) VALUES ${users.map(() => "(?, ?, 'firebase', ?, datetime('now'))").join(', ')}`,
      params: users.flatMap((user, i) => [`test_g01_map_${i + 1}`, user.userId, user.uid]),
    },
    {
      sql: `INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at) VALUES ${memberships.map(() => "(?, ?, ?, ?, datetime('now'), datetime('now'))").join(', ')}`,
      params: memberships.flatMap(row => [...row]),
    },
    {
      sql: `INSERT INTO g01_protected_super_admin (singleton, user_id, provider_id, provider_subject_id, assigned_at, assigned_by) VALUES (1, ?, 'firebase', ?, datetime('now'), 'test-fixture')`,
      params: [G01_TEST_AUTH.superAdmin.userId, G01_TEST_AUTH.superAdmin.uid],
    },
    {
      sql: `INSERT INTO privileged_identity_approvals (id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by) VALUES ${memberships.filter(m => m[3] === 'super_admin' || m[3] === 'owner_admin').map(() => "(?, ?, 'firebase', ?, ?, ?, datetime('now'), 'test-fixture')").join(', ')}`,
      params: memberships.filter(m => m[3] === 'super_admin' || m[3] === 'owner_admin').flatMap((m, i) => [`test_g01_approval_${i + 1}`, m[2], m[3] === 'super_admin' ? G01_TEST_AUTH.superAdmin.uid : G01_TEST_AUTH.ownerAdmin.uid, m[1], m[3]]),
    },
  ];
}

/** Uses native D1.batch() for one transactional install, including local adapter. */
export async function installG01TestAuthFixtures(db: D1Database): Promise<void> {
  const statements: D1PreparedStatement[] = g01TestAuthStatementSpecs().map(spec =>
    db.prepare(spec.sql).bind(...spec.params)
  );
  const results = await db.batch(statements);
  if (results.length !== 5 || results.some(result => !result.success)) {
    throw new Error('G01 test-auth fixture batch did not complete successfully');
  }
  const changes = results.map(result => result.meta.changes);
  if (changes[0] !== 4 || changes[1] !== 4 || changes[2] !== 6 || changes[3] !== 1 || changes[4] !== 4) {
    throw new Error(`G01 test-auth fixture changed unexpected row counts: ${changes.join(',')}`);
  }
}

/**
 * Deterministic CLI SQL for a disposable Wrangler D1 database ONLY.
 * This representation is generated from the same three specs. Wrangler CLI
 * file transaction semantics are NOT inferred from Worker D1.batch().
 */
export function renderG01TestAuthSql(): string {
  return [
    '-- CABMS G01 disposable tests only; NEVER run against persistent or remote D1.',
    ...g01TestAuthStatementSpecs().map(spec => {
      let index = 0;
      const rendered = spec.sql.replace(/\?/g, () => {
        const value = spec.params[index++];
        if (value === undefined) throw new Error('Missing G01 fixture SQL bind');
        return `'${value.replaceAll("'", "''")}'`;
      });
      if (index !== spec.params.length) throw new Error('Extra G01 fixture SQL bind');
      return `${rendered};`;
    }),
    '',
  ].join('\n');
}
