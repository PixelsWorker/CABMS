/**
 * Area D & G: Operational Jobs & Completion Action
 * Structured work orders, site details, MYOB invoice panel,
 * technician assignment & job-type selector (G00-013),
 * separate appointment vs whole-job cancellation & reopen action (G00-014),
 * direct-to-invoice immediate completion (G00-015),
 * and activity history audit trail (G00-018).
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
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
  XCircle,
  History,
  User,
} from 'lucide-react';
import { Job, JobStatus, ActivityLogEntry } from '../types/cabms.ts';
import { CompletionValidationResult } from '../utils/cabmsLogic.ts';

export const JobsView: React.FC = () => {
  // Hooks called unconditionally at top (G00-008)
  const {
    jobs,
    selectedJobId,
    setSelectedJobId,
    activeBrandId,
    brands,
    persona,
    customers,
    jobTypes,
    technicians,
    createJob,
    updateJobStatus,
    attemptCompleteJob,
    cancelJobAppointment,
    cancelWholeJob,
    reopenCancelledJob,
    prepareInvoiceForJob,
    setActiveTab,
    triggerReviewRequest,
    reconcileReviewRequest,
    demoClock,
  } = useCabms();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [validationModalResult, setValidationModalResult] = useState<CompletionValidationResult | null>(null);
  const [isNewJobModalOpen, setIsNewJobModalOpen] = useState(false);
  const [activeJobDetailTab, setActiveJobDetailTab] = useState<'details' | 'history'>('details');

  // New Job Form State
  const [newTitle, setNewTitle] = useState('');
  const [newCustId, setNewCustId] = useState(customers[0]?.id || '');
  const [selectedJobTypeId, setSelectedJobTypeId] = useState<string>(jobTypes[0]?.id || '');
  const brandJobTypes = jobTypes.filter(jobType => jobType.brandId === activeBrandId);
  const selectedJobType = brandJobTypes.find(jobType => jobType.id === selectedJobTypeId) || brandJobTypes[0];
  const [newSiteAddress, setNewSiteAddress] = useState('[Fictional] 50 Cavill Avenue, Surfers Paradise QLD 4217');
  const [newSiteContact, setNewSiteContact] = useState('John Citizen');
  const [newSitePhone, setNewSitePhone] = useState('0400 000 001');
  const [newDescription, setNewDescription] = useState('');
  const [newAssignedTechId, setNewAssignedTechId] = useState<string | null>('TECH-001');
  const [newIsDirectToInvoice, setNewIsDirectToInvoice] = useState(false);
  const [newForms, setNewForms] = useState<('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[]>(['JSA']);

  // Resolve selection only inside the active business/persona boundary. A stale id
  // after a brand or persona switch must never select an out-of-scope record.
  const authorizedJobs = jobs.filter(j =>
    j.brandId === activeBrandId && (persona !== 'technician' || j.assignedTechId === 'TECH-001')
  );
  const selectedJob = authorizedJobs.find(j => j.id === selectedJobId) || authorizedJobs[0];

  // Filter jobs by active brand & status
  const filteredJobs = authorizedJobs.filter(j => {
    const matchesStatus = statusFilter === 'all' || j.status === statusFilter;
    const matchesSearch =
      j.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.siteContact.toLowerCase().includes(searchQuery.toLowerCase()) ||
      j.siteAddress.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const handleCompleteAttempt = () => {
    if (!selectedJob) return;
    const result = attemptCompleteJob(selectedJob.id);
    setValidationModalResult(result);
  };

  const handleJobTypeChange = (typeId: string) => {
    setSelectedJobTypeId(typeId);
    const jt = brandJobTypes.find(t => t.id === typeId);
    if (jt) {
      setNewIsDirectToInvoice(jt.isDirectToInvoice);
      setNewForms(jt.formsRequired);
      if (!newTitle) {
        setNewTitle(jt.name);
      }
    }
  };

  const handleCreateJob = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) return;

    const matchedCust = customers.find(c => c.id === newCustId) || customers[0];
    const tech = technicians.find(t => t.id === newAssignedTechId);
    const selectedJt = selectedJobType;
    if (!selectedJt) return;

    const created = createJob({
      brandId: activeBrandId,
      customerId: matchedCust.id,
      title: newTitle,
      jobType: selectedJt.id,
      jobTypeVersion: selectedJt.version,
      description: newDescription || `${newTitle} for ${matchedCust.name}`,
      assignedTechId: newAssignedTechId,
      assignedTechName: tech ? tech.name : null,
      siteAddress: newSiteAddress,
      siteContact: newSiteContact,
      sitePhone: newSitePhone,
      isDirectToInvoice: selectedJt.isDirectToInvoice,
      formsRequired: selectedJt.formsRequired,
      unresolvedWarnings: [],
    });

    setIsNewJobModalOpen(false);
    setSelectedJobId(created.id);
  };

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'NEW':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-info">NEW / POOL</span>;
      case 'SCHEDULED':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-info">SCHEDULED</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-warning">IN PROGRESS</span>;
      case 'NEEDS_REVISIT':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-danger">NEEDS REVISIT</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-completed">COMPLETED</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-badge-danger">CANCELLED</span>;
      default:
        return <span className="px-2.5 py-1 rounded text-xs font-bold cabms-surface-subtle text-[var(--cabms-text-secondary)] border cabms-border">{status}</span>;
    }
  };

  if (!selectedJob) {
    return (
      <div role="status" className="cabms-card p-6 text-sm text-[var(--cabms-text-secondary)]">
        No work orders are available for this business and your current access.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="cabms-card p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Briefcase className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-[var(--cabms-text-primary)] tracking-tight">
              Operational Work Orders & Compliance Journey
            </h1>
          </div>
          <p className="text-xs text-[var(--cabms-text-secondary)] mt-1">
            Dispatch, technician execution, structured form validation, and direct-to-invoice completion.
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
          <div className="cabms-card p-3 space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 text-[var(--cabms-text-secondary)] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search jobs..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 cabms-card-subtle text-xs text-[var(--cabms-text-primary)] placeholder-slate-500 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div className="flex items-center justify-between text-xs text-[var(--cabms-text-secondary)]">
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="cabms-card-subtle rounded px-2 py-1 text-[var(--cabms-text-primary)] text-xs font-medium cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="NEW">New (Unassigned Pool)</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="IN_PROGRESS">In Progress</option>
                <option value="NEEDS_REVISIT">Needs Revisit</option>
                <option value="COMPLETED">Completed</option>
                <option value="CANCELLED">Cancelled</option>
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
                  className={`cabms-card p-4 transition cursor-pointer ${
                    isSelected
                      ? 'border-amber-500 shadow-md ring-1 ring-amber-500/50'
                      : 'hover:border-[var(--cabms-border-focus)]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-sm font-bold text-amber-400">{job.id}</span>
                        {getStatusBadge(job.status)}
                      </div>
                      <h3 className="font-bold text-[var(--cabms-text-primary)] text-sm md:text-base mt-1.5">{job.title}</h3>
                    </div>
                  </div>

                  <div className="text-xs md:text-sm text-[var(--cabms-text-secondary)] mt-2 space-y-1.5 leading-relaxed">
                    <div>Site: {job.siteAddress}</div>
                    <div className="flex items-center justify-between text-[var(--cabms-text-secondary)]">
                      <span>Tech: {job.assignedTechName || 'Unassigned (Pool)'}</span>
                      <span className="font-mono text-[var(--cabms-text-secondary)]">
                        {job.scheduledDate ? `${job.scheduledDate} ${job.scheduledTime || ''}` : 'Unscheduled'}
                      </span>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
                    {job.appointmentStatus && job.appointmentStatus !== 'SCHEDULED' && (
                      <span className="text-xs cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] px-2 py-0.5 rounded font-mono">
                        {job.appointmentStatus}
                      </span>
                    )}
                    {job.isDirectToInvoice ? (
                      <span className="text-xs cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] px-2 py-0.5 rounded">
                        Direct-to-Invoice (No Forms)
                      </span>
                    ) : (
                      job.formsRequired.map(f => (
                        <span key={f} className="text-xs bg-amber-950/80 text-amber-300 px-2 py-0.5 rounded border border-amber-800">
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
          <div className="lg:col-span-7 cabms-card p-6 space-y-6">
            {/* Top Job Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-3">
              <div>
                <div className="flex items-center space-x-2.5">
                  <span className="font-mono text-base font-bold text-amber-400">{selectedJob.id}</span>
                  {getStatusBadge(selectedJob.status)}
                  {selectedJob.appointmentStatus && (
                    <span className={`px-2.5 py-1 rounded text-xs font-bold border ${
                      selectedJob.appointmentStatus === 'SCHEDULED'
                        ? 'bg-sky-950 text-sky-400 border-sky-800'
                        : selectedJob.appointmentStatus === 'RESCHEDULED'
                        ? 'bg-amber-950 text-amber-400 border-amber-800'
                        : selectedJob.appointmentStatus === 'UNSCHEDULED'
                        ? 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)]'
                        : 'bg-red-950 text-red-400 border-red-800'
                    }`}>
                      {selectedJob.appointmentStatus}
                    </span>
                  )}
                </div>
                <h2 className="text-xl md:text-2xl font-bold text-[var(--cabms-text-primary)] mt-1.5">{selectedJob.title}</h2>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2.5">
                {selectedJob.status === 'CANCELLED' ? (
                  <button
                    onClick={() => reopenCancelledJob(selectedJob.id)}
                    className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-sm font-bold rounded-lg transition shadow-sm cursor-pointer flex items-center space-x-1.5"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>Reopen Cancelled Job</span>
                  </button>
                ) : selectedJob.status !== 'COMPLETED' ? (
                  <>
                    <button
                      onClick={handleCompleteAttempt}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-sm font-bold rounded-lg transition shadow-sm cursor-pointer flex items-center space-x-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Complete Work Order</span>
                    </button>

                    {persona !== 'technician' && (
                      <>
                        <button
                          onClick={() => cancelJobAppointment(selectedJob.id, 'Rescheduling requested')}
                          className="px-3.5 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] text-sm font-medium rounded-lg transition cursor-pointer"
                          title="Cancels appointment visit while keeping work order active"
                        >
                          Cancel Visit
                        </button>
                        <button
                          onClick={() => cancelWholeJob(selectedJob.id, 'Order cancelled by customer')}
                          className="px-3.5 py-2 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800 text-sm font-medium rounded-lg transition cursor-pointer"
                          title="Cancels entire work order"
                        >
                          Cancel Job
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex items-center space-x-2 text-emerald-400 text-sm font-bold bg-emerald-950/80 border border-emerald-800 px-3.5 py-2 rounded-lg">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Work Order Completed</span>
                  </div>
                )}
              </div>
            </div>

            {/* Tab Selector: Details vs Audit History (G00-018) */}
            <div className="flex space-x-2 border-b border-slate-800 pb-2">
              <button
                onClick={() => setActiveJobDetailTab('details')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                  activeJobDetailTab === 'details'
                    ? 'bg-amber-600 text-slate-950'
                    : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
                }`}
              >
                Work Order Details
              </button>
              <button
                onClick={() => setActiveJobDetailTab('history')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                  activeJobDetailTab === 'history'
                    ? 'bg-amber-600 text-slate-950'
                    : 'cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)]'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Audit Trail ({selectedJob.activityHistory?.length || 0})</span>
              </button>
            </div>

            {activeJobDetailTab === 'history' ? (
              /* Activity & Audit History Trail (G00-018) */
              <div className="cabms-card-subtle p-4 space-y-3">
                <h3 className="text-xs font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider flex items-center space-x-1.5">
                  <History className="w-3.5 h-3.5 text-sky-400" />
                  <span>Activity & Status Change History</span>
                </h3>
                <div className="space-y-2">
                  {selectedJob.activityHistory && selectedJob.activityHistory.length > 0 ? (
                    selectedJob.activityHistory.map((entry: ActivityLogEntry, idx: number) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded cabms-card text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-[var(--cabms-text-primary)]">{entry.action}</span>
                          <span className="font-mono text-slate-500">{entry.timestamp}</span>
                        </div>
                        {entry.notes && <p className="text-[var(--cabms-text-secondary)] text-[11px]">{entry.notes}</p>}
                        <div className="text-[10px] text-slate-500">By: {entry.actor}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-slate-500 text-xs py-4 text-center">
                      No prior activity entries recorded.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Work Order Details Tab */
              <div className="space-y-6">
                {/* Site & Contact Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <div className="cabms-card-subtle p-5 space-y-3">
                    <h3 className="font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider text-xs">
                      Site Information (Physical Location)
                    </h3>
                    <div className="flex items-start space-x-2.5 text-[var(--cabms-text-primary)] font-medium text-sm md:text-base leading-relaxed">
                      <MapPin className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                      <span>{selectedJob.siteAddress}</span>
                    </div>
                    <div className="pt-2">
                      <a
                        href="https://www.google.com/maps/dir/?api=1&destination=Sydney+Opera+House"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1.5 text-sky-400 hover:text-sky-300 text-xs md:text-sm font-semibold"
                      >
                        <span>Navigate via Google Maps (Public Demo)</span>
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  <div className="cabms-card-subtle p-5 space-y-3">
                    <h3 className="font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider text-xs">
                      Site Contact Details
                    </h3>
                    <div className="space-y-1.5 text-[var(--cabms-text-primary)]">
                      <div className="font-bold text-base">{selectedJob.siteContact}</div>
                      <div className="flex items-center space-x-2 text-[var(--cabms-text-secondary)] text-sm">
                        <Phone className="w-4 h-4 text-slate-500" />
                        <span>{selectedJob.sitePhone}</span>
                      </div>
                    </div>
                    <div className="text-[var(--cabms-text-secondary)] text-xs md:text-sm pt-2 leading-relaxed">
                      Technician assigned: <strong className="text-[var(--cabms-text-primary)]">{selectedJob.assignedTechName || 'Unassigned (Dispatch Pool)'}</strong>
                    </div>
                  </div>
                </div>

                {/* Scope Description */}
                <div className="cabms-card-subtle p-5 space-y-2">
                  <span className="font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider text-xs block">
                    Job Scope / Work Instructions
                  </span>
                  <p className="text-[var(--cabms-text-primary)] text-sm leading-relaxed">{selectedJob.description}</p>
                </div>

                {/* Required Forms Badge Panel */}
                <div className="cabms-card-subtle p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[var(--cabms-text-secondary)] uppercase tracking-wider text-xs">
                      Compliance Requirements
                    </span>
                    <button
                      onClick={() => setActiveTab('compliance')}
                      className="text-amber-400 hover:text-amber-300 text-sm font-semibold flex items-center space-x-1 cursor-pointer"
                    >
                      <span>Open Forms Tab</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>

                  {selectedJob.isDirectToInvoice ? (
                    <div className="text-[var(--cabms-text-secondary)] text-sm cabms-card-subtle p-3 leading-relaxed">
                      ✓ <strong>Direct-to-Invoice Service:</strong> This work order does not require statutory compliance certificates. Complete anytime to bill customer.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2.5 pt-1">
                      {selectedJob.formsRequired.map(f => (
                        <div
                          key={f}
                          className="flex items-center space-x-2 px-3 py-1.5 rounded-lg cabms-card text-sm text-[var(--cabms-text-primary)]"
                        >
                          <FileCheck2 className="w-4 h-4 text-amber-400" />
                          <span>{f} Form</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* MYOB Invoice Panel */}
                <div className="cabms-card-subtle p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-[var(--cabms-text-primary)] uppercase tracking-wider flex items-center space-x-2">
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                      <span>MYOB Invoice & Billing Status</span>
                    </h3>
                    {selectedJob.invoice ? (
                      <span className="text-sm md:text-base font-bold text-emerald-400 font-mono">
                        ${selectedJob.invoice.amount.toFixed(2)} AUD
                      </span>
                    ) : (
                      <button
                        onClick={() => prepareInvoiceForJob(selectedJob.id, 1450)}
                        className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Prepare MYOB Invoice ($1,450.00)
                      </button>
                    )}
                  </div>

                  {selectedJob.invoice ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="cabms-card-subtle p-3 space-y-1">
                        <span className="text-xs text-[var(--cabms-text-secondary)] block font-medium">MYOB Invoice Ref:</span>
                        <span className="font-mono text-sky-400 font-bold text-sm">{selectedJob.invoice.externalMyobRef}</span>
                      </div>
                      <div className="cabms-card-subtle p-3 space-y-1">
                        <span className="text-xs text-[var(--cabms-text-secondary)] block font-medium">Status:</span>
                        <span className="font-semibold text-[var(--cabms-text-primary)] text-sm">{selectedJob.invoice.status}</span>
                      </div>
                      <div className="cabms-card-subtle p-3 space-y-1">
                        <span className="text-xs text-[var(--cabms-text-secondary)] block font-medium">Issued:</span>
                        <span className="text-[var(--cabms-text-primary)] text-sm font-mono">{selectedJob.invoice.issuedDate}</span>
                      </div>
                      <div className="cabms-card-subtle p-3 space-y-1">
                        <span className="text-xs text-[var(--cabms-text-secondary)] block font-medium">Due:</span>
                        <span className="text-[var(--cabms-text-primary)] text-sm font-mono">{selectedJob.invoice.dueDate}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[var(--cabms-text-secondary)] text-sm leading-relaxed">
                      No invoice prepared yet. Completed jobs can be invoiced directly to the shared MYOB file.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Structured Completion Validation Dialog (Area G) */}
      {validationModalResult && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4">
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
                <h3 className="text-base font-bold text-[var(--cabms-text-primary)]">
                  {validationModalResult.canComplete
                    ? 'Job Completion Approved (Simulated)'
                    : 'Job Completion Blocked — Requirements Missing'}
                </h3>
                <p className="text-xs text-[var(--cabms-text-secondary)]">
                  {validationModalResult.canComplete
                    ? 'All compliance rules satisfied. Status updated to COMPLETED.'
                    : 'Status remains unchanged until all required forms are executed and signed.'}
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
                className="px-4 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-primary)] text-xs font-semibold rounded-lg transition cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Job Modal with Job Type & Tech Selection (G00-013) */}
      {isNewJobModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="cabms-card max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-[var(--cabms-text-primary)]">Create New Work Order</h3>
              <button
                onClick={() => setIsNewJobModalOpen(false)}
                className="text-[var(--cabms-text-secondary)] hover:text-[var(--cabms-text-primary)] text-lg font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateJob} className="space-y-3 text-xs">
              <div>
                <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Standard Job Type (Template)</label>
                <select
                  value={selectedJobType?.id || ''}
                  onChange={e => handleJobTypeChange(e.target.value)}
                  className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)] cursor-pointer"
                >
                  {brandJobTypes.map(jt => (
                    <option key={jt.id} value={jt.id}>
                      {jt.name} ({jt.isDirectToInvoice ? 'Direct to Invoice' : jt.formsRequired.join('+')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Job Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 5kW Solar Array Inverter Replacement"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)] focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Customer</label>
                  <select
                    value={newCustId}
                    onChange={e => setNewCustId(e.target.value)}
                    className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)] cursor-pointer"
                  >
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Assigned Technician</label>
                  <select
                    value={newAssignedTechId || ''}
                    onChange={e => setNewAssignedTechId(e.target.value ? e.target.value : null)}
                    className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)] cursor-pointer"
                  >
                    <option value="">Unassigned (Dispatch Pool)</option>
                    {technicians.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Site Address (Physical Location)</label>
                <input
                  type="text"
                  required
                  value={newSiteAddress}
                  onChange={e => setNewSiteAddress(e.target.value)}
                  className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)]"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Site Contact</label>
                  <input
                    type="text"
                    value={newSiteContact}
                    onChange={e => setNewSiteContact(e.target.value)}
                    className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">Site Phone</label>
                  <input
                    type="text"
                    value={newSitePhone}
                    onChange={e => setNewSitePhone(e.target.value)}
                    className="w-full p-2 cabms-input rounded text-[var(--cabms-text-primary)]"
                  />
                </div>
              </div>

              <div className="cabms-card-subtle p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--cabms-text-primary)] font-semibold">Job Type Compliance Policy</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    selectedJobType?.isDirectToInvoice
                      ? 'cabms-badge-info'
                      : 'cabms-badge-completed'
                  }`}>
                    {selectedJobType?.isDirectToInvoice ? 'Direct to Invoice' : 'Compliance Documents Required'}
                  </span>
                </div>

                {selectedJobType?.isDirectToInvoice ? (
                  <p className="text-[var(--cabms-text-secondary)] text-[11px]">
                    Direct-to-invoice service: no compliance documentation required for operational completion.
                  </p>
                ) : (
                  <div>
                    <span className="block text-[var(--cabms-text-secondary)] font-semibold mb-1">
                      Mandatory Forms (governed by {selectedJobType?.name} {selectedJobType?.version}):
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {selectedJobType?.formsRequired.map(ft => (
                        <span key={ft} className="px-2 py-0.5 bg-slate-900 border border-slate-700 rounded text-sky-300 font-mono text-[11px] font-bold">
                          {ft}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewJobModalOpen(false)}
                  className="px-4 py-2 cabms-surface-subtle border cabms-border text-[var(--cabms-text-secondary)] rounded font-semibold transition cursor-pointer"
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
