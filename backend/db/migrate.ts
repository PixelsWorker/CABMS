/** Local test runner: verify the complete raw-byte inventory before any SQL. */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { D1Database, isDisposableInMemoryD1 } from './d1.ts';

export const G01_MIGRATION_MANIFEST = [
  ['0001_g01_initial_schema.sql', 'ddce48e8ea761836feca5a7c784c4ec559eb890c4ce2225fce30f902c9edbcc1'],
  ['0002_g01_seed_synthetic_data.sql', 'd69af07fa96521858173b3515f7c7508d7b1ec6d4cabed8959a09742f6ba2375'],
  ['0003_g01_revoke_unauthorized_seed_super_admin.sql', 'f59a087f01d2d283dff1343470ba551ec59a6adef76b99659001e7dd0ea9052e'],
  ['0004_g01_user_account_status.sql', 'b05901576c55261a2ee08579c160bc1a1d31bea25e2562821e04002aa21e0727'],
  ['0005_g01_retire_synthetic_access.sql', 'c934b739d341955b4d47008a54057344974771e9f68463bc71c70f2733f5c964'],
  ['0006_g01_privileged_identity_approvals.sql', '944353e605c6d75076ac21ec6f5070fd806ecb68833fb3dfdc6f10e83ce121cc'],
  ['0007_g01_bootstrap_completion.sql', 'b72ced192b15c46efb5b5a77e2b763b00f27a37cc9ff8d5bddb074a76e59be4a'],
  ['0008_demo_enquiries_jobs.sql', '74ae5a38d9fa458950205828d43d3fbcbb591568cd4859133896c7a44250afba'],
  ['0009_demo_job_steps.sql', '2db1ce46db861185db0c0c1f3fd64ca0eb81cbb875b28436a2e4a8dfa9633344'],
  ['0010_g04_synthetic_appointments.sql', 'a66c18d6aba8f1238d196a3cd02ecf76a7a055998637385a1d5621541c76477d'],
] as const;

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

/** Returns verified byte snapshots, not paths to be reread after validation. */
export function loadVerifiedMigrations(dir = migrationsDir): ReadonlyArray<{ name: string; bytes: Buffer }> {
  const names = readdirSync(dir).filter(name => name.endsWith('.sql')).sort();
  const expected = G01_MIGRATION_MANIFEST.map(([name]) => name);
  if (names.length !== expected.length || names.some((name, i) => name !== expected[i])) {
    throw new Error('Unexpected G01 migration inventory; no SQL executed');
  }
  return G01_MIGRATION_MANIFEST.map(([name, digest]) => {
    const bytes = readFileSync(resolve(dir, name));
    if (createHash('sha256').update(bytes).digest('hex') !== digest) {
      throw new Error(`G01 migration hash mismatch: ${name}; no SQL executed`);
    }
    return { name, bytes };
  });
}

type VerifiedMigration = { name: string; bytes: Buffer };

/** Plan the dependent pair by name while preserving any later migrations. */
export function planLocalMigrations(verified: readonly VerifiedMigration[]): {
  before: readonly VerifiedMigration[];
  pair: readonly [VerifiedMigration, VerifiedMigration];
  after: readonly VerifiedMigration[];
} {
  const first = verified.findIndex(item => item.name === '0006_g01_privileged_identity_approvals.sql');
  const second = verified.findIndex(item => item.name === '0007_g01_bootstrap_completion.sql');
  if (first < 0 || second !== first + 1 ||
      verified.filter(item => item.name === '0006_g01_privileged_identity_approvals.sql').length !== 1 ||
      verified.filter(item => item.name === '0007_g01_bootstrap_completion.sql').length !== 1) {
    throw new Error('Expected adjacent, unique G01 migrations 0006 and 0007');
  }
  return { before: verified.slice(0, first), pair: [verified[first], verified[second]], after: verified.slice(second + 1) };
}

export async function runLocalMigrations(db: D1Database, options: { disposableTest: true; dir?: string }): Promise<void> {
  if (options?.disposableTest !== true || !isDisposableInMemoryD1(db)) {
    throw new Error('G01 migrations require explicit opt-in and a factory-created in-memory test database; no SQL executed');
  }
  const dir = options.dir ?? migrationsDir;
  const verified = loadVerifiedMigrations(dir);
  // The test-only in-memory adapter executes each exec synchronously on its
  // private SQLite connection. Install the dependent 0006/0007 pair in one
  // explicit transaction and one exec call; never use this as remote D1 proof.
  const { before, pair, after } = planLocalMigrations(verified);
  for (const migration of before) await db.exec(migration.bytes.toString('utf8'));
  try {
    await db.exec(`BEGIN TRANSACTION;\n${pair[0].bytes.toString('utf8')}\n${pair[1].bytes.toString('utf8')}\nCOMMIT;`);
  } catch (error) {
    try { await db.exec('ROLLBACK;'); } catch { /* preserve the original failure */ }
    throw error;
  }
  for (const migration of after) await db.exec(migration.bytes.toString('utf8'));
}
