import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToString } from 'react-dom/server';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
import { DemoControlsBar } from '../src/components/DemoControlsBar.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { AppContent } from '../src/App.tsx';
import { DashboardView } from '../src/views/DashboardView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { CustomersView } from '../src/views/CustomersView.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { QuotesAcceptanceView } from '../src/views/QuotesAcceptanceView.tsx';
import { ScheduleView } from '../src/views/ScheduleView.tsx';
import { CommunicationsView } from '../src/views/CommunicationsView.tsx';
import { TemplatesSettingsView } from '../src/views/TemplatesSettingsView.tsx';

test('LAYER 4: Components — DashboardView renders KPI metrics and workflow queues', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(DashboardView))
  );
  assert.ok(html.includes('In-Progress Jobs') || html.includes('Solarcell'));
  assert.ok(html.includes('Licence:') || html.includes('MYOB File:'));
});

test('LAYER 4: Components — CustomersView renders directory, search, and duplicate resolution structure', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(CustomersView))
  );
  assert.ok(html.includes('Customer Directory') || html.includes('MYOB Business Master'));
  assert.ok(html.includes('New Customer (MYOB Write-Through)'));
  assert.ok(html.includes('John Citizen'));
});

test('LAYER 4: Components — JobsView renders work order list, filter controls, and job creation drawer', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(JobsView))
  );
  assert.ok(html.includes('Operational Work Orders &amp; Compliance Journey') || html.includes('Operational Work Orders'));
  assert.ok(html.includes('Create New Job'));
  assert.ok(html.includes('JOB-2026-101'));
});

test('LAYER 4: Components — ComplianceFormsView renders JSA, Electrical, Smoke Alarm, TCA1, TCA2 tabs', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(ComplianceFormsView))
  );
  assert.ok(html.includes('Job Safety Analysis (JSA)'));
  assert.ok(html.includes('TCA1 Cabling'));
  assert.ok(html.includes('TCA2 Defect Notice'));
  assert.ok(html.includes('Apply Technician DEMO Sign-off') || html.includes('DEMO Sign-off Applied'));
  assert.ok(html.includes('Site Induction Completed'));
  assert.ok(html.includes('Competencies Verified'));
});

test('LAYER 4: Components — ComplianceFormsView renders hazard matrix and PPE checklist in JSA', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(ComplianceFormsView))
  );
  assert.ok(html.includes('Task Steps, Hazards &amp; Controls Matrix') || html.includes('Job Safety Analysis'));
  assert.ok(html.includes('Personal Protective Equipment (PPE) Checklist') || html.includes('PPE'));
  assert.ok(html.includes('Field Evidence Photos &amp; Attachments Library') || html.includes('Attachments'));
});

test('LAYER 4: Components — QuotesAcceptanceView renders quotation scope, terms snapshot, and recipient portal switch', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(QuotesAcceptanceView))
  );
  assert.ok(html.includes('Quotation &amp; Frozen Terms Snapshot') || html.includes('Quotation'));
  assert.ok(html.includes('Customer Acceptance Link') || html.includes('Recipient Mode'));
  assert.ok(html.includes('Preserved Terms of Service Snapshot'));
});

test('LAYER 4: Components — ScheduleView renders calendar grid, technician appointments, and status indicators', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(ScheduleView))
  );
  assert.ok(html.includes('Field Service Dispatch &amp; Calendar Scheduling') || html.includes('Calendar Scheduling'));
  assert.ok(html.includes('Dave Miller') || html.includes('Scheduled'));
});

test('LAYER 4: Components — CommunicationsView renders review request deduplication and reminder suppression audits', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(CommunicationsView))
  );
  assert.ok(html.includes('Google Review Automation &amp; Deduplication') || html.includes('Review Automation'));
  assert.ok(html.includes('Appointment Reminders &amp; Invalidation') || html.includes('Reminders'));
  assert.ok(html.includes('Certificate Delivery Previews') || html.includes('Certificates'));
});

