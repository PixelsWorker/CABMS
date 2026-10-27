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
import { WorkspaceSettingsView } from '../src/views/WorkspaceSettingsView.tsx';
import { SystemWorkspaceSettingsView } from '../src/views/SystemWorkspaceSettingsView.tsx';
import { INITIAL_TEMPLATES } from '../src/data/seedData.ts';

function changeMountedInput(element: HTMLInputElement, value: string, window: JSDOM['window']) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  setter.call(element, value);
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
  element.dispatchEvent(new window.Event('change', { bubbles: true }));
  // React's input-event polyfill may be selected before this file installs JSDOM.
  const key = Object.keys(element).find(k => k.startsWith('__reactProps$'));
  if (key) (element as any)[key].onChange({ target: { value } });
}

test('LAYER 4: PR16 workspace saves preserve active theme and hub drafts stay isolated per brand', async () => {
  await mountView(React.createElement(SystemWorkspaceSettingsView), async (ctx, container, window) => {
    await act(async () => { ctx.simulateSignIn('super_admin'); ctx.setVisualPreset('light_neutral'); });
    const phone = () => container.querySelector<HTMLInputElement>('#ws-phone')!;
    const preset = () => container.querySelector<HTMLSelectElement>('#ws-preset')!;
    const save = async () => act(async () => { container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
    const tab = async (label: string) => act(async () => {
      Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim().startsWith(label))!.click();
    });
    await act(async () => { changeMountedInput(phone(), 'Solar saved phone', window); });
    await save();
    assert.equal(ctx.visualPreset, 'light_neutral', 'unrelated save preserves the active demo theme');
    assert.ok(preset().querySelector('option[value="high_visibility_dark"]'));
    await act(async () => {
      changeMountedInput(phone(), 'Solar unsaved phone', window);
      preset().value = 'high_visibility_dark';
      preset().dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await tab('System & Integrations');
    assert.equal(container.querySelector('[data-testid="workspace-settings-view"]')!.parentElement!.hidden, true);
    await tab('Workspace Settings');
    assert.equal(phone().value, 'Solar unsaved phone');
    assert.equal(preset().value, 'high_visibility_dark');
    await act(async () => { ctx.setActiveBrandId('smart_home'); });
    assert.notEqual(phone().value, 'Solar unsaved phone');
    await act(async () => { changeMountedInput(phone(), 'Smart unsaved phone', window); });
    await tab('System & Integrations');
    await tab('Workspace Settings');
    assert.equal(phone().value, 'Smart unsaved phone');
    await act(async () => { ctx.setActiveBrandId('solarcell'); });
    assert.equal(phone().value, 'Solar unsaved phone');
    await save();
    assert.equal(ctx.visualPreset, 'high_visibility_dark', 'explicitly changed preference applies');
    assert.equal(window.document.documentElement.dataset.appearance, 'high_visibility_dark');
    await act(async () => { ctx.setActiveBrandId('smart_home'); });
    assert.equal(phone().value, 'Smart unsaved phone', 'saving Solarcell preserves Smart Home draft');
    await act(async () => { ctx.simulateSignIn('owner_admin'); });
    await tab('System & Integrations');
    assert.ok(container.textContent?.includes('Access Denied'));
    await tab('Workspace Settings');
    assert.equal(phone().value, 'Smart unsaved phone');
  });
});

test('LAYER 4: PR16 unsupported quote form submissions retain values and do not consume public IDs', async () => {
  await mountView(React.createElement(QuotesAcceptanceView), async (ctx, container, window) => {
    let before!: ReturnType<typeof ctx.prepareQuoteForJob>;
    const items = [{ id: '1', description: 'Synthetic scope', quantity: 1, unitPrice: 100, total: 100 }];
    await act(async () => { before = ctx.prepareQuoteForJob('JOB-2026-101', 'Before rejection', items); ctx.setSelectedJobId('JOB-2026-102'); });
    const open = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Prepare') && b.textContent?.includes('Quote'))!;
    assert.ok(open);
    await act(async () => { open.click(); });
    await act(async () => {
      changeMountedInput(container.querySelector('form input[type="text"]')!, 'Retained synthetic scope', window);
      changeMountedInput(container.querySelector('form input[type="number"]')!, '456.78', window);
    });
    const jobsBefore = structuredClone(ctx.jobs);
    for (const clock of ['2030-01-01T09:00:00+10:00', '2028-12-29T09:00:00+10:00']) {
      await act(async () => { ctx.setDemoClock(clock); });
      await act(async () => { container.querySelector('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
      assert.deepEqual(ctx.jobs, jobsBefore);
      assert.equal(ctx.demoNotification?.type, 'error');
      assert.ok(ctx.demoNotification?.message.startsWith('Cannot prepare quote:'));
      assert.equal(container.querySelector<HTMLInputElement>('form input[type="text"]')?.value, 'Retained synthetic scope');
      assert.equal(container.querySelector<HTMLInputElement>('form input[type="number"]')?.value, '456.78');
    }
    await act(async () => { ctx.setDemoClock('2026-11-02T09:00:00+10:00'); });
    let after!: typeof before;
    await act(async () => { after = ctx.prepareQuoteForJob('JOB-2026-102', 'After rejection', items); });
    assert.equal(Number(after.id.split('-').at(-1)), Number(before.id.split('-').at(-1)) + 1);
  });
});

test('LAYER 4: PR16 quote form rethrows unexpected preparation failures', async () => {
  function FailingQuotes() {
    const ctx = useCabms();
    ctx.prepareQuoteForJob = () => { throw new Error('Unexpected preparation failure'); };
    return React.createElement(QuotesAcceptanceView);
  }
  await mountView(React.createElement(FailingQuotes), async (ctx, container) => {
    await act(async () => { ctx.setSelectedJobId('JOB-2026-102'); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Prepare') && b.textContent?.includes('Quote'))!.click(); });
    const form = container.querySelector('form')!;
    const key = Object.keys(form).find(k => k.startsWith('__reactProps$'))!;
    assert.throws(() => (form as any)[key].onSubmit({ preventDefault() {} }), /Unexpected preparation failure/);
    assert.ok(container.querySelector('form'), 'modal remains available');
  });
});

test('LAYER 4: PR16 terminal transitions retain job selection while explicit filters and boundaries remain effective', async () => {
  await mountView(React.createElement(JobsView), async (ctx, container, window) => {
    const filter = () => container.querySelector<HTMLSelectElement>('select.cabms-card-subtle')!;
    const click = async (text: string) => act(async () => { Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!.click(); });
    await click('Cancel Job');
    assert.equal(ctx.selectedJobId, 'JOB-2026-101');
    assert.equal(filter().value, 'all');
    assert.ok(container.textContent?.includes('Reopen Cancelled Job'));
    await act(async () => { filter().value = 'open'; filter().dispatchEvent(new window.Event('change', { bubbles: true })); });
    assert.equal(filter().value, 'open', 'deliberate Open filter stays effective');
    assert.notEqual(ctx.selectedJobId, 'JOB-2026-101');
    let id = '';
    await act(async () => { ctx.setActiveBrandId('smart_home'); });
    await act(async () => {
      id = ctx.createJob({ brandId: 'smart_home', title: 'Synthetic direct completion', jobType: 'JT-004', isDirectToInvoice: true, formsRequired: [] }).id;
      ctx.setSelectedJobId(id);
    });
    assert.equal(ctx.selectedJobId, id, 'newly created selected job survives current filter');
    await click('Complete Work Order');
    assert.equal(ctx.selectedJobId, id);
    assert.equal(filter().value, 'all');
    assert.ok(container.textContent?.includes('Work Order Completed'));
    const search = container.querySelector<HTMLInputElement>('input[placeholder*="Search"]')!;
    await act(async () => { changeMountedInput(search, 'no matching synthetic job', window); });
    assert.ok(!container.textContent?.includes('Work Order Completed'), 'search excludes terminal detail pane');
    await act(async () => { changeMountedInput(search, '', window); ctx.setActiveBrandId('solarcell'); });
    assert.equal(ctx.jobs.find(j => j.id === ctx.selectedJobId)?.brandId, 'solarcell');
    await act(async () => { ctx.simulateSignIn('technician'); });
    const selected = ctx.jobs.find(j => j.id === ctx.selectedJobId);
    if (selected?.brandId === ctx.activeBrandId) assert.equal(selected.assignedTechId, 'TECH-001');
  });
});

test('LAYER 4: PR16 expiry-warning copy and displayed compliance issuer describe current behavior', async () => {
  await mountView(React.createElement(QuotesAcceptanceView), async (ctx, container) => {
    await act(async () => { ctx.setDemoClock('2027-12-24T09:00:00+10:00'); });
    await act(async () => { ctx.prepareQuoteForJob('JOB-2026-101', 'Holiday example', [{ id: '1', description: 'Scope', quantity: 1, unitPrice: 100, total: 100 }]); });
    await act(async () => { Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Recipient Portal View'))!.click(); });
    assert.ok(container.textContent?.includes('Stage 2 (expiry warning)'));
    assert.ok(container.textContent?.includes('seven business days is the target, capped before expiration'));
    assert.ok(container.textContent?.includes('2028-01-06'));
  });
  await mountView(React.createElement(ComplianceFormsView), async (ctx, container) => {
    await act(async () => { ctx.setSelectedJobId('JOB-2026-104'); ctx.setActiveBrandId('solarcell'); });
    assert.equal(container.querySelector<HTMLSelectElement>('#compliance-work-order')?.value, 'JOB-2026-104');
    assert.ok(container.textContent?.includes(`Issuer: ${ctx.brands.cctv.legalIssuerName}`), 'issuer describes the currently displayed CCTV job');
  });
});

test('LAYER 4: Components — DashboardView renders KPI metrics and workflow queues', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(DashboardView))
  );
  assert.ok(html.includes('In-Progress Jobs') || html.includes('Solarcell'));
  assert.ok(html.includes('Operational Jobs') || html.includes('Website Enquiries'));
});

test('LAYER 4: Components — Navigation topbar renders brand logo and omits redundant topbar metadata', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(Navigation))
  );
  assert.ok(html.includes('Solarcell'));
  assert.ok(html.includes('cabms-topbar-logo'));
  assert.ok(!html.includes('cabms-topbar-meta'));
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
  assert.ok(html.includes('Apply Technician Preview Sign-off') || html.includes('Preview Sign-off Applied'));
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
  assert.ok(html.includes('Admin Content &amp; Template Settings') || html.includes('Template Settings'));
  assert.ok(html.includes('Required Compliance Documents by Job Type'));
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
      const button = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Generate Sample Enquiry'))!;
      await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      assert.equal(ctx.websiteEnquiries.length, previous + 1);
      assert.equal(ctx.websiteEnquiries[0].brandId, brand);
    }
  });
});

test('LAYER 4: CP-01 — distinct business switches change the header and Brisbane weekly completion count', async () => {
  await mountView(React.createElement(React.Fragment, null, React.createElement(Navigation), React.createElement(DashboardView)), async (ctx, container, window) => {
    const expected = { solarcell: 'Solarcell', smart_home: 'Smart Home', cctv: 'CCTV' };
    const opener = container.querySelector<HTMLButtonElement>('.cabms-brand-mark-btn')!;
    for (const brand of ['solarcell', 'smart_home', 'cctv'] as const) {
      if (!container.querySelector('.cabms-brand-dropdown-menu')) {
        await act(async () => { opener.click(); });
      }
      const button = container.querySelector<HTMLButtonElement>(`button[aria-label="Switch business to ${ctx.brands[brand].name}"]`)!;
      assert.ok(button.textContent?.includes(expected[brand]));
      await act(async () => { button.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
      assert.equal(ctx.activeBrandId, brand);
      assert.equal(container.querySelector('h1')?.textContent, ctx.brands[brand].name);
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

test('LAYER 4: Navigation — business switcher allows keyboard Tab navigation into options and closes when focus leaves', async () => {
  await mountView(React.createElement(Navigation), async (ctx, container, window) => {
    const trigger = container.querySelector<HTMLButtonElement>('.cabms-brand-mark-btn')!;
    assert.ok(trigger, 'Business switcher trigger button is rendered');

    // 1. Open dropdown by clicking
    await act(async () => { trigger.click(); });
    const menu = container.querySelector('#cabms-brand-dropdown-menu');
    assert.ok(menu, 'Dropdown menu opened');
    const options = Array.from(menu.querySelectorAll<HTMLButtonElement>('.cabms-brand-dropdown-option'));
    assert.equal(options.length, 3, 'All 3 business options are rendered in dropdown');

    // 2. Focus trigger and press Tab (forward): Tab should NOT close dropdown
    trigger.focus();
    assert.equal(window.document.activeElement, trigger);
    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    assert.ok(container.querySelector('#cabms-brand-dropdown-menu'), 'Dropdown remains open when Tab pressed on trigger');

    // 3. Arrow down navigates between options
    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal(window.document.activeElement, options[0], 'ArrowDown moves focus to first option');

    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal(window.document.activeElement, options[1], 'ArrowDown moves focus to second option');

    // 4. Focus last option and press Tab forward: should close dropdown
    options[2].focus();
    assert.equal(window.document.activeElement, options[2]);
    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    });
    assert.equal(container.querySelector('#cabms-brand-dropdown-menu'), null, 'Dropdown closes when Tab leaves forward from last option');

    // 5. Re-open and verify ArrowDown ignores events when focus is outside the switcher
    await act(async () => { trigger.click(); });
    assert.ok(container.querySelector('#cabms-brand-dropdown-menu'), 'Dropdown re-opened');
    window.document.body.focus();
    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert.equal(window.document.activeElement, window.document.body, 'ArrowDown does not hijack focus when activeElement is outside switcher');

    // 6. Focus option and verify Escape closes menu and restores focus to trigger
    const reloadedOptions = container.querySelectorAll<HTMLButtonElement>('.cabms-brand-dropdown-option');
    reloadedOptions[0].focus();
    await act(async () => {
      window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert.equal(container.querySelector('#cabms-brand-dropdown-menu'), null, 'Dropdown closed on Escape');
    assert.equal(window.document.activeElement, trigger, 'Focus restored to trigger button on Escape');
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
  await mountView(React.createElement(Navigation), async (ctx, container, window) => {
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

test('LAYER 4: FC-10 — ScheduleView suppresses reschedule and cancel controls for terminal jobs while allowing active visit rebooking', async () => {
  const origSetTimeout = globalThis.setTimeout;
  // Intercept notification timeout to prevent lingering background timers during test
  globalThis.setTimeout = ((fn: any) => {
    if (typeof fn === 'function') fn();
    return 0 as any;
  }) as any;

  try {
    await mountView(React.createElement(ScheduleView), async (ctx, container) => {
      // Find the card element for JOB-2026-101
      const findJobCard = () => {
        const idSpans = Array.from(container.querySelectorAll('span')).filter(s => s.textContent?.trim() === 'JOB-2026-101');
        return idSpans[0]?.closest('div.cabms-card, div.bg-slate-900') as HTMLDivElement | null;
      };

      // 1. Initial active job JOB-2026-101 displays Reschedule and Cancel Visit buttons
      const cardInitial = findJobCard();
      assert.ok(cardInitial, 'JOB-2026-101 card is rendered');
      const activeReschedule = Array.from(cardInitial.querySelectorAll('button')).find(b => b.textContent?.includes('Reschedule'));
      assert.ok(activeReschedule, 'Active scheduled job displays Reschedule button');

      // 2. Cancel visit only (job remains active): displays Re-book Visit or Reschedule Now
      await act(async () => {
        ctx.cancelJobAppointment('JOB-2026-101', 'Customer requested later time');
      });
      const cardAfterVisitCancel = findJobCard()!;
      const rebookBtn = Array.from(cardAfterVisitCancel.querySelectorAll('button')).find(b => b.textContent?.includes('Re-book Visit') || b.textContent?.includes('Reschedule Now'));
      assert.ok(rebookBtn, 'Active job with cancelled appointment displays Re-book Visit / Reschedule Now control');

      // 3. Cancel the whole job (terminal state): controls are replaced with Closed (CANCELLED) badge
      await act(async () => {
        ctx.cancelWholeJob('JOB-2026-101', 'Project completely cancelled by owner');
      });
      const cardAfterTerminal = findJobCard()!;
      const terminalBadge = Array.from(cardAfterTerminal.querySelectorAll('span')).find(s => s.textContent?.includes('Closed (CANCELLED)'));
      assert.ok(terminalBadge, 'Terminal cancelled job displays Closed (CANCELLED) badge');
      const terminalControls = Array.from(cardAfterTerminal.querySelectorAll('button')).filter(b => b.textContent?.includes('Reschedule') || b.textContent?.includes('Re-book Visit') || b.textContent?.includes('Cancel Visit'));
      assert.equal(terminalControls.length, 0, 'No reschedule or cancel controls remain on terminal job card');
    });
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }
});
test('LAYER 4: FC-01 — CommunicationsView synchronizes certificate selection across work orders and suppresses dispatch for direct-to-invoice jobs', async () => {
  await mountView(React.createElement(CommunicationsView), async (ctx, container, window) => {
    // Navigate to Certificate Delivery Previews tab
    const certTabButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      btn => btn.textContent?.includes('Certificate Delivery Previews')
    );
    assert.ok(certTabButton, 'Certificate Delivery Previews tab button exists');
    await act(async () => {
      certTabButton.click();
    });

    // 1. Initial selection: JOB-2026-101 requires ['JSA', 'SMOKE_ALARM']
    const workOrderSelect = container.querySelector<HTMLSelectElement>('#communications-work-order')!;
    assert.ok(workOrderSelect, 'Work order dropdown is rendered');

    // Find send button and verify disabled state for unsigned certificate
    const sendBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.includes('Send Certificate Email')
    );
    assert.ok(sendBtn, 'Send Certificate Email button is rendered for job with compliance requirements');
    assert.equal(sendBtn.disabled, true, 'Send button is disabled until certificate is signed');

    // Sign off JSA and verify button becomes enabled
    await act(async () => {
      ctx.signOffJsa('JOB-2026-101');
    });
    assert.equal(sendBtn.disabled, false, 'Send button becomes enabled once required certificate is signed');

    // 2. Switch to direct-to-invoice job (JOB-2026-102 which has formsRequired: [])
    await act(async () => {
      workOrderSelect.value = 'JOB-2026-102';
      workOrderSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });

    // Verify direct-to-invoice notice and dispatch suppression
    assert.ok(
      container.textContent?.includes('No compliance forms required for direct-to-invoice service.'),
      'Notice rendered for direct-to-invoice service'
    );
    const dtiSendBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.includes('Send Certificate Email')
    );
    assert.equal(dtiSendBtn, undefined, 'Send Certificate Email button is suppressed for direct-to-invoice jobs');
  });
});

test('LAYER 4: FC-14 — QuotesAcceptanceView reconciles quote expiry option copy to 14 days', async () => {
  await mountView(React.createElement(QuotesAcceptanceView), async (_ctx, container) => {
    const expiredOptions = Array.from(container.querySelectorAll<HTMLOptionElement>('option')).filter(
      opt => opt.value === 'expired'
    );
    assert.ok(expiredOptions.length > 0, 'Found simulated expiry options');
    for (const opt of expiredOptions) {
      assert.ok(
        opt.textContent?.includes('14 Days Old'),
        `Option copy "${opt.textContent}" must specify 14 Days Old`
      );
      assert.equal(
        opt.textContent?.includes('30 Days Old'),
        false,
        `Option copy "${opt.textContent}" must not state 30 Days Old`
      );
    }
  });
});

test('LAYER 4: WIN-CR-02 — Navigation topbar renders operational brand pill fallback label while preserving draft business isolation', async () => {
  await mountView(React.createElement(Navigation), async (ctx, container) => {
    // Open brand switcher dropdown
    const opener = container.querySelector<HTMLButtonElement>('.cabms-brand-mark-btn')!;
    await act(async () => { opener.click(); });

    // 1. Inspect rendered brand switcher options in dropdown
    const brandPills = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
      b => b.getAttribute('aria-label')?.startsWith('Switch business to ')
    );
    assert.ok(brandPills.length >= 3, 'Renders active operational brand pills');

    // Verify each pill has non-empty text
    for (const pill of brandPills) {
      const text = pill.textContent?.trim();
      assert.ok(text && text.length > 0, 'Brand pill button has non-empty label text');
    }

    // 2. Draft business isolation: Verify draftBusinesses do not appear in brand switcher pills
    const draftNames = ctx.draftBusinesses.map(d => d.name);
    for (const pill of brandPills) {
      const label = pill.getAttribute('aria-label') || '';
      for (const draftName of draftNames) {
        assert.equal(
          label.includes(draftName),
          false,
          `Incubating draft business "${draftName}" must not appear in operational brand switcher`
        );
      }
    }

    // 3. Fallback verification: Add an operational brand without a predefined label mapping
    await act(async () => {
      ctx.setPersona('super_admin');
      ctx.addNewBrandProfile({
        id: 'custom_av' as any,
        name: 'Brisbane Audio Visual',
        tagline: 'Custom Sound & Vision',
        primaryColor: '#3b82f6',
        accentColor: '#60a5fa',
        logoGlyph: 'AV',
        legalIssuerName: 'Brisbane Audio Visual Pty Ltd',
        abnPlaceholder: '12 345 678 999',
        electricalLicencePlaceholder: 'REC 99999',
        acmaCablerPlaceholder: 'T99999',
        qbccLicencePlaceholder: 'QBCC 99999',
        contactEmail: 'info@bav.example.invalid',
        contactPhone: '07 5555 1234',
        holidayRegion: 'brisbane',
        reviewUrlPlaceholder: 'https://g.page/r/example/review',
        calendarMappingName: 'bav_primary',
        quoteTemplateName: 'bav_quote_v1',
        invoiceTemplateName: 'bav_invoice_v1',
      });
    });

    if (!container.querySelector('.cabms-brand-dropdown-menu')) {
      await act(async () => { opener.click(); });
    }
    const customPill = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.getAttribute('aria-label') === 'Switch business to Brisbane Audio Visual'
    );
    assert.ok(customPill, 'Operational brand without predefined label renders in switcher');
    assert.equal(
      customPill.querySelector('.cabms-brand-option-name')?.textContent?.trim() || customPill.textContent?.trim(),
      'Brisbane Audio Visual',
      'Fallback renders operational brand b.name'
    );
  });
});

test('LAYER 4: FC-04 — TemplatesSettingsView and template mutations operate on isolated context state without polluting INITIAL_TEMPLATES', async () => {
  await mountView(React.createElement(TemplatesSettingsView), async (ctx, _container) => {
    const termsSeed = INITIAL_TEMPLATES.find(t => t.type === 'TERMS')!;
    const originalVersion = termsSeed.currentVersion;
    const originalRevisionsCount = termsSeed.revisions.length;
    const originalStatus = termsSeed.activeStatus;
    const originalContent = termsSeed.content;

    // Verify context initialized with matching template count and content
    const contextInitialTerms = ctx.templates.find(t => t.id === termsSeed.id);
    assert.ok(contextInitialTerms, 'Context template found for seed TERMS');
    assert.equal(contextInitialTerms.currentVersion, originalVersion);
    assert.equal(contextInitialTerms.activeStatus, originalStatus);

    // Perform template draft revision within mounted context
    const draftContent = termsSeed.content + '\nClause 99: Isolated test clause.';
    await act(async () => {
      ctx.createTemplateDraftRevision(termsSeed.id, draftContent);
    });

    const updatedTerms = ctx.templates.find(t => t.id === termsSeed.id);
    assert.ok(updatedTerms, 'Updated context template found');
    assert.equal(updatedTerms.activeStatus, 'DRAFT', 'Context template transitioned to DRAFT');
    assert.equal(updatedTerms.content, draftContent, 'Context template content updated');
    assert.equal(updatedTerms.revisions.length, originalRevisionsCount + 1, 'Context template revision added');
    assert.equal(updatedTerms.revisions[0].status, 'DRAFT', 'Top revision has status DRAFT');
    assert.equal(updatedTerms.revisions[0].version, `${originalVersion}-draft`, 'Draft revision version tagged');

    // FC-04: Verify shared seed fixture remained completely unpolluted
    assert.equal(termsSeed.currentVersion, originalVersion, 'Shared seed currentVersion unpolluted');
    assert.equal(termsSeed.activeStatus, originalStatus, 'Shared seed activeStatus unpolluted');
    assert.equal(termsSeed.content, originalContent, 'Shared seed content unpolluted');
    assert.equal(termsSeed.revisions.length, originalRevisionsCount, 'Shared seed revisions array unpolluted');
    assert.ok(!termsSeed.revisions.some((r: any) => r.version.includes('draft')), 'Shared seed has no draft revisions');
  });
});

test('LAYER 4: CR-01 — Add Customer modal always uses activeBrandId at open time, not stale mount-time brand', async () => {
  // Regression: newCustBrands was initialized once at mount and never reset.
  // If the user switches business while Customers tab stays mounted, the draft
  // would carry the old brand. Fixed in 8c287bb — this test locks that behavior.
  await mountView(React.createElement(CustomersView), async (ctx, container, window) => {
    // Initial brand at mount is 'solarcell' (context default)
    assert.equal(ctx.activeBrandId, 'solarcell', 'Initial brand is solarcell at mount');

    const initialCustomerCount = ctx.customers.length;

    // Switch business while staying on the Customers tab (component stays mounted)
    await act(async () => { ctx.setActiveBrandId('smart_home'); });
    assert.equal(ctx.activeBrandId, 'smart_home', 'Brand switched to smart_home while Customers mounted');

    // Find and click the Add Customer button — this triggers the modal open handler
    // which must now call setNewCustBrands([activeBrandId]) before opening
    const addBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
      .find(b => b.textContent?.includes('New Customer'));
    assert.ok(addBtn, 'Add Customer button is rendered');
    await act(async () => { addBtn!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });

    // Fill the mounted modal's required fields and submit through its form handler
    // rather than calling ctx.simulateCustomerWriteThrough directly, ensuring
    // that the component's internal newCustBrands state is exercised and verified.
    const nameInput = container.querySelector<HTMLInputElement>('input[placeholder="e.g. Oceanic Resort Group"]');
    assert.ok(nameInput, 'Name input rendered in Add Customer modal');
    const emailInput = container.querySelector<HTMLInputElement>('input[placeholder="accounts@example.com"]');
    assert.ok(emailInput, 'Email input rendered in Add Customer modal');

    const getReactProps = (el: Element): any => {
      const key = Object.keys(el).find(k => k.startsWith('__reactProps'));
      return key ? (el as any)[key] : null;
    };

    await act(async () => {
      getReactProps(nameInput!)?.onChange({ target: { value: 'Brand Switch Modal Test Customer' } });
      getReactProps(emailInput!)?.onChange({ target: { value: 'brandswitchmodal@example.com' } });
    });

    const form = container.querySelector<HTMLFormElement>('form');
    assert.ok(form, 'Add Customer form rendered in modal');

    const countBefore = ctx.customers.length;
    await act(async () => {
      getReactProps(form!)?.onSubmit({ preventDefault: () => {} });
    });

    // The new customer should now exist
    assert.equal(ctx.customers.length, countBefore + 1, 'One new customer was added through modal');
    const added = ctx.customers[0]; // most recent is prepended
    assert.ok(added.brandAffiliations.includes('smart_home'),
      `New customer brandAffiliations should include smart_home (switched brand), got: ${JSON.stringify(added.brandAffiliations)}`);
    assert.ok(!added.brandAffiliations.includes('solarcell'),
      'New customer should NOT carry the stale mount-time brand solarcell');

    // Verify initial customer count was not duplicated / data integrity intact
    assert.ok(ctx.customers.length === initialCustomerCount + 1, 'Total customer count increased by exactly 1');
  });
});

test('LAYER 4: Gate T — Visual Preset switcher updates context state and synchronizes data-appearance and data-branding attributes on DOM', async () => {
  await mountView(React.createElement(DemoControlsBar), async (ctx, container, window) => {
    // Initial state check: Preset 2 — Dark + Company Branding
    assert.equal(ctx.visualPreset, 'dark_company', 'Initial visual preset is dark_company');
    assert.equal(ctx.brandingMode, 'company', 'Initial branding mode is company');
    assert.equal(ctx.appearance, 'default_dark', 'Initial appearance mode is default_dark');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'default_dark', 'DOM data-appearance synced to default_dark');
    assert.equal(window.document.documentElement.getAttribute('data-branding'), 'company', 'DOM data-branding synced to company');

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Visual Preset Selector"]');
    assert.ok(select, 'Visual Preset Selector select dropdown found in DemoControlsBar');
    assert.equal(select.value, 'dark_company');

    // Switch to Preset 1 — All Dark (Neutral)
    await act(async () => {
      select.value = 'dark_neutral';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(ctx.visualPreset, 'dark_neutral');
    assert.equal(ctx.brandingMode, 'neutral');
    assert.equal(ctx.appearance, 'default_dark');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'default_dark');
    assert.equal(window.document.documentElement.getAttribute('data-branding'), 'neutral');

    // Switch to Preset 4 — Light + Company Branding
    await act(async () => {
      select.value = 'light_company';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(ctx.visualPreset, 'light_company');
    assert.equal(ctx.brandingMode, 'company');
    assert.equal(ctx.appearance, 'high_visibility_light');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_light');
    assert.equal(window.document.documentElement.getAttribute('data-branding'), 'company');

    // Switch to Preset 3 — All Light (Neutral)
    await act(async () => {
      select.value = 'light_neutral';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(ctx.visualPreset, 'light_neutral');
    assert.equal(ctx.brandingMode, 'neutral');
    assert.equal(ctx.appearance, 'high_visibility_light');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_light');
    assert.equal(window.document.documentElement.getAttribute('data-branding'), 'neutral');

    await act(async () => {
      select.value = 'high_visibility_dark';
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(ctx.visualPreset, 'high_visibility_dark');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'high_visibility_dark');

    // Reset Demo restores dark_company
    await act(async () => {
      ctx.resetDemo();
    });
    assert.equal(ctx.visualPreset, 'dark_company', 'Reset demo restores dark_company preset');
    assert.equal(ctx.brandingMode, 'company', 'Reset demo restores company branding mode');
    assert.equal(ctx.appearance, 'default_dark', 'Reset demo restores default_dark appearance');
    assert.equal(window.document.documentElement.getAttribute('data-appearance'), 'default_dark');
    assert.equal(window.document.documentElement.getAttribute('data-branding'), 'company');
  });
});

test('LAYER 4: Dashboard — clicking cross-company outstanding job switches brand, selects job, and navigates to Jobs tab', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container, window) => {
    // Active brand is solarcell
    assert.equal(ctx.activeBrandId, 'solarcell');

    // Find JOB-2026-104 (a CCTV job with status NEEDS_REVISIT) in consolidated queue
    const cctvJobEl = container.querySelector<HTMLElement>('[data-testid="consolidated-job-JOB-2026-104"]');
    assert.ok(cctvJobEl, 'CCTV job JOB-2026-104 element rendered in cross-company queue');

    await act(async () => {
      cctvJobEl.click();
    });

    assert.equal(ctx.activeBrandId, 'cctv', 'Active brand automatically switched to cctv');
    assert.equal(ctx.selectedJobId, 'JOB-2026-104', 'Selected job set to JOB-2026-104');
    assert.equal(ctx.activeTab, 'jobs', 'Active tab navigated to jobs');
  });
});

test('LAYER 4: JobsView — defaults statusFilter to open, filters completed jobs, and provides interactive compliance checklist', async () => {
  await mountView(React.createElement(JobsView), async (ctx, container, window) => {
    const statusSelect = container.querySelector<HTMLSelectElement>('select.cabms-card-subtle')!;
    assert.ok(statusSelect, 'Status filter select found');
    assert.equal(statusSelect.value, 'open', 'Status filter defaults to open');

    // Open modal to create job
    const createBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      b => b.textContent?.includes('Create New Job')
    );
    assert.ok(createBtn, 'Create New Job button found');
    await act(async () => {
      createBtn.click();
    });

    // Check mandatory vs optional checkboxes
    const jsaCheckbox = container.querySelector<HTMLInputElement>('[data-testid="form-checkbox-JSA"]');
    assert.ok(jsaCheckbox, 'JSA checkbox found');
    assert.equal(jsaCheckbox.disabled, true, 'Mandatory form checkbox is locked (disabled)');
    assert.equal(jsaCheckbox.checked, true, 'Mandatory form checkbox is checked');

    const tca1Checkbox = container.querySelector<HTMLInputElement>('[data-testid="form-checkbox-TCA1"]');
    assert.ok(tca1Checkbox, 'TCA1 optional checkbox found');
    assert.equal(tca1Checkbox.disabled, false, 'Optional form checkbox is interactive');

    // Toggle optional TCA1
    await act(async () => {
      tca1Checkbox.click();
    });
    assert.equal(tca1Checkbox.checked, true, 'Optional form is now checked');
  });
});

test('LAYER 4: JobsView — preserves newly selected or created job when status filter resets to all', async () => {
  await mountView(React.createElement(JobsView), async (ctx, container, window) => {
    const statusSelect = container.querySelector<HTMLSelectElement>('select.cabms-card-subtle')!;
    assert.ok(statusSelect, 'Status filter select found');

    // Switch status filter to COMPLETED
    await act(async () => {
      statusSelect.value = 'COMPLETED';
      statusSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(statusSelect.value, 'COMPLETED');

    // Create a new job while in COMPLETED view
    let createdJobId = '';
    await act(async () => {
      const created = ctx.createJob({
        brandId: 'solarcell',
        title: 'Preserved Job Outside Filter',
        jobType: 'Residential Solar Installation',
        siteAddress: '123 Sunshine Coast QLD',
        siteContact: 'Alice Smith',
      });
      createdJobId = created.id;
      ctx.setSelectedJobId(created.id);
    });

    // Verify filter expanded to 'all' to preserve newly created/selected job
    assert.equal(statusSelect.value, 'all', 'Filter expands to all to preserve newly selected job');
    assert.equal(ctx.selectedJobId, createdJobId, 'Newly created job remains selected in context');
  });
});

test('LAYER 4: ComplianceFormsView — Return to Job button returns operator to Jobs view with correct context', async () => {
  await mountView(React.createElement(ComplianceFormsView), async (ctx, container, window) => {
    // Set activeTab to compliance
    await act(async () => {
      ctx.setActiveTab('compliance');
    });
    assert.equal(ctx.activeTab, 'compliance');

    const returnBtn = container.querySelector<HTMLButtonElement>('[data-testid="return-to-job-btn"]');
    assert.ok(returnBtn, 'Return to Job button found in Compliance header');
    assert.ok(returnBtn.textContent?.includes('Return to Job JOB-2026-101'));

    await act(async () => {
      returnBtn.click();
    });

    assert.equal(ctx.activeTab, 'jobs', 'Active tab navigated back to jobs');
    assert.equal(ctx.selectedJobId, 'JOB-2026-101', 'Selected job retained as JOB-2026-101');
    assert.equal(ctx.activeBrandId, 'solarcell', 'Active brand matches job brand');
  });
});

test('LAYER 4: Quotes — accepting quote cancels scheduled follow-ups and records acceptance', async () => {
  await mountView(React.createElement(QuotesAcceptanceView), async (ctx, container, window) => {
    // Prepare quote for JOB-2026-101
    await act(async () => {
      ctx.prepareQuoteForJob('JOB-2026-101', 'Solar Inverter Replacement', [
        { id: '1', description: 'Solar Inverter Replacement', quantity: 1, unitPrice: 3200, total: 3200 },
      ]);
    });

    const job = ctx.jobs.find(j => j.id === 'JOB-2026-101');
    assert.ok(job?.quote, 'Quote prepared for JOB-2026-101');
    assert.equal(job.quote.acceptanceStatus, 'SENT');
    assert.ok(job.quote.followUps && job.quote.followUps.length > 0, 'Follow-ups scheduled');
    assert.ok(job.quote.followUps.some(f => f.status === 'SCHEDULED'), 'At least one follow-up scheduled');

    // Accept quote via simulateQuoteAcceptance
    await act(async () => {
      ctx.simulateQuoteAcceptance('JOB-2026-101', 'valid');
    });

    const acceptedJob = ctx.jobs.find(j => j.id === 'JOB-2026-101')!;
    assert.equal(acceptedJob.quote?.acceptanceStatus, 'ACCEPTED');
    assert.ok(acceptedJob.quote?.followUps?.every(f => f.status === 'CANCELLED'), 'All follow-ups cancelled upon quote acceptance');
  });
});

test('LAYER 4: Security — prepareQuoteForJob with nonexistent job triggers error notification and leaves state intact', async () => {
  await mountView(React.createElement(QuotesAcceptanceView), async (ctx, container, window) => {
    const initialJobs = structuredClone(ctx.jobs);

    await act(async () => {
      assert.throws(() => {
        ctx.prepareQuoteForJob('INVALID-JOB-999', 'Missing Job Title', [
          { id: '1', description: 'Missing item', quantity: 1, unitPrice: 100, total: 100 },
        ]);
      }, /not found/);
    });

    assert.equal(ctx.jobs.length, initialJobs.length, 'No new jobs added');
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification displayed for invalid job');
    assert.ok(ctx.demoNotification?.message.includes('not found'), 'Notification mentions not found');
  });
});

test('LAYER 4: Security — role mutation guards block unauthorized legal and system modifications by non-Super-Admin', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container, window) => {
    // Default persona is owner_admin
    assert.equal(ctx.persona, 'owner_admin');
    const originalLegal = ctx.brands.solarcell.legalIssuerName;

    // 1. owner_admin attempts to mutate legalIssuerName via updateBrandConfig
    await act(async () => {
      ctx.updateBrandConfig({
        ...ctx.brands.solarcell,
        legalIssuerName: 'Hacked Solarcell Legal Name Pty Ltd',
      });
    });
    assert.equal(ctx.brands.solarcell.legalIssuerName, originalLegal, 'legalIssuerName unmodified for owner_admin');
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification shown for unauthorized legal change');

    // owner_admin attempts to mutate holidayRegion
    const originalRegion = ctx.brands.solarcell.holidayRegion;
    await act(async () => {
      ctx.updateBrandConfig({
        ...ctx.brands.solarcell,
        holidayRegion: 'gold_coast',
      });
    });
    assert.equal(ctx.brands.solarcell.holidayRegion, originalRegion, 'holidayRegion unmodified for owner_admin');
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification shown for unauthorized holidayRegion change');

    // 2. owner_admin attempts to change MYOB status
    const originalMyob = ctx.myobConnection.status;
    await act(async () => {
      ctx.setMyobStatus(originalMyob === 'CONNECTED' ? 'FAILED' : 'CONNECTED');
    });
    assert.equal(ctx.myobConnection.status, originalMyob, 'MYOB status unmodified for owner_admin');
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification shown for unauthorized MYOB change');

    // 3. Switch to super_admin and verify mutation is permitted
    await act(async () => {
      ctx.simulateSignIn('super_admin');
      ctx.setMyobStatus('FAILED');
    });
    assert.equal(ctx.myobConnection.status, 'FAILED', 'MYOB status updated successfully by super_admin');

    await act(async () => {
      ctx.updateBrandConfig({
        ...ctx.brands.solarcell,
        legalIssuerName: 'Solarcell Authorised Legal Name Pty Ltd',
      });
    });
    assert.equal(ctx.brands.solarcell.legalIssuerName, 'Solarcell Authorised Legal Name Pty Ltd', 'legalIssuerName updated by super_admin');

    await act(async () => {
      ctx.updateBrandConfig({
        ...ctx.brands.solarcell,
        holidayRegion: 'gold_coast',
      });
    });
    assert.equal(ctx.brands.solarcell.holidayRegion, 'gold_coast', 'holidayRegion updated by super_admin');
  });
});
test('LAYER 4: CommunicationsView — scopes job to active brand and synchronizes active brand on cross-brand selection', async () => {
  await mountView(React.createElement(CommunicationsView), async (ctx, container, window) => {
    // Initial state: default active brand is solarcell, initial jobs include JOB-2026-101 (solarcell)
    assert.equal(ctx.activeBrandId, 'solarcell');
    const workOrderSelect = container.querySelector<HTMLSelectElement>('#communications-work-order')!;
    assert.ok(workOrderSelect, 'Work order dropdown is rendered');
    assert.equal(workOrderSelect.value, 'JOB-2026-101', 'Initial selection matches active brand');

    // 1. Switch active brand via context to smart_home
    await act(async () => {
      ctx.setActiveBrandId('smart_home');
    });
    // CommunicationsView re-scopes currentJob to first job in smart_home (JOB-2026-102)
    assert.equal(ctx.selectedJobId, 'JOB-2026-102', 'selectedJobId synchronizes to active brand job');
    assert.equal(workOrderSelect.value, 'JOB-2026-102', 'Work order select reflects new active brand job');

    // 2. Selecting a cross-brand work order in the select updates activeBrandId
    await act(async () => {
      workOrderSelect.value = 'JOB-2026-104'; // CCTV job
      workOrderSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(ctx.activeBrandId, 'cctv', 'Active brand automatically switched to match selected job');
    assert.equal(ctx.selectedJobId, 'JOB-2026-104', 'Selected job updated');
  });
});

test('LAYER 4: Quotes — prepareQuoteForJob handles 2027 cross-year follow-ups and rejects out-of-bounds calendar dates', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container, window) => {
    // Advance clock to late December 2027
    await act(async () => {
      ctx.setDemoClock('2027-12-24T09:00:00+10:00');
    });

    let lateQuote: any;
    await act(async () => {
      lateQuote = ctx.prepareQuoteForJob('JOB-2026-101', 'Late 2027 Inverter Replacement', [
        { id: 'item-1', description: 'Inverter', quantity: 1, unitPrice: 2000, total: 2000 },
      ]);
    });
    assert.ok(lateQuote, 'Quote prepared across calendar boundary');
    assert.equal(lateQuote.followUps[0].scheduledDate, '2027-12-31', 'Stage 1 @ 3 business days scheduled in 2027');
    assert.equal(lateQuote.followUps[1].scheduledDate, '2028-01-06', 'Stage 2 @ 7 business days scheduled on last business day before expiry');

    // Advance clock beyond supported calendar (2030)
    await act(async () => {
      ctx.setDemoClock('2030-01-01T09:00:00+10:00');
    });
    await act(async () => {
      assert.throws(() => {
        ctx.prepareQuoteForJob('JOB-2026-101', 'Unsupported Year Quote', [
          { id: 'item-1', description: 'Item', quantity: 1, unitPrice: 500, total: 500 },
        ]);
      }, /Cannot prepare quote/);
    });
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification displayed for out-of-bounds calendar');
  });
});

test('LAYER 4: Security — revokeQuote enforces financial_writes persona and simulateQuoteAcceptance rejects expired quotes', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container, window) => {
    // Prepare quote as owner_admin
    let quote: any;
    await act(async () => {
      quote = ctx.prepareQuoteForJob('JOB-2026-101', 'Solar Maintenance Quote', [
        { id: 'item-1', description: 'Inspection', quantity: 1, unitPrice: 300, total: 300 },
      ]);
    });
    assert.ok(quote);

    // 1. Technician cannot revoke quote
    await act(async () => {
      ctx.simulateSignIn('technician');
    });
    let revokeResult: any;
    await act(async () => {
      revokeResult = ctx.revokeQuote('JOB-2026-101');
    });
    assert.equal(revokeResult.success, false, 'Technician cannot revoke quote');
    assert.equal(ctx.demoNotification?.type, 'error', 'Error notification shown to technician');

    // 2. Advance clock past expiration date and verify customer acceptance is rejected
    await act(async () => {
      ctx.simulateSignIn('owner_admin');
      ctx.setDemoClock('2026-11-20T12:00:00+10:00'); // > 14 calendar days after Nov 2
    });
    let acceptResult: any;
    await act(async () => {
      acceptResult = ctx.simulateQuoteAcceptance('JOB-2026-101', 'valid');
    });
    assert.equal(acceptResult.success, false, 'Acceptance rejected when clock exceeds 14 days');
    assert.ok(acceptResult.message.includes('expired'), 'Message indicates link expired');
  });
});

test('LAYER 4: WorkspaceSettings — switching active workspace applies its saved visual preset', async () => {
  await mountView(React.createElement(WorkspaceSettingsView), async (ctx, container, window) => {
    assert.equal(ctx.activeBrandId, 'solarcell');
    assert.equal(ctx.visualPreset, 'dark_company');

    // 1. Configure smart_home with a different preferredPreset: light_company (using super_admin)
    await act(async () => {
      ctx.simulateSignIn('super_admin');
      ctx.updateBrandConfig({
        ...ctx.brands.smart_home,
        preferredPreset: 'light_company',
      });
      ctx.simulateSignIn('owner_admin');
    });

    // 2. Switch active workspace to smart_home
    await act(async () => {
      ctx.setActiveBrandId('smart_home');
    });
    assert.equal(ctx.activeBrandId, 'smart_home');
    assert.equal(ctx.visualPreset, 'light_company', 'smart_home saved preset applied on workspace activation');

    // 3. Switch back to solarcell
    await act(async () => {
      ctx.setActiveBrandId('solarcell');
    });
    assert.equal(ctx.activeBrandId, 'solarcell');
    assert.equal(ctx.visualPreset, 'dark_company', 'solarcell saved preset restored on workspace activation');
  });
});

test('LAYER 4: WorkspaceSettings — retains unsaved form drafts across workspace tab switches', async () => {
  await mountView(React.createElement(WorkspaceSettingsView), async (ctx, container, window) => {
    assert.equal(ctx.activeBrandId, 'solarcell');

    const phoneInput = container.querySelector('#ws-phone') as HTMLInputElement;
    const presetSelect = container.querySelector('#ws-preset') as HTMLSelectElement;
    assert.ok(phoneInput, '#ws-phone input exists');
    assert.ok(presetSelect, '#ws-preset select exists');

    // 1. Edit the phone input and visual preset for Solarcell (dirty draft)
    await act(async () => {
      const propsKey = Object.keys(phoneInput).find(k => k.startsWith('__reactProps$'));
      if (propsKey && (phoneInput as any)[propsKey]?.onChange) {
        (phoneInput as any)[propsKey].onChange({ target: { value: '(07) 5555 9999' } });
      } else {
        phoneInput.value = '(07) 5555 9999';
        phoneInput.dispatchEvent(new window.Event('input', { bubbles: true }));
      }

      presetSelect.value = 'light_neutral';
      presetSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    assert.equal(phoneInput.value, '(07) 5555 9999');
    assert.equal(presetSelect.value, 'light_neutral');

    // 2. Switch workspace to smart_home
    await act(async () => {
      ctx.setActiveBrandId('smart_home');
    });
    assert.equal(ctx.activeBrandId, 'smart_home');
    const smartHomePhone = (container.querySelector('#ws-phone') as HTMLInputElement).value;
    assert.notEqual(smartHomePhone, '(07) 5555 9999', 'Smart Home displays its own phone');

    // 3. Switch back to solarcell without saving
    await act(async () => {
      ctx.setActiveBrandId('solarcell');
    });
    assert.equal(ctx.activeBrandId, 'solarcell');
    const solarRestoredPhone = (container.querySelector('#ws-phone') as HTMLInputElement).value;
    const solarRestoredPreset = (container.querySelector('#ws-preset') as HTMLSelectElement).value;
    assert.equal(solarRestoredPhone, '(07) 5555 9999', 'Solarcell draft phone was retained across workspace tab switch');
    assert.equal(solarRestoredPreset, 'light_neutral', 'Solarcell draft preset was retained across workspace tab switch');

    // 4. Save settings
    const form = container.querySelector('form');
    assert.ok(form, 'form element exists');
    await act(async () => {
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    });

    assert.equal(ctx.brands.solarcell.contactPhone, '(07) 5555 9999', 'Saved draft committed to brand configuration');
    assert.equal(ctx.brands.solarcell.preferredPreset, 'light_neutral', 'Saved draft preset committed to brand configuration');
  });
});
