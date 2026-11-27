import { proposalPath } from './support/proposalPath.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLocalD1Database,type LocalD1Database} from '../backend/db/d1.ts';
import {initializePreOperationalDatabase} from './support/preOperationalMigrations.ts';

test('IN-MEMORY ONLY: proposed forward guards protect nullable published metadata',async t=>{
 const db=createLocalD1Database() as LocalD1Database;t.after(()=>db.getSqliteHandle().close());await initializePreOperationalDatabase(db);
 // Establish both starting values using the existing vulnerable guards, before candidate installation.
 await db.exec("UPDATE job_type_compliance_policies SET approved_by=NULL WHERE id='pol-solar-service-v1'; UPDATE template_revisions SET sample_file_name=NULL,effective_at=NULL WHERE id='rev-solar-quote-v1';");
 await db.exec(readFileSync(proposalPath('0014_c1_null_safe_guards_candidate.sql'),'utf8'));
 await assert.rejects(()=>db.exec("UPDATE job_type_compliance_policies SET approved_by='changed' WHERE id='pol-solar-service-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE job_type_compliance_policies SET approved_by=NULL WHERE id='pol-solar-install-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE job_type_compliance_policies SET approved_at=NULL WHERE id='pol-solar-install-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE job_type_compliance_policies SET job_type_id='jt-inverter-rep' WHERE id='pol-solar-install-v1'"),/immutable/);
 await db.exec("UPDATE job_type_compliance_policies SET approved_by=NULL WHERE id='pol-solar-service-v1'");
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET sample_file_name='changed' WHERE id='rev-solar-quote-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET sample_file_name=NULL WHERE id='rev-solar-inv-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET approved_by=NULL WHERE id='rev-solar-inv-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET effective_at=NULL WHERE id='rev-solar-inv-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET effective_at='2027-01-01' WHERE id='rev-solar-quote-v1'"),/immutable/);
 await assert.rejects(()=>db.exec("UPDATE template_revisions SET template_id='tpl-solar-quote' WHERE id='rev-solar-inv-v1'"),/immutable/);
 await db.exec("UPDATE template_revisions SET sample_file_name=NULL WHERE id='rev-solar-quote-v1'");
 await db.exec("UPDATE template_revisions SET effective_at=NULL WHERE id='rev-solar-quote-v1'");
 await assert.rejects(()=>db.exec("INSERT INTO job_type_required_forms(id,policy_version_id,form_type,required,display_order) VALUES('guard-test','pol-solar-service-v1','TCA2',1,0)"),/immutable/);
 await db.exec("INSERT INTO job_type_compliance_policies(id,job_type_id,version,status,created_at,updated_at) VALUES('guard-draft','jt-solar-service','draft-guard','DRAFT','2026','2026'); INSERT INTO job_type_required_forms(id,policy_version_id,form_type,required,display_order) VALUES('guard-draft-form','guard-draft','TCA2',1,0)");
});
