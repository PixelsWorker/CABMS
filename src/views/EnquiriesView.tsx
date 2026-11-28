/**
 * Persistent D1-Backed Website Enquiries & Triage View
 *
 * Connects to /api/v1/workspaces/:workspaceId/enquiries for:
 * - Persistent enquiry list with status filters & workspace isolation
 * - Manual / simulated enquiry intake with idempotency key & validation
 * - Customer matching/creation and atomic enquiry-to-job conversion
 * - Enquiry dismissal and acknowledgement email status display
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRight,
  faCircleCheck,
  faClock,
  faEnvelope,
  faFileCircleCheck,
  faInbox,
  faLocationDot,
  faPhone,
  faPlus,
  faRotateRight,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { useG01Session } from '../context/G01Session.tsx';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { buildApiUrl } from '../services/g01Client.ts';
import { publishEnquiryCount, invalidateOtherTabs } from '../services/enquiryCount.ts';

export interface PersistentEnquiry {
  id: string;
  workspace_id: string;
  source_website: string;
  customer_name: string;
  email: string;
  phone: string;
  site_address: string | null;
  service_requested: string;
  notes: string | null;
  status: 'PENDING_REVIEW' | 'CONVERTED_TO_JOB' | 'DISMISSED' | 'SPAM_BLOCKED';
  intake_channel: 'PUBLIC_FORM' | 'STAFF_MANUAL' | 'SIMULATED';
  matched_customer_id: string | null;
  converted_job_id: string | null;
  converted_job_type_id: string | null;
  acknowledgement_status: 'PENDING' | 'SENT' | 'SANDBOX_SIMULATED' | 'FAILED' | 'SKIPPED';
  acknowledgement_message_id: string | null;
  acknowledgement_error: string | null;
  created_at: string;
  updated_at: string;
}

interface EnquiriesListResponse {
  enquiries: PersistentEnquiry[];
  counts: {
    pending: number;
    converted: number;
    dismissed: number;
    total: number;
  };
}

async function enquiryApiRequest<T>(
  path: string,
  token: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.idempotencyKey) {
    headers['Idempotency-Key'] = options.idempotencyKey;
  }

  const response = await fetch(buildApiUrl(path), {
    method: options.method ?? 'GET',
    signal: AbortSignal.timeout(10000),
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const problem = (await response.json()) as { detail?: string; request_id?: string };
      if (typeof problem.detail === 'string') {
        detail = problem.request_id ? `${problem.detail} (Ref: ${problem.request_id})` : problem.detail;
      }
    } catch {
      // keep fallback detail
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return response.json() as Promise<T>;
}

export const EnquiriesView: React.FC = () => {
  const session = useG01Session();
  const { persona, brands, activeBrandId, customers, jobTypes, setActiveTab } = useCabms();

  const [enquiries, setEnquiries] = useState<PersistentEnquiry[]>([]);
  const [counts, setCounts] = useState({ pending: 0, converted: 0, dismissed: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  // Manual intake form state
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [siteAddress, setSiteAddress] = useState('');
  const [serviceRequested, setServiceRequested] = useState('');
  const [notes, setNotes] = useState('');
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string>(() => `enq_${crypto.randomUUID()}`);

  // Conversion modal state
  const [convertTarget, setConvertTarget] = useState<PersistentEnquiry | null>(null);
  const [customerMode, setCustomerMode] = useState<'matched' | 'existing' | 'new'>('new');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState('');

  const generation = useRef(0);
  const workspaceId = session?.workspaceId ?? '';
  const userId = session?.profile?.user.id;

  const isTechnician =
    persona === 'technician' ||
    session?.profile?.memberships.find(m => m.workspace_id === workspaceId)?.role === 'technician';

  const loadEnquiries = useCallback(async () => {
    if (!session || !workspaceId || isTechnician) return;
    const reqId = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const token = await session.token();
      const data = await enquiryApiRequest<EnquiriesListResponse>(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/enquiries`,
        token
      );
      if (generation.current !== reqId) return;
      setEnquiries(data.enquiries);
      setCounts(data.counts);
      if (userId) {
        publishEnquiryCount({ workspace: workspaceId, userId, count: data.counts.pending });
      }
    } catch (err) {
      if (generation.current !== reqId) return;
      setError(err instanceof Error ? err.message : 'Unable to load website enquiries.');
    } finally {
      if (generation.current === reqId) {
        setLoading(false);
      }
    }
  }, [session, workspaceId, userId, isTechnician]);

  useEffect(() => {
    void loadEnquiries();
    return () => {
      generation.current++;
    };
  }, [loadEnquiries]);

  if (isTechnician) {
    return (
      <AccessDeniedView
        resourceName="Website Lead Inbox & Conversion"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians do not triage incoming website leads, perform customer record linkage, or generate initial job types."
      />
    );
  }

  if (!session) {
    return (
      <div className="cabms-card p-6 space-y-2">
        <div className="flex items-center space-x-2">
          <FontAwesomeIcon icon={faInbox} className="w-5 h-5 text-purple-400" />
          <h1 className="text-lg font-bold text-(--cabms-text-primary)">Website Enquiries</h1>
        </div>
        <p className="text-xs text-(--cabms-text-secondary)">
          Sign in with an authenticated staff session to view and triage persistent D1 website enquiries.
        </p>
      </div>
    );
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspaceId || busy) return;
    setBusy(true);
    setError('');
    setStatusMessage('');
    try {
      const token = await session.token();
      const result = await enquiryApiRequest<{ enquiry: PersistentEnquiry; deduplicated: boolean }>(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/enquiries`,
        token,
        {
          method: 'POST',
          idempotencyKey: pendingIdempotencyKey,
          body: {
            customer_name: customerName,
            email,
            phone,
            site_address: siteAddress || undefined,
            service_requested: serviceRequested,
            notes: notes || undefined,
            source_website: `${workspaceId}.portal.local`,
          },
        }
      );
      setCustomerName('');
      setEmail('');
      setPhone('');
      setSiteAddress('');
      setServiceRequested('');
      setNotes('');
      setPendingIdempotencyKey(`enq_${crypto.randomUUID()}`);
      setStatusMessage(
        result.deduplicated
          ? `Duplicate submission detected; returned existing enquiry ${result.enquiry.id}.`
          : `Enquiry ${result.enquiry.id} saved (${result.enquiry.acknowledgement_status}).`
      );
      await loadEnquiries();
      if (userId) invalidateOtherTabs(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create enquiry.');
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = async (enquiryId: string) => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setError('');
    setStatusMessage('');
    try {
      const token = await session.token();
      await enquiryApiRequest(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/enquiries/${encodeURIComponent(enquiryId)}/dismiss`,
        token,
        { method: 'POST' }
      );
      setStatusMessage(`Enquiry ${enquiryId} dismissed.`);
      await loadEnquiries();
      if (userId) invalidateOtherTabs(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to dismiss enquiry.');
    } finally {
      setBusy(false);
    }
  };

  const handleConvert = async () => {
    if (!workspaceId || !convertTarget || busy) return;
    setBusy(true);
    setError('');
    setStatusMessage('');
    try {
      const token = await session.token();
      const res = await enquiryApiRequest<{ enquiry: PersistentEnquiry; customer_id: string; job_id: string }>(
        `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/enquiries/${encodeURIComponent(convertTarget.id)}/convert`,
        token,
        {
          method: 'POST',
          body: {
            customer_mode: customerMode,
            ...(customerMode !== 'new' && selectedCustomerId ? { customer_id: selectedCustomerId } : {}),
            ...(selectedJobTypeId ? { job_type_id: selectedJobTypeId } : {}),
          },
        }
      );
      setConvertTarget(null);
      setStatusMessage(`Converted ${res.enquiry.id} to job ${res.job_id} (Customer ${res.customer_id}).`);
      await loadEnquiries();
      if (userId) invalidateOtherTabs(workspaceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to convert enquiry.');
    } finally {
      setBusy(false);
    }
  };

  const pendingEnquiries = enquiries.filter(e => e.status === 'PENDING_REVIEW');
  const processedEnquiries = enquiries.filter(e => e.status !== 'PENDING_REVIEW');
  const workspaceJobTypes = jobTypes.filter(jt => jt.brandId === (workspaceId || activeBrandId));

  return (
    <div className="space-y-6">
      <div className="cabms-card p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center space-x-2">
              <FontAwesomeIcon icon={faInbox} className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-bold text-(--cabms-text-primary)">
                Website Enquiries ({brands[activeBrandId]?.name ?? workspaceId})
              </h1>
            </div>
            <p className="text-xs text-(--cabms-text-secondary) mt-1">
              Persistent D1-backed enquiry intake, duplicate protection, acknowledgement email status, and job conversion.
            </p>
          </div>
          <button
            type="button"
            disabled={loading || busy}
            onClick={() => void loadEnquiries()}
            className="flex items-center space-x-1.5 px-3 py-1.5 cabms-surface-subtle border cabms-border rounded text-xs font-semibold text-(--cabms-text-primary) cursor-pointer disabled:opacity-50"
          >
            <FontAwesomeIcon icon={faRotateRight} className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="p-3 rounded bg-red-950/60 border border-red-800 text-red-200 text-xs flex items-center space-x-2">
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {statusMessage && (
          <div role="status" className="p-3 rounded bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs flex items-center space-x-2">
            <FontAwesomeIcon icon={faCircleCheck} className="w-4 h-4 shrink-0" />
            <span>{statusMessage}</span>
          </div>
        )}

        <form onSubmit={e => void handleCreate(e)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2 border-t border-slate-800">
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Customer name
            <input
              required
              maxLength={120}
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="e.g. Jordan Lee"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Email
            <input
              required
              type="email"
              maxLength={254}
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="jordan@example.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Phone
            <input
              required
              minLength={4}
              maxLength={40}
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="0412 345 678"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Requested service
            <input
              required
              maxLength={500}
              value={serviceRequested}
              onChange={e => setServiceRequested(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="Solar inverter inspection"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Site address
            <input
              maxLength={500}
              value={siteAddress}
              onChange={e => setSiteAddress(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="42 Reef Rd, Southport QLD"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-(--cabms-text-secondary)">
            Notes
            <input
              maxLength={2000}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="cabms-input rounded px-3 py-1.5 text-xs text-(--cabms-text-primary)"
              placeholder="Optional enquiry details"
            />
          </label>
          <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={busy}
              className="flex items-center space-x-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded cursor-pointer disabled:opacity-50"
            >
              <FontAwesomeIcon icon={faPlus} className="w-3.5 h-3.5" />
              <span>Save Enquiry</span>
            </button>
          </div>
        </form>
      </div>

      {/* Pending Queue */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-(--cabms-text-primary) uppercase tracking-wider flex items-center space-x-2">
          <span>Pending Enquiries</span>
          <span className="bg-purple-950 text-purple-300 border border-purple-800 text-xs px-2 py-0.5 rounded-full">
            {counts.pending} Pending
          </span>
        </h2>

        {pendingEnquiries.length === 0 ? (
          <div className="cabms-card p-6 text-center text-xs text-(--cabms-text-secondary)">
            No pending enquiries in this workspace.
          </div>
        ) : (
          <div className="space-y-3">
            {pendingEnquiries.map(enq => (
              <div key={enq.id} className="cabms-card p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-purple-400">{enq.id}</span>
                      <span className="font-bold text-sm text-(--cabms-text-primary)">{enq.customer_name}</span>
                    </div>
                    <div className="text-[11px] text-(--cabms-text-secondary) mt-1 flex flex-wrap gap-3">
                      <span className="flex items-center gap-1">
                        <FontAwesomeIcon icon={faClock} className="w-3 h-3" />
                        {enq.created_at}
                      </span>
                      <span>Source: {enq.source_website}</span>
                      <span>
                        Ack Email:{' '}
                        <strong>
                          {enq.acknowledgement_status === 'SANDBOX_SIMULATED'
                            ? 'SANDBOX_SIMULATED'
                            : enq.acknowledgement_status}
                        </strong>
                      </span>
                    </div>
                  </div>
                  <div className="text-xs">
                    {enq.matched_customer_id ? (
                      <span className="bg-sky-950/80 border border-sky-800 text-sky-300 px-2.5 py-1 rounded">
                        Matched Customer: {enq.matched_customer_id}
                      </span>
                    ) : (
                      <span className="cabms-card-subtle text-(--cabms-text-secondary) px-2.5 py-1 rounded">
                        New Customer Lead
                      </span>
                    )}
                  </div>
                </div>

                <div className="cabms-card-subtle p-3 text-xs space-y-1.5">
                  <div className="font-bold text-(--cabms-text-primary)">{enq.service_requested}</div>
                  {enq.notes && <p className="text-(--cabms-text-secondary)">{enq.notes}</p>}
                  <div className="flex flex-wrap gap-4 text-[11px] text-(--cabms-text-secondary)">
                    <span className="flex items-center gap-1">
                      <FontAwesomeIcon icon={faEnvelope} className="w-3 h-3" />
                      {enq.email}
                    </span>
                    <span className="flex items-center gap-1">
                      <FontAwesomeIcon icon={faPhone} className="w-3 h-3" />
                      {enq.phone}
                    </span>
                    {enq.site_address && (
                      <span className="flex items-center gap-1">
                        <FontAwesomeIcon icon={faLocationDot} className="w-3 h-3" />
                        {enq.site_address}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end space-x-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleDismiss(enq.id)}
                    className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) text-xs font-semibold rounded cursor-pointer disabled:opacity-50"
                  >
                    Dismiss Lead
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setConvertTarget(enq);
                      setCustomerMode(enq.matched_customer_id ? 'matched' : 'new');
                      setSelectedCustomerId(enq.matched_customer_id || customers[0]?.id || '');
                      setSelectedJobTypeId(workspaceJobTypes[0]?.id || '');
                    }}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded cursor-pointer disabled:opacity-50"
                  >
                    <span>Convert to Job</span>
                    <FontAwesomeIcon icon={faArrowRight} className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Processed Enquiries */}
      {processedEnquiries.length > 0 && (
        <div className="cabms-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-(--cabms-text-secondary)">
              Processed Enquiries ({processedEnquiries.length})
            </h3>
            <button
              type="button"
              onClick={() => setActiveTab('jobs')}
              className="text-xs text-purple-400 hover:underline cursor-pointer"
            >
              Open Jobs
            </button>
          </div>
          <div className="space-y-1.5 text-xs">
            {processedEnquiries.map(enq => (
              <div key={enq.id} className="cabms-card-subtle p-2.5 flex items-center justify-between">
                <div>
                  <span className="font-mono font-bold">{enq.id}</span> • {enq.customer_name}
                  {enq.converted_job_id && (
                    <span className="ml-2 font-mono text-emerald-400">↳ Job: {enq.converted_job_id}</span>
                  )}
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded border cabms-border">
                  {enq.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Conversion Modal */}
      {convertTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 flex items-center justify-center p-4">
          <div className="cabms-card rounded-xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <div className="flex items-center space-x-2">
                <FontAwesomeIcon icon={faFileCircleCheck} className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-(--cabms-text-primary)">Convert Enquiry {convertTarget.id}</h3>
              </div>
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="text-xs text-(--cabms-text-secondary) cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <label className="block font-bold text-(--cabms-text-secondary)">Customer Resolution</label>
              <select
                aria-label="Customer resolution mode"
                value={customerMode}
                onChange={e => setCustomerMode(e.target.value as 'matched' | 'existing' | 'new')}
                className="w-full cabms-input rounded p-2 text-xs text-(--cabms-text-primary)"
              >
                {convertTarget.matched_customer_id && (
                  <option value="matched">Use Matched Customer ({convertTarget.matched_customer_id})</option>
                )}
                <option value="new">Create New Customer Record</option>
                <option value="existing">Link Existing Customer ID</option>
              </select>

              {customerMode === 'existing' && (
                <input
                  value={selectedCustomerId}
                  onChange={e => setSelectedCustomerId(e.target.value)}
                  placeholder="Customer ID"
                  className="w-full cabms-input rounded p-2 text-xs text-(--cabms-text-primary)"
                />
              )}

              {workspaceJobTypes.length > 0 && (
                <>
                  <label className="block font-bold text-(--cabms-text-secondary) pt-2">Job Type</label>
                  <select
                    aria-label="Job type"
                    value={selectedJobTypeId}
                    onChange={e => setSelectedJobTypeId(e.target.value)}
                    className="w-full cabms-input rounded p-2 text-xs text-(--cabms-text-primary)"
                  >
                    {workspaceJobTypes.map(jt => (
                      <option key={jt.id} value={jt.id}>
                        {jt.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setConvertTarget(null)}
                className="px-3 py-1.5 cabms-surface-subtle border cabms-border rounded cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleConvert()}
                className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded cursor-pointer disabled:opacity-50"
              >
                Confirm Conversion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
