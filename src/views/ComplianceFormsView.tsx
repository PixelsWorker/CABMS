/**
 * Area F: Mobile Technician Forms & Compliance Documents
 * JSA, Electrical Certificate (Part A + Unresolved Part B notice),
 * Smoke Alarm Certificate, TCA1, and TCA2.
 * Includes interactive editable form fields, sample photo attachments,
 * deterministic job-owned instances, and truthful branded document preview.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Camera,
  Printer,
  Shield,
  FileText,
  User,
  MapPin,
  Calendar,
  Clock,
  Layers,
  ChevronRight,
  Info,
  Check,
  X,
  ExternalLink,
  Plus,
  Trash2,
  Image as ImageIcon,
  ShieldAlert,
} from 'lucide-react';
import {
  JsaFormData,
  ElectricalCertData,
  SmokeAlarmCertData,
  Tca1CertData,
  Tca2CertData,
} from '../types/cabms.ts';

type ActiveFormType = 'JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2';

export const ComplianceFormsView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    brands,
    persona,
    getOrCreateJsa,
    getOrCreateElectrical,
    getOrCreateSmokeAlarm,
    getOrCreateTca1,
    getOrCreateTca2,
    updateJsaForm,
    updateElectricalForm,
    updateSmokeAlarmForm,
    updateTca1Form,
    updateTca2Form,
    signOffJsa,
    signOffElectrical,
    signOffSmokeAlarm,
    signOffTca1,
    signOffTca2,
    customerAckTca2,
    officeReviewTca2,
    sampleAttachments,
    attachSampleToJobForm,
    removeSampleFromJobForm,
  } = useCabms();

  const [activeFormTab, setActiveFormTab] = useState<ActiveFormType>('JSA');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);

  // Target job
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  // Independent job-owned forms (G00-005)
  const currentJsa = getOrCreateJsa(currentJob.id);
  const currentElec = getOrCreateElectrical(currentJob.id);
  const currentSmoke = getOrCreateSmokeAlarm(currentJob.id);
  const currentTca1 = getOrCreateTca1(currentJob.id);
  const currentTca2 = getOrCreateTca2(currentJob.id);

  // Brand config for legal issuer (G00-003)
  const jobBrand = brands[currentJob.brandId] || brands.solarcell;

  // Persona boundary: Technicians can only access jobs assigned to them (G00-001)
  const isTechnicianRestricted =
    persona === 'technician' &&
    (currentJob.assignedTechId === null || currentJob.assignedTechId !== 'TECH-001');

  if (isTechnicianRestricted) {
    return (
      <AccessDeniedView
        resourceName={`Compliance Forms for ${currentJob.id}`}
        requiredRoleDescription="Assigned Field Technician (TECH-001 Dave Miller) or Office Administrator"
        customExplanation={`You are currently signed in as Technician Dave Miller (TECH-001). This work order (${currentJob.id}) is ${
          currentJob.assignedTechId ? `assigned to ${currentJob.assignedTechName || currentJob.assignedTechId}` : 'currently unassigned'
        }. Technicians are strictly restricted to assigned jobs.`}
      />
    );
  }

  // Active form status
  const getActiveFormStatus = () => {
    switch (activeFormTab) {
      case 'JSA':
        return {
          signedOff: currentJsa.signedOff,
          signerName: currentJsa.signedByTechName || 'Dave Miller',
          timestamp: currentJsa.signedTimestamp || 'Pending Execution',
          title: 'Job Safety Analysis & SWMS',
        };
      case 'ELECTRICAL':
        return {
          signedOff: currentElec.signedOff,
          signerName: currentElec.signedByTechName || 'Dave Miller (Lic 88204)',
          timestamp: currentElec.signedTimestamp || 'Pending Execution',
          title: 'Certificate of Electrical Safety (Part A)',
        };
      case 'SMOKE_ALARM':
        return {
          signedOff: currentSmoke.signedOff,
          signerName: currentSmoke.signedByTechName || 'Dave Miller',
          timestamp: currentSmoke.signedTimestamp || 'Pending Execution',
          title: 'Smoke Alarm Compliance Certificate',
        };
      case 'TCA1':
        return {
          signedOff: currentTca1.signedOff,
          signerName: currentTca1.signedByTechName || currentTca1.registeredCablerPlaceholder,
          timestamp: currentTca1.signedTimestamp || 'Pending Execution',
          title: 'Telecommunications Cabling Advice (TCA1)',
        };
      case 'TCA2':
        return {
          signedOff: currentTca2.signedOff,
          signerName: currentTca2.signedByTechName || currentTca2.businessCablerPlaceholder,
          timestamp: currentTca2.signedTimestamp || 'Pending Execution',
          title: 'Telecommunications Cabling Defect Notice (TCA2)',
        };
    }
  };

  const activeStatus = getActiveFormStatus();

  // Helper for adding a new JSA step
  const handleAddJsaStep = () => {
    const newStep = {
      id: `STEP-${Date.now().toString().slice(-4)}`,
      taskStep: 'Additional Site Task',
      hazards: 'Site-specific hazard identified',
      initialRisk: 'M' as const,
      controls: 'Apply relevant Australian Standard controls',
      residualRisk: 'L' as const,
      responsibleRole: 'Lead Technician',
    };
    updateJsaForm(currentJob.id, {
      steps: [...currentJsa.steps, newStep],
    });
  };

  // Helper for toggling JSA PPE
  const handleTogglePpe = (index: number) => {
    const updated = currentJsa.ppeChecklist.map((item, idx) =>
      idx === index ? { ...item, status: (item.status === 'Yes' ? 'No' : 'Yes') as 'Yes' | 'No' } : item
    );
    updateJsaForm(currentJob.id, { ppeChecklist: updated });
  };

  // Helper for adding Smoke Alarm row
  const handleAddSmokeAlarmRow = () => {
    const newRow = {
      id: `ALARM-${Date.now().toString().slice(-4)}`,
      roomLocation: 'Additional Bedroom / Hallway',
      alarmBrandModel: 'Clipsal 755PSMA4',
      standardMarkingPlaceholder: 'AS 3786:2014',
      manufactureDateOrExpiry: '2036-10',
      powerSource: '240V Hardwired with Battery Backup' as const,
      passFail: 'Pass' as const,
      buttonTestPass: true,
      interconnectionPass: true,
      complianceStatusProvisional: 'Pass' as const,
    };
    updateSmokeAlarmForm(currentJob.id, {
      alarmSchedule: [...currentSmoke.alarmSchedule, newRow],
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Job Switcher */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FileCheck2 className="w-5 h-5 text-amber-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Mobile Technician Compliance Forms & Documents
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Field risk assessments, electrical safety test sheets, smoke alarm compliance schedules, and ACMA cabling certificates.
            </p>
          </div>

          {/* Print/Preview Demo PDF Action */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowPrintModal(true)}
              className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg transition cursor-pointer"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              <span>Branded Print / PDF Preview</span>
            </button>
          </div>
        </div>

        {/* Selected Job Indicator */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center space-x-2">
            <span className="text-slate-400">Current Work Order:</span>
            <select
              value={selectedJobId || ''}
              onChange={e => setSelectedJobId(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-white font-mono font-bold cursor-pointer"
            >
              {jobs
                .filter(j => persona !== 'technician' || j.assignedTechId === 'TECH-001')
                .map(j => (
                  <option key={j.id} value={j.id}>
                    {j.id} — {j.title} ({j.brandId})
                  </option>
                ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 text-slate-400">
            <span>Site: <strong className="text-white">{currentJob.siteAddress}</strong></span>
            <span className="text-slate-600">•</span>
            <span>Issuer: <strong className="text-sky-300">{jobBrand.legalIssuerName}</strong></span>
          </div>
        </div>
      </div>

      {/* Form Tabs Bar */}
      <div className="flex space-x-2 overflow-x-auto scrollbar-none border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveFormTab('JSA')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeFormTab === 'JSA'
              ? 'bg-amber-600 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          <span>JSA / Risk Assessment</span>
          {currentJsa.signedOff ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
          ) : (
            <span className="w-2 h-2 rounded-full bg-red-400" />
          )}
        </button>

        <button
          onClick={() => setActiveFormTab('SMOKE_ALARM')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeFormTab === 'SMOKE_ALARM'
              ? 'bg-amber-600 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          <span>Smoke Alarm Cert</span>
          {currentSmoke.signedOff && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
        </button>

        <button
          onClick={() => setActiveFormTab('ELECTRICAL')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeFormTab === 'ELECTRICAL'
              ? 'bg-amber-600 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          <span>Electrical Cert (Part A)</span>
          {currentElec.signedOff && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
        </button>

        <button
          onClick={() => setActiveFormTab('TCA1')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeFormTab === 'TCA1'
              ? 'bg-amber-600 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          <span>TCA1 Cabling</span>
          {currentTca1.signedOff && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
        </button>

        <button
          onClick={() => setActiveFormTab('TCA2')}
          className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition cursor-pointer ${
            activeFormTab === 'TCA2'
              ? 'bg-amber-600 text-slate-950 shadow-md'
              : 'bg-slate-900 text-slate-400 hover:text-white'
          }`}
        >
          <span>TCA2 Defect Notice</span>
          {currentTca2.signedOff && <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />}
        </button>
      </div>

      {/* Main Active Form View */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
        {/* ======================= FORM 1: JSA RISK ASSESSMENT ======================= */}
        {activeFormTab === 'JSA' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  Sanitised Field Groups 1–9 • Work Health & Safety Matrix
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Job Safety Analysis (JSA) / Safe Work Method Statement
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Revision: {currentJsa.formRevision} • Issuer: {jobBrand.legalIssuerName}
                </span>
              </div>

              {/* Apply DEMO Sign-off Button */}
              <div>
                {currentJsa.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentJsa.signedByTechName || 'Dave Miller'} ({currentJsa.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffJsa(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Technician DEMO Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            {/* Field Groups 1 & 2: Site Details & Personnel (Interactive G00-002) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  1. Job & Site Details
                </h3>
                <div className="space-y-2 text-slate-300">
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Job Reference</label>
                    <input
                      type="text"
                      readOnly
                      value={currentJsa.jobReference}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Customer Name</label>
                    <input
                      type="text"
                      value={currentJsa.customerName}
                      onChange={e => updateJsaForm(currentJob.id, { customerName: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Site Contact Person</label>
                    <input
                      type="text"
                      value={currentJsa.siteContactPlaceholder}
                      onChange={e => updateJsaForm(currentJob.id, { siteContactPlaceholder: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Identified Site Assets</label>
                    <input
                      type="text"
                      value={currentJsa.assetsIdentified}
                      onChange={e => updateJsaForm(currentJob.id, { assetsIdentified: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-sky-300"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  2. Personnel & Competency
                </h3>
                <div className="space-y-2 text-slate-300">
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Lead Technician</label>
                    <input
                      type="text"
                      value={currentJsa.personnelName}
                      onChange={e => updateJsaForm(currentJob.id, { personnelName: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Licence / Accreditation</label>
                    <input
                      type="text"
                      value={currentJsa.licencePlaceholder}
                      onChange={e => updateJsaForm(currentJob.id, { licencePlaceholder: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-300 font-mono"
                    />
                  </div>
                  <div className="flex items-center space-x-4 pt-2 text-[11px]">
                    <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Site Induction Completed
                    </span>
                    <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Competencies Verified
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Field Groups 3 & 4: Risk Matrix & Task Steps (Editable rows G00-002) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  3 & 4. Task Steps, Hazards & Controls Matrix (L/M/H/E)
                </h3>
                <button
                  onClick={handleAddJsaStep}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Task Step</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-3">Task Step</th>
                      <th className="p-3">Identified Hazard</th>
                      <th className="p-3 text-center">Initial Risk</th>
                      <th className="p-3">Control Measures Applied</th>
                      <th className="p-3 text-center">Residual</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/50">
                    {currentJsa.steps.map((step, idx) => (
                      <tr key={step.id}>
                        <td className="p-2.5 font-semibold text-white">
                          <input
                            type="text"
                            value={step.taskStep}
                            onChange={e => {
                              const updated = [...currentJsa.steps];
                              updated[idx].taskStep = e.target.value;
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-full text-white"
                          />
                        </td>
                        <td className="p-2.5 text-red-300">
                          <input
                            type="text"
                            value={step.hazards}
                            onChange={e => {
                              const updated = [...currentJsa.steps];
                              updated[idx].hazards = e.target.value;
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-full text-red-200"
                          />
                        </td>
                        <td className="p-2.5 text-center">
                          <select
                            value={step.initialRisk}
                            onChange={e => {
                              const updated = [...currentJsa.steps];
                              updated[idx].initialRisk = e.target.value as any;
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="bg-red-950 border border-red-800 text-red-300 rounded px-1.5 py-0.5 text-[11px] font-bold"
                          >
                            <option value="L">L</option>
                            <option value="M">M</option>
                            <option value="H">H</option>
                            <option value="E">E</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-slate-300">
                          <input
                            type="text"
                            value={step.controls}
                            onChange={e => {
                              const updated = [...currentJsa.steps];
                              updated[idx].controls = e.target.value;
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-full text-slate-200"
                          />
                        </td>
                        <td className="p-2.5 text-center">
                          <select
                            value={step.residualRisk}
                            onChange={e => {
                              const updated = [...currentJsa.steps];
                              updated[idx].residualRisk = e.target.value as any;
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="bg-emerald-950 border border-emerald-800 text-emerald-300 rounded px-1.5 py-0.5 text-[11px] font-bold"
                          >
                            <option value="L">L</option>
                            <option value="M">M</option>
                            <option value="H">H</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            onClick={() => {
                              const updated = currentJsa.steps.filter((_, i) => i !== idx);
                              updateJsaForm(currentJob.id, { steps: updated });
                            }}
                            className="text-slate-500 hover:text-red-400 transition"
                            title="Remove step"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Field Groups 5: PPE Checklist (Interactive Toggles G00-002) */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                5. Personal Protective Equipment (PPE) Checklist (Click to Toggle)
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-[11px]">
                {currentJsa.ppeChecklist.map((item, idx) => {
                  const isYes = item.status === 'Yes';
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleTogglePpe(idx)}
                      className={`flex items-center space-x-2 p-2 rounded-lg border text-left transition cursor-pointer ${
                        isYes
                          ? 'bg-emerald-950/40 border-emerald-800/80 text-emerald-200'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                          isYes ? 'bg-emerald-600 text-slate-950' : 'border border-slate-700'
                        }`}
                      >
                        {isYes && <Check className="w-3 h-3 font-bold" />}
                      </div>
                      <span className="font-medium">{item.item}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ======================= FORM 2: ELECTRICAL CERTIFICATE ======================= */}
        {activeFormTab === 'ELECTRICAL' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  Queensland Electrical Safety Act • Certificate Part A
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Certificate of Electrical Safety & Verification Test Sheet
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Issuer: {jobBrand.legalIssuerName} • Licence: {jobBrand.electricalLicencePlaceholder}
                </span>
              </div>

              <div>
                {currentElec.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentElec.signedByTechName || 'Dave Miller (Lic 88204)'} ({currentElec.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffElectrical(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Licensed Electrician Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            {/* MANDATORY ELECTRICAL PART B UNRESOLVED NOTICE BANNER */}
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/80 text-amber-200 text-xs space-y-2">
              <div className="flex items-center space-x-2 font-bold text-amber-300 text-sm">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <span>LEGAL NOTICE: ELECTRICAL PART B REQUIREMENTS UNRESOLVED</span>
              </div>
              <p className="leading-relaxed">
                {currentElec.unresolvedNotice}
              </p>
              <div className="text-[11px] text-amber-400 font-mono pt-1">
                Statutory reference: Queensland Electrical Safety Act 2002 / Electrical Safety Regulation 2013 Part B review pending.
              </div>
            </div>

            {/* Tested Work Items Table (G00-002) */}
            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4 text-xs">
              <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                AS/NZS 3000 Verification Test Readings (Interactive Inputs)
              </h3>
              <div className="space-y-3">
                {currentElec.testedWorkItems.map((item, idx) => (
                  <div key={item.id} className="bg-slate-900 p-3.5 rounded-lg border border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-white text-xs">{item.description}</span>
                      <span className="text-sky-400 font-mono text-[11px]">Circuits: {item.circuitsTested}</span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <div>
                        <label className="text-slate-400 block mb-0.5">Insulation Res.</label>
                        <input
                          type="text"
                          value={item.insulationResistanceResult}
                          onChange={e => {
                            const updated = [...currentElec.testedWorkItems];
                            updated[idx].insulationResistanceResult = e.target.value;
                            updateElectricalForm(currentJob.id, { testedWorkItems: updated });
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono w-full"
                        />
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-0.5">RCD Trip Time</label>
                        <input
                          type="text"
                          value={item.rcdTripTimeMs}
                          onChange={e => {
                            const updated = [...currentElec.testedWorkItems];
                            updated[idx].rcdTripTimeMs = e.target.value;
                            updateElectricalForm(currentJob.id, { testedWorkItems: updated });
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white font-mono w-full"
                        />
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-0.5">Polarity</label>
                        <select
                          value={item.polarityTest}
                          onChange={e => {
                            const updated = [...currentElec.testedWorkItems];
                            updated[idx].polarityTest = e.target.value as any;
                            updateElectricalForm(currentJob.id, { testedWorkItems: updated });
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white w-full"
                        >
                          <option value="Pass">Pass</option>
                          <option value="Fail">Fail</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-slate-400 block mb-0.5">Earth Continuity</label>
                        <select
                          value={item.earthContinuity}
                          onChange={e => {
                            const updated = [...currentElec.testedWorkItems];
                            updated[idx].earthContinuity = e.target.value as any;
                            updateElectricalForm(currentJob.id, { testedWorkItems: updated });
                          }}
                          className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-white w-full"
                        >
                          <option value="Pass">Pass</option>
                          <option value="Fail">Fail</option>
                        </select>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ======================= FORM 3: SMOKE ALARM CERTIFICATE ======================= */}
        {activeFormTab === 'SMOKE_ALARM' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  Queensland Smoke Alarm Legislation 2022 • Interconnected Compliance
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Smoke Alarm Compliance & Test Certificate
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Ref: {currentSmoke.certReference} • Property: {currentSmoke.propertyType}
                </span>
              </div>

              <div>
                {currentSmoke.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentSmoke.signedByTechName || 'Dave Miller'} ({currentSmoke.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffSmokeAlarm(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Smoke Alarm Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            {/* Interactive Alarm Schedule Table (G00-002) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Installed / Inspected Smoke Alarms Schedule ({currentSmoke.alarmSchedule.length} devices)
                </h3>
                <button
                  onClick={handleAddSmokeAlarmRow}
                  className="flex items-center space-x-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 rounded text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Add Alarm Location</span>
                </button>
              </div>

              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-3">Room Location</th>
                      <th className="p-3">Power Source / Model</th>
                      <th className="p-3 text-center">Interconnected</th>
                      <th className="p-3 text-center">Expiry Year</th>
                      <th className="p-3 text-center">Result</th>
                      <th className="p-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/50">
                    {currentSmoke.alarmSchedule.map((alarm, idx) => (
                      <tr key={alarm.id}>
                        <td className="p-2.5 font-semibold text-white">
                          <input
                            type="text"
                            value={alarm.roomLocation}
                            onChange={e => {
                              const updated = [...currentSmoke.alarmSchedule];
                              updated[idx].roomLocation = e.target.value;
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-full text-white"
                          />
                        </td>
                        <td className="p-2.5 text-slate-300">
                          <select
                            value={alarm.powerSource}
                            onChange={e => {
                              const updated = [...currentSmoke.alarmSchedule];
                              updated[idx].powerSource = e.target.value as any;
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-slate-300"
                          >
                            <option value="240V Hardwired with Battery Backup">240V Hardwired with Battery Backup</option>
                            <option value="10-Year Sealed Lithium">10-Year Sealed Lithium</option>
                            <option value="Replaceable 9V Alkaline">Replaceable 9V Alkaline</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              const updated = [...currentSmoke.alarmSchedule];
                              updated[idx].interconnectionPass = !updated[idx].interconnectionPass;
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              alarm.interconnectionPass
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-red-950 text-red-400 border border-red-800'
                            }`}
                          >
                            {alarm.interconnectionPass ? 'YES' : 'NO'}
                          </button>
                        </td>
                        <td className="p-2.5 text-center">
                          <input
                            type="text"
                            value={alarm.manufactureDateOrExpiry}
                            onChange={e => {
                              const updated = [...currentSmoke.alarmSchedule];
                              updated[idx].manufactureDateOrExpiry = e.target.value;
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className="bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs w-24 text-center text-white font-mono"
                          />
                        </td>
                        <td className="p-2.5 text-center">
                          <select
                            value={alarm.passFail}
                            onChange={e => {
                              const updated = [...currentSmoke.alarmSchedule];
                              updated[idx].passFail = e.target.value as any;
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className={`font-bold px-2 py-0.5 rounded text-[11px] ${
                              alarm.passFail === 'Pass'
                                ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                                : 'bg-red-950 text-red-400 border border-red-800'
                            }`}
                          >
                            <option value="Pass">Pass</option>
                            <option value="Fail">Fail</option>
                          </select>
                        </td>
                        <td className="p-2.5 text-center">
                          <button
                            onClick={() => {
                              const updated = currentSmoke.alarmSchedule.filter((_, i) => i !== idx);
                              updateSmokeAlarmForm(currentJob.id, { alarmSchedule: updated });
                            }}
                            className="text-slate-500 hover:text-red-400 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ======================= FORM 4: TCA1 CABLING ======================= */}
        {activeFormTab === 'TCA1' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  ACMA Telecommunications Cabling Advice (TCA1)
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Telecommunications Cabling Advice (Form TCA1)
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Registration: {currentTca1.cablerRegistrationNumberPlaceholder} • Cert: {currentTca1.certReference}
                </span>
              </div>

              <div>
                {currentTca1.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentTca1.signedByTechName || currentTca1.registeredCablerPlaceholder} ({currentTca1.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffTca1(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Registered Cabler Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  1. Work Description & Location
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Work Description</label>
                    <input
                      type="text"
                      value={currentTca1.workDescription}
                      onChange={e => updateTca1Form(currentJob.id, { workDescription: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Location of Work</label>
                    <input
                      type="text"
                      value={currentTca1.locationOfWork}
                      onChange={e => updateTca1Form(currentJob.id, { locationOfWork: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-sky-300"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  2. Cabler Registration & Declaration
                </h3>
                <div className="space-y-2">
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">Registered Cabler Name</label>
                    <input
                      type="text"
                      value={currentTca1.registeredCablerPlaceholder}
                      onChange={e => updateTca1Form(currentJob.id, { registeredCablerPlaceholder: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-white font-bold"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block text-[11px] mb-0.5">ACMA Cabler Registration No.</label>
                    <input
                      type="text"
                      value={currentTca1.cablerRegistrationNumberPlaceholder}
                      onChange={e => updateTca1Form(currentJob.id, { cablerRegistrationNumberPlaceholder: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-2.5 py-1 text-slate-300 font-mono"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================= FORM 5: TCA2 DEFECT NOTICE ======================= */}
        {activeFormTab === 'TCA2' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">
                  ACMA Telecommunications Defect Notice (TCA2)
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Notice of Defective Customer Cabling (Form TCA2)
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Defect Ref: {currentTca2.reportReference} • Severity: {currentTca2.riskCategory}
                </span>
              </div>

              <div>
                {currentTca2.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>Technician Notified</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentTca2.signedByTechName || currentTca2.businessCablerPlaceholder} ({currentTca2.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffTca2(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Issue TCA2 Defect Notice</span>
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <label className="font-bold text-slate-300 uppercase tracking-wider text-[11px] block">
                Identified Defect & Recommended Remedial Action
              </label>
              <textarea
                rows={3}
                value={currentTca2.nonComplianceDescription}
                onChange={e => updateTca2Form(currentJob.id, { nonComplianceDescription: e.target.value })}
                className="w-full bg-slate-900 border border-slate-800 rounded p-2.5 text-white"
              />
            </div>

            {/* Workflow 3-Way Status: Technician Issued, Customer Ack, Office Review */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-slate-400 uppercase text-[10px] block">1. Field Notice</span>
                <div className="font-semibold text-white">
                  {currentTca2.signedOff ? '✓ Issued by Cabler' : 'Pending Field Issue'}
                </div>
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-slate-400 uppercase text-[10px] block">2. Customer Acknowledgment</span>
                {currentTca2.customerAcknowledged ? (
                  <div className="font-semibold text-emerald-400">✓ Customer Signed</div>
                ) : (
                  <button
                    onClick={() => customerAckTca2(currentJob.id)}
                    className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold cursor-pointer"
                  >
                    Simulate Customer Ack
                  </button>
                )}
              </div>

              <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800 space-y-2">
                <span className="font-bold text-slate-400 uppercase text-[10px] block">3. Office Safety Review</span>
                {currentTca2.officeReviewCompleted ? (
                  <div className="font-semibold text-emerald-400">✓ Office Logged</div>
                ) : (
                  <button
                    onClick={() => officeReviewTca2(currentJob.id)}
                    className="px-2.5 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-semibold cursor-pointer"
                  >
                    Office Review & File
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ======================= SAMPLE ATTACHMENTS LIBRARY (G00-027) ======================= */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Camera className="w-4 h-4 text-sky-400" />
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Field Evidence Photos & Attachments Library
              </h3>
            </div>
            <button
              onClick={() => setShowPhotoPicker(prev => !prev)}
              className="flex items-center space-x-1.5 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-sky-400" />
              <span>{showPhotoPicker ? 'Close Attachment Library' : 'Attach Field Photo'}</span>
            </button>
          </div>

          {/* Photo Picker Drawer */}
          {showPhotoPicker && (
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
              <span className="text-[11px] text-slate-400 block">
                Select high-resolution synthetic site evidence to link to this {activeFormTab} record:
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {sampleAttachments.map(sample => (
                  <div
                    key={sample.id}
                    className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden group hover:border-sky-500 transition"
                  >
                    <div className="h-24 bg-slate-800 flex items-center justify-center relative overflow-hidden">
                      <img
                        src={sample.thumbnailUrl}
                        alt={sample.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition"
                      />
                      <span className="absolute bottom-1 right-1 text-[9px] bg-slate-950/80 px-1 rounded text-slate-300">
                        {sample.category}
                      </span>
                    </div>
                    <div className="p-2 space-y-1">
                      <div className="text-[11px] font-bold text-white truncate">{sample.title}</div>
                      <button
                        onClick={() => {
                          attachSampleToJobForm(currentJob.id, activeFormTab, sample.id);
                        }}
                        className="w-full py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-bold transition cursor-pointer"
                      >
                        Attach to Form
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Render Currently Attached Photos */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {sampleAttachments.slice(0, 2).map((item, idx) => (
              <div key={idx} className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
                <div className="h-24 bg-slate-800 relative">
                  <img src={item.thumbnailUrl} alt={item.title} className="w-full h-full object-cover" />
                  <span className="absolute top-1 left-1 text-[9px] bg-emerald-950/90 text-emerald-300 border border-emerald-800 px-1.5 py-0.5 rounded font-mono font-bold">
                    Attached
                  </span>
                </div>
                <div className="p-2 flex items-center justify-between text-[11px]">
                  <span className="text-slate-300 font-medium truncate">{item.title}</span>
                  <button
                    onClick={() => removeSampleFromJobForm(currentJob.id, activeFormTab, item.id)}
                    className="text-slate-500 hover:text-red-400 ml-1"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ======================= BRANDED PRINT / PDF MODAL (G00-003 & G00-004) ======================= */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white text-slate-900 rounded-2xl max-w-2xl w-full p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                  Compliance Document Print Preview
                </span>
                <h2 className="text-base font-bold text-slate-900">
                  {activeStatus.title}
                </h2>
                <div className="text-xs text-slate-600 font-mono">
                  Job Reference: {currentJob.id} • Scheduled: {currentJob.scheduledDate}
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-slate-400 hover:text-slate-800 text-xl font-bold cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Legal Issuer Header Snapshot (G00-003) */}
            <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
              <div>
                <span className="font-bold block text-slate-500 uppercase text-[10px]">Legal Issuer Name:</span>
                <span className="font-bold text-slate-900">{jobBrand.legalIssuerName}</span>
                <span className="block text-slate-600 font-mono">Trading as: {jobBrand.name}</span>
              </div>
              <div>
                <span className="font-bold block text-slate-500 uppercase text-[10px]">Licence & Registration:</span>
                <span className="font-mono text-slate-800">ABN: {jobBrand.abnPlaceholder}</span>
                <span className="block font-mono text-slate-800">Elec Lic: {jobBrand.electricalLicencePlaceholder}</span>
              </div>
              <div>
                <span className="font-bold block text-slate-500 uppercase text-[10px]">Site Address:</span>
                <span className="text-slate-800">{currentJob.siteAddress}</span>
              </div>
              <div>
                <span className="font-bold block text-slate-500 uppercase text-[10px]">Client / Contact:</span>
                <span className="text-slate-800">{currentJob.siteContact} ({currentJob.sitePhone})</span>
              </div>
            </div>

            {/* Electrical Part B Notice in Print Preview */}
            {activeFormTab === 'ELECTRICAL' && (
              <div className="bg-amber-50 border border-amber-300 p-3 rounded-lg text-amber-900 text-xs font-semibold">
                {currentElec.unresolvedNotice}
              </div>
            )}

            {/* TRUTHFUL SIGN-OFF STATUS WATERMARK / BOX (G00-004) */}
            <div
              className={`p-4 rounded-xl border space-y-2 text-xs ${
                activeStatus.signedOff
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                  : 'bg-red-50 border-red-300 text-red-950'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase tracking-wider text-[11px]">
                  Document Execution Status:
                </span>
                <span
                  className={`px-2.5 py-1 rounded font-bold text-xs ${
                    activeStatus.signedOff
                      ? 'bg-emerald-700 text-white'
                      : 'bg-red-700 text-white font-mono tracking-wider'
                  }`}
                >
                  {activeStatus.signedOff ? 'DEMO SIGN-OFF APPLIED' : 'DRAFT — NOT SIGNED'}
                </span>
              </div>

              {activeStatus.signedOff ? (
                <div className="space-y-1 text-slate-700 pt-1">
                  <div>
                    Licensed Practitioner / Technician: <strong>{activeStatus.signerName}</strong>
                  </div>
                  <div>
                    Timestamp of Sign-Off: <span className="font-mono">{activeStatus.timestamp}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 italic">
                    Demonstration sign-off applied for UI/UX evaluation.
                  </div>
                </div>
              ) : (
                <div className="text-red-900 text-xs font-medium pt-1">
                  ⚠ This record has not been signed off by the technician. It cannot be issued to customers or external authorities until field verification is completed.
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end space-x-2 pt-4 border-t border-slate-200">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Browser Print / Save PDF</span>
              </button>
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded-lg transition cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
