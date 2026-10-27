/**
 * Area H: Quotations and Customer Acceptance
 * MYOB-linked quote preview, snapshot terms preservation,
 * interactive customer acceptance link simulation (valid/expired/revoked/already accepted),
 * unquoted job handling with interactive quote generation (G00-006, G00-016),
 * and explicitly DEFERRED detailed electronic signature notice.
 */

import React, { useState, useEffect } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faBuilding,
  faCircleCheck,
  faCircleQuestion,
  faClock,
  faDollarSign,
  faFileLines,
  faPaperPlane,
  faPlus,
  faRotateLeft,
  faShieldHalved,
  faTriangleExclamation,
  faUserCheck,
} from '@fortawesome/free-solid-svg-icons';
import { Quote } from '../types/cabms.ts';

export const QuotesAcceptanceView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    brands,
    persona,
    simulateQuoteAcceptance,
    prepareQuoteForJob,
    demoClock,
  } = useCabms();

  const [viewMode, setViewMode] = useState<'office' | 'recipient'>('office');
  const [activeLinkScenario, setActiveLinkScenario] = useState<
    'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  >('valid');
  const [customerAcceptedCheck, setCustomerAcceptedCheck] = useState(false);
  const [acceptanceFeedback, setAcceptanceFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [isPrepareModalOpen, setIsPrepareModalOpen] = useState(false);

  // New Quote Form State for unquoted jobs (G00-016)
  const [quoteTitle, setQuoteTitle] = useState('Standard Service Quotation');
  const [quoteAmount, setQuoteAmount] = useState('1450');

  // Find selected job or default
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];
  const quote = currentJob.quote; // Truthful: no fallback to jobs[0].quote! (G00-006)

  // Reset simulator state when job or quote changes (G00-017)
  useEffect(() => {
    setCustomerAcceptedCheck(false);
    setAcceptanceFeedback(null);
  }, [currentJob.id]);

  // Persona boundary: Technician is read-only or restricted
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="MYOB Quotations & Customer Acceptance Portal"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians do not prepare quotations, send financial customer acceptance links, or administer deposit invoicing."
      />
    );
  }

  const handleSimulateAcceptance = () => {
    if (!quote) return;
    if (!customerAcceptedCheck && activeLinkScenario === 'valid') {
      setAcceptanceFeedback({
        success: false,
        message: 'Customer must check the acceptance confirmation box before submitting.',
      });
      return;
    }

    const outcome = simulateQuoteAcceptance(currentJob.id, activeLinkScenario);
    setAcceptanceFeedback(outcome);
  };

  const handlePrepareQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const grossTotal = parseFloat(quoteAmount) || 1450;
    // GST convention: Gross total / 1.1 = Subtotal ex-GST
    const exSubtotal = Math.round((grossTotal / 1.1) * 100) / 100;

    prepareQuoteForJob(currentJob.id, quoteTitle, [
      {
        id: 'ITEM-01',
        description: quoteTitle,
        quantity: 1,
        unitPrice: exSubtotal,
        total: exSubtotal,
      },
    ]);

    setIsPrepareModalOpen(false);
  };

  const jobBrand = brands[currentJob.brandId] || brands.solarcell;

  return (
    <div className="space-y-6">
      {/* Top Header & Mode Switcher */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faFileLines} className="w-5 h-5 text-sky-400" />
              <h1 className="text-xl font-bold text-(--cabms-text-primary) tracking-tight">
                Quotations, Terms Snapshots & Customer Acceptance
              </h1>
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              MYOB quote preparation, frozen Terms snapshots, and customer online acceptance testing (Preview Mode).
            </p>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex items-center space-x-1 cabms-card-subtle p-1 text-xs">
              <button
                onClick={() => setViewMode('office')}
                className={`px-3 py-1.5 rounded font-semibold transition cursor-pointer ${
                  viewMode === 'office'
                    ? 'cabms-surface-subtle border cabms-border text-(--cabms-text-primary) shadow-sm'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                Office Administration
              </button>
              <button
                onClick={() => setViewMode('recipient')}
                className={`px-3 py-1.5 rounded font-semibold transition cursor-pointer flex items-center space-x-1.5 ${
                  viewMode === 'recipient'
                    ? 'bg-emerald-600 text-slate-950 font-bold shadow-sm'
                    : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                }`}
              >
                <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3 h-3" />
                <span>Recipient Portal View</span>
              </button>
            </div>

            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <label htmlFor="quote-work-order" className="shrink-0 text-xs text-(--cabms-text-secondary)">Target Job:</label>
              <select
                id="quote-work-order"
                title={`${currentJob.id} — ${currentJob.title}`}
                value={selectedJobId || ''}
                onChange={e => setSelectedJobId(e.target.value)}
                className="w-full min-w-0 max-w-full cabms-card-subtle rounded px-2.5 py-1 text-(--cabms-text-primary) font-mono text-xs font-bold cursor-pointer"
              >
                {jobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.id} — {j.title} {j.quote ? `($${j.quote.total.toLocaleString()})` : '(Unquoted)'}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* MANDATORY DEFERRED SIGNING NOTICE CARD PER SECTION H */}
      <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/80 text-purple-200 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 font-bold text-purple-300 text-sm">
            <FontAwesomeIcon icon={faShieldHalved} className="w-5 h-5 text-purple-400 shrink-0" />
            <span>CONTRACT & E-SIGNATURE BOUNDARY: DEFERRED TO WORKING TEST SYSTEM</span>
          </div>
          <button
            onClick={() => setShowReferralModal(true)}
            className="px-2.5 py-1 bg-purple-900/60 hover:bg-purple-800 border border-purple-700 rounded text-[11px] font-semibold text-purple-200 transition cursor-pointer"
          >
            Manual Owner Referral
          </button>
        </div>
        <p className="leading-relaxed">
          Detailed contract drafting, QBCC major residential building contract forms, and formal electronic signature
          flows are explicitly <strong>DEFERRED</strong> to the working test system. In this G00 demonstration, quotations
          rely on simulated customer acceptance links with immutable Terms of Service snapshots. No automatic amount-based
          legal routing is applied by the provisional $3,300 threshold.
        </p>
      </div>

      {/* Main View: Quote Details OR Empty State */}
      {!quote ? (
        /* Empty State with Prepare Quote Action */
        <div className="cabms-card p-8 text-center space-y-4">
          <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mx-auto text-(--cabms-text-secondary)">
            <FontAwesomeIcon icon={faFileLines} className="w-6 h-6" />
          </div>
          <div className="max-w-md mx-auto space-y-1">
            <h2 className="text-base font-bold text-(--cabms-text-primary)">No MYOB Quote Linked to {currentJob.id}</h2>
            <p className="text-xs text-(--cabms-text-secondary)">
              This work order has not yet had a quotation prepared or synchronized from the shared MYOB company file.
            </p>
          </div>
          <button
            onClick={() => setIsPrepareModalOpen(true)}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-md cursor-pointer"
          >
            <FontAwesomeIcon icon={faPlus} className="w-4 h-4" />
            <span>Prepare / Link MYOB Quote</span>
          </button>
        </div>
      ) : viewMode === 'recipient' ? (
        /* STANDALONE RECIPIENT EXPERIENCE (Customer Online Acceptance Link) */
        <div className="space-y-6">
          {/* Simulated Link Control Toolbar */}
          <div className="cabms-card p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-2 text-(--cabms-text-secondary)">
              <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800">
                https://portal.cabms.example.invalid/quotes/accept?token=tok_{currentJob.id.toLowerCase()}
              </span>
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-(--cabms-text-secondary) font-semibold">Customer Acceptance Link Preview:</span>
              <select
                value={activeLinkScenario}
                onChange={e => setActiveLinkScenario(e.target.value as any)}
                className="cabms-input rounded px-2.5 py-1 text-(--cabms-text-primary) font-medium cursor-pointer"
              >
                <option value="valid">Valid Acceptance Token (Normal)</option>
                <option value="invalid">Invalid / Corrupted Token</option>
                <option value="expired">Expired Token (&gt; 14 Days Old)</option>
                <option value="revoked">Revoked Link (Cancelled by Office)</option>
                <option value="superseded">Superseded by Revised Quote</option>
                <option value="already_accepted">Already Accepted Token</option>
              </select>
              <button
                onClick={() => setViewMode('office')}
                className="px-3 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded font-semibold transition cursor-pointer"
              >
                Return to Office
              </button>
            </div>
          </div>

          {/* Minimal Standalone Customer Card */}
          <div className="max-w-3xl mx-auto cabms-card rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
            {/* Recipient Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-800 gap-4">
              <div className="flex items-center space-x-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-white text-lg shadow-md"
                  style={{ backgroundColor: jobBrand.primaryColor }}
                >
                  {jobBrand.name.charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-extrabold text-(--cabms-text-primary)">{jobBrand.name}</h2>
                  <p className="text-xs text-(--cabms-text-secondary)">{quote.frozenIssuerSnapshot}</p>
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-(--cabms-text-secondary)">Formal Quotation</div>
                <div className="font-mono text-sm font-bold text-sky-400">{quote.externalMyobRef}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">Work Order: {currentJob.id}</div>
              </div>
            </div>

            {/* Recipient Details & Scope */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs cabms-card-subtle p-4">
              <div>
                <span className="text-slate-500 uppercase text-[10px] block font-bold">Customer Site</span>
                <span className="text-(--cabms-text-primary) font-semibold">{currentJob.siteContact}</span>
                <span className="text-(--cabms-text-secondary) block mt-0.5">{currentJob.siteAddress}</span>
              </div>
              <div>
                <span className="text-slate-500 uppercase text-[10px] block font-bold">Scope of Works</span>
                <span className="text-(--cabms-text-primary) font-semibold">{quote.title}</span>
                <span className="text-(--cabms-text-secondary) block mt-0.5">Status: <strong className="text-amber-400">{quote.acceptanceStatus}</strong></span>
              </div>
            </div>

            {/* Follow-Up Schedule & Expiry Badge */}
            <div className="cabms-card-subtle p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs border-l-4 border-l-amber-500" data-testid="quote-followup-badge">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-(--cabms-text-primary)">Quotation Follow-Up Timeline & 14-Day Expiry</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-800/60">
                    Standard Terms
                  </span>
                </div>
                <p className="text-(--cabms-text-secondary) text-[11px]">
                  Stage 1 (3 business days courtesy) • Stage 2 (7 business days expiry warning) • Strict 14-calendar-day validity cap.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {quote.followUps && quote.followUps.length > 0 ? (
                  quote.followUps.map(fu => (
                    <span
                      key={fu.id}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold border ${
                        fu.status === 'SENT'
                          ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800/60'
                          : fu.status === 'CANCELLED'
                          ? 'bg-slate-800 text-slate-400 border-slate-700 line-through'
                          : 'bg-sky-950/60 text-sky-300 border-sky-800/60'
                      }`}
                    >
                      {fu.stage === 'STAGE_1_COURTESY' ? 'Stage 1 (3d)' : 'Stage 2 (7d)'}: {fu.status} ({fu.scheduledDate})
                    </span>
                  ))
                ) : (
                  <span className="text-[11px] text-(--cabms-text-secondary) italic">
                    {quote.acceptanceStatus === 'ACCEPTED' ? 'Follow-ups concluded (Accepted)' : 'No pending follow-ups'}
                  </span>
                )}
              </div>
            </div>

            {/* Schedule of Items & Unified Subtotal/GST Breakdown */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-(--cabms-text-secondary) uppercase tracking-wider block">
                Schedule of Services & Pricing
              </span>
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
                  <thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3 text-center">Qty</th>
                      <th className="p-3 text-right">Unit Price (ex GST)</th>
                      <th className="p-3 text-right">Subtotal (ex GST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--cabms-border-base) bg-transparent">
                    {quote.lineItems.map(item => (
                      <tr key={item.id}>
                        <td className="p-3 font-medium text-(--cabms-text-primary)">{item.description}</td>
                        <td className="p-3 text-center font-mono">{item.quantity}</td>
                        <td className="p-3 text-right font-mono">${item.unitPrice.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-(--cabms-text-primary)">${item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Total Calculation Card */}
              <div className="cabms-card-subtle p-4 space-y-2 text-xs">
                <div className="flex justify-between text-(--cabms-text-secondary)">
                  <span>Subtotal (ex-GST):</span>
                  <span className="font-mono">${quote.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-(--cabms-text-secondary)">
                  <span>Goods & Services Tax (GST 10%):</span>
                  <span className="font-mono">${quote.gst.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-(--cabms-text-primary) pt-2 border-t border-slate-800">
                  <span>Total Amount Payable (inc GST):</span>
                  <span className="font-mono text-emerald-400 text-base">${quote.total.toFixed(2)}</span>
                </div>
                <div className="text-[11px] text-(--cabms-text-secondary) pt-2 border-t border-slate-800/60">
                  Payment Terms: Standard Payment on Completion (or Approved Stage Progress)
                </div>
              </div>
            </div>

            {/* Preserved Terms of Service Snapshot Agreement */}
            <div className="cabms-card-subtle p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[11px]">
                  Terms of Service Agreement (Snapshot Version {quote.termsVersion})
                </span>
                <span className="font-mono text-[10px] text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                  Frozen Terms
                </span>
              </div>
              <div className="cabms-surface-subtle p-3 rounded border cabms-border text-(--cabms-text-secondary) text-[11px] font-mono leading-relaxed max-h-32 overflow-y-auto">
                {quote.termsContentSnapshot}
              </div>
            </div>

            {/* Acceptance Confirmation & Submit Action */}
            <div className="space-y-4 pt-2 border-t border-slate-800">
              <label className="flex items-start space-x-3 cursor-pointer text-(--cabms-text-secondary) text-xs">
                <input
                  type="checkbox"
                  checked={customerAcceptedCheck}
                  onChange={e => setCustomerAcceptedCheck(e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                />
                <span>
                  I, <strong>{currentJob.siteContact}</strong>, confirm that I have reviewed the Schedule of Services and agree to the specified terms and total payable of <strong>${quote.total.toFixed(2)} (inc GST)</strong>.
                </span>
              </label>

              <button
                onClick={handleSimulateAcceptance}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold text-sm rounded-xl transition shadow-lg cursor-pointer flex items-center justify-center space-x-2"
              >
                <FontAwesomeIcon icon={faCircleCheck} className="w-5 h-5" />
                <span>Accept & Authorize Quotation</span>
              </button>

              {/* Feedback Banner */}
              {acceptanceFeedback && (
                <div
                  className={`p-4 rounded-xl border text-xs font-medium space-y-1 ${
                    acceptanceFeedback.success
                      ? 'bg-emerald-950/70 border-emerald-800 text-emerald-200'
                      : 'bg-red-950/70 border-red-800 text-red-200'
                  }`}
                >
                  <div className="flex items-center space-x-2 font-bold">
                    {acceptanceFeedback.success ? (
                      <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 text-red-400" />
                    )}
                    <span>{acceptanceFeedback.success ? 'Acceptance Successfully Recorded' : 'Acceptance Blocked'}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed">{acceptanceFeedback.message}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* OFFICE ADMINISTRATION VIEW (Quote Preview & Admin Controls) */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Column 1 & 2: Quote Preview */}
          <div className="lg:col-span-2 space-y-6">
            <div className="cabms-card p-6 space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-sky-400">{quote.externalMyobRef}</span>
                    <span className="text-slate-500">•</span>
                    <span className="text-xs text-(--cabms-text-secondary)">{quote.title}</span>
                  </div>
                  <h2 className="text-lg font-bold text-(--cabms-text-primary) mt-1">
                    Quotation & Frozen Terms Snapshot
                  </h2>
                </div>

                <div className="flex items-center space-x-2">
                  <span
                    className={`px-2.5 py-1 rounded text-xs font-bold ${
                      quote.acceptanceStatus === 'ACCEPTED'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                        : quote.acceptanceStatus === 'SUPERSEDED'
                        ? 'bg-purple-950 text-purple-400 border border-purple-800'
                        : 'bg-amber-950 text-amber-400 border border-amber-800'
                    }`}
                  >
                    Status: {quote.acceptanceStatus}
                  </span>
                </div>
              </div>

              {/* Quote Info Bar */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs cabms-card-subtle p-4">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Issuer Brand</span>
                  <span className="font-bold text-(--cabms-text-primary)">{jobBrand.name}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Client Site Contact</span>
                  <span className="font-bold text-(--cabms-text-primary)">{currentJob.siteContact}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Subtotal (ex GST)</span>
                  <span className="font-bold text-(--cabms-text-secondary) font-mono">
                    ${quote.subtotal.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">Quote Total (inc GST)</span>
                  <span className="font-bold text-emerald-400 text-sm font-mono">
                    ${quote.total.toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Payment Terms Notification */}
              <div className="cabms-card-subtle p-3 text-xs text-(--cabms-text-secondary) flex items-center justify-between">
                <span>Payment Terms: <strong>Standard Payment on Completion (or Approved Stage Progress)</strong></span>
                <span className="text-slate-500 text-[11px]">GST 10%: ${quote.gst.toFixed(2)}</span>
              </div>

              {/* Line Items Table */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-(--cabms-text-secondary) uppercase tracking-wider block">
                  Quote Scope & Schedule of Items
                </span>
                <div className="border border-slate-800 rounded-xl overflow-hidden">
                  <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
                    <thead className="cabms-surface-subtle text-(--cabms-text-secondary) text-[11px] uppercase border-b cabms-border">
                      <tr>
                        <th className="p-3">Description</th>
                        <th className="p-3 text-center">Qty</th>
                        <th className="p-3 text-right">Unit Price (ex GST)</th>
                        <th className="p-3 text-right">Subtotal (ex GST)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--cabms-border-base) bg-transparent">
                      {quote.lineItems.map(item => (
                        <tr key={item.id}>
                          <td className="p-3 font-medium text-(--cabms-text-primary)">{item.description}</td>
                          <td className="p-3 text-center font-mono">{item.quantity}</td>
                          <td className="p-3 text-right font-mono">${item.unitPrice.toFixed(2)}</td>
                          <td className="p-3 text-right font-bold text-(--cabms-text-primary) font-mono">${item.total.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Preserved Terms of Service Snapshot */}
              <div className="cabms-card-subtle p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[11px]">
                    Preserved Terms of Service Snapshot (Immutable)
                  </span>
                  <span className="font-mono text-[10px] text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                    Version: {quote.termsVersion}
                  </span>
                </div>
                <div className="cabms-surface-subtle p-3 rounded border cabms-border text-(--cabms-text-secondary) text-[11px] font-mono leading-relaxed max-h-24 overflow-y-auto">
                  {quote.termsContentSnapshot}
                </div>
              </div>
            </div>
          </div>

          {/* Column 3: Customer Acceptance Link Launcher & Simulator */}
          <div className="space-y-6">
            <div className="cabms-card p-5 space-y-4">
              <div className="flex items-center space-x-2 pb-3 border-b border-slate-800">
                <FontAwesomeIcon icon={faUserCheck} className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-bold text-(--cabms-text-primary)">
                  Customer Acceptance Link
                </h3>
              </div>

              <div className="space-y-3 text-xs">
                <p className="text-(--cabms-text-secondary) leading-relaxed">
                  Test the standalone customer acceptance portal link generated for {currentJob.siteContact}.
                </p>

                <button
                  onClick={() => setViewMode('recipient')}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-4 h-4" />
                  <span>Open Standalone Recipient Portal</span>
                </button>

                <div className="pt-3 border-t border-slate-800">
                  <label className="text-(--cabms-text-secondary) block font-semibold mb-1">
                    Test Link Condition (Preview)
                  </label>
                  <select
                    value={activeLinkScenario}
                    onChange={e => setActiveLinkScenario(e.target.value as any)}
                    className="w-full cabms-input rounded px-2.5 py-1.5 text-(--cabms-text-primary) font-medium cursor-pointer"
                  >
                    <option value="valid">Valid Acceptance Token (Normal)</option>
                    <option value="invalid">Invalid / Corrupted Token</option>
                    <option value="expired">Expired Token (&gt; 14 Days Old)</option>
                    <option value="revoked">Revoked Link (Cancelled by Office)</option>
                    <option value="superseded">Superseded by Revised Quote</option>
                    <option value="already_accepted">Already Accepted Token</option>
                  </select>
                </div>

                <div className="cabms-card-subtle p-3 space-y-2">
                  <label className="flex items-start space-x-2 cursor-pointer text-(--cabms-text-secondary)">
                    <input
                      type="checkbox"
                      checked={customerAcceptedCheck}
                      onChange={e => setCustomerAcceptedCheck(e.target.checked)}
                      className="mt-0.5 rounded bg-slate-900 border-slate-700 text-sky-600 focus:ring-0"
                    />
                    <span className="text-[11px]">
                      Customer confirms agreement with quote total (${quote.total.toFixed(2)}) and frozen Terms.
                    </span>
                  </label>
                </div>

                <button
                  onClick={handleSimulateAcceptance}
                  className="w-full py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-bold text-xs rounded-lg transition cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <FontAwesomeIcon icon={faPaperPlane} className="w-4 h-4" />
                  <span>Execute Acceptance in Office</span>
                </button>

                {/* Feedback Banner */}
                {acceptanceFeedback && (
                  <div
                    className={`p-3 rounded-lg border text-xs font-medium space-y-1 ${
                      acceptanceFeedback.success
                        ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                        : 'bg-red-950/60 border-red-800 text-red-200'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold">
                      {acceptanceFeedback.success ? (
                        <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 text-red-400" />
                      )}
                      <span>{acceptanceFeedback.success ? 'Acceptance Processed' : 'Acceptance Blocked'}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed">{acceptanceFeedback.message}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Prepare Quote Modal for Unquoted Jobs (G00-016) */}
      {isPrepareModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faPlus} className="w-5 h-5 text-sky-400" />
              <span>Prepare MYOB Quote for {currentJob.id}</span>
            </h3>
            <p className="text-xs text-(--cabms-text-secondary)">
              Generates a formal quotation linked to the shared MYOB company file with snapshot Terms of Service.
            </p>

            <form onSubmit={handlePrepareQuoteSubmit} className="space-y-3 text-xs">
              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Quote Title / Scope</label>
                <input
                  type="text"
                  required
                  value={quoteTitle}
                  onChange={e => setQuoteTitle(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary)"
                />
              </div>

              <div>
                <label className="text-(--cabms-text-secondary) block font-semibold mb-1">Total Amount Inc GST ($)</label>
                <input
                  type="number"
                  required
                  value={quoteAmount}
                  onChange={e => setQuoteAmount(e.target.value)}
                  className="w-full cabms-input rounded p-2 text-(--cabms-text-primary) font-mono"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsPrepareModalOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) rounded font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded transition cursor-pointer"
                >
                  Create & Link Quote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Owner Referral Modal */}
      {showReferralModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-(--cabms-text-primary) flex items-center space-x-2">
              <FontAwesomeIcon icon={faShieldHalved} className="w-5 h-5 text-purple-400" />
              <span>Manual Owner Referral Logged</span>
            </h3>
            <p className="text-xs text-(--cabms-text-secondary) leading-relaxed">
              This job has been flagged for manual owner review regarding formal major residential contract documentation.
              Because automatic legal routing by threshold is explicitly DEFERRED in G00, an office administrator or owner
              must manually verify whether a statutory QBCC contract is necessary.
            </p>
            <div className="cabms-card-subtle p-3 text-[11px] text-(--cabms-text-secondary) font-mono">
              Referral logged for {currentJob.id} • Action assigned to: Owner / Principal
            </div>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowReferralModal(false)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded font-bold text-xs cursor-pointer"
              >
                Acknowledge & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
