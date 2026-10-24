/**
 * Area J: Existing-Website Handoff
 * Internal website submission simulation, pending review inbox,
 * duplicate/customer matching, and explicit office conversion to draft work orders.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  Inbox,
  Plus,
  ArrowRight,
  CheckCircle2,
  XCircle,
  Building2,
  Clock,
  User,
  Mail,
  Phone,
  MapPin,
  AlertTriangle,
  FileCheck2,
} from 'lucide-react';
import { BrandId, WebsiteEnquiry } from '../types/cabms.ts';

export const WebsiteInboxView: React.FC = () => {
  const {
    websiteEnquiries,
    simulateWebsiteSubmission,
    convertEnquiryToJob,
    dismissEnquiry,
    brands,
    activeBrandId,
    setActiveTab,
    setSelectedJobId,
    customers,
    jobTypes,
    persona,
    myobConnection,
  } = useCabms();

  const [selectedBrandForSim, setSelectedBrandForSim] = useState<BrandId>(activeBrandId);
  const [conversionModalEnquiry, setConversionModalEnquiry] = useState<WebsiteEnquiry | null>(null);
  const [selectedCustMatchMode, setSelectedCustMatchMode] = useState<'matched' | 'existing_picker' | 'new_write_through'>('matched');
  const [selectedExistingCustId, setSelectedExistingCustId] = useState<string>('');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState<string>(jobTypes[0]?.id || 'jt-solar-install');

  // Role Gate: Technician restricted
  if (persona === 'technician') {
    return (
      <AccessDeniedView
        resourceName="Website Lead Inbox & Conversion"
        requiredRoleDescription="Super Admin, Admin, or Office Staff"
        customExplanation="Technicians do not triage incoming website leads, perform customer record linkage, or generate initial job types."
      />
    );
  }

  const pendingEnquiries = websiteEnquiries.filter(e => e.status === 'PENDING_REVIEW');
  const processedEnquiries = websiteEnquiries.filter(e => e.status !== 'PENDING_REVIEW');
  const conversionJobTypes = conversionModalEnquiry
    ? jobTypes.filter(jobType => jobType.brandId === conversionModalEnquiry.brandId)
    : [];
  const selectedConversionJobType = conversionJobTypes.find(jobType => jobType.id === selectedJobTypeId) || conversionJobTypes[0];

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Inbox className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-bold text-[var(--cabms-text-primary)] tracking-tight">
                Existing-Website Handoff Inbox (Office Review)
              </h1>
            </div>
            <p className="text-xs text-[var(--cabms-text-secondary)] mt-1">
              Synthetic incoming web leads. Enquiries remain in pending review until office staff match or convert them into operational work orders.
            </p>
          </div>

          {/* Trigger Simulation Button */}
          <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:items-center cabms-card-subtle p-1.5">
            <select
              aria-label="Website submission business"
              value={selectedBrandForSim}
              onChange={e => setSelectedBrandForSim(e.target.value as BrandId)}
              className="w-full min-w-0 max-w-full cabms-input text-[var(--cabms-text-primary)] text-xs font-semibold px-2 py-1.5 rounded focus:outline-none cursor-pointer"
            >
              {Object.values(brands).map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} Form
                </option>
              ))}
            </select>
            <button
              onClick={() => simulateWebsiteSubmission(selectedBrandForSim)}
              className="flex w-full shrink-0 items-center justify-center gap-1.5 whitespace-normal px-3 py-1.5 bg-purple-600 sm:w-auto hover:bg-purple-500 text-white text-xs font-bold rounded transition shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Simulate Web Submission</span>
            </button>
          </div>
        </div>

        {/* Isolation Boundary Disclosure */}
        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-[var(--cabms-text-secondary)] flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Strict boundary: No live webhooks, external forms, or website rebuilds. Synthetic entries test the office triage and matching flow.
          </span>
        </div>
      </div>

      {/* Pending Review Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--cabms-text-primary)] uppercase tracking-wider flex items-center space-x-2">
            <span>Pending Enquiries Awaiting Office Action</span>
            <span className="bg-purple-950 text-purple-300 border border-purple-800 text-xs px-2 py-0.5 rounded-full font-bold">
              {pendingEnquiries.length} Pending
            </span>
          </h2>
        </div>

        {pendingEnquiries.length === 0 ? (
          <div className="cabms-card p-8 text-center text-[var(--cabms-text-secondary)] text-xs">
            Inbox is clean. Click &quot;Simulate Web Submission&quot; above to create a synthetic enquiry.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingEnquiries.map(enq => {
              const matchedCust = customers.find(c => c.id === enq.matchedExistingCustomerId);

              return (
                <div
                  key={enq.id}
                  className="cabms-card p-5 space-y-4 hover:border-[var(--cabms-border-focus)] transition"
                >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-purple-400">{enq.id}</span>
                        <span className="text-[var(--cabms-text-primary)] font-bold text-base">{enq.customerName}</span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded text-white"
                          style={{ backgroundColor: brands[enq.brandId]?.primaryColor }}
                        >
                          {brands[enq.brandId]?.name}
                        </span>
                      </div>

                      <div className="text-xs text-[var(--cabms-text-secondary)] mt-1 flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          Received: {enq.submissionDate}
                        </span>
                        <span>•</span>
                        <span>Source: <strong className="text-[var(--cabms-text-secondary)]">{enq.sourceWebsite}</strong></span>
                      </div>
                    </div>

                    {/* Matched Customer Badge */}
                    <div>
                      {matchedCust ? (
                        <div className="bg-sky-950/80 border border-sky-800 text-sky-300 px-3 py-1 rounded-lg text-xs flex items-center space-x-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />
                          <span>Matched: {matchedCust.name} ({matchedCust.myobCustomerId})</span>
                        </div>
                      ) : (
                        <div className="cabms-card-subtle text-[var(--cabms-text-secondary)] px-3 py-1 rounded-lg text-xs">
                          New Customer Lead
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Enquiry Body */}
                  <div className="cabms-card-subtle p-4 text-xs space-y-2">
                    <div className="font-bold text-[var(--cabms-text-primary)] text-sm">
                      Requested Service: {enq.serviceRequested}
                    </div>
                    <p className="text-[var(--cabms-text-secondary)] leading-relaxed italic cabms-surface-subtle p-2.5 rounded border cabms-border">
                      &quot;{enq.notes}&quot;
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[var(--cabms-text-secondary)] text-[11px] pt-1">
                      <div className="flex items-center space-x-1.5 truncate">
                        <Mail className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>{enq.email}</span>
                      </div>
                      <div className="flex items-center space-x-1.5">
                        <Phone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>{enq.phone}</span>
                      </div>
                      <div className="flex items-center space-x-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span>{enq.address}</span>
                      </div>
                    </div>
                  </div>

                  {/* Office Review Actions: Convert or Dismiss */}
                  <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
                    <button
                      onClick={() => dismissEnquiry(enq.id)}
                      className="px-3 py-1.5 cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] text-xs font-semibold rounded-lg transition cursor-pointer"
                    >
                      Dismiss Lead
                    </button>

                    <button
                      onClick={() => {
                        setConversionModalEnquiry(enq);
                        setSelectedCustMatchMode(enq.matchedExistingCustomerId ? 'matched' : 'new_write_through');
                        setSelectedExistingCustId(enq.matchedExistingCustomerId || customers[0]?.id || '');
                        setSelectedJobTypeId(jobTypes.find(jobType => jobType.brandId === enq.brandId)?.id || '');
                      }}
                      className="flex items-center space-x-1.5 px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition shadow-md cursor-pointer"
                    >
                      <span>Convert to Work Order</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
            );
            })}
          </div>
        )}
      </div>

      {/* Processed Enquiries Log */}
      {processedEnquiries.length > 0 && (
        <div className="cabms-card p-5 space-y-3">
          <h3 className="text-xs font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider">
            Processed Enquiries Archive
          </h3>
          <div className="space-y-2 text-xs">
            {processedEnquiries.map(enq => (
              <div
                key={enq.id}
                className="cabms-card-subtle p-3 flex items-center justify-between text-[var(--cabms-text-secondary)]"
              >
                <div>
                  <span className="font-mono text-[var(--cabms-text-secondary)] font-bold">{enq.id}</span> • {enq.customerName} ({brands[enq.brandId]?.name})
                  {enq.convertedJobId && (
                    <span className="text-emerald-400 ml-2 font-mono">
                      ↳ Converted to Job: {enq.convertedJobId}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  enq.status === 'CONVERTED_TO_JOB'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)]'
                }`}>
                  {enq.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CONVERSION MODAL: Customer Matching & Job Type Picker */}
      {conversionModalEnquiry && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center space-x-2">
                <FileCheck2 className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-[var(--cabms-text-primary)]">Convert Web Lead to Work Order</h3>
              </div>
              <button
                onClick={() => setConversionModalEnquiry(null)}
                className="text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)] font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="cabms-card-subtle p-3.5 text-xs space-y-1.5">
              <div className="font-bold text-[var(--cabms-text-primary)] text-sm">{conversionModalEnquiry.customerName}</div>
              <div className="text-[var(--cabms-text-secondary)] flex items-center space-x-3">
                <span>{conversionModalEnquiry.phone}</span>
                <span>•</span>
                <span>{conversionModalEnquiry.email}</span>
              </div>
              <div className="text-[var(--cabms-text-secondary)] pt-1 border-t border-slate-800/80">
                Service: <strong>{conversionModalEnquiry.serviceRequested}</strong>
              </div>
            </div>

            {/* 1. Customer Linkage Selection */}
            <div className="space-y-2 text-xs">
              <label className="text-[var(--cabms-text-secondary)] font-bold block uppercase tracking-wider text-[10px]">
                1. Customer Resolution & MYOB Card Linkage
              </label>

              <div className="space-y-2 cabms-card-subtle p-3">
                {conversionModalEnquiry.matchedExistingCustomerId && (
                  <label className="flex items-start space-x-2 cursor-pointer text-[var(--cabms-text-secondary)]">
                    <input
                      type="radio"
                      name="custMatch"
                      checked={selectedCustMatchMode === 'matched'}
                      onChange={() => setSelectedCustMatchMode('matched')}
                      className="mt-0.5 text-purple-600 focus:ring-0"
                    />
                    <div>
                      <span className="font-bold text-[var(--cabms-text-primary)]">Use Matched Existing Customer</span>
                      <span className="block text-[11px] text-sky-400 font-mono">
                        {customers.find(c => c.id === conversionModalEnquiry.matchedExistingCustomerId)?.name} ({conversionModalEnquiry.matchedExistingCustomerId})
                      </span>
                    </div>
                  </label>
                )}

                <label className="flex items-start space-x-2 cursor-pointer text-[var(--cabms-text-secondary)]">
                  <input
                    type="radio"
                    name="custMatch"
                    checked={selectedCustMatchMode === 'existing_picker'}
                    onChange={() => setSelectedCustMatchMode('existing_picker')}
                    className="mt-0.5 text-purple-600 focus:ring-0"
                  />
                  <div className="flex-1">
                    <span className="font-bold text-[var(--cabms-text-primary)]">Select from Existing Customer Master</span>
                    {selectedCustMatchMode === 'existing_picker' && (
                      <select
                        value={selectedExistingCustId}
                        onChange={e => setSelectedExistingCustId(e.target.value)}
                        className="w-full mt-1.5 cabms-input rounded p-1.5 text-xs text-[var(--cabms-text-primary)]"
                      >
                        {customers.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.myobCustomerId})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>

                <label className="flex items-start space-x-2 cursor-pointer text-[var(--cabms-text-secondary)]">
                  <input
                    type="radio"
                    name="custMatch"
                    checked={selectedCustMatchMode === 'new_write_through'}
                    onChange={() => setSelectedCustMatchMode('new_write_through')}
                    className="mt-0.5 text-purple-600 focus:ring-0"
                  />
                  <div>
                    <span className="font-bold text-[var(--cabms-text-primary)]">Create New MYOB Customer Card</span>
                    <span className="block text-[11px] text-[var(--cabms-text-secondary)]">
                      Write-through new customer entry to MYOB Business master file.
                    </span>
                  </div>
                </label>
              </div>

              {myobConnection.status !== 'CONNECTED' && selectedCustMatchMode === 'new_write_through' && (
                <div className="p-2.5 rounded bg-amber-950/40 border border-amber-800/80 text-amber-300 text-[11px] flex items-start space-x-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                  <span>
                    MYOB Business is currently offline. The new customer will be preserved as an unresolved operational local draft with pending sync status.
                  </span>
                </div>
              )}
            </div>

            {/* 2. Job Type Picker */}
            <div className="space-y-2 text-xs">
              <label className="text-[var(--cabms-text-secondary)] font-bold block uppercase tracking-wider text-[10px]">
                2. Operational Job Type & Compliance Matrix
              </label>

              <select
                value={selectedConversionJobType?.id || ''}
                onChange={e => setSelectedJobTypeId(e.target.value)}
                className="w-full cabms-input rounded-lg p-2 text-[var(--cabms-text-primary)] font-medium cursor-pointer"
              >
                {conversionJobTypes.map(jt => (
                  <option key={jt.id} value={jt.id}>
                    {jt.name} ({jt.version}) {jt.isDirectToInvoice ? '• [Direct-to-Invoice]' : `• [Req: ${jt.formsRequired.join(', ')}]`}
                  </option>
                ))}
              </select>

              {(() => {
                const jt = selectedConversionJobType;
                if (!jt) return <div role="alert" className="text-red-300">No job type is configured for this enquiry business.</div>;
                return (
                  <div className="cabms-card-subtle p-2.5 text-[11px] space-y-1">
                    <div className="text-[var(--cabms-text-secondary)]">
                      Policy Rule: <strong className="text-[var(--cabms-text-primary)]">{jt.isDirectToInvoice ? 'Direct-to-invoice service (no mandatory safety forms)' : 'Multi-form compliance check enforced'}</strong>
                    </div>
                    <div className="text-[var(--cabms-text-secondary)]">
                      Enforced Documents: <span className="font-mono text-sky-400">{jt.formsRequired.length > 0 ? jt.formsRequired.join(' + ') : 'None'}</span>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800 text-xs">
              <button
                type="button"
                onClick={() => setConversionModalEnquiry(null)}
                className="px-4 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] rounded font-semibold transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={() => {
                  let targetCustId: string | undefined = undefined;
                  if (selectedCustMatchMode === 'matched') {
                    targetCustId = conversionModalEnquiry.matchedExistingCustomerId;
                  } else if (selectedCustMatchMode === 'existing_picker') {
                    targetCustId = selectedExistingCustId;
                  } else {
                    targetCustId = undefined; // trigger new customer write-through
                  }

                  if (!selectedConversionJobType) return;
                  const res = convertEnquiryToJob(conversionModalEnquiry.id, targetCustId, selectedConversionJobType.id);
                  setConversionModalEnquiry(null);
                  if (res.jobId) {
                    setSelectedJobId(res.jobId);
                    setActiveTab('jobs');
                  }
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded transition shadow cursor-pointer flex items-center space-x-1.5"
              >
                <span>Confirm Conversion & Open Job</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
