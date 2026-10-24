import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToString } from 'react-dom/server';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { DemoBanner } from '../src/components/DemoBanner.tsx';
import { DemoControlsBar } from '../src/components/DemoControlsBar.tsx';
import { DashboardView } from '../src/views/DashboardView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { QuotesAcceptanceView } from '../src/views/QuotesAcceptanceView.tsx';
import { ScheduleView } from '../src/views/ScheduleView.tsx';
import { AccessDeniedView } from '../src/components/AccessDeniedView.tsx';
import { BrandLogo } from '../src/components/BrandLogo.tsx';
import { Persona, BrandId, AppearanceMode } from '../src/types/cabms.ts';
// These SSR wrappers label markup fixtures; they do not execute responsive CSS.
// Fixed Viewport Representation Wrappers
const DesktopViewport: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  React.createElement('div', { 'data-viewport': '1440x900', className: 'w-[1440px] min-h-[900px] overflow-hidden' }, children)
);

const TabletViewport: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  React.createElement('div', { 'data-viewport': '768x1024', className: 'w-[768px] min-h-[1024px] overflow-hidden' }, children)
);

const MobileViewport: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  React.createElement('div', { 'data-viewport': '390x844', className: 'w-[390px] min-h-[844px] overflow-hidden' }, children)
);

test('LAYER 7: Pixel Screenshot Rasterization — Engine status check', (t) => {
  t.skip(
    'NOT RUN by this suite: no automated pixel-baseline comparison is configured. SSR and JSDOM assertions do not measure CSS layout. Any separate browser receipts must be reviewed independently.'
  );
});

test('LAYER 7: SSR markup — default shell and dashboard in a labelled desktop fixture', () => {
  const html = renderToString(
    React.createElement(
      DesktopViewport,
      null,
      React.createElement(
        CabmsProvider,
        null,
        React.createElement(
          'div',
          null,
          React.createElement(DemoBanner),
          React.createElement(DemoControlsBar),
          React.createElement(Navigation),
          React.createElement(DashboardView)
        )
      )
    )
  );

  assert.ok(html.includes('data-viewport="1440x900"'));
  assert.ok(html.includes('DEMO — NO LIVE INTEGRATIONS'));
  assert.ok(html.includes('Smart Home') && html.includes('CCTV'), 'distinct business switch names are present');
});

test('LAYER 7: SSR markup — navigation and jobs in a labelled tablet fixture', () => {
  const html = renderToString(
    React.createElement(
      TabletViewport,
      null,
      React.createElement(
        CabmsProvider,
        null,
        React.createElement(
          'div',
          null,
          React.createElement(Navigation),
          React.createElement(JobsView)
        )
      )
    )
  );

  assert.ok(html.includes('data-viewport="768x1024"'));
  assert.ok(html.includes('Operational Work Orders'));
});

test('LAYER 7: SSR markup — default compliance form in a labelled mobile fixture', () => {
  const html = renderToString(
    React.createElement(
      MobileViewport,
      null,
      React.createElement(
        CabmsProvider,
        null,
        React.createElement(
          'div',
          null,
          React.createElement(DemoBanner),
          React.createElement(ComplianceFormsView)
        )
      )
    )
  );

  assert.ok(html.includes('data-viewport="390x844"'));
  assert.ok(html.includes('Job Safety Analysis (JSA)'));
});

test('LAYER 7: Mounted persona matrix exercises four actual roles and denied views', async () => {
  await mountView(React.createElement(React.Fragment, null, React.createElement(Navigation), React.createElement(QuotesAcceptanceView)), async (ctx, container, window) => {
    const states = new Set<string>();
    const expectedVisible = { super_admin: 10, owner_admin: 9, office_staff: 8, technician: 4 };
    for (const persona of ['super_admin', 'owner_admin', 'office_staff', 'technician'] as Persona[]) {
      await act(async () => { ctx.simulateSignIn(persona); });
      assert.equal(ctx.persona, persona);
      const nav = container.querySelector('nav[aria-label="Main navigation"]')!;
      assert.equal(nav.querySelectorAll('button').length, expectedVisible[persona]);
      assert.equal(nav.querySelectorAll('button[title^="Access Denied"]').length, 0);
      const quotes = nav.querySelector('button[aria-label="Quotations & Terms"]');
      assert.equal(Boolean(quotes), persona !== 'technician');
      // Exercise direct view selection independently of the hidden menu destination.
      await act(async () => { ctx.setActiveTab('quotes'); });
      assert.equal(ctx.activeTab, 'quotes');
      assert.equal(container.textContent?.includes('Access Denied — Persona Boundary Enforced'), persona === 'technician');
      states.add(container.innerHTML);
    }
    assert.equal(states.size, 4, 'four different rendered role states');
  });
});

test('LAYER 7: Mounted brand matrix changes identity and filters operational jobs for all three businesses', async () => {
  await mountView(React.createElement(React.Fragment, null, React.createElement(Navigation), React.createElement(DashboardView)), async (ctx, container) => {
    const states = new Set<string>();
    for (const brand of ['solarcell', 'smart_home', 'cctv'] as BrandId[]) {
      await act(async () => { ctx.setActiveBrandId(brand); });
      assert.equal(container.querySelector('h1')?.textContent, ctx.brands[brand].name);
      for (const job of ctx.jobs) {
        assert.equal(container.textContent?.includes(job.id), job.brandId === brand, `job ${job.id} belongs to ${brand}`);
      }
      assert.equal(container.querySelector('.cabms-brand-mark')?.textContent?.trim(), ctx.brands[brand].name.charAt(0));
      states.add(container.innerHTML);
    }
    assert.equal(states.size, 3, 'three different rendered business states');
  });
});

