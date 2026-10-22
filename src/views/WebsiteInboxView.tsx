/**
 * Area J: Existing-Website Handoff
 * Internal website submission simulation, pending review inbox,
 * duplicate/customer matching, and explicit office conversion to draft work orders.
 */

import React, { useState } from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
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
} from 'lucide-react';
import { BrandId } from '../types/cabms.ts';

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
  } = useCabms();

  const [selectedBrandForSim, setSelectedBrandForSim] = useState<BrandId>(activeBrandId);

  const pendingEnquiries = websiteEnquiries.filter(e => e.status === 'PENDING_REVIEW');
  const processedEnquiries = websiteEnquiries.filter(e => e.status !== 'PENDING_REVIEW');

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <Inbox className="w-5 h-5 text-purple-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Existing-Website Handoff Inbox (Office Review)
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Synthetic incoming web leads. Enquiries remain in pending review until office staff match or convert them into operational work orders.
            </p>
          </div>

          {/* Trigger Simulation Button */}
          <div className="flex items-center space-x-2 bg-slate-950 p-1.5 rounded-lg border border-slate-800">
            <select
              value={selectedBrandForSim}
              onChange={e => setSelectedBrandForSim(e.target.value as BrandId)}
              className="bg-slate-900 text-white text-xs font-semibold px-2 py-1.5 rounded focus:outline-none cursor-pointer"
            >
              {Object.values(brands).map(b => (
                <option key={b.id} value={b.id}>
                  {b.name} Form
                </option>
              ))}
            </select>
            <button
              onClick={() => simulateWebsiteSubmission(selectedBrandForSim)}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded transition shadow-sm cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Simulate Web Submission</span>
            </button>
          </div>
        </div>

        {/* Isolation Boundary Disclosure */}
        <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex items-center space-x-2">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            Strict boundary: No live webhooks, external forms, or website rebuilds. Synthetic entries test the office triage and matching flow.
          </span>
        </div>
      </div>

      {/* Pending Review Queue */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <span>Pending Enquiries Awaiting Office Action</span>
            <span className="bg-purple-950 text-purple-300 border border-purple-800 text-xs px-2 py-0.5 rounded-full font-bold">
              {pendingEnquiries.length} Pending
            </span>
          </h2>
        </div>

        {pendingEnquiries.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
            Inbox is clean. Click &quot;Simulate Web Submission&quot; above to create a synthetic enquiry.
          </div>
        ) : (
          <div className="space-y-4">
            {pendingEnquiries.map(enq => {
              const matchedCust = customers.find(c => c.id === enq.matchedExistingCustomerId);

              return (
                <div
                  key={enq.id}
                  className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 hover:border-slate-700 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-purple-400">{enq.id}</span>
                        <span className="text-white font-bold text-base">{enq.customerName}</span>
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded text-white"
                          style={{ backgroundColor: brands[enq.brandId]?.primaryColor }}
                        >
                          {brands[enq.brandId]?.name}
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          Received: {enq.submissionDate}
                        </span>
                        <span>•</span>
                        <span>Source: <strong className="text-slate-300">{enq.sourceWebsite}</strong></span>
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
                        <div className="bg-slate-950 border border-slate-800 text-slate-400 px-3 py-1 rounded-lg text-xs">
                          New Customer Lead
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Enquiry Body */}
                  <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
                    <div className="font-bold text-white text-sm">
                      Requested Service: {enq.serviceRequested}
                    </div>
                    <p className="text-slate-300 leading-relaxed italic bg-slate-900/50 p-2.5 rounded border border-slate-800/80">
                      &quot;{enq.notes}&quot;
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-slate-400 text-[11px] pt-1">
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
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition cursor-pointer"
                    >
                      Dismiss Lead
                    </button>

                    <button
                      onClick={() => {
                        const { jobId } = convertEnquiryToJob(enq.id);
                        setSelectedJobId(jobId);
                        setActiveTab('jobs');
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
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Processed Enquiries Archive
          </h3>
          <div className="space-y-2 text-xs">
            {processedEnquiries.map(enq => (
              <div
                key={enq.id}
                className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-slate-400"
              >
                <div>
                  <span className="font-mono text-slate-300 font-bold">{enq.id}</span> • {enq.customerName} ({brands[enq.brandId]?.name})
                  {enq.convertedJobId && (
                    <span className="text-emerald-400 ml-2 font-mono">
                      ↳ Converted to Job: {enq.convertedJobId}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  enq.status === 'CONVERTED_TO_JOB'
                    ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                    : 'bg-slate-800 text-slate-400'
                }`}>
                  {enq.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
