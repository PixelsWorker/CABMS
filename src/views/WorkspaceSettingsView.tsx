/**
 * Workspace Settings View (Tab 1 of System & Workspace Settings)
 * Accessible to Admin (owner_admin) and Super Admin (super_admin).
 * Allows managing operational contacts, hours, address, branding preferences,
 * and previewing official SVG branding and document presentations.
 * Legal entities and technical credentials remain strictly read-only for Admins.
 */

import React, { useState, useEffect } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { BrandConfig, BrandId, VisualPreset } from '../types/cabms.ts';
import { BrandLogo } from '../components/BrandLogo.tsx';
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
  faEye,
  faCircleCheck,
  faTriangleExclamation,
  faFileInvoiceDollar,
  faFileLines,
} from '@fortawesome/free-solid-svg-icons';

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

  // Form local state
  const [tagline, setTagline] = useState(currentBrand.tagline || '');
  const [contactPhone, setContactPhone] = useState(currentBrand.contactPhone || '');
  const [contactEmail, setContactEmail] = useState(currentBrand.contactEmail || '');
  const [operationalAddress, setOperationalAddress] = useState(currentBrand.operationalAddress || '');
  const [operatingHours, setOperatingHours] = useState(currentBrand.operatingHours || '');
  const [preferredPreset, setPreferredPreset] = useState<VisualPreset>(currentBrand.preferredPreset || 'dark_company');

  // Preview tab state
  const [previewTab, setPreviewTab] = useState<'quote' | 'invoice' | 'email'>('quote');
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setTagline(currentBrand.tagline || '');
    setContactPhone(currentBrand.contactPhone || '');
    setContactEmail(currentBrand.contactEmail || '');
    setOperationalAddress(currentBrand.operationalAddress || '');
    setOperatingHours(currentBrand.operatingHours || '');
    setPreferredPreset(currentBrand.preferredPreset || 'dark_company');
  }, [activeBrandId, currentBrand]);

  useEffect(() => {
    setSavedFeedback(false);
  }, [activeBrandId]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: BrandConfig = {
      ...currentBrand,
      tagline,
      contactPhone,
      contactEmail,
      operationalAddress,
      operatingHours,
      preferredPreset,
    };
    const result = updateBrandConfig(updated);
    if (result && !result.success) return;
    if (preferredPreset) {
      setVisualPreset(preferredPreset);
    }
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
            {operationalBrandList.map(b => (
              <button
                key={b.id}
                type="button"
                onClick={() => setActiveBrandId(b.id as BrandId)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                  activeBrandId === b.id
                    ? 'bg-(--cabms-surface) text-(--cabms-text-primary) shadow-sm border border-(--cabms-border-focus)'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
                aria-pressed={activeBrandId === b.id}
              >
                {b.name}
              </button>
            ))}
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
            <span className="text-xs px-2 py-0.5 rounded font-mono font-semibold cabms-badge-completed flex items-center gap-1.5">
              <FontAwesomeIcon icon={faCircleCheck} className="w-3 h-3" />
              ONLINE (Simulated)
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Editable Operational Settings & Read-Only Legal (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
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
                value={tagline}
                onChange={e => setTagline(e.target.value)}
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
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
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
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
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
                value={operationalAddress}
                onChange={e => setOperationalAddress(e.target.value)}
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
                value={operatingHours}
                onChange={e => setOperatingHours(e.target.value)}
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
                value={preferredPreset}
                onChange={e => setPreferredPreset(e.target.value as VisualPreset)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
              >
                <option value="dark_neutral">Preset 1 — All Dark (Neutral Panels)</option>
                <option value="dark_company">Preset 2 — Dark + Company Branding (Recommended)</option>
                <option value="light_neutral">Preset 3 — All Light (Neutral Panels)</option>
                <option value="light_company">Preset 4 — Light + Company Branding</option>
                <option value="high_visibility_dark">Preset 5 — High Visibility Dark (OLED Pure Black)</option>
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

        {/* Right Column: Official Logo Preview & Presentation Previews (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* Official Brand Logo Artwork Preview */}
          <div className="cabms-card p-6 space-y-4">
            <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2 border-b border-(--cabms-border-base) pb-3">
              <FontAwesomeIcon icon={faEye} className="text-amber-500" />
              Authoritative SVG Brand Identity
            </h3>

            <div className="p-4 rounded-lg bg-(--cabms-surface-subtle) border border-(--cabms-border-base) flex flex-col items-center justify-center gap-4">
              <div className="w-full max-w-[280px] p-2 bg-(--cabms-surface) rounded border border-(--cabms-border-base) flex items-center justify-center">
                <BrandLogo brandId={currentBrand.id as BrandId} variant="full" className="max-h-16 w-auto" />
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-(--cabms-surface) rounded border border-(--cabms-border-base) flex items-center justify-center">
                  <BrandLogo brandId={currentBrand.id as BrandId} variant="mark" className="w-10 h-10" />
                </div>
                <div className="text-xs text-(--cabms-text-secondary)">
                  <span className="font-bold text-(--cabms-text-primary) block">{currentBrand.name}</span>
                  <span>Primary Mark & Crest Vector</span>
                </div>
              </div>
            </div>
          </div>

          {/* Presentation Previews (Quote, Invoice, Email) */}
          <div className="cabms-card p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-(--cabms-border-base) pb-3">
              <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2">
                <FontAwesomeIcon icon={faFileInvoiceDollar} className="text-amber-500" />
                Customer Document Preview
              </h3>
              <div className="flex bg-(--cabms-surface-subtle) rounded p-0.5 border border-(--cabms-border-base)">
                <button
                  type="button"
                  onClick={() => setPreviewTab('quote')}
                  className={`px-2 py-1 text-xs rounded font-medium ${
                    previewTab === 'quote' ? 'bg-(--cabms-surface) text-amber-400 font-bold' : 'text-(--cabms-text-secondary)'
                  }`}
                >
                  Quote
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('invoice')}
                  className={`px-2 py-1 text-xs rounded font-medium ${
                    previewTab === 'invoice' ? 'bg-(--cabms-surface) text-amber-400 font-bold' : 'text-(--cabms-text-secondary)'
                  }`}
                >
                  Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab('email')}
                  className={`px-2 py-1 text-xs rounded font-medium ${
                    previewTab === 'email' ? 'bg-(--cabms-surface) text-amber-400 font-bold' : 'text-(--cabms-text-secondary)'
                  }`}
                >
                  Email
                </button>
              </div>
            </div>

            {/* Document Render Mockup */}
            <div className="p-4 rounded-lg bg-(--cabms-surface-subtle) border border-(--cabms-border-base) font-sans text-xs space-y-3">
              <div className="flex justify-between items-start border-b border-(--cabms-border-base) pb-2">
                <div>
                  <BrandLogo brandId={currentBrand.id as BrandId} variant="mark" className="w-8 h-8 mb-1" />
                  <span className="font-bold text-(--cabms-text-primary) block">{currentBrand.legalIssuerName}</span>
                  <span className="font-mono text-[10px] text-(--cabms-text-secondary)">{currentBrand.abnPlaceholder}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold uppercase text-amber-400 block">
                    {previewTab === 'quote' ? 'QUOTATION' : previewTab === 'invoice' ? 'TAX INVOICE' : 'SERVICE DISPATCH'}
                  </span>
                  <span className="font-mono text-[10px] text-(--cabms-text-secondary)">
                    {previewTab === 'quote' ? 'QTE-2026-PREVIEW' : previewTab === 'invoice' ? 'INV-2026-PREVIEW' : 'REF #COMM-2026'}
                  </span>
                </div>
              </div>

              {previewTab === 'email' ? (
                <div className="space-y-1.5 text-xs text-(--cabms-text-secondary)">
                  <p>
                    <span className="font-semibold text-(--cabms-text-primary)">From: </span>
                    {currentBrand.name} Operations &lt;{contactEmail || currentBrand.contactEmail}&gt;
                  </p>
                  <p>
                    <span className="font-semibold text-(--cabms-text-primary)">Subject: </span>
                    Quotation Follow-Up & Acceptance Portal Link
                  </p>
                  <div className="p-2 rounded bg-(--cabms-surface) border border-(--cabms-border-base) text-[11px] leading-relaxed text-(--cabms-text-primary)">
                    Dear Customer, please review your detailed service proposal and digital sign-off link. Standard 14-day
                    validity period applies. Call {contactPhone || currentBrand.contactPhone} with any queries.
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] text-(--cabms-text-secondary)">
                    <span>Facility: {operationalAddress || 'Brendale QLD 4500'}</span>
                    <span>Ph: {contactPhone || currentBrand.contactPhone}</span>
                  </div>
                  <div className="p-2 rounded bg-(--cabms-surface) border border-(--cabms-border-base) space-y-1">
                    <div className="flex justify-between font-mono text-[11px] text-(--cabms-text-primary)">
                      <span>Trade Service Scope & Commissioning</span>
                      <span>$580.00</span>
                    </div>
                    <div className="flex justify-between font-mono text-[10px] text-(--cabms-text-secondary)">
                      <span>10% GST</span>
                      <span>$58.00</span>
                    </div>
                    <div className="flex justify-between font-mono font-bold text-[11px] text-amber-400 border-t border-(--cabms-border-base) pt-1">
                      <span>Total Inc GST</span>
                      <span>$638.00</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
