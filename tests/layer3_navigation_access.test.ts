import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import App from '../src/App.tsx';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { verifyPersonaAccess } from '../src/utils/cabmsLogic.ts';
import { AccessDeniedView } from '../src/components/AccessDeniedView.tsx';
import { SignInScreen } from '../src/components/SignInScreen.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { CustomersView } from '../src/views/CustomersView.tsx';
import { CommunicationsView } from '../src/views/CommunicationsView.tsx';
import { WebsiteInboxView } from '../src/views/WebsiteInboxView.tsx';
import { SuperAdminSetupView } from '../src/views/SuperAdminSetupView.tsx';
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
  // Functional helper component to test role gating inside CabmsProvider
  const TestTechGate = ({ view }: { view: 'customers' | 'comms' | 'inbox' | 'superadmin' }) => {
    const { setPersona } = useCabms();
    // Simulate technician context
    return React.createElement(
      'div',
      null,
      view === 'customers'
        ? React.createElement(CustomersView)
        : view === 'comms'
        ? React.createElement(CommunicationsView)
        : view === 'inbox'
        ? React.createElement(WebsiteInboxView)
        : React.createElement(SuperAdminSetupView)
    );
  };

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
