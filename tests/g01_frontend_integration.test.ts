import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { AppContent } from '../src/App.tsx';
import { SignInScreen } from '../src/components/SignInScreen.tsx';
import { SettingsFeedback } from '../src/components/SettingsFeedback.tsx';
import type { SettingsResource } from '../src/services/useSettingsResource.ts';
import { SystemWorkspaceSettingsView } from '../src/views/SystemWorkspaceSettingsView.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { setApiFetchHandler, resetApiFetchHandler, setApiBase, resetApiBase } from '../src/services/g01Client.ts';
import { createLocalD1Database } from '../backend/db/d1.ts';
import { runLocalMigrations } from '../backend/db/migrate.ts';
import { getAuditEvents } from '../backend/modules/settings/settingsRepo.ts';
import worker from '../backend/index.ts';
import { fixtureToken, installFirebaseFixture } from './support/firebaseTokens.ts';
import { INITIAL_JOBS } from '../src/data/seedData.ts';

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
    const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };
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
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('System & Integrations'))!.click());
    await settle();
    await act(async () => { input('legal-legal_issuer_name', 'Independent issuer'); });
    // Switch to Workspace Settings sub-tab and verify draft is retained upon returning
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Workspace Settings'))!.click());
    await settle();
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('System & Integrations'))!.click());
    await settle();
    assert.equal(container.querySelector<HTMLInputElement>('#legal-legal_issuer_name')!.value, 'Independent issuer');
    await submit('legal-legal_issuer_name'); await settle();
    assert.equal((await getAuditEvents(db, 'solarcell', 'legal_issuer')).length, 1);
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Workspace Settings'))!.click());
    await settle();
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

