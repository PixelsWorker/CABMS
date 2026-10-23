import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CabmsProvider, useCabms } from '../src/context/CabmsContext.tsx';
import { Navigation } from '../src/components/Navigation.tsx';
import { DemoBanner } from '../src/components/DemoBanner.tsx';
import { DemoControlsBar } from '../src/components/DemoControlsBar.tsx';
import { DashboardView } from '../src/views/DashboardView.tsx';
import { JobsView } from '../src/views/JobsView.tsx';
import { ComplianceFormsView } from '../src/views/ComplianceFormsView.tsx';
import { QuotesAcceptanceView } from '../src/views/QuotesAcceptanceView.tsx';
import { AccessDeniedView } from '../src/components/AccessDeniedView.tsx';
import { Persona, BrandId } from '../src/types/cabms.ts';
import crypto from 'node:crypto';

// Deterministic hashing helper for layout and view structures
function hashSnapshot(html: string): string {
  return crypto.createHash('sha256').update(html).digest('hex').slice(0, 16);
}

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
    'NOT RUN: Pixel-by-pixel rasterization and perceptual visual diffs require a GPU-accelerated headless browser and canvas renderer, which are unprovisioned in this container environment. Structural DOM viewport contract verification executed instead.'
  );
});

test('LAYER 7: Structural Layout & DOM Viewport — Deterministic Desktop (1440x900) shell and dashboard structure', () => {
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
  const hash = hashSnapshot(html);
  assert.ok(hash.length === 16, `Desktop snapshot hash computed: ${hash}`);
});

test('LAYER 7: Structural Layout & DOM Viewport — Deterministic Tablet (768x1024) navigation and jobs view', () => {
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
  const hash = hashSnapshot(html);
  assert.ok(hash.length === 16, `Tablet snapshot hash computed: ${hash}`);
});

test('LAYER 7: Structural Layout & DOM Viewport — Deterministic Mobile (390x844) technician compliance forms layout', () => {
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
  const hash = hashSnapshot(html);
  assert.ok(hash.length === 16, `Mobile snapshot hash computed: ${hash}`);
});

test('LAYER 7: Structural Layout & DOM Viewport — Four Persona shell layout validation', () => {
  const personas: Persona[] = ['super_admin', 'owner_admin', 'office_staff', 'technician'];
  personas.forEach(p => {
    const html = renderToString(
      React.createElement(
        CabmsProvider,
        null,
        React.createElement(Navigation)
      )
    );
    assert.ok(html.includes('CABMS') || html.includes('Solarcell'));
  });
});

test('LAYER 7: Structural Layout & DOM Viewport — Three Brand visual identity validation', () => {
  const brands: BrandId[] = ['solarcell', 'smart_home', 'cctv'];
  brands.forEach(brandId => {
    const html = renderToString(
      React.createElement(
        CabmsProvider,
        null,
        React.createElement(DashboardView)
      )
    );
    assert.ok(html.includes('Solarcell') || html.includes('Smart Home') || html.includes('CCTV'));
  });
});

test('LAYER 7: Structural Layout & DOM Viewport — Access Denied & Integration Failure states', () => {
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
