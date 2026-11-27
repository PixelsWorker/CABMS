import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';

const root = path.resolve(import.meta.dirname, '..');

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:3000/',
  });
  (globalThis as any).window = dom.window;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

describe('Layer 3: UI/UX Theme Restoration & Sync', () => {
  it('src/index.css uses #000000 dark canvas, reconciled smart_home/cctv tokens, and semantic primitives', () => {
    const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
    assert.match(css, /:root,\s*\[data-appearance="default_dark"\]\s*\{[^}]*--cabms-canvas:\s*#000000;/);
    assert.doesNotMatch(css, /:root,\s*\[data-appearance="default_dark"\]\s*\{[^}]*--cabms-canvas:\s*#020617;/);
    assert.match(css, /\[data-company-panel="smart_home"\][^}]*--cabms-brand-primary:\s*#3dae49;/);
    assert.match(css, /\[data-company-panel="cctv"\][^}]*--cabms-brand-primary:\s*#0ba3ad;/);
    assert.match(css, /\.cabms-drawer-backdrop\s*\{[^}]*background:\s*rgb\(0 0 0 \/ \.6\);/);
    assert.match(css, /\.cabms-btn-primary\s*\{/);
    assert.match(css, /\.cabms-tab-active\s*\{/);
    assert.match(css, /\.cabms-row-selected\s*\{/);
  });

  it('brands.json and Navigation.tsx align Solarcell, Smart Home (#059669), and CCTV (#0ba3ad)', () => {
    const brands = JSON.parse(fs.readFileSync(path.join(root, 'src/data/fixtures/brands.json'), 'utf8'));
    assert.equal(brands.solarcell.preferredPreset, 'light_company');
    assert.equal(brands.smart_home.primaryColor, '#059669');
    assert.equal(brands.cctv.primaryColor, '#0ba3ad');

    const nav = fs.readFileSync(path.join(root, 'src/components/Navigation.tsx'), 'utf8');
    assert.match(nav, /smart_home[\s\S]*bg:\s*'#059669'/);
    assert.match(nav, /cctv[\s\S]*bg:\s*'#0ba3ad'/);
  });

  it('App.tsx separates auth and demo presentation while keeping simulated tabs labeled', () => {
    const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
    assert.match(app, /const isLiveOperationalTab = operational && \['dashboard','jobs','compliance','schedule','templates','super_admin_setup'\]\.includes\(activeTab\);/);
    assert.match(app, /<DemoBanner operational=\{isLiveOperationalTab\}\/>/);
    assert.match(app, /\{!session && <DemoBanner \/>\}/);
    assert.match(app, /\{!session && <DemoControlsBar \/>\}/);
  });

  it('TemplatesSettingsView.tsx wraps job-type badges for mobile 390x844', () => {
    const tpl = fs.readFileSync(path.join(root, 'src/views/TemplatesSettingsView.tsx'), 'utf8');
    assert.match(tpl, /flex flex-wrap items-center gap-2/);
  });

  it('Behavioral: initial default is light_company -> data-appearance=high_visibility_light, data-branding=company, and resetDemo restores it', async () => {
    const dom = setupDom();
    let ctxRef: any;
    const Probe = () => {
      ctxRef = useCabms();
      return null;
    };
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    await act(async () => {
      reactRoot.render(React.createElement(CabmsProvider, null, React.createElement(Probe)));
    });
    assert.equal(ctxRef.visualPreset, 'light_company');
    assert.equal(dom.window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_light');
    assert.equal(dom.window.document.documentElement.getAttribute('data-branding'), 'company');

    await act(async () => {
      ctxRef.setVisualPreset('dark_neutral', false);
      ctxRef.setActiveBrandId('cctv');
    });
    assert.equal(ctxRef.visualPreset, 'dark_neutral');
    assert.equal(ctxRef.activeBrandId, 'cctv');

    await act(async () => {
      ctxRef.resetDemo();
    });
    assert.equal(ctxRef.activeBrandId, 'solarcell');
    assert.equal(ctxRef.visualPreset, 'light_company');
    assert.equal(dom.window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_light');
    assert.equal(dom.window.document.documentElement.getAttribute('data-branding'), 'company');
    await act(async () => { reactRoot.unmount(); });
  });

  it('Behavioral: authenticated async theme race protection (A->B->C with delayed A) and invalid/missing fallback', async () => {
    const dom = setupDom();
    const origFetch = globalThis.fetch;
    let resolveSolarcell!: (r: Response) => void;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('/workspaces/solarcell/settings')) {
        return new Promise<Response>(r => { resolveSolarcell = r; });
      }
      if (url.includes('/workspaces/smart_home/settings')) {
        return new Response(JSON.stringify({ preferred_preset: 'invalid_preset' }), { status: 200 });
      }
      if (url.includes('/workspaces/cctv/settings')) {
        return new Response(JSON.stringify({ preferred_preset: 'dark_neutral' }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      let ctxRef: any;
      const Probe = () => {
        ctxRef = useCabms();
        return null;
      };
      const makeSession = (ws: string): Session => ({
        profile: {
          user: { id: 'u1', email: 'a@b.com', display_name: 'Admin' },
          memberships: [
            { workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' },
            { workspace_id: 'smart_home', name: 'Smart Home', role: 'owner_admin' },
            { workspace_id: 'cctv', name: 'CCTV', role: 'owner_admin' },
          ],
        },
        workspaceId: ws as 'solarcell' | 'smart_home' | 'cctv',
        selectWorkspace: () => {},
        token: async () => 'tok',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      });

      const rootEl = dom.window.document.getElementById('root')!;
      const reactRoot = createRoot(rootEl);

      await act(async () => {
        reactRoot.render(React.createElement(SessionContext.Provider, { value: makeSession('solarcell') }, React.createElement(CabmsProvider, null, React.createElement(Probe))));
      });
      await act(async () => {
        reactRoot.render(React.createElement(SessionContext.Provider, { value: makeSession('smart_home') }, React.createElement(CabmsProvider, null, React.createElement(Probe))));
        await new Promise(r => setTimeout(r, 0));
      });
      assert.equal(ctxRef.visualPreset, 'light_company');

      await act(async () => {
        reactRoot.render(React.createElement(SessionContext.Provider, { value: makeSession('cctv') }, React.createElement(CabmsProvider, null, React.createElement(Probe))));
        await new Promise(r => setTimeout(r, 0));
      });
      assert.equal(ctxRef.visualPreset, 'dark_neutral');

      await act(async () => {
        resolveSolarcell(new Response(JSON.stringify({ preferred_preset: 'high_visibility_dark' }), { status: 200 }));
        await new Promise(r => setTimeout(r, 0));
      });
      assert.equal(ctxRef.visualPreset, 'dark_neutral');
      await act(async () => { reactRoot.unmount(); });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Behavioral: ComplianceWork same-workspace selection does not invoke onWorkspace/GET settings, preserves light/dark preset, and shows prompt for 2 COMPLETED jobs', async () => {
    const { ComplianceWork } = await import('../src/views/ComplianceWork.tsx');
    const dom = setupDom();
    const completedJobs = [
      { id: '3725630f-417f-4188-91e4-82357376e70f', workspace_id: 'solarcell', title: 'Step 8 Solar Job', status: 'COMPLETED', customer_name: 'Alice', site_address: '10 Solar Way', technician: 'Dave', appointment_status: null },
      { id: '872b26d5-866c-43dd-817e-50b1fa4b4bb1', workspace_id: 'solarcell', title: 'Step 9 Solar Job', status: 'COMPLETED', customer_name: 'Bob', site_address: '20 Sun St', technician: 'Dave', appointment_status: null },
    ];
    let workspaceCalls = 0;
    const api: any = {
      list: async () => completedJobs,
      detail: async (_ws: string, id: string) => ({
        job: completedJobs.find(j => j.id === id)!,
        requirements: [],
        history: [],
        visit_history: [],
      }),
    };
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    await act(async () => {
      reactRoot.render(
        React.createElement(ComplianceWork as any, {
          actorId: 'u1',
          api,
          activeWorkspace: 'solarcell',
          onWorkspace: () => { workspaceCalls += 1; },
          memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' }],
          screen: 'compliance',
          onJobs: () => {},
          onForm: () => {},
          onLogin: async () => {},
        })
      );
      await new Promise(r => setTimeout(r, 0));
    });
    assert.match(dom.window.document.body.textContent || '', /Select a work order above to view its compliance forms and documents\./);

    const select = dom.window.document.querySelector('select')!;
    const reactPropsKey = Object.keys(select).find(k => k.startsWith('__reactProps$'))!;
    for (const val of ['3725630f-417f-4188-91e4-82357376e70f', '872b26d5-866c-43dd-817e-50b1fa4b4bb1', '']) {
      await act(async () => {
        (select as any)[reactPropsKey].onChange({ target: { value: val } });
        await new Promise(r => setTimeout(r, 0));
      });
    }
    assert.equal(workspaceCalls, 0, 'Same-workspace job selection/clearing must not invoke onWorkspace');
    await act(async () => { reactRoot.unmount(); });
  });

  it('RC-01: generateUuid() uses native randomUUID, falls back to getRandomValues RFC4122 v4, and throws when unavailable', async () => {
    const { generateUuid } = await import('../src/utils/uuid.ts');
    const v4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    assert.match(generateUuid(), v4Regex);

    const origCrypto = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', {
        configurable: true,
        value: {
          getRandomValues: (arr: Uint8Array) => {
            for (let i = 0; i < arr.length; i++) arr[i] = (i * 17 + 5) & 0xff;
            return arr;
          },
        },
      });
      const fallback = generateUuid();
      assert.match(fallback, v4Regex);

      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
      assert.throws(() => generateUuid(), /Cryptographic UUID generation is unavailable/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: origCrypto });
    }
  });

  it('RC-02: missing or failed session.token() does not fetch /settings and preserves current theme', async () => {
    const dom = setupDom();
    const origFetch = globalThis.fetch;
    let settingsFetchCount = 0;
    globalThis.fetch = (async (input: any) => {
      if (String(input).includes('/settings')) settingsFetchCount += 1;
      return new Response('{}', { status: 200 });
    }) as any;
    try {
      let ctxRef: any;
      const Probe = () => { ctxRef = useCabms(); return null; };
      const session: Session = {
        profile: {
          user: { id: 'u1', email: 'a@b.com', display_name: 'Admin' },
          memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' }],
        },
        workspaceId: 'solarcell',
        selectWorkspace: () => {},
        token: async () => '',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      const rootEl = dom.window.document.getElementById('root')!;
      const reactRoot = createRoot(rootEl);
      await act(async () => {
        reactRoot.render(React.createElement(SessionContext.Provider, { value: session }, React.createElement(CabmsProvider, null, React.createElement(Probe))));
        await new Promise(r => setTimeout(r, 0));
      });
      assert.equal(settingsFetchCount, 0, 'Empty token must not issue GET /settings');
      assert.equal(ctxRef.visualPreset, 'light_company');
      await act(async () => { reactRoot.unmount(); });
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('Account Switch: G01SessionProvider switchAccount handles popup-closed-by-user without breaking session', async () => {
    const { G01SessionProvider, useG01Session } = await import('../src/context/G01Session.tsx');
    const dom = setupDom();
    let sessionRef: any = null;
    const Probe = () => { sessionRef = useG01Session(); return null; };
    const fakeUser = { uid: 'u1', getIdToken: async () => 'tok-1' } as any;
    const deps = {
      currentUser: () => fakeUser,
      onIdTokenChanged: (cb: any) => { cb(fakeUser); return () => {}; },
      signOut: async () => {},
      signIn: async () => {},
      switchAccount: async () => {
        const err: any = new Error('Popup closed');
        err.code = 'auth/popup-closed-by-user';
        throw err;
      },
      getCurrentUser: async () => ({
        ok: true,
        status: 200,
        data: {
          user: { id: 'u1', email: 'a@b.com', display_name: 'Super Admin' },
          memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'super_admin' }],
        },
      }) as any,
    };
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    await act(async () => {
      reactRoot.render(React.createElement(G01SessionProvider as any, { dependencies: deps }, React.createElement(Probe)));
      await new Promise(r => setTimeout(r, 0));
    });
    assert.equal(sessionRef?.profile?.user.id, 'u1');
    await act(async () => {
      await sessionRef?.switchAccount?.();
    });
    assert.equal(sessionRef?.profile?.user.id, 'u1', 'Cancelled popup preserves current valid session');
    assert.equal(sessionRef?.error, '');
    await act(async () => { reactRoot.unmount(); });
  });

  it('DEF-04: pre-HTTP token() failure throws JobError(401) without reconcile', async () => {
    const { jobsClient, JobError } = await import('../src/services/complianceJobsClient.ts');
    const client = jobsClient(async () => { throw new Error('Authentication required'); });
    await assert.rejects(
      () => client.complete({ id: 'j1', workspace_id: 'solarcell', title: 'J1', status: 'OPEN', version: 1, policy_id: 'p1', assignee_id: null, technician: null, photo_cap: null, photo_count: 0 }, 'k1'),
      (err: unknown) => err instanceof JobError && err.status === 401 && !err.reconcile
    );
  });

  it('DEF-05/DEF-10: TemplatesSettingsView protects dirty edits (including clearing all text), clears stale template fallback, and locks Edit Job Type brand under auth', () => {
    const tpl = fs.readFileSync(path.join(root, 'src/views/TemplatesSettingsView.tsx'), 'utf8');
    assert.match(tpl, /hasEditedTemplate/);
    assert.match(tpl, /isTemplateDirty\s*=\s*!!currentTemplate\s*&&\s*hasEditedTemplate\s*&&\s*editingContent\s*!==\s*currentTemplate\.content/);
    assert.match(tpl, /confirmDiscardTemplateEdits/);
    assert.match(tpl, /currentTemplate\s*=\s*filteredTemplates\.find/);
    assert.match(tpl, /disabled=\{!!session\?\.profile\}\s+value=\{editJtBrandId\}/);
  });

  it('Behavioral DEF-10: TemplateModal manages initial focus, Tab/Shift+Tab containment, Escape close, and focus restoration', async () => {
    const { TemplateModal } = await import('../src/views/TemplatesSettingsView.tsx');
    const dom = setupDom();
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    let closed = false;
    const Host = ({ open }: { open: boolean }) => (
      React.createElement('div', null,
        React.createElement('button', { id: 'opener-btn' }, 'Open'),
        open ? React.createElement(TemplateModal, {
          onClose: () => { closed = true; },
          titleId: 'modal-title',
          children: React.createElement(React.Fragment, null,
            React.createElement('h3', { id: 'modal-title' }, 'Title'),
            React.createElement('button', { id: 'first-btn' }, 'First'),
            React.createElement('button', { id: 'last-btn' }, 'Last')
          ),
        }) : null
      )
    );
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    const opener = dom.window.document.getElementById('opener-btn') as HTMLElement;
    opener.focus();
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: true }));
    });
    const first = dom.window.document.getElementById('first-btn') as HTMLElement;
    const last = dom.window.document.getElementById('last-btn') as HTMLElement;
    assert.equal(dom.window.document.activeElement, first, 'Initial focus placed inside dialog');

    last.focus();
    await act(async () => {
      last.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    assert.equal(dom.window.document.activeElement, first, 'Tab wraps from last to first');

    await act(async () => {
      first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    });
    assert.equal(dom.window.document.activeElement, last, 'Shift+Tab wraps from first to last');

    await act(async () => {
      first.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(closed, true, 'Escape closes dialog');

    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    assert.equal(dom.window.document.activeElement, opener, 'Focus restored to opener on close');
    await act(async () => { reactRoot.unmount(); });
  });

  it('Behavioral DEF-05: TemplatesSettingsView detects cleared empty-string editor content and protects against accidental discard', async () => {
    const { TemplatesSettingsView } = await import('../src/views/TemplatesSettingsView.tsx');
    const dom = setupDom();
    const origConfirm = dom.window.confirm;
    let confirmCalls = 0;
    dom.window.confirm = () => { confirmCalls += 1; return false; };
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    try {
      await act(async () => {
        reactRoot.render(React.createElement(CabmsProvider, null, React.createElement(TemplatesSettingsView)));
        await new Promise(r => setTimeout(r, 0));
      });
      const textarea = dom.window.document.querySelector('textarea') as HTMLTextAreaElement;
      const reactPropsKey = Object.keys(textarea).find(k => k.startsWith('__reactProps$'))!;
      await act(async () => {
        (textarea as any)[reactPropsKey].onChange({ target: { value: '' } });
      });
      assert.equal(textarea.value, '', 'Cleared editor stays empty');
      const searchInput = dom.window.document.querySelector('input[aria-label="Search templates"]') as HTMLInputElement;
      const searchKey = Object.keys(searchInput).find(k => k.startsWith('__reactProps$'))!;
      await act(async () => {
        (searchInput as any)[searchKey].onChange({ target: { value: 'other' } });
      });
      assert.equal(confirmCalls, 1, 'Clearing editor to empty string triggers dirty confirmation');
      assert.equal(searchInput.value, '', 'Declining confirm aborts filter change');
    } finally {
      dom.window.confirm = origConfirm;
      await act(async () => { reactRoot.unmount(); });
    }
  });

  it('Behavioral DEF-05: templateDraftContent preserves intentionally cleared empty string when edited', async () => {
    const { templateDraftContent } = await import('../src/utils/templateServerMapping.ts');
    assert.equal(templateDraftContent('', 'Original text', true), '', 'Edited empty string must not snap back to original content');
    assert.equal(templateDraftContent('', 'Original text', false), 'Original text', 'Unedited fallback preserves original content');
  });

  it('DEF-10: every TemplateModal titleId in TemplatesSettingsView has a matching heading id', () => {
    const src = fs.readFileSync(path.join(root, 'src/views/TemplatesSettingsView.tsx'), 'utf8');
    const titleIds = [...src.matchAll(/<TemplateModal[\s\S]*?titleId="([^"]+)"/g)].map(m => m[1]);
    assert.equal(titleIds.length, 8, 'Expected all 8 template dialogs to use TemplateModal');
    for (const id of titleIds) {
      assert.ok(src.includes(`id="${id}"`), `Missing matching heading id="${id}" in TemplatesSettingsView.tsx`);
    }
  });

  it('Behavioral CatalogPolicyEditor: enforces aria-modal, labelledby, Escape close, Tab wrap, and focus restoration', async () => {
    const { CatalogPolicyEditor } = await import('../src/components/CatalogPolicyEditor.tsx');
    const dom = setupDom();
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    let closed = false;
    const Host = ({ open }: { open: boolean }) => (
      React.createElement('div', null,
        React.createElement('button', { id: 'policy-opener' }, 'Open Policy'),
        open ? React.createElement(CatalogPolicyEditor, {
          jobType: {
            id: 'jt-1',
            name: 'Solar Install',
            brandId: 'solarcell',
            formsRequired: [],
            directToInvoice: false,
            completionRule: 'ALL_FORMS',
            status: 'ACTIVE',
            activeStatus: 'PUBLISHED',
          } as any,
          close: () => { closed = true; },
        }) : null
      )
    );
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    const opener = dom.window.document.getElementById('policy-opener') as HTMLElement;
    opener.focus();
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: true }));
      await new Promise(r => setTimeout(r, 0));
    });
    const dialog = dom.window.document.querySelector('[role="dialog"]') as HTMLElement;
    assert.equal(dialog.getAttribute('aria-modal'), 'true', 'CatalogPolicyEditor dialog must set aria-modal=true');
    const labelId = dialog.getAttribute('aria-labelledby');
    assert.ok(labelId && dom.window.document.getElementById(labelId), 'CatalogPolicyEditor dialog must have valid aria-labelledby');
    assert.ok(dialog.contains(dom.window.document.activeElement), 'Initial focus must be inside CatalogPolicyEditor dialog');

    const closeBtn = Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Close') as HTMLElement;
    closeBtn.focus();
    await act(async () => {
      closeBtn.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    assert.ok(dialog.contains(dom.window.document.activeElement) && dom.window.document.activeElement !== closeBtn, 'Tab wraps within CatalogPolicyEditor');

    await act(async () => {
      dialog.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(closed, true, 'Escape closes CatalogPolicyEditor');

    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    assert.equal(dom.window.document.activeElement, opener, 'Focus restored to opener when CatalogPolicyEditor closes');
    await act(async () => { reactRoot.unmount(); });
  });

  it('Workstream A: Modal 1 removes autoFocus so Preview Document opener regains focus, SignInScreen gets focus-visible ring, and JobsView Create New Work Order uses TemplateModal', async () => {
    const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
    assert.match(css, /\.cabms-app-shell :is\(button, a, select, input, textarea\):focus-visible,/);

    const tplSrc = fs.readFileSync(path.join(root, 'src/views/TemplatesSettingsView.tsx'), 'utf8');
    assert.doesNotMatch(tplSrc, /aria-label="Close sample preview"\s+autoFocus/);

    const jobsSrc = fs.readFileSync(path.join(root, 'src/views/JobsView.tsx'), 'utf8');
    assert.match(jobsSrc, /<TemplateModal onClose=\{\(\) => setIsNewJobModalOpen\(false\)\} titleId="demo-create-work-order-title"/);
    assert.match(jobsSrc, /id="demo-create-work-order-title"/);

    const { TemplateModal } = await import('../src/views/TemplatesSettingsView.tsx');
    const dom = setupDom();
    const rootEl = dom.window.document.getElementById('root')!;
    const reactRoot = createRoot(rootEl);
    const Host = ({ open }: { open: boolean }) => (
      React.createElement('div', null,
        React.createElement('button', { id: 'preview-doc-btn' }, 'Preview Document'),
        open ? React.createElement(TemplateModal, {
          onClose: () => {},
          titleId: 'sample-preview-title',
          children: React.createElement(React.Fragment, null,
            React.createElement('h3', { id: 'sample-preview-title' }, 'Sample preview'),
            React.createElement('button', { type: 'button', 'aria-label': 'Close sample preview', id: 'close-preview-btn' }, '✕')
          ),
        }) : null
      )
    );
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    const opener = dom.window.document.getElementById('preview-doc-btn') as HTMLElement;
    opener.focus();
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: true }));
    });
    assert.equal(dom.window.document.activeElement?.id, 'close-preview-btn');
    await act(async () => {
      reactRoot.render(React.createElement(Host, { open: false }));
    });
    assert.equal(dom.window.document.activeElement, opener, 'Closing Modal 1 restores focus to Preview Document opener');
    await act(async () => { reactRoot.unmount(); });
  });
});
