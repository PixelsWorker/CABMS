import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { useSettingsResource, type SettingsResource } from '../src/services/useSettingsResource.ts';
import { setApiFetchHandler, resetApiFetchHandler, setApiBase, resetApiBase } from '../src/services/g01Client.ts';

test('settings load failures, uncertain saves, retained drafts and session errors', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const root = createRoot(dom.window.document.getElementById('root')!);
  let resource!: SettingsResource;
  let invalidations = 0;
  let mode = 'get500';
  const session: Session = { profile: { user: { id: 'u', email: 'test@example.invalid', display_name: 'Test' }, memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'super_admin' }] }, workspaceId: 'solarcell', selectWorkspace: () => {}, token: async () => 'token', login: async () => {}, logout: async () => {}, invalidate: () => { invalidations++; }, loading: false, error: '' };
  function Capture() { resource = useSettingsResource('settings'); return null; }
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); }); };
  try {
    setApiBase('http://localhost');
    setApiFetchHandler(async request => {
      if (mode === 'network') throw new Error('offline');
      if (mode === 'get500' || mode === 'patch500') return new Response('', { status: 500 });
      if (mode === '401' || mode === '403') return new Response('', { status: Number(mode) });
      return new Response(JSON.stringify({ workspace_id: 'solarcell', version: 1, contact_phone: 'original' }), { headers: { 'Content-Type': 'application/json', ETag: '"1"' } });
    });
    await act(async () => root.render(React.createElement(SessionContext.Provider, { value: session }, React.createElement(Capture)))); await settle();
    assert.match(resource.message, /Unable to load/); assert.doesNotMatch(resource.message, /save/i);
    mode = 'network'; await act(async () => { await resource.reload(); }); assert.match(resource.message, /Unable to load/);
    mode = 'ok'; await act(async () => { await resource.reload(); });
    await act(async () => resource.setField('contact_phone', 'draft'));
    mode = 'patch500'; await act(async () => { await resource.save(); });
    assert.match(resource.message, /save outcome/i); assert.equal(resource.draft.contact_phone, 'draft'); assert.equal(resource.reviewRequired, true);
    mode = 'get500'; await act(async () => { await resource.reload(); });
    assert.match(resource.message, /Unable to load/); assert.equal(resource.draft.contact_phone, 'draft');
    mode = '401'; await act(async () => { await resource.reload(); }); assert.equal(invalidations, 1); assert.equal(resource.draft.contact_phone, 'draft');
    mode = '403'; await act(async () => { await resource.reload(); }); assert.match(resource.message, /permission/); assert.deepEqual(resource.draft, {}); assert.equal(resource.row, undefined);
  } finally {
    await act(async () => root.unmount()); resetApiFetchHandler(); resetApiBase();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    dom.window.close();
  }
});