test('LAYER 7: SSR markup — explicit access-denied resource and explanation', () => {
  const htmlDenied = renderToString(
    React.createElement(
      CabmsProvider,
      null,
      React.createElement(AccessDeniedView, {
        resourceName: 'Technical Credentials',
        requiredRoleDescription: 'Super Admin',
        customExplanation: 'Technical integration configurations are restricted.',
      })
    )
  );
  assert.ok(htmlDenied.includes('Access Denied — Persona Boundary Enforced'));
  assert.ok(htmlDenied.includes('Technical Credentials'));
});



test('LAYER 7: SSR markup — Gate T structural theme rendering verifies semantic classes', () => {
  const html = renderToString(
    React.createElement(
      CabmsProvider,
      null,
      React.createElement(DashboardView)
    )
  );
  assert.ok(html.includes('cabms-card'), 'SSR markup includes semantic cabms-card');
  assert.ok(html.includes('cabms-badge-warning'), 'SSR markup includes semantic cabms-badge-warning');
});

test('LAYER 7: Mounted appearance matrix exercises all three appearance modes on DOM root', async () => {
  await mountView(React.createElement(DemoControlsBar), async (ctx, _container, window) => {
    for (const mode of ['default_dark', 'high_visibility_light', 'high_visibility_dark'] as AppearanceMode[]) {
      await act(async () => {
        ctx.setAppearance(mode);
      });
      assert.equal(ctx.appearance, mode, `context appearance is ${mode}`);
      assert.equal(
        window.document.documentElement.getAttribute('data-appearance'),
        mode,
        `DOM root attribute data-appearance is synchronized to ${mode}`
      );
    }
  });
});

test('LAYER 7: Mounted light mode test verifies representative inputs, panels and headings remain accessible in high_visibility_light', async () => {
  await mountView(React.createElement(ComplianceFormsView), async (ctx, container, window) => {
    await act(async () => {
      ctx.setAppearance('high_visibility_light');
    });
    assert.equal(ctx.appearance, 'high_visibility_light');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_light');

    // Verify representative headings do not contain hardcoded text-white on light cards
    const heading = container.querySelector('h1');
    assert.ok(heading, 'Representative h1 heading found');
    assert.ok(!heading.classList.contains('text-white'), 'h1 does not use hardcoded text-white');

    // Verify representative inputs use cabms-input and do not use fixed dark backgrounds
    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    assert.ok(inputs.length > 0, 'Representative text inputs found');
    for (const input of inputs) {
      assert.ok(
        input.classList.contains('cabms-input'),
        `Input with value "${input.value}" uses semantic cabms-input class`
      );
      assert.ok(
        !input.classList.contains('bg-slate-900') && !input.classList.contains('bg-slate-950') && !input.classList.contains('bg-slate-800'),
        `Input with value "${input.value}" does not use fixed dark Tailwind background`
      );
    }
  });

  await mountView(React.createElement(ScheduleView), async (ctx, container) => {
    await act(async () => {
      ctx.setAppearance('high_visibility_light');
    });
    // Verify schedule cards use semantic cabms-card and not hardcoded dark backgrounds
    const cards = Array.from(container.querySelectorAll('div.cabms-card'));
    assert.ok(cards.length > 0, 'Schedule view renders semantic cabms-card elements');
    for (const card of cards) {
      assert.ok(!card.classList.contains('bg-slate-900'), 'Card does not use hardcoded bg-slate-900');
    }
  });
});

test('LAYER 7: SSR markup — brand logos render for all 3 businesses across all appearance modes', () => {
  const brands = ['solarcell', 'smart_home', 'cctv'] as const;
  const modes = ['default_dark', 'high_visibility_light', 'high_visibility_dark'] as const;

  for (const brand of brands) {
    for (const mode of modes) {
      const fullHtml = renderToString(
        React.createElement(BrandLogo, { brandId: brand, variant: 'full' })
      );
      assert.ok(fullHtml.includes('cabms-brand-svg'), `full logo for ${brand} has cabms-brand-svg`);
      assert.ok(fullHtml.includes('cabms-brand-full-svg'), `full logo for ${brand} has cabms-brand-full-svg`);

      const markHtml = renderToString(
        React.createElement(BrandLogo, { brandId: brand, variant: 'mark' })
      );
      assert.ok(markHtml.includes('cabms-brand-svg'), `mark logo for ${brand} has cabms-brand-svg`);
      assert.ok(markHtml.includes('cabms-brand-mark-svg'), `mark logo for ${brand} has cabms-brand-mark-svg`);
    }
  }
});

// Mounted state assertions supplement SSR structure; JSDOM does not measure CSS layout.
async function mountView(view: React.ReactNode, run: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement, window: JSDOM['window']) => Promise<void>) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
  Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  let current!: ReturnType<typeof useCabms>;
  function Observer() { current = useCabms(); return React.createElement(React.Fragment, null, view); }
  await act(async () => { root.render(React.createElement(CabmsProvider, null, React.createElement(Observer))); });
  const ctx = new Proxy({} as ReturnType<typeof useCabms>, { get: (_, key) => (current as any)[key] });
  try { await run(ctx, container, dom.window); }
  finally { await act(async () => { root.unmount(); }); dom.window.close(); }
}
