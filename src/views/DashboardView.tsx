/**
 * Area A: Shared Shell & Operational Dashboard
 * Real-time operational overview across the three brands with quick actions and stats
 */

import React from 'react';
import { isInBusinessWeek } from '../utils/businessTime.ts';
import { useCabms } from '../context/CabmsContext.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowRight,
  faBriefcase,
  faBuilding,
  faCalendar,
  faCircleCheck,
  faClock,
  faDatabase,
  faFileLines,
  faInbox,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';
import { JobStatus } from '../types/cabms.ts';

export const DashboardView: React.FC = () => {
  const {
    activeBrand,
    activeBrandId,
    setActiveBrandId,
    brands,
    persona,
    jobs,
    customers,
    websiteEnquiries,
    myobConnection,
    setActiveTab,
    setSelectedJobId,
    demoClock,
  } = useCabms();

  // Technicians only see site details and work assigned to their own account.
  const brandJobs = jobs.filter(j =>
    j.brandId === activeBrandId && (persona !== 'technician' || j.assignedTechId === 'TECH-001')
  );
  const pendingSyncs = customers.filter(c => c.syncStatus !== 'SYNCED').length;
  const pendingEnquiries = websiteEnquiries.filter(e => e.brandId === activeBrandId && e.status === 'PENDING_REVIEW').length;
  const inProgressJobs = brandJobs.filter(j => j.status === 'IN_PROGRESS').length;
  const needsRevisitJobs = brandJobs.filter(j => j.status === 'NEEDS_REVISIT').length;
  const completedJobs = brandJobs.filter(j => j.status === 'COMPLETED' && isInBusinessWeek(j.completedAt, demoClock)).length;
  const isTechnician = persona === 'technician';
  const outstandingJobs = jobs.filter(j =>
    j.status !== 'COMPLETED' &&
    j.status !== 'CANCELLED' &&
    (!isTechnician || j.assignedTechId === 'TECH-001')
  );

  const getStatusBadge = (status: JobStatus) => {
    switch (status) {
      case 'NEW':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-badge-info">New</span>;
      case 'SCHEDULED':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-badge-info">Scheduled</span>;
      case 'IN_PROGRESS':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-badge-warning">In Progress</span>;
      case 'NEEDS_REVISIT':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-badge-danger">Needs Revisit</span>;
      case 'COMPLETED':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-badge-completed">Completed</span>;
      case 'CANCELLED':
        return <span className="px-2.5 py-1 rounded text-xs font-semibold cabms-surface-subtle text-(--cabms-text-secondary) border cabms-border">Cancelled</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="cabms-card p-5">
          <div className="flex items-center justify-between text-(--cabms-text-secondary) text-sm font-medium">
            <span>In-Progress Jobs</span>
            <FontAwesomeIcon icon={faBriefcase} className="w-4 h-4 cabms-accent-warning" />
          </div>
          <div className="text-2xl lg:text-3xl font-black text-(--cabms-text-primary) mt-2">{inProgressJobs}</div>
          <div className="text-xs text-(--cabms-text-secondary) mt-2 flex items-center gap-1.5 leading-normal">
            <span data-testid="weekly-completed" className="cabms-accent-success font-bold">{completedJobs}</span> completed this week (Brisbane)
          </div>
        </div>

        <div className="cabms-card p-5">
          <div className="flex items-center justify-between text-(--cabms-text-secondary) text-sm font-medium">
            <span>Needs Revisit</span>
            <FontAwesomeIcon icon={faTriangleExclamation} className="w-4 h-4 cabms-accent-danger" />
          </div>
          <div className="text-2xl lg:text-3xl font-black cabms-accent-danger mt-2">{needsRevisitJobs}</div>
          <div className="text-xs text-(--cabms-text-secondary) mt-2 leading-normal">
            Cabling defect (TCA2) logged
          </div>
        </div>

        <div className="cabms-card p-5">
          <div className="flex items-center justify-between text-(--cabms-text-secondary) text-sm font-medium">
            <span>MYOB Write-Through</span>
            <FontAwesomeIcon icon={faDatabase} className="w-4 h-4 cabms-accent-info" />
          </div>
          <div className="text-2xl lg:text-3xl font-black cabms-accent-info mt-2">
            {myobConnection.status === 'CONNECTED' ? 'Online' : 'Offline'}
          </div>
          <div className="text-xs text-(--cabms-text-secondary) mt-2 leading-normal">
            {pendingSyncs > 0 ? `${pendingSyncs} draft awaiting sync` : 'All customer records synced'}
          </div>
        </div>

        <div className="cabms-card p-5">
          <div className="flex items-center justify-between text-(--cabms-text-secondary) text-sm font-medium">
            <span>Website Enquiries</span>
            <FontAwesomeIcon icon={faInbox} className="w-4 h-4 cabms-accent-success" />
          </div>
          <div className="text-2xl lg:text-3xl font-black cabms-accent-success mt-2">{pendingEnquiries}</div>
          <div className="text-xs text-(--cabms-text-secondary) mt-2 leading-normal">
            Section J website handoff inbox
          </div>
        </div>
      </div>

      {/* Operational Jobs & Cross-Company Queue */}
      <div className="space-y-6">
          <div className="cabms-card p-6" data-testid="operational-jobs-panel">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-(--cabms-text-primary) uppercase tracking-wider">
                {activeBrand.name} Operational Jobs
              </h2>
              <p className="text-sm text-(--cabms-text-secondary) mt-1">Current work orders and compliance requirements</p>
            </div>
            <button
              onClick={() => setActiveTab('jobs')}
              className="text-sm text-sky-400 hover:text-sky-300 flex items-center gap-1.5 font-semibold cursor-pointer"
            >
              <span>View All</span>
              <FontAwesomeIcon icon={faArrowRight} className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {brandJobs.map(job => (
              <div
                key={job.id}
                onClick={() => {
                  setSelectedJobId(job.id);
                  setActiveTab('jobs');
                }}
                className="cabms-card-subtle hover:bg-(--cabms-surface) transition p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-2">
                  <div className="flex items-center space-x-2.5">
                    <span className="font-mono text-sm font-bold text-(--cabms-text-secondary)">{job.id}</span>
                    <span className="text-(--cabms-text-primary) font-bold text-sm md:text-base">{job.title}</span>
                    {getStatusBadge(job.status)}
                  </div>
                  <div className="text-sm text-(--cabms-text-secondary) leading-relaxed">
                    Site: {job.siteAddress} • Contact: {job.siteContact}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {job.isDirectToInvoice ? (
                      <span className="text-xs cabms-surface-subtle border cabms-border text-(--cabms-text-secondary) px-2.5 py-1 rounded font-mono">
                        Direct-to-Invoice (No Forms)
                      </span>
                    ) : (
                      job.formsRequired.map(f => (
                        <span key={f} className="text-xs bg-amber-950/60 text-amber-300 border border-amber-800/60 px-2 py-1 rounded font-mono">
                          Req: {f}
                        </span>
                      ))
                    )}
                    <span className="text-xs text-(--cabms-text-secondary)">
                      Tech: {job.assignedTechName || 'Unassigned'}
                    </span>
                  </div>
                </div>

                <div className="text-right sm:self-center shrink-0 space-y-1">
                  <div className="text-sm font-semibold text-(--cabms-text-primary)">
                    {job.scheduledDate} {job.scheduledTime}
                  </div>
                  <span className="text-xs font-semibold text-sky-400 hover:underline inline-block">
                    Open Job Details →
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

          {/* Consolidated Cross-Company Outstanding Jobs (Admin/Office/Super Admin only) */}
          {!isTechnician && (
          <div className="cabms-card p-6" data-testid="consolidated-jobs-panel">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-(--cabms-text-primary) uppercase tracking-wider">
                  Cross-Company Outstanding Jobs
                </h2>
                <p className="text-sm text-(--cabms-text-secondary) mt-1">
                  {Object.keys(brands).length >= 3
                    ? 'Consolidated queue across Solarcell, Smart Home, and CCTV'
                    : Object.keys(brands).length > 1
                      ? `Consolidated queue across ${Object.values(brands).map(b => b.name).join(' and ')}`
                      : `Consolidated queue for ${activeBrand.name}`}
                </p>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full font-mono font-semibold bg-sky-950/60 text-sky-300 border border-sky-800/60">
                {outstandingJobs.length} Outstanding
              </span>
            </div>

            <div className="space-y-3">
              {outstandingJobs.length === 0 ? (
                <div className="p-4 text-center text-sm text-(--cabms-text-secondary)">
                  No outstanding jobs at this time.
                </div>
              ) : (
                outstandingJobs.map(job => {
                  const jobBrand = brands[job.brandId];
                  if (!jobBrand) return null;
                  return (
                    <div
                      key={job.id}
                      data-testid={`consolidated-job-${job.id}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (job.brandId !== activeBrandId) {
                          setActiveBrandId(job.brandId);
                        }
                        setSelectedJobId(job.id);
                        setActiveTab('jobs');
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (job.brandId !== activeBrandId) {
                            setActiveBrandId(job.brandId);
                          }
                          setSelectedJobId(job.id);
                          setActiveTab('jobs');
                        }
                      }}
                      className="cabms-card-subtle hover:bg-(--cabms-surface) transition p-3.5 rounded-lg cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-(--cabms-border-base) focus:outline-none focus-visible:ring-2 focus-visible:ring-(--cabms-border-focus)"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-sky-400">{job.id}</span>
                          <span
                            className="text-[11px] font-semibold px-2 py-0.5 rounded font-mono uppercase"
                            style={{ backgroundColor: `${jobBrand.primaryColor}22`, color: jobBrand.accentColor || jobBrand.primaryColor }}
                          >
                            {jobBrand.name}
                          </span>
                          <span className="text-(--cabms-text-primary) font-bold text-sm truncate">{job.title}</span>
                          {getStatusBadge(job.status)}
                        </div>
                        <div className="text-xs text-(--cabms-text-secondary) truncate">
                          {job.siteAddress} • Contact: {job.siteContact} • Tech: {job.assignedTechName || 'Unassigned'}
                        </div>
                      </div>

                      <div className="text-right sm:self-center shrink-0 space-y-0.5">
                        <div className="text-xs font-semibold text-(--cabms-text-primary)">
                          {job.scheduledDate} {job.scheduledTime}
                        </div>
                        <span className="text-xs font-semibold text-sky-400 hover:underline inline-block">
                          Switch & View →
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
          )}
      </div>
    </div>
  );
};
