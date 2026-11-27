import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { initializePreOperationalDatabase } from './support/preOperationalMigrations.ts';
import { createWorker } from '../backend/index.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

test('custom form draft reloads and requires authorized review and publication', async t => {
 const db = createLocalD1Database() as LocalD1Database; t.after(() => db.getSqliteHandle().close());
 await initializePreOperationalDatabase(db); await installG01TestAuthFixtures(db);
 const fixture = await createFirebaseFixture(); const worker = createWorker(createAuthenticationService(fixture.transport));
 const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
 const staff = await fixture.token(G01_TEST_AUTH.officeStaff.uid,G01_TEST_AUTH.officeStaff.email);
 const owner = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid,G01_TEST_AUTH.ownerAdmin.email);
 const req = (path: string, token: string, method = 'GET', body?: unknown, workspace = 'solarcell') => worker.fetch(new Request(`http://localhost/api/v1/workspaces/${workspace}/${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? {'Content-Type':'application/json'} : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
 const docTypeResponse = await req('document-types',staff,'POST',{code:'CUSTOM-001',title:'Custom certificate'});
 assert.equal(docTypeResponse.status,201);
 const docType = await docTypeResponse.json() as {id:string};
 assert.equal((await req(`document-types/${docType.id}/publish`,staff,'POST')).status,403);
 assert.equal((await req(`document-types/${docType.id}/publish`,owner,'POST')).status,400);
 assert.equal((await req(`document-types/${docType.id}/review`,staff,'POST')).status,200);
 await assert.rejects(()=>db.exec(`UPDATE document_type_catalog SET title='Changed after review' WHERE id='${docType.id}'`),/immutable/);
 assert.equal((await req(`document-types/${docType.id}/publish`,owner,'POST')).status,200);
 await assert.rejects(()=>db.exec(`DELETE FROM document_type_catalog WHERE id='${docType.id}'`),/immutable/);
 const types = await (await req('document-types?published=1',staff)).json() as any[];
 assert.ok(types.some(t=>t.id===docType.id && t.status==='PUBLISHED'));
 assert.equal((await req(`document-types/${docType.id}/publish`,owner,'POST',undefined,'cctv')).status,403);
 const starting = await (await req('form-definitions',staff)).json() as any[];
 assert.equal(starting.filter(f=>['JSA-001','ELEC-001','SMOKE-001','TCA1-001','TCA2-001'].includes(f.code)).length,5);
 assert.ok(starting.every(f=>f.status==='DRAFT' && !f.published_revision_id));
 const schema = { sections: [{ title: 'Inspection', fields: [{ key:'mode',label:'Mode',type:'DROPDOWN',required:true,choices:['On','Off'] },{ key:'result',label:'Result',type:'PASS_FAIL',required:true },{ key:'sign',label:'Sign-off',type:'SIGNATURE',required:true }] }] };
 const disposable = await req('form-definitions',staff,'POST',{title:'Unused draft',code:'UNUSED-001',description:'Draft for deletion',category:'Custom',brand_id:'solarcell',schema});
 assert.equal(disposable.status,201); const disposableIds = await disposable.json() as {id:string};
 assert.equal((await req(`form-definitions/${disposableIds.id}`,staff,'DELETE',undefined,'cctv')).status,403);
 assert.equal((await req(`form-definitions/${disposableIds.id}`,staff,'DELETE')).status,200);
 assert.equal((await req(`form-definitions/${disposableIds.id}`,staff)).status,404);
 const empty = await req('form-definitions',staff,'POST',{ title:'Empty form',code:'empty_form',description:'Empty draft',category:'Custom',brand_id:'solarcell',schema:{sections:[]} });
 assert.equal(empty.status,201); const emptyIds = await empty.json() as {id:string; revision_id:string};
 const emptyUpdatedAt = ((await (await req(`form-definitions/${emptyIds.id}`,staff)).json()) as any).revisions[0].updated_at;
 assert.equal((await req(`form-definitions/${emptyIds.id}/revisions/${emptyIds.revision_id}/review`,staff,'POST',{expected_updated_at:emptyUpdatedAt})).status,400);
 assert.equal((await req(`form-definitions/${emptyIds.id}`,staff,'PATCH',{action:'archive'})).status,200);
 assert.equal((await req(`form-definitions/${emptyIds.id}/revisions/${emptyIds.revision_id}`,staff,'PUT',{...schema,expected_updated_at:emptyUpdatedAt})).status,400);
 assert.equal((await req(`form-definitions/${emptyIds.id}`,staff,'PATCH',{action:'restore'},'cctv')).status,403);
 assert.equal((await req(`form-definitions/${emptyIds.id}`,staff,'PATCH',{action:'restore'})).status,200);
 const restored = await (await req(`form-definitions/${emptyIds.id}`,staff)).json() as any;
 assert.equal(restored.status,'DRAFT');
 assert.equal(restored.published_revision_id,null);
 const created = await req('form-definitions',staff,'POST',{ title:'Solar Inverter Inspection Checklist',code:'CUSTOM-001',description:'Inverter inspection',category:'Inspection',brand_id:'solarcell',schema });
 assert.equal(created.status,201); const ids = await created.json() as {id:string; revision_id:string};
 assert.ok(ids.id && ids.revision_id && ids.id !== ids.revision_id);
 assert.equal((await req('templates',staff,'POST',{name:'Unapproved output',templateType:'COMPLIANCE_DISCLAIMER',content:'Output',output:{category:'Compliance',brand_id:'solarcell',linked_form_revision_id:ids.revision_id,layout:{},dynamic_fields:{}}})).status,422);
 const table = {key:'readings',label:'Readings',type:'REPEATABLE_TABLE',validation:{max_rows:10,columns:[{key:'location',label:'Location',type:'TEXT',required:true},{key:'outcome',label:'Outcome',type:'PASS_FAIL',required:true}]}};
 const edited = { sections: [{ title: 'Reordered inspection', fields: [schema.sections[0].fields[1], schema.sections[0].fields[0], {key:'detail',label:'Detail',type:'LONG_TEXT',validation:{max_length:1000},visible_when:{field:'result',equals:'FAIL'}}, schema.sections[0].fields[2],table] }] };
 const initialDetail = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 const initialUpdatedAt = initialDetail.revisions[0].updated_at;
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}`,staff,'PUT',{...edited,expected_updated_at:initialUpdatedAt})).status,200);
 const detail = await req(`form-definitions/${ids.id}`,staff); assert.equal(detail.status,200); const data = await detail.json() as any;
 assert.equal(data.category,'Inspection');
 assert.equal(data.revisions[0].sections[0].fields[0].key,'result'); assert.equal(data.revisions[0].sections[0].fields[1].key,'mode'); assert.equal(data.published_revision_id,null);
 assert.deepEqual(data.revisions[0].sections[0].fields[2].visible_when,{field:'result',equals:'FAIL'});
 assert.equal(data.revisions[0].sections[0].fields[2].validation.max_length,1000);
 assert.deepEqual(data.revisions[0].sections[0].fields[4].validation,table.validation);
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}/approve`,owner,'POST')).status,400);
 const afterEditDetail = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 const afterEditUpdatedAt = afterEditDetail.revisions[0].updated_at;
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}/review`,staff,'POST',{expected_updated_at:afterEditUpdatedAt})).status,200);
 const afterReviewUpdatedAt = ((await (await req(`form-definitions/${ids.id}`,staff)).json()) as any).revisions[0].updated_at;
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}`,staff,'PUT',{...edited,expected_updated_at:afterReviewUpdatedAt})).status,400);
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}/approve`,staff,'POST')).status,403);
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${ids.revision_id}/approve`,owner,'POST')).status,200);
 const afterApproveList = await (await req('form-definitions',staff)).json() as Array<Record<string,unknown>>;
 const approvedListItem = afterApproveList.find(f => f.id === ids.id);
 assert.equal(approvedListItem?.display_version,'Revision 1');
 assert.equal(approvedListItem?.current_version,'v1.0');
 const afterApproveDetail = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 assert.equal(afterApproveDetail.display_version,'Revision 1');
 assert.equal(afterApproveDetail.revisions[0].display_version,'Revision 1');
 assert.equal(afterApproveDetail.revisions[0].version,'v1.0');
 // Fabricated synthetic draft-<uuid> published revision preserves DB version and presents Revision 1.
 await db.batch([
  db.prepare("INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,description,category,status,published_revision_id,created_at,updated_at,created_by) VALUES ('form-legacy-uuid','solarcell','solarcell','LEGACY-UUID-001','Synthetic Draft-UUID Notice','Synthetic draft-uuid version','Cabling','DRAFT',NULL,'2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','test_g01_usr_office')"),
  db.prepare("INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) VALUES ('rev-legacy-uuid','solarcell','form-legacy-uuid','draft-00000000-0000-4000-8000-000000000001','DRAFT','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','test_g01_usr_office')"),
 ]);
 await db.prepare("UPDATE form_revisions SET status='REVIEW' WHERE id='rev-legacy-uuid'").run();
 await db.batch([
  db.prepare("UPDATE form_revisions SET status='PUBLISHED',approved_at='2026-01-01T00:00:00Z',approved_by='test_g01_usr_owner' WHERE id='rev-legacy-uuid'"),
  db.prepare("UPDATE form_definitions SET status='ACTIVE',published_revision_id='rev-legacy-uuid' WHERE id='form-legacy-uuid'"),
 ]);
 const legacyList = await (await req('form-definitions',staff)).json() as Array<Record<string,unknown>>;
 const legacyItem = legacyList.find(f => f.id === 'form-legacy-uuid');
 assert.equal(legacyItem?.current_version,'draft-00000000-0000-4000-8000-000000000001');
 assert.equal(legacyItem?.display_version,'Revision 1');
 const legacyDetail = await (await req('form-definitions/form-legacy-uuid',staff)).json() as any;
 assert.equal(legacyDetail.display_version,'Revision 1');
 assert.equal(legacyDetail.revisions[0].version,'draft-00000000-0000-4000-8000-000000000001');
 assert.equal(legacyDetail.revisions[0].display_version,'Revision 1');
 // Deterministic ordering when published revision timestamps tie (tie-broken by id).
 await db.batch([
  db.prepare("INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,description,category,status,published_revision_id,created_at,updated_at,created_by) VALUES ('form-tie-ts','solarcell','solarcell','TIE-TS-001','Tie Timestamp Form','Tie timestamp test','Cabling','DRAFT',NULL,'2026-01-02T00:00:00Z','2026-01-02T00:00:00Z','test_g01_usr_office')"),
  db.prepare("INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) VALUES ('rev-tie-a','solarcell','form-tie-ts','v1.0','DRAFT','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z','test_g01_usr_office')"),
  db.prepare("INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) VALUES ('rev-tie-b','solarcell','form-tie-ts','v2.0','DRAFT','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z','test_g01_usr_office')"),
 ]);
 await db.prepare("UPDATE form_revisions SET status='REVIEW' WHERE id IN ('rev-tie-a','rev-tie-b')").run();
 await db.batch([
  db.prepare("UPDATE form_revisions SET status='PUBLISHED',approved_at='2026-01-02T00:00:00Z',approved_by='test_g01_usr_owner' WHERE id IN ('rev-tie-a','rev-tie-b')"),
  db.prepare("UPDATE form_definitions SET status='ACTIVE',published_revision_id='rev-tie-b' WHERE id='form-tie-ts'"),
 ]);
 const tieDetail = await (await req('form-definitions/form-tie-ts',staff)).json() as any;
 assert.equal(tieDetail.revisions.find((r:any)=>r.id==='rev-tie-a')?.display_version,'Revision 1');
 assert.equal(tieDetail.revisions.find((r:any)=>r.id==='rev-tie-b')?.display_version,'Revision 2');
 // Out-of-creation-order publication and published_revision_id pointing to Revision 1 while Revision 2 exists.
 await db.batch([
  db.prepare("INSERT INTO form_definitions (id,workspace_id,brand_id,code,title,description,category,status,published_revision_id,created_at,updated_at,created_by) VALUES ('form-ooc','solarcell','solarcell','OOC-001','Out of Order Form','Out of creation order','Cabling','DRAFT',NULL,'2026-01-03T00:00:00Z','2026-01-03T00:00:00Z','test_g01_usr_office')"),
  db.prepare("INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) VALUES ('rev-ooc-a','solarcell','form-ooc','v1.0','DRAFT','2026-01-03T01:00:00Z','2026-01-03T01:00:00Z','test_g01_usr_office')"),
  db.prepare("INSERT INTO form_revisions (id,workspace_id,form_definition_id,version,status,created_at,updated_at,created_by) VALUES ('rev-ooc-b','solarcell','form-ooc','v2.0','DRAFT','2026-01-03T02:00:00Z','2026-01-03T02:00:00Z','test_g01_usr_office')"),
 ]);
 await db.prepare("UPDATE form_revisions SET status='REVIEW' WHERE id IN ('rev-ooc-a','rev-ooc-b')").run();
 await db.batch([
  db.prepare("UPDATE form_revisions SET status='PUBLISHED',approved_at='2026-01-03T03:00:00Z',approved_by='test_g01_usr_owner' WHERE id='rev-ooc-b'"),
  db.prepare("UPDATE form_revisions SET status='PUBLISHED',approved_at='2026-01-03T04:00:00Z',approved_by='test_g01_usr_owner' WHERE id='rev-ooc-a'"),
  db.prepare("UPDATE form_definitions SET status='ACTIVE',published_revision_id='rev-ooc-b' WHERE id='form-ooc'"),
 ]);
 const oocList = await (await req('form-definitions',staff)).json() as Array<Record<string,unknown>>;
 assert.equal(oocList.find(f => f.id === 'form-ooc')?.display_version,'Revision 1');
 const oocDetail = await (await req('form-definitions/form-ooc',staff)).json() as any;
 assert.equal(oocDetail.display_version,'Revision 1');
 assert.equal(oocDetail.revisions.find((r:any)=>r.id==='rev-ooc-b')?.display_version,'Revision 1');
 assert.equal(oocDetail.revisions.find((r:any)=>r.id==='rev-ooc-a')?.display_version,'Revision 2');
 assert.equal((await req(`form-definitions/${ids.id}`,owner,'PATCH',{action:'archive'})).status,200);
 assert.equal((await req(`form-definitions/${ids.id}`,owner,'PATCH',{action:'restore'})).status,200);
 const restoredPublished = await (await req(`form-definitions/${ids.id}`,owner)).json() as any;
 assert.equal(restoredPublished.status,'ACTIVE');
 assert.equal(restoredPublished.published_revision_id,ids.revision_id);
 assert.equal((await req(`form-definitions/${ids.id}`,owner,'DELETE')).status,400,'published definitions cannot be deleted');
 const list = await req('form-definitions?published=1',staff); assert.equal(list.status,200); const published = await list.json() as any[];
 assert.ok(published.some(f => f.id === ids.id && f.published_revision_id === ids.revision_id));
 const newJobType = await req('job-types',staff,'POST',{name:'Inverter Inspection',code:'inverter_check',brandId:'solarcell',isDirectToInvoice:false,formsRequired:[],formRules:[{form_revision_id:ids.revision_id,required:true}]});
 assert.equal(newJobType.status,201);
 const jobTypeIds = await newJobType.json() as {id:string;policyId:string};
 const jobTypeDetail = await (await req(`job-types/${jobTypeIds.id}`,staff)).json() as any;
 assert.ok(jobTypeDetail.policies.find((p:any)=>p.id===jobTypeIds.policyId).form_rules.some((r:any)=>r.form_revision_id===ids.revision_id));
 const jobTypeList = await (await req('job-types',staff)).json() as any[];
 assert.ok(jobTypeList.find(j=>j.id===jobTypeIds.id).catalog_forms.some((f:any)=>f.revision_id===ids.revision_id && f.title==='Solar Inverter Inspection Checklist'));
 assert.equal((await req('templates',staff,'POST',{name:'Wrong brand',templateType:'COMPLIANCE_DISCLAIMER',content:'Output',output:{category:'Compliance',brand_id:'cctv',linked_form_revision_id:ids.revision_id,layout:{},dynamic_fields:{}}})).status,422);
 const template = await req('templates',staff,'POST',{name:'Inverter certificate',templateType:'COMPLIANCE_DISCLAIMER',content:'Inspection output',output:{category:'Compliance',brand_id:'solarcell',document_type_id:docType.id,linked_form_revision_id:ids.revision_id,layout:{},dynamic_fields:{}}});
 assert.equal(template.status,201); const templateIds = await template.json() as {id:string;revisionId:string};
 const templateDetail = await (await req(`templates/${templateIds.id}`,staff)).json() as any;
 assert.equal(templateDetail.revisions[0].output.linked_form_revision_id,ids.revision_id);
 assert.equal(templateDetail.revisions[0].output.category,'Compliance');
 assert.equal(templateDetail.revisions[0].output.document_type_id,docType.id);
 assert.equal((await req(`form-definitions/${ids.id}`,owner,'PATCH',{action:'archive'})).status,400,'a form referenced by a template cannot be archived');
 assert.equal((await req(`templates/${templateIds.id}/revisions/${templateIds.revisionId}/review`,staff,'POST')).status,200);
 assert.equal((await req(`templates/${templateIds.id}/revisions/${templateIds.revisionId}/approve`,owner,'POST')).status,200);
 await assert.rejects(()=>db.exec(`UPDATE template_revision_output SET layout_json='{"tampered":true}' WHERE revision_id='${templateIds.revisionId}'`),/immutable/);
 const templateDraft = await req(`templates/${templateIds.id}/revisions`,staff,'POST',{content:'Updated inspection output'});
 assert.equal(templateDraft.status,201); const nextTemplate = await templateDraft.json() as {id:string};
 const templateHistory = await (await req(`templates/${templateIds.id}`,staff)).json() as any;
 assert.equal(templateHistory.current_revision_id,templateIds.revisionId);
 assert.equal(templateHistory.revisions.find((r:any)=>r.id===nextTemplate.id).output.linked_form_revision_id,ids.revision_id);
 const revisionTimestamp=templateHistory.revisions.find((r:any)=>r.id===nextTemplate.id).updated_at;
 assert.equal((await req(`templates/${templateIds.id}/revisions/${nextTemplate.id}`,staff,'PUT',{content:'No precondition'})).status,428);
 assert.equal((await req(`templates/${templateIds.id}/revisions/${nextTemplate.id}`,staff,'PUT',{content:'Wrong workspace'},'cctv')).status,403);
 const updateDraft=(timestamp:string,content:string)=>worker.fetch(new Request(`http://localhost/api/v1/workspaces/solarcell/templates/${templateIds.id}/revisions/${nextTemplate.id}`,{method:'PUT',headers:{Authorization:`Bearer ${staff}`,'Content-Type':'application/json','If-Match':`"${timestamp}"`},body:JSON.stringify({content})}),env);
 const updatedDraft=await updateDraft(revisionTimestamp,'Saved draft wording');assert.equal(updatedDraft.status,200);
 assert.equal((await updateDraft(revisionTimestamp,'Stale edit')).status,412);
 const updatedHistory=await (await req(`templates/${templateIds.id}`,staff)).json() as any;
 assert.equal(updatedHistory.current_revision_id,templateIds.revisionId);
 assert.equal(updatedHistory.revisions.find((r:any)=>r.id===nextTemplate.id).content,'Saved draft wording');
 assert.equal((await req(`templates/${templateIds.id}/revisions/${nextTemplate.id}/review`,staff,'POST')).status,200);
 assert.equal((await updateDraft((await updatedDraft.json() as {updated_at:string}).updated_at,'Edit after review')).status,412);
 const policyRes = await req('job-types/jt-solar-install/policies',staff,'POST',{isDirectToInvoice:false,formsRequired:['JSA','ELECTRICAL','TCA2'],formRules:[{form_revision_id:ids.revision_id,required:true}]});
 assert.equal((await req('job-types/jt-solar-install/policies',staff,'POST',{isDirectToInvoice:false,formsRequired:['JSA'],formRules:[{form_revision_id:'missing',required:true}]})).status,422);
 assert.equal(policyRes.status,201); const policy = await policyRes.json() as {id:string};
 const jobType = await (await req('job-types/jt-solar-install',staff)).json() as any;
 assert.equal(jobType.current_policy_version_id,'pol-solar-install-v1');
 assert.ok(jobType.policies.find((p:any)=>p.id===policy.id).form_rules.some((rule:any)=>rule.form_revision_id===ids.revision_id && rule.required===1));
 assert.equal((await req(`form-definitions/${ids.id}`,owner,'PATCH',{action:'archive'})).status,400, 'referenced forms cannot be archived');
 assert.equal((await req(`job-types/jt-solar-install/policies/${policy.id}/review`,staff,'POST')).status,200);
 assert.equal((await req(`job-types/jt-solar-install/policies/${policy.id}/approve`,owner,'POST')).status,400, 'custom policy cannot publish before job enforcement is available');
 const newDraft = await req(`form-definitions/${ids.id}/revisions`,staff,'POST');
 assert.equal(newDraft.status,201);
 const next = await newDraft.json() as {revision_id:string};
 assert.notEqual(next.revision_id,ids.revision_id);
 const revised = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 assert.equal(revised.published_revision_id,ids.revision_id);
 assert.equal(revised.revisions.find((r:any)=>r.id===ids.revision_id)?.display_version,'Revision 1');
 const draftRev = revised.revisions.find((r:any)=>r.id===next.revision_id);
 assert.equal(draftRev?.display_version,'Draft revision');
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${next.revision_id}/review`,staff,'POST',{expected_updated_at:draftRev.updated_at})).status,200);
 const inReview = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 assert.equal(inReview.revisions.find((r:any)=>r.id===next.revision_id)?.display_version,'Awaiting approval');
 assert.equal((await req(`form-definitions/${ids.id}/revisions/${next.revision_id}/approve`,owner,'POST')).status,200);
 const secondApproved = await (await req(`form-definitions/${ids.id}`,staff)).json() as any;
 assert.equal(secondApproved.display_version,'Revision 2');
 assert.equal(secondApproved.revisions.find((r:any)=>r.id===next.revision_id)?.display_version,'Revision 2');
 assert.equal(secondApproved.revisions.find((r:any)=>r.id===ids.revision_id)?.display_version,'Revision 1');
 assert.ok(revised.revisions.some((r:any) => r.id === next.revision_id && r.status === 'DRAFT' && r.sections[0].fields.length === 5 && r.sections[0].fields[2].visible_when.field === 'result' && r.sections[0].fields[4].validation.columns.length === 2));
 assert.equal((await req(`form-definitions/${ids.id}`,staff,'GET',undefined,'cctv')).status,403);
 await db.exec('DROP TABLE policy_catalog_form_rules');
 const unavailable = await req('form-definitions',staff);
 assert.equal(unavailable.status,503);
 assert.equal((await unavailable.json() as any).code,'CATALOG_NOT_READY');
 assert.equal((await req('job-types/jt-solar-install',staff)).status,200, 'legacy job type detail remains available without catalog schema');
 const legacy = await req('job-types/jt-inverter-rep/policies',staff,'POST',{isDirectToInvoice:false,formsRequired:['JSA']});
 assert.equal(legacy.status,201); const legacyPolicy = await legacy.json() as {id:string};
 assert.equal((await req(`job-types/jt-inverter-rep/policies/${legacyPolicy.id}/review`,staff,'POST')).status,200);
 assert.equal((await req(`job-types/jt-inverter-rep/policies/${legacyPolicy.id}/approve`,owner,'POST')).status,400, 'publication fails closed when catalog schema is absent');
});
