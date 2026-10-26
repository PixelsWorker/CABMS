/**
 * Area I: Communications, Automation and Review Requests
 * Simulated notifications, certificate deliveries (G00-022),
 * review deduplication (G00-021), email-only channel compliance (G00-041),
 * and uncertain dispatch reconciliation.
 */

import React, { useState, useEffect } from 'react';
import { formatBusinessTime } from '../utils/businessTime.ts';
import { validateSignedSnapshot } from '../utils/cabmsLogic.ts';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faBell,
  faCircleCheck,
  faClock,
  faComment,
  faEnvelope,
  faForward,
  faPaperPlane,
  faRotate,
  faRotateLeft,
  faShield,
  faStar,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { Job } from '../types/cabms.ts';

export const CommunicationsView: React.FC = () => {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    activeBrandId,
    setActiveBrandId,
    brands,
    persona,
    triggerReviewRequest,
    reconcileReviewRequest,
    retryReviewRequest,
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

  // Scoped jobs for active business
  const brandJobs = jobs.filter(j => j.brandId === activeBrandId);

  // Selected job (prefers active-brand selection matching selectedJobId, falls back to first active-brand job, or global fallback)
  const currentJob =
    (selectedJobId ? brandJobs.find(j => j.id === selectedJobId) : undefined) ||
    brandJobs[0] ||
    (selectedJobId ? jobs.find(j => j.id === selectedJobId) : undefined) ||
    jobs[0];

  // Synchronize selectedJobId with the active brand's currentJob (always above early return for Rules of Hooks)
  useEffect(() => {
    if (persona !== 'technician' && currentJob && currentJob.id !== selectedJobId) {
      setSelectedJobId(currentJob.id);
    }
  }, [persona, currentJob?.id, selectedJobId, setSelectedJobId]);

  // Persona boundary: Technician is restricted
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Customer Communications & Review Automation"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians do not dispatch automated customer communications, Google review requests, or customer certificate delivery packages."
      />
    );
  }

  // Empty-state guard if no jobs exist in the system
  if (!currentJob) {
    return (
      <div className="cabms-card p-8 text-center space-y-3">
        <FontAwesomeIcon icon={faTriangleExclamation} className="w-8 h-8 text-amber-400 mx-auto" />
        <h2 className="text-base font-bold text-(--cabms-text-primary)">No Work Orders Found</h2>
        <p className="text-xs text-(--cabms-text-secondary)">
          There are no active or historical work orders in the system.
        </p>
      </div>
    );
  }

  // FC-01 & Certificate Policy A: Synchronize active certificate selection with current job requirements
  const effectiveCertType = currentJob.formsRequired.includes(selectedCertType)
    ? selectedCertType
    : ((currentJob.formsRequired[0] as typeof selectedCertType) || null);

  let isEffectiveCertSigned = false;
  let isEffectiveCertValid = false;
  if (effectiveCertType) {
    let rawSnapshot: string | undefined = undefined;
    if (effectiveCertType === 'JSA') {
      const form = getOrCreateJsa(currentJob.id);
      isEffectiveCertSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (effectiveCertType === 'ELECTRICAL') {
      const form = getOrCreateElectrical(currentJob.id);
      isEffectiveCertSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (effectiveCertType === 'SMOKE_ALARM') {
      const form = getOrCreateSmokeAlarm(currentJob.id);
      isEffectiveCertSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (effectiveCertType === 'TCA1') {
      const form = getOrCreateTca1(currentJob.id);
      isEffectiveCertSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    } else if (effectiveCertType === 'TCA2') {
      const form = getOrCreateTca2(currentJob.id);
      isEffectiveCertSigned = form.signedOff;
      rawSnapshot = form.fullSnapshot;
    }
    if (isEffectiveCertSigned) {
      isEffectiveCertValid = validateSignedSnapshot(rawSnapshot, currentJob.id, effectiveCertType).valid;
    }
  }

  const canDispatchEffectiveCert = Boolean(
    effectiveCertType &&
    currentJob.formsRequired.includes(effectiveCertType) &&
    isEffectiveCertSigned &&
    isEffectiveCertValid
  );

  const handleSendReview = (outcomeType?: 'FAIL' | 'UNCERTAIN') => {
    const outcome = triggerReviewRequest(currentJob.id, outcomeType);
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


  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faComment} className="w-5 h-5 text-emerald-400" />
              <h1 className="text-xl font-bold text-(--cabms-text-primary) tracking-tight">
                Automated Communications & Google Review Requests
              </h1>
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              Deterministic simulation of email appointment reminders, certificate delivery, and deduplicated Google review dispatches.
            </p>
          </div>

          <div className="flex w-full min-w-0 flex-wrap items-center gap-3 sm:w-auto">
            {/* Clock Advance Widget (G00-020) */}
            <div className="flex max-w-full flex-wrap items-center gap-2 cabms-card-subtle px-2.5 py-1.5 text-xs">
              <FontAwesomeIcon icon={faClock} className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono text-(--cabms-text-primary) font-bold">{formatBusinessTime(demoClock)}</span>
              <button
                onClick={() => advanceClock(2)}
                className="ml-2 px-1.5 py-0.5 cabms-surface hover:bg-(--cabms-surface-subtle) border cabms-border text-(--cabms-text-primary) rounded text-[10px] font-semibold cursor-pointer"
                title="Advance clock by 2 hours to trigger reminders"
              >
                +2h
              </button>
            </div>

            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="communications-work-order" className="shrink-0 text-xs text-(--cabms-text-secondary)">Target Work Order:</label>
              <select
                id="communications-work-order"
                title={`${currentJob.id} — ${currentJob.title}`}
                value={selectedJobId || ''}
                onChange={e => {
                  const chosen = jobs.find(j => j.id === e.target.value);
                  if (chosen) {
                    if (chosen.brandId !== activeBrandId) {
                      setActiveBrandId(chosen.brandId);
                    }
                    setSelectedJobId(chosen.id);
                    setReviewFeedback(null);
                  }
                }}
                className="w-full min-w-0 max-w-full cabms-card-subtle rounded px-2.5 py-1 text-(--cabms-text-primary) font-mono text-xs font-bold cursor-pointer"
              >
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.id} — {j.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Sub-Tabs */}
        <div className="flex min-w-0 flex-wrap gap-2 mt-4 pt-4 border-t border-slate-800 text-xs">
          <button
            onClick={() => setActiveTab('reviews')}
            className={`max-w-full px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'reviews'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
            }`}
          >
            <FontAwesomeIcon icon={faStar} className="w-3.5 h-3.5" />
            <span>Google Review Automation & Deduplication</span>
          </button>

          <button
            onClick={() => setActiveTab('reminders')}
            className={`max-w-full px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'reminders'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
            }`}
          >
            <FontAwesomeIcon icon={faBell} className="w-3.5 h-3.5" />
            <span>Appointment Reminders & Invalidation</span>
          </button>

          <button
            onClick={() => setActiveTab('certificates')}
            className={`max-w-full px-3 py-1.5 rounded-lg font-bold transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'certificates'
                ? 'bg-emerald-600 text-slate-950 shadow-sm'
                : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
            }`}
          >
            <FontAwesomeIcon icon={faEnvelope} className="w-3.5 h-3.5" />
            <span>Certificate Delivery Previews</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      {activeTab === 'reviews' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Review Automation Simulator (6 cols) */}
          <div className="lg:col-span-6 cabms-card p-6 space-y-5">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                Single Logical Request per Job Guard
              </span>
              <h2 className="text-base font-bold text-(--cabms-text-primary) mt-0.5">
                Google Review Dispatch Control ({currentJob.id})
              </h2>
              <p className="text-xs text-(--cabms-text-secondary) mt-1">
                Automated or manual review triggers are strictly deduplicated. If a request is already sent, pending, or uncertain, duplicate dispatches are prevented.
              </p>
            </div>

            {/* Current Review Request Status Card */}
            <div className="cabms-card-subtle p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-(--cabms-text-secondary)">Dispatch Status:</span>
                <span
                  className={`px-2.5 py-0.5 rounded font-bold ${
                    currentJob.reviewRequest.status === 'SENT'
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : currentJob.reviewRequest.status === 'UNCERTAIN'
                      ? 'bg-amber-950 text-amber-400 border border-amber-800'
                      : currentJob.reviewRequest.status === 'FAILED'
                      ? 'bg-red-950 text-red-400 border border-red-800'
                      : currentJob.reviewRequest.status === 'PENDING'
                      ? 'bg-sky-950 text-sky-400 border border-sky-800'
                      : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)'
                  }`}
                >
                  {currentJob.reviewRequest.status}
                </span>
              </div>

              <div className="space-y-1 text-(--cabms-text-secondary)">
                <div>Recipient: <strong className="text-(--cabms-text-primary)">{currentJob.siteContact}</strong> ({currentJob.sitePhone})</div>
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
              <span className="text-xs font-bold text-(--cabms-text-secondary) block">Simulate Dispatch Action:</span>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => handleSendReview()}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-md cursor-pointer flex items-center space-x-1.5"
                >
                  <FontAwesomeIcon icon={faPaperPlane} className="w-3.5 h-3.5" />
                  <span>Send Review Request (Normal)</span>
                </button>

                <button
                  onClick={() => handleSendReview('UNCERTAIN')}
                  className="px-3 py-2 cabms-surface hover:bg-(--cabms-surface-subtle) border cabms-border text-amber-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                  title="Simulate 504 Gateway Timeout resulting in an UNCERTAIN state"
                >
                  Simulate 504 Timeout (Uncertain)
                </button>

                <button
                  onClick={() => handleSendReview('FAIL')}
                  className="px-3 py-2 cabms-surface hover:bg-(--cabms-surface-subtle) border cabms-border text-red-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                  title="Simulate SMTP 550 Mailbox Unavailable resulting in FAILED state"
                >
                  Simulate SMTP 550 (Failed)
                </button>

                {currentJob.reviewRequest.status === 'FAILED' && (
                  <button
                    onClick={() => {
                      const res = retryReviewRequest(currentJob.id);
                      setReviewFeedback(res);
                    }}
                    className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer flex items-center space-x-1.5"
                  >
                    <FontAwesomeIcon icon={faRotate} className="w-3.5 h-3.5" />
                    <span>Retry Dispatch</span>
                  </button>
                )}

                {currentJob.reviewRequest.uncertainReconciliationNeeded && (
                  <>
                    <button
                      onClick={() => {
                        reconcileReviewRequest(currentJob.id, 'SENT');
                        setReviewFeedback({ success: true, message: 'Uncertain review request manually verified as SENT.' });
                      }}
                      className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <FontAwesomeIcon icon={faRotateLeft} className="w-3.5 h-3.5" />
                      <span>Confirm Sent</span>
                    </button>
                    <button
                      onClick={() => {
                        reconcileReviewRequest(currentJob.id, 'FAILED');
                        setReviewFeedback({ success: false, message: 'Uncertain review request marked as FAILED.' });
                      }}
                      className="px-3.5 py-2 bg-red-800 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition cursor-pointer flex items-center space-x-1.5"
                    >
                      <span>Mark Failed</span>
                    </button>
                  </>
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
                      <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 text-amber-400" />
                    )}
                    <span>{reviewFeedback.success ? 'Dispatch Confirmed' : 'Dispatch Guard Triggered'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{reviewFeedback.message}</p>
                </div>
              )}
            </div>
          </div>

          {/* Right: Review Request Email Preview (6 cols) */}
          <div className="lg:col-span-6 cabms-card p-6 space-y-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-(--cabms-text-secondary)">
              Customer Experience Preview
            </span>
            <h3 className="text-base font-bold text-(--cabms-text-primary)">
              Branded Review Request Email
            </h3>

            <div className="cabms-card-subtle p-5 text-xs space-y-4">
              <div className="border-b border-slate-800 pb-2 text-(--cabms-text-secondary) text-[11px]">
                <div>From: <strong>{brands[currentJob.brandId]?.name}</strong> &lt;feedback@cabms-demo.invalid&gt;</div>
                <div>To: {currentJob.siteContact}</div>
                <div>Subject: How was your experience with {brands[currentJob.brandId]?.name}?</div>
              </div>

              <div className="space-y-3 text-(--cabms-text-secondary) leading-relaxed">
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
                    <FontAwesomeIcon icon={faStar} className="w-4 h-4 fill-current" />
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
        <div className="cabms-card p-6 space-y-4">
          <h2 className="text-sm font-bold text-(--cabms-text-primary) uppercase tracking-wider">
            Automated Appointment Reminders & Suppression Audit
          </h2>
          <p className="text-xs text-(--cabms-text-secondary)">
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
                    : 'cabms-card-subtle text-(--cabms-text-secondary)'
                }`}
              >
                <div>
                  <div className="font-bold text-(--cabms-text-primary) text-xs">
                    {rem.type === 'CONFIRMATION' && 'Initial Appointment Email Confirmation'}
                    {rem.type === 'REMINDER_24HR' && '24-Hour Prior Email Reminder'}
                    {rem.type === 'REMINDER_2HR' && '2-Hour Prior Email En Route Reminder'}
                  </div>
                  <div className="text-[11px] text-(--cabms-text-secondary) font-mono mt-0.5">
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
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)">
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
        <div className="cabms-card p-6 space-y-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              Finalized Document Dispatch Workflow
            </span>
            <h2 className="text-base font-bold text-(--cabms-text-primary) mt-0.5">
              Completed Compliance Certificate Email Dispatch ({currentJob.id})
            </h2>
            <p className="text-xs text-(--cabms-text-secondary)">
              Only signed compliance certificates with preserved immutable snapshots are eligible for simulated dispatch to property owners.
            </p>
          </div>

          {/* Form Selection & Dispatch Triggers */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-6 cabms-card-subtle p-5 space-y-4 text-xs">
              <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[11px] block">
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
                            effectiveCertType === fType
                              ? 'bg-emerald-600 text-slate-950 shadow-sm'
                              : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                          }`}
                        >
                          <span>{fType}</span>
                          {isSigned ? (
                            <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5 text-emerald-300" />
                          ) : (
                            <span className="text-[10px] text-amber-400 font-mono">(Unsigned)</span>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  <div className="pt-3 border-t border-slate-800 text-(--cabms-text-secondary)">
                    Recipient: <strong className="text-(--cabms-text-primary)">{currentJob.siteContact}</strong> ({currentJob.siteContact.toLowerCase().replace(/[^a-z0-9]/g, '.')}@example.invalid)
                  </div>
                </div>
              ) : (
                <p className="text-slate-500">No compliance forms required for direct-to-invoice service.</p>
              )}

              {/* Action Buttons: Only rendered when compliance forms are contractually required */}
              {currentJob.formsRequired.length > 0 && effectiveCertType && (
                <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center gap-2">
                  <button
                    disabled={!canDispatchEffectiveCert}
                    onClick={() => canDispatchEffectiveCert && sendCertificateEmail(currentJob.id, effectiveCertType, false)}
                    className={`px-4 py-2 font-bold rounded-lg transition shadow-md flex items-center space-x-1.5 ${
                      canDispatchEffectiveCert
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 cursor-pointer'
                        : 'bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                    }`}
                  >
                    <FontAwesomeIcon icon={faPaperPlane} className="w-3.5 h-3.5" />
                    <span>Send Certificate Email (Normal)</span>
                  </button>
                  <button
                    disabled={!canDispatchEffectiveCert}
                    onClick={() => canDispatchEffectiveCert && sendCertificateEmail(currentJob.id, effectiveCertType, true)}
                    className={`px-3 py-2 font-semibold rounded-lg transition ${
                      canDispatchEffectiveCert
                        ? 'bg-slate-900 hover:bg-slate-800 text-red-300 border border-red-800/80 cursor-pointer'
                        : 'cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) cursor-not-allowed opacity-60'
                    }`}
                    title={
                      canDispatchEffectiveCert
                        ? 'Simulate network failure resulting in a FAILED delivery record with retry option'
                        : 'Cannot send unsigned or invalid certificate'
                    }
                  >
                    Simulate SMTP 504 Failure
                  </button>
                  {!canDispatchEffectiveCert && (
                    <span className="text-[11px] text-amber-400">
                      {!isEffectiveCertSigned
                        ? 'Certificate must be signed before delivery.'
                        : 'Certificate snapshot is invalid.'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Email Preview Card */}
            <div className="lg:col-span-6 cabms-card-subtle p-5 space-y-3 text-xs">
              <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[11px] block">
                2. Customer Email Delivery Package Preview
              </span>
              <div className="text-(--cabms-text-secondary) text-[11px] pb-2 border-b border-slate-800">
                Subject: Verified Compliance Certificates for Work Order #{currentJob.id} — {brands[currentJob.brandId]?.name}
              </div>
              <p className="text-(--cabms-text-primary)">Dear {currentJob.siteContact},</p>
              <p className="text-(--cabms-text-secondary) leading-relaxed">
                Please find attached your verified compliance records for the works carried out at <strong>{currentJob.siteAddress}</strong> on {currentJob.scheduledDate}.
              </p>
              <div className="cabms-card-subtle p-3 space-y-2">
                <span className="font-bold text-(--cabms-text-secondary) block text-[11px]">
                  Enclosed Verified Documents ({signedCerts.length} signed of {currentJob.formsRequired.length} required):
                </span>
                {signedCerts.length > 0 ? (
                  <div className="space-y-1">
                    {signedCerts.map((certName, idx) => (
                      <div key={idx} className="flex items-center space-x-1.5 text-emerald-400 font-mono text-[11px]">
                        <FontAwesomeIcon icon={faCircleCheck} className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
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
              <p className="text-(--cabms-text-secondary) text-[11px]">
                Legal Issuer: {brands[currentJob.brandId]?.legalIssuerName} • {brands[currentJob.brandId]?.abnPlaceholder}
              </p>
            </div>
          </div>

          {/* Delivery Audit History & Recovery Log */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-(--cabms-text-secondary) uppercase tracking-wider">
              3. Simulated Dispatch Audit History & Delivery Recovery
            </h3>

            {certificateDeliveries.filter(d => d.jobId === currentJob.id).length === 0 ? (
              <div className="cabms-card-subtle p-4 text-xs text-slate-500 text-center">
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
                        <div className="text-[11px] text-(--cabms-text-secondary) mt-0.5">
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
                            <FontAwesomeIcon icon={faRotate} className="w-3 h-3" />
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
