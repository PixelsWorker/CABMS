import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { G01_MIGRATION_MANIFEST, loadVerifiedMigrations, runLocalMigrations } from '../backend/db/migrate.ts';
import { createLocalD1Database, LocalD1Database, type D1Database } from '../backend/db/d1.ts';

test('G01 migration manifest rejects drift, missing and unknown SQL before executing any SQL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cabms-manifest-'));
  const calls: string[] = [];
  const db = createLocalD1Database();
  mock.method(db, 'exec', async (sql: string) => { calls.push(sql); return { count: 1, duration: 0 }; });
  const reset = () => {
    for (const [name] of G01_MIGRATION_MANIFEST) writeFileSync(join(dir, name), readFileSync(resolve('migrations', name)));
  };
  try {
    reset();
    assert.equal(loadVerifiedMigrations(dir).length, G01_MIGRATION_MANIFEST.length);
    const last = G01_MIGRATION_MANIFEST[4][0];
    writeFileSync(join(dir, last), Buffer.concat([readFileSync(join(dir, last)), Buffer.from(' ')]));
    await assert.rejects(() => runLocalMigrations(db, { disposableTest: true, dir }), /hash mismatch/);
    assert.equal(calls.length, 0);
    reset();
    unlinkSync(join(dir, last));
    await assert.rejects(() => runLocalMigrations(db, { disposableTest: true, dir }), /inventory/);
    assert.equal(calls.length, 0);
    reset();
    writeFileSync(join(dir, '9999_unreviewed.sql'), 'SELECT 1;');
    await assert.rejects(() => runLocalMigrations(db, { disposableTest: true, dir }), /inventory/);
    assert.equal(calls.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('G01 migration runner refuses missing opt-in and non-disposable bindings before SQL', async () => {
  const calls: string[] = [];
  const foreign = { exec: async (sql: string) => { calls.push(sql); return { count: 1, duration: 0 }; } } as D1Database;
  const memory = createLocalD1Database();
  await assert.rejects(() => runLocalMigrations(foreign, { disposableTest: true }), /in-memory/);
  await assert.rejects(() => runLocalMigrations(memory, undefined as never), /explicit opt-in/);
  assert.deepEqual(calls, []);
});

test('G01 migration runner rejects a file-backed local adapter', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cabms-guard-'));
  const db = createLocalD1Database(join(dir, 'test.sqlite')) as LocalD1Database;
  try {
    await assert.rejects(() => runLocalMigrations(db, { disposableTest: true }), /in-memory/);
  } finally {
    db.getSqliteHandle().close();
    rmSync(dir, { recursive: true, force: true });
  }
});
