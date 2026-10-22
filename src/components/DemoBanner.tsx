/**
 * Persistent DEMO — NO LIVE INTEGRATIONS Banner
 * Must be visible on every screen per prompt specification
 */

import React from 'react';
import { AlertTriangle, ShieldCheck, Database, Calendar, Mail, FileText } from 'lucide-react';

export const DemoBanner: React.FC = () => {
  return (
    <div className="bg-amber-500 text-slate-950 px-4 py-2 text-xs md:text-sm font-semibold flex flex-wrap items-center justify-between border-b border-amber-600 shadow-sm z-50">
      <div className="flex items-center space-x-2">
        <span className="bg-slate-950 text-amber-400 font-extrabold px-2 py-0.5 rounded text-xs tracking-wider uppercase">
          DEMO — NO LIVE INTEGRATIONS
        </span>
        <span className="hidden sm:inline font-medium text-slate-900">
          Simulated MYOB AccountRight • Calendar Sync • Safe Mocks • Resettable Seed State
        </span>
      </div>
      <div className="flex items-center space-x-3 text-xs text-slate-900 font-medium mt-1 sm:mt-0">
        <span className="inline-flex items-center gap-1">
          <Database className="w-3.5 h-3.5" /> Fictional Data
        </span>
        <span className="inline-flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5" /> No Live APIs
        </span>
        <span className="inline-flex items-center gap-1 text-slate-800">
          Strict Isolation
        </span>
      </div>
    </div>
  );
};
