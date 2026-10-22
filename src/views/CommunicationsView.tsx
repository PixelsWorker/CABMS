/**
 * Area I: Communications, Automation and Review Requests
 * Simulated notifications, certificate deliveries (G00-022),
 * review deduplication (G00-021), email-only channel compliance (G00-041),
 * and uncertain dispatch reconciliation.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
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
  FastForward,
  RefreshCw,
} from 'lucide-react';
import { Job } from '../types/cabms.ts';

export const CommunicationsView: React.FC = () => {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    brands,
    persona,
    triggerReviewRequest,
    reconcileReviewRequest,
    certificateDeliveries,
    sendCertificateEmail,
    retryCertificateDelivery,
    demoClock,
    advanceClock,
    getOrCreateJsa,
    getOrCreateElectrical,
    getOrCreateSmokeAlarm,
    getOrCreateTca1,
    getOrCreateTca2,
  } = useCabms();

  const [activeTab, setActiveTab] = useState<'reviews' | 'reminders' | 'certificates'>('reviews');
  const [reviewFeedback, setReviewFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedCertType, setSelectedCertType] = useState<'JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2'>('JSA');

  // Persona boundary: Technician is restricted
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Customer Communications & Review Automation"
        requiredRoleDescription="Super Admin, Owner / Admin, or Office Staff"
        customExplanation="Technicians do not dispatch automated customer communications, Google review requests, or customer certificate delivery packages."
      />
    );
  }

  // Selected job
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  const handleSendReview = (simulateFail: boolean) => {
    const outcome = triggerReviewRequest(currentJob.id, simulateFail);
    setReviewFeedback(outcome);
  };

  // Inspect signed certificates for this job (G00-022)
  const signedCerts: string[] = [];
  if (currentJob.formsRequired.includes('JSA') && getOrCreateJsa(currentJob.id).signedOff) {
    signedCerts.push(`JSA_Risk_Assessment_${currentJob.id}_Signed.pdf`);
  }
  if (currentJob.formsRequired.includes('ELECTRICAL') && getOrCreateElectrical(currentJob.id).signedOff) {
    signedCerts.push(`Electrical_Safety_Cert_PartA_${currentJob.id}_Signed.pdf`);
  }
  if (currentJob.formsRequired.includes('SMOKE_ALARM') && getOrCreateSmokeAlarm(currentJob.id).signedOff) {
    signedCerts.push(`Smoke_Alarm_Compliance_${currentJob.id}_Signed.pdf`);
  }
  if (currentJob.formsRequired.includes('TCA1') && getOrCreateTca1(currentJob.id).signedOff) {
    signedCerts.push(`TCA1_Telecommunications_Cabling_${currentJob.id}_Signed.pdf`);
  }
  if (currentJob.formsRequired.includes('TCA2') && getOrCreateTca2(currentJob.id).signedOff) {
    signedCerts.push(`TCA2_Defect_Notice_${currentJob.id}_Signed.pdf`);
  }

  const formatClock = (isoStr: string) => {
    const d = new Date(isoStr);
    return `${d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
  };

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
              Deterministic simulation of email appointment reminders, certificate delivery, and deduplicated Google review dispatches.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Clock Advance Widget (G00-020) */}
            <div className="flex items-center space-x-2 bg-slate-950 px-2.5 py-1.5 rounded-lg border border-slate-800 text-xs">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono text-white font-bold">{formatClock(demoClock)}</span>
              <button
                onClick={() => advanceClock(2)}
                className="ml-2 px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-semibold cursor-pointer"
                title="Advance clock by 2 hours to trigger reminders"
              >
                +2h
              </button>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400">Target Work Order:</span>
              <select
                value={selectedJobId || ''}
                onChange={e => {
                  setSelectedJobId(e.target.value);
                  setReviewFeedback(null);
                }}
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
                <span
                  className={`px-2.5 py-0.5 rounded font-bold ${
                    currentJob.reviewRequest.status === 'SENT'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : currentJob.reviewRequest.status === 'UNCERTAIN'
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : 'bg-slate-900 text-slate-400 border border-slate-800'
                  }`}
                >
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
                  onClick={() => handleSendReview(false)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Review Request (Normal)</span>
                </button>

                <button
                  onClick={() => handleSendReview(true)}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                  title="Simulate network failure resulting in an uncertain status requiring reconciliation"
                >
                  Simulate Failed/Uncertain Dispatch
                </button>

                {currentJob.reviewRequest.uncertainReconciliationNeeded && (
                  <button
                    onClick={() => {
                      reconcileReviewRequest(currentJob.id);
                      setReviewFeedback({ success: true, message: 'Uncertain review request manually reconciled and confirmed.' });
                    }}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reconcile Uncertain Send</span>
                  </button>
                )}
              </div>

              {/* Deduplication & Outcome Feedback Banner (G00-021) */}
              {reviewFeedback && (
                <div
                  className={`mt-3 p-3 rounded-lg border text-xs font-medium space-y-1 ${
                    reviewFeedback.success
                      ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                      : 'bg-amber-950/60 border-amber-800 text-amber-200'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 font-bold">
                    {reviewFeedback.success ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <span>{reviewFeedback.success ? 'Dispatch Confirmed' : 'Dispatch Guard Triggered'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{reviewFeedback.message}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Review Request Email Preview (6 cols) */}
          <div className="lg:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Customer Experience Preview
            </span>
            <h3 className="text-base font-bold text-white">
              Branded Review Request Email
            </h3>

            <div className="bg-slate-950 p-5 rounded-xl border border-slate-800 text-xs space-y-4">
              <div className="border-b border-slate-800 pb-2 text-slate-400 text-[11px]">
                <div>From: <strong>{brands[currentJob.brandId]?.name}</strong> &lt;feedback@cabms-demo.invalid&gt;</div>
                <div>To: {currentJob.siteContact}</div>
                <div>Subject: How was your experience with {brands[currentJob.brandId]?.name}?</div>
              </div>

              <div className="space-y-3 text-slate-300 leading-relaxed">
                <p>Hi {currentJob.siteContact},</p>
                <p>
                  Thank you for trusting <strong>{brands[currentJob.brandId]?.name}</strong> with your service at <strong>{currentJob.siteAddress}</strong>.
                </p>
                <p>
                  Our technician {currentJob.assignedTechName || 'our team'} has completed your work order. Would you take 30 seconds to share your experience on Google?
                </p>

                <div className="py-2 text-center">
                  <a
                    href={brands[currentJob.brandId]?.reviewUrlPlaceholder}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-lg font-bold text-slate-950 text-xs transition shadow cursor-pointer"
                    style={{ backgroundColor: brands[currentJob.brandId]?.primaryColor }}
                  >
                    <Star className="w-4 h-4 fill-current" />
                    <span>Share Your Experience on Google</span>
                  </a>
                </div>

                <p className="text-[11px] text-slate-500 pt-2 border-t border-slate-800/80">
                  {brands[currentJob.brandId]?.legalIssuerName} • Work Order Ref: {currentJob.id}
                </p>
              </div>
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
                    {rem.type === 'CONFIRMATION' && 'Initial Appointment Email Confirmation'}
                    {rem.type === 'REMINDER_24HR' && '24-Hour Prior Email Reminder'}
                    {rem.type === 'REMINDER_2HR' && '2-Hour Prior Email En Route Reminder'}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                    Target Time: {rem.scheduledFor} (Channel: Email)
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

      {/* Certificates Delivery Tab (G00-022: Selection -> Preview -> Mock Send -> Recovery) */}
      {activeTab === 'certificates' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Finalized Document Dispatch Workflow
            </span>
            <h2 className="text-base font-bold text-white mt-0.5">
              Completed Compliance Certificate Email Dispatch ({currentJob.id})
            </h2>
            <p className="text-xs text-slate-400">
              Only signed compliance certificates with preserved immutable snapshots are eligible for simulated dispatch to property owners.
            </p>
          </div>

          {/* Form Selection & Dispatch Triggers */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4 text-xs">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] block">
                1. Select Finalized Certificate
              </span>

              {currentJob.formsRequired.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2">
                    {currentJob.formsRequired.map(fType => {
                      let isSigned = false;
                      if (fType === 'JSA') isSigned = getOrCreateJsa(currentJob.id).signedOff;
                      if (fType === 'ELECTRICAL') isSigned = getOrCreateElectrical(currentJob.id).signedOff;
                      if (fType === 'SMOKE_ALARM') isSigned = getOrCreateSmokeAlarm(currentJob.id).signedOff;
                      if (fType === 'TCA1') isSigned = getOrCreateTca1(currentJob.id).signedOff;
                      if (fType === 'TCA2') isSigned = getOrCreateTca2(currentJob.id).signedOff;

                      return (
                        <button
                          key={fType}
                          onClick={() => setSelectedCertType(fType)}
                          className={`px-3 py-1.5 rounded-lg font-bold text-xs transition cursor-pointer flex items-center space-x-1.5 ${
                            selectedCertType === fType
                              ? 'bg-emerald-600 text-slate-950 shadow-sm'
                              : 'bg-slate-900 text-slate-300 hover:text-white border border-slate-800'
                          }`}
                        >
                          <span>{fType}</span>
                          {isSigned ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />
                          ) : (
                            <span className="text-[10px] text-amber-400 font-mono">(Unsigned)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-slate-400">
                    Recipient: <strong className="text-white">{currentJob.siteContact}</strong> ({currentJob.siteContact.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.invalid)
                  </div>
                </div>
              ) : (
                <p className="text-slate-500">No compliance forms required for direct-to-invoice service.</p>
              )}

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-800 flex flex-wrap gap-2">
                <button
                  onClick={() => sendCertificateEmail(currentJob.id, selectedCertType, false)}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Certificate Email (Normal)</span>
                </button>
                <button
                  onClick={() => sendCertificateEmail(currentJob.id, selectedCertType, true)}
                  className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-red-300 border border-red-800/80 font-semibold rounded-lg transition cursor-pointer"
                  title="Simulate network failure resulting in a FAILED delivery record with retry option"
                >
                  Simulate SMTP 504 Failure
                </button>
              </div>
            </div>

            {/* Email Preview Card */}
            <div className="lg:col-span-6 bg-slate-950 rounded-xl p-5 border border-slate-800 space-y-3 text-xs">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px] block">
                2. Customer Email Delivery Package Preview
              </span>
              <div className="text-slate-400 text-[11px] pb-2 border-b border-slate-800">
                Subject: Verified Compliance Certificates for Work Order #{currentJob.id} — {brands[currentJob.brandId]?.name}
              </div>
              <p className="text-slate-200">Dear {currentJob.siteContact},</p>
              <p className="text-slate-300 leading-relaxed">
                Please find attached your verified compliance records for the works carried out at <strong>{currentJob.siteAddress}</strong> on {currentJob.scheduledDate}.
              </p>
              <div className="bg-slate-900 p-3 rounded border border-slate-800 space-y-2">
                <span className="font-bold text-slate-300 block text-[11px]">
                  Enclosed Verified Documents ({signedCerts.length} signed of {currentJob.formsRequired.length} required):
                </span>
                {signedCerts.length > 0 ? (
                  <div className="space-y-1">
                    {signedCerts.map((certName, idx) => (
                      <div key={idx} className="flex items-center space-x-1.5 text-emerald-400 font-mono text-[11px]">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <span>{certName}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-amber-400 bg-amber-950/40 p-2.5 rounded border border-amber-800/60 text-xs">
                    No compliance forms have received technician sign-off for this job yet. Sign-off is required before client delivery.
                  </div>
                )}
              </div>
              <p className="text-slate-400 text-[11px]">
                Legal Issuer: {brands[currentJob.brandId]?.legalIssuerName} • {brands[currentJob.brandId]?.abnPlaceholder}
              </p>
            </div>
          </div>

          {/* Delivery Audit History & Recovery Log */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              3. Simulated Dispatch Audit History & Delivery Recovery
            </h3>

            {certificateDeliveries.filter(d => d.jobId === currentJob.id).length === 0 ? (
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs text-slate-500 text-center">
                No certificate delivery simulations recorded for this work order yet. Use the dispatch buttons above.
              </div>
            ) : (
              <div className="space-y-2 text-xs">
                {certificateDeliveries
                  .filter(d => d.jobId === currentJob.id)
                  .map(deliv => (
                    <div
                      key={deliv.id}
                      className={`p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                        deliv.status === 'SENT'
                          ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-200'
                          : 'bg-red-950/40 border-red-800 text-red-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold">{deliv.id}</span>
                          <span>•</span>
                          <span className="font-semibold">{deliv.documentTitle}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          Recipient: {deliv.recipientEmail} • Dispatched: {deliv.sentAt}
                        </div>
                      </div>

                      <div className="flex items-center space-x-3">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            deliv.status === 'SENT'
                              ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                              : 'bg-red-950 text-red-400 border border-red-800'
                          }`}
                        >
                          {deliv.status}
                        </span>

                        {deliv.status === 'FAILED' && (
                          <button
                            onClick={() => retryCertificateDelivery(deliv.id)}
                            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[11px] rounded transition cursor-pointer flex items-center space-x-1"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry Delivery</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
