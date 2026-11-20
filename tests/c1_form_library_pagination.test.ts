import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFormLibraryPage } from '../src/utils/formLibraryPagination.ts';

test('form library shows newest first, ten per page, and filters archived separately', () => {
 const rows = Array.from({length:23},(_,i)=>({id:String(i),title:`Form ${i}`,code:`F${i}`,category:'Safety',status:i===22?'ARCHIVED':'DRAFT',created_at:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
 const first = getFormLibraryPage(rows,{scope:'ACTIVE',page:1});
 assert.equal(first.total,22); assert.equal(first.pages,3); assert.equal(first.items.length,10); assert.equal(first.items[0].id,'21');
 const second = getFormLibraryPage(rows,{scope:'ACTIVE',page:2}); assert.equal(second.items.length,10); assert.equal(second.items[0].id,'11');
 assert.deepEqual(getFormLibraryPage(rows,{scope:'ARCHIVED',page:1}).items.map(f=>f.id),['22']);
 assert.equal(getFormLibraryPage(rows,{scope:'ALL',page:99}).page,3);
 assert.deepEqual(getFormLibraryPage(rows,{scope:'ALL',page:1,search:'F20'}).items.map(f=>f.id),['20']);
 assert.equal(getFormLibraryPage(rows,{scope:'ACTIVE',page:1,category:'Electrical'}).total,0);
});
