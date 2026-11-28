/**
 * Public Customer Quotation Acceptance Portal
 *
 * Renders when a customer opens `/?quote_token=<token>` without authentication.
 * Fetches GET /api/v1/public/quotations/:token and submits:
 * - POST /api/v1/public/quotations/:token/accept
 * - POST /api/v1/public/quotations/:token/refuse
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBan,
  faCircleCheck,
  faClock,
  faFileLines,
  faShieldHalved,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { buildApiUrl } from '../services/g01Client.ts';

export interface PublicQuotationLineItem {
  id: string;
  line_order: number;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface PublicQuotationFollowUp {
  id: string;
  stage: 'STAGE_1_COURTESY' | 'STAGE_2_EXPIRY';
  scheduled_date: string;
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED';
  channel: string;
}

export interface PublicQuotationEvent {
  id: string;
  event_type: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface PublicQuotationRecord {
  id: string;
  workspace_id: string;
  job_id: string;
  brand_id: string;
  external_myob_ref: string | null;
  title: string;
  subtotal: number;
  gst: number;
  total: number;
  terms_version: string | null;
  terms_content_snapshot: string | null;
  frozen_issuer_snapshot: string | null;
  acceptance_status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REFUSED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED';
  issued_at: string | null;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by_name: string | null;
  refused_at: string | null;
  refusal_reason: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  line_items: PublicQuotationLineItem[];
  follow_ups: PublicQuotationFollowUp[];
  events: PublicQuotationEvent[];
}

interface ProblemPayload {
  code?: string;
  title?: string;
  detail?: string;
  status?: number;
}

const BRAND_DISPLAY_NAMES: Record<string, string> = {
  solarcell: 'Solarcell',
  smart_home: 'Gold Coast Smart Home Solutions',
  cctv: 'Gold Coast CCTV',
};

function describeNonActionableStatus(quote: PublicQuotationRecord): {
  heading: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger' | 'purple';
} {
  switch (quote.acceptance_status) {
    case 'ACCEPTED':
      return {
        heading: 'Quotation Already Accepted',
        detail: `This quotation was accepted${quote.accepted_by_name ? ` by ${quote.accepted_by_name}` : ''}${quote.accepted_at ? ` on ${quote.accepted_at}` : ''}. No further action is required.`,
        tone: 'success',
      };
    case 'EXPIRED':
      return {
        heading: 'Quotation Expired',
        detail: `This quotation passed its 14-day validity period${quote.expires_at ? ` (${quote.expires_at})` : ''}. Please contact the office for an updated quotation.`,
        tone: 'danger',
      };
    case 'REVOKED':
      return {
        heading: 'Quotation Link Revoked',
        detail: quote.revocation_reason || 'This quotation link has been revoked by the office.',
        tone: 'danger',
      };
    case 'SUPERSEDED':
      return {
        heading: 'Quotation Superseded',
        detail: 'This quotation has been superseded by a newer revision from the office. Please use your latest quotation link.',
        tone: 'purple',
      };
    case 'REFUSED':
      return {
        heading: 'Quotation Refused',
        detail: quote.refusal_reason
          ? `This quotation was declined: ${quote.refusal_reason}`
          : 'This quotation has already been declined.',
        tone: 'warning',
      };
    default:
      return {
        heading: 'Quotation Unavailable',
        detail: 'This quotation is not currently open for customer acceptance.',
        tone: 'warning',
      };
  }
}

export interface PublicQuotationPortalProps {
  token: string;
}

export const PublicQuotationPortal: React.FC<PublicQuotationPortalProps> = ({ token }) => {
  const trimmedToken = token.trim();
  const [quote, setQuote] = useState<PublicQuotationRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ heading: string; detail: string; code?: string } | null>(null);

  const [confirmed, setConfirmed] = useState(false);
  const [acceptedByName, setAcceptedByName] = useState('');
  const [refusalReason, setRefusalReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const fetchQuotation = useCallback(async () => {
    abortRef.current?.abort();
    const seq = ++requestSeqRef.current;

    if (!trimmedToken) {
      setQuote(null);
      setLoading(false);
      setLoadError({
        heading: 'Invalid or Missing Quotation Link',
        detail: 'The quotation acceptance token is missing or invalid. Please check the link from your email.',
        code: 'INVALID_TOKEN',
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setLoadError(null);

    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/public/quotations/${encodeURIComponent(trimmedToken)}`),
        {
          method: 'GET',
          headers: { Accept: 'application/json, application/problem+json' },
          signal: controller.signal,
        }
      );

      if (controller.signal.aborted || seq !== requestSeqRef.current) return;

      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as ProblemPayload;
        if (controller.signal.aborted || seq !== requestSeqRef.current) return;
        const isInvalid = res.status === 404;
        setQuote(null);
        setLoadError({
          heading: isInvalid ? 'Invalid or Unknown Quotation Link' : (problem.title || 'Unable to Load Quotation'),
          detail:
            problem.detail ||
            (isInvalid
              ? 'This quotation link is invalid, corrupted, or no longer available.'
              : `Unable to load quotation (${res.status}).`),
          code: problem.code,
        });
        return;
      }

      const data = (await res.json()) as { quotation?: PublicQuotationRecord };
      if (controller.signal.aborted || seq !== requestSeqRef.current) return;
      if (!data.quotation) {
        setQuote(null);
        setLoadError({
          heading: 'Invalid Quotation Response',
          detail: 'The quotation details could not be read from the server response.',
        });
        return;
      }
      setQuote(data.quotation);
    } catch (err) {
      if (controller.signal.aborted || seq !== requestSeqRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setQuote(null);
      setLoadError({
        heading: 'Unable to Reach Quotation Portal',
        detail: err instanceof Error ? err.message : 'Network error loading quotation.',
      });
    } finally {
      if (!controller.signal.aborted && seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, [trimmedToken]);

  useEffect(() => {
    setQuote(null);
    setConfirmed(false);
    setAcceptedByName('');
    setRefusalReason('');
    setActionError(null);
    setActionSuccess(null);
    void fetchQuotation();
    return () => {
      abortRef.current?.abort();
    };
  }, [fetchQuotation]);

  const handleAccept = async () => {
    if (!quote || quote.acceptance_status !== 'SENT' || submitting) return;
    setActionError(null);
    setActionSuccess(null);

    if (!confirmed) {
      setActionError('Please check the confirmation box before accepting the quotation.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/public/quotations/${encodeURIComponent(trimmedToken)}/accept`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, application/problem+json',
          },
          body: JSON.stringify({
            confirmed: true,
            ...(acceptedByName.trim() ? { accepted_by_name: acceptedByName.trim() } : {}),
          }),
        }
      );

      const payload = (await res.json().catch(() => ({}))) as {
        quotation?: PublicQuotationRecord;
        detail?: string;
        code?: string;
      };

      if (!res.ok) {
        setActionError(payload.detail || `Unable to accept quotation (${res.status}).`);
        if (res.status === 409) {
          await fetchQuotation();
        }
        return;
      }

      if (payload.quotation) {
        setQuote(payload.quotation);
      }
      setActionSuccess('Thank you — your quotation acceptance has been recorded.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error submitting acceptance.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefuse = async () => {
    if (!quote || quote.acceptance_status !== 'SENT' || submitting) return;
    setActionError(null);
    setActionSuccess(null);

    const reason = refusalReason.trim();
    if (!reason) {
      setActionError('Please enter a brief reason before declining the quotation.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(
        buildApiUrl(`/api/v1/public/quotations/${encodeURIComponent(trimmedToken)}/refuse`),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, application/problem+json',
          },
          body: JSON.stringify({ reason }),
        }
      );

      const payload = (await res.json().catch(() => ({}))) as {
        quotation?: PublicQuotationRecord;
        detail?: string;
        code?: string;
      };

      if (!res.ok) {
        setActionError(payload.detail || `Unable to decline quotation (${res.status}).`);
        if (res.status === 409) {
          await fetchQuotation();
        }
        return;
      }

      if (payload.quotation) {
        setQuote(payload.quotation);
      }
      setActionSuccess('Your refusal has been recorded and sent to the office.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Network error submitting refusal.');
    } finally {
      setSubmitting(false);
    }
  };

  const brandName = quote
    ? BRAND_DISPLAY_NAMES[quote.brand_id] || BRAND_DISPLAY_NAMES[quote.workspace_id] || quote.brand_id
    : 'CABMS Quotation Portal';

  const hasSimulatedChannel = Boolean(
    quote &&
      (quote.follow_ups.some(f => f.channel === 'EMAIL_SIMULATED') ||
        quote.events.some(e => {
          const transport = typeof e.details?.transport === 'string' ? e.details.transport : '';
          return transport.toLowerCase().includes('sandbox') || transport.toLowerCase().includes('simulated');
        }))
  );

  const terminalInfo = quote && quote.acceptance_status !== 'SENT' ? describeNonActionableStatus(quote) : null;

  return (
    <div className="cabms-app-shell min-h-screen font-sans" data-testid="public-quotation-portal">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-800/80 text-purple-200 text-xs space-y-1.5">
          <div className="flex items-center space-x-2 font-bold text-purple-300">
            <FontAwesomeIcon icon={faShieldHalved} className="w-4 h-4 text-purple-400 shrink-0" />
            <span>
              {hasSimulatedChannel
                ? 'Simulated / Sandbox Notice — Online Quotation Acceptance'
                : 'Online Quotation Acceptance & Frozen Terms Notice'}
            </span>
          </div>
          <p className="leading-relaxed">
            Detailed statutory contracts and formal electronic signature flows are deferred. Submitting acceptance here
            records your confirmation against the immutable frozen Terms of Service snapshot below
            {hasSimulatedChannel ? ' (sandbox/simulated email transport active)' : ''}.
          </p>
        </div>

        {loading && (
          <div role="status" className="cabms-card p-8 text-center text-sm text-(--cabms-text-secondary) space-y-2">
            <FontAwesomeIcon icon={faClock} className="w-6 h-6 text-sky-400 animate-pulse" />
            <p className="font-semibold text-(--cabms-text-primary)">Loading quotation details...</p>
          </div>
        )}

        {!loading && loadError && (
          <div role="alert" className="cabms-card p-8 space-y-3 border border-red-800/80 bg-red-950/30">
            <div className="flex items-center space-x-2 text-red-300">
              <FontAwesomeIcon icon={faTriangleExclamation} className="w-5 h-5 text-red-400" />
              <h1 className="text-lg font-bold">{loadError.heading}</h1>
            </div>
            <p className="text-xs text-red-200 leading-relaxed">{loadError.detail}</p>
            {loadError.code && (
              <div className="text-[11px] font-mono text-red-300/80">Error Code: {loadError.code}</div>
            )}
          </div>
        )}

        {!loading && quote && (
          <div className="cabms-card rounded-2xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-5 border-b border-slate-800 gap-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-sky-600 flex items-center justify-center font-black text-white text-lg">
                  {brandName.charAt(0)}
                </div>
                <div>
                  <h1 className="text-xl font-extrabold text-(--cabms-text-primary)">{brandName}</h1>
                  <p className="text-xs text-(--cabms-text-secondary)">
                    {quote.frozen_issuer_snapshot || 'Issuer details snapshot'}
                  </p>
                </div>
              </div>

              <div className="sm:text-right">
                <div className="text-xs text-(--cabms-text-secondary)">Formal Quotation</div>
                <div className="font-mono text-sm font-bold text-sky-400">
                  {quote.external_myob_ref || quote.id}
                </div>
                <div className="text-[11px] text-(--cabms-text-secondary) mt-0.5">
                  Work Order: {quote.job_id}
                </div>
              </div>
            </div>

            {actionSuccess && (
              <div role="status" className="p-4 rounded-xl border border-emerald-800 bg-emerald-950/70 text-emerald-200 text-xs flex items-start space-x-2">
                <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <span>{actionSuccess}</span>
              </div>
            )}

            {actionError && (
              <div role="alert" className="p-4 rounded-xl border border-red-800 bg-red-950/70 text-red-200 text-xs flex items-start space-x-2">
                <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <span>{actionError}</span>
              </div>
            )}

            {terminalInfo && (
              <div
                role="alert"
                data-testid="public-quote-terminal-banner"
                className={`p-4 rounded-xl border text-xs space-y-1 ${
                  terminalInfo.tone === 'success'
                    ? 'bg-emerald-950/60 border-emerald-800 text-emerald-200'
                    : terminalInfo.tone === 'purple'
                    ? 'bg-purple-950/60 border-purple-800 text-purple-200'
                    : terminalInfo.tone === 'danger'
                    ? 'bg-red-950/60 border-red-800 text-red-200'
                    : 'bg-amber-950/60 border-amber-800 text-amber-200'
                }`}
              >
                <div className="flex items-center space-x-2 font-bold">
                  <FontAwesomeIcon
                    icon={terminalInfo.tone === 'success' ? faCircleCheck : faBan}
                    className="w-4 h-4 shrink-0"
                  />
                  <span>{terminalInfo.heading}</span>
                </div>
                <p className="leading-relaxed">{terminalInfo.detail}</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs cabms-card-subtle p-4">
              <div>
                <span className="text-(--cabms-text-secondary) uppercase text-[10px] block font-bold">
                  Scope of Works
                </span>
                <span className="text-(--cabms-text-primary) font-semibold">{quote.title}</span>
                <span className="text-(--cabms-text-secondary) block mt-0.5">
                  Status: <strong className="text-amber-400">{quote.acceptance_status}</strong>
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) uppercase text-[10px] block font-bold">
                  Validity Window
                </span>
                <span className="text-(--cabms-text-secondary) block">
                  Issued: <span className="font-mono">{quote.issued_at || 'N/A'}</span>
                </span>
                <span className="text-(--cabms-text-secondary) block mt-0.5">
                  Expires: <span className="font-mono">{quote.expires_at || 'N/A'}</span>
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-bold text-(--cabms-text-secondary) uppercase tracking-wider">
                <FontAwesomeIcon icon={faFileLines} className="w-3.5 h-3.5 text-sky-400" />
                <span>Schedule of Services & Pricing</span>
              </div>
              <div className="border border-slate-800 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs text-(--cabms-text-secondary)">
                  <thead className="cabms-surface-subtle text-[11px] uppercase border-b cabms-border">
                    <tr>
                      <th className="p-3">Description</th>
                      <th className="p-3 text-center">Qty</th>
                      <th className="p-3 text-right">Unit Price (ex GST)</th>
                      <th className="p-3 text-right">Subtotal (ex GST)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--cabms-border-base)">
                    {quote.line_items.map(item => (
                      <tr key={item.id}>
                        <td className="p-3 font-medium text-(--cabms-text-primary)">{item.description}</td>
                        <td className="p-3 text-center font-mono">{item.quantity}</td>
                        <td className="p-3 text-right font-mono">${item.unit_price.toFixed(2)}</td>
                        <td className="p-3 text-right font-mono text-(--cabms-text-primary)">
                          ${item.total.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

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
              </div>
            </div>

            <div className="cabms-card-subtle p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-(--cabms-text-secondary) uppercase tracking-wider text-[11px]">
                  Terms of Service Agreement (Snapshot Version {quote.terms_version || 'N/A'})
                </span>
                <span className="font-mono text-[10px] text-sky-400 bg-sky-950 px-2 py-0.5 rounded border border-sky-800">
                  Frozen Terms
                </span>
              </div>
              <div
                data-testid="public-quote-terms-snapshot"
                className="cabms-surface-subtle p-3 rounded border cabms-border text-(--cabms-text-secondary) text-[11px] font-mono leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap"
              >
                {quote.terms_content_snapshot || 'No frozen Terms snapshot recorded.'}
              </div>
            </div>

            {quote.acceptance_status === 'SENT' && (
              <div className="space-y-5 pt-4 border-t border-slate-800">
                <div className="space-y-3">
                  <h2 className="text-sm font-bold text-(--cabms-text-primary)">Accept Quotation</h2>
                  <div>
                    <label htmlFor="public-accept-name" className="block text-xs font-semibold text-(--cabms-text-secondary) mb-1">
                      Accepted By (Full Name)
                    </label>
                    <input
                      id="public-accept-name"
                      type="text"
                      value={acceptedByName}
                      onChange={e => setAcceptedByName(e.target.value)}
                      placeholder="Enter your full name"
                      disabled={submitting}
                      className="w-full cabms-input rounded px-3 py-2 text-xs text-(--cabms-text-primary)"
                    />
                  </div>

                  <label className="flex items-start space-x-3 cursor-pointer text-(--cabms-text-secondary) text-xs">
                    <input
                      id="public-accept-confirm"
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      disabled={submitting}
                      className="mt-0.5 rounded bg-slate-900 border-slate-700 text-emerald-600 focus:ring-0"
                    />
                    <span>
                      I confirm that I have reviewed the Schedule of Services and agree to the frozen Terms of Service
                      and total payable of <strong>${quote.total.toFixed(2)} (inc GST)</strong>.
                    </span>
                  </label>

                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleAccept()}
                    className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold text-sm rounded-xl transition shadow-lg cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4" />
                    <span>{submitting ? 'Submitting...' : 'Accept & Authorize Quotation'}</span>
                  </button>
                </div>

                <div className="space-y-3 pt-4 border-t border-slate-800/70">
                  <h2 className="text-sm font-bold text-(--cabms-text-primary)">Decline / Refuse Quotation</h2>
                  <div>
                    <label htmlFor="public-refuse-reason" className="block text-xs font-semibold text-(--cabms-text-secondary) mb-1">
                      Reason for Declining
                    </label>
                    <textarea
                      id="public-refuse-reason"
                      rows={2}
                      value={refusalReason}
                      onChange={e => setRefusalReason(e.target.value)}
                      placeholder="Let the office know why you are declining or what needs to change"
                      disabled={submitting}
                      className="w-full cabms-input rounded px-3 py-2 text-xs text-(--cabms-text-primary)"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => void handleRefuse()}
                    className="w-full py-2.5 bg-red-800/80 hover:bg-red-700 text-white font-bold text-xs rounded-xl transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    <FontAwesomeIcon icon={faXmark} className="w-4 h-4" />
                    <span>Refuse Quotation</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
