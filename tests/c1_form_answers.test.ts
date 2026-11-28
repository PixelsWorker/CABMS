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
import { sanitizeFormAnswers } from '../backend/modules/forms/formAnswers.ts';
test('hidden parents cannot expose descendants through stale client values',()=>{
 const chain=[{key:'a',type:'CHECKBOX'},{key:'b',type:'CHECKBOX',visible_when:{field:'a',equals:true}},{key:'c',type:'TEXT',required:true,visible_when:{field:'b',equals:true}}];
 assert.deepEqual(sanitizeFormAnswers(chain,{a:false,b:true,c:'stale'}),{a:false});
 assert.deepEqual(validateFormAnswers(chain,{a:false,b:true}),[]);
 assert.ok(validateFormAnswers(chain,{a:true,b:true}).includes('c: required'));
});
test('all field types accept their data model and reject invalid values or unverified evidence',()=>{
 const cases:any[]=[
  ['TEXT','ok',42],['LONG_TEXT','ok',false],['NUMBER',3,'3'],['DATE','2026-02-28','2026-02-30'],['DATETIME','2026-02-28T10:00:00Z','2026-02-28T10:00'],
  ['DROPDOWN','A','B'],['MULTIPLE_CHOICE','A','B'],['MULTISELECT',['A'],['B']],['CHECKBOX',true,'true'],['YES_NO_NA','NA','FAIL'],['PASS_FAIL','FAIL','NA'],['PASS_FAIL_NA','NA','NO'],['READONLY_AUTOFILL','value',3],
 ];
 for(const [type,good,bad] of cases){const f=[{key:'x',type,required:true,choices:['A']}];assert.deepEqual(validateFormAnswers(f,{x:good}),[],type);assert.ok(validateFormAnswers(f,{x:bad}).length,type);}
 for(const type of ['PHOTO','FILE','SIGNATURE']){const f=[{key:'x',type,required:true}];assert.ok(validateFormAnswers(f,{x:'simulated'}).length,type);assert.deepEqual(validateFormAnswers(f,{},type==='SIGNATURE'?{verifiedSignatures:['x']}:{verifiedEvidence:['x']}),[]);}
});
test('required checkbox and length or number bounds are enforced',()=>{
 assert.ok(validateFormAnswers([{key:'x',type:'CHECKBOX',required:true}],{x:false}).length);
 for(const n of [1,11]) assert.ok(validateFormAnswers([{key:'x',type:'NUMBER',validation:{min:2,max:10}}],{x:n}).length);
 for(const s of ['a','abcd']) assert.ok(validateFormAnswers([{key:'x',type:'TEXT',validation:{min_length:2,max_length:3}}],{x:s}).length);
});
