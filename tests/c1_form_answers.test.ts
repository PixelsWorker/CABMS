import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFormAnswers } from '../backend/modules/forms/formAnswers.ts';
const fields = [
 {key:'mode',type:'DROPDOWN',required:true,choices:['On','Off']},
 {key:'result',type:'PASS_FAIL',required:true},
 {key:'detail',type:'LONG_TEXT',required:true,visible_when:{field:'result',equals:'FAIL'},validation:{max_length:10}},
 {key:'sign',type:'SIGNATURE',required:true},
];
test('mandatory answers, conditional fields and signature must be valid',()=>{
 assert.ok(validateFormAnswers(fields,{mode:'On',result:'PASS'}).length);
 assert.ok(validateFormAnswers(fields,{mode:'bad',result:'PASS',sign:'signed'}).length);
 assert.ok(validateFormAnswers(fields,{mode:'On',result:'FAIL',sign:'signed'}).length);
 assert.ok(validateFormAnswers(fields,{mode:'On',result:'FAIL',detail:'too long a detail',sign:'signed'}).length);
 assert.ok(validateFormAnswers(fields,{mode:'On',result:'PASS',sign:'signed'}).length, 'client-supplied text is not a verified signature');
 assert.deepEqual(validateFormAnswers(fields,{mode:'On',result:'PASS'},{verifiedSignatures:['sign']}),[]);
 assert.deepEqual(validateFormAnswers(fields,{mode:'On',result:'FAIL',detail:'Fix'},{verifiedSignatures:['sign']}),[]);
 assert.ok(validateFormAnswers(fields,{mode:'On',result:'PASS',sign:'signed',unexpected:'x'}).length);
});
test('repeatable table rows use their approved column schema and row limit',()=>{
 const table=[{key:'alarms',type:'REPEATABLE_TABLE',required:true,validation:{max_rows:2,columns:[{key:'location',label:'Location',type:'TEXT',required:true},{key:'result',label:'Result',type:'PASS_FAIL',required:true}]}}];
 assert.ok(validateFormAnswers(table,{alarms:[]}).length);
 assert.ok(validateFormAnswers(table,{alarms:[{location:'Kitchen'}]}).length);
 assert.ok(validateFormAnswers(table,{alarms:[{location:'Kitchen',result:'PASS',unknown:'x'}]}).length);
 assert.ok(validateFormAnswers(table,{alarms:[{location:'A',result:'PASS'},{location:'B',result:'PASS'},{location:'C',result:'FAIL'}]}).length);
 assert.deepEqual(validateFormAnswers(table,{alarms:[{location:'Kitchen',result:'PASS'}]}),[]);
});