test('LAYER 4: Components — TemplatesSettingsView renders template lifecycle (DRAFT -> REVIEW -> PUBLISHED)', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(TemplatesSettingsView))
  );
  assert.ok(html.includes('Owner / Admin Content &amp; Template Settings') || html.includes('Template Settings'));
  assert.ok(html.includes('Required Compliance Documents by Demo Job Type'));
});


// Mounted state assertions supplement SSR structure; JSDOM does not measure CSS layout.
async function mountView(view: React.ReactNode, run: (ctx: ReturnType<typeof useCabms>, container: HTMLDivElement, window: JSDOM['window']) => Promise<void>, setup?: (window: JSDOM['window']) => void) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:3000' });
  setup?.(dom.window);
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

test('LAYER 4: CP-01 — labelled work-order controls switch real context and retain full long identity', async () => {
  for (const [View, id] of [[CommunicationsView, 'communications-work-order'], [QuotesAcceptanceView, 'quote-work-order'], [ComplianceFormsView, 'compliance-work-order']] as const) {
    await mountView(React.createElement(View), async (ctx, container, window) => {
      let jobId = '';
      const title = 'Synthetic long work order '.repeat(12);
      await act(async () => {
        jobId = ctx.createJob({ brandId: 'solarcell', title, jobType: 'Emergency service', siteAddress: 'Synthetic site', siteContact: 'Synthetic contact' }).id;
      });
      const select = container.querySelector<HTMLSelectElement>(`#${id}`)!;
      assert.ok(container.querySelector(`label[for="${id}"]`), 'visible label is associated with select');
      assert.ok(Array.from(select.options).some(option => option.value === jobId && option.textContent?.includes(title)), 'full long identity is retained');
      await act(async () => {
        select.value = jobId;
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      assert.equal(ctx.selectedJobId, jobId);
      assert.equal(select.value, jobId);
      assert.equal(select.title, `${jobId} — ${title}`);
    });
  }
});

test('LAYER 4: CP-01 — Website Inbox submission control creates an enquiry for the selected business', async () => {
  await mountView(React.createElement(WebsiteInboxView), async (ctx, container, window) => {
    for (const brand of ['solarcell', 'smart_home', 'cctv'] as const) {
      const select = container.querySelector<HTMLSelectElement>('select[aria-label="Website submission business"]')!;
      await act(async () => {
        select.value = brand;
        select.dispatchEvent(new window.Event('change', { bubbles: true }));
      });
      const previous = ctx.websiteEnquiries.length;
      const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Simulate Web Submission'))!;
      await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      assert.equal(ctx.websiteEnquiries.length, previous + 1);
      assert.equal(ctx.websiteEnquiries[0].brandId, brand);
    }
  });
});

test('LAYER 4: CP-01 — distinct business switches change the header and Brisbane weekly completion count', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container, window) => {
    const expected = { solarcell: 'Solarcell', smart_home: 'Smart Home', cctv: 'CCTV' };
    for (const brand of ['solarcell', 'smart_home', 'cctv'] as const) {
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Switch business to ${ctx.brands[brand].name}"]`)!;
      assert.equal(button.textContent?.trim(), expected[brand]);
      await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      assert.equal(ctx.activeBrandId, brand);
      assert.equal(container.querySelector('h1')?.textContent, ctx.brands[brand].name);
      assert.equal(button.getAttribute('aria-pressed'), 'true');
    }
    await act(async () => {
      ctx.setActiveBrandId('smart_home');
      ctx.attemptCompleteJob('JOB-2026-102');
    });
    assert.equal(container.querySelector('[data-testid="weekly-completed"]')?.textContent, '1');
    await act(async () => { ctx.setActiveBrandId('solarcell'); });
    assert.equal(container.querySelector('[data-testid="weekly-completed"]')?.textContent, '0', 'other business completion is excluded');
    await act(async () => { ctx.setActiveBrandId('smart_home'); ctx.advanceClock(7 * 24); });
    assert.equal(container.querySelector('[data-testid="weekly-completed"]')?.textContent, '0', 'last week completion is excluded');
    await act(async () => { ctx.resetDemo(); ctx.setActiveBrandId('smart_home'); });
    assert.equal(container.querySelector('[data-testid="weekly-completed"]')?.textContent, '0', 'reset restores metric');
  });
});

