import {atomicJourney} from './complianceAtomicJourney.ts';
import { browserJourney } from './complianceBrowserJourney.ts';
import { signingJourney } from './signingJourney.ts';
import { evidenceJourney } from './evidenceJourney.ts';
import { policyDrift } from './compliancePolicyFixture.ts';
import { withdrawalRace } from './complianceRaceFixture.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirebaseFixture } from '../support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from '../support/g01SyntheticFixtures.ts';
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
const compliance = verifiedMigrations.get('0015_persistent_job_compliance.sql')!;
const { createTestHarness } = createRequire(import.meta.url)('wrangler');

async function inventory(db: D1Database) {
  const tables = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'compliance_%' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('d1_migrations','_cf_METADATA') ORDER BY name").all<{name:string}>();
  return Promise.all(tables.results.map(async ({name}) => {
    const quoted = '"' + name.replaceAll('"', '""') + '"';
    return [name, (await db.prepare('SELECT * FROM ' + quoted).all()).results.map(row => JSON.stringify(row,(key,value)=>{if(name==="workspace_settings" && key==="contract_threshold_cents"){assert.equal(value,330000);return undefined;}return value;})).sort()];
  }));
}

async function exercise(db: D1Database, install: () => Promise<unknown>, file?: string) {
  await db.prepare("UPDATE job_type_compliance_policies SET approved_by=NULL WHERE id='pol-solar-service-v1'").run();
  const before = await inventory(db);
  await install();
  assert.deepEqual(await inventory(db), before, '0014 and 0015 do not change application rows');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  const sql = 'UPDATE job_type_compliance_policies SET approved_by=? WHERE id=?';
  await assert.rejects(() => db.prepare(sql).bind('fixture', 'pol-solar-service-v1').run(), /immutable/);
  await assert.rejects(() => db.prepare(sql).bind(null, 'pol-solar-install-v1').run(), /immutable/);
  await db.prepare(sql).bind(null, 'pol-solar-service-v1').run();
  await assert.rejects(() => db.prepare("INSERT INTO job_type_required_forms(id,policy_version_id,form_type,required,display_order) VALUES('fixture','pol-solar-service-v1','TCA2',1,0)").run(), /immutable/);
  assert.deepEqual(await inventory(db), before);
  await assert.rejects(() => db.prepare("UPDATE job_type_required_forms SET required=0 WHERE policy_version_id='pol-solar-install-v1'").run(), /cannot be modified/);
  await assert.rejects(() => db.prepare("DELETE FROM job_type_required_forms WHERE policy_version_id='pol-solar-install-v1'").run(), /cannot be deleted/);
  await db.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES('job-fixture','job-fixture@example.invalid','2026','2026')").run();
  await db.prepare("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES('job-fixture','solarcell','job-fixture','office_staff','2026','2026')").run();

  const seed = [
    "INSERT INTO form_definitions(id,workspace_id,brand_id,code,title,created_at,updated_at) VALUES('guard-form','solarcell','solarcell','GUARD-FORM','Switchboard safety inspection','2026','2026')",
    "INSERT INTO form_revisions(id,workspace_id,form_definition_id,version,status,created_at,updated_at) VALUES('guard-rev','solarcell','guard-form','1','DRAFT','2026','2026')",
    "INSERT INTO form_sections(id,workspace_id,revision_id,title,display_order) VALUES('route-section','solarcell','guard-rev','Checks',0)",
    "INSERT INTO form_fields(id,workspace_id,section_id,field_key,label,field_type,required,display_order) VALUES('route-result','solarcell','route-section','result','Result','PASS_FAIL',1,0)",
    "INSERT INTO form_fields(id,workspace_id,section_id,field_key,label,field_type,required,display_order) VALUES('route-photo','solarcell','route-section','proof','Proof','PHOTO',1,1)",
    `INSERT INTO form_fields(id,workspace_id,section_id,field_key,label,field_type,required,display_order,visible_when_json) VALUES('conditional','solarcell','route-section','reason','Explain failure','TEXT',1,2,'{"field":"result","equals":"FAIL"}')`,
    "UPDATE form_revisions SET status='REVIEW' WHERE id='guard-rev'",
    "UPDATE form_revisions SET status='PUBLISHED' WHERE id='guard-rev'",
    "UPDATE form_definitions SET status='ACTIVE',published_revision_id='guard-rev' WHERE id='guard-form'",
    "INSERT INTO job_type_compliance_policies(id,job_type_id,version,status,created_at,updated_at) VALUES('guard-draft','jt-solar-install','fixture','DRAFT','2026','2026')",
    "INSERT INTO job_type_required_forms VALUES('guard-legacy','guard-draft','JSA',1,0)",
    "INSERT INTO policy_catalog_form_rules(id,workspace_id,policy_version_id,form_revision_id,required,display_order) VALUES('guard-rule','solarcell','guard-draft','guard-rev',1,0)",
  ];
  await db.batch(seed.map(sql => db.prepare(sql)));
  await assert.rejects(() => db.prepare("UPDATE job_type_required_forms SET policy_version_id='pol-solar-service-v1' WHERE id='guard-legacy'").run(), /HISTORY_IMMUTABLE/);
  await db.prepare("UPDATE job_type_compliance_policies SET status='PUBLISHED' WHERE id='guard-draft'").run();
  await assert.rejects(() => db.prepare("UPDATE policy_catalog_form_rules SET required=0 WHERE id='guard-rule'").run(), /must be replaced/);
  await assert.rejects(() => db.prepare("DELETE FROM policy_catalog_form_rules WHERE id='guard-rule'").run(), /immutable/);
  const operation = (id: string, action: string, version: number, workspace = 'solarcell') => db.prepare(
    "INSERT INTO compliance_operations VALUES(?,?, 'job-fixture', ?, 'fixture', ?, ?)"
  ).bind(id,workspace,action,version,'a'.repeat(64));
  const create = (op: string, type: string, policy: string) => db.prepare(
    "INSERT INTO compliance_jobs(id,workspace_id,job_type_id,policy_id,title,operation_id) VALUES('fixture','solarcell',?,?, 'Invoice-only fixture',?)"
  ).bind(type,policy,op);
  await assert.rejects(() => db.batch([operation('legacy','CREATE',0), create('legacy','jt-solar-install','pol-solar-install-v1')]), /LEGACY_MAPPING_REQUIRED/);
  await assert.rejects(() => db.batch([operation('scope','CREATE',0,'cctv'), create('scope','jt-solar-service','pol-solar-service-v1')]), /ACTION_DENIED/);
  await assert.rejects(() => db.batch([operation('rollback','CREATE',0), create('rollback','jt-solar-service','pol-solar-service-v1'), db.prepare("INSERT INTO compliance_receipts(operation_id) VALUES('rollback')")]), /OPERATION_UNCONFIRMED/);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_operations").first('n'), 0);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_jobs").first('n'), 0);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_receipts").first('n'), 0);

  for (const boundary of [1,2]) {
    const writes = [operation('boundary','CREATE',0),create('boundary','jt-solar-service','pol-solar-service-v1')];
    await assert.rejects(() => db.batch([...writes.slice(0,boundary),
      db.prepare("INSERT INTO compliance_operations VALUES(NULL,'solarcell','job-fixture','CREATE','fixture',0,'bad')"),
    ]), /constraint/i);
    for (const table of ['compliance_operations','compliance_jobs','compliance_requirements','compliance_receipts','compliance_audit']) {
      assert.equal(await db.prepare('SELECT count(*) AS n FROM '+table).first('n'),0,table+' leaked at boundary '+boundary);
    }
  }
  await db.batch([operation('create','CREATE',0), create('create','jt-solar-service','pol-solar-service-v1')]);
  assert.ok(await db.prepare("SELECT occurred_at FROM compliance_audit WHERE id='create' AND actor_id='job-fixture'").first());
  const add = (id: string, occurrence: string) => db.prepare(
    "INSERT INTO compliance_requirements VALUES('solarcell','fixture',?,'guard-rev','ADDITIONAL',0,'Mistaken addition',?)"
  ).bind(occurrence,id);
  await db.batch([operation('add-one','ADD',1),add('add-one','visit-1')]);
  await db.batch([operation('add-two','ADD',1),add('add-two','visit-2')]);
  await assert.rejects(() => db.batch([operation('duplicate','ADD',1),add('duplicate','visit-1')]), /FORM_ALREADY_ASSIGNED/);
  await assert.rejects(() => db.prepare("INSERT OR REPLACE INTO compliance_operations SELECT * FROM compliance_operations WHERE id='create'").run(), /IDEMPOTENCY_KEY_REUSED/);

  await db.prepare("INSERT INTO users(id,email,created_at,updated_at) VALUES('second-admin','second-admin@example.invalid','2026','2026')").run();
  await db.prepare("INSERT INTO workspace_memberships(id,workspace_id,user_id,role,created_at,updated_at) VALUES('second-admin','solarcell','second-admin','owner_admin','2026','2026')").run();
  await db.prepare("UPDATE workspace_memberships SET role='owner_admin' WHERE id='job-fixture'").run();
  await assert.rejects(() => db.batch([operation('withdraw-denied','WITHDRAW',1),db.prepare(
    "INSERT INTO compliance_decisions VALUES('solarcell','fixture','visit-2','WITHDRAW','Added by mistake','job-fixture',1,'withdraw-denied')"
  )]), /EXCEPTION_DENIED/);
  await db.prepare("UPDATE users SET disabled=1 WHERE id='second-admin'").run();
  await withdrawalRace(db,file);
  await policyDrift(db);
  const answer = db.prepare("INSERT INTO compliance_answers VALUES('solarcell','fixture','visit-1',1,'{}','answer')");
  await db.batch([operation('answer','SAVE',1),answer]);
  await assert.rejects(() => db.batch([operation('photo','EVIDENCE',1),db.prepare(
    "INSERT INTO compliance_evidence VALUES('photo','solarcell','fixture','visit-1',1,1,?,'private/fixture','photo')"
  ).bind('b'.repeat(64))]), /EVIDENCE_INVALID/);

  await db.prepare("INSERT INTO compliance_photo_limits(workspace_id,max_bytes,validated_at,validated_by) VALUES('solarcell',10,'2026','job-fixture')").run();
  const photo = (id: string, bytes: number) => db.prepare(
    "INSERT INTO compliance_evidence VALUES(?,'solarcell','fixture','visit-1',1,?,?,?,?)"
  ).bind(id,bytes,'b'.repeat(64),'private/'+id,id);
  await assert.rejects(() => db.batch([operation('oversized','EVIDENCE',1),photo('oversized',11)]), /EVIDENCE_INVALID/);
  for(let n=0;n<20;n++){
    const id='photo-'+n;
    await db.batch([operation(id,'EVIDENCE',1),photo(id,10)]);
  }
  await assert.rejects(() => db.batch([operation('extra-photo','EVIDENCE',1),photo('extra-photo',1)]), /EVIDENCE_INVALID/);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_evidence").first('n'),20);
  await assert.rejects(() => db.batch([operation('forged-sign','SIGN',1),db.prepare(
    "INSERT INTO compliance_signoffs VALUES('solarcell','fixture','visit-1',1,?,?,'forged-sign')"
  ).bind(JSON.stringify({answers:{forged:true}}),'b'.repeat(64))]), /SIGNOFF_BLOCKED/);
  await db.batch([operation('finding','FINDING',1),db.prepare(
    "INSERT INTO compliance_findings VALUES('finding','solarcell','fixture','visit-1','Unresolved test failure','finding')"
  )]);
  const finish = (id: string) => db.prepare("UPDATE compliance_jobs SET version=2,status='COMPLETED',operation_id=? WHERE id='fixture'").bind(id);
  await assert.rejects(() => db.batch([operation('blocked','COMPLETE',1),finish('blocked')]), /COMPLETION_BLOCKED/);
  await db.prepare("UPDATE workspace_memberships SET role='owner_admin' WHERE id='job-fixture'").run();
  await db.batch([operation('resolved','FINDING',1),db.prepare(
    "INSERT INTO compliance_resolutions VALUES('finding','Verified correction','resolved')"
  )]);
  await db.batch([operation('withdraw','WITHDRAW',1),db.prepare(
    "INSERT INTO compliance_decisions VALUES('solarcell','fixture','visit-2','WITHDRAW','Added by mistake','job-fixture',1,'withdraw')"
  )]);
  assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_active_requirements WHERE occurrence_key='visit-2'").first('n'),0);

  await assert.rejects(() => db.batch([operation('create','CREATE',0), create('create','jt-solar-service','pol-solar-service-v1')]), /IDEMPOTENCY_KEY_REUSED/);
  const complete = (id: string) => db.prepare("UPDATE compliance_jobs SET version=2,status='COMPLETED',operation_id=? WHERE id='fixture'").bind(id);
  await db.batch([operation('complete','COMPLETE',1),complete('complete')]);
  assert.equal(await db.prepare("SELECT status FROM compliance_jobs WHERE id='fixture'").first('status'), 'COMPLETED');
  await assert.rejects(() => db.batch([operation('terminal','CANCEL',2),db.prepare(
    "UPDATE compliance_jobs SET status='CANCELLED',version=3,operation_id='terminal' WHERE id='fixture'"
  )]), /JOB_STATE_CONFLICT/);

  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);

}

