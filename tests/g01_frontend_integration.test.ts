import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { SignInScreen } from '../src/components/SignInScreen.tsx';
import { SettingsFeedback } from '../src/components/SettingsFeedback.tsx';
import type { SettingsResource } from '../src/services/useSettingsResource.ts';
import { SystemWorkspaceSettingsView } from '../src/views/SystemWorkspaceSettingsView.tsx';
import { setApiFetchHandler, resetApiFetchHandler, setApiBase, resetApiBase } from '../src/services/g01Client.ts';
import { createLocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { getAuditEvents } from '../backend/modules/settings/settingsRepo.ts';
import worker from '../backend/index.ts';
import { fixtureToken, installFirebaseFixture } from './support/firebaseTokens.ts';

test('G01 mounted settings: independent API saves, retained drafts, conflict recovery and durable audit', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    await installFirebaseFixture();
    const db = createLocalD1Database(); await runLocalMigrations(db);
    const token = await fixtureToken('firebase_uid_super_admin');
    const env = { DB: db, FIREBASE_PROJECT_ID: 'cabms-test' };
    let failNext = false;
    let release: (() => void) | undefined;
    let delayNext = false;
    setApiBase('http://localhost');
    setApiFetchHandler(async request => {
      if (request.method === 'PATCH' && failNext) { failNext = false; throw new Error('Network unavailable'); }
      if (request.method === 'PATCH' && delayNext) { delayNext = false; await new Promise<void>(resolve => { release = resolve; }); }
      return worker.fetch(request, env);
    });
    let session!: Session;
    let role = 'super_admin';
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }
    function Harness() {
      const [workspaceId, selectWorkspace] = React.useState<'solarcell' | 'cctv' | 'smart_home'>('solarcell');
      session = { profile: { user: { id: 'usr_super_admin', email: 'admin@cabms.example.invalid', display_name: 'Admin' }, memberships: [
        { workspace_id: 'solarcell', name: 'Solarcell', role },
        { workspace_id: 'cctv', name: 'Gold Coast CCTV', role },
      ] }, workspaceId, selectWorkspace, token: async () => token, login: async () => {}, logout: async () => {}, invalidate: () => { throw new Error('Unexpected invalidation'); }, loading: false, error: '' };
      return React.createElement(SessionContext.Provider, { value: session }, React.createElement(CabmsProvider, null, React.createElement(Capture), React.createElement(SystemWorkspaceSettingsView)));
    }
    const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); }); };
    const input = (id: string, value: string) => {
      const node = container.querySelector<HTMLInputElement>(`#${id}`)!;
      const key = Object.keys(node).find(k => k.startsWith('__reactProps$'))!;
      (node as any)[key].onChange({ target: { value } });
    };
    const submit = async (id: string) => { await act(async () => { container.querySelector(`#${id}`)!.closest('form')!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); }); };
    await act(async () => root.render(React.createElement(Harness))); await settle();
    assert.equal(container.querySelector<HTMLInputElement>('#ws-trading-name')!.value, 'Solarcell');
    await act(async () => { input('ws-phone', 'First save'); });
    await submit('ws-phone'); await settle();
    assert.match(container.textContent!, /saved to the database/);
    assert.equal((await getAuditEvents(db, 'solarcell', 'workspace_settings')).length, 1);
    await act(async () => { input('legal-legal_issuer_name', 'Independent issuer'); });
    await submit('legal-legal_issuer_name'); await settle();
    assert.equal((await getAuditEvents(db, 'solarcell', 'legal_issuer')).length, 1);
    delayNext = true;
    await act(async () => { input('ws-phone', 'Submitted edit'); });
    await submit('ws-phone'); await settle();
    await act(async () => { input('ws-phone', 'Newer edit'); release!(); }); await settle();
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    assert.match(container.textContent!, /Newer edits remain unsaved/);
    await act(async () => session.selectWorkspace('cctv')); await settle();
    assert.notEqual(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    await act(async () => session.selectWorkspace('solarcell')); await settle();
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    await db.prepare("UPDATE workspace_settings SET version = version + 1 WHERE workspace_id = ?").bind('solarcell').run();
    await submit('ws-phone'); await settle();
    assert.match(container.textContent!, /Settings changed on the server/);
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('Review latest'))!.click()); await settle();
    failNext = true; await submit('ws-phone'); await settle();
    assert.match(container.textContent!, /Save outcome uncertain/);
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    const review = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.startsWith('Review latest'))!;
    await act(async () => review.click()); await settle();
    await submit('ws-phone'); await settle();
    assert.equal((await db.prepare('SELECT contact_phone FROM workspace_settings WHERE workspace_id = ?').bind('solarcell').first<{ contact_phone: string }>())?.contact_phone, 'Newer edit');
    role = 'technician';
    await act(async () => root.render(React.createElement(Harness))); await settle();
    assert.equal(context.persona, 'technician');
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.closest('fieldset')!.disabled, true);
    const snapshot = context.templates;
    await act(async () => context.createTemplateDraftRevision(snapshot[0].id, 'Must not be applied'));
    assert.equal(context.templates, snapshot);
    await act(async () => context.simulateSignIn('super_admin'));
    assert.equal(context.persona, 'technician');
    role = 'super_admin';
    await act(async () => root.unmount());
    const refreshed = createRoot(container);
    await act(async () => refreshed.render(React.createElement(Harness))); await settle();
    assert.equal(container.querySelector<HTMLInputElement>('#ws-phone')!.value, 'Newer edit');
    await act(async () => refreshed.unmount());
  } finally {
    resetApiFetchHandler(); resetApiBase(); mock.restoreAll();
    for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key]; }
    dom.window.close();
  }
});

test('G01 sign-in view exposes Google login and safe loading/error feedback, not demo personas', () => {
  // SSR checks the live UI boundary without claiming a provider/browser login.
  const session: Session = { profile: null, workspaceId: null, loading: false, error: 'Access verification failed', login: async () => {}, logout: async () => {}, token: async () => '', selectWorkspace: () => {}, invalidate: () => {} };
  const html = renderToString(React.createElement(SessionContext.Provider, { value: session }, React.createElement(CabmsProvider, null, React.createElement(SignInScreen))));
  assert.match(html, /Sign in with Google/);
  assert.match(html, /Access verification failed/);
  assert.doesNotMatch(html, /Sign In as/);
});

test('G01 conflict feedback allowlists edited fields and masks legal identifiers', () => {
  const resource = {
    row: { legal_issuer_name: 'Synthetic issuer', abn: 'PRIVATE-ABN', transition_nonce: 'INTERNAL-NONCE', id: 'INTERNAL-ID', review_url: 'PRIVATE-CONFIG' },
    draft: { legal_issuer_name: 'Edited issuer', abn: 'Edited ABN', transition_nonce: 'INJECTED-METADATA', review_url: 'INJECTED-CONFIG' },
    loading: false, saving: false, message: '', error: false, reviewRequired: true, reload: async () => {},
  } as unknown as SettingsResource;
  const html = renderToString(React.createElement(SettingsFeedback, { resource }));
  assert.match(html, /Synthetic issuer/);
  assert.match(html, /Value present \(masked\)/);
  for (const prohibited of ['PRIVATE-ABN', 'INTERNAL-NONCE', 'INTERNAL-ID', 'PRIVATE-CONFIG', 'transition_nonce', 'INJECTED-METADATA', 'review_url']) assert.ok(!html.includes(prohibited), prohibited);
});
