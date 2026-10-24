/**
 * Area B: Super Admin Business and Integration Setup
 * Multi-brand profiles editor, ONE shared MYOB Business connection simulation,
 * Add Business Profile modal (G00-024), per-brand template mappings,
 * mock SMTP status, and multi-calendar mapping.
 * Strictly restricted to Super Admin persona (with unconditional hook ordering G00-008).
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  Settings,
  Building2,
  Database,
  Calendar,
  Mail,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  Plus,
  Sliders,
  ExternalLink,
  X,
} from 'lucide-react';
import { BrandConfig, BrandId } from '../types/cabms.ts';

let brandSeqCounter = 1;

export const SuperAdminSetupView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    persona,
    brands,
    updateBrandConfig,
    addNewBrandProfile,
    draftBusinesses,
    createDraftBusiness,
    myobConnection,
    setMyobStatus,
  } = useCabms();

  const [editingBrandId, setEditingBrandId] = useState<string>('solarcell');
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);

  // Editable brand fields
  const activeEditingBrand = brands[editingBrandId] || brands.solarcell || Object.values(brands)[0];
  const [formBrandName, setFormBrandName] = useState(activeEditingBrand?.name || '');
  const [formTagline, setFormTagline] = useState(activeEditingBrand?.tagline || '');
  const [formColor, setFormColor] = useState(activeEditingBrand?.primaryColor || '#f59e0b');
  const [formIssuer, setFormIssuer] = useState(activeEditingBrand?.legalIssuerName || '');
  const [formAbn, setFormAbn] = useState(activeEditingBrand?.abnPlaceholder || '');
  const [formElecLicence, setFormElecLicence] = useState(activeEditingBrand?.electricalLicencePlaceholder || '');
  const [formAcma, setFormAcma] = useState(activeEditingBrand?.acmaCablerPlaceholder || '');
  const [formQbcc, setFormQbcc] = useState(activeEditingBrand?.qbccLicencePlaceholder || '');
  const [formReviewUrl, setFormReviewUrl] = useState(activeEditingBrand?.reviewUrlPlaceholder || '');
  const [formQuoteTpl, setFormQuoteTpl] = useState(activeEditingBrand?.quoteTemplateName || '');
  const [formInvTpl, setFormInvTpl] = useState(activeEditingBrand?.invoiceTemplateName || '');

  // New Profile Form State (G00-024)
  const [newBrandId, setNewBrandId] = useState('');
  const [newBrandName, setNewBrandName] = useState('');
  const [newBrandTagline, setNewBrandTagline] = useState('');
  const [newBrandColor, setNewBrandColor] = useState('#0284c7');
  const [newLegalIssuer, setNewLegalIssuer] = useState('');
  const [newAbn, setNewAbn] = useState('11 222 333 444');
  const [newElecLic, setNewElecLic] = useState('QLD-ELEC-99999');
  const [newAcma, setNewAcma] = useState('T-99999');
  const [newQbcc, setNewQbcc] = useState('QBCC-999999');

  // Role Gate: Super Admin ONLY (evaluated AFTER hooks)
  if (persona !== 'super_admin') {
    return (
      <AccessDeniedView
        resourceName="Super Admin Business Profiles & Technical Integration Credentials"
        requiredRoleDescription="Super Admin Only"
        customExplanation="Admin, Office Staff and Technicians are strictly prohibited from modifying technical integration credentials, shared MYOB bindings, or company file mappings."
      />
    );
  }

  // Sync state when switching brand tab
  const handleSwitchEditingBrand = (id: string) => {
    setEditingBrandId(id);
    const b = brands[id];
    if (b) {
      setFormBrandName(b.name);
      setFormTagline(b.tagline);
      setFormColor(b.primaryColor);
      setFormIssuer(b.legalIssuerName);
      setFormAbn(b.abnPlaceholder);
      setFormElecLicence(b.electricalLicencePlaceholder);
      setFormAcma(b.acmaCablerPlaceholder);
      setFormQbcc(b.qbccLicencePlaceholder);
      setFormReviewUrl(b.reviewUrlPlaceholder);
      setFormQuoteTpl(b.quoteTemplateName);
      setFormInvTpl(b.invoiceTemplateName);
    }
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEditingBrand) return;
    updateBrandConfig({
      ...activeEditingBrand,
      name: formBrandName,
      tagline: formTagline,
      primaryColor: formColor,
      legalIssuerName: formIssuer,
      abnPlaceholder: formAbn,
      electricalLicencePlaceholder: formElecLicence,
      acmaCablerPlaceholder: formAcma,
      qbccLicencePlaceholder: formQbcc,
      reviewUrlPlaceholder: formReviewUrl,
      quoteTemplateName: formQuoteTpl,
      invoiceTemplateName: formInvTpl,
    });
  };

  const handleCreateNewProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBrandName) return;

    const res = createDraftBusiness({
      slug: newBrandId.trim() || undefined,
      name: newBrandName,
      tagline: newBrandTagline || 'Quality Electrical & Automation Services',
      primaryColor: newBrandColor,
      accentColor: '#38bdf8',
      logoGlyph: newBrandName.charAt(0).toUpperCase() || 'B',
      legalIssuerName: newLegalIssuer || `${newBrandName} Pty Ltd`,
      abnPlaceholder: newAbn,
      electricalLicencePlaceholder: newElecLic,
      acmaCablerPlaceholder: newAcma,
      qbccLicencePlaceholder: newQbcc,
    });

    if (res.success) {
      setNewBrandId('');
      setNewBrandName('');
      setNewBrandTagline('');
      setNewLegalIssuer('');
      setIsAddProfileModalOpen(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Settings className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-bold text-[var(--cabms-text-primary)] tracking-tight">
                Super Admin Business & Technical Integration Setup
              </h1>
            </div>
            <p className="text-xs text-[var(--cabms-text-secondary)] mt-1">
              Multi-brand configuration, single shared MYOB company file simulation, calendar mappings, and email service parameters.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setIsAddProfileModalOpen(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-bold transition shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Add Business Profile</span>
            </button>
            <div className="bg-purple-950/80 border border-purple-800 text-purple-300 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1.5">
              <ShieldCheck className="w-4 h-4 text-purple-400" />
              <span>Super Admin Active</span>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: ONE SHARED CONNECT MYOB SIMULATION */}
      <div className="cabms-card p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
              One Shared Accounting Link
            </span>
            <h2 className="text-base font-bold text-[var(--cabms-text-primary)] mt-0.5">
              MYOB Business — Client-Reported Shared Company File (Simulated)
            </h2>
            <p className="text-xs text-[var(--cabms-text-secondary)]">
              Single shared MYOB company file used across all business profiles. No separate company file authentication required.
            </p>
          </div>

          {/* Connection Status Buttons */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setMyobStatus('CONNECTED')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer ${
                myobConnection.status === 'CONNECTED'
                  ? 'bg-emerald-600 text-slate-950 shadow'
                  : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
              }`}
            >
              Simulate Connected
            </button>
            <button
              onClick={() => setMyobStatus('DISCONNECTED')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer ${
                myobConnection.status === 'DISCONNECTED'
                  ? 'bg-amber-600 text-slate-950 shadow'
                  : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
              }`}
            >
              Simulate Disconnected
            </button>
            <button
              onClick={() => setMyobStatus('FAILED')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer ${
                myobConnection.status === 'FAILED'
                  ? 'bg-red-600 text-white shadow'
                  : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
              }`}
            >
              Simulate Token Expired
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs cabms-card-subtle p-4">
          <div>
            <span className="text-slate-500 uppercase text-[10px] block">Company File Name:</span>
            <span className="font-bold text-[var(--cabms-text-primary)]">{myobConnection.companyFile}</span>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] block">MYOB Company ID:</span>
            <span className="font-mono text-sky-400">{myobConnection.companyId}</span>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] block">Connection State:</span>
            <span
              className={`font-bold ${
                myobConnection.status === 'CONNECTED'
                  ? 'text-emerald-400'
                  : myobConnection.status === 'DISCONNECTED'
                  ? 'text-amber-400'
                  : 'text-red-400'
              }`}
            >
              {myobConnection.status}
            </span>
          </div>
          <div>
            <span className="text-slate-500 uppercase text-[10px] block">Last Sync Timestamp:</span>
            <span className="font-mono text-[var(--cabms-text-secondary)]">{myobConnection.lastSync}</span>
          </div>
        </div>
      </div>

      {/* SECTION 2: MULTI-BRAND BUSINESS PROFILE CONFIGURATION */}
      <div className="cabms-card p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400">
              Multi-Brand Identity
            </span>
            <h2 className="text-base font-bold text-[var(--cabms-text-primary)] mt-0.5">
              Configurable Business Profiles & Legal Issuers
            </h2>
          </div>

          {/* Profile Switcher Tabs */}
          <div className="flex space-x-2">
            {(['solarcell', 'smart_home', 'cctv'] as BrandId[]).map(id => {
              const b = brands[id];
              if (!b) return null;
              return (
                <button
                  key={b.id}
                  onClick={() => handleSwitchEditingBrand(b.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer flex items-center space-x-1.5 ${
                    editingBrandId === b.id
                      ? 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] shadow-sm'
                      : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: b.primaryColor }} />
                  <span>{b.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Profile Settings Form */}
        <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Trading Name *</label>
              <input
                type="text"
                required
                value={formBrandName}
                onChange={e => setFormBrandName(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)]"
              />
            </div>
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Marketing Tagline</label>
              <input
                type="text"
                value={formTagline}
                onChange={e => setFormTagline(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)]"
              />
            </div>
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Brand Theme Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={formColor}
                  onChange={e => setFormColor(e.target.value)}
                  className="w-9 h-9 rounded cabms-card-subtle cursor-pointer p-0.5"
                />
                <input
                  type="text"
                  value={formColor}
                  onChange={e => setFormColor(e.target.value)}
                  className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">
                Legal Document Issuer (Entity Name) *
              </label>
              <input
                type="text"
                required
                value={formIssuer}
                onChange={e => setFormIssuer(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-bold"
              />
              <span className="text-[10px] text-slate-500 mt-0.5 block">
                Appears on all printed compliance certificates, quotes, and legal documents.
              </span>
            </div>
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Australian Business Number (ABN)</label>
              <input
                type="text"
                value={formAbn}
                onChange={e => setFormAbn(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Electrical Contractor Licence</label>
              <input
                type="text"
                value={formElecLicence}
                onChange={e => setFormElecLicence(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-mono"
              />
            </div>
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">ACMA Registered Cabler No.</label>
              <input
                type="text"
                value={formAcma}
                onChange={e => setFormAcma(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-mono"
              />
            </div>
            <div>
              <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">QBCC Licence Placeholder</label>
              <input
                type="text"
                value={formQbcc}
                onChange={e => setFormQbcc(e.target.value)}
                className="w-full cabms-card-subtle rounded p-2 text-[var(--cabms-text-primary)] font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold rounded-lg transition shadow-md cursor-pointer"
            >
              Save Profile Changes
            </button>
          </div>
        </form>
      </div>

      {/* SECTION 2B: DRAFT BUSINESS PROFILES INCUBATOR (NON-OPERATIONAL) */}
      <div className="cabms-card p-6 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                Incubator / Future Expansion
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 border border-amber-800 text-amber-300">
                NON-OPERATIONAL DRAFTS
              </span>
            </div>
            <h2 className="text-base font-bold text-[var(--cabms-text-primary)] mt-0.5">
              Draft Business Profiles
            </h2>
            <p className="text-xs text-[var(--cabms-text-secondary)]">
              Future business configurations in draft preview. Strictly excluded from the active operational brand switcher, job scheduling, and compliance certificate generation.
            </p>
          </div>
        </div>

        {draftBusinesses.length === 0 ? (
          <div className="p-4 rounded-lg cabms-card-subtle border border-dashed cabms-border text-[var(--cabms-text-secondary)] text-xs text-center">
            No draft businesses currently registered. Use &quot;Add Business Profile&quot; to incubate a future brand entity.
          </div>
        ) : (
          <div className="space-y-3">
            {draftBusinesses.map(draft => (
              <div
                key={draft.id}
                className="p-3.5 cabms-card-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: draft.primaryColor }} />
                    <span className="font-bold text-[var(--cabms-text-primary)]">{draft.name}</span>
                    <span className="text-[10px] cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] px-1.5 py-0.5 rounded font-mono">
                      {draft.id}
                    </span>
                    {draft.slug && (
                      <span className="text-[10px] bg-purple-950/80 border border-purple-800 text-purple-300 px-1.5 py-0.5 rounded font-mono">
                        slug: {draft.slug}
                      </span>
                    )}
                  </div>
                  <div className="text-[var(--cabms-text-secondary)] text-[11px] mt-0.5">
                    {draft.legalIssuerName} • ABN: {draft.abnPlaceholder}
                  </div>
                  <div className="text-slate-500 text-[10px] mt-0.5 flex flex-wrap gap-x-3">
                    <span>Elec Lic: <strong className="text-[var(--cabms-text-secondary)] font-mono">{draft.electricalLicencePlaceholder || 'N/A'}</strong></span>
                    <span>ACMA: <strong className="text-[var(--cabms-text-secondary)] font-mono">{draft.acmaCablerPlaceholder || 'N/A'}</strong></span>
                    <span>QBCC: <strong className="text-[var(--cabms-text-secondary)] font-mono">{draft.qbccLicencePlaceholder || 'N/A'}</strong></span>
                    <span>Created: {draft.createdAt}</span>
                  </div>
                </div>
                <div className="text-[10px] text-amber-400 bg-amber-950/60 border border-amber-900/80 px-2 py-1 rounded font-semibold self-start sm:self-auto">
                  Draft Mode (Non-Operational)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 3: SMTP & CALENDAR SIMULATION STATUS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Email & SMTP Status */}
        <div className="cabms-card p-5 space-y-3">
          <div className="flex items-center space-x-2 text-[var(--cabms-text-secondary)]">
            <Mail className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-[var(--cabms-text-primary)] text-sm">Email Sender & SMTP Status</h3>
          </div>
          <p className="text-[var(--cabms-text-secondary)] text-xs">
            Simulation mock only. Email is the single approved communication channel.
          </p>
          <div className="cabms-surface-subtle p-3 rounded border cabms-border space-y-1 font-mono text-[11px] text-[var(--cabms-text-secondary)]">
            <div>Sender: <span className="text-sky-400">noreply-cabms@example.invalid</span></div>
            <div>SMTP Host: <span className="text-[var(--cabms-text-secondary)]">smtp.internal.cabms-mock.invalid (Port 587)</span></div>
            <div>Credential Security: <span className="text-emerald-400 font-bold">Isolated Demo Mock</span></div>
          </div>
        </div>

        {/* Multi-Calendar Bindings */}
        <div className="cabms-card p-5 space-y-3">
          <div className="flex items-center space-x-2 text-[var(--cabms-text-secondary)]">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-[var(--cabms-text-primary)] text-sm">Google Calendar Fleet Mappings</h3>
          </div>
          <p className="text-[var(--cabms-text-secondary)] text-xs">
            Primary hub calendar + up to 3 fleet calendars linked to specific technician teams.
          </p>
          <div className="cabms-surface-subtle p-3 rounded border cabms-border space-y-1 text-[11px] text-[var(--cabms-text-secondary)]">
            <div>Primary Hub: <strong className="text-[var(--cabms-text-primary)]">CABMS Operations Master Calendar</strong></div>
            <div>Solar Crew: <span className="text-amber-400">{brands.solarcell?.calendarMappingName}</span></div>
            <div>Smart Home: <span className="text-sky-400">{brands.smart_home?.calendarMappingName}</span></div>
            <div>CCTV Fleet: <span className="text-emerald-400">{brands.cctv?.calendarMappingName}</span></div>
          </div>
        </div>
      </div>

      {/* ADD BUSINESS PROFILE MODAL (G00-024) */}
      {isAddProfileModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-[var(--cabms-text-primary)] flex items-center space-x-2">
                <Building2 className="w-5 h-5 text-purple-400" />
                <span>Add Business Profile (Super Admin)</span>
              </h3>
              <button
                onClick={() => setIsAddProfileModalOpen(false)}
                className="text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-[var(--cabms-text-secondary)]">
              Configure an additional business profile with isolated branding, legal entity disclosures, and calendar mappings.
            </p>

            <form onSubmit={handleCreateNewProfile} className="space-y-3 text-xs">
              <div>
                <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Brand Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gold Coast Air Conditioning"
                  value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)]"
                />
              </div>

              <div>
                <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Tagline</label>
                <input
                  type="text"
                  placeholder="e.g. Premium Commercial & Residential HVAC"
                  value={newBrandTagline}
                  onChange={e => setNewBrandTagline(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Brand ID (Slug)</label>
                  <input
                    type="text"
                    placeholder="air_con"
                    value={newBrandId}
                    onChange={e => setNewBrandId(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Theme Color</label>
                  <input
                    type="color"
                    value={newBrandColor}
                    onChange={e => setNewBrandColor(e.target.value)}
                    className="w-full h-8 cabms-input rounded cursor-pointer p-0.5"
                  />
                </div>
              </div>

              <div>
                <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Legal Issuer Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Gold Coast Air Con Pty Ltd"
                  value={newLegalIssuer}
                  onChange={e => setNewLegalIssuer(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">ABN Placeholder</label>
                  <input
                    type="text"
                    value={newAbn}
                    onChange={e => setNewAbn(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">Electrical Licence</label>
                  <input
                    type="text"
                    value={newElecLic}
                    onChange={e => setNewElecLic(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">ACMA Cabler Licence</label>
                  <input
                    type="text"
                    value={newAcma}
                    onChange={e => setNewAcma(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                  />
                </div>
                <div>
                  <label className="text-[var(--cabms-text-secondary)] block font-semibold mb-1">QBCC Licence</label>
                  <input
                    type="text"
                    value={newQbcc}
                    onChange={e => setNewQbcc(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-[var(--cabms-text-primary)] font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddProfileModalOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] rounded font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded cursor-pointer"
                >
                  Add Profile
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
