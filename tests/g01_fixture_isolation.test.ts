import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { createLocalD1Database, type D1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import {
  g01TestAuthStatementSpecs,
  installG01TestAuthFixtures,
  renderG01TestAuthSql,
} from './support/g01SyntheticFixtures.ts';

test('G01 fixture identifiers and emails do not overlap retired seed identities', () => {
  const retired = new Set([
    'usr_super_admin', 'usr_chine_super_admin', 'usr_owner_admin', 'usr_office_staff', 'usr_technician',
    'firebase_uid_super_admin', 'firebase_uid_owner_admin', 'firebase_uid_office_staff', 'firebase_uid_technician',
    'admin@cabms.example.invalid', 'admin@chine.example.invalid', 'admin@chinedigital.com.au',
    'owner@solarcell.example.invalid', 'staff@solarcell.example.invalid', 'tech@solarcell.example.invalid',
  ]);
  // Check all bound values, including user, mapping and membership IDs, UIDs and emails.
  for (const spec of g01TestAuthStatementSpecs()) {
    for (const value of spec.params) assert.equal(retired.has(value), false, `Retired fixture value: ${value}`);
  }
});

async function fixtureCounts(db: D1Database): Promise<number[]> {
  const result: number[] = [];
  for (const table of ['users', 'user_identity_mappings', 'workspace_memberships']) {
    const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE id LIKE 'test_g01_%'`).first<{ n: number }>();
    result.push(row?.n ?? -1);
  }
  return result;
}

test('G01 fixture: batch rolls back on membership FK failure, installs identities and approvals, rejects second install', async () => {
  const db = createLocalD1Database();
  await runLocalMigrations(db, { disposableTest: true });
  const bad = g01TestAuthStatementSpecs().map((spec, i) => ({
    sql: spec.sql,
    params: i === 2 ? spec.params.map((value, n) => n === 1 ? 'test_g01_missing_workspace' : value) : [...spec.params],
  }));
  await assert.rejects(() => db.batch(bad.map(spec => db.prepare(spec.sql).bind(...spec.params))));
  assert.deepEqual(await fixtureCounts(db), [0, 0, 0]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals').first<{n:number}>())?.n, 0);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM g01_protected_super_admin').first<{n:number}>())?.n, 0);

  await installG01TestAuthFixtures(db);
  assert.deepEqual(await fixtureCounts(db), [4, 4, 6]);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM privileged_identity_approvals').first<{n:number}>())?.n, 4);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM g01_protected_super_admin').first<{n:number}>())?.n, 1);
  const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
  assert.equal(foreignKeys.results.length, 0);
  await assert.rejects(() => installG01TestAuthFixtures(db));
  assert.deepEqual(await fixtureCounts(db), [4, 4, 6]);

  const rendered = renderG01TestAuthSql();
  assert.equal((rendered.match(/^INSERT INTO /gm) ?? []).length, 5);
  assert.doesNotMatch(rendered, /\?/);
  assert.match(rendered, /test_g01_usr_super_admin/);
});

function walk(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap(name => {
    const full = join(root, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

test('G01 fixture: deployable backend/client/migrations and Worker entrypoint exclude test-only identities and installer', () => {
  const cwd = resolve('.');
  const config = readFileSync(join(cwd, 'wrangler.jsonc'), 'utf8');
  assert.match(config, /"main"\s*:\s*"backend\/index\.ts"/);
  assert.doesNotMatch(config, /tests\/support\/worker\.ts|g01SyntheticFixtures|test_g01_/);
  for (const directory of ['backend', 'src', 'migrations']) {
    for (const file of walk(join(cwd, directory))) {
      if (!['.ts', '.tsx', '.js', '.json', '.sql'].includes(extname(file))) continue;
      const contents = readFileSync(file, 'utf8');
      assert.doesNotMatch(contents, /g01SyntheticFixtures|test_g01_/,
        `Test-only identity leaked into production source: ${file}`);
    }
  }
  // Also inspect any existing build. A fresh clean build must still be verified
  // as a separately approved acceptance command.
  for (const file of walk(join(cwd, 'dist'))) {
    if (!['.js', '.html', '.json', '.css'].includes(extname(file))) continue;
    const contents = readFileSync(file, 'utf8');
    assert.doesNotMatch(contents, /g01SyntheticFixtures|test_g01_/,
      `Test-only identity leaked into build output: ${file}`);
  }
});
