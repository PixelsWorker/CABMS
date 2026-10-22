/**
 * Area B: Super Admin Business and Integration Setup
 * Multi-brand profiles editor, ONE shared MYOB AccountRight connection simulation,
 * per-brand template mappings, mock SMTP status, and multi-calendar mapping.
 * Strictly restricted to Super Admin persona.
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
} from 'lucide-react';
import { BrandConfig, BrandId } from '../types/cabms.ts';

export const SuperAdminSetupView: React.FC = () => {
  const {
    persona,
    brands,
    updateBrandConfig,
    addNewBrandProfile,
    myobConnection,
    setMyobStatus,
  } = useCabms();

  // Role Gate: Super Admin ONLY per specification!
  if (persona !== 'super_admin') {
    return (
      <AccessDeniedView
        resourceName="Super Admin Business Profiles & Technical Integration Credentials"
        requiredRoleDescription="Super Admin Only"
        customExplanation="Owner/Admin, Office Staff and Technicians are strictly prohibited from modifying technical integration credentials, shared MYOB bindings, or company file mappings."
      />
    );
  }

  const [editingBrandId, setEditingBrandId] = useState<BrandId>('solarcell');
  const [isAddProfileModalOpen, setIsAddProfileModalOpen] = useState(false);

  // Editable brand fields
  const activeEditingBrand = brands[editingBrandId] || brands.solarcell;
  const [formBrandName, setFormBrandName] = useState(activeEditingBrand.name);
  const [formTagline, setFormTagline] = useState(activeEditingBrand.tagline);
  const [formColor, setFormColor] = useState(activeEditingBrand.primaryColor);
  const [formIssuer, setFormIssuer] = useState(activeEditingBrand.legalIssuerName);
  const [formAbn, setFormAbn] = useState(activeEditingBrand.abnPlaceholder);
  const [formElecLicence, setFormElecLicence] = useState(activeEditingBrand.electricalLicencePlaceholder);
  const [formAcma, setFormAcma] = useState(activeEditingBrand.acmaCablerPlaceholder);
  const [formQbcc, setFormQbcc] = useState(activeEditingBrand.qbccLicencePlaceholder);
  const [formReviewUrl, setFormReviewUrl] = useState(activeEditingBrand.reviewUrlPlaceholder);
  const [formQuoteTpl, setFormQuoteTpl] = useState(activeEditingBrand.quoteTemplateName);
  const [formInvTpl, setFormInvTpl] = useState(activeEditingBrand.invoiceTemplateName);

  // Sync state when switching brand tab
  const handleSwitchEditingBrand = (id: BrandId) => {
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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Settings className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Super Admin Business & Technical Integration Setup
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Multi-brand configuration, single shared MYOB company file simulation, calendar mappings, and email service parameters.
            </p>
          </div>

          <div className="bg-purple-950/80 border border-purple-800 text-purple-300 text-xs px-3 py-1.5 rounded-lg font-bold flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            <span>Super Admin Credential Control Active</span>
          </div>
        </div>
      </div>

      {/* SECTION 1: ONE SHARED CONNECT MYOB SIMULATION */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400">
              One Shared Accounting Link
            </span>
            <h2 className="text-base font-bold text-white mt-0.5">
              MYOB AccountRight Live Company Connection
            </h2>
            <p className="text-xs text-slate-400">
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
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Simulate Connected
            </button>
            <button
              onClick={() => setMyobStatus('DISCONNECTED')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer ${
                myobConnection.status === 'DISCONNECTED'
                  ? 'bg-amber-600 text-slate-950 shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Disconnected
            </button>
            <button
              onClick={() => setMyobStatus('FAILED')}
              className={`px-3 py-1.5 rounded text-xs font-bold transition cursor-pointer ${
                myobConnection.status === 'FAILED'
                  ? 'bg-red-600 text-white shadow'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              Simulate API Failure
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="text-slate-500 uppercase text-[10px] font-bold block">Company File Name</span>
            <span className="text-white font-semibold">{myobConnection.companyFile}</span>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="text-slate-500 uppercase text-[10px] font-bold block">MYOB Company Identifier</span>
            <span className="font-mono text-sky-400 font-bold">{myobConnection.companyId}</span>
          </div>
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1">
            <span className="text-slate-500 uppercase text-[10px] font-bold block">Last Heartbeat Ping</span>
            <span className="text-slate-300 font-mono">{myobConnection.lastSync}</span>
          </div>
        </div>

        {myobConnection.status === 'FAILED' && (
          <div className="p-3 rounded-lg bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
            <span>{myobConnection.errorMessage}</span>
          </div>
        )}

        {/* Per-Brand Template Mapping Disclosure (Unverified support per Section B) */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-1">
          <span className="font-bold text-amber-400 block text-[11px] uppercase tracking-wider">
            Per-Brand Template Mapping Notice (MYOB API Compatibility)
          </span>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            CABMS maps separate quotation and invoice templates per brand profile under this single company connection. <em>Note: Live MYOB API support for programmatic template selection is unverified in standard AccountRight endpoints and is represented as an operational prototype.</em>
          </p>
        </div>
      </div>

      {/* SECTION 2: MULTI-BRAND BUSINESS PROFILES CONFIGURATOR */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Three-Brand Operating System
            </span>
            <h2 className="text-base font-bold text-white mt-0.5">
              Configurable Brand Profiles & Legal Issuers
            </h2>
            <p className="text-xs text-slate-400">
              Customize trade names, typographic logo accents, licence numbers, and legal disclaimer placeholders.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            {Object.values(brands).map(b => (
              <button
                key={b.id}
                onClick={() => handleSwitchEditingBrand(b.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                  editingBrandId === b.id
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {b.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        {/* Brand Editor Form */}
        <form onSubmit={handleSaveProfile} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Brand Operating Name</label>
              <input
                type="text"
                value={formBrandName}
                onChange={e => setFormBrandName(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Tagline</label>
              <input
                type="text"
                value={formTagline}
                onChange={e => setFormTagline(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Primary Accent Color</label>
              <div className="flex items-center space-x-2">
                <input
                  type="color"
                  value={formColor}
                  onChange={e => setFormColor(e.target.value)}
                  className="w-8 h-8 rounded bg-transparent border-0 cursor-pointer"
                />
                <input
                  type="text"
                  value={formColor}
                  onChange={e => setFormColor(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Legal Issuer Name (Placeholder)</label>
              <input
                type="text"
                value={formIssuer}
                onChange={e => setFormIssuer(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">ABN Placeholder</label>
              <input
                type="text"
                value={formAbn}
                onChange={e => setFormAbn(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Electrical Contractor Licence</label>
              <input
                type="text"
                value={formElecLicence}
                onChange={e => setFormElecLicence(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">ACMA Telecommunications Cabler</label>
              <input
                type="text"
                value={formAcma}
                onChange={e => setFormAcma(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">QBCC Licence Placeholder</label>
              <input
                type="text"
                value={formQbcc}
                onChange={e => setFormQbcc(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Google Review URL Placeholder</label>
              <input
                type="text"
                value={formReviewUrl}
                onChange={e => setFormReviewUrl(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">MYOB Quote Template Mapping</label>
              <input
                type="text"
                value={formQuoteTpl}
                onChange={e => setFormQuoteTpl(e.target.value)}
                className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white font-mono focus:outline-none focus:border-amber-500"
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

      {/* SECTION 3: SMTP & CALENDAR SIMULATION STATUS */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        {/* Email & SMTP Status */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-slate-300">
            <Mail className="w-4 h-4 text-sky-400" />
            <h3 className="font-bold text-white text-sm">Email Sender & SMTP Status</h3>
          </div>
          <p className="text-slate-400 text-xs">
            Simulation mock only. No real SMTP credentials, mailbox connections, or external mail dispatch.
          </p>
          <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-1 font-mono text-[11px] text-slate-300">
            <div>Sender: <span className="text-sky-400">noreply-cabms@example.invalid</span></div>
            <div>SMTP Host: <span className="text-slate-400">smtp.internal.cabms-mock.invalid (Port 587)</span></div>
            <div>Credential Security: <span className="text-emerald-400 font-bold">Isolated Demo Mock</span></div>
          </div>
        </div>

        {/* Multi-Calendar Bindings */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <div className="flex items-center space-x-2 text-slate-300">
            <Calendar className="w-4 h-4 text-amber-400" />
            <h3 className="font-bold text-white text-sm">Google Calendar Fleet Mappings</h3>
          </div>
          <p className="text-slate-400 text-xs">
            Primary hub calendar + up to 3 fleet calendars linked to specific technician teams.
          </p>
          <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-1 text-[11px] text-slate-300">
            <div>Primary Hub: <strong className="text-white">CABMS Operations Master Calendar</strong></div>
            <div>Solar Crew: <span className="text-amber-400">{brands.solarcell?.calendarMappingName}</span></div>
            <div>Smart Home: <span className="text-sky-400">{brands.smart_home?.calendarMappingName}</span></div>
            <div>CCTV Fleet: <span className="text-emerald-400">{brands.cctv?.calendarMappingName}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};
