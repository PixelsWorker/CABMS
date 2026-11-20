import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getJobFormPage} from '../src/utils/jobFormPagination.ts';

test('job form selector sorts newest first, filters and limits pages to ten',()=>{
 const forms=Array.from({length:23},(_,i)=>({id:`id${i}`,title:`Form ${i}`,code:`CODE-${i}`,created_at:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
 const first=getJobFormPage(forms,'',1);
 assert.equal(first.total,23);assert.equal(first.pages,3);assert.equal(first.items.length,10);assert.equal(first.items[0].id,'id22');
 const second=getJobFormPage(forms,'',2);assert.equal(second.items[0].id,'id12');assert.equal(second.items.length,10);
 assert.deepEqual(getJobFormPage(forms,'code-3',1).items.map(f=>f.id),['id3']);
 assert.deepEqual(getJobFormPage(forms,' FORM 10 ',1).items.map(f=>f.id),['id10']);
 assert.equal(getJobFormPage(forms,'missing',4).page,1);
 assert.equal(getJobFormPage(forms,'',99).page,3);
});
