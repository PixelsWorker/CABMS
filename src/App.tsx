/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CABMS — Complete G00 Full-Application UI/UX Demo
 * Coordinates jobs, automation, and compliance across:
 * - Solarcell
 * - Gold Coast Smart Home Solutions
 * - Gold Coast CCTV
 */

import React from 'react';
import { config } from '@fortawesome/fontawesome-svg-core';
import { CabmsProvider, useCabms } from './context/CabmsContext.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { DemoControlsBar } from './components/DemoControlsBar.tsx';
import { Navigation, CORE_DESTINATIONS, canAccessDestination } from './components/Navigation.tsx';
import { DashboardView } from './views/DashboardView.tsx';
import { JobsView } from './views/JobsView.tsx';
import { ScheduleView } from './views/ScheduleView.tsx';
import { ComplianceFormsView } from './views/ComplianceFormsView.tsx';
import { CustomersView } from './views/CustomersView.tsx';
import { QuotesAcceptanceView } from './views/QuotesAcceptanceView.tsx';
import { CommunicationsView } from './views/CommunicationsView.tsx';
import { WebsiteInboxView } from './views/WebsiteInboxView.tsx';
import { TemplatesSettingsView } from './views/TemplatesSettingsView.tsx';
import { SystemWorkspaceSettingsView } from './views/SystemWorkspaceSettingsView.tsx';

import { SignInScreen } from './components/SignInScreen.tsx';
import { AccessDeniedView } from './components/AccessDeniedView.tsx';

config.autoAddCss = false;

export const AppContent: React.FC = () => {
  const { activeTab, isSimulatedSignedIn, persona, activeBrandId } = useCabms();
  const destination = CORE_DESTINATIONS.find(item => item.id === activeTab);
  const permitted = canAccessDestination(persona, activeTab);

  if (!isSimulatedSignedIn) {
    return (
      <div className="cabms-app-shell font-sans selection:bg-amber-500 selection:text-slate-950" data-company-panel={activeBrandId}>
        <DemoBanner />
        <DemoControlsBar />
        <main id="cabms-main-content" tabIndex={-1} className="cabms-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <SignInScreen />
        </main>
        <footer className="cabms-footer py-4 px-4 text-center text-xs">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              CABMS Operations Console • Solarcell • Smart Home Solutions • Gold Coast CCTV
            </span>
            <span className="font-mono text-[11px] text-(--cabms-text-secondary)">
              Sample Data · Preview Mode
            </span>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="cabms-app-shell font-sans selection:bg-amber-500 selection:text-slate-950" data-company-panel={activeBrandId}>
      {/* 1. Mandatory Persistent Demo Banner */}
      <DemoBanner />

      {/* 2. Interactive Demo Controls & Virtual Clock Bar */}
      <DemoControlsBar />

      {/* 3. Header & Navigation */}
      <Navigation>
        {/* 4. Main Application Viewport */}
        <main id="cabms-main-content" tabIndex={-1} className="cabms-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {!permitted && <AccessDeniedView resourceName={destination?.label || 'Unknown destination'} requiredRoleDescription="An authorized signed-in persona for this application area" />}
          {permitted && activeTab === 'dashboard' && <DashboardView />}
          {permitted && activeTab === 'jobs' && <JobsView />}
          {permitted && activeTab === 'schedule' && <ScheduleView />}
          {permitted && activeTab === 'compliance' && <ComplianceFormsView />}
          {permitted && activeTab === 'customers' && <CustomersView />}
          {permitted && activeTab === 'quotes' && <QuotesAcceptanceView />}
          {permitted && activeTab === 'communications' && <CommunicationsView />}
          {permitted && activeTab === 'website_inbox' && <WebsiteInboxView />}
          {permitted && activeTab === 'templates' && <TemplatesSettingsView />}
          {permitted && activeTab === 'super_admin_setup' && <SystemWorkspaceSettingsView />}
        </main>

        {/* 5. Footer with Persistent Isolation Disclosure */}
        <footer className="cabms-footer py-4 px-4 text-center text-xs">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              CABMS Operations Console • Solarcell • Smart Home Solutions • Gold Coast CCTV
            </span>
            <span className="font-mono text-[11px] text-(--cabms-text-secondary)">
              Sample Data · Preview Mode
            </span>
          </div>
        </footer>
      </Navigation>
    </div>
  );
};

export default function App() {
  return (
    <CabmsProvider>
      <AppContent />
    </CabmsProvider>
  );
}
