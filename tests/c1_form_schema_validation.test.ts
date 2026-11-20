import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFormDefinition } from '../backend/modules/forms/formSchema.ts';

const valid = { sections: [{ title: 'Inspection', fields: [
  { key: 'mode', label: 'Mode', type: 'DROPDOWN', required: true, choices: ['On', 'Off'] },
  { key: 'result', label: 'Result', type: 'PASS_FAIL', required: true },
  { key: 'sign', label: 'Technician sign-off', type: 'SIGNATURE', required: true },
] }] };
test('form schema accepts typed draft and rejects malformed definitions', () => {
  assert.deepEqual(validateFormDefinition(valid), []);
  assert.ok(validateFormDefinition({ sections: [{ title: 'A', fields: [{ key: 'x', label: 'X', type: 'DROPDOWN', choices: [] }] }] }).length);
  assert.ok(validateFormDefinition({ sections: [{ title: 'A', fields: [{ key: 'x', label: 'X', type: 'TEXT' }, { key: 'x', label: 'Y', type: 'TEXT' }] }] }).length);
  assert.ok(validateFormDefinition({ sections: [{ title: 'A', fields: [{ key: 'x', label: 'X', type: 'UNSUPPORTED' }] }] }).length);
  assert.ok(validateFormDefinition({ sections: [{ title: 'A', fields: [{ key: 'x', label: 'X', type: 'TEXT', autofill_source: 'user.password' }] }] }).length);
  assert.deepEqual(validateFormDefinition({sections:[{title:'Results',fields:[{key:'result',label:'Result',type:'YES_NO_NA',required:true},{key:'detail',label:'Details',type:'LONG_TEXT',required:false,visible_when:{field:'result',equals:'NO'},validation:{max_length:1000}}]}]}),[]);
  assert.ok(validateFormDefinition({sections:[{title:'Results',fields:[{key:'detail',label:'Details',type:'LONG_TEXT',visible_when:{field:'missing',equals:'NO'}}]}]}).length);
  assert.ok(validateFormDefinition({sections:[{title:'Results',fields:[{key:'n',label:'Number',type:'NUMBER',validation:{min:10,max:5}}]}]}).length);
});
test('repeatable tables require bounded, typed, non-nested columns', () => {
 const definition = (validation: unknown) => ({sections:[{title:'Inspection',fields:[{key:'items',label:'Items',type:'REPEATABLE_TABLE',validation}]}]});
 const columns = [{key:'location',label:'Location',type:'TEXT',required:true},{key:'result',label:'Result',type:'PASS_FAIL'}];
 assert.deepEqual(validateFormDefinition(definition({max_rows:10,columns})), []);
 assert.ok(validateFormDefinition(definition({max_rows:101,columns})).length);
 assert.ok(validateFormDefinition(definition({max_rows:10,columns:[...columns,columns[0]]})).length);
 assert.ok(validateFormDefinition(definition({max_rows:10,columns:[{key:'nested',label:'Nested',type:'REPEATABLE_TABLE'}]})).length);
 assert.ok(validateFormDefinition(definition({max_rows:10,columns:[{key:'sign',label:'Signature',type:'SIGNATURE'}]})).length);
 assert.ok(validateFormDefinition({sections:[{title:'Inspection',fields:[{key:'items',label:'Items',type:'REPEATABLE_TABLE'}]}]}).length);
});
