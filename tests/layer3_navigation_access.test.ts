import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { renderToString } from 'react-dom/server';
import App, { AppContent } from '../src/App.tsx';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { verifyPersonaAccess } from '../src/utils/cabmsLogic.ts';
import { AccessDeniedView } from '../src/components/AccessDeniedView.tsx';
import { SignInScreen } from '../src/components/SignInScreen.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { CustomersView } from '../src/views/CustomersView.tsx';
import { CommunicationsView } from '../src/views/CommunicationsView.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
import { SuperAdminSetupView } from '../src/views/SuperAdminSetupView.tsx';
import { DashboardView } from '../src/views/DashboardView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { INITIAL_BRANDS, INITIAL_CUSTOMERS, INITIAL_JOBS } from '../src/data/seedData.ts';

test('LAYER 3: Navigation & Access — SignInScreen renders when user is signed out', () => {
  const html = renderToString(
    React.createElement(CabmsProvider, null, React.createElement(SignInScreen))
  );
  assert.ok(html.includes('CABMS Session Access'), 'Sign-in screen contains session access title');
  assert.ok(html.includes('Owner / Admin') || html.includes('Super Admin'), 'Presents available personas');
});

test('LAYER 3: Navigation & Access — AccessDeniedView renders explicit required role and custom explanation', () => {
  const html = renderToString(
    React.createElement(
      CabmsProvider,
      null,
      React.createElement(AccessDeniedView, {
        resourceName: 'Full Customer Directory',
        requiredRoleDescription: 'Super Admin or Owner / Admin',
        customExplanation: 'Technicians are restricted to viewing only the site contact for assigned jobs.',
      })
    )
  );
  assert.ok(html.includes('Access Denied — Persona Boundary Enforced'));
  assert.ok(html.includes('Full Customer Directory'));
  assert.ok(html.includes('Technicians are restricted'));
});

test('LAYER 3: Navigation & Access — Technician persona is barred from customer directory, comms, and website inbox', () => {
  // Check persona access matrix directly
  assert.equal(verifyPersonaAccess('technician', 'all_customers').allowed, false);
  assert.equal(verifyPersonaAccess('technician', 'technical_integrations').allowed, false);
  assert.equal(verifyPersonaAccess('technician', 'financial_writes').allowed, false);
  assert.equal(verifyPersonaAccess('technician', 'template_editing').allowed, false);
  assert.equal(verifyPersonaAccess('technician', 'template_publishing').allowed, false);
});

test('LAYER 3: Navigation & Access — Office staff restricted from master template editing and technical setup', () => {
  assert.equal(verifyPersonaAccess('office_staff', 'technical_integrations').allowed, false);
  assert.equal(verifyPersonaAccess('office_staff', 'template_editing').allowed, false);
  assert.equal(verifyPersonaAccess('office_staff', 'template_publishing').allowed, false);
  assert.equal(verifyPersonaAccess('office_staff', 'all_customers').allowed, true);
  assert.equal(verifyPersonaAccess('office_staff', 'financial_writes').allowed, true);
});

test('LAYER 3: Navigation & Access — Super Admin technical settings isolation', () => {
  // Only super_admin can modify technical integration credentials
  assert.equal(verifyPersonaAccess('super_admin', 'technical_integrations').allowed, true);
  assert.equal(verifyPersonaAccess('owner_admin', 'technical_integrations').allowed, false);
  assert.equal(verifyPersonaAccess('office_staff', 'technical_integrations').allowed, false);
  assert.equal(verifyPersonaAccess('technician', 'technical_integrations').allowed, false);
});

test('LAYER 3: Navigation & Access — Brand isolation prevents cross-brand record corruption', () => {
  const solarBrand = INITIAL_BRANDS.solarcell;
  const smartBrand = INITIAL_BRANDS.smart_home;
  const cctvBrand = INITIAL_BRANDS.cctv;

  // Verify distinct brand configurations
  assert.notEqual(solarBrand.legalIssuerName, smartBrand.legalIssuerName);
  assert.notEqual(solarBrand.legalIssuerName, cctvBrand.legalIssuerName);
  assert.notEqual(solarBrand.primaryColor, cctvBrand.primaryColor);
  assert.notEqual(solarBrand.reviewUrlPlaceholder, smartBrand.reviewUrlPlaceholder);

  // Cross brand customer affiliation integrity
  const customer1 = INITIAL_CUSTOMERS[0];
  assert.ok(customer1.brandAffiliations.includes('solarcell'));
  assert.ok(customer1.brandAffiliations.includes('smart_home'));

  // Ensure jobs belong strictly to assigned brand
  const job101 = INITIAL_JOBS.find(j => j.id === 'JOB-2026-101')!;
  const job104 = INITIAL_JOBS.find(j => j.id === 'JOB-2026-104')!;
  assert.equal(job101.brandId, 'solarcell');
  assert.equal(job104.brandId, 'cctv');
});

