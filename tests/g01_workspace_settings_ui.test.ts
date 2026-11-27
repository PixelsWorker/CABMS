import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { WorkspaceSettingsView } from '../src/views/WorkspaceSettingsView.tsx';
import { setApiFetchHandler, resetApiFetchHandler, setApiBase, resetApiBase } from '../src/services/g01Client.ts';

test('UI-3: WorkspaceSettingsView renders read-only company accent and preserves accent_color on save', async () => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost' });
  const keys = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of keys) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  (dom.window.HTMLElement.prototype as any).attachEvent = () => {};
  (dom.window.HTMLElement.prototype as any).detachEvent = () => {};
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  let patchBody: Record<string, unknown> | null = null;
  const session: Session = {
    profile: { user: { id: 'u1', email: 'owner@example.invalid', display_name: 'Owner' }, memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' }] },
    workspaceId: 'solarcell',
    selectWorkspace: () => {},
    token: async () => 'token',
    login: async () => {},
    logout: async () => {},
    invalidate: () => {},
    loading: false,
    error: '',
  };
  const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 20)); }); };
  try {
    setApiBase('http://localhost');
    setApiFetchHandler(async request => {
      if (request.method === 'PATCH') {
        patchBody = JSON.parse(await request.text()) as Record<string, unknown>;
        return new Response(JSON.stringify({ workspace_id: 'solarcell', version: 2, accent_color: '#FFAE14', contact_email: patchBody.contact_email ?? 'ops@solarcell.example' }), { headers: { 'Content-Type': 'application/json', ETag: '"2"' } });
      }
      return new Response(JSON.stringify({ workspace_id: 'solarcell', version: 1, accent_color: '#FFAE14', contact_email: 'ops@solarcell.example', contact_phone: '0400000000' }), { headers: { 'Content-Type': 'application/json', ETag: '"1"' } });
    });
    await act(async () => {
      root.render(
        React.createElement(SessionContext.Provider, { value: session },
          React.createElement(CabmsProvider, null, React.createElement(WorkspaceSettingsView))
        )
      );
    });
    await settle();
    assert.equal(container.querySelector('#ws-accent'), null, 'Editable color picker #ws-accent must not be rendered');
    assert.equal(container.querySelector('input[type="color"]'), null, 'No color input should be rendered');
    assert.match(container.textContent || '', /Official company brand accent \(read-only\)/);
    const presetSelect = container.querySelector('#ws-preset') as HTMLSelectElement;
    assert.ok(presetSelect);
    await act(async () => {
      presetSelect.value = 'dark_company';
      presetSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    await settle();
    const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Save Workspace Settings'));
    assert.ok(saveBtn, 'Save Workspace Settings button must exist');
    assert.equal(saveBtn.disabled, false, 'Save button must be enabled when dirty');
    const formEl = saveBtn.closest('form');
    assert.ok(formEl, 'Save button must be inside a form');
    await act(async () => {
      formEl.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await settle();
    const sentPatch = patchBody as Record<string, unknown> | null;
    assert.ok(sentPatch, 'PATCH request must be sent');
    assert.equal(sentPatch.preferred_preset, 'dark_company');
    assert.equal(Object.prototype.hasOwnProperty.call(sentPatch, 'accent_color'), false, 'PATCH must not submit, clear, or modify accent_color');
  } finally {
    await act(async () => root.unmount());
    resetApiFetchHandler();
    resetApiBase();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    dom.window.close();
  }
});
