import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { D1Database } from '../../backend/db/d1.ts';

const { createTestHarness } = createRequire(import.meta.url)('wrangler');

test('disposable workerd/D1 binds audit to one scoped operation and rolls back as a batch', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cabms-audit-spike-'));
  const configPath = path.join(dir, 'wrangler.json');
  writeFileSync(configPath, JSON.stringify({
    name: 'cabms-audit-spike',
    main: path.resolve('tests/support/worker.ts'),
    compatibility_date: '2026-10-28',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: [{binding: 'DB', database_name: 'spike', database_id: 'disposable-audit-spike'}],
  }));
  const server = createTestHarness({ workers: [{ configPath }] });
  t.after(() => server.close());
  await server.listen();
  const db: D1Database = (await server.getWorker('cabms-audit-spike').getEnv()).DB;
  const schema = [
    'CREATE TABLE member(workspace TEXT, actor TEXT, PRIMARY KEY(workspace,actor))',
    'CREATE TABLE job(id TEXT PRIMARY KEY, workspace TEXT NOT NULL, version INTEGER NOT NULL, operation TEXT)',
    'CREATE TABLE context(id TEXT PRIMARY KEY, actor TEXT NOT NULL, workspace TEXT NOT NULL, target TEXT NOT NULL, expected INTEGER NOT NULL, action TEXT NOT NULL, fingerprint TEXT NOT NULL)',
    'CREATE TABLE audit(operation TEXT PRIMARY KEY, actor TEXT NOT NULL, occurred_at TEXT NOT NULL)',
    'CREATE TABLE receipt(operation TEXT PRIMARY KEY, version INTEGER NOT NULL)',
    `CREATE TRIGGER guard BEFORE UPDATE ON job BEGIN
      SELECT CASE WHEN NEW.version <> OLD.version + 1 OR NOT EXISTS (
        SELECT 1 FROM context c JOIN member m ON m.workspace=c.workspace AND m.actor=c.actor
        WHERE c.id=NEW.operation AND c.workspace=OLD.workspace AND c.target=OLD.id
          AND c.expected=OLD.version AND c.action='advance'
          AND NOT EXISTS (SELECT 1 FROM audit a WHERE a.operation=c.id)
      ) THEN RAISE(ABORT,'invalid context') END;
    END`,
    `CREATE TRIGGER record AFTER UPDATE ON job BEGIN
      INSERT INTO audit SELECT id,actor,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM context WHERE id=NEW.operation;
      INSERT INTO receipt VALUES(NEW.operation,NEW.version);
    END`,
    "INSERT INTO member VALUES ('solar','alice'),('solar','bob')",
    "INSERT INTO job VALUES ('one','solar',0,NULL),('two','solar',0,NULL)",
  ];
  for (const sql of schema) await db.prepare(sql).run();

  const mutate = (id: string, job: string) =>
    db.prepare('UPDATE job SET version=version+1, operation=? WHERE id=?').bind(id, job);
  const context = (id: string, actor: string, job: string, expected = 0, workspace = 'solar', action = 'advance') =>
    db.prepare('INSERT INTO context VALUES(?,?,?,?,?,?,?)').bind(id, actor, workspace, job, expected, action, id);
  const count = async (table: 'audit' | 'receipt' | 'context') =>
    (await db.prepare('SELECT count(*) AS n FROM ' + table).first<{n:number}>())?.n;

  await assert.rejects(() => mutate('missing', 'one').run(), /invalid context/);
  for (const [id, bad] of [
    ['wrong-target', context('wrong-target','alice','two')], ['wrong-scope', context('wrong-scope','alice','one',0,'other')],
    ['wrong-version', context('wrong-version','alice','one',9)], ['wrong-actor', context('wrong-actor','other','one')],
    ['wrong-action', context('wrong-action','alice','one',0,'solar','cancel')],
  ] as const) {
    await assert.rejects(() => db.batch([bad, mutate(id, 'one')]), /invalid context/);
  }
  assert.equal(await count('context'), 0);
  await assert.rejects(() => db.batch([
    context('rollback','alice','one'), mutate('rollback','one'),
    db.prepare("INSERT INTO receipt VALUES('rollback',1)"),
  ]), /UNIQUE/);
  assert.equal(await count('audit'), 0);
  assert.equal(await count('receipt'), 0);
  assert.equal(await count('context'), 0);
  assert.equal(await db.prepare("SELECT version FROM job WHERE id='one'").first('version'), 0);

  const before = Date.now();
  await Promise.all([
    db.batch([context('alice-op','alice','one'), mutate('alice-op','one')]),
    db.batch([context('bob-op','bob','two'), mutate('bob-op','two')]),
  ]);
  const events = await db.prepare('SELECT * FROM audit ORDER BY operation').all<{actor:string;occurred_at:string}>();
  assert.deepEqual(events.results.map(row => row.actor), ['alice','bob']);
  for (const event of events.results) {
    assert.match(event.occurred_at, /^\d{4}-\d\d-\d\dT.*Z$/);
    assert.ok(Date.parse(event.occurred_at) >= before && Date.parse(event.occurred_at) <= Date.now());
  }
  await assert.rejects(() => mutate('alice-op','one').run(), /invalid context/);

  // Simulate a lost acknowledgement after the actual workerd batch commits.
  await assert.rejects(async () => {
    await db.batch([context('lost','alice','one',1), mutate('lost','one')]);
    throw new Error('response lost');
  }, /response lost/);
  const reconciled = await db.prepare(`SELECT r.version FROM receipt r JOIN context c ON c.id=r.operation
    WHERE c.id=? AND c.actor=? AND c.workspace=? AND c.fingerprint=?`)
    .bind('lost','alice','solar','lost').first('version');
  assert.equal(reconciled, 2);
  await assert.rejects(() => db.batch([context('lost','alice','one',1), mutate('lost','one')]), /UNIQUE/);
  assert.equal(await count('audit'), 3);
  assert.equal(await count('receipt'), 3);
});
