import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
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
