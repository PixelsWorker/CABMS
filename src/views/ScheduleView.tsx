/**
 * Area E: Scheduling and Maps
 * Day/Agenda calendar view, multi-calendar sync, rescheduling/cancellation with
 * reminder suppression, demo clock advance (G00-020), and safe public Google Maps navigation (G00-023).
 */

import React, { useState } from 'react';
import { formatBusinessTime } from '../utils/businessTime.ts';
import { useCabms } from '../context/CabmsContext.tsx';
import {
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  ExternalLink,
  RotateCcw,
  XCircle,
  AlertTriangle,
  CheckCircle2,
  Bell,
  User,
  Building2,
  CalendarDays,
  FastForward,
} from 'lucide-react';
import { Job } from '../types/cabms.ts';

export const ScheduleView: React.FC = () => {
  const {
    jobs,
    activeBrandId,
    brands,
    persona,
    demoClock,
    advanceClock,
    rescheduleJobAppointment,
    cancelJobAppointment,
    setSelectedJobId,
    setActiveTab,
  } = useCabms();

  const [selectedDay, setSelectedDay] = useState<string>('2026-11-02');
  const [rescheduleTarget, setRescheduleTarget] = useState<Job | null>(null);
  const [newDate, setNewDate] = useState('2026-11-03');
  const [newTime, setNewTime] = useState('14:00');
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null);
  const [cancelReason, setCancelReason] = useState('Customer requested later date');

  // Filter jobs by selected date and persona restrictions
  const scheduledJobs = jobs.filter(j => {
    if (persona === 'technician' && j.assignedTechId !== 'TECH-001') {
      return false;
    }
    return j.scheduledDate === selectedDay && j.appointmentStatus !== 'UNSCHEDULED';
  });

  const unscheduledJobs = jobs.filter(j => {
    if (persona === 'technician' && j.assignedTechId !== 'TECH-001') {
      return false;
    }
    return j.appointmentStatus === 'UNSCHEDULED' || !j.scheduledDate;
  });

  const handleRescheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget) return;
    rescheduleJobAppointment(rescheduleTarget.id, newDate, newTime);
    setRescheduleTarget(null);
  };

  const handleCancelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    cancelJobAppointment(cancelTarget.id, cancelReason);
    setCancelTarget(null);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <CalendarIcon className="w-5 h-5 text-indigo-400" />
              <h1 className="text-xl font-bold text-white tracking-tight">
                Field Service Dispatch & Calendar Scheduling
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Primary and fleet calendar synchronization with automated email confirmations and reminder suppression.
            </p>
          </div>

          {/* Demo Clock Advance Control (G00-020) */}
          <div className="flex flex-wrap items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs">
            <div className="flex items-center space-x-1.5 text-slate-400">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-mono text-white font-bold">{formatBusinessTime(demoClock)}</span>
            </div>
            <div className="flex items-center space-x-1 pl-2 border-l border-slate-800">
              <button
                onClick={() => advanceClock(1)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold transition cursor-pointer"
                title="Advance clock by 1 hour"
              >
                +1h
              </button>
              <button
                onClick={() => advanceClock(2)}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-semibold transition cursor-pointer"
                title="Advance clock by 2 hours (triggers 2hr reminders)"
              >
                +2h
              </button>
              <button
                onClick={() => advanceClock(24)}
                className="px-2 py-1 bg-sky-900/60 hover:bg-sky-800 text-sky-200 border border-sky-700 rounded text-[11px] font-semibold transition cursor-pointer"
                title="Advance clock by 24 hours"
              >
                +24h
              </button>
            </div>
          </div>
        </div>

        {/* Date Selector Pills */}
        <div className="mt-4 pt-4 border-t border-slate-800 flex items-center justify-between flex-wrap gap-2 text-xs">
          <div className="flex items-center space-x-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
            {['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'].map(dateStr => (
              <button
                key={dateStr}
                onClick={() => setSelectedDay(dateStr)}
                className={`px-3 py-1.5 font-semibold rounded-md transition cursor-pointer ${
                  selectedDay === dateStr
                    ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {new Date(dateStr).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
          <span className="text-slate-400 text-xs">
            Viewing appointments for: <strong className="text-white font-mono">{selectedDay}</strong>
          </span>
        </div>

        {/* Calendar Mappings Status & Simulated Error Recovery */}
        <div className="mt-4 pt-4 border-t border-slate-800 space-y-3 text-xs">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Primary Master Calendar</span>
              <span className="text-white font-semibold">CABMS Operations Hub</span>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" /> Synced (Simulated)
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Calendar Map #1</span>
              <span className="text-amber-400 font-semibold">{brands.solarcell?.calendarMappingName}</span>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" /> Synced
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Calendar Map #2</span>
              <span className="text-sky-400 font-semibold">{brands.smart_home?.calendarMappingName || brands.smarthome?.calendarMappingName}</span>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" /> Synced
              </div>
            </div>

            <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
              <span className="text-[10px] text-slate-500 uppercase font-bold block">Calendar Map #3</span>
              <span className="text-emerald-400 font-semibold">{brands.cctv?.calendarMappingName}</span>
              <div className="text-[10px] text-emerald-400 flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" /> Synced
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Dispatch Agenda View */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
            <CalendarDays className="w-4 h-4 text-amber-400" />
            <span>
              Agenda for {new Date(selectedDay).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
          </h2>
          <span className="text-xs text-slate-400">
            {scheduledJobs.length} work order(s) scheduled
          </span>
        </div>

        {scheduledJobs.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-8 text-center text-slate-400 text-xs">
            No technician appointments scheduled for this day. Switch dates above or advance the demo clock.
          </div>
        ) : (
          <div className="space-y-4">
            {scheduledJobs.map(job => (
              <div
                key={job.id}
                className={`bg-slate-900 border rounded-xl p-5 space-y-4 hover:border-slate-700 transition ${
                  job.appointmentStatus === 'CANCELLED'
                    ? 'border-red-900/60 bg-red-950/10'
                    : 'border-slate-800'
                }`}
              >
                {/* Cancelled Appointment Alert Banner */}
                {job.appointmentStatus === 'CANCELLED' && (
                  <div className="bg-red-950/40 border border-red-800/80 rounded-lg p-3 text-xs text-red-200 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <XCircle className="w-4 h-4 text-red-400 shrink-0" />
                      <span>
                        <strong>Visit Cancelled</strong> — Customer reminders have been suppressed. Work order remains open for rescheduling.
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setRescheduleTarget(job);
                        setNewDate(job.scheduledDate || '2026-11-03');
                        setNewTime(job.scheduledTime || '09:00');
                      }}
                      className="px-2.5 py-1 bg-red-900 hover:bg-red-800 text-white font-bold text-[11px] rounded transition cursor-pointer"
                    >
                      Reschedule Now
                    </button>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-start space-x-3">
                    <div className="bg-slate-950 border border-slate-800 p-2.5 rounded-lg text-center shrink-0">
                      <Clock className="w-4 h-4 text-amber-400 mx-auto" />
                      <span className="font-mono text-xs font-bold text-white block mt-1">
                        {job.scheduledTime}
                      </span>
                      <span className="text-[10px] text-slate-500">{job.estimatedDurationHours}h duration</span>
                    </div>

                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono text-xs font-bold text-amber-400">{job.id}</span>
                        <span className="text-white font-bold text-sm md:text-base">{job.title}</span>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded text-white"
                          style={{ backgroundColor: brands[job.brandId]?.primaryColor }}
                        >
                          {brands[job.brandId]?.name}
                        </span>
                        {job.appointmentStatus && job.appointmentStatus !== 'SCHEDULED' && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              job.appointmentStatus === 'CANCELLED'
                                ? 'bg-red-950 text-red-400 border border-red-800'
                                : 'bg-sky-950 text-sky-400 border border-sky-800'
                            }`}
                          >
                            {job.appointmentStatus}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 flex flex-wrap items-center gap-3">
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          {job.siteContact} ({job.sitePhone})
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-sky-400">
                          Tech: {job.assignedTechName || 'Unassigned'}
                        </span>
                        <span>•</span>
                        <span className="font-mono text-[11px] text-slate-500">
                          Calendar: {job.calendarMapping || 'Fleet Calendar'} ({job.calendarSyncStatus || 'SYNCED'})
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions: Reschedule, Cancel, Open Job */}
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
                    <button
                      onClick={() => {
                        setRescheduleTarget(job);
                        setNewDate(job.scheduledDate || '2026-11-03');
                        setNewTime(job.scheduledTime || '09:00');
                      }}
                      className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center space-x-1"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                      <span>{job.appointmentStatus === 'CANCELLED' ? 'Re-book Visit' : 'Reschedule'}</span>
                    </button>

                    {job.appointmentStatus !== 'CANCELLED' && (
                      <button
                        onClick={() => setCancelTarget(job)}
                        className="px-2.5 py-1.5 bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/60 text-xs font-semibold rounded-lg transition cursor-pointer flex items-center space-x-1"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Cancel Visit</span>
                      </button>
                    )}

                    <button
                      onClick={() => {
                        setSelectedJobId(job.id);
                        setActiveTab('jobs');
                      }}
                      className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-slate-950 text-xs font-bold rounded-lg transition cursor-pointer"
                    >
                      View Job Details
                    </button>
                  </div>
                </div>

                {/* Site Address & Safe Google Maps Demonstration Link (G00-023) */}
                <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="flex items-center space-x-2 text-slate-300">
                    <MapPin className="w-4 h-4 text-red-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 text-[11px] block">Job Installation Site:</span>
                      <span className="text-white font-medium">{job.siteAddress}</span>
                    </div>
                  </div>

                  {/* Safe Public Demo Destination Link: Sydney Opera House strictly per specification */}
                  <a
                    href="https://www.google.com/maps/dir/?api=1&destination=Sydney+Opera+House"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg font-semibold text-xs transition cursor-pointer self-start sm:self-center"
                    title="Opens safe public Google Maps navigation example"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in Google Maps (Public Demo Destination)</span>
                  </a>
                </div>

                {/* Scheduled Reminders & Suppression Log (G00-019, G00-041) */}
                {job.reminders.length > 0 && (
                  <div className="pt-2 border-t border-slate-800/80 text-xs space-y-1.5">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1">
                      <Bell className="w-3 h-3 text-amber-400" />
                      <span>Automated Email Reminders & Suppression History</span>
                    </span>
                    <div className="space-y-1">
                      {job.reminders.map(rem => (
                        <div
                          key={rem.id}
                          className={`p-2 rounded flex items-center justify-between text-[11px] font-mono ${
                            rem.suppressed
                              ? 'bg-red-950/30 text-red-300 border border-red-900/40 line-through'
                              : rem.delivered
                              ? 'bg-emerald-950/30 text-emerald-300 border border-emerald-900/40'
                              : 'bg-slate-950 text-slate-300 border border-slate-800'
                          }`}
                        >
                          <div>
                            <span className="font-bold">{rem.type}</span> • Scheduled for {rem.scheduledFor} (Email)
                            {rem.suppressionReason && (
                              <span className="text-red-400 block no-underline font-sans mt-0.5 font-normal">
                                ↳ Suppressed: {rem.suppressionReason}
                              </span>
                            )}
                          </div>
                          <div>
                            {rem.suppressed ? (
                              <span className="no-underline text-red-400 font-bold">SUPPRESSED</span>
                            ) : rem.delivered ? (
                              <span className="text-emerald-400 font-bold">SENT</span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
                                QUEUED
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <RotateCcw className="w-5 h-5 text-sky-400" />
              <span>Reschedule Appointment ({rescheduleTarget.id})</span>
            </h3>

            <p className="text-xs text-slate-400">
              Rescheduling recalculates reminder lead times (2h & 24h prior) and marks earlier scheduled reminders as suppressed.
            </p>

            <form onSubmit={handleRescheduleSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">New Appointment Date</label>
                <input
                  type="date"
                  required
                  value={newDate}
                  onChange={e => setNewDate(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">New Scheduled Time</label>
                <input
                  type="time"
                  required
                  value={newTime}
                  onChange={e => setNewTime(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRescheduleTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded font-bold transition shadow-sm cursor-pointer"
                >
                  Confirm Reschedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {cancelTarget && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-900/60 rounded-xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <XCircle className="w-5 h-5 text-red-400" />
              <span>Cancel Appointment ({cancelTarget.id})</span>
            </h3>

            <p className="text-xs text-slate-400">
              Cancelling appointment marks the visit as cancelled and invalidates all queued reminders with clear suppression notices.
            </p>

            <form onSubmit={handleCancelSubmit} className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Reason for Cancellation</label>
                <textarea
                  required
                  rows={3}
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  className="w-full p-2 bg-slate-950 border border-slate-700 rounded text-white focus:outline-none focus:border-red-500"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setCancelTarget(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-semibold transition cursor-pointer"
                >
                  Go Back
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded font-bold transition shadow-sm cursor-pointer"
                >
                  Confirm Cancellation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
