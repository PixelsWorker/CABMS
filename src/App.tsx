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
import { G01SessionProvider, useG01Session } from './context/G01Session.tsx';
import { config } from '@fortawesome/fontawesome-svg-core';
import { CabmsProvider, useCabms } from './context/CabmsContext.tsx';
import { DemoBanner } from './components/DemoBanner.tsx';
import { DemoControlsBar } from './components/DemoControlsBar.tsx';
import { Navigation, CORE_DESTINATIONS, canAccessDestination } from './components/Navigation.tsx';
import { AuthenticatedCompliance } from './views/AuthenticatedCompliance.tsx';
import { DashboardView } from './views/DashboardView.tsx';
import { JobsView } from './views/JobsView.tsx';
import { ScheduleView } from './views/ScheduleView.tsx';
import { ComplianceFormsView } from './views/ComplianceFormsView.tsx';
import { CustomersView } from './views/CustomersView.tsx';
import { QuotesAcceptanceView } from './views/QuotesAcceptanceView.tsx';
import { CommunicationsView } from './views/CommunicationsView.tsx';
import { WebsiteInboxView } from './views/WebsiteInboxView.tsx';
import { EnquiriesView } from './views/EnquiriesView.tsx';
import { TemplatesSettingsView } from './views/TemplatesSettingsView.tsx';
import { SystemWorkspaceSettingsView } from './views/SystemWorkspaceSettingsView.tsx';

import { SignInScreen } from './components/SignInScreen.tsx';
import { AccessDeniedView } from './components/AccessDeniedView.tsx';

config.autoAddCss = false;

export const AppContent: React.FC = () => {
  const session = useG01Session();
  const [calendarJob,setCalendarJob]=React.useState<{id:string;workspace_id:string}>();
  const prevUserIdRef = React.useRef<string | null>(session?.profile?.user.id ?? null);
  React.useEffect(() => {
    const nextId = session?.profile?.user.id ?? null;
    if (prevUserIdRef.current !== nextId) {
      prevUserIdRef.current = nextId;
      setCalendarJob(undefined);
    }
  }, [session?.profile?.user.id]);
  const { activeTab, isSimulatedSignedIn, persona, activeBrandId,setActiveTab } = useCabms();
  const operational = !!session?.profile;
  const isLiveOperationalTab = operational && ['dashboard','jobs','compliance','schedule','templates','super_admin_setup'].includes(activeTab);
  const destination = CORE_DESTINATIONS.find(item => item.id === activeTab);
  const permitted = canAccessDestination(persona, activeTab);

  if (session ? session.loading || !session.profile : !isSimulatedSignedIn) {
    return (
      <div className="cabms-app-shell font-sans selection:bg-(--cabms-brand-primary) selection:text-(--cabms-brand-text)" data-company-panel={activeBrandId}>
        {!session && <DemoBanner />}
        {!session && <DemoControlsBar />}
        <main id="cabms-main-content" tabIndex={-1} className="cabms-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <SignInScreen />
        </main>
        <footer className="cabms-footer py-4 px-4 text-center text-xs">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              CABMS Operations Console • Solarcell • Smart Home Solutions • Gold Coast CCTV
            </span>
            {!session && (
              <span className="font-mono text-[11px] text-(--cabms-text-secondary)">
                Sample Data · Preview Mode
              </span>
            )}
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="cabms-app-shell font-sans selection:bg-(--cabms-brand-primary) selection:text-(--cabms-brand-text)" data-company-panel={activeBrandId}>
      <DemoBanner operational={isLiveOperationalTab}/>
      {session?.error && <p role="alert" className="cabms-card p-3">{session.error}</p>}

      {/* 2. Interactive Demo Controls & Virtual Clock Bar */}
      <DemoControlsBar operational={operational}/>

      {/* 3. Header & Navigation */}
      <Navigation showSavedDemoEnquiries={!operational}>
        {/* 4. Main Application Viewport */}
        <main id="cabms-main-content" tabIndex={-1} className="cabms-main flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {!permitted && <AccessDeniedView resourceName={destination?.label || 'Unknown destination'} requiredRoleDescription="An authorized signed-in persona for this application area" />}
          {session && permitted && (activeTab==='dashboard'||activeTab==='jobs'||activeTab==='compliance') && <AuthenticatedCompliance screen={activeTab} initialJob={activeTab==='jobs'&&calendarJob?.workspace_id===activeBrandId?calendarJob:undefined}/>}
          {!session && permitted && activeTab === 'dashboard' && <DashboardView />}
          {!session && permitted && activeTab === 'jobs' && <JobsView />}
          {permitted && activeTab === 'schedule' && <ScheduleView onJob={job=>{setCalendarJob(job);setActiveTab('jobs');}} />}
          {!session && permitted && activeTab === 'compliance' && <ComplianceFormsView />}
          {permitted && activeTab === 'customers' && <CustomersView />}
          {permitted && activeTab === 'quotes' && <QuotesAcceptanceView />}
          {permitted && activeTab === 'communications' && <CommunicationsView />}
          {permitted && activeTab === 'website_inbox' && (session ? <EnquiriesView /> : <WebsiteInboxView />)}
          {permitted && activeTab === 'templates' && <TemplatesSettingsView />}
          {session ? canAccessDestination(persona, 'super_admin_setup') && <div hidden={activeTab !== 'super_admin_setup'}><SystemWorkspaceSettingsView /></div> : permitted && activeTab === 'super_admin_setup' && <SystemWorkspaceSettingsView />}
        </main>

        {/* 5. Footer with Persistent Isolation Disclosure */}
        <footer className="cabms-footer py-4 px-4 text-center text-xs">
          <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
            <span>
              CABMS Operations Console • Solarcell • Smart Home Solutions • Gold Coast CCTV
            </span>
            <span className="font-mono text-[11px] text-(--cabms-text-secondary)">
              {operational?'Authenticated workspace':'Sample Data · Preview Mode'}
            </span>
          </div>
        </footer>
      </Navigation>
    </div>
  );
};

export default function App({ demoMode = false }: { demoMode?: boolean }) {
  const content = (
    <CabmsProvider>
      <AppContent />
    </CabmsProvider>
  );
  return demoMode ? content : <G01SessionProvider>{content}</G01SessionProvider>;
}
