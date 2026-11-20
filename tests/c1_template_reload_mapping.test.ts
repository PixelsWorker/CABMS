import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mapTemplateDetail} from '../src/utils/templateServerMapping.ts';

test('reload keeps pending revision editable while the published revision stays effective',()=>{
 const source={id:'tpl-1',code:'terms',name:'Terms',template_type:'QUOTE_TERMS',status:'ACTIVE',current_revision_id:'pub-id',current_version:'v1.0',current_content:'Approved',revision_status:'PUBLISHED',updated_at:'2026-01-01T00:00:00Z',revisions:[
  {id:'draft-id',version:'v2.0-draft',status:'DRAFT',content:'New draft',created_at:'2026-02-01T00:00:00Z',updated_at:'2026-02-01T00:00:00Z'},
  {id:'pub-id',version:'v1.0',status:'PUBLISHED',content:'Approved',created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'}]};
 const mapped=mapTemplateDetail(source); assert.ok(mapped);
 assert.equal(mapped.currentRevisionId,'pub-id'); assert.equal(mapped.publishedVersion,'v1.0');
 assert.equal(mapped.editingRevisionId,'draft-id'); assert.equal(mapped.activeStatus,'DRAFT');
 assert.equal(mapped.content,'New draft'); assert.equal(mapped.revisions.length,2);
 assert.equal(mapTemplateDetail({...source,revisions:source.revisions.filter(r=>r.id!=='pub-id')}),null,'missing authoritative published revision fails closed');
});