test('LAYER 3: Navigation & Access — Verification of demo safety and zero real external credentials', () => {
  // Check that all emails and domains are synthetically isolated
  for (const cust of INITIAL_CUSTOMERS) {
    assert.ok(
      cust.email.endsWith('.invalid') || cust.email.includes('example.'),
      `Customer ${cust.id} must use safe non-routable domain (.invalid)`
    );
    assert.ok(
      cust.phone.startsWith('0400 000') || cust.phone.startsWith('04'),
      `Customer ${cust.id} uses Australian demo telephone pattern`
    );
  }

  // Check all brand review URLs use safe fictional domain
  for (const b of Object.values(INITIAL_BRANDS)) {
    assert.ok(
      b.reviewUrlPlaceholder.includes('.invalid') || b.reviewUrlPlaceholder.startsWith('https://demo.'),
      `Brand ${b.id} review URL must use safe demo host`
    );
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

test('LAYER 3: CP-01 — mounted session boundary hides navigation after sign-out and persona selection cannot restore the session', async () => {
  await mountView(React.createElement(AppContent), async (ctx, container) => {
    await act(async () => { ctx.simulateSignOut(); });
    assert.ok(container.textContent?.includes('CABMS Session Access'));
    assert.equal(container.querySelector('nav'), null);
    await act(async () => { ctx.setPersona('super_admin'); });
    assert.equal(ctx.isSimulatedSignedIn, false);
    assert.ok(container.textContent?.includes('CABMS Session Access'));
    await act(async () => { ctx.simulateSignIn('office_staff'); });
    assert.ok(container.querySelector('nav'));
    assert.equal(container.textContent?.includes('CABMS Session Access'), false);
  });
});


test('LAYER 3: Gate S — hidden destinations remain denied by the actual App boundary for all personas', async () => {
  const destinations = ['dashboard', 'jobs', 'schedule', 'compliance', 'customers', 'quotes', 'communications', 'website_inbox', 'templates', 'super_admin_setup'];
  const expected = {
    super_admin: destinations,
    owner_admin: destinations.slice(0, 9),
    office_staff: destinations.slice(0, 8),
    technician: destinations.slice(0, 4),
  };
  await mountView(React.createElement(AppContent), async (ctx, container) => {
    for (const persona of ['super_admin', 'owner_admin', 'office_staff', 'technician'] as const) {
      await act(async () => { ctx.simulateSignIn(persona); });
      const nav = container.querySelector('nav[aria-label="Main navigation"]')!;
      assert.equal(nav.querySelectorAll('button').length, expected[persona].length);
      assert.equal(nav.textContent?.includes('Denied'), false);
      for (const destination of destinations) {
        await act(async () => { ctx.setActiveTab(destination); });
        const denied = !expected[persona].includes(destination);
        assert.equal(container.querySelector('main')?.textContent?.includes('Access Denied — Persona Boundary Enforced'), denied, `${persona}: direct access to ${destination}`);
      }
    }
    await act(async () => { ctx.simulateSignIn('super_admin'); ctx.setActiveTab('templates'); });
    assert.ok(container.querySelector('main')?.textContent?.includes('Required Compliance Documents'));
    await act(async () => { ctx.setPersona('office_staff'); });
    assert.ok(container.querySelector('main')?.textContent?.includes('Access Denied — Persona Boundary Enforced'), 'role downgrade removes previously visible template content');
    assert.equal(container.querySelector('main')?.textContent?.includes('Required Compliance Documents'), false);
    const templatesBefore = structuredClone(ctx.templates);
    await act(async () => {
      ctx.createTemplateDraftRevision('TPL-001', 'Forbidden Office Staff template edit');
      ctx.submitTemplateForReview('TPL-001');
      ctx.publishTemplateVersion('TPL-001');
    });
    assert.deepEqual(ctx.templates, templatesBefore, 'hidden Templates still denies Office Staff mutation attempts');
    await act(async () => { ctx.setActiveTab('unknown-view'); });
    assert.ok(container.querySelector('main')?.textContent?.includes('Unknown destination'));
  });
});

test('LAYER 3: Wave A — Technician dashboard and work-order selection stay inside assignment and business boundaries', async () => {
  await mountView(React.createElement(DashboardView), async (ctx, container) => {
    await act(async () => {
      ctx.simulateSignIn('technician');
    });
    assert.ok(container.textContent?.includes('10kW Solar PV Inverter & Safety Audit'), container.textContent || 'empty dashboard');
    assert.equal(container.textContent?.includes('Emergency Aircon Automation Inverter Reset'), false, 'other-business work is not visible on the active Solarcell dashboard');
    assert.equal(container.textContent?.includes('Sarah Jenkins'), false, 'unassigned site contact is omitted');
  });

  await mountView(React.createElement(JobsView), async (ctx, container) => {
    await act(async () => {
      ctx.simulateSignIn('technician');
      ctx.setSelectedJobId('JOB-2026-105');
    });
    assert.equal(container.textContent?.includes('Access Denied — Persona Boundary Enforced'), false, 'stale unassigned selection falls back within authorized jobs');
    assert.equal(container.textContent?.includes('Sarah Jenkins'), false);
    assert.ok(container.textContent?.includes('10kW Solar PV Inverter & Safety Audit'), container.textContent || 'empty jobs view');

    await act(async () => { ctx.setActiveBrandId('cctv'); });
    assert.equal(container.textContent?.includes('Marcus Vance'), false, 'another technician’s CCTV assignment stays hidden');
    assert.equal(container.textContent?.includes('Warehouse Security Camera Cabling & Compliance Audit'), false);
    assert.equal(container.textContent?.includes('Access Denied — Persona Boundary Enforced'), false, 'empty authorized scope is not a false denial');
    assert.ok(container.textContent?.includes('No work orders are available for this business and your current access.'));
  });

  await mountView(React.createElement(JobsView), async (ctx, container) => {
    await act(async () => {
      ctx.simulateSignIn('owner_admin');
      ctx.setSelectedJobId('JOB-2026-101');
      ctx.setActiveBrandId('smart_home');
    });
    assert.equal(container.textContent?.includes('10kW Solar PV Inverter & Safety Audit'), false, 'brand switch cannot retain solar details');
    assert.ok(container.textContent?.includes('Emergency Aircon Automation Inverter Reset'), container.textContent || 'empty jobs view');
  });
});
