/**
 * Area I: Communications, Automation and Review Requests
 * Simulated notifications, certificate deliveries, review deduplication,
 * and uncertain dispatch reconciliation.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import {
  MessageSquare,
  Bell,
  Mail,
  Send,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Star,
  ExternalLink,
} from 'lucide-react';
import { Job } from '../types/cabms.ts';

export const CommunicationsView: React.FC = () => {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    brands,
    triggerReviewRequest,
    reconcileReviewRequest,
    demoClock,
  } = useCabms();

  const [activeTab, setActiveTab] = useState<'reviews' | 'reminders' | 'certificates'>('reviews');

  // Selected job
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <MessageSquare className="w-5 h-5 text-emerald-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Automated Communications & Google Review Requests
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Deterministic simulation of appointment reminders, certificate delivery, and deduplicated Google review dispatches.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Target Work Order:</span>
            <select
              value={selectedJobId || ''}
              onChange={e => setSelectedJobId(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-white font-mono text-xs font-bold cursor-pointer"
            >
              {jobs.map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} ({j.title.slice(0, 30)}...)
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex space-x-2 mt-4 pt-4 border-t border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('reviews')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'reviews'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>Google Review Automation & Deduplication</span>
          </button>

          <button
            onClick={() => setActiveTab('reminders')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'reminders'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Appointment Reminders & Invalidation</span>
          </button>

          <button
            onClick={() => setActiveTab('certificates')}
            className={`px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'certificates'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'bg-slate-950 text-slate-400 hover:text-white'
            }`}
          >
            <Mail className="w-3.5 h-3.5" />
            <span>Certificate Delivery Previews</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'reviews' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Review Automation Simulator (6 cols) */}
          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Single Logical Request per Job Guard
              </span>
              <h2 className="text-base font-bold text-white mt-0.5">
                Google Review Dispatch Control ({currentJob.id})
              </h2>
              <p className="text-xs text-slate-400 mt-1">
                Automated or manual review triggers are strictly deduplicated. If a request is already sent, pending, or uncertain, duplicate dispatches are prevented.
              </p>
            </div>

            {/* Current Review Request Status Card */}
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300">Dispatch Status:</span>
                <span className={`px-2.5 py-0.5 rounded font-bold ${
                  currentJob.reviewRequest.status === 'SENT'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : currentJob.reviewRequest.status === 'UNCERTAIN'
                    ? 'bg-red-950 text-red-400 border border-red-800'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}>
                  {currentJob.reviewRequest.status}
                </span>
              </div>

              <div className="space-y-1 text-slate-300">
                <div>Recipient: <strong className="text-white">{currentJob.siteContact}</strong> ({currentJob.sitePhone})</div>
                <div>Target Brand: <strong className="text-sky-400">{brands[currentJob.brandId]?.name}</strong></div>
                <div>
                  Brand Review Link (Synthetic Preview):
                  <span className="font-mono text-emerald-400 block truncate mt-0.5">
                    {brands[currentJob.brandId]?.reviewUrlPlaceholder}
                  </span>
                </div>
              </div>
            </div>

            {/* Interactive Dispatch Triggers */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-300 block">Simulate Dispatch Action:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => triggerReviewRequest(currentJob.id, false)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Review Request (Normal)</span>
                </button>

                <button
                  onClick={() => triggerReviewRequest(currentJob.id, true)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                  title="Simulate network failure resulting in an uncertain status requiring reconciliation"
                >
                  Simulate Failed/Uncertain Dispatch
                </button>

                {currentJob.reviewRequest.uncertainReconciliationNeeded && (
                  <button
                    onClick={() => reconcileReviewRequest(currentJob.id)}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reconcile Uncertain Dispatch</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Message Preview & History Log (6 cols) */}
          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Customer SMS / Email Message Preview
            </h3>

            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3 text-xs">
              <div className="flex items-center space-x-2 text-slate-400 text-[11px] pb-2 border-b border-slate-800">
                <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                <span>Simulated SMS/Email Preview (Non-operational)</span>
              </div>

              <div className="bg-slate-900 p-3 rounded-lg border border-slate-800 text-slate-200 text-xs leading-relaxed font-sans space-y-2">
                <p>
                  Hi <strong>{currentJob.siteContact}</strong>, thank you for choosing <strong>{brands[currentJob.brandId]?.name}</strong> for your recent service at {currentJob.siteAddress}!
                </p>
                <p>
                  Your feedback helps our local team continue delivering top-tier safety and craftsmanship. Would you take 30 seconds to leave us a quick Google review?
                </p>
                <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-sky-400 text-[11px] truncate">
                  {brands[currentJob.brandId]?.reviewUrlPlaceholder}
                </div>
              </div>
            </div>

            {/* History Trail */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">
                Job Dispatch History & Reconciliation Audit
              </span>
              {currentJob.reviewRequest.history.length === 0 ? (
                <div className="text-slate-500 text-xs italic">No dispatch attempts recorded yet for this job.</div>
              ) : (
                <div className="space-y-1 font-mono text-[11px]">
                  {currentJob.reviewRequest.history.map((h, idx) => (
                    <div key={idx} className="bg-slate-950 p-2 rounded border border-slate-800 flex items-center justify-between text-slate-300">
                      <span>{h.timestamp} • {h.event}</span>
                      <span className="text-emerald-400 font-bold">{h.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reminders Tab */}
      {activeTab === 'reminders' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Automated Appointment Reminders & Suppression Audit
          </h2>
          <p className="text-xs text-slate-400">
            When an appointment is rescheduled or cancelled, the old reminder is invalidated and retained in the audit history with the suppression cause.
          </p>

          <div className="space-y-2">
            {currentJob.reminders.map(rem => (
              <div
                key={rem.id}
                className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                  rem.suppressed
                    ? 'bg-red-950/20 border-red-900/40 text-red-300'
                    : rem.delivered
                    ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <div>
                  <div className="font-bold text-white text-xs">
                    {rem.type === 'CONFIRMATION' && 'Initial Appointment Confirmation'}
                    {rem.type === 'REMINDER_24HR' && '24-Hour Prior SMS/Email Reminder'}
                    {rem.type === 'REMINDER_2HR' && '2-Hour Prior En Route Reminder'}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Target Time: {rem.scheduledFor}
                  </div>
                  {rem.suppressionReason && (
                    <div className="text-red-400 text-[11px] mt-1 font-medium">
                      ↳ Reason Suppressed: {rem.suppressionReason}
                    </div>
                  )}
                </div>

                <div>
                  {rem.suppressed ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-800">
                      Suppressed
                    </span>
                  ) : rem.delivered ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">
                      Delivered
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                      Scheduled
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Certificates Delivery Tab */}
      {activeTab === 'certificates' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">
            Completed Compliance Document Dispatch Preview
          </h2>
          <p className="text-xs text-slate-400">
            Preview of automated certificate delivery package sent to building owners and property managers upon job completion.
          </p>

          <div className="bg-slate-950 rounded-xl p-5 border border-slate-800 space-y-3 text-xs">
            <div className="text-slate-400 text-[11px] pb-2 border-b border-slate-800">
              Email Subject: Compliance Documents for Work Order #{currentJob.id} — {brands[currentJob.brandId]?.name}
            </div>
            <p className="text-slate-200">
              Dear {currentJob.siteContact},
            </p>
            <p className="text-slate-300 leading-relaxed">
              Please find attached your verified compliance records for the works carried out at <strong>{currentJob.siteAddress}</strong> on {currentJob.scheduledDate}.
            </p>
            <div className="bg-slate-900 p-3 rounded border border-slate-800 space-y-1">
              <span className="font-bold text-slate-300 block text-[11px]">Enclosed Documents:</span>
              {currentJob.formsRequired.map(f => (
                <div key={f} className="text-sky-300 font-mono text-[11px]">
                  • {f}_Compliance_Certificate_Signed.pdf (Demo Snapshot)
                </div>
              ))}
            </div>
            <p className="text-slate-400 text-[11px]">
              Issuer: {brands[currentJob.brandId]?.legalIssuerName} • {brands[currentJob.brandId]?.abnPlaceholder}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
