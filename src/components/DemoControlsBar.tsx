/**
 * Demo Controls Panel
 * Persona switcher, Scenario selector, Fixed demo business clock controls, and Reset Demo action
 */

import React from 'react';
import { formatBusinessTime } from '../utils/businessTime.ts';
import { useCabms, DemoScenario } from '../context/CabmsContext.tsx';
import { Persona, BrandId, AppearanceMode } from '../types/cabms.ts';
import {
  Clock,
  RotateCcw,
  UserCheck,
  Building2,
  Workflow,
  FastForward,
  HelpCircle,
  Send,
  Palette,
} from 'lucide-react';

export const DemoControlsBar: React.FC = () => {
  const {
    persona,
    isSimulatedSignedIn,
    setPersona,
    activeBrandId,
    setActiveBrandId,
    brands,
    appearance,
    setAppearance,
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
      <summary>Demo controls · persona, workspace, scenario and business clock</summary>
    <div className="bg-slate-900 text-slate-100 border-b border-slate-800 px-3 py-2 text-xs md:text-sm">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
        {/* Left Section: Persona & Brand */}
        <div className="flex min-w-0 w-full flex-wrap items-center gap-3 sm:w-auto">
          {/* Persona Selector */}
          <div className="cabms-control-select flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700">
            <UserCheck className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-slate-400 text-xs hidden sm:inline">Persona:</span>
            <select
              value={persona}
              onChange={e => setPersona(e.target.value as Persona)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-white font-medium text-xs cursor-pointer"
              aria-label="Demo Persona Selector"
            >
              <option value="super_admin" className="bg-slate-900 text-white">Super Admin</option>
              <option value="owner_admin" className="bg-slate-900 text-white">Admin</option>
              <option value="office_staff" className="bg-slate-900 text-white">Office Staff</option>
              <option value="technician" className="bg-slate-900 text-white">Technician (Dave M.)</option>
            </select>
          </div>

          {/* Active Brand Switcher */}
          <div className="cabms-control-select flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700">
            <Building2 className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 text-xs hidden sm:inline">Workspace:</span>
            <select
              value={activeBrandId}
              onChange={e => setActiveBrandId(e.target.value as BrandId)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-white font-medium text-xs cursor-pointer"
              aria-label="Active Brand Workspace Selector"
            >
              {(['solarcell', 'smart_home', 'cctv'] as BrandId[]).map(id => {
                const b = brands[id];
                return (
                  <option key={id} value={id} className="bg-slate-900 text-white">
                    {b?.name || id}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Named Scenario Selector */}
          <div className="cabms-control-select flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700">
            <Workflow className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400 text-xs hidden sm:inline">Scenario:</span>
            <select
              value={activeScenario}
              onChange={e => setActiveScenario(e.target.value as DemoScenario)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-white font-medium text-xs cursor-pointer"
              aria-label="Named Scenario Preset Selector"
            >
              <option value="default" className="bg-slate-900 text-white">1. Default Seed (Connected Flow)</option>
              <option value="doc_missing_signoff" className="bg-slate-900 text-white">2. Documentation (JSA Missing Sign-off)</option>
              <option value="direct_to_invoice" className="bg-slate-900 text-white">3. Direct-to-Invoice (No Forms)</option>
              <option value="cabling_revisit" className="bg-slate-900 text-white">4. Cabling Revisit (TCA1/TCA2 Defect)</option>
              <option value="unassigned_denied" className="bg-slate-900 text-white">5. Tech Denied Access (Unassigned)</option>
              <option value="myob_failed" className="bg-slate-900 text-white">6. MYOB Write-Through Failure</option>
            </select>
          </div>

          {/* Appearance Mode Selector */}
          <div className="cabms-control-select flex items-center gap-1.5 bg-slate-800 px-2 py-1 rounded border border-slate-700">
            <Palette className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-slate-400 text-xs hidden sm:inline">Theme:</span>
            <select
              value={appearance}
              onChange={e => setAppearance(e.target.value as AppearanceMode)}
              className="min-w-0 max-w-full flex-1 bg-transparent text-white font-medium text-xs cursor-pointer"
              aria-label="Appearance Mode Selector"
            >
              <option value="default_dark" className="bg-slate-900 text-white">Default Dark</option>
              <option value="high_visibility_light" className="bg-slate-900 text-white">High Visibility Light</option>
              <option value="high_visibility_dark" className="bg-slate-900 text-white">High Visibility Dark</option>
            </select>
          </div>
        </div>

        {/* Right Section: Virtual Clock & Reset */}
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          {/* Fictional Business Clock */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 bg-slate-800/80 px-2 py-1 rounded border border-slate-700/80 text-xs">
            <Clock className="w-3.5 h-3.5 text-amber-300" />
            <span className="cabms-clock min-w-0 text-slate-300 font-mono tracking-tight">{formattedDate}</span>
            <div className="flex items-center ml-1 space-x-0.5 border-l border-slate-700 pl-1">
              <button
                onClick={() => advanceClock(1)}
                title="Advance virtual business clock by 1 hour"
                className="hover:bg-slate-700 px-1.5 py-0.5 rounded text-[10px] text-sky-300 flex items-center transition"
              >
                +1h
              </button>
              <button
                onClick={() => advanceClock(24)}
                title="Advance virtual business clock by 1 day"
                className="hover:bg-slate-700 px-1.5 py-0.5 rounded text-[10px] text-sky-300 flex items-center transition"
              >
                +1d
              </button>
            </div>
          </div>

          {/* Dispatch Pending Reviews Action */}
          {isSimulatedSignedIn && persona !== 'technician' && pendingReviewCount > 0 && (
            <button
              onClick={() => resolveAllPendingReviews()}
              className="flex items-center space-x-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 px-2.5 py-1 rounded text-xs font-bold transition shadow-sm cursor-pointer animate-pulse"
              title="Dispatch and resolve all pending customer review requests"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Dispatch Review ({pendingReviewCount} Pending)</span>
            </button>
          )}

          {/* Reset Demo */}
          <button
            onClick={resetDemo}
            className="flex items-center space-x-1 bg-red-950/60 hover:bg-red-900/80 text-red-200 border border-red-800/60 px-2.5 py-1 rounded text-xs font-medium transition cursor-pointer"
            title="Reset all seed records, pending drafts, versions and virtual clock"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset Demo</span>
          </button>
        </div>
      </div>
    </div>
    </details>
  );
};
