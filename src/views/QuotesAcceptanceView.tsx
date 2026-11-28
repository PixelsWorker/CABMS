/**
 * Area H: Quotations and Customer Acceptance
 * MYOB-linked quote preview, snapshot terms preservation,
 * interactive customer acceptance link simulation (valid/expired/revoked/already accepted),
 * unquoted job handling with interactive quote generation (G00-006, G00-016),
 * and explicitly DEFERRED detailed electronic signature notice.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { useG01Session } from '../context/G01Session.tsx';
import { buildApiUrl } from '../services/g01Client.ts';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowUpRightFromSquare,
  faBuilding,
  faCircleCheck,
  faCircleQuestion,
  faClock,
  faCopy,
  faDollarSign,
  faFileLines,
  faPaperPlane,
  faPlus,
  faRotateLeft,
  faShieldHalved,
  faTriangleExclamation,
  faUserCheck,
} from '@fortawesome/free-solid-svg-icons';
import { BrandId, Quote } from '../types/cabms.ts';

interface ApiQuotationLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
}

interface ApiQuotationFollowUp {
  id: string;
  quote_id: string;
  stage: 'STAGE_1_COURTESY' | 'STAGE_2_EXPIRY';
  scheduled_date: string;
  status: 'SCHEDULED' | 'SENT' | 'CANCELLED';
  sent_at: string | null;
  channel: string;
  email_delivery_id?: string | null;
}

interface ApiQuotationEvent {
  id: string;
  quote_id: string;
  event_type: string;
  actor_name: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface ApiEmailDispatch {
  deliveryId: string;
  status: 'SENT' | 'QUEUED' | 'SANDBOX_LOGGED' | 'FAILED' | 'UNCERTAIN';
  transport: string;
  error?: string;
}

interface ApiQuotationRecord {
  id: string;
  workspace_id: string;
  job_id: string;
  customer_id: string | null;
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
  refusal_reason: string | null;
  revocation_reason: string | null;
  line_items: ApiQuotationLineItem[];
  follow_ups: ApiQuotationFollowUp[];
  events?: ApiQuotationEvent[];
}

interface PersistedComplianceJob {
  id: string;
  workspace_id: string;
  job_type_id: string;
  policy_id: string;
  title: string;
  status: string;
  version: number;
  assignee_id: string | null;
  customer_name?: string | null;
  site_address?: string | null;
}

interface TargetJobSummary {
  id: string;
  brandId: BrandId;
  customerId: string;
  title: string;
  siteContact: string;
  siteAddress: string;
  quote?: Quote;
}

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
  } = useCabms();

  const session = useG01Session();
  const isAuthenticatedWorkspace = Boolean(session?.profile && session?.workspaceId);
  const activeWorkspaceId = session?.workspaceId ?? null;
  const sessionRole = activeWorkspaceId
    ? session?.profile?.memberships.find(m => m.workspace_id === activeWorkspaceId)?.role ?? null
    : null;

  const [viewMode, setViewMode] = useState<'office' | 'recipient'>('office');
  const [activeLinkScenario, setActiveLinkScenario] = useState<
    'valid' | 'invalid' | 'expired' | 'revoked' | 'superseded' | 'already_accepted'
  >('valid');
  const [customerAcceptedCheck, setCustomerAcceptedCheck] = useState(false);
  const [acceptanceFeedback, setAcceptanceFeedback] = useState<{ success: boolean; message: string } | null>(null);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [isPrepareModalOpen, setIsPrepareModalOpen] = useState(false);

  // Persisted D1 compliance jobs (replaces demo CabmsContext.jobs when authenticated)
  const [d1Jobs, setD1Jobs] = useState<PersistedComplianceJob[]>([]);
  const [d1JobsLoading, setD1JobsLoading] = useState(false);
  const [d1JobsError, setD1JobsError] = useState<string | null>(null);
  const [d1SelectedJobId, setD1SelectedJobId] = useState<string>('');

  // D1-backed quotation state (active when authenticated G01 session is present)
  const [d1Quote, setD1Quote] = useState<ApiQuotationRecord | null>(null);
  const [d1Loading, setD1Loading] = useState(false);
  const [d1Error, setD1Error] = useState<string | null>(null);
  const [d1ActionNotice, setD1ActionNotice] = useState<string | null>(null);
  const [recipientEmail, setRecipientEmail] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [tokensByQuoteId, setTokensByQuoteId] = useState<Record<string, string>>({});
  const [dispatchByQuoteId, setDispatchByQuoteId] = useState<Record<string, ApiEmailDispatch>>({});
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  // New Quote Form State for unquoted jobs (G00-016)
  const [quoteTitle, setQuoteTitle] = useState('Standard Service Quotation');
  const [quoteAmount, setQuoteAmount] = useState('1450');

  const jobsRequestSeqRef = useRef(0);
  const jobsAbortRef = useRef<AbortController | null>(null);
  const quoteRequestSeqRef = useRef(0);
  const quoteAbortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const d1SelectedJobIdRef = useRef(d1SelectedJobId);
  d1SelectedJobIdRef.current = d1SelectedJobId;

  const selectableJobs: TargetJobSummary[] = isAuthenticatedWorkspace
    ? d1Jobs.map(j => ({
        id: j.id,
        brandId: (j.workspace_id as BrandId) || (activeWorkspaceId as BrandId),
        customerId: '',
        title: j.title,
        siteContact: j.customer_name || 'Customer',
        siteAddress: j.site_address || 'Site address on file',
      }))
    : jobs.map(j => ({
        id: j.id,
        brandId: j.brandId,
        customerId: j.customerId,
        title: j.title,
        siteContact: j.siteContact,
        siteAddress: j.siteAddress,
        quote: j.quote,
      }));

  const effectiveSelectedId = isAuthenticatedWorkspace ? d1SelectedJobId : selectedJobId;
  // In authenticated mode, select strictly from D1 compliance jobs (never CabmsContext.jobs)
  const currentJob: TargetJobSummary | undefined = selectableJobs.find(j => j.id === effectiveSelectedId) || selectableJobs[0];

  const latestSelectionRef = useRef<{ workspaceId: string | null; jobId: string | null }>({
    workspaceId: activeWorkspaceId,
    jobId: currentJob?.id ?? null,
  });
  latestSelectionRef.current = {
    workspaceId: activeWorkspaceId,
    jobId: currentJob?.id ?? null,
  };

  const loadPersistedJobs = useCallback(async () => {
    const activeSession = sessionRef.current;
    const targetWorkspaceId = activeSession?.workspaceId ?? null;
    if (!activeSession?.profile || !targetWorkspaceId) return;
    jobsAbortRef.current?.abort();
    const controller = new AbortController();
    jobsAbortRef.current = controller;
    const reqSeq = ++jobsRequestSeqRef.current;

    setD1JobsLoading(true);
    setD1JobsError(null);
    try {
      const token = await activeSession.token();
      if (controller.signal.aborted || reqSeq !== jobsRequestSeqRef.current || latestSelectionRef.current.workspaceId !== targetWorkspaceId) {
        return;
      }

      const loaded: PersistedComplianceJob[] = [];
      let after: string | null = null;
      do {
        const query = after ? `?after=${encodeURIComponent(after)}` : '';
        const res = await fetch(
          buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(targetWorkspaceId)}/compliance-jobs${query}`),
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );
        if (controller.signal.aborted || reqSeq !== jobsRequestSeqRef.current || latestSelectionRef.current.workspaceId !== targetWorkspaceId) {
          return;
        }
        if (!res.ok) {
          const problem = (await res.json().catch(() => ({}))) as { detail?: string };
          if (controller.signal.aborted || reqSeq !== jobsRequestSeqRef.current) return;
          setD1Jobs([]);
          setD1JobsError(problem.detail || `Failed to load compliance jobs (${res.status})`);
          return;
        }
        const page = (await res.json()) as { jobs?: PersistedComplianceJob[]; after?: string | null };
        if (controller.signal.aborted || reqSeq !== jobsRequestSeqRef.current || latestSelectionRef.current.workspaceId !== targetWorkspaceId) {
          return;
        }
        loaded.push(...(page.jobs ?? []));
        after = page.after ?? null;
      } while (after);

      setD1Jobs(loaded);
      setD1SelectedJobId(prev => {
        if (prev && loaded.some(j => j.id === prev)) return prev;
        return loaded[0]?.id ?? '';
      });
    } catch (err) {
      if (controller.signal.aborted || reqSeq !== jobsRequestSeqRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setD1Jobs([]);
      setD1JobsError(err instanceof Error ? err.message : 'Unable to reach compliance jobs API');
    } finally {
      if (!controller.signal.aborted && reqSeq === jobsRequestSeqRef.current) {
        setD1JobsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    jobsAbortRef.current?.abort();
    quoteAbortRef.current?.abort();
    jobsRequestSeqRef.current += 1;
    quoteRequestSeqRef.current += 1;

    setD1Jobs([]);
    setD1SelectedJobId('');
    setD1JobsError(null);
    setD1Quote(null);
    setD1Error(null);
    setD1ActionNotice(null);
    setCopyNotice(null);

    if (isAuthenticatedWorkspace && activeWorkspaceId) {
      void loadPersistedJobs();
    } else {
      setD1JobsLoading(false);
    }

    return () => {
      jobsAbortRef.current?.abort();
    };
  }, [isAuthenticatedWorkspace, activeWorkspaceId, loadPersistedJobs]);

  const loadD1Quotation = useCallback(async (targetWorkspaceId: string, targetJobId: string) => {
    const activeSession = sessionRef.current;
    if (!activeSession?.profile) return;
    quoteAbortRef.current?.abort();
    const controller = new AbortController();
    quoteAbortRef.current = controller;
    const reqSeq = ++quoteRequestSeqRef.current;

    setD1Loading(true);
    setD1Error(null);
    try {
      const token = await activeSession.token();
      if (
        controller.signal.aborted ||
        reqSeq !== quoteRequestSeqRef.current ||
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      const res = await fetch(
        buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(targetWorkspaceId)}/quotations?job_id=${encodeURIComponent(targetJobId)}`),
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        }
      );
      if (
        controller.signal.aborted ||
        reqSeq !== quoteRequestSeqRef.current ||
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      if (!res.ok) {
        const problem = (await res.json().catch(() => ({}))) as { detail?: string };
        if (controller.signal.aborted || reqSeq !== quoteRequestSeqRef.current) return;
        setD1Quote(null);
        setD1Error(problem.detail || `Failed to load quotation (${res.status})`);
        return;
      }
      const data = (await res.json()) as { quotations?: ApiQuotationRecord[] };
      if (
        controller.signal.aborted ||
        reqSeq !== quoteRequestSeqRef.current ||
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      const list = (data.quotations ?? []).filter(
        q => q.job_id === targetJobId && q.workspace_id === targetWorkspaceId
      );
      const activeQuote = list.find(q => q.acceptance_status !== 'SUPERSEDED') ?? list[0] ?? null;
      setD1Quote(activeQuote);
    } catch (err) {
      if (controller.signal.aborted || reqSeq !== quoteRequestSeqRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setD1Quote(null);
      setD1Error(err instanceof Error ? err.message : 'Unable to reach quotation API');
    } finally {
      if (!controller.signal.aborted && reqSeq === quoteRequestSeqRef.current) {
        setD1Loading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Immediately clear stale quote state whenever selectedJobId or workspace changes
    quoteAbortRef.current?.abort();
    quoteRequestSeqRef.current += 1;
    setD1Quote(null);
    setD1Error(null);
    setD1ActionNotice(null);
    setCopyNotice(null);

    if (
      isAuthenticatedWorkspace &&
      activeWorkspaceId &&
      currentJob?.id &&
      currentJob.brandId === activeWorkspaceId
    ) {
      void loadD1Quotation(activeWorkspaceId, currentJob.id);
    } else {
      setD1Loading(false);
    }

    return () => {
      quoteAbortRef.current?.abort();
    };
  }, [isAuthenticatedWorkspace, activeWorkspaceId, currentJob?.id, currentJob?.brandId, loadD1Quotation]);

  const isActiveD1QuoteValid = Boolean(
    isAuthenticatedWorkspace &&
    activeWorkspaceId &&
    currentJob?.id &&
    d1Quote &&
    d1Quote.job_id === currentJob.id &&
    d1Quote.workspace_id === activeWorkspaceId
  );

  const quote: Quote | undefined = isAuthenticatedWorkspace
    ? isActiveD1QuoteValid && d1Quote
      ? {
          id: d1Quote.id,
          jobId: d1Quote.job_id,
          customerId: d1Quote.customer_id || currentJob?.customerId || '',
          brandId: (d1Quote.brand_id as Quote['brandId']) || currentJob?.brandId || 'solarcell',
          externalMyobRef: d1Quote.external_myob_ref || d1Quote.id,
          title: d1Quote.title,
          subtotal: d1Quote.subtotal,
          gst: d1Quote.gst,
          total: d1Quote.total,
          lineItems: d1Quote.line_items.map(li => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unit_price,
            total: li.total,
          })),
          termsVersion: d1Quote.terms_version || 'DRAFT (Pending Send)',
          termsContentSnapshot:
            d1Quote.terms_content_snapshot ||
            'Terms snapshot will be frozen from the published QUOTE_TERMS template when sent.',
          frozenIssuerSnapshot: d1Quote.frozen_issuer_snapshot || 'Issuer details frozen on send',
          acceptanceStatus: d1Quote.acceptance_status === 'REFUSED' ? 'REVOKED' : d1Quote.acceptance_status,
          linkScenario: 'valid',
          issuedAt: d1Quote.issued_at || undefined,
          expiresAt: d1Quote.expires_at || undefined,
          acceptedAt: d1Quote.accepted_at || undefined,
          acceptedByName: d1Quote.accepted_by_name || undefined,
          refusalReason: d1Quote.refusal_reason || d1Quote.revocation_reason || undefined,
          followUps: d1Quote.follow_ups.map(fu => ({
            id: fu.id,
            quoteId: fu.quote_id,
            stage: fu.stage,
            scheduledDate: fu.scheduled_date,
            status: fu.status,
            sentAt: fu.sent_at || undefined,
            channel: 'EMAIL_SIMULATED',
          })),
          acceptanceHistory: [],
        }
      : undefined
    : currentJob?.quote; // Truthful: no fallback to jobs[0].quote! (G00-006)

  // Reset simulator state when job or workspace changes (G00-017)
  useEffect(() => {
    setCustomerAcceptedCheck(false);
    setAcceptanceFeedback(null);
  }, [currentJob?.id, activeWorkspaceId]);

  // Persona boundary: Technician is read-only or restricted
  if (persona === 'technician' || sessionRole === 'technician') {
    return (
      <AccessDeniedView
        resourceName="MYOB Quotations & Customer Acceptance Portal"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians do not prepare quotations, send financial customer acceptance links, or administer deposit invoicing."
      />
    );
  }

  const runD1Action = async (
    pathSuffix: string,
    method: 'POST' | 'PATCH' = 'POST',
    payload?: Record<string, unknown>,
    successMessage?: string
  ) => {
    if (!isActiveD1QuoteValid || !activeWorkspaceId || !d1Quote || !currentJob) return;
    const targetWorkspaceId = d1Quote.workspace_id;
    const targetJobId = d1Quote.job_id;
    const targetQuoteId = d1Quote.id;

    setD1Loading(true);
    setD1Error(null);
    setD1ActionNotice(null);
    try {
      const token = await session!.token();
      if (
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      const res = await fetch(
        buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(targetWorkspaceId)}/quotations/${encodeURIComponent(targetQuoteId)}${pathSuffix}`),
        {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: payload ? JSON.stringify(payload) : undefined,
        }
      );
      const data = (await res.json().catch(() => ({}))) as {
        quotation?: ApiQuotationRecord;
        acceptance_token?: string;
        email_dispatch?: ApiEmailDispatch | null;
        detail?: string;
      };
      if (
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      if (!res.ok) {
        setD1Error(data.detail || `Quotation action failed (${res.status})`);
        return;
      }
      if (data.quotation && data.quotation.job_id === targetJobId && data.quotation.workspace_id === targetWorkspaceId) {
        setD1Quote(data.quotation);
        if (data.acceptance_token) {
          const quoteKey = data.quotation.id;
          const nextToken = data.acceptance_token;
          setTokensByQuoteId(prev => ({ ...prev, [quoteKey]: nextToken }));
        }
        if (data.email_dispatch) {
          const quoteKey = data.quotation.id;
          const dispatch = data.email_dispatch;
          setDispatchByQuoteId(prev => ({ ...prev, [quoteKey]: dispatch }));
        }
      }
      if (data.email_dispatch?.status === 'FAILED') {
        setD1Error(
          `Email dispatch FAILED${data.email_dispatch.error ? `: ${data.email_dispatch.error}` : ''}. Use Retry / Resend Quote Email below to recover.`
        );
      } else if (data.email_dispatch?.status === 'UNCERTAIN') {
        setD1Error(
          `Email dispatch outcome is UNCERTAIN${data.email_dispatch.error ? `: ${data.email_dispatch.error}` : ''}. Verify delivery or retry dispatch below.`
        );
      } else if (successMessage) {
        setD1ActionNotice(successMessage);
      }
    } catch (err) {
      if (
        latestSelectionRef.current.workspaceId === targetWorkspaceId &&
        latestSelectionRef.current.jobId === targetJobId
      ) {
        setD1Error(err instanceof Error ? err.message : 'Quotation action failed');
      }
    } finally {
      if (
        latestSelectionRef.current.workspaceId === targetWorkspaceId &&
        latestSelectionRef.current.jobId === targetJobId
      ) {
        setD1Loading(false);
      }
    }
  };

  const handleSimulateAcceptance = () => {
    if (!quote || !currentJob) return;
    if (isAuthenticatedWorkspace) {
      if (!isActiveD1QuoteValid || !d1Quote) return;
      if (!customerAcceptedCheck) {
        setAcceptanceFeedback({
          success: false,
          message: 'Customer must check the acceptance confirmation box before submitting.',
        });
        return;
      }
      void runD1Action('/accept', 'POST', { accepted_by_name: currentJob.siteContact }, 'Quotation accepted and persisted to D1.');
      return;
    }

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

  const createD1Quote = async (exSubtotal: number) => {
    if (!isAuthenticatedWorkspace || !activeWorkspaceId || !currentJob || currentJob.brandId !== activeWorkspaceId) return;
    const targetWorkspaceId = activeWorkspaceId;
    const targetJobId = currentJob.id;
    setD1Loading(true);
    setD1Error(null);
    try {
      const token = await session!.token();
      if (
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      const res = await fetch(
        buildApiUrl(`/api/v1/workspaces/${encodeURIComponent(targetWorkspaceId)}/quotations`),
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            job_id: targetJobId,
            customer_id: currentJob.customerId || undefined,
            brand_id: currentJob.brandId,
            title: quoteTitle,
            line_items: [
              {
                id: 'ITEM-01',
                description: quoteTitle,
                quantity: 1,
                unit_price: exSubtotal,
              },
            ],
          }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { quotation?: ApiQuotationRecord; detail?: string };
      if (
        latestSelectionRef.current.workspaceId !== targetWorkspaceId ||
        latestSelectionRef.current.jobId !== targetJobId
      ) {
        return;
      }
      if (!res.ok) {
        setD1Error(data.detail || `Failed to create quotation (${res.status})`);
        return;
      }
      if (data.quotation && data.quotation.job_id === targetJobId && data.quotation.workspace_id === targetWorkspaceId) {
        setD1Quote(data.quotation);
      }
      setD1ActionNotice('Draft quotation saved to D1.');
      setIsPrepareModalOpen(false);
    } catch (err) {
      setD1Error(err instanceof Error ? err.message : 'Failed to create quotation');
    } finally {
      setD1Loading(false);
    }
  };

  const handlePrepareQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentJob) return;
    const grossTotal = parseFloat(quoteAmount) || 1450;
    // GST convention: Gross total / 1.1 = Subtotal ex-GST
    const exSubtotal = Math.round((grossTotal / 1.1) * 100) / 100;

    if (isAuthenticatedWorkspace) {
      void createD1Quote(exSubtotal);
      return;
    }

    try {
      prepareQuoteForJob(currentJob.id, quoteTitle, [
        {
          id: 'ITEM-01',
          description: quoteTitle,
          quantity: 1,
          unitPrice: exSubtotal,
          total: exSubtotal,
        },
      ]);
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith('Cannot prepare quote:')) return;
      throw error;
    }

    setIsPrepareModalOpen(false);
  };

  const jobBrand = currentJob ? brands[currentJob.brandId] : undefined;

  if (isAuthenticatedWorkspace && d1JobsLoading) {
    return (
      <div className="cabms-card p-8 text-center space-y-2" data-testid="d1-jobs-loading">
        <FontAwesomeIcon icon={faClock} className="w-6 h-6 text-sky-400 animate-pulse" />
        <p className="text-sm font-semibold text-(--cabms-text-primary)">Loading persisted compliance jobs...</p>
      </div>
    );
  }

  if (isAuthenticatedWorkspace && d1JobsError) {
    return (
      <div className="cabms-card p-8 text-center space-y-4 border border-red-800/80" data-testid="d1-jobs-error">
        <FontAwesomeIcon icon={faTriangleExclamation} className="w-6 h-6 text-red-400" />
        <div className="space-y-1">
          <h2 className="text-base font-bold text-(--cabms-text-primary)">Unable to Load Workspace Compliance Jobs</h2>
          <p className="text-xs text-red-300">{d1JobsError}</p>
        </div>
        <button
          type="button"
          onClick={() => void loadPersistedJobs()}
          className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition cursor-pointer"
        >
          Retry Loading Jobs
        </button>
      </div>
    );
  }

  if (isAuthenticatedWorkspace && !currentJob) {
    return (
      <div className="cabms-card p-8 text-center space-y-3" data-testid="d1-jobs-empty">
        <FontAwesomeIcon icon={faFileLines} className="w-6 h-6 text-(--cabms-text-secondary)" />
        <h2 className="text-base font-bold text-(--cabms-text-primary)">No Persisted Compliance Jobs Found</h2>
        <p className="text-xs text-(--cabms-text-secondary) max-w-md mx-auto">
          Create or convert a compliance job in Jobs &amp; Operations for this workspace before preparing a quotation.
        </p>
        <button
          type="button"
          onClick={() => void loadPersistedJobs()}
          className="px-4 py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) text-xs font-bold rounded-lg transition cursor-pointer"
        >
          Refresh Workspace Jobs
        </button>
      </div>
    );
  }

  if (!currentJob || !jobBrand) {
    return (
      <AccessDeniedView
        resourceName="Quotations & Terms"
        requiredRoleDescription="Authorized Workspace Member"
        customExplanation="This work order is not associated with an authorized workspace for your account."
      />
    );
  }

  const latestDispatchEvent = (() => {
    const events = isActiveD1QuoteValid && d1Quote?.events ? d1Quote.events : [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (['EMAIL_DISPATCHED', 'EMAIL_DISPATCH_FAILED', 'EMAIL_DISPATCH_UNCERTAIN'].includes(ev.event_type)) {
        return {
          eventType: ev.event_type,
          status: typeof ev.details?.status === 'string' ? ev.details.status : '',
          recipientEmail: typeof ev.details?.recipient_email === 'string' ? ev.details.recipient_email : '',
          error: typeof ev.details?.error === 'string' ? ev.details.error : '',
        };
      }
    }
    return null;
  })();

  const recordedDispatch = isActiveD1QuoteValid && d1Quote ? dispatchByQuoteId[d1Quote.id] : undefined;
  const effectiveDispatchStatus = recordedDispatch?.status || latestDispatchEvent?.status || null;
  const needsDispatchRecovery = Boolean(
    isActiveD1QuoteValid &&
      d1Quote?.acceptance_status === 'SENT' &&
      (effectiveDispatchStatus === 'FAILED' ||
        effectiveDispatchStatus === 'UNCERTAIN' ||
        latestDispatchEvent?.eventType === 'EMAIL_DISPATCH_FAILED' ||
        latestDispatchEvent?.eventType === 'EMAIL_DISPATCH_UNCERTAIN')
  );
  const recoveryRecipient = (recipientEmail || latestDispatchEvent?.recipientEmail || '').trim();
  const activePortalToken = isActiveD1QuoteValid && d1Quote ? tokensByQuoteId[d1Quote.id] || null : null;
  const activePortalUrl = activePortalToken
    ? `${typeof window !== 'undefined' && window.location?.origin ? window.location.origin : ''}/?quote_token=${encodeURIComponent(activePortalToken)}`
    : null;

  const copyPortalUrl = async () => {
    if (!activePortalUrl) return;
    try {
      await navigator.clipboard?.writeText(activePortalUrl);
      setCopyNotice('Customer portal URL copied to clipboard.');
    } catch {
      setCopyNotice(`Customer portal URL: ${activePortalUrl}`);
    }
  };

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
              {isAuthenticatedWorkspace
                ? 'Persistent D1 quotation preparation, frozen Terms snapshots, and customer portal acceptance links.'
                : 'MYOB quote preparation, frozen Terms snapshots, and customer online acceptance testing (Preview Mode).'}
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
                value={currentJob.id}
                onChange={e => {
                  const nextId = e.target.value;
                  if (nextId === currentJob.id) return;
                  quoteAbortRef.current?.abort();
                  quoteRequestSeqRef.current += 1;
                  latestSelectionRef.current = { workspaceId: activeWorkspaceId, jobId: nextId || null };
                  setD1Quote(null);
                  setD1Error(null);
                  setD1ActionNotice(null);
                  setCopyNotice(null);
                  if (isAuthenticatedWorkspace) {
                    setD1SelectedJobId(nextId);
                  } else {
                    setSelectedJobId(nextId);
                  }
                }}
                className="w-full min-w-0 max-w-full cabms-card-subtle rounded px-2.5 py-1 text-(--cabms-text-primary) font-mono text-xs font-bold cursor-pointer"
              >
                {selectableJobs.map(j => (
                  <option key={j.id} value={j.id}>
                    {j.id} — {j.title} {!isAuthenticatedWorkspace ? (j.quote ? `($${j.quote.total.toLocaleString()})` : '(Unquoted)') : ''}
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
      {isAuthenticatedWorkspace && d1Loading && !quote ? (
        <div className="cabms-card p-8 text-center space-y-2" data-testid="d1-quote-loading">
          <FontAwesomeIcon icon={faClock} className="w-6 h-6 text-sky-400 animate-pulse" />
          <p className="text-sm font-semibold text-(--cabms-text-primary)">Loading quotation for {currentJob.id}...</p>
        </div>
      ) : !quote ? (
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
          {isAuthenticatedWorkspace && d1Error && (
            <div className="max-w-md mx-auto p-2.5 rounded bg-red-950/70 border border-red-800 text-red-200 text-xs">
              {d1Error}
            </div>
          )}
          <button
            type="button"
            disabled={isAuthenticatedWorkspace && (d1Loading || d1JobsLoading)}
            onClick={() => setIsPrepareModalOpen(true)}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-md cursor-pointer disabled:opacity-50"
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
            <div className="flex flex-wrap items-center gap-2 text-(--cabms-text-secondary)">
              {isAuthenticatedWorkspace ? (
                activePortalUrl ? (
                  <>
                    <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800 break-all" data-testid="recipient-portal-url">
                      {activePortalUrl}
                    </span>
                    <button
                      type="button"
                      onClick={() => void copyPortalUrl()}
                      className="px-2.5 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded font-semibold transition cursor-pointer inline-flex items-center gap-1"
                    >
                      <FontAwesomeIcon icon={faCopy} className="w-3 h-3" />
                      <span>Copy Link</span>
                    </button>
                    <a
                      href={activePortalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 rounded font-bold transition inline-flex items-center gap-1"
                    >
                      <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3 h-3" />
                      <span>Open Customer Portal</span>
                    </a>
                  </>
                ) : (
                  <span className="text-[11px] text-(--cabms-text-secondary)">
                    {quote.acceptanceStatus === 'DRAFT'
                      ? 'Send & freeze this quotation in Office Administration to issue a customer ?quote_token= portal link.'
                      : 'Acceptance token is hashed at rest. Send or resend the quotation to generate a fresh ?quote_token= portal link.'}
                  </span>
                )
              ) : (
                <span className="font-mono text-[11px] text-emerald-400 bg-emerald-950/80 px-2.5 py-1 rounded border border-emerald-800">
                  https://portal.cabms.example.invalid/quotes/accept?token=tok_{currentJob.id.toLowerCase()}
                </span>
              )}
            </div>

            <div className="flex items-center space-x-2">
              {!isAuthenticatedWorkspace && (
                <>
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
                </>
              )}
              <button
                onClick={() => setViewMode('office')}
                className="px-3 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) rounded font-semibold transition cursor-pointer"
              >
                Return to Office
              </button>
            </div>
          </div>
          {copyNotice && (
            <div className="p-2.5 rounded bg-sky-950/70 border border-sky-800 text-sky-200 text-xs">
              {copyNotice}
            </div>
          )}

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
                  Stage 1 (3 business days courtesy) • Stage 2 (expiry warning): seven business days is the target, capped before expiration. Strict 14-calendar-day validity cap.
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
                      {fu.stage === 'STAGE_1_COURTESY' ? 'Stage 1 (3d)' : 'Stage 2 (expiry warning)'}: {fu.status} ({fu.scheduledDate})
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
              {isAuthenticatedWorkspace && d1Error && (
                <div className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-200 text-xs">{d1Error}</div>
              )}
              {isAuthenticatedWorkspace && d1ActionNotice && (
                <div className="p-3 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs">{d1ActionNotice}</div>
              )}
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
                type="button"
                disabled={isAuthenticatedWorkspace && (d1Loading || !isActiveD1QuoteValid || quote.acceptanceStatus !== 'SENT')}
                onClick={handleSimulateAcceptance}
                className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-extrabold text-sm rounded-xl transition shadow-lg cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-2"
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
                  {isAuthenticatedWorkspace
                    ? `Manage customer acceptance portal links and D1 quotation lifecycle for ${currentJob.siteContact}.`
                    : `Test the standalone customer acceptance portal link generated for ${currentJob.siteContact}.`}
                </p>

                {isAuthenticatedWorkspace && activePortalUrl && (
                  <div className="cabms-card-subtle p-3 space-y-2 border border-emerald-800/60" data-testid="office-portal-link-box">
                    <div className="text-[11px] font-bold text-emerald-300">Customer Portal Link (?quote_token=)</div>
                    <div className="font-mono text-[10px] text-emerald-400 break-all">{activePortalUrl}</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void copyPortalUrl()}
                        className="px-2.5 py-1 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-semibold rounded transition cursor-pointer inline-flex items-center gap-1"
                      >
                        <FontAwesomeIcon icon={faCopy} className="w-3 h-3" />
                        <span>Copy Customer Link</span>
                      </button>
                      <a
                        href={activePortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded transition inline-flex items-center gap-1"
                      >
                        <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-3 h-3" />
                        <span>Open Portal</span>
                      </a>
                    </div>
                    {copyNotice && <div className="text-[11px] text-sky-300">{copyNotice}</div>}
                  </div>
                )}

                <button
                  onClick={() => setViewMode('recipient')}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs rounded-lg transition shadow-md cursor-pointer flex items-center justify-center space-x-1.5"
                >
                  <FontAwesomeIcon icon={faArrowUpRightFromSquare} className="w-4 h-4" />
                  <span>Open Standalone Recipient Portal</span>
                </button>

                {!isAuthenticatedWorkspace && (
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
                )}

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
                  type="button"
                  disabled={isAuthenticatedWorkspace && (d1Loading || !isActiveD1QuoteValid || quote.acceptanceStatus !== 'SENT')}
                  onClick={handleSimulateAcceptance}
                  className="w-full py-2 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-bold text-xs rounded-lg transition cursor-pointer disabled:opacity-50 flex items-center justify-center space-x-1.5"
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

                {isAuthenticatedWorkspace && isActiveD1QuoteValid && d1Quote && (
                  <div className="pt-3 border-t border-slate-800 space-y-2" data-testid="d1-quote-lifecycle-controls">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                      D1 Quotation Lifecycle ({d1Quote.acceptance_status})
                    </div>
                    {d1Error && (
                      <div className="p-2 rounded bg-red-950/70 border border-red-800 text-red-200 text-[11px]">
                        {d1Error}
                      </div>
                    )}
                    {d1ActionNotice && (
                      <div className="p-2 rounded bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-[11px]">
                        {d1ActionNotice}
                      </div>
                    )}
                    {d1Quote.acceptance_status === 'DRAFT' && (
                      <div className="space-y-2">
                        <input
                          type="email"
                          placeholder="Optional recipient email for dispatch"
                          value={recipientEmail}
                          onChange={e => setRecipientEmail(e.target.value)}
                          className="w-full cabms-input rounded px-2.5 py-1.5 text-(--cabms-text-primary) text-xs"
                        />
                        <button
                          type="button"
                          disabled={d1Loading || !isActiveD1QuoteValid}
                          onClick={() => void runD1Action('/send', 'POST', recipientEmail ? { recipient_email: recipientEmail } : {}, 'Quotation sent and Terms snapshot frozen.')}
                          className="w-full py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-lg transition cursor-pointer disabled:opacity-50"
                        >
                          Send &amp; Freeze Terms Snapshot
                        </button>
                      </div>
                    )}
                    {d1Quote.acceptance_status === 'SENT' && needsDispatchRecovery && (
                      <div className="p-3 rounded-lg bg-amber-950/50 border border-amber-800/80 space-y-2" data-testid="d1-send-recovery-panel">
                        <div className="text-[11px] font-bold text-amber-300">
                          Email Dispatch Recovery ({effectiveDispatchStatus || 'FAILED'})
                        </div>
                        {latestDispatchEvent?.error && (
                          <div className="text-[11px] text-amber-200">{latestDispatchEvent.error}</div>
                        )}
                        <input
                          type="email"
                          placeholder="Recipient email for retry dispatch"
                          value={recipientEmail || latestDispatchEvent?.recipientEmail || ''}
                          onChange={e => setRecipientEmail(e.target.value)}
                          className="w-full cabms-input rounded px-2.5 py-1.5 text-(--cabms-text-primary) text-xs"
                        />
                        <button
                          type="button"
                          disabled={d1Loading || !isActiveD1QuoteValid || !recoveryRecipient}
                          onClick={() =>
                            void runD1Action(
                              '/send',
                              'POST',
                              { recipient_email: recoveryRecipient },
                              'Quotation email re-dispatched.'
                            )
                          }
                          className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-xs rounded transition cursor-pointer disabled:opacity-50"
                        >
                          Retry / Resend Quote Email
                        </button>
                      </div>
                    )}
                    {(d1Quote.acceptance_status === 'DRAFT' || d1Quote.acceptance_status === 'SENT') && (
                      <div className="space-y-2">
                        <input
                          type="text"
                          placeholder="Reason for refusal or revocation"
                          value={actionReason}
                          onChange={e => setActionReason(e.target.value)}
                          className="w-full cabms-input rounded px-2.5 py-1.5 text-(--cabms-text-primary) text-xs"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          {d1Quote.acceptance_status === 'SENT' && (
                            <button
                              type="button"
                              disabled={d1Loading || !isActiveD1QuoteValid || !actionReason.trim()}
                              onClick={() => void runD1Action('/refuse', 'POST', { reason: actionReason.trim() }, 'Quotation marked as refused.')}
                              className="py-1.5 bg-amber-700 hover:bg-amber-600 text-white font-bold text-xs rounded transition cursor-pointer disabled:opacity-50"
                            >
                              Record Refusal
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={d1Loading || !isActiveD1QuoteValid}
                            onClick={() => void runD1Action('/revoke', 'POST', { reason: actionReason.trim() || 'Revoked by office' }, 'Quotation revoked.')}
                            className="py-1.5 bg-red-700 hover:bg-red-600 text-white font-bold text-xs rounded transition cursor-pointer disabled:opacity-50"
                          >
                            Revoke Quote
                          </button>
                        </div>
                      </div>
                    )}
                    {['SENT', 'EXPIRED', 'REFUSED'].includes(d1Quote.acceptance_status) && (
                      <button
                        type="button"
                        disabled={d1Loading || !isActiveD1QuoteValid}
                        onClick={() => void runD1Action('/revise', 'POST', {}, 'Superseded quote and created new draft revision.')}
                        className="w-full py-1.5 cabms-surface-subtle border cabms-border text-(--cabms-text-primary) font-bold text-xs rounded transition cursor-pointer disabled:opacity-50"
                      >
                        Supersede &amp; Create Revision Draft
                      </button>
                    )}
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
