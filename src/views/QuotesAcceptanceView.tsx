/**
 * Area H: Quotations and Customer Acceptance
 * MYOB-linked quote preview, snapshot terms preservation,
 * interactive customer acceptance link simulation (valid/expired/revoked/already accepted),
 * and explicitly DEFERRED detailed electronic signature notice.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import {
  FileText,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink,
  ShieldAlert,
  Send,
  RotateCcw,
  UserCheck,
  Building2,
  DollarSign,
  HelpCircle,
} from 'lucide-react';
import { Quote } from '../types/cabms.ts';

export const QuotesAcceptanceView: React.FC = () => {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    brands,
    simulateQuoteAcceptance,
    demoClock,
  } = useCabms();

  const [activeLinkScenario, setActiveLinkScenario] = useState<
    'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  >('valid');
  const [customerAcceptedCheck, setCustomerAcceptedCheck] = useState(false);
  const [acceptanceFeedback, setAcceptanceFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [showReferralModal, setShowReferralModal] = useState(false);

  // Find job with quote
  const currentJob = jobs.find(j => j.id === selectedJobId) || jobs[0];
  const quote = currentJob.quote || jobs[0].quote!;

  const handleSimulateAcceptance = () => {
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

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <FileText className="w-5 h-5 text-sky-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Quotations, Terms Snapshots & Customer Acceptance
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Simulated MYOB quote preparation, frozen Terms snapshots, and customer online acceptance testing.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Select Job:</span>
            <select
              value={selectedJobId || ''}
              onChange={e => setSelectedJobId(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-white font-mono text-xs font-bold cursor-pointer"
            >
              {jobs.filter(j => j.quote).map(j => (
                <option key={j.id} value={j.id}>
                  {j.id} ({j.quote?.externalMyobRef})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* MANDATORY DEFERRED SIGNING NOTICE CARD PER SECTION H */}
      <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/80 text-purple-200 text-xs space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 font-bold text-purple-300 text-sm">
            <ShieldAlert className="w-5 h-5 text-purple-400 shrink-0" />
            <span>CONTRACT & E-SIGNATURE BOUNDARY: DEFERRED TO WORKING TEST SYSTEM</span>
          </div>
          <button
            onClick={() => setShowReferralModal(true)}
            className="px-2.5 py-1 bg-purple-900/60 hover:bg-purple-800/80 text-purple-200 border border-purple-700 rounded text-[11px] font-semibold transition cursor-pointer"
          >
            Manual Owner Referral Flow
          </button>
        </div>
        <p className="leading-relaxed">
          Detailed electronic signature and high-value formal contract workflows are <strong>explicitly deferred</strong> to the subsequent working test system. In accordance with strict G00 project boundaries, automatic legal routing by the provisional $3,300 threshold is <strong>NOT implemented</strong> as automated policy.
        </p>
      </div>

      {/* Two Columns: Quote Document & Customer Acceptance Link Simulator */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Branded Quote Preview (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                {brands[quote.brandId]?.name} Quotation
              </span>
              <h2 className="text-lg font-bold text-white mt-0.5">{quote.title}</h2>
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                MYOB Quote Ref: <strong className="text-sky-400">{quote.externalMyobRef}</strong> • ID: {quote.id}
              </div>
            </div>

            <div className="text-right">
              <span className={`px-2.5 py-1 rounded text-xs font-bold ${
                quote.acceptanceStatus === 'ACCEPTED'
                  ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  : 'bg-amber-950 text-amber-400 border border-amber-800'
              }`}>
                {quote.acceptanceStatus}
              </span>
              {quote.acceptedAt && (
                <span className="text-[10px] text-slate-400 block mt-1 font-mono">
                  Accepted: {quote.acceptedAt}
                </span>
              )}
            </div>
          </div>

          {/* Line Items Table */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
              Quotation Line Items (Simulated MYOB Source)
            </h3>
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs text-slate-300">
                <thead className="bg-slate-950 text-slate-400 text-[11px] uppercase border-b border-slate-800">
                  <tr>
                    <th className="p-3">Item Description</th>
                    <th className="p-3 text-center">Qty</th>
                    <th className="p-3 text-right">Unit Price</th>
                    <th className="p-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/40">
                  {quote.lineItems.map(item => (
                    <tr key={item.id}>
                      <td className="p-3 font-medium text-white">{item.description}</td>
                      <td className="p-3 text-center font-mono">{item.quantity}</td>
                      <td className="p-3 text-right font-mono">${item.unitPrice.toFixed(2)}</td>
                      <td className="p-3 text-right font-mono font-semibold text-white">
                        ${item.total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-950 text-xs border-t border-slate-800 font-semibold">
                  <tr>
                    <td colSpan={3} className="p-2.5 text-right text-slate-400">Subtotal:</td>
                    <td className="p-2.5 text-right font-mono text-white">${quote.subtotal.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="p-2.5 text-right text-slate-400">GST (10%):</td>
                    <td className="p-2.5 text-right font-mono text-white">${quote.gst.toFixed(2)}</td>
                  </tr>
                  <tr className="border-t border-slate-800 text-sm">
                    <td colSpan={3} className="p-3 text-right font-bold text-white">Total AUD:</td>
                    <td className="p-3 text-right font-mono font-black text-emerald-400">
                      ${quote.total.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Attached Frozen Terms Version Snapshot */}
          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-300 uppercase tracking-wider text-[11px]">
                Attached Terms & Conditions Version Snapshot
              </span>
              <span className="font-mono text-sky-400 font-semibold text-[11px]">
                {quote.termsVersion}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed italic bg-slate-900/60 p-2.5 rounded border border-slate-800/80">
              {quote.termsContentSnapshot}
            </p>
            <div className="text-[10px] text-slate-500">
              Historical Snapshot Guarantee: When the active Terms of Service are updated in the Owner settings, this accepted quotation retains its original snapshot without retrospective rewriting.
            </div>
          </div>

          {/* Acceptance Audit History */}
          <div className="space-y-2 pt-2 border-t border-slate-800 text-xs">
            <span className="font-bold text-slate-400 uppercase tracking-wider text-[11px]">
              Audit Trail & Event Log
            </span>
            <div className="space-y-1 font-mono text-[11px]">
              {quote.acceptanceHistory.map((h, idx) => (
                <div key={idx} className="bg-slate-950 p-2 rounded border border-slate-800/60 flex items-start justify-between text-slate-300">
                  <div>
                    <span className="text-slate-400">{h.timestamp}</span> • <strong className="text-white">{h.action}</strong>
                    {h.notes && <span className="text-slate-500 block font-sans text-[10px]">{h.notes}</span>}
                  </div>
                  <span className="text-sky-400">{h.actor}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Customer-Facing Acceptance Link Simulator (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
            <div>
              <div className="flex items-center space-x-2">
                <ExternalLink className="w-4 h-4 text-emerald-400" />
                <h3 className="font-bold text-white text-sm">
                  Customer Acceptance Link Simulator
                </h3>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                Demonstrates the customer-facing link experience without a persistent customer login account.
              </p>
            </div>

            {/* Test Scenario Selector */}
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-2 text-xs">
              <label className="block text-slate-300 font-semibold">
                Simulate Link State Scenario:
              </label>
              <select
                value={activeLinkScenario}
                onChange={e => {
                  setActiveLinkScenario(e.target.value as any);
                  setAcceptanceFeedback(null);
                }}
                className="w-full p-2 bg-slate-900 border border-slate-700 rounded text-white text-xs font-semibold focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value="valid">1. Valid Active Link</option>
                <option value="invalid">2. Invalid Token / Broken Link</option>
                <option value="expired">3. Expired Link (Validity Exceeded)</option>
                <option value="revoked">4. Revoked by Office Staff</option>
                <option value="superseded">5. Superseded by Newer Quote Revision</option>
                <option value="already_accepted">6. Already Accepted Previously</option>
              </select>
            </div>

            {/* Simulated Customer Acceptance UI Container */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-4 text-xs">
              <div className="text-slate-400 text-[11px] uppercase tracking-wider font-bold">
                Customer View Portal (Simulated)
              </div>

              <div className="space-y-1">
                <div className="text-white font-bold text-sm">Quotation #{quote.externalMyobRef}</div>
                <div className="text-slate-300 text-xs">For: {currentJob.siteContact}</div>
                <div className="text-emerald-400 font-black text-base mt-1">
                  Total: ${quote.total.toFixed(2)} AUD
                </div>
              </div>

              {activeLinkScenario !== 'valid' ? (
                <div className="bg-red-950/40 border border-red-800/80 p-3 rounded-lg text-red-300 space-y-1">
                  <div className="font-bold flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    <span>Link Inactive / Invalid</span>
                  </div>
                  <p className="text-[11px]">
                    {activeLinkScenario === 'invalid' && 'The quotation link signature is corrupted or invalid.'}
                    {activeLinkScenario === 'expired' && 'This quotation expired after 14 days without acceptance.'}
                    {activeLinkScenario === 'revoked' && 'This quotation was formally revoked by the business.'}
                    {activeLinkScenario === 'superseded' && 'A newer revision of this quotation has been issued.'}
                    {activeLinkScenario === 'already_accepted' && 'This quotation was already accepted. Repeating acceptance will not create duplicate events.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <label className="flex items-start space-x-2 text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customerAcceptedCheck}
                      onChange={e => setCustomerAcceptedCheck(e.target.checked)}
                      className="mt-0.5 rounded"
                    />
                    <span className="text-[11px] leading-relaxed">
                      I, <strong>{currentJob.siteContact}</strong>, confirm acceptance of quotation {quote.externalMyobRef} and agree to CABMS Standard Terms ({quote.termsVersion}).
                    </span>
                  </label>

                  <button
                    onClick={handleSimulateAcceptance}
                    disabled={quote.acceptanceStatus === 'ACCEPTED' && activeLinkScenario === 'valid'}
                    className={`w-full py-2.5 rounded-lg font-bold text-xs transition cursor-pointer ${
                      quote.acceptanceStatus === 'ACCEPTED'
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-slate-950 shadow-md'
                    }`}
                  >
                    {quote.acceptanceStatus === 'ACCEPTED'
                      ? '✓ Quote Already Accepted'
                      : 'Accept Quotation Online'}
                  </button>
                </div>
              )}

              {/* Feedback Alert */}
              {acceptanceFeedback && (
                <div className={`p-3 rounded-lg text-[11px] font-semibold ${
                  acceptanceFeedback.success
                    ? 'bg-emerald-950 border border-emerald-800 text-emerald-300'
                    : 'bg-red-950 border border-red-800 text-red-300'
                }`}>
                  {acceptanceFeedback.message}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Manual Owner Referral Modal */}
      {showReferralModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <ShieldAlert className="w-5 h-5 text-purple-400" />
              <span>Manual Owner Referral Workflow</span>
            </h3>

            <p className="text-xs text-slate-300 leading-relaxed">
              When a commercial contract or custom trade agreement requires execution, the request is flagged for direct manual handling by the business owner.
            </p>

            <div className="bg-slate-950 p-3 rounded border border-slate-800 text-xs space-y-1">
              <div>Customer: <strong className="text-white">{currentJob.siteContact}</strong></div>
              <div>Estimated Contract Value: <span className="font-mono text-emerald-400">${quote.total.toFixed(2)} AUD</span></div>
              <div>Status: <span className="text-purple-300 font-semibold">Flagged for Owner Manual Referral</span></div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setShowReferralModal(false)}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded transition cursor-pointer"
              >
                Close Referral Notice
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
