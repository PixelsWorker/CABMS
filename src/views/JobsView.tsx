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
  const [newSiteAddress, setNewSiteAddress] = useState('[Fictional] 50 Cavill Avenue, Surfers Paradise QLD 4217');
  const [newSiteContact, setNewSiteContact] = useState('John Citizen');
  const [newSitePhone, setNewSitePhone] = useState('0400 000 001');
  const [newDescription, setNewDescription] = useState('');
  const [newAssignedTechId, setNewAssignedTechId] = useState<string | null>('TECH-001');
  const [newIsDirectToInvoice, setNewIsDirectToInvoice] = useState(false);
  const [newForms, setNewForms] = useState<('JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2')[]>(['JSA']);

  // Selected job
  const selectedJob = jobs.find(j => j.id === selectedJobId) || jobs[0];

  // Technician Access Enforcement AFTER hooks (G00-008)
  const isTechnicianRestricted =
    persona === 'technician' &&
    selectedJob &&
    (selectedJob.assignedTechId === null || selectedJob.assignedTechId !== 'TECH-001');

  if (isTechnicianRestricted) {
    return (
      <AccessDeniedView
        resourceName={`Unassigned or External Job Order (${selectedJob?.id || 'JOB'})`}
        requiredRoleDescription="Assigned Field Technician (Dave Miller TECH-001) or Office Staff"
        customExplanation="Technicians can only access jobs directly assigned to them. Direct route access to unassigned pool jobs or other technician's work orders is denied."
      />
    );
  }

  // Filter jobs by active brand & status
  const filteredJobs = jobs.filter(j => {
    // If technician, only show assigned to Dave Miller (TECH-001)
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

  const handleJobTypeChange = (typeId: string) => {
    setSelectedJobTypeId(typeId);
    const jt = jobTypes.find(t => t.id === typeId);
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
    const selectedJt = jobTypes.find(t => t.id === selectedJobTypeId) || jobTypes[0];

    const created = createJob({
      brandId: activeBrandId,
      customerId: matchedCust.id,
      title: newTitle,
      jobType: selectedJt.name,
      jobTypeVersion: selectedJt.version,
      description: newDescription || `${newTitle} for ${matchedCust.name}`,
      status: newAssignedTechId ? 'SCHEDULED' : 'NEW',
      appointmentStatus: 'SCHEDULED',
      scheduledDate: '2026-11-04',
      scheduledTime: '10:00',
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
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-950 text-purple-400 border border-purple-800">NEW / POOL</span>;
      case 'SCHEDULED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-950 text-sky-400 border border-sky-800">SCHEDULED</span>;
      case 'IN_PROGRESS':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-400 border border-amber-800">IN PROGRESS</span>;
      case 'NEEDS_REVISIT':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-orange-950 text-orange-400 border border-orange-800">NEEDS REVISIT</span>;
      case 'COMPLETED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800">COMPLETED</span>;
      case 'CANCELLED':
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950 text-red-400 border border-red-800">CANCELLED</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Briefcase className="w-5 h-5 text-amber-400" />
            <h1 className="text-xl font-bold text-white tracking-tight">
              Operational Work Orders & Compliance Journey
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1">
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
                      <span>Tech: {job.assignedTechName || 'Unassigned (Pool)'}</span>
                      <span className="font-mono">{job.scheduledDate} {job.scheduledTime}</span>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-slate-800/80 flex flex-wrap items-center gap-1.5">
                    {job.isDirectToInvoice ? (
                      <span className="text-[10px] bg-slate-950 text-slate-300 px-1.5 py-0.5 rounded border border-slate-700">
                        Direct-to-Invoice (No Forms)
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
                  <span className="font-mono text-sm font-bold text-amber-400">{selectedJob.id}</span>
                  {getStatusBadge(selectedJob.status)}
                </div>
                <h2 className="text-lg font-bold text-white mt-1">{selectedJob.title}</h2>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                {selectedJob.status === 'CANCELLED' ? (
                  <button
                    onClick={() => reopenCancelledJob(selectedJob.id)}
                    className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-lg transition shadow-sm cursor-pointer flex items-center space-x-1"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen Cancelled Job</span>
                  </button>
                ) : selectedJob.status !== 'COMPLETED' ? (
                  <>
                    <button
                      onClick={handleCompleteAttempt}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 text-xs font-bold rounded-lg transition shadow-sm cursor-pointer flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Complete Work Order</span>
                    </button>

                    {persona !== 'technician' && (
                      <>
                        <button
                          onClick={() => cancelJobAppointment(selectedJob.id, 'Rescheduling requested')}
                          className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition cursor-pointer"
                          title="Cancels appointment visit while keeping work order active"
                        >
                          Cancel Visit
                        </button>
                        <button
                          onClick={() => cancelWholeJob(selectedJob.id, 'Order cancelled by customer')}
                          className="px-2.5 py-1.5 bg-red-950/60 hover:bg-red-900 text-red-300 border border-red-800 text-xs font-medium rounded-lg transition cursor-pointer"
                          title="Cancels entire work order"
                        >
                          Cancel Job
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <div className="flex items-center space-x-1.5 text-emerald-400 text-xs font-bold bg-emerald-950/80 border border-emerald-800 px-3 py-1.5 rounded-lg">
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
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                Work Order Details
              </button>
              <button
                onClick={() => setActiveJobDetailTab('history')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                  activeJobDetailTab === 'history'
                    ? 'bg-amber-600 text-slate-950'
                    : 'bg-slate-950 text-slate-400 hover:text-white'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                <span>Audit Trail ({selectedJob.activityHistory?.length || 0})</span>
              </button>
            </div>

            {activeJobDetailTab === 'history' ? (
              /* Activity & Audit History Trail (G00-018) */
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <History className="w-3.5 h-3.5 text-sky-400" />
                  <span>Activity & Status Change History</span>
                </h3>
                <div className="space-y-2">
                  {selectedJob.activityHistory && selectedJob.activityHistory.length > 0 ? (
                    selectedJob.activityHistory.map((entry: ActivityLogEntry, idx: number) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded bg-slate-900 border border-slate-800 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="font-bold text-white">{entry.action}</span>
                          <span className="font-mono text-slate-500">{entry.timestamp}</span>
                        </div>
                        {entry.notes && <p className="text-slate-300 text-[11px]">{entry.notes}</p>}
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
              <div className="space-y-5">
                {/* Site & Contact Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                    <h3 className="font-bold text-slate-400 uppercase tracking-wider text-[11px]">
                      Site Information (Physical Location)
                    </h3>
                    <div className="flex items-start space-x-2 text-white font-medium">
                      <MapPin className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                      <span>{selectedJob.siteAddress}</span>
                    </div>
                    <div className="pt-2">
                      <a
                        href="https://www.google.com/maps/dir/?api=1&destination=Sydney+Opera+House"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center space-x-1 text-sky-400 hover:text-sky-300 text-[11px] font-semibold"
                      >
                        <span>Navigate via Google Maps (Public Demo)</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  </div>

                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                    <h3 className="font-bold text-slate-400 uppercase tracking-wider text-[11px]">
                      Site Contact Details
                    </h3>
                    <div className="space-y-1 text-white">
                      <div className="font-bold">{selectedJob.siteContact}</div>
                      <div className="flex items-center space-x-1 text-slate-300">
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        <span>{selectedJob.sitePhone}</span>
                      </div>
                    </div>
                    <div className="text-slate-400 text-[11px] pt-1">
                      Technician assigned: <strong className="text-white">{selectedJob.assignedTechName || 'Unassigned (Dispatch Pool)'}</strong>
                    </div>
                  </div>
                </div>

                {/* Scope Description */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-1 text-xs">
                  <span className="font-bold text-slate-400 uppercase text-[11px] block">
                    Job Scope / Work Instructions
                  </span>
                  <p className="text-slate-300 leading-relaxed">{selectedJob.description}</p>
                </div>

                {/* Required Forms Badge Panel */}
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-400 uppercase text-[11px]">
                      Compliance Requirements
                    </span>
                    <button
                      onClick={() => setActiveTab('compliance')}
                      className="text-amber-400 hover:text-amber-300 text-xs font-semibold flex items-center space-x-1 cursor-pointer"
                    >
                      <span>Open Forms Tab</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>

                  {selectedJob.isDirectToInvoice ? (
                    <div className="text-slate-300 text-xs bg-slate-900 p-2.5 rounded border border-slate-800">
                      ✓ <strong>Direct-to-Invoice Service:</strong> This work order does not require statutory compliance certificates. Complete anytime to bill customer.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedJob.formsRequired.map(f => (
                        <div
                          key={f}
                          className="flex items-center space-x-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-xs text-white"
                        >
                          <FileCheck2 className="w-3.5 h-3.5 text-amber-400" />
                          <span>{f} Form</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* MYOB Invoice Panel */}
                <div className="bg-slate-950 rounded-xl p-4 border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                      <span>MYOB Invoice & Billing Status</span>
                    </h3>
                    {selectedJob.invoice ? (
                      <span className="text-xs font-bold text-emerald-400 font-mono">
                        ${selectedJob.invoice.amount.toFixed(2)} AUD
                      </span>
                    ) : (
                      <button
                        onClick={() => prepareInvoiceForJob(selectedJob.id, 1450)}
                        className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[11px] font-bold cursor-pointer"
                      >
                        Prepare MYOB Invoice ($1,450.00)
                      </button>
                    )}
                  </div>

                  {selectedJob.invoice ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">MYOB Invoice Ref:</span>
                        <span className="font-mono text-sky-400 font-bold">{selectedJob.invoice.externalMyobRef}</span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">Status:</span>
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
                  ) : (
                    <div className="text-slate-400 text-xs">
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
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
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
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
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
                <label className="block text-slate-300 font-semibold mb-1">Standard Job Type (Template)</label>
                <select
                  value={selectedJobTypeId}
                  onChange={e => handleJobTypeChange(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white cursor-pointer"
                >
                  {jobTypes.map(jt => (
                    <option key={jt.id} value={jt.id}>
                      {jt.name} ({jt.isDirectToInvoice ? 'Direct to Invoice' : jt.formsRequired.join('+')})
                    </option>
                  ))}
                </select>
              </div>

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
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white cursor-pointer"
                  >
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Assigned Technician</label>
                  <select
                    value={newAssignedTechId || ''}
                    onChange={e => setNewAssignedTechId(e.target.value ? e.target.value : null)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white cursor-pointer"
                  >
                    <option value="">Unassigned (Dispatch Pool)</option>
                    {technicians.map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.role})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Site Address (Physical Location)</label>
                <input
                  type="text"
                  required
                  value={newSiteAddress}
                  onChange={e => setNewSiteAddress(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Site Contact</label>
                  <input
                    type="text"
                    value={newSiteContact}
                    onChange={e => setNewSiteContact(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Site Phone</label>
                  <input
                    type="text"
                    value={newSitePhone}
                    onChange={e => setNewSitePhone(e.target.value)}
                    className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white"
                  />
                </div>
              </div>

              <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-white font-semibold">Job Type Compliance Policy</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    jobTypes.find(t => t.id === selectedJobTypeId)?.isDirectToInvoice
                      ? 'bg-sky-950 text-sky-400 border border-sky-800'
                      : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  }`}>
                    {jobTypes.find(t => t.id === selectedJobTypeId)?.isDirectToInvoice ? 'Direct to Invoice' : 'Compliance Documents Required'}
                  </span>
                </div>

                {jobTypes.find(t => t.id === selectedJobTypeId)?.isDirectToInvoice ? (
                  <p className="text-slate-400 text-[11px]">
                    Direct-to-invoice service: no compliance documentation required for operational completion.
                  </p>
                ) : (
                  <div>
                    <span className="block text-slate-400 font-semibold mb-1">
                      Mandatory Forms (governed by {jobTypes.find(t => t.id === selectedJobTypeId)?.name} {jobTypes.find(t => t.id === selectedJobTypeId)?.version}):
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {jobTypes.find(t => t.id === selectedJobTypeId)?.formsRequired.map(ft => (
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
