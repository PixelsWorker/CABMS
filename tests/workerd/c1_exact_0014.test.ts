import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, writeFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalD1Database, type D1Database, type LocalD1Database } from '../../backend/db/d1.ts';
import { loadVerifiedMigrations } from '../../backend/db/migrate.ts';
import {loadPreOperationalMigrations,initializePreOperationalDatabase} from '../support/preOperationalMigrations.ts';

const guardName = '0014_c1_null_safe_guards.sql';
const verifiedMigrations = new Map(loadVerifiedMigrations().map(m => [m.name, Buffer.from(m.bytes)]));
const guard = verifiedMigrations.get(guardName)!;
const { createTestHarness } = createRequire(import.meta.url)('wrangler');

async function inventory(db: D1Database) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_METADATA') ORDER BY name").all<{name:string}>();
  return Promise.all(tables.results.map(async ({name}) => {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    return [name, (await db.prepare('SELECT * FROM ' + quoted).all()).results.map(row => JSON.stringify(row)).sort()];
  }));
}

async function exercise(db: D1Database, install: () => Promise<unknown>) {
  await db.prepare("UPDATE job_type_compliance_policies SET approved_by=NULL WHERE id='pol-solar-service-v1'").run();
  const before = await inventory(db);
  await install();
  assert.deepEqual(await inventory(db), before, '0014 does not change application rows');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  const sql = 'UPDATE job_type_compliance_policies SET approved_by=? WHERE id=?';
  await assert.rejects(() => db.prepare(sql).bind('fixture', 'pol-solar-service-v1').run(), /immutable/);
  await assert.rejects(() => db.prepare(sql).bind(null, 'pol-solar-install-v1').run(), /immutable/);
  await db.prepare(sql).bind(null, 'pol-solar-service-v1').run();
  await assert.rejects(() => db.prepare("INSERT INTO job_type_required_forms(id,policy_version_id,form_type,required,display_order) VALUES('fixture','pol-solar-service-v1','TCA2',1,0)").run(), /immutable/);
  assert.deepEqual(await inventory(db), before);
}

test('0014 exact proposal on disposable SQLite', async t => {
  const db = createLocalD1Database() as LocalD1Database;
  t.after(() => db.getSqliteHandle().close());
  await initializePreOperationalDatabase(db);
  await exercise(db, () => db.exec(guard.toString('utf8')));
});

test('0014 exact proposal on disposable workerd/D1', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cabms-job-0014-'));
  const sqlDir = path.join(dir, 'sql');
  mkdirSync(sqlDir);

  function write(file: string, value: string | Buffer) {
    writeFileSync(file, value);

  }
  for (const file of loadPreOperationalMigrations()) write(path.join(sqlDir, file.name), file.bytes);
  const configPath = path.join(dir, 'wrangler.json');
  write(configPath, JSON.stringify({
    name: 'cabms-job-guards', main: path.resolve('tests/support/worker.ts'),
    compatibility_date: '2026-10-28', compatibility_flags: ['nodejs_compat'],
    d1_databases: [{binding:'DB',database_name:'disposable-guards',database_id:'disposable-guards',migrations_dir:sqlDir}],
  }));
  const harness = createTestHarness({workers:[{configPath}]});
  t.after(async () => {
    await harness.close();
    const resolved = realpathSync(dir);
    assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
    assert.match(path.basename(resolved), /^cabms-job-0014-/);
    rmSync(resolved, { recursive: true, force: true });
  });
  await harness.listen();
  const worker = harness.getWorker('cabms-job-guards');
  await worker.applyD1Migrations('DB');
  const db: D1Database = (await worker.getEnv()).DB;
  await exercise(db, async () => {
    write(path.join(sqlDir, guardName), guard);
    // Harness discovers migration inventory at startup. Each of these independent
    // trigger definitions runs against the same disposable D1 binding.
    const statements = guard.toString('utf8').split(/(?<=END;)\s*(?=CREATE TRIGGER|$)/).filter(statement => statement.trim());
    await db.batch(statements.map(statement => db.prepare(statement)));
  });
});