test('G01 mounted dashboard for CCTV-only member renders without crash and filters out unauthorized brands', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    let workspaceState: 'solarcell' | 'cctv' | 'smart_home' = 'cctv';
    const session: Session = {
      profile: {
        user: { id: 'usr_cctv_only', email: 'tech_cctv@example.invalid', display_name: 'CCTV Operator' },
        memberships: [
          { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' },
        ],
      },
      workspaceId: workspaceState,
      selectWorkspace: (id) => { workspaceState = id; },
      token: async () => 'dummy_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    await act(async () => {
      root.render(
        React.createElement(
          SessionContext.Provider,
          { value: session },
          React.createElement(
            CabmsProvider,
            null,
            React.createElement(Capture),
            React.createElement(AppContent)
          )
        )
      );
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // 1. Must not crash and active brand must be CCTV
    assert.equal(currentCtx.activeBrandId, 'cctv');
    assert.equal(currentCtx.activeBrand.name, 'Gold Coast CCTV');
    assert.deepEqual(Object.keys(currentCtx.brands), ['cctv']);

    // 2. Operational jobs heading must reflect Gold Coast CCTV
    assert.match(container.textContent!, /Gold Coast CCTV Operational Jobs/);
    assert.doesNotMatch(container.textContent!, /Solarcell Operational Jobs/);

    // 3. Cross-company consolidated queue must ONLY reference Gold Coast CCTV
    const crossCompanySubtitle = container.querySelector('[data-testid="consolidated-jobs-panel"] p');
    assert.ok(crossCompanySubtitle, 'Cross-company jobs panel should be rendered for owner_admin');
    assert.equal(crossCompanySubtitle.textContent?.trim(), 'Consolidated queue for Gold Coast CCTV');
    assert.doesNotMatch(crossCompanySubtitle.textContent!, /Solarcell/);
    assert.doesNotMatch(crossCompanySubtitle.textContent!, /Smart Home/);

    // 4. Queue should render CCTV job JOB-2026-104 and NOT Solarcell or Smart Home jobs
    const cctvJob = container.querySelector('[data-testid="consolidated-job-JOB-2026-104"]');
    assert.ok(cctvJob, 'CCTV job JOB-2026-104 must be rendered in consolidated queue');
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-101"]'), null);
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-102"]'), null);
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-103"]'), null);
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-105"]'), null);

    // 5. Context collections must be filtered to CCTV
    assert.ok(currentCtx.jobs.every(j => j.brandId === 'cctv'));
    assert.ok(currentCtx.customers.every(c => c.brandAffiliations.includes('cctv')));
    assert.ok(currentCtx.jobTypes.every(jt => jt.brandId === 'cctv'));
    assert.ok(currentCtx.websiteEnquiries.every(e => e.brandId === 'cctv'));
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-104');

    // 6. Navigation brand dropdown must only show Gold Coast CCTV
    const switcherBtn = container.querySelector<HTMLButtonElement>('.cabms-brand-mark-btn');
    assert.ok(switcherBtn);
    await act(async () => switcherBtn.click());
    const brandOptions = Array.from(container.querySelectorAll('.cabms-brand-dropdown-option'));
    assert.equal(brandOptions.length, 1);
    assert.match(brandOptions[0].textContent!, /Gold Coast CCTV/);
    assert.doesNotMatch(brandOptions[0].textContent!, /Solarcell/);

    // 7. Clicking consolidated job navigates to Jobs tab
    await act(async () => {
      (cctvJob as HTMLElement).click();
    });
    assert.equal(currentCtx.activeTab, 'jobs');
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-104');

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 mounted dashboard for Smart-Home-only member renders without crash and filters out unauthorized brands', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    let workspaceState: 'solarcell' | 'cctv' | 'smart_home' = 'smart_home';
    const session: Session = {
      profile: {
        user: { id: 'usr_shs_only', email: 'tech_shs@example.invalid', display_name: 'Smart Home Operator' },
        memberships: [
          { workspace_id: 'smart_home', name: 'Smart Home Solutions', role: 'owner_admin' },
        ],
      },
      workspaceId: workspaceState,
      selectWorkspace: (id) => { workspaceState = id; },
      token: async () => 'dummy_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    await act(async () => {
      root.render(
        React.createElement(
          SessionContext.Provider,
          { value: session },
          React.createElement(
            CabmsProvider,
            null,
            React.createElement(Capture),
            React.createElement(AppContent)
          )
        )
      );
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // 1. Must not crash and active brand must be Smart Home
    assert.equal(currentCtx.activeBrandId, 'smart_home');
    assert.equal(currentCtx.activeBrand.name, 'Smart Home Solutions');
    assert.deepEqual(Object.keys(currentCtx.brands), ['smart_home']);

    // 2. Operational jobs heading must reflect Smart Home Solutions
    assert.match(container.textContent!, /Smart Home Solutions Operational Jobs/);
    assert.doesNotMatch(container.textContent!, /Solarcell Operational Jobs/);

    // 3. Cross-company consolidated queue must ONLY reference Smart Home Solutions
    const crossCompanySubtitle = container.querySelector('[data-testid="consolidated-jobs-panel"] p');
    assert.ok(crossCompanySubtitle, 'Cross-company jobs panel should be rendered for owner_admin');
    assert.equal(crossCompanySubtitle.textContent?.trim(), 'Consolidated queue for Smart Home Solutions');
    assert.doesNotMatch(crossCompanySubtitle.textContent!, /Solarcell/);
    assert.doesNotMatch(crossCompanySubtitle.textContent!, /CCTV/);

    // 4. Queue should render Smart Home jobs (JOB-2026-102, JOB-2026-105) and NOT Solarcell or CCTV jobs
    assert.ok(container.querySelector('[data-testid="consolidated-job-JOB-2026-102"]'));
    assert.ok(container.querySelector('[data-testid="consolidated-job-JOB-2026-105"]'));
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-101"]'), null);
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-103"]'), null);
    assert.equal(container.querySelector('[data-testid="consolidated-job-JOB-2026-104"]'), null);

    // 5. Context collections must be filtered to smart_home
    assert.ok(currentCtx.jobs.every(j => j.brandId === 'smart_home'));
    assert.ok(currentCtx.customers.every(c => c.brandAffiliations.some(b => b === 'smart_home')));
    assert.ok(currentCtx.jobTypes.every(jt => jt.brandId === 'smart_home'));
    assert.ok(currentCtx.websiteEnquiries.every(e => e.brandId === 'smart_home'));
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-102');

    // 6. Navigation brand dropdown must only show Smart Home Solutions
    const switcherBtn = container.querySelector<HTMLButtonElement>('.cabms-brand-mark-btn');
    assert.ok(switcherBtn);
    await act(async () => switcherBtn.click());
    const brandOptions = Array.from(container.querySelectorAll('.cabms-brand-dropdown-option'));
    assert.equal(brandOptions.length, 1);
    assert.match(brandOptions[0].textContent!, /Smart Home Solutions/);
    assert.doesNotMatch(brandOptions[0].textContent!, /Solarcell/);

    // 7. Clicking consolidated job navigates to Jobs tab
    const shsJob = container.querySelector<HTMLElement>('[data-testid="consolidated-job-JOB-2026-102"]')!;
    await act(async () => {
      shsJob.click();
    });
    assert.equal(currentCtx.activeTab, 'jobs');
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-102');

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 multi-workspace selected job scopes to active workspace and cannot disguise out-of-scope work', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    let workspaceState: 'solarcell' | 'cctv' | 'smart_home' = 'cctv';
    let forceUpdate: (() => void) | undefined;

    function MultiWorkspaceHarness() {
      const [, setTick] = React.useState(0);
      forceUpdate = () => setTick(t => t + 1);
      const session: Session = {
        profile: {
          user: { id: 'usr_dual_operator', email: 'dual_op@example.invalid', display_name: 'Dual Operator' },
          memberships: [
            { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' },
            { workspace_id: 'smart_home', name: 'Smart Home Solutions', role: 'owner_admin' },
          ],
        },
        workspaceId: workspaceState,
        selectWorkspace: (id) => {
          workspaceState = id;
          forceUpdate?.();
        },
        token: async () => 'dummy_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };

      return React.createElement(
        SessionContext.Provider,
        { value: session },
        React.createElement(
          CabmsProvider,
          null,
          React.createElement(Capture),
          React.createElement(ComplianceFormsView)
        )
      );
    }

    await act(async () => {
      root.render(React.createElement(MultiWorkspaceHarness));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // 1. Initial workspace is CCTV
    assert.equal(currentCtx.activeBrandId, 'cctv');
    assert.deepEqual(Object.keys(currentCtx.brands).sort(), ['cctv', 'smart_home']);
    // Selected job MUST be scoped to CCTV (JOB-2026-104), never leaking or falling back to Solarcell (101) or Smart Home (102)
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-104');
    assert.match(container.textContent!, /Gold Coast CCTV/);
    assert.doesNotMatch(container.textContent!, /Solarcell/);

    // 2. Switch workspace to Smart Home
    await act(async () => {
      workspaceState = 'smart_home';
      forceUpdate?.();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    assert.equal(currentCtx.activeBrandId, 'smart_home');
    // Selected job MUST now automatically switch to a Smart Home job (JOB-2026-102), NOT remaining on CCTV (104)
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-102');
    assert.match(container.textContent!, /Gold Coast Smart Home Systems/);

    // 3. Attempting to sign off a Solarcell job (unauthorized workspace) must fail-closed and never disguise the brand
    await act(async () => {
      currentCtx.signOffJsa('JOB-2026-101');
    });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    // 4. Switch back to CCTV
    await act(async () => {
      workspaceState = 'cctv';
      forceUpdate?.();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    assert.equal(currentCtx.activeBrandId, 'cctv');
    assert.equal(currentCtx.selectedJobId, 'JOB-2026-104');

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 session without verified profile strictly fails closed with no authorized brands, jobs or fallbacks', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    // Session exists but profile has not loaded or is null
    const session: Session = {
      profile: null,
      workspaceId: 'solarcell',
      selectWorkspace: () => {},
      token: async () => 'dummy_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: true,
      error: '',
    };

    await act(async () => {
      root.render(
        React.createElement(
          SessionContext.Provider,
          { value: session },
          React.createElement(
            CabmsProvider,
            null,
            React.createElement(Capture)
          )
        )
      );
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // Must fail-closed: NO authorized brands, never defaulting or falling back to Solarcell
    assert.deepEqual(Object.keys(currentCtx.brands), []);
    assert.equal(currentCtx.activeBrand.name, 'No Authorized Workspace');
    assert.doesNotMatch(currentCtx.activeBrand.name, /Solarcell/);
    assert.equal(currentCtx.jobs.length, 0);
    assert.equal(currentCtx.customers.length, 0);
    assert.equal(currentCtx.jobTypes.length, 0);
    assert.equal(currentCtx.websiteEnquiries.length, 0);
    assert.equal(currentCtx.selectedJobId, null);

    // Authoritative state must be completely empty across all 8 fields
    const authState = currentCtx.getAuthoritativeState();
    assert.equal(authState.jobs.length, 0);
    assert.deepEqual(authState.tca2AuditRecords, {});
    assert.deepEqual(authState.draftBusinesses, []);
    assert.deepEqual(authState.jsaForms, {});
    assert.deepEqual(authState.electricalCerts, {});
    assert.deepEqual(authState.smokeAlarmCerts, {});
    assert.deepEqual(authState.tca1Certs, {});
    assert.deepEqual(authState.tca2Certs, {});

    // All five sign-off paths must fail-closed immediately without exposing form data
    await act(async () => { currentCtx.signOffJsa('JOB-2026-101'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffSmokeAlarm('JOB-2026-102'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffElectrical('JOB-2026-101'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca1('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca2('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    // Review dispatch must fail closed
    const triggerRes = currentCtx.triggerReviewRequest('JOB-2026-101');
    assert.equal(triggerRes.success, false);
    assert.equal(currentCtx.pendingReviewCount, 0);

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 session with empty memberships strictly fails closed across all five sign-offs and review dispatch', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    // User profile loaded successfully, but user has ZERO memberships
    const session: Session = {
      profile: {
        user: { id: 'usr_unassigned', email: 'unassigned@example.invalid', display_name: 'Unassigned User' },
        memberships: [],
      },
      workspaceId: 'solarcell',
      selectWorkspace: () => {},
      token: async () => 'dummy_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    await act(async () => {
      root.render(
        React.createElement(
          SessionContext.Provider,
          { value: session },
          React.createElement(
            CabmsProvider,
            null,
            React.createElement(Capture)
          )
        )
      );
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    assert.deepEqual(Object.keys(currentCtx.brands), []);
    assert.equal(currentCtx.activeBrand.name, 'No Authorized Workspace');
    assert.equal(currentCtx.jobs.length, 0);
    assert.equal(currentCtx.selectedJobId, null);
    assert.equal(currentCtx.pendingReviewCount, 0);

    // All five sign-offs must fail-closed
    await act(async () => { currentCtx.signOffJsa('JOB-2026-101'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffSmokeAlarm('JOB-2026-102'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffElectrical('JOB-2026-101'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca1('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca2('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    // Review dispatch operations fail closed
    assert.equal(currentCtx.triggerReviewRequest('JOB-2026-101').success, false);
    assert.equal(currentCtx.resolvePendingReview('JOB-2026-101').success, false);

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 membership removal dynamically revokes access and all 5 sign-offs fail closed', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() { currentCtx = useCabms(); return null; }
    let membershipsList = [
      { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' },
      { workspace_id: 'smart_home', name: 'Smart Home Solutions', role: 'owner_admin' },
    ];
    let forceUpdate: (() => void) | undefined;

    function DynamicMembershipHarness() {
      const [, setTick] = React.useState(0);
      forceUpdate = () => setTick(t => t + 1);
      const session: Session = {
        profile: {
          user: { id: 'usr_dyn_op', email: 'dyn_op@example.invalid', display_name: 'Dynamic Operator' },
          memberships: membershipsList,
        },
        workspaceId: 'cctv',
        selectWorkspace: () => {},
        token: async () => 'dummy_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };

      return React.createElement(
        SessionContext.Provider,
        { value: session },
        React.createElement(
          CabmsProvider,
          null,
          React.createElement(Capture)
        )
      );
    }

    await act(async () => {
      root.render(React.createElement(DynamicMembershipHarness));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // Step 1: Initial state has CCTV and Smart Home
    assert.deepEqual(Object.keys(currentCtx.brands).sort(), ['cctv', 'smart_home']);
    assert.ok(currentCtx.jobs.some(j => j.brandId === 'smart_home'));

    // Step 2: Revoke Smart Home membership
    await act(async () => {
      membershipsList = [{ workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' }];
      forceUpdate?.();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    assert.deepEqual(Object.keys(currentCtx.brands), ['cctv']);
    assert.ok(!currentCtx.jobs.some(j => j.brandId === 'smart_home'));
    // Attempting to sign off a Smart Home certificate must now fail closed
    await act(async () => { currentCtx.signOffSmokeAlarm('JOB-2026-102'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    // Step 3: Revoke all memberships
    await act(async () => {
      membershipsList = [];
      forceUpdate?.();
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    assert.deepEqual(Object.keys(currentCtx.brands), []);
    assert.equal(currentCtx.activeBrand.name, 'No Authorized Workspace');
    assert.equal(currentCtx.jobs.length, 0);

    // Attempting any of the 5 sign-offs must fail closed
    await act(async () => { currentCtx.signOffJsa('JOB-2026-101'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca1('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { currentCtx.signOffTca2('JOB-2026-104'); });
    assert.match(currentCtx.demoNotification?.message || '', /does not belong to an authorized workspace/);
    await act(async () => { currentCtx.clearDemoNotification(); });

    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 mounted clock isolation: advanceClock never mutates unauthorized workspace jobs', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let currentCtx!: ReturnType<typeof useCabms>;
    function Capture() {
      currentCtx = useCabms();
      return null;
    }

    let setSessionMemberships!: (memberships: { workspace_id: string; name: string; role: string }[]) => void;
    function Harness() {
      const [memberships, setMemberships] = React.useState([
        { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'technician' },
      ]);
      setSessionMemberships = setMemberships;
      const session: Session = {
        profile: {
          user: { id: 'usr_cctv_only', email: 'cctv@example.invalid', display_name: 'CCTV Tech' },
          memberships,
        },
        workspaceId: 'cctv',
        selectWorkspace: () => {},
        token: async () => 'dummy_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      return React.createElement(
        SessionContext.Provider,
        { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => {
      root.render(React.createElement(Harness));
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // Inspect initial state: only CCTV jobs visible to currentCtx.jobs
    assert.deepEqual(Object.keys(currentCtx.brands), ['cctv']);
    assert.ok(currentCtx.jobs.every(j => j.brandId === 'cctv'));

    // Advance business clock by 72 hours while authorized only for CCTV
    await act(async () => {
      currentCtx.advanceClock(72);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // Ensure non-CCTV jobs in authoritative state remained completely untouched and unexposed
    const authState = currentCtx.getAuthoritativeState();
    const solarcellJobs = authState.jobs.filter(j => j.brandId === 'solarcell');
    assert.equal(solarcellJobs.length, 0, 'Unauthorized jobs are never exposed in authoritative state');

    // Re-render the same provider with Solarcell membership added to directly verify
    // that Solarcell jobs in the underlying state were NOT mutated by advanceClock(72)
    await act(async () => {
      setSessionMemberships([
        { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'technician' },
        { workspace_id: 'solarcell', name: 'Solarcell', role: 'technician' },
      ]);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    const postAdvanceSolarcellJobs = currentCtx.jobs.filter(j => j.brandId === 'solarcell');
    assert.ok(postAdvanceSolarcellJobs.length > 0, 'Solarcell jobs visible after membership added');
    for (const job of postAdvanceSolarcellJobs) {
      const initial = INITIAL_JOBS.find(ij => ij.id === job.id)!;
      assert.deepEqual(job.reminders, initial.reminders, `Solarcell job ${job.id} reminders remained untouched`);
      assert.equal(job.reviewRequest?.status, initial.reviewRequest?.status, `Solarcell job ${job.id} review status remained untouched`);
    }

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 CabmsContext: customer directory is scoped to active workspace permissions, excluding technician-only affiliations', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }

    // User is Office Staff in Solarcell, but Technician in CCTV
    let switchWorkspace!: (ws: 'solarcell' | 'cctv') => void;

    function Harness() {
      const [workspaceId, setWorkspaceId] = React.useState<'solarcell' | 'cctv'>('solarcell');
      switchWorkspace = setWorkspaceId;
      const session: Session = {
        profile: {
          user: { id: 'usr_dual_role', email: 'dual@example.invalid', display_name: 'Dual User' },
          memberships: [
            { workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' },
            { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'technician' },
          ],
        },
        workspaceId,
        selectWorkspace: setWorkspaceId as any,
        token: async () => 'test_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      return React.createElement(SessionContext.Provider, { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    // In Solarcell workspace: active persona is office_staff
    assert.equal(context.persona, 'office_staff');
    assert.ok(context.customers.length > 0, 'Customers visible for office_staff in Solarcell');
    // Customers affiliated ONLY with CCTV must NOT be exposed
    const cctvOnlyCustomers = context.customers.filter(c =>
      c.brandAffiliations.length === 1 && c.brandAffiliations[0] === 'cctv'
    );
    assert.equal(cctvOnlyCustomers.length, 0, 'CCTV-only customers excluded when user is technician in CCTV');

    // Switch active workspace to CCTV: active persona becomes technician
    await act(async () => { switchWorkspace('cctv'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    assert.equal(context.persona, 'technician');
    // Technician persona in active workspace has NO customer directory access
    assert.equal(context.customers.length, 0, 'Customer directory is empty for technician persona');

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 mounted settings: request generation guard rejects obsolete responses on A -> B -> A workspace switching', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let selectWorkspaceFn!: (ws: 'solarcell' | 'cctv') => void;
    let resolveFirstLoad!: (resp: any) => void;
    let loadCount = 0;

    setApiBase('http://localhost');
    setApiFetchHandler(async request => {
      const url = request.url;
      if (url.includes('/settings') && request.method === 'GET') {
        loadCount++;
        if (url.includes('solarcell') && loadCount === 1) {
          // Delay the very first load for solarcell
          return new Promise(resolve => {
            resolveFirstLoad = resolve;
          });
        }
        if (url.includes('cctv')) {
          return new Response(JSON.stringify({ workspace_id: 'cctv', version: 1, trading_name: 'CCTV Fast' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: '"1"' },
          });
        }
        if (url.includes('solarcell') && loadCount > 1) {
          return new Response(JSON.stringify({ workspace_id: 'solarcell', version: 2, trading_name: 'Solarcell New' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ETag: '"2"' },
          });
        }
      }
      return new Response('Not Found', { status: 404 });
    });

    function Harness() {
      const [workspaceId, selectWorkspace] = React.useState<'solarcell' | 'cctv'>('solarcell');
      selectWorkspaceFn = selectWorkspace;
      const session: Session = {
        profile: {
          user: { id: 'usr_switch', email: 'switch@example.invalid', display_name: 'Switch User' },
          memberships: [
            { workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' },
            { workspace_id: 'cctv', name: 'CCTV', role: 'owner_admin' },
          ],
        },
        workspaceId,
        selectWorkspace: selectWorkspace as any,
        token: async () => 'test_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      return React.createElement(SessionContext.Provider, { value: session }, React.createElement(CabmsProvider, null, React.createElement(SystemWorkspaceSettingsView)));
    }

    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    // Load 1 for solarcell is pending. Now switch to CCTV (B)
    await act(async () => { selectWorkspaceFn('cctv'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    assert.equal(container.querySelector<HTMLInputElement>('#ws-trading-name')?.value, 'CCTV Fast');

    // Switch back to solarcell (A), triggering Load 3
    await act(async () => { selectWorkspaceFn('solarcell'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    // Load 3 for solarcell returns 'Solarcell New'
    assert.equal(container.querySelector<HTMLInputElement>('#ws-trading-name')?.value, 'Solarcell New');

    // Now obsolete Load 1 finishes!
    resolveFirstLoad(new Response(JSON.stringify({ workspace_id: 'solarcell', version: 1, trading_name: 'Solarcell Stale' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ETag: '"1"' },
    }));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });

    // Obsolete Load 1 MUST NOT overwrite newer state!
    assert.equal(container.querySelector<HTMLInputElement>('#ws-trading-name')?.value, 'Solarcell New');

    await act(async () => root.unmount());
  } finally {
    resetApiFetchHandler();
    resetApiBase();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 CabmsContext: isJobAuthorized rejects mutating financial actions on foreign workspace work orders', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }
    // User is ONLY member of CCTV workspace
    const session: Session = {
      profile: {
        user: { id: 'usr_cctv_only', email: 'cctv@example.invalid', display_name: 'CCTV Tech' },
        memberships: [{ workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'owner_admin' }],
      },
      workspaceId: 'cctv',
      selectWorkspace: () => {},
      token: async () => 'test_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    function Harness() {
      return React.createElement(SessionContext.Provider, { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => { root.render(React.createElement(Harness)); });

    // JOB-2026-101 is a seeded Solarcell job (foreign to this CCTV-only session).
    // 1. prepareQuoteForJob throws error
    assert.throws(
      () => context.prepareQuoteForJob('JOB-2026-101', 'Test Quote', []),
      /Work order does not belong to an authorized workspace/
    );

    // 2. simulateQuoteAcceptance returns failure
    const simRes = context.simulateQuoteAcceptance('JOB-2026-101', 'valid');
    assert.equal(simRes.success, false);
    assert.match(simRes.message, /authorized workspace/);

    // 3. revokeQuote returns failure
    const revokeRes = context.revokeQuote('JOB-2026-101');
    assert.equal(revokeRes.success, false);
    assert.match(revokeRes.message, /authorized workspace/);

    // 4. prepareInvoiceForJob rejects without mutating authoritative state
    const initialJobs = context.getAuthoritativeState().jobs;
    context.prepareInvoiceForJob('JOB-2026-101', 500);
    assert.deepEqual(context.getAuthoritativeState().jobs, initialJobs);

    // 5. reconcileInvoiceSync rejects without mutating authoritative state
    context.reconcileInvoiceSync('JOB-2026-101', 'SUCCESS');
    assert.deepEqual(context.getAuthoritativeState().jobs, initialJobs);

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 CabmsContext: customer directory is scoped to active workspace permissions, excluding technician-only affiliations', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }

    // User is Office Staff in Solarcell, but Technician in CCTV
    let switchWorkspace!: (ws: 'solarcell' | 'cctv') => void;

    function Harness() {
      const [workspaceId, setWorkspaceId] = React.useState<'solarcell' | 'cctv'>('solarcell');
      switchWorkspace = setWorkspaceId;
      const session: Session = {
        profile: {
          user: { id: 'usr_dual_role', email: 'dual@example.invalid', display_name: 'Dual User' },
          memberships: [
            { workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' },
            { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'technician' },
          ],
        },
        workspaceId,
        selectWorkspace: setWorkspaceId as any,
        token: async () => 'test_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      return React.createElement(SessionContext.Provider, { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    // In Solarcell workspace: active persona is office_staff
    assert.equal(context.persona, 'office_staff');
    assert.ok(context.customers.length > 0, 'Customers visible for office_staff in Solarcell');
    // Customers affiliated ONLY with CCTV must NOT be exposed
    const cctvOnlyCustomers = context.customers.filter(c =>
      c.brandAffiliations.length === 1 && c.brandAffiliations[0] === 'cctv'
    );
    assert.equal(cctvOnlyCustomers.length, 0, 'CCTV-only customers excluded when user is technician in CCTV');

    // Switch active workspace to CCTV: active persona becomes technician
    await act(async () => { switchWorkspace('cctv'); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    assert.equal(context.persona, 'technician');
    // Technician persona in active workspace has NO customer directory access
    assert.equal(context.customers.length, 0, 'Customer directory is empty for technician persona');

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});


test('G01 CabmsContext: financial writes enforce job-owning workspace roles rather than active persona', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }

    // User is Owner Admin in Solarcell, but Technician in CCTV
    const session: Session = {
      profile: {
        user: { id: 'usr_owner_solar_tech_cctv', email: 'split@example.invalid', display_name: 'Split Role' },
        memberships: [
          { workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' },
          { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'technician' },
        ],
      },
      workspaceId: 'solarcell',
      selectWorkspace: () => {},
      token: async () => 'test_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    function Harness() {
      return React.createElement(SessionContext.Provider, { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    // 1. Verify roles in respective workspaces
    assert.equal(context.persona, 'owner_admin');
    assert.equal(context.getRoleForWorkspace('solarcell'), 'owner_admin');
    assert.equal(context.getRoleForWorkspace('cctv'), 'technician');
    assert.equal(context.getRoleForWorkspace('smart_home'), null);

    // 2. Negative test: Attempt financial writes on CCTV job JOB-2026-104
    // Even though active persona is owner_admin, CCTV role is technician (financial_writes denied)
    const initialJobs = context.getAuthoritativeState().jobs;
    const initialCctvJob = initialJobs.find(j => j.id === 'JOB-2026-104');
    assert.ok(initialCctvJob, 'JOB-2026-104 exists in authoritative jobs');

    // a) prepareQuoteForJob on CCTV job throws denial error
    assert.throws(
      () => context.prepareQuoteForJob('JOB-2026-104', 'CCTV Security Quote', [
        { id: 'item-1', description: 'Camera', quantity: 2, unitPrice: 200, total: 400 },
      ]),
      /Technician role cannot access technical settings, master templates, financial writes/
    );

    // b) revokeQuote on CCTV job returns denial result
    const cctvRevokeRes = context.revokeQuote('JOB-2026-104');
    assert.equal(cctvRevokeRes.success, false);
    assert.match(cctvRevokeRes.message, /Technician role cannot access/);

    // c) prepareInvoiceForJob on CCTV job rejects without mutating state
    context.prepareInvoiceForJob('JOB-2026-104', 1200);
    const jobsAfterInvoiceAttempt = context.getAuthoritativeState().jobs;
    const cctvJobAfterInvoice = jobsAfterInvoiceAttempt.find(j => j.id === 'JOB-2026-104')!;
    assert.deepEqual(cctvJobAfterInvoice.invoice, initialCctvJob.invoice, 'Invoice was not overwritten on unauthorized CCTV job');

    // d) reconcileInvoiceSync on CCTV job rejects without mutating state
    context.reconcileInvoiceSync('JOB-2026-104', 'SUCCESS');
    const jobsAfterReconcileAttempt = context.getAuthoritativeState().jobs;
    const cctvJobAfterReconcile = jobsAfterReconcileAttempt.find(j => j.id === 'JOB-2026-104')!;
    assert.deepEqual(cctvJobAfterReconcile.invoice, initialCctvJob.invoice, 'Invoice sync state remained unchanged');
    assert.deepEqual(context.getAuthoritativeState().jobs, initialJobs, 'Authoritative jobs remained completely unmutated');

    // e) customerAckTca2 on CCTV job with Solarcell active:
    // User is owner_admin in Solarcell, but technician in CCTV. Field technician cannot self-acknowledge defect notice.
    const initialTca2Audit = context.getAuthoritativeState().tca2AuditRecords['JOB-2026-104'];
    assert.equal(initialTca2Audit?.customerAcknowledged, false);
    context.customerAckTca2('JOB-2026-104');
    const auditAfterAckAttempt = context.getAuthoritativeState().tca2AuditRecords['JOB-2026-104'];
    assert.equal(auditAfterAckAttempt?.customerAcknowledged, false, 'Technician role in CCTV blocks customerAckTca2 even with owner_admin active in Solarcell');

    // f) Operational updateJobStatus on CCTV job records the user's role in CCTV (technician), not active Solarcell role (owner_admin)
    context.updateJobStatus('JOB-2026-104', 'IN_PROGRESS');
    const cctvJobAfterStatus = context.getAuthoritativeState().jobs.find(j => j.id === 'JOB-2026-104')!;
    assert.equal(cctvJobAfterStatus.status, 'IN_PROGRESS');
    const latestEvent = cctvJobAfterStatus.activityHistory[cctvJobAfterStatus.activityHistory.length - 1];
    assert.equal(latestEvent.actor, 'technician', 'Activity history records role in job owning workspace (technician), not active workspace (owner_admin)');

    // g) Nonmember check: Attempt financial write on Smart Home job JOB-2026-102 (user is non-member)
    assert.throws(
      () => context.prepareQuoteForJob('JOB-2026-102', 'Smart Home Quote', [
        { id: 'item-sh', description: 'Automation Hub', quantity: 1, unitPrice: 500, total: 500 },
      ]),
      /Work order does not belong to an authorized workspace/
    );

    // 3. Positive test: Attempt financial writes on Solarcell job JOB-2026-101
    // Solarcell role is owner_admin (financial_writes allowed)
    let newQuote!: any;
    await act(async () => {
      newQuote = context.prepareQuoteForJob('JOB-2026-101', 'Solar Maintenance Quote', [
        { id: 'item-solar', description: 'Inverter check', quantity: 1, unitPrice: 300, total: 300 },
      ]);
    });
    assert.ok(newQuote, 'Quote prepared successfully on authorized Solarcell job');
    assert.equal(newQuote.acceptanceStatus, 'SENT');
    assert.equal(newQuote.brandId, 'solarcell');
    assert.equal(newQuote.acceptanceHistory[0].actor, 'owner_admin');

    // e) revokeQuote on Solarcell job succeeds with owner_admin role
    let revokeRes!: any;
    await act(async () => {
      revokeRes = context.revokeQuote('JOB-2026-101', 'Pricing update');
    });
    assert.equal(revokeRes.success, true);
    assert.match(revokeRes.message, /successfully revoked/);

    // 4. Positive test: Customer online portal acceptance semantics preserved
    // Customer acceptance represents the end customer action (actor: siteContact), not an administrative mutation
    await act(async () => {
      context.prepareQuoteForJob('JOB-2026-101', 'Solar Quote 2', [
        { id: 'item-2', description: 'Solar Panels', quantity: 4, unitPrice: 250, total: 1000 },
      ]);
    });
    const acceptRes = context.simulateQuoteAcceptance('JOB-2026-101', 'valid');
    assert.equal(acceptRes.success, true);
    const solarJobAfterAccept = context.getAuthoritativeState().jobs.find(j => j.id === 'JOB-2026-101')!;
    assert.equal(solarJobAfterAccept.quote?.acceptanceStatus, 'ACCEPTED');
    assert.equal(solarJobAfterAccept.quote?.acceptedByName, solarJobAfterAccept.siteContact);

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});

test('G01 CabmsContext: missing session profile denies all workspace-scoped operations', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  for (const k of globals) {
    Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k] });
  }
  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);
  try {
    let context!: ReturnType<typeof useCabms>;
    function Capture() { context = useCabms(); return null; }

    // Session has no profile (loading, unauthenticated or un-enrolled state)
    const session: Session = {
      profile: null,
      workspaceId: 'solarcell',
      selectWorkspace: () => {},
      token: async () => 'test_token',
      login: async () => {},
      logout: async () => {},
      invalidate: () => {},
      loading: false,
      error: '',
    };

    function Harness() {
      return React.createElement(SessionContext.Provider, { value: session },
        React.createElement(CabmsProvider, null, React.createElement(Capture))
      );
    }

    await act(async () => { root.render(React.createElement(Harness)); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    assert.equal(context.getRoleForWorkspace('solarcell'), null);
    assert.equal(context.getRoleForWorkspace('cctv'), null);

    // Attempt prepareQuoteForJob with missing profile throws
    assert.throws(
      () => context.prepareQuoteForJob('JOB-2026-101', 'Test Quote', []),
      /Work order does not belong to an authorized workspace/
    );

    await act(async () => root.unmount());
  } finally {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as any)[key];
    }
    dom.window.close();
  }
});
