/**
 * Access Denied View
 * Demonstrates crisp role-based UX boundaries when a persona attempts direct-route access
 */

import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { ShieldAlert, ArrowLeft, UserCheck } from 'lucide-react';
import { Persona } from '../types/cabms.ts';

interface AccessDeniedProps {
  title?: string;
  resourceName: string;
  requiredRoleDescription: string;
  customExplanation?: string;
}

export const AccessDeniedView: React.FC<AccessDeniedProps> = ({
  title = 'Access Denied — Persona Boundary Enforced',
  resourceName,
  requiredRoleDescription,
  customExplanation,
}) => {
  const { persona, setPersona, setActiveTab } = useCabms();

  const getPersonaLabel = (p: Persona) => {
    switch (p) {
      case 'super_admin': return 'Super Admin';
      case 'owner_admin': return 'Owner / Admin';
      case 'office_staff': return 'Office Staff';
      case 'technician': return 'Technician (Dave Miller)';
    }
  };

  return (
    <div className="max-w-2xl mx-auto my-12 p-8 bg-slate-900 border border-red-900/60 rounded-xl shadow-lg text-center">
      <div className="w-14 h-14 bg-red-950/80 text-red-400 rounded-full flex items-center justify-center mx-auto mb-4 border border-red-800">
        <ShieldAlert className="w-8 h-8" />
      </div>

      <span className="text-[11px] font-bold tracking-widest text-red-400 uppercase bg-red-950/60 px-3 py-1 rounded-full border border-red-800/60">
        Simulated UX Role Boundary
      </span>

      <h2 className="text-xl font-bold text-white mt-4 mb-2">
        {title}
      </h2>

      <p className="text-slate-300 text-sm mb-4">
        Your current active persona is <strong className="text-sky-400">{getPersonaLabel(persona)}</strong>.
      </p>

      <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-4 text-left text-xs text-slate-300 space-y-2 mb-6">
        <div>
          <span className="text-slate-400 font-semibold">Protected Resource:</span>{' '}
          <span className="text-white font-mono">{resourceName}</span>
        </div>
        <div>
          <span className="text-slate-400 font-semibold">Required Authorization:</span>{' '}
          <span className="text-amber-300">{requiredRoleDescription}</span>
        </div>
        {customExplanation && (
          <div className="border-t border-slate-800/80 pt-2 text-slate-400">
            {customExplanation}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={() => setActiveTab('dashboard')}
          className="flex items-center space-x-1.5 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Return to Dashboard</span>
        </button>

        <div className="flex items-center space-x-2">
          <span className="text-xs text-slate-400">Or switch persona:</span>
          <button
            onClick={() => setPersona('owner_admin')}
            className="px-3 py-2 bg-sky-900/40 hover:bg-sky-800/60 text-sky-200 border border-sky-700 text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Switch to Owner/Admin
          </button>
          <button
            onClick={() => setPersona('super_admin')}
            className="px-3 py-2 bg-purple-900/40 hover:bg-purple-800/60 text-purple-200 border border-purple-700 text-xs font-semibold rounded-lg transition cursor-pointer"
          >
            Switch to Super Admin
          </button>
        </div>
      </div>
    </div>
  );
};
