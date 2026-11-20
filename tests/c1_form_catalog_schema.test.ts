import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

// Disposable SQLite verifies schema constraints; it is not proof of D1/workerd behavior.
test('catalog revisions enforce workspace references and published immutability', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys = ON;
      CREATE TABLE workspaces (id TEXT PRIMARY KEY);
      INSERT INTO workspaces VALUES ('a'), ('b'), ('solarcell'), ('smart_home'), ('cctv');`);
    db.exec(readFileSync(new URL('../migrations/0012_templates_and_content.sql', import.meta.url), 'utf8'));
    db.exec(readFileSync(new URL('../migrations/0013_form_catalog_and_job_forms.sql', import.meta.url), 'utf8'));
    db.exec(`INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,created_at,updated_at) VALUES ('f','a','a','solar','Solar','now','now');
      INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at) VALUES ('r','a','f','v1','DRAFT','now','now');
      INSERT INTO form_sections (id,workspace_id,revision_id,title,display_order) VALUES ('s','a','r','Inspection',0);
      INSERT INTO form_fields (id,workspace_id,section_id,field_key,label,field_type,display_order) VALUES ('q','a','s','result','Result','PASS_FAIL',0);`);
    assert.throws(() => db.exec(`INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at) VALUES ('bad','b','f','v2','DRAFT','now','now')`), /FOREIGN KEY/);
    assert.throws(() => db.exec(`INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,published_revision_id,created_at,updated_at) VALUES ('f2','a','a','other','Other','r','now','now')`), /published/);
    db.exec(`UPDATE form_revisions SET status='REVIEW' WHERE id='r'`);
    assert.throws(() => db.exec(`UPDATE form_revisions SET version='tampered' WHERE id='r'`), /immutable/);
    db.exec(`UPDATE form_revisions SET status='PUBLISHED' WHERE id='r';`);
    assert.throws(() => db.exec(`UPDATE form_fields SET label='changed' WHERE id='q'`), /immutable/);
    assert.throws(() => db.exec(`DELETE FROM form_sections WHERE id='s'`), /immutable/);
    assert.throws(() => db.exec(`INSERT INTO form_fields (id,workspace_id,section_id,field_key,label,field_type,display_order) VALUES ('q2','a','s','x','X','TEXT',1)`), /immutable/);
    assert.throws(() => db.exec(`UPDATE form_revisions SET status='DRAFT' WHERE id='r'`), /immutable/);

    // Cross-workspace isolation proof on composite foreign keys
    db.exec(`INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,created_at,updated_at) VALUES ('f3','b','b','cross','Cross','now','now');`);
    assert.throws(() => db.exec(`UPDATE form_definitions SET published_revision_id='r' WHERE id='f3'`), /FOREIGN KEY|published form pointer/);

    // Additive immutability proof: published policy and template revision metadata modification is strictly blocked
    db.exec(`INSERT INTO job_types (id,workspace_id,code,name,brand_id,status,current_policy_version_id,created_at,updated_at,created_by,updated_by)
      VALUES ('jt1','a','test_jt','Test JT','a','ACTIVE','pol1','now','now','user1','user1');
      INSERT INTO job_type_compliance_policies (id,job_type_id,version,status,is_direct_to_invoice,completion_rule,created_at,updated_at,created_by,approved_by,approved_at)
      VALUES ('pol1','jt1','v1.0','PUBLISHED',0,'ALL','now','now','user1','admin1','now');`);
    assert.throws(() => db.exec(`UPDATE job_type_compliance_policies SET approved_by='attacker' WHERE id='pol1'`), /immutable/);
    assert.throws(() => db.exec(`UPDATE job_type_compliance_policies SET created_by='attacker' WHERE id='pol1'`), /immutable/);

    db.exec(`INSERT INTO document_templates (id,workspace_id,code,name,template_type,status,current_revision_id,sample_file_name,created_at,updated_at,created_by,updated_by)
      VALUES ('tpl1','a','test_tpl','Test Tpl','QUOTE_TERMS','ACTIVE','rev1','sample.docx','now','now','user1','user1');
      INSERT INTO template_revisions (id,template_id,version,content,sample_file_name,status,created_at,updated_at,created_by,approved_by,approved_at)
      VALUES ('rev1','tpl1','v1.0','Body','sample.docx','PUBLISHED','now','now','user1','admin1','now');`);
    assert.throws(() => db.exec(`UPDATE template_revisions SET approved_by='attacker' WHERE id='rev1'`), /immutable/);
    assert.throws(() => db.exec(`UPDATE template_revisions SET created_by='attacker' WHERE id='rev1'`), /immutable/);
  } finally { db.close(); }
});
