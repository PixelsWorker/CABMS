/**
 * Area F: Mobile Technician Forms & Compliance Documents
 * JSA, Electrical Certificate, Smoke Alarm Certificate, TCA1, and TCA2.
 * Includes sanitised field groups, sample attachment library, DEMO sign-offs,
 * and branded print-ready document preview.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
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
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    activeBrand,
    persona,
    jsaForms,
    electricalCerts,
    smokeAlarmCerts,
    tca1Certs,
    tca2Certs,
    signOffJsa,
    signOffElectrical,
    signOffSmokeAlarm,
    signOffTca1,
    signOffTca2,
    customerAckTca2,
    officeReviewTca2,
    sampleAttachments,
  } = useCabms();

  const [activeFormTab, setActiveFormTab] = useState<ActiveFormType>('JSA');
  const [showPrintModal, setShowPrintModal] = useState(false);
  const [selectedPhotoAttachment, setSelectedPhotoAttachment] = useState<string | null>(null);

  // Target job
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  const currentJsa = jsaForms[currentJob.id] || {
    ...jsaForms['JOB-2026-101'],
    jobReference: currentJob.id,
    customerName: currentJob.siteContact,
    siteAddress: currentJob.siteAddress,
  };

  const currentElec = electricalCerts[currentJob.id] || {
    ...electricalCerts['JOB-2026-103'],
    jobReference: currentJob.id,
    customerName: currentJob.siteContact,
    installationAddress: currentJob.siteAddress,
  };

  const currentSmoke = smokeAlarmCerts[currentJob.id] || {
    ...smokeAlarmCerts['JOB-2026-101'],
    jobReference: currentJob.id,
  };

  const currentTca1 = tca1Certs[currentJob.id] || {
    ...tca1Certs['JOB-2026-104'],
    jobReference: currentJob.id,
  };

  const currentTca2 = tca2Certs[currentJob.id] || {
    ...tca2Certs['JOB-2026-104'],
    jobReference: currentJob.id,
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
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} — {j.title} ({j.brandId})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center space-x-2 text-slate-400">
            <span>Site: <strong className="text-white">{currentJob.siteAddress}</strong></span>
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
                  Revision: {currentJsa.formRevision} • Issuer: {currentJsa.issuerPlaceholder}
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
                        {currentJsa.signedByTechName} ({currentJsa.signedTimestamp})
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

            {/* Field Groups 1 & 2: Site Details & Personnel */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  1. Job & Site Details
                </h3>
                <div className="space-y-1 text-slate-300">
                  <div>Job Ref: <strong className="text-white font-mono">{currentJsa.jobReference}</strong></div>
                  <div>Customer: <span className="text-white">{currentJsa.customerName}</span></div>
                  <div>Site Contact Placeholder: <span className="text-slate-400">{currentJsa.siteContactPlaceholder}</span></div>
                  <div>Site Address: <span className="text-slate-300">{currentJsa.siteAddress}</span></div>
                  <div>Identified Assets: <span className="text-sky-300">{currentJsa.assetsIdentified}</span></div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  2. Personnel & Competency
                </h3>
                <div className="space-y-1 text-slate-300">
                  <div>Personnel: <strong className="text-white">{currentJsa.personnelName}</strong> ({currentJsa.personnelRole})</div>
                  <div>Licence Placeholder: <span className="font-mono text-slate-400">{currentJsa.licencePlaceholder} (Exp: {currentJsa.licenceExpiryPlaceholder})</span></div>
                  <div className="flex items-center space-x-4 pt-1 text-[11px]">
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Site Induction Completed
                    </span>
                    <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Competencies Verified
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Field Groups 3 & 4: Risk Matrix & Task Steps */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  3 & 4. Task Steps, Hazards & Controls Matrix (L/M/H/E)
                </h3>
                <span className="text-[11px] text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded font-bold">
                  Overall Residual Risk: Low (L)
                </span>
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
                      <th className="p-3">Responsible</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/50">
                    {currentJsa.steps.map(step => (
                      <tr key={step.id}>
                        <td className="p-3 font-semibold text-white">{step.taskStep}</td>
                        <td className="p-3 text-red-300">{step.hazards}</td>
                        <td className="p-3 text-center">
                          <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-red-950 text-red-400 border border-red-800">
                            {step.initialRisk}
                          </span>
                        </td>
                        <td className="p-3 text-slate-300">{step.controls}</td>
                        <td className="p-3 text-center">
                          <span className="px-1.5 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                            {step.residualRisk}
                          </span>
                        </td>
                        <td className="p-3 text-slate-400 font-mono text-[11px]">{step.responsibleRole}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Field Groups 5 & 6: PPE & Isolations */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  5. Personal Protective Equipment (PPE) Checklist
                </h3>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  {currentJsa.ppeChecklist.map((item, idx) => (
                    <div key={idx} className="flex items-center space-x-1.5 text-slate-300">
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{item.item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  6. Isolations, Permits & High-Risk Items
                </h3>
                <div className="space-y-1.5 text-[11px]">
                  {currentJsa.isolationsAndPermits.map((iso, idx) => (
                    <div key={idx} className="flex items-center justify-between text-slate-300 border-b border-slate-800/60 pb-1">
                      <span>{iso.item}</span>
                      <span className="font-mono text-sky-400">{iso.referenceOrNotes}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Field Groups 7 & 8: Emergency Preparedness & Sign-off Rows */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                7 & 8. Emergency Preparedness & Fictional Sign-Off
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-slate-300 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Assembly Area:</span>
                  <span className="text-white">{currentJsa.emergencyAssemblyArea}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Emergency Warden:</span>
                  <span className="text-slate-300">{currentJsa.emergencyWardenPlaceholder}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">First Aid Officer:</span>
                  <span className="text-slate-300">{currentJsa.firstAidOfficerPlaceholder}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================= FORM 2: ELECTRICAL CERTIFICATE ======================= */}
        {activeFormTab === 'ELECTRICAL' && (
          <div className="space-y-6">
            {/* MANDATORY PERSISTENT NOTICE PER SPECIFICATION */}
            <div className="p-4 rounded-xl bg-amber-950/70 border border-amber-700 text-amber-200 text-xs space-y-1.5">
              <div className="flex items-center space-x-2 font-bold text-amber-400 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>MANDATORY PERSISTENT NOTICE (Source Boundary)</span>
              </div>
              <p className="leading-relaxed font-semibold">
                {currentElec.unresolvedNotice}
              </p>
              <p className="text-[11px] text-amber-300/80">
                This notice remains visible even after applying the technician DEMO sign-off. Part B sections 7-8 were not supplied in the original text extracts and are not manufactured.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
                  Queensland Electrical Safety Act • Part A Testing
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Certificate of Electrical Safety & Verification
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Cert Ref: {currentElec.certReference} • Tested: {currentElec.dateOfTest}
                </span>
              </div>

              <div>
                {currentElec.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentElec.signedByTechName} ({currentElec.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffElectrical(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Electrician DEMO Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            {/* Test Work Items Table */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Description of Electrical Work Performed & Tested (Pass/Fail)
              </h3>
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-3">Work Description</th>
                      <th className="p-3">Circuit Tested</th>
                      <th className="p-3">Insulation Resistance</th>
                      <th className="p-3 text-center">Polarity</th>
                      <th className="p-3 text-center">Earth Cont.</th>
                      <th className="p-3">RCD Trip Time</th>
                      <th className="p-3 text-center">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/50">
                    {currentElec.testedWorkItems.map(item => (
                      <tr key={item.id}>
                        <td className="p-3 font-semibold text-white">{item.description}</td>
                        <td className="p-3 text-slate-400">{item.circuitsTested}</td>
                        <td className="p-3 font-mono text-sky-400">{item.insulationResistanceResult}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{item.polarityTest}</td>
                        <td className="p-3 text-center font-bold text-emerald-400">{item.earthContinuity}</td>
                        <td className="p-3 font-mono text-slate-300">{item.rcdTripTimeMs}</td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                            {item.workResult}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Standards Relied On */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
              <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                Standards & Documents Relied On
              </h3>
              <ul className="space-y-1 text-slate-300 text-[11px]">
                {currentElec.standardsReliedOn.map((std, idx) => (
                  <li key={idx} className="flex items-center space-x-2">
                    <span className="text-sky-400 font-bold">•</span>
                    <span>{std}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 italic">
                {currentElec.partACertificationPlaceholder}
              </p>
            </div>
          </div>
        )}

        {/* ======================= FORM 3: SMOKE ALARM CERTIFICATE ======================= */}
        {activeFormTab === 'SMOKE_ALARM' && (
          <div className="space-y-6">
            <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 flex items-start space-x-2">
              <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold">Provisional Notice:</span> {currentSmoke.provisionalNote}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
                  Queensland Fire and Emergency Services • AS 3786:2014
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  Smoke Alarm Compliance & Testing Certificate
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Cert Ref: {currentSmoke.certReference} • Property: {currentSmoke.propertyType} ({currentSmoke.storeys} Storeys, {currentSmoke.bedrooms} Bedrooms)
                </span>
              </div>

              <div>
                {currentSmoke.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentSmoke.signedByTechName} ({currentSmoke.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffSmokeAlarm(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Smoke Alarm DEMO Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            {/* Alarm Schedule Table with Pass/Fail and provisional replacement date */}
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Repeatable Alarm Schedule & Operational Tests
              </h3>
              <div className="overflow-x-auto border border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
                    <tr>
                      <th className="p-3">Location / Room</th>
                      <th className="p-3">Brand & Model</th>
                      <th className="p-3">Power Source</th>
                      <th className="p-3">Expiry Date (Provisional)</th>
                      <th className="p-3 text-center">Button Test</th>
                      <th className="p-3 text-center">Interconnect</th>
                      <th className="p-3 text-center">Pass / Fail</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 bg-slate-950/50">
                    {currentSmoke.alarmSchedule.map(alarm => (
                      <tr key={alarm.id}>
                        <td className="p-3 font-semibold text-white">{alarm.roomLocation}</td>
                        <td className="p-3 text-slate-300">{alarm.alarmBrandModel}</td>
                        <td className="p-3 text-slate-400 text-[11px]">{alarm.powerSource}</td>
                        <td className="p-3 font-mono text-sky-400">{alarm.manufactureDateOrExpiry}</td>
                        <td className="p-3 text-center text-emerald-400 font-bold">Pass</td>
                        <td className="p-3 text-center text-emerald-400 font-bold">Pass</td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded font-bold text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800">
                            {alarm.passFail}
                          </span>
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
            <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 flex items-start space-x-2">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-white">ACMA Telecommunications Act:</span> {currentTca1.unresolvedRegistrationExpiryNotice}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                  ACMA Form TCA1 • Telecommunications Cabling Advice
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  TCA1 Cabling Compliance Certificate
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Ref: {currentTca1.certReference} • Cabler: {currentTca1.registeredCablerPlaceholder}
                </span>
              </div>

              <div>
                {currentTca1.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>DEMO Sign-off Applied</div>
                      <div className="text-[10px] text-slate-400 font-mono">
                        {currentTca1.signedByTechName} ({currentTca1.signedTimestamp})
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffTca1(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Apply Cabler DEMO Sign-off</span>
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                Cabling Work & Supervision Details
              </h3>
              <div className="space-y-2 text-slate-300">
                <div>Description: <strong className="text-white">{currentTca1.workDescription}</strong></div>
                <div>Location: <span className="text-slate-300">{currentTca1.locationOfWork}</span></div>
                <div>Supervision: <span className="text-emerald-400 font-bold">Yes — Open Registration Supervised</span></div>
              </div>
              <p className="text-[11px] text-slate-400 pt-2 border-t border-slate-800/80 italic">
                {currentTca1.certificationPlaceholderText}
              </p>
            </div>
          </div>
        )}

        {/* ======================= FORM 5: TCA2 CABLING NON-COMPLIANCE ======================= */}
        {activeFormTab === 'TCA2' && (
          <div className="space-y-6">
            <div className="p-4 rounded-xl bg-red-950/70 border border-red-700 text-red-200 text-xs space-y-1.5">
              <div className="flex items-center space-x-2 font-bold text-red-400 text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>NON-COMPLIANCE NOTICE (ACMA TCA2)</span>
              </div>
              <p className="leading-relaxed font-semibold">
                {currentTca2.warningNotice}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
                  ACMA Form TCA2 • Telecommunications Cabling Advice (Non-Compliance)
                </span>
                <h2 className="text-lg font-bold text-white mt-0.5">
                  TCA2 Cabling Defect & Rectification Notice
                </h2>
                <span className="text-xs text-slate-400 font-mono">
                  Report Ref: {currentTca2.reportReference} • Urgency: {currentTca2.urgencyLevel}
                </span>
              </div>

              <div>
                {currentTca2.signedOff ? (
                  <div className="bg-emerald-950/80 border border-emerald-800 text-emerald-300 px-3 py-2 rounded-lg text-xs font-semibold flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <div>
                      <div>Technician Signed</div>
                      <div className="text-[10px] text-slate-400 font-mono">{currentTca2.signedTimestamp}</div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => signOffTca2(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer"
                  >
                    Apply Technician DEMO Sign-off
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  Non-Compliance Defect Details
                </h3>
                <div className="space-y-1.5 text-slate-300">
                  <div>Scope: <span className="text-white font-medium">{currentTca2.cablingScope}</span></div>
                  <div>Locations: <span className="text-white font-medium">{currentTca2.locationsInspected}</span></div>
                  <div>Standard Clause: <span className="font-mono text-amber-400">{currentTca2.requirementReferencePlaceholder}</span></div>
                  <div>Risk Category: <span className="font-bold text-red-400">{currentTca2.riskCategory}</span></div>
                  <div className="pt-2 text-slate-300">{currentTca2.nonComplianceDescription}</div>
                </div>
              </div>

              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                  Rectification Recommendation & Responsible Party
                </h3>
                <div className="space-y-1.5 text-slate-300">
                  <div>Responsible Party: <span className="text-white font-medium">{currentTca2.responsibleParty}</span></div>
                  <div>Recommendation: <span className="text-sky-300">{currentTca2.rectificationRecommendation}</span></div>
                  <div>Target Date: <span className="font-mono text-white">{currentTca2.targetResolutionDate}</span></div>
                </div>

                {/* Customer Ack and Office Review Buttons */}
                <div className="pt-2 border-t border-slate-800 flex flex-wrap gap-2">
                  {!currentTca2.customerAcknowledged ? (
                    <button
                      onClick={() => customerAckTca2(currentJob.id)}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold text-xs transition cursor-pointer"
                    >
                      Record Customer Acknowledgement
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="w-4 h-4" /> Customer Acknowledged ({currentTca2.customerAckTimestamp})
                    </span>
                  )}

                  {!currentTca2.officeReviewCompleted ? (
                    <button
                      onClick={() => officeReviewTca2(currentJob.id)}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded font-semibold text-xs transition cursor-pointer"
                    >
                      Complete Office Review
                    </button>
                  ) : (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1">
                      <Check className="w-4 h-4" /> Office Review Completed ({currentTca2.officeReviewTimestamp})
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Safe Sample Photo Attachment Library */}
        <div className="pt-4 border-t border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
              <Camera className="w-4 h-4 text-sky-400" />
              <span>Synthetic Sample Photo Attachment Library (In-App)</span>
            </h3>
            <span className="text-[11px] text-slate-500">
              Safe demo assets • No real device camera or storage access
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {sampleAttachments.map(att => (
              <div
                key={att.id}
                onClick={() => setSelectedPhotoAttachment(att.id)}
                className="bg-slate-950 border border-slate-800 rounded-lg p-2.5 hover:border-sky-500 transition cursor-pointer space-y-1.5"
              >
                <img
                  src={att.thumbnailUrl}
                  alt={att.title}
                  className="w-full h-24 object-cover rounded bg-slate-900 border border-slate-800"
                />
                <div className="font-semibold text-white text-[11px] truncate">{att.title}</div>
                <div className="text-[10px] text-slate-500 truncate">{att.filename}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Branded Print / PDF Preview Modal */}
      {showPrintModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white text-slate-900 rounded-xl max-w-3xl w-full p-8 shadow-2xl space-y-6 my-8">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <div className="text-xs font-bold tracking-widest text-slate-500 uppercase">
                  DEMO — NO LIVE INTEGRATIONS • PRINTABLE PREVIEW
                </div>
                <h2 className="text-xl font-black text-slate-900">
                  {activeBrand.name} — Compliance Document Snapshot
                </h2>
                <div className="text-xs text-slate-600 font-mono">
                  Job: {currentJob.id} • Date: {currentJob.scheduledDate}
                </div>
              </div>
              <button
                onClick={() => setShowPrintModal(false)}
                className="text-slate-400 hover:text-slate-800 text-xl font-bold"
              >
                ✕
              </button>
            </div>

            {/* Document Body */}
            <div className="space-y-4 text-xs text-slate-800">
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded border">
                <div>
                  <span className="font-bold block text-slate-600">Installation Address:</span>
                  <span>{currentJob.siteAddress}</span>
                </div>
                <div>
                  <span className="font-bold block text-slate-600">Client / Contact:</span>
                  <span>{currentJob.siteContact}</span>
                </div>
                <div>
                  <span className="font-bold block text-slate-600">Legal Issuer Placeholder:</span>
                  <span>{activeBrand.legalIssuerName}</span>
                </div>
                <div>
                  <span className="font-bold block text-slate-600">Licence / ABN:</span>
                  <span>{activeBrand.abnPlaceholder} | {activeBrand.electricalLicencePlaceholder}</span>
                </div>
              </div>

              {activeFormTab === 'ELECTRICAL' && (
                <div className="bg-amber-50 border border-amber-300 p-3 rounded text-amber-900 font-semibold text-xs">
                  {currentElec.unresolvedNotice}
                </div>
              )}

              <div className="border rounded p-4 space-y-2">
                <span className="font-bold text-slate-700 block uppercase tracking-wider text-[11px]">
                  Document Status & DEMO Sign-Off Snapshot
                </span>
                <div className="flex items-center justify-between text-xs">
                  <span>Sign-off Status: <strong className="text-emerald-700">DEMO Sign-Off Applied</strong></span>
                  <span className="font-mono text-slate-600">Timestamp: 2026-11-02 09:30 UTC+10</span>
                </div>
                <div className="text-[10px] text-slate-500 pt-2 border-t">
                  This document rendering represents an in-browser demo print preview. Browser Print / Save PDF provides safe static output without external service dependencies.
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-4 border-t">
              <button
                onClick={() => window.print()}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded transition flex items-center space-x-1.5 cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>Browser Print / Save PDF</span>
              </button>
              <button
                onClick={() => setShowPrintModal(false)}
                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 font-semibold text-xs rounded transition cursor-pointer"
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
