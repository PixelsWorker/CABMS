/**
 * Area D & G: Operational Jobs & Completion Action
 * Structured work orders, site details, MYOB invoice panel, and completion validation.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import {
  Briefcase,
  Search,
  CheckCircle2,
  AlertTriangle,
  Clock,
  MapPin,
  Phone,
  FileCheck2,
  FileText,
  DollarSign,
  Plus,
  ArrowRight,
  ExternalLink,
  ShieldAlert,
  Send,
  RotateCcw,
} from 'lucide-react';
import { Job, JobStatus } from '../types/cabms.ts';
import { CompletionValidationResult } from '../utils/cabmsLogic.ts';

export const JobsView: React.FC = () => {
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    activeBrandId,
    brands,
    persona,
    customers,
    createJob,
    updateJobStatus,
    attemptCompleteJob,
    setActiveTab,
    triggerReviewRequest,
    reconcileReviewRequest,
    demoClock,
  } = useCabms();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [validationModalResult, setValidationModalResult] = useState<CompletionValidationResult | null>(null);
  const [isNewJobModalOpen, setIsNewJobModalOpen] = useState(false);

  // New Job Form State
  const [newTitle, setNewTitle] = useState('');
  const [newCustId, setNewCustId] = useState(customers[0]?.id || '');
  const [newJobType, setNewJobType] = useState('Standard Service Call');
  const [newSiteAddress, setNewSiteAddress] = useState('[Fictional] 50 Cavill Avenue, Surfers Paradise QLD 4217');
  const [newSiteContact, setNewSiteContact] = useState('John Citizen');
  const [newSitePhone, setNewSitePhone] = useState('0400 000 001');
  const [newDescription, setNewDescription] = useState('');
  const [newIsDirectToInvoice, setNewIsDirectToInvoice] = useState(false);
  const [newForms, setNewForms] = useState<('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[]>(['JSA']);

  // Selected job
  const selectedJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  // Technician Access Enforcement: If Technician persona is viewing an unassigned job (e.g. JOB-2026-105)
  if (persona === 'technician' && selectedJob && selectedJob.assignedTechId === null) {
    return (
      <AccessDeniedView
        resourceName={`Unassigned Job Order (${selectedJob.id})`}
        requiredRoleDescription="Super Admin, Owner / Admin, or Office Staff"
        customExplanation="Technicians can only access jobs assigned to them. Direct route access to unassigned pool jobs is denied."
      />
    );
  }

  // Filter jobs by active brand & status
  const filteredJobs = jobs.filter(j => {
    // If technician, only show assigned to them
    if (persona === 'technician' && j.assignedTechId !== 'TECH-001') {
      return false;
    }
    const matchesBrand = j.brandId === activeBrandId;
    const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
    const matchesSearch =
      j.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.siteContact.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.siteAddress.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesBrand && matchesStatus && matchesSearch;
  });

  const handleCompleteAttempt = () => {
    if (!selectedJob) return;
    const result = attemptCompleteJob(selectedJob.id);
    setValidationModalResult(result);
  };

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    const created = createJob({
      brandId: activeBrandId,
      customerId: newCustId,
      title: newTitle,
      jobType: newJobType,
      siteAddress: newSiteAddress,
      siteContact: newSiteContact,
      sitePhone: newSitePhone,
      description: newDescription,
      isDirectToInvoice: newIsDirectToInvoice,
      formsRequired: newIsDirectToInvoice ? [] : newForms,
      assignedTechId: 'TECH-001',
      assignedTechName: 'Dave Miller',
    });
    setSelectedJobId(created.id);
    setIsNewJobModalOpen(false);
  };

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'NEW':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-sky-950 text-sky-300 border border-sky-800">New</span>;
      case 'SCHEDULED':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">Scheduled</span>;
      case 'IN_PROGRESS':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-amber-950 text-amber-300 border border-amber-800">In Progress</span>;
      case 'NEEDS_REVISIT':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-red-950 text-red-300 border border-red-800">Needs Revisit</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">Completed</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">Cancelled</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight flex items-center space-x-2">
            <Briefcase className="w-5 h-5 text-amber-400" />
            <span>Jobs & Work Order Management</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Operational lifecycle, technician assignment, compliance gating and MYOB financial status.
          </p>
        </div>

        {persona !== 'technician' && (
          <button
            onClick={() => setIsNewJobModalOpen(true)}
            className="flex items-center space-x-1.5 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-sm cursor-pointer self-start sm:self-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Job</span>
          </button>
        )}
      </div>

      {/* Main Two-Pane Layout: Job List & Job Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Pane: Job Directory / List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          {/* Search and Status Filter */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search jobs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white text-xs font-medium cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="NEEDS_REVISIT">Needs Revisit</option>
                <option value="COMPLETED">Completed</option>
              </select>
            </div>
          </div>

          {/* Job List Items */}
          <div className="space-y-2 max-h-[700px] overflow-y-auto pr-1">
            {filteredJobs.map(job => {
              const isSelected = selectedJob?.id === job.id;
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-3.5 rounded-xl border transition cursor-pointer ${
                    isSelected
                      ? 'bg-slate-800 border-amber-500 shadow-md'
                      : 'bg-slate-900 border-slate-800 hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono text-xs font-bold text-amber-400">{job.id}</span>
                        {getStatusBadge(job.status)}
                      </div>
                      <h3 className="font-bold text-white text-xs md:text-sm mt-1">{job.title}</h3>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 mt-1.5 space-y-0.5">
                    <div>Site: {job.siteAddress}</div>
                    <div className="flex items-center justify-between text-slate-300">
                      <span>Tech: {job.assignedTechName || 'Unassigned'}</span>
                      <span className="font-mono">{job.scheduledDate} {job.scheduledTime}</span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                    {job.isDirectToInvoice ? (
                      <span className="text-[10px] bg-slate-950 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                        Direct-to-Invoice
                      </span>
                    ) : (
                      job.formsRequired.map(f => (
                        <span key={f} className="text-[10px] bg-amber-950/80 text-amber-300 px-1.5 py-0.5 rounded border border-amber-800">
                          {f}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Pane: Selected Job Detail (7 cols) */}
        {selectedJob && (
          <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-6">
            {/* Top Job Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-extrabold text-amber-400">{selectedJob.id}</span>
                  {getStatusBadge(selectedJob.status)}
                  <span className="text-xs text-slate-400">• Brand: {brands[selectedJob.brandId]?.name}</span>
                </div>
                <h2 className="text-base md:text-lg font-bold text-white mt-1">
                  {selectedJob.title}
                </h2>
              </div>

              {/* Complete Job Button (Area G) */}
              <div className="flex items-center space-x-2">
                {selectedJob.status !== 'COMPLETED' ? (
                  <button
                    onClick={handleCompleteAttempt}
                    className="flex items-center space-x-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-md cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Complete Job</span>
                  </button>
                ) : (
                  <div className="flex items-center space-x-1 text-emerald-400 text-xs font-bold bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-lg">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Completed on {selectedJob.completedAt?.slice(0, 10)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Site & Contact Details (Distinct from billing) */}
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                <MapPin className="w-3.5 h-3.5 text-amber-400" />
                <span>Site Details (Distinct from Customer Billing)</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-300">
                <div>
                  <span className="text-slate-500 block text-[11px]">Site Installation Address:</span>
                  <span className="text-white font-medium">{selectedJob.siteAddress}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Site Contact / Occupier:</span>
                  <span className="text-white font-medium">{selectedJob.siteContact} ({selectedJob.sitePhone})</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Technician Assigned:</span>
                  <span className="text-sky-400 font-semibold">{selectedJob.assignedTechName || 'None'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px]">Scheduled Window:</span>
                  <span className="text-white font-medium">{selectedJob.scheduledDate} at {selectedJob.scheduledTime} ({selectedJob.estimatedDurationHours} hrs)</span>
                </div>
              </div>
              <p className="text-xs text-slate-400 pt-2 border-t border-slate-800/80">
                <strong>Description / Scope:</strong> {selectedJob.description}
              </p>
            </div>

            {/* Mandatory Compliance Requirements Breakdown */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <FileCheck2 className="w-3.5 h-3.5 text-sky-400" />
                  <span>Applicable Compliance & Forms</span>
                </h3>
                <button
                  onClick={() => setActiveTab('compliance')}
                  className="text-xs text-sky-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                >
                  <span>Open Mobile Form Editor</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {selectedJob.isDirectToInvoice ? (
                <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs text-slate-300 flex items-center space-x-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <div>
                    <span className="font-bold text-white">Direct-to-Invoice Service Call:</span>{' '}
                    No mandatory compliance documents required for this job type. Completes immediately.
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {selectedJob.formsRequired.map(formType => (
                    <div
                      key={formType}
                      onClick={() => setActiveTab('compliance')}
                      className="p-3 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 flex items-center justify-between cursor-pointer transition"
                    >
                      <div className="flex items-center space-x-2">
                        <FileCheck2 className="w-4 h-4 text-amber-400" />
                        <div>
                          <div className="font-bold text-white">{formType} Certificate</div>
                          <div className="text-[10px] text-slate-400">View / Sign form</div>
                        </div>
                      </div>
                      <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                        View →
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Unresolved Warnings Notice */}
              {selectedJob.unresolvedWarnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-800/60 text-xs text-amber-300 space-y-1">
                  <div className="font-bold flex items-center space-x-1.5 text-amber-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Unresolved Compliance / Source Warning</span>
                  </div>
                  {selectedJob.unresolvedWarnings.map((w, idx) => (
                    <p key={idx} className="text-[11px] leading-relaxed text-amber-200/90">{w}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Separate MYOB Invoice & Payment Panel */}
            {selectedJob.invoice && (
              <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                    <span>MYOB Invoice & Payment Status</span>
                  </h3>
                  <span className="text-xs font-bold text-emerald-400">
                    ${selectedJob.invoice.amount.toFixed(2)} AUD
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">MYOB Invoice Ref:</span>
                    <span className="font-mono text-sky-400 font-bold">{selectedJob.invoice.externalMyobRef}</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Invoice Status:</span>
                    <span className="font-semibold text-white">{selectedJob.invoice.status}</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Issued:</span>
                    <span className="text-slate-300">{selectedJob.invoice.issuedDate}</span>
                  </div>
                  <div className="bg-slate-900 p-2 rounded border border-slate-800">
                    <span className="text-[10px] text-slate-500 block">Due:</span>
                    <span className="text-slate-300">{selectedJob.invoice.dueDate}</span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 flex items-center justify-between pt-1">
                  <span>Operates via simulated MYOB AccountRight API write-through.</span>
                  <span className="font-mono text-slate-500">Invoice ID: {selectedJob.invoice.id}</span>
                </div>
              </div>
            )}

            {/* Review Automation Section (Area I) */}
            <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Google Review Request Automation
                </h3>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  selectedJob.reviewRequest.status === 'SENT'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                    : selectedJob.reviewRequest.status === 'UNCERTAIN'
                    ? 'bg-red-950 text-red-300 border border-red-800'
                    : 'bg-slate-900 text-slate-400 border border-slate-800'
                }`}>
                  Status: {selectedJob.reviewRequest.status}
                </span>
              </div>

              <p className="text-xs text-slate-400">
                Brand-specific preview link for <strong>{brands[selectedJob.brandId]?.name}</strong>:
                <span className="font-mono text-sky-400 block truncate mt-0.5">
                  {brands[selectedJob.brandId]?.reviewUrlPlaceholder}
                </span>
              </p>

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  onClick={() => triggerReviewRequest(selectedJob.id, false)}
                  className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded transition cursor-pointer flex items-center space-x-1"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Send Review Request</span>
                </button>

                <button
                  onClick={() => triggerReviewRequest(selectedJob.id, true)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded transition cursor-pointer"
                  title="Simulate network failure resulting in an uncertain outcome"
                >
                  Simulate Failed Send
                </button>

                {selectedJob.reviewRequest.uncertainReconciliationNeeded && (
                  <button
                    onClick={() => reconcileReviewRequest(selectedJob.id)}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded transition cursor-pointer flex items-center space-x-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reconcile Uncertain Send</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Structured Completion Validation Dialog (Area G) */}
      {validationModalResult && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center space-x-3">
              {validationModalResult.canComplete ? (
                <div className="w-10 h-10 bg-emerald-950 text-emerald-400 rounded-full flex items-center justify-center border border-emerald-800">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              ) : (
                <div className="w-10 h-10 bg-red-950 text-red-400 rounded-full flex items-center justify-center border border-red-800">
                  <ShieldAlert className="w-6 h-6" />
                </div>
              )}

              <div>
                <h3 className="text-base font-bold text-white">
                  {validationModalResult.canComplete
                    ? 'Job Completion Approved (Simulated)'
                    : 'Job Completion Blocked — Requirements Missing'}
                </h3>
                <p className="text-xs text-slate-400">
                  {validationModalResult.canComplete
                    ? 'All synthetic compliance checks satisfied. Operational status updated.'
                    : 'Operational status remains unchanged until all required forms are completed and signed.'}
                </p>
              </div>
            </div>

            {/* Missing Requirements List */}
            {!validationModalResult.canComplete && (
              <div className="bg-red-950/40 border border-red-800/60 rounded-lg p-3 space-y-2 text-xs">
                <span className="font-bold text-red-300 block">Missing Sign-Offs or Documents:</span>
                <ul className="space-y-1 text-red-200">
                  {validationModalResult.missingRequirements.map((req, idx) => (
                    <li key={idx} className="flex items-start space-x-2">
                      <span className="text-red-400 font-bold">•</span>
                      <span>{req}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Warnings List */}
            {validationModalResult.warnings.length > 0 && (
              <div className="bg-amber-950/40 border border-amber-800/60 rounded-lg p-3 space-y-1 text-xs">
                <span className="font-bold text-amber-300 block">Compliance Notices & Disclosures:</span>
                {validationModalResult.warnings.map((warn, idx) => (
                  <p key={idx} className="text-amber-200 text-[11px] leading-relaxed">{warn}</p>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-800">
              {!validationModalResult.canComplete && (
                <button
                  onClick={() => {
                    setValidationModalResult(null);
                    setActiveTab('compliance');
                  }}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer"
                >
                  Go to Compliance Forms →
                </button>
              )}
              <button
                onClick={() => setValidationModalResult(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Job Modal */}
      {isNewJobModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white">Create New Work Order</h3>
              <button
                onClick={() => setIsNewJobModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Job Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 5kW Solar Array Inverter Replacement"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Customer</label>
                  <select
                    value={newCustId}
                    onChange={e => setNewCustId(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500 cursor-pointer"
                  >
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Job Type</label>
                  <input
                    type="text"
                    value={newJobType}
                    onChange={e => setNewJobType(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Site Address (Distinct from Billing)</label>
                <input
                  type="text"
                  required
                  value={newSiteAddress}
                  onChange={e => setNewSiteAddress(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Site Contact</label>
                  <input
                    type="text"
                    value={newSiteContact}
                    onChange={e => setNewSiteContact(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Site Phone</label>
                  <input
                    type="text"
                    value={newSitePhone}
                    onChange={e => setNewSitePhone(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-2">
                <label className="flex items-center space-x-2 text-white font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newIsDirectToInvoice}
                    onChange={e => setNewIsDirectToInvoice(e.target.checked)}
                    className="rounded"
                  />
                  <span>Direct-to-Invoice Service (No Compliance Forms Required)</span>
                </label>

                {!newIsDirectToInvoice && (
                  <div>
                    <span className="block text-slate-400 font-semibold mb-1">Required Compliance Forms:</span>
                    <div className="flex flex-wrap gap-3">
                      {(['JSA', 'ELECTRICAL', 'SMOKE_ALARM', 'TCA1', 'TCA2'] as const).map(ft => (
                        <label key={ft} className="flex items-center space-x-1 text-slate-300">
                          <input
                            type="checkbox"
                            checked={newForms.includes(ft)}
                            onChange={e => {
                              if (e.target.checked) setNewForms([...newForms, ft]);
                              else setNewForms(newForms.filter(f => f !== ft));
                            }}
                          />
                          <span>{ft}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewJobModalOpen(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-slate-950 rounded font-bold transition shadow-sm cursor-pointer"
                >
                  Create Work Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
