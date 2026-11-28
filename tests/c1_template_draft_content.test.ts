import {test} from 'node:test';
import assert from 'node:assert/strict';
import {templateDraftContent} from '../src/utils/templateServerMapping.ts';
test('starting a template draft never invents a wording suffix',()=>{
 assert.equal(templateDraftContent('', 'Approved terms'),'Approved terms');
 assert.equal(templateDraftContent('Edited terms','Approved terms'),'Edited terms');
});
