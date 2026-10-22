/**
 * Area A: Shared Shell & Operational Dashboard
 * Real-time operational overview across the three brands with quick actions and stats
 */

import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import {
  Briefcase,
  Users,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Database,
  Building2,
  Inbox,
  FileCheck2,
  FileText,
} from 'lucide-react';
import { JobStatus } from '../types/cabms.ts';

export const DashboardView: React.FC = () => {
  const {
    activeBrand,
    activeBrandId,
    setActiveBrandId,
    brands,
    persona,
    jobs,
    customers,
    websiteEnquiries,
    myobConnection,
    setActiveTab,
    setSelectedJobId,
    demoClock,
  } = useCabms();

  // Filter jobs by active brand (or all if Super Admin)
  const brandJobs = jobs.filter(j => j.brandId === activeBrandId);
  const pendingSyncs = customers.filter(c => c.syncStatus !== 'SYNCED').length;
  const pendingEnquiries = websiteEnquiries.filter(e => e.brandId === activeBrandId && e.status === 'PENDING_REVIEW').length;
  const inProgressJobs = brandJobs.filter(j => j.status === 'IN_PROGRESS').length;
  const needsRevisitJobs = brandJobs.filter(j => j.status === 'NEEDS_REVISIT').length;
  const completedJobs = brandJobs.filter(j => j.status === 'COMPLETED').length;

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'NEW':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-950 text-sky-300 border border-sky-800">New</span>;
      case 'SCHEDULED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">Scheduled</span>;
      case 'IN_PROGRESS':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950 text-amber-300 border border-amber-800">In Progress</span>;
      case 'NEEDS_REVISIT':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-950 text-red-300 border border-red-800">Needs Revisit</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">Completed</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-400 border border-slate-700">Cancelled</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Brand Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center font-black text-2xl text-white shadow-inner"
              style={{ backgroundColor: activeBrand.primaryColor }}
            >
              {activeBrand.name.charAt(0)}
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold text-white tracking-tight">{activeBrand.name}</h1>
                <span className="text-xs px-2 py-0.5 rounded font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  {activeBrand.abnPlaceholder}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">{activeBrand.tagline}</p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-2">
                <span>Licence: <strong className="text-slate-300">{activeBrand.electricalLicencePlaceholder}</strong></span>
                <span>•</span>
                <span>Cabler: <strong className="text-slate-300">{activeBrand.acmaCablerPlaceholder}</strong></span>
                <span>•</span>
                <span>MYOB File: <strong className="text-sky-400">{myobConnection.companyId}</strong></span>
              </div>
            </div>
          </div>

          {/* Quick Brand Switcher Pills */}
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800 self-start md:self-auto">
            {Object.values(brands).map(b => (
              <button
                key={b.id}
                onClick={() => setActiveBrandId(b.id)}
                className={`px-2.5 py-1 text-xs font-semibold rounded-md transition cursor-pointer ${
                  activeBrandId === b.id
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {b.name.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>In-Progress Jobs</span>
            <Briefcase className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white mt-2">{inProgressJobs}</div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span className="text-emerald-400 font-semibold">{completedJobs}</span> completed this week
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Needs Revisit</span>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black text-red-400 mt-2">{needsRevisitJobs}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Cabling defect (TCA2) logged
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>MYOB Write-Through</span>
            <Database className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-black text-sky-300 mt-2">
            {myobConnection.status === 'CONNECTED' ? 'Online' : 'Offline'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            {pendingSyncs > 0 ? `${pendingSyncs} draft awaiting sync` : 'All customer records synced'}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
            <span>Website Enquiries</span>
            <Inbox className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-2">{pendingEnquiries}</div>
          <div className="text-[11px] text-slate-400 mt-1">
            Section J website handoff inbox
          </div>
        </div>
      </div>

      {/* Two-Column Section: Operational Jobs & Quick Simulation Flows */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Jobs Table */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">
                {activeBrand.name} Operational Jobs
              </h2>
              <p className="text-xs text-slate-400">Current work orders and compliance requirements</p>
            </div>
            <button
              onClick={() => setActiveTab('jobs')}
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold cursor-pointer"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {brandJobs.map(job => (
              <div
                key={job.id}
                onClick={() => {
                  setSelectedJobId(job.id);
                  setActiveTab('jobs');
                }}
                className="bg-slate-950/70 hover:bg-slate-800/80 border border-slate-800 rounded-lg p-3.5 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-slate-300">{job.id}</span>
                    <span className="text-white font-semibold text-xs md:text-sm">{job.title}</span>
                    {getStatusBadge(job.status)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1">
                    Site: {job.siteAddress} • Contact: {job.siteContact}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {job.isDirectToInvoice ? (
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        Direct-to-Invoice (No Forms)
                      </span>
                    ) : (
                      job.formsRequired.map(f => (
                        <span key={f} className="text-[10px] bg-amber-950/60 text-amber-300 border border-amber-800/60 px-1.5 py-0.5 rounded font-mono">
                          Req: {f}
                        </span>
                      ))
                    )}
                    <span className="text-[11px] text-slate-500">
                      Tech: {job.assignedTechName || 'Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="text-right sm:self-center">
                  <div className="text-xs font-semibold text-slate-300">
                    {job.scheduledDate} {job.scheduledTime}
                  </div>
                  <span className="text-[11px] text-sky-400 hover:underline">
                    Open Job Details →
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Guided Demo Scenarios & Quick Actions */}
        <div className="space-y-4">
          {/* Quick Actions Panel */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3">
              Guided Demo Journeys (A–J)
            </h2>
            <div className="space-y-2 text-xs">
              <button
                onClick={() => {
                  setSelectedJobId('JOB-2026-101');
                  setActiveTab('jobs');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 flex items-start space-x-2 transition cursor-pointer"
              >
                <FileCheck2 className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-white">1. Complete Job Journey</div>
                  <div className="text-slate-400 text-[11px]">
                    Walkthrough JSA & Smoke Alarm sign-off, completion validation, quote acceptance & review automation.
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setSelectedJobId('JOB-2026-102');
                  setActiveTab('jobs');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 flex items-start space-x-2 transition cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-white">2. Direct-to-Invoice Journey</div>
                  <div className="text-slate-400 text-[11px]">
                    Emergency service job with 0 compliance forms, completing immediately into MYOB invoice draft.
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setSelectedJobId('JOB-2026-104');
                  setActiveTab('jobs');
                }}
                className="w-full text-left p-2.5 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 flex items-start space-x-2 transition cursor-pointer"
              >
                <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-white">3. TCA1/TCA2 Cabling Defect</div>
                  <div className="text-slate-400 text-[11px]">
                    High-risk defect logging with photo attachment, customer ack and office rectification review.
                  </div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('customers')}
                className="w-full text-left p-2.5 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 flex items-start space-x-2 transition cursor-pointer"
              >
                <Users className="w-4 h-4 text-sky-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-white">4. MYOB Write-Through Simulation</div>
                  <div className="text-slate-400 text-[11px]">
                    Single MYOB customer master shared across brands with duplicate detection & reconciliation.
                  </div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('website_inbox')}
                className="w-full text-left p-2.5 rounded-lg bg-slate-950/80 hover:bg-slate-800 border border-slate-800 flex items-start space-x-2 transition cursor-pointer"
              >
                <Inbox className="w-4 h-4 text-purple-400 mt-0.5 shrink-0" />
                <div>
                  <div className="font-semibold text-white">5. Existing-Site Submission (Handoff)</div>
                  <div className="text-slate-400 text-[11px]">
                    Simulate public website enquiry, office duplicate check and manual conversion to draft job.
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* Compliance & Isolation Card */}
          <div className="bg-slate-900 border border-amber-900/40 rounded-xl p-4 text-xs text-slate-300">
            <div className="flex items-center space-x-2 text-amber-400 font-bold mb-1.5">
              <AlertTriangle className="w-4 h-4" />
              <span>G00 Strict Demo Isolation</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              All records, appointments, quotes, and customer accounts are deterministic synthetic fixtures. Electronic signatures are visibly deferred to the working test system without amount-based legal routing.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
