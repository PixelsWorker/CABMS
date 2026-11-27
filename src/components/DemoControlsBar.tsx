/**
 * Demo Controls Panel
 * Persona switcher, Scenario selector, Fixed demo business clock controls, and Reset Demo action
 */

import React from 'react';
import { formatBusinessTime } from '../utils/businessTime.ts';
import { useCabms, DemoScenario } from '../context/CabmsContext.tsx';
import { Persona, BrandId, AppearanceMode, VisualPreset } from '../types/cabms.ts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding,
  faCircleQuestion,
  faClock,
  faDiagramProject,
  faForward,
  faPalette,
  faPaperPlane,
  faRotateLeft,
  faUserCheck,
} from '@fortawesome/free-solid-svg-icons';

export const DemoControlsBar: React.FC<{operational?:boolean}> = ({operational=false}) => {
  const {
    persona,
    isSimulatedSignedIn,
    setPersona,
    activeBrandId,
    setActiveBrandId,
    brands,
    appearance,
    setAppearance,
    visualPreset,
    setVisualPreset,
    demoClock,
    advanceClock,
    resetDemo,
    activeScenario,
    setActiveScenario,
    pendingReviewCount,
    resolveAllPendingReviews,
  } = useCabms();

  const [controlsOpen, setControlsOpen] = React.useState(() =>
    typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia('(min-width: 1024px)').matches
  );
  React.useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1024px)');
    const onResize = () => { if (media) setControlsOpen(media.matches); };
    media?.addEventListener('change', onResize);
    return () => media?.removeEventListener('change', onResize);
  }, []);

  const formattedDate = formatBusinessTime(demoClock);

  return (
    <details className="cabms-demo-controls" open={controlsOpen} onToggle={event => setControlsOpen(event.currentTarget.open)}>
      <summary>{operational?'Workspace & appearance':'Workspace Simulator & Persona Switcher'}</summary>
    <div className="cabms-surface text-(--cabms-text-primary) border-b cabms-border px-3 py-2 text-xs md:text-sm">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left Section: Persona & Brand */}
        <div className="flex min-w-0 w-full flex-wrap items-center gap-3 sm:w-auto">
          {/* Persona Selector */}
          <div className="cabms-control-select flex items-center gap-1.5 cabms-surface-subtle px-2 py-1 rounded border cabms-border">
            <FontAwesomeIcon icon={faUserCheck} className="w-3.5 h-3.5 cabms-accent-info" />
            <span className="text-(--cabms-text-secondary) text-xs hidden sm:inline">Persona:</span>
            <select
              disabled={operational} title={operational?'Your role is assigned by your workspace administrator.':undefined}
              value={persona}
              onChange={e => setPersona(e.target.value as Persona)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-(--cabms-text-primary) font-medium text-xs cursor-pointer"
              aria-label="Demo Persona Selector"
            >
              <option value="super_admin" className="cabms-surface text-(--cabms-text-primary)">Super Admin</option>
              <option value="owner_admin" className="cabms-surface text-(--cabms-text-primary)">Admin</option>
              <option value="office_staff" className="cabms-surface text-(--cabms-text-primary)">Office Staff</option>
              <option value="technician" className="cabms-surface text-(--cabms-text-primary)">Technician (Dave M.)</option>
            </select>
          </div>

          {/* Active Brand Switcher */}
          <div className="cabms-control-select flex items-center gap-1.5 cabms-surface-subtle px-2 py-1 rounded border cabms-border">
            <FontAwesomeIcon icon={faBuilding} className="w-3.5 h-3.5 cabms-brand-accent-text" />
            <span className="text-(--cabms-text-secondary) text-xs hidden sm:inline">Workspace:</span>
            <select
              value={activeBrandId ?? ''}
              onChange={e => setActiveBrandId(e.target.value as BrandId)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-(--cabms-text-primary) font-medium text-xs cursor-pointer"
              aria-label="Active Brand Workspace Selector"
            >
              {!activeBrandId && <option value="">No authorized workspace</option>}
              {(operational?Object.keys(brands) as BrandId[]:['solarcell', 'smart_home', 'cctv'] as BrandId[]).map(id => {
                const b = brands[id];
                return (
                  <option key={id} value={id} className="cabms-surface text-(--cabms-text-primary)">
                    {b?.name || id}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Named Scenario Selector */}
          {!operational&&<div className="cabms-control-select flex items-center gap-1.5 cabms-surface-subtle px-2 py-1 rounded border cabms-border">
            <FontAwesomeIcon icon={faDiagramProject} className="w-3.5 h-3.5 cabms-accent-success" />
            <span className="text-(--cabms-text-secondary) text-xs hidden sm:inline">Scenario:</span>
            <select
              value={activeScenario}
              onChange={e => setActiveScenario(e.target.value as DemoScenario)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-(--cabms-text-primary) font-medium text-xs cursor-pointer"
              aria-label="Named Scenario Preset Selector"
            >
              <option value="default" className="cabms-surface text-(--cabms-text-primary)">1. Default Seed (Connected Flow)</option>
              <option value="doc_missing_signoff" className="cabms-surface text-(--cabms-text-primary)">2. Documentation (JSA Missing Sign-off)</option>
              <option value="direct_to_invoice" className="cabms-surface text-(--cabms-text-primary)">3. Direct-to-Invoice (No Forms)</option>
              <option value="cabling_revisit" className="cabms-surface text-(--cabms-text-primary)">4. Cabling Revisit (TCA1/TCA2 Defect)</option>
              <option value="unassigned_denied" className="cabms-surface text-(--cabms-text-primary)">5. Tech Denied Access (Unassigned)</option>
              <option value="myob_failed" className="cabms-surface text-(--cabms-text-primary)">6. MYOB Write-Through Failure</option>
            </select>
          </div>}
          {/* Visual Preset Selector */}
          <div className="cabms-control-select flex items-center gap-1.5 cabms-surface-subtle px-2 py-1 rounded border cabms-border">
            <FontAwesomeIcon icon={faPalette} className="w-3.5 h-3.5 cabms-accent-purple" />
            <span className="text-(--cabms-text-secondary) text-xs hidden sm:inline">Theme:</span>
            <select
              value={visualPreset}
              onChange={e => setVisualPreset(e.target.value as VisualPreset)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-(--cabms-text-primary) font-medium text-xs cursor-pointer"
              aria-label="Visual Preset Selector"
            >
              <option value="dark_company" className="cabms-surface text-(--cabms-text-primary)">Preset 2 — Dark + Company</option>
              <option value="dark_neutral" className="cabms-surface text-(--cabms-text-primary)">Preset 1 — All Dark</option>
              <option value="light_company" className="cabms-surface text-(--cabms-text-primary)">Preset 4 — Light + Company</option>
              <option value="light_neutral" className="cabms-surface text-(--cabms-text-primary)">Preset 3 — All Light</option>
              <option value="high_visibility_dark" className="cabms-surface text-(--cabms-text-primary)">High Visibility Dark</option>
            </select>
          </div>
        </div>

        {/* Right Section: Virtual Clock & Reset */}
        {!operational&&<div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {/* Fictional Business Clock */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 cabms-surface-subtle px-2 py-1 rounded border cabms-border text-xs">
            <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5 cabms-accent-warning" />
            <span className="cabms-clock min-w-0 text-(--cabms-text-secondary) font-mono tracking-tight">{formattedDate}</span>
            <div className="flex items-center ml-1 space-x-0.5 border-l cabms-border pl-1">
              <button
                onClick={() => advanceClock(1)}
                title="Advance virtual business clock by 1 hour"
                className="hover:opacity-80 px-1.5 py-0.5 rounded text-[10px] cabms-accent-info flex items-center transition cursor-pointer"
              >
                +1h
              </button>
              <button
                onClick={() => advanceClock(24)}
                title="Advance virtual business clock by 1 day"
                className="hover:opacity-80 px-1.5 py-0.5 rounded text-[10px] cabms-accent-info flex items-center transition cursor-pointer"
              >
                +1d
              </button>
            </div>
          </div>

          {/* Dispatch Pending Reviews Action */}
          {isSimulatedSignedIn && persona !== 'technician' && pendingReviewCount > 0 && (
            <button
              onClick={() => resolveAllPendingReviews()}
              className="flex items-center space-x-1.5 cabms-btn-primary px-2.5 py-1 rounded text-xs font-bold transition shadow-sm cursor-pointer animate-pulse"
              title="Dispatch and resolve all pending customer review requests"
            >
              <FontAwesomeIcon icon={faPaperPlane} className="w-3.5 h-3.5" />
              <span>Dispatch Review ({pendingReviewCount} Pending)</span>
            </button>
          )}

          {/* Reset Demo */}
          <button
            onClick={resetDemo}
            className="flex items-center space-x-1 cabms-badge-danger px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer"
            title="Reset all sample records, pending drafts, versions and virtual clock"
          >
            <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Preview State</span>
          </button>
        </div>}
      </div>
    </div>
    </details>
  );
};
