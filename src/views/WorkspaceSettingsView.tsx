/**
 * Workspace Settings View (Tab 1 of System & Workspace Settings)
 * Accessible to Admin (owner_admin) and Super Admin (super_admin).
 * Allows managing operational contacts, hours, address, and branding preferences.
 * Legal entities and technical credentials remain strictly read-only for Admins.
 */

import React, { useState, useEffect } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { BrandConfig, BrandId, VisualPreset } from '../types/cabms.ts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding,
  faPhone,
  faEnvelope,
  faLocationDot,
  faClock,
  faPalette,
  faLock,
  faCheck,
  faCircleCheck,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';

interface WorkspaceDraft {
  tagline: string;
  contactPhone: string;
  contactEmail: string;
  operationalAddress: string;
  operatingHours: string;
  preferredPreset: VisualPreset;
}

const getBrandDefaults = (brand: BrandConfig, fallbackPreset: VisualPreset): WorkspaceDraft => ({
  tagline: brand.tagline || '',
  contactPhone: brand.contactPhone || '',
  contactEmail: brand.contactEmail || '',
  operationalAddress: brand.operationalAddress || '',
  operatingHours: brand.operatingHours || '',
  preferredPreset: brand.preferredPreset || (fallbackPreset === 'high_visibility_dark' ? 'dark_company' : fallbackPreset),
});