test('0014 and 0015 exact proposals on disposable SQLite', async t => {
  const seed = createLocalD1Database() as LocalD1Database;
  const dir = mkdtempSync(path.join(tmpdir(),'cabms-sqlite-race-'));
  const file = path.join(dir,'fixture.sqlite');
  try {
    await initializePreOperationalDatabase(seed);
    seed.getSqliteHandle().prepare('VACUUM INTO ?').run(file);
    const db=createLocalD1Database(file) as LocalD1Database;
    try {
      await exercise(db,async()=>{await db.exec(guard.toString());await db.exec(compliance.toString());},file);
    } finally {db.getSqliteHandle().close();}
  } finally {seed.getSqliteHandle().close();rmSync(dir,{recursive:true,force:true});}
});

test('0014 and 0015 exact proposals on disposable workerd/D1', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cabms-job-0014-'));
  const sqlDir = path.join(dir, 'sql');
  mkdirSync(sqlDir);

  function write(file: string, value: string | Buffer) {
    writeFileSync(file, value);

  }
  for (const file of loadPreOperationalMigrations()) write(path.join(sqlDir, file.name), file.bytes);
  const configPath = path.join(dir, 'wrangler.json');
  const identity = await createFirebaseFixture();
  write(configPath, JSON.stringify({
    vars: {ENVIRONMENT:'test', FIREBASE_PROJECT_ID:'cabms-test', TEST_PUBLIC_JWKS:JSON.stringify(identity.jwks()), TEST_RUN_ID:randomUUID(), TEST_SETUP_SECRET:randomUUID()},
    name: 'cabms-job-guards', main: path.resolve('tests/support/photoWorker.ts'),
    compatibility_date: '2026-10-28', compatibility_flags: ['nodejs_compat'],
    r2_buckets:[{binding:"PRIVATE_EVIDENCE",bucket_name:"disposable-photo-fixture"}],
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
  const {url} = await harness.listen();
  const worker = harness.getWorker('cabms-job-guards');
  await worker.applyD1Migrations('DB');
  const db: D1Database = (await worker.getEnv()).DB;
  await exercise(db, async () => {
    write(path.join(sqlDir, guardName), guard);
    // Harness discovers migration inventory at startup. Each of these independent
    // trigger definitions runs against the same disposable D1 binding.
    const statements = guard.toString('utf8').split(/(?<=END;)\s*(?=CREATE TRIGGER|$)/).filter(statement => statement.trim());
    await db.batch(statements.map(statement => db.prepare(statement)));
    const complianceStatements = compliance.toString('utf8').replace(/^--.*$/gm, '').trim().split(/(?=^(?:CREATE|ALTER) )/m);
    if (!complianceStatements[0].startsWith('CREATE ')) complianceStatements.shift();
    await db.batch(complianceStatements.map(statement => db.prepare(statement)));
  });

  await t.test('authenticated compliance create, read, replay and workspace restrictions', async authTest => {
    await installG01TestAuthFixtures(db);
    const root = '/api/v1/workspaces/';
    const base = root + 'solarcell/compliance-jobs';
    const auth = async (role: keyof typeof G01_TEST_AUTH) => {
      const who = G01_TEST_AUTH[role];
      return 'Bearer ' + await identity.token(who.uid,who.email);
    };
    const office = await auth('officeStaff');
    const technician = await auth('technician');
    const owner = await auth('ownerAdmin');
    const superAdmin = await auth('superAdmin');
    const req = (route: string, init?: RequestInit) => fetch(new URL(route,url),init);
    const post = (authorization: string, title = 'Synthetic route job') => ({
      method:'POST', headers:{Authorization:authorization,'Content-Type':'application/json','Idempotency-Key':'route-create'},
      body:JSON.stringify({title,job_type_id:'jt-solar-service',expected_policy_id:'pol-solar-service-v1'}),
    });
    assert.equal((await req(base)).status,401);
    assert.equal((await req(base,{headers:{Authorization:'Bearer invalid'}})).status,401);
    assert.equal((await req(root+'cctv/compliance-jobs',{headers:{Authorization:office}})).status,403);
    assert.equal((await req(base,post(technician))).status,403);
    const options='/api/v1/workspaces/solarcell/compliance-jobs?view=creation-options';
    assert.equal((await req(options,{headers:{Authorization:technician}})).status,403);
    assert.equal((await req(options.replace('solarcell','cctv'),{headers:{Authorization:office}})).status,403);
    const solarOptions=await req(options,{headers:{Authorization:office}});
    assert.equal(solarOptions.status,200);
    const jobChoices=await solarOptions.json() as {id:string;missing_mandatory_forms:string[]}[];
    assert.deepEqual(jobChoices.find(x=>x.id==='jt-solar-service')?.missing_mandatory_forms,[]);
    assert.deepEqual(jobChoices.find(x=>x.id==='jt-inverter-rep')?.missing_mandatory_forms,['JSA','ELECTRICAL']);
    const settingsUrl=root+'solarcell/settings';
    const setThreshold=async(token:string,cents:number)=>{
      const current=await req(settingsUrl,{headers:{Authorization:owner}});
      assert.equal(current.status,200);
      return req(settingsUrl,{method:'PATCH',headers:{Authorization:token,'If-Match':current.headers.get('etag')!,'Content-Type':'application/json'},
        body:JSON.stringify({contract_threshold_cents:cents})});
    };
    for(const role of [office,technician]) assert.equal((await setThreshold(role,1)).status,403);
    for(const [role,cents] of [[owner,350000],[superAdmin,330000]] as const){
      const response=await setThreshold(role,cents);
      assert.equal(response.status,200,await response.clone().text());
      const saved=await (await req(settingsUrl,{headers:{Authorization:owner}})).json() as {contract_threshold_cents:number};
      assert.equal(saved.contract_threshold_cents,cents);
    }
    const switchStaff=(token:string,from:string,to:string)=>req(root+'solarcell/staff/'+G01_TEST_AUTH.officeStaff.userId+'/role',{
      method:'PATCH',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({previous_role:from,role:to})});
    for(const denied of [office,technician]) assert.equal((await switchStaff(denied,'office_staff','technician')).status,403);
    assert.equal((await switchStaff(owner,'office_staff','super_admin')).status,422);
    assert.equal((await switchStaff(owner,'office_staff','technician')).status,200);
    assert.equal((await switchStaff(owner,'office_staff','technician')).status,409);
    assert.equal((await switchStaff(superAdmin,'technician','office_staff')).status,200);
    const created = await req(base,post(office));
    assert.equal(created.status,201,await created.clone().text());
    const receipt = await created.json() as {job_id:string};
    assert.equal((await req(base+'/'+receipt.job_id,{headers:{Authorization:technician}})).status,404);
    for (const authorization of [office,owner,superAdmin]) {
      assert.equal((await req(base+'/'+receipt.job_id,{headers:{Authorization:authorization}})).status,200);
    }
    const replay = await req(base,post(office));
    assert.equal(replay.status,201);
    assert.deepEqual(await replay.json(),receipt);
    const changed = await req(base,post(office,'Different payload'));
    assert.equal(changed.status,409);
    assert.equal((await changed.json() as {code:string}).code,'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await db.prepare("SELECT count(*) AS n FROM compliance_jobs WHERE title='Synthetic route job'").first('n'),1);
    await db.batch([
      db.prepare("INSERT INTO compliance_operations VALUES('answer-slot','solarcell',?,'ADD',?,1,?)")
        .bind(G01_TEST_AUTH.officeStaff.userId,receipt.job_id,'a'.repeat(64)),
      db.prepare("INSERT INTO compliance_requirements VALUES('solarcell',?,'route-slot','guard-rev','ADDITIONAL',0,'Answer route fixture','answer-slot')")
        .bind(receipt.job_id),
    ]);
    const save = (authorization: string, key: string, expected = 0, ifMatch = '"1"', result: unknown = 'PASS') =>
      req(base+'/'+receipt.job_id,{method:'PATCH',headers:{Authorization:authorization,'Idempotency-Key':key,'If-Match':ifMatch},
        body:JSON.stringify({occurrence_key:'route-slot',expected_answer_version:expected,answers:{result}})});
    assert.equal((await save(technician,'tech')).status,404);
    assert.equal((await save(office,'version',0,'')).status,428);
    const saved = await save(office,'route-save');
    assert.equal(saved.status,200,await saved.clone().text());
    const answerReceipt = await saved.json();
    assert.deepEqual(await (await save(office,'route-save')).json(),answerReceipt);
    assert.equal((await save(owner,'stale')).status,412);
    assert.equal((await save(owner,'owner-save',1)).status,200);
    assert.equal((await save(office,'bad-answer',2,'"1"',42)).status,422);
    const conflicting = await Promise.all([save(office,'race-a',2),save(owner,'race-b',2)]);
    assert.deepEqual(conflicting.map(response=>response.status).sort(),[200,412]);
    await db.batch([
      db.prepare("INSERT INTO compliance_operations VALUES('route-assign','solarcell',?,'ASSIGN',?,1,?)")
        .bind(G01_TEST_AUTH.officeStaff.userId,receipt.job_id,'c'.repeat(64)),
      db.prepare("UPDATE compliance_jobs SET assignee_id=?,version=2,operation_id='route-assign' WHERE id=?")
        .bind(G01_TEST_AUTH.technician.userId,receipt.job_id),
    ]);
    assert.equal((await save(technician,'assigned-tech',3,'"2"')).status,200);
    await authTest.test('private R2 evidence staging, finalization, authorization and reconciliation',async()=>{
      await evidenceJourney(url,base+'/'+receipt.job_id,db,(await worker.getEnv()).PRIVATE_EVIDENCE,{technician,owner,office,superAdmin});
    });


    await authTest.test('Run 3 authenticated sign and complete with private evidence',async()=>{
      const staleTech='Bearer '+await identity.token(G01_TEST_AUTH.technician.uid,G01_TEST_AUTH.technician.email,{auth_time:Math.floor(Date.now()/1000)-600});
      await signingJourney(url,base,db,(await worker.getEnv()).PRIVATE_EVIDENCE,{owner,technician,office,superAdmin,staleTech});
    });
    await authTest.test('Run 1c atomic failures and recovery',async t=>atomicJourney(t,url,base,db,{office,owner,technician,superAdmin}));
    await authTest.test('dispatch authorization, conflict, replay and preserved job evidence',async()=>{
      const visits=root+'solarcell/visits';
      const unavailable=await req(visits,{headers:{Authorization:office}});
      assert.equal(unavailable.status,503);
      assert.equal((await unavailable.json() as {code:string}).code,'OPERATIONAL_STORAGE_NOT_READY');
      await db.prepare(verifiedMigrations.get('0016_compliance_visit_events.sql')!.toString('utf8')).run();
      const proposedDetails=verifiedMigrations.get('0017_operational_job_details.sql')!.toString('utf8')
        .replace(/^--.*$/gm,'').trim().split(/(?=^(?:CREATE|ALTER) )/m);
      await db.batch(proposedDetails.map(sql=>db.prepare(sql.trim())));
      const createJob=(fields:Record<string,string>)=>req(base,{...post(office),headers:{...post(office).headers,'Idempotency-Key':randomUUID()},body:JSON.stringify({title:'Dispatch fixture',job_type_id:'jt-solar-install',expected_policy_id:'invoice-with-slot',assignee_id:G01_TEST_AUTH.technician.userId,...fields})});
      assert.equal((await createJob({})).status,422);
      const create=await createJob({customer_name:'Fixture Customer',site_address:'1 Fixture Street'});
      assert.equal(create.status,201);
      const id=(await create.json() as {job_id:string}).job_id;
      const original={visit_id:randomUUID(),job_id:id,version:1,technician_id:G01_TEST_AUTH.technician.userId,starts_at:'2026-11-25T02:00:00.000Z',duration_minutes:90,status:'SCHEDULED',reason:''};
      const call=(actor:string,data?:typeof original,key=randomUUID(),route=visits)=>req(route,{method:data?'POST':'GET',headers:{Authorization:actor,'Content-Type':'application/json',...(data?{'Idempotency-Key':key}:{})},body:data?JSON.stringify(data):undefined});
      assert.equal((await call('',original)).status,401);
      assert.equal((await call(technician,original)).status,403);
      assert.equal((await call(office,original,randomUUID(),root+'cctv/visits')).ok,false);
      const jobBefore=await (await req(base+'/'+id,{headers:{Authorization:office}})).json();
      assert.equal((jobBefore as {job:{customer_name:string;site_address:string}}).job.customer_name,'Fixture Customer');
      assert.equal((jobBefore as {job:{customer_name:string;site_address:string}}).job.site_address,'1 Fixture Street');
      assert.equal((await call(office,{...original,duration_minutes:0})).status,422);
      const assignmentUrl=base+'/'+id+'?operation=ASSIGN';
      const assign=(assignee_id:string|null)=>req(assignmentUrl,{method:'POST',headers:{Authorization:office,'Content-Type':'application/json','Idempotency-Key':randomUUID(),'If-Match':'"1"'},body:JSON.stringify({assignee_id})});
      const key=randomUUID();
      assert.equal((await call(office,original,key)).status,200);
      const unassign=await assign(null);
      assert.equal((await unassign.json() as {code?:string}).code,'SCHEDULED_VISIT_ASSIGNMENT_CONFLICT');
      assert.equal((await call(office,original,key)).status,200);
      assert.equal((await call(office,{...original,reason:'different'},key)).status,409);
      assert.ok((await (await call(technician)).json() as {job_id:string}[]).some(v=>v.job_id===id));
      const race=await Promise.all(['03','04'].map(h=>call(office,{...original,version:2,starts_at:'2026-11-25T'+h+':00:00.000Z'})));
      assert.deepEqual(race.map(r=>r.status).sort(),[200,412]);
      const winner=await race.find(r=>r.ok)!.json() as typeof original;
      assert.equal(winner.duration_minutes,90);
      assert.equal((await call(office,{...winner,version:3,status:'CANCELLED',reason:'Weather',duration_minutes:60})).status,412);
      assert.equal((await call(office,{...winner,version:3,status:'CANCELLED',reason:'Weather'})).status,200);
      const {visit_history,...afterJob}=await (await req(base+'/'+id,{headers:{Authorization:office}})).json() as {visit_history:{version:number}[]};
      assert.deepEqual({...afterJob,visit_history:[]},jobBefore);
      assert.deepEqual(visit_history.map(event=>event.version),[1,2,3]);
      assert.equal(await db.prepare('SELECT count(*) FROM compliance_visit_events WHERE job_id=?').bind(id).first('count(*)'),3);
      await assert.rejects(()=>db.prepare('UPDATE compliance_visit_events SET duration_minutes=10 WHERE job_id=?').bind(id).run(),/HISTORY_IMMUTABLE/);
      assert.equal((await assign(null)).status,200);
      const inaccessible=await call(office,{...original,visit_id:randomUUID()});
      assert.equal((await inaccessible.json() as {code?:string}).code,'VISIT_ASSIGNEE_MISMATCH');
    });
    if(process.env.CABMS_RUN_COMPLIANCE_BROWSER==='1'){
      await db.prepare("UPDATE compliance_photo_limits SET max_bytes=614400 WHERE workspace_id='solarcell'").run();
      await db.prepare("UPDATE compliance_job_byte_limits SET max_job_bytes=12288000 WHERE workspace_id='solarcell'").run();
      await authTest.test('Chrome technician-to-office compliance journey',async()=>browserJourney(url,base,office,technician,superAdmin,db));
    }
    await authTest.test('the authenticated jobs client follows every workspace-scoped page',async()=>{
      for(let batch=0;batch<3;batch++){
        const statements=Array.from({length:35},(_,i)=>{
          const id='pagination-job-'+String(batch*35+i).padStart(3,'0');
          return [
            db.prepare("INSERT INTO compliance_operations VALUES(?,'solarcell',?,'CREATE',?,0,?)")
              .bind(id,G01_TEST_AUTH.officeStaff.userId,id,'a'.repeat(64)),
            db.prepare(`INSERT INTO compliance_jobs(id,workspace_id,job_type_id,policy_id,title,customer_name,site_address,operation_id)
              VALUES(?,'solarcell','jt-solar-service','pol-solar-service-v1','Pagination fixture','Synthetic','Fixture site',?)`).bind(id,id),
          ];
        }).flat();
        await db.batch(statements);
      }
      const {jobsClient}=await import('../../src/services/complianceJobsClient.ts');
      const {setApiBase,resetApiBase}=await import('../../src/services/g01Client.ts');
      setApiBase(String(url));
      try{
        const api=jobsClient(async()=>office.slice(7));
        const all=await api.list('solarcell');
        const expected=await db.prepare("SELECT id FROM compliance_jobs WHERE workspace_id='solarcell' ORDER BY id").all<{id:string}>();
        assert.ok(all.length>100);
        assert.deepEqual(all.map(job=>job.id),expected.results.map(row=>row.id));
        await assert.rejects(()=>api.list('cctv'),{status:403});
        assert.deepEqual(await jobsClient(async()=>superAdmin.slice(7)).list('cctv'),[]);
      }finally{resetApiBase();}
    });
  });
});
