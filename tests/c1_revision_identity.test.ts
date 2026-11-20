import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingRevisionId, publishedTemplateFromServer } from '../src/utils/revisionIdentity.ts';
test('review and publish select server IDs by state rather than current pointers or version labels',()=>{
 const revisions=[{id:'draft-uuid',version:'v2.0',status:'DRAFT'},{id:'published-uuid',version:'v1.0',status:'PUBLISHED'}];
 assert.equal(pendingRevisionId(revisions,'DRAFT'),'draft-uuid');
 assert.equal(pendingRevisionId([{version:'v3.0',status:'DRAFT'}],'DRAFT'),null);
 assert.equal(pendingRevisionId(revisions,'REVIEW'),null);
 assert.equal(pendingRevisionId([{id:'review-uuid',version:'v2.0',status:'REVIEW'},...revisions],'REVIEW'),'review-uuid');
});
test('template publication adopts the server revision and version',()=>{
 const result = publishedTemplateFromServer({current_revision_id:'server-revision',current_version:'v2.0',current_content:'Approved',revision_status:'PUBLISHED'});
 assert.deepEqual(result,{currentRevisionId:'server-revision',currentVersion:'v2.0',content:'Approved',activeStatus:'PUBLISHED'});
 assert.equal(publishedTemplateFromServer({current_revision_id:null,current_version:'v2.0',current_content:'A',revision_status:'PUBLISHED'}),null);
});