export const WorkspaceSettingsView: React.FC = () => {
  const {
    persona,
    activeBrandId,
    setActiveBrandId,
    brands,
    updateBrandConfig,
    myobConnection,
    visualPreset,
    setVisualPreset,
  } = useCabms();

  const currentBrand = brands[activeBrandId] || brands.solarcell;

  // Retain unsaved form drafts per brand across workspace tab switches
  const [drafts, setDrafts] = useState<Record<string, WorkspaceDraft>>({});

  // Active form values fall back to current brand config if no draft exists
  const currentFormValues: WorkspaceDraft = drafts[activeBrandId] ?? getBrandDefaults(currentBrand, visualPreset);

  const updateDraftField = <K extends keyof WorkspaceDraft>(key: K, value: WorkspaceDraft[K]) => {
    setDrafts(prev => ({
      ...prev,
      [activeBrandId]: {
        ...(prev[activeBrandId] ?? getBrandDefaults(currentBrand, visualPreset)),
        [key]: value,
      },
    }));
  };

  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setSavedFeedback(false);
  }, [activeBrandId]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: BrandConfig = {
      ...currentBrand,
      tagline: currentFormValues.tagline,
      contactPhone: currentFormValues.contactPhone,
      contactEmail: currentFormValues.contactEmail,
      operationalAddress: currentFormValues.operationalAddress,
      operatingHours: currentFormValues.operatingHours,
      preferredPreset: currentFormValues.preferredPreset,
    };
    const result = updateBrandConfig(updated);
    if (result && !result.success) return;
    if (currentFormValues.preferredPreset) {
      setVisualPreset(currentFormValues.preferredPreset);
    }
    // Clear draft for this brand upon successful save
    setDrafts(prev => {
      const next = { ...prev };
      delete next[activeBrandId];
      return next;
    });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 4000);
  };

  const operationalBrandList = (['solarcell', 'smart_home', 'cctv'] as BrandId[]).map(
    id => brands[id] || { id, name: id }
  );

  return (
    <div className="space-y-6" data-testid="workspace-settings-view">
      {/* Workspace Brand Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-(--cabms-border-base)">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-(--cabms-text-primary)">
            Workspace Operational Settings
          </h2>
          <p className="text-sm text-(--cabms-text-secondary)">
            Manage contact channels, operating hours, and appearance preferences for each operating trade business.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-(--cabms-text-secondary)">
            Active Workspace:
          </span>
          <div className="flex bg-(--cabms-surface-subtle) rounded-lg p-1 border border-(--cabms-border-base)">
            {operationalBrandList.map(b => {
              const hasDraft = Boolean(drafts[b.id]);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBrandId(b.id as BrandId)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    activeBrandId === b.id
                      ? 'bg-(--cabms-surface) text-(--cabms-text-primary) shadow-sm border border-(--cabms-border-focus)'
                      : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                  }`}
                  aria-pressed={activeBrandId === b.id}
                >
                  <span>{b.name}</span>
                  {hasDraft && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-400"
                      title="Unsaved draft changes"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Read-only Integration Health Strip */}
      <div className="cabms-card p-4 bg-(--cabms-surface-subtle) border border-(--cabms-border-base) rounded-lg">
        <h3 className="text-xs font-bold uppercase tracking-wider text-(--cabms-text-secondary) mb-3">
          Integration Health Status (Read-Only)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">MYOB Business:</span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1.5 ${
                myobConnection.status === 'CONNECTED'
                  ? 'cabms-badge-completed'
                  : 'cabms-badge-danger'
              }`}
            >
              <FontAwesomeIcon
                icon={myobConnection.status === 'CONNECTED' ? faCircleCheck : faTriangleExclamation}
                className="w-3 h-3"
              />
              {myobConnection.status}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">SMTP Email Relay:</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold cabms-badge-warning flex items-center gap-1.5">
              <FontAwesomeIcon icon={faClock} className="w-3 h-3" />
              Local Configuration Mode
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">Calendar Mapping:</span>
            <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold cabms-badge-completed flex items-center gap-1.5">
              <FontAwesomeIcon icon={faCircleCheck} className="w-3 h-3" />
              SYNCED
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <form onSubmit={handleSave} className="cabms-card p-6 space-y-4">
          <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2 border-b border-(--cabms-border-base) pb-3">
            <FontAwesomeIcon icon={faBuilding} className="text-amber-500" />
            Operational Contact & Preferences
          </h3>

            {/* Tagline */}
            <div>
              <label htmlFor="ws-tagline" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                Workspace Tagline / Business Focus
              </label>
              <input
                id="ws-tagline"
                type="text"
                value={currentFormValues.tagline}
                onChange={e => updateDraftField('tagline', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="e.g. Commercial & Residential Solar Energy Systems"
              />
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ws-phone" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                  <FontAwesomeIcon icon={faPhone} className="mr-1 text-(--cabms-text-secondary)" />
                  Operational Phone
                </label>
                <input
                  id="ws-phone"
                  type="text"
                  value={currentFormValues.contactPhone}
                  onChange={e => updateDraftField('contactPhone', e.target.value)}
                  className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                  placeholder="(07) 5500 0000"
                />
              </div>
              <div>
                <label htmlFor="ws-email" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                  <FontAwesomeIcon icon={faEnvelope} className="mr-1 text-(--cabms-text-secondary)" />
                  Operational Email
                </label>
                <input
                  id="ws-email"
                  type="email"
                  value={currentFormValues.contactEmail}
                  onChange={e => updateDraftField('contactEmail', e.target.value)}
                  className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                  placeholder="operations@example.invalid"
                />
              </div>
            </div>

            {/* Address & Hours */}
            <div>
              <label htmlFor="ws-address" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faLocationDot} className="mr-1 text-(--cabms-text-secondary)" />
                Operating Facility / Dispatch Address
              </label>
              <input
                id="ws-address"
                type="text"
                value={currentFormValues.operationalAddress}
                onChange={e => updateDraftField('operationalAddress', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="12 Industry Way, Brendale QLD 4500"
              />
            </div>

            <div>
              <label htmlFor="ws-hours" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faClock} className="mr-1 text-(--cabms-text-secondary)" />
                Standard Operating Hours
              </label>
              <input
                id="ws-hours"
                type="text"
                value={currentFormValues.operatingHours}
                onChange={e => updateDraftField('operatingHours', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="Mon-Fri 7:00 AM - 5:00 PM AEST"
              />
            </div>

            {/* Preferred Visual Preset */}
            <div>
              <label htmlFor="ws-preset" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faPalette} className="mr-1 text-(--cabms-text-secondary)" />
                Preferred Workspace Visual Preset
              </label>
              <select
                id="ws-preset"
                value={currentFormValues.preferredPreset}
                onChange={e => updateDraftField('preferredPreset', e.target.value as VisualPreset)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
              >
                <option value="dark_neutral">Preset 1 — All Dark (Neutral Panels)</option>
                <option value="dark_company">Preset 2 — Dark + Company Branding (Recommended)</option>
                <option value="light_neutral">Preset 3 — All Light (Neutral Panels)</option>
                <option value="light_company">Preset 4 — Light + Company Branding</option>
              </select>
              <p className="text-[11px] text-(--cabms-text-secondary) mt-1">
                Active theme preset: <span className="font-mono">{visualPreset}</span>.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded text-sm transition-colors shadow-sm flex items-center gap-2"
              >
                <FontAwesomeIcon icon={faCheck} />
                Save Workspace Settings
              </button>
              {savedFeedback && (
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  Settings saved successfully!
                </span>
              )}
            </div>
          </form>

          {/* Legal Entity & Licences (Read-only for Admin) */}
          <div className="cabms-card p-6 bg-(--cabms-surface-subtle) border border-(--cabms-border-base) rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-(--cabms-border-base) pb-3">
              <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2">
                <FontAwesomeIcon icon={faLock} className="text-(--cabms-text-secondary)" />
                Legal Entity & Statutory Licences
              </h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {persona === 'super_admin' ? 'Super Admin Mode' : 'Admin Read-Only'}
              </span>
            </div>

            <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded text-xs text-amber-200/90 leading-relaxed">
              Legal entity names, ABN, and statutory licence registrations are governed under corporate compliance and
              can only be modified by Super Admin in the System & Integrations console.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Legal Entity Name:</span>
                <span className="font-semibold text-(--cabms-text-primary) block">{currentBrand.legalIssuerName}</span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">ABN Registration:</span>
                <span className="font-mono text-(--cabms-text-primary) block">{currentBrand.abnPlaceholder}</span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Electrical Contractor Licence:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.electricalLicencePlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">ACMA Registered Cabler:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.acmaCablerPlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">QBCC Trade Licence:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.qbccLicencePlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Regional Calendar Policy:</span>
                <span className="font-semibold text-(--cabms-text-primary) block capitalize">
                  {currentBrand.holidayRegion === 'gold_coast' ? 'Gold Coast (Show: 28 Aug)' : 'Brisbane Metro (Ekka: 12 Aug)'}
                </span>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
};
