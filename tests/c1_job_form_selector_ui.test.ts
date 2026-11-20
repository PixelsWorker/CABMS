import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {JobFormSelector} from '../src/components/JobFormSelector.tsx';

test('job form selector preserves selections while paging and searching',async()=>{
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'});
 const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
 for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator})) Object.defineProperty(globalThis,key,{configurable:true,value});
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 const forms=Array.from({length:12},(_,i)=>({id:`id${i}`,title:`Form ${i}`,code:`CODE-${i}`,created_at:new Date(Date.UTC(2026,0,i+1)).toISOString(),published_revision_id:`rev${i}`}));
 function Harness(){const [selected,setSelected]=useState<string[]>([]);return React.createElement(JobFormSelector,{forms,selected,onChange:setSelected});}
 const container=dom.window.document.getElementById('root')!,root=createRoot(container);
 try{
  await act(async()=>root.render(React.createElement(Harness)));
  assert.equal(container.querySelectorAll('input[type="checkbox"]').length,10);
  const first=container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;assert.equal(first.value,'rev11');
  await act(async()=>first.click());
  const click=async(label:string)=>{const button=Array.from(container.querySelectorAll('button')).find(b=>b.textContent?.trim()===label);assert.ok(button);await act(async()=>button.click());};
  await click('Next');const last=container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;assert.equal(last.value,'rev1');await act(async()=>last.click());
  await click('Previous');assert.equal(container.querySelector<HTMLInputElement>('input[value="rev11"]')?.checked,true);
  assert.match(container.textContent || '',/2 selected/);
  const search=container.querySelector<HTMLInputElement>('input[aria-label="Search required forms"]')!;
  const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value')!.set!;
  await act(async()=>{setter.call(search,'CODE-1');const k=Object.keys(search).find(key=>key.startsWith('__reactProps$'));if(k)(search as any)[k].onChange({target:{value:'CODE-1'}});});
  assert.equal(container.querySelector<HTMLInputElement>('input[value="rev11"]')?.checked,true);
  assert.match(container.textContent || '',/2 selected/);
 }finally{await act(async()=>root.unmount());dom.window.close();for(const [key,value] of Object.entries(previous))Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT;}
});
