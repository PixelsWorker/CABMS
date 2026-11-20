import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { FormLibrary } from '../src/components/FormLibrary.tsx';
import { resetApiFetchHandler, setApiFetchHandler } from '../src/services/g01Client.ts';

test('form library renders ten newest active forms, pages and archived filter', async () => {
 const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'http://localhost/'});
 const previous = {window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 Object.defineProperty(globalThis,'window',{configurable:true,value:dom.window});
 Object.defineProperty(globalThis,'document',{configurable:true,value:dom.window.document});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.window.navigator});
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 (dom.window.HTMLElement.prototype as any).attachEvent = () => {};
 (dom.window.HTMLElement.prototype as any).detachEvent = () => {};
 const forms = Array.from({length:12},(_,i)=>({id:`id${i}`,title:`Form ${i}`,code:`F${i}`,description:'Test',category:'Safety',brand_id:'solarcell',status:i===11?'ARCHIVED':'DRAFT',created_at:new Date(Date.UTC(2026,0,i+1)).toISOString(),updated_at:new Date(Date.UTC(2026,0,i+1)).toISOString(),published_revision_id:null}));
 setApiFetchHandler(async request => {
  const match = new URL(request.url).pathname.match(/\/form-definitions\/(id\d+)$/);
  if (match && request.method === 'PATCH') { const body = await request.json() as {action:string}; if (body.action === 'restore') forms.find(f=>f.id===match[1])!.status='DRAFT'; return Response.json({success:true}); }
  return Response.json(match ? {...forms.find(f=>f.id===match[1]),revisions:[{id:'draft-1',status:'DRAFT',version:'v1.1',sections:[]},{id:'review-1',status:'REVIEW',version:'v1.0',sections:[{title:'Review section',fields:[{key:'result',label:'Inspection result',type:'PASS_FAIL',required:true,instructions:'Inspect the inverter before recording a result.'}]}]}]} : forms);
 });
 const session:Session = { profile:{user:{id:'test',email:'test@example.invalid',display_name:null},memberships:[{workspace_id:'solarcell',role:'owner_admin',name:'Solarcell'}]},loading:false,error:'',login:async()=>{},logout:async()=>{},token:async()=>'test-token',workspaceId:'solarcell',selectWorkspace:()=>{},invalidate:()=>{} };
 const container = dom.window.document.getElementById('root')!; const root=createRoot(container);
 try {
  await act(async()=>{root.render(React.createElement(SessionContext.Provider,{value:session},React.createElement(FormLibrary)));});
  assert.equal(container.querySelectorAll('tbody tr').length,10);
  assert.equal(container.querySelector('tbody tr td')?.textContent,'Form 10');
  assert.match(container.textContent || '',/Showing 1–10 of 11/);
  const click=async(label:string)=>{const button=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()===label);assert.ok(button,`missing ${label}`);await act(async()=>{button.click();});};
  assert.equal(container.querySelector('[aria-label="Form title"]'),null,'creation fields are hidden until Add Form is clicked');
  await click('+ Add Form');
  assert.ok(container.querySelector('[role="dialog"][aria-label="Add Form Definition"]'));
  assert.ok(container.querySelector('[aria-label="Form title"]'));
  await click('Cancel');
  assert.equal(container.querySelector('[role="dialog"]'),null);
  await click('View / Edit');
  assert.ok(container.querySelector('[role="dialog"][aria-label="View or edit form definition"]'));
  await click('View v1.0 · REVIEW');
  assert.match(container.textContent || '',/Inspection result/);
  assert.match(container.textContent || '',/Inspect the inverter before recording a result/);
  assert.match(container.textContent || '',/Review section/);
  await click('View v1.1 · DRAFT');
  assert.match(container.textContent || '',/No sections yet/);
  await click('Add Section');
  assert.ok(container.querySelector('[aria-label="Section 1 title"]'));
  assert.match(container.textContent || '',/Section 1/);
  await click('+ Add Field');
  const fieldType = container.querySelector('[aria-label="Field type"]') as HTMLSelectElement;
  await act(async()=>{fieldType.value='REPEATABLE_TABLE';fieldType.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  assert.ok(container.querySelector('[aria-label="Maximum rows"]'));
  await click('+ Add column');
  assert.ok(container.querySelector('[aria-label="Column key"]'));
  await click('Discard Changes');
  await click('Close');
  assert.equal(container.querySelector('[role="dialog"]'),null);
  await click('Next'); assert.equal(container.querySelector('tbody tr td')?.textContent,'Form 0');
  await click('Archived'); assert.equal(container.querySelector('tbody tr td')?.textContent,'Form 11');
  await click('View / Edit'); await click('Restore');
  assert.match(container.textContent || '',/Form restored/);
  await click('Close'); await click('Active');
  assert.equal(container.querySelector('tbody tr td')?.textContent,'Form 11');
  await click('All (12)'); assert.equal(container.querySelector('tbody tr td')?.textContent,'Form 11');
 } finally {
  await act(async()=>root.unmount()); resetApiFetchHandler(); dom.window.close();
  for (const [key,value] of Object.entries(previous)) Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;
 }
});