test('LAYER 4: CP-01 — mounted business clocks agree before and after virtual-clock advance', async () => {
  const previous = process.env.TZ;
  process.env.TZ = 'Asia/Kolkata';
  try {
    await mountView(React.createElement(React.Fragment, null, React.createElement(DemoControlsBar), React.createElement(ScheduleView), React.createElement(CommunicationsView)), async (ctx, container) => {
      assert.equal(container.textContent?.split('2 Nov 2026, 09:00 AEST (UTC+10)').length, 4);
      await act(async () => { ctx.advanceClock(1); });
      assert.equal(container.textContent?.split('2 Nov 2026, 10:00 AEST (UTC+10)').length, 4);
    });
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('LAYER 4: Gate S — collapse retains the mounted page, unsaved input and domain state; icon labels remain available', async () => {
  await mountView(React.createElement(AppContent), async (ctx, container, window) => {
    await act(async () => { ctx.setActiveTab('jobs'); });
    const search = container.querySelector<HTMLInputElement>('input[placeholder="Search jobs..."]')!;
    assert.ok(search);
    search.value = 'Unsaved operator search';
    const before = structuredClone(ctx.getAuthoritativeState());
    const main = container.querySelector('main');
    const collapse = container.querySelector<HTMLButtonElement>('button[aria-label="Collapse sidebar"]')!;
    await act(async () => { collapse.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
    assert.equal(container.querySelector('.cabms-shell')?.getAttribute('data-sidebar-collapsed'), 'true');
    assert.equal(container.querySelector('main'), main);
    assert.equal(container.querySelector('input[placeholder="Search jobs..."]'), search);
    assert.equal(search.value, 'Unsaved operator search');
    assert.equal(ctx.activeTab, 'jobs');
    assert.deepEqual(ctx.getAuthoritativeState(), before);
    const jobs = container.querySelector<HTMLButtonElement>('nav[aria-label="Main navigation"] button[aria-label="Jobs & Operations"]')!;
    await act(async () => { jobs.focus(); });
    assert.equal(window.document.querySelector('[role="tooltip"]')?.textContent, 'Jobs & Operations');
    assert.equal(jobs.getAttribute('aria-current'), 'page');
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Expand sidebar"]')!.click(); });
    assert.equal(container.querySelector('.cabms-shell')?.getAttribute('data-sidebar-collapsed'), 'false');
    assert.equal(search.value, 'Unsaved operator search');
    assert.equal(window.document.querySelector('[role="tooltip"]'), null);
  });
});

test('LAYER 4: Gate S — mobile drawer traps/restores focus, isolates background and closes by Escape, backdrop and navigation', async () => {
  await mountView(React.createElement(AppContent), async (ctx, container, window) => {
    window.document.body.style.overflow = 'auto';
    const existingInert = window.document.createElement('div');
    existingInert.setAttribute('inert', '');
    window.document.body.appendChild(existingInert);
    const opener = container.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
    const open = async () => { await act(async () => { opener.click(); }); };
    await open();
    const drawer = window.document.querySelector<HTMLElement>('[role="dialog"]')!;
    assert.ok(drawer);
    assert.equal(drawer.getAttribute('aria-modal'), 'true');
    assert.equal(opener.getAttribute('aria-expanded'), 'true');
    assert.equal(container.hasAttribute('inert'), true);
    assert.equal(drawer.closest('[inert]'), null);
    assert.equal(window.document.body.style.overflow, 'hidden');
    const close = drawer.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]')!;
    const buttons = Array.from(drawer.querySelectorAll<HTMLButtonElement>('button'));
    assert.equal(window.document.activeElement, close);
    await act(async () => { close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })); });
    assert.equal(window.document.activeElement, buttons.at(-1));
    await act(async () => { buttons.at(-1)!.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    assert.equal(window.document.activeElement, close);
    await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="Sign out"]')!.focus(); });
    assert.equal(window.document.activeElement, close, 'focus cannot escape to inert background');
    await act(async () => { close.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(window.document.activeElement, opener);
    assert.equal(container.hasAttribute('inert'), false);
    assert.equal(existingInert.hasAttribute('inert'), true, 'pre-existing inert state is preserved');
    assert.equal(window.document.body.style.overflow, 'auto');
    await open();
    await act(async () => { window.document.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]')!.click(); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(window.document.activeElement, opener);
    await open();
    await act(async () => { window.document.querySelector<HTMLElement>('.cabms-drawer-backdrop')!.click(); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    await open();
    await act(async () => { window.document.querySelector<HTMLButtonElement>('nav[aria-label="Mobile navigation"] button[aria-label="Schedule & Calendar"]')!.click(); });
    assert.equal(ctx.activeTab, 'schedule');
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(window.document.activeElement, opener);
    await open();
    await act(async () => { ctx.setPersona('technician'); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    await open();
    assert.equal(window.document.querySelectorAll('nav[aria-label="Mobile navigation"] button').length, 4);
    await act(async () => { ctx.simulateSignOut(); });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(container.hasAttribute('inert'), false);
    assert.equal(window.document.body.style.overflow, 'auto');
    existingInert.remove();
  });
});

test('LAYER 4: Gate S — desktop resize dismisses the drawer and restores focus to the sidebar control', async () => {
  let desktop = false;
  const listeners = new Set<() => void>();
  await mountView(React.createElement(Navigation), async (_ctx, container, window) => {
    const opener = container.querySelector<HTMLButtonElement>('button[aria-label="Open navigation"]')!;
    await act(async () => { opener.click(); });
    assert.ok(window.document.querySelector('[role="dialog"]'));
    await act(async () => {
      desktop = true;
      listeners.forEach(listener => listener());
    });
    assert.equal(window.document.querySelector('[role="dialog"]'), null);
    assert.equal(window.document.activeElement, container.querySelector('button[aria-label="Collapse sidebar"]'));
    assert.equal(container.hasAttribute('inert'), false);
  }, window => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({
      get matches() { return desktop; },
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }) });
  });
  assert.equal(listeners.size, 0, 'media listener removed on unmount');
});

test('LAYER 4: Gate S — mobile demo disclosure retains controls and clock, and notifications remain outside the sidebar', async () => {
  await mountView(React.createElement(AppContent), async (ctx, container, window) => {
    const details = container.querySelector<HTMLDetailsElement>('details.cabms-demo-controls')!;
    assert.equal(details.open, false, 'demo controls start compact at narrow widths');
    await act(async () => {
      details.open = true;
      details.dispatchEvent(new window.Event('toggle', { bubbles: true }));
    });
    assert.ok(details.querySelector('select[aria-label="Demo Persona Selector"]'));
    const before = Date.parse(ctx.demoClock);
    await act(async () => { details.querySelector<HTMLButtonElement>('button[title="Advance virtual business clock by 1 hour"]')!.click(); });
    assert.equal(Date.parse(ctx.demoClock), before + 3600000);
    const notice = container.querySelector('[role="status"]')!;
    assert.ok(notice.textContent?.includes('Demo business clock advanced'));
    assert.equal(container.querySelector('aside')?.contains(notice), false);
    await act(async () => { notice.querySelector<HTMLButtonElement>('button')!.click(); });
    assert.equal(container.querySelector('[role="status"]'), null);
  }, window => {
    Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
  });
});
