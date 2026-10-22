/**
 * Simulated Authentication Access Screen
 * Presented when user is logged out or session expires (G00 persona security gate).
 */

import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { Persona } from '../types/cabms.ts';
import { ShieldCheck, UserCheck, Wrench, Building2, Lock, ArrowRight } from 'lucide-react';

export const SignInScreen: React.FC = () => {
  const { simulateSignIn } = useCabms();

  const personas: {
    role: Persona;
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accentColor: string;
    badge: string;
  }[] = [
    {
      role: 'owner_admin',
      title: 'Owner / Admin (Primary Operator)',
      description: 'Full business operations, job creation, template editing, customer linkage, and MYOB invoice synchronization.',
      icon: Building2,
      accentColor: 'border-amber-500/80 text-amber-400 bg-amber-950/20',
      badge: 'Recommended',
    },
    {
      role: 'office_staff',
      title: 'Office Staff (Operations & Dispatch)',
      description: 'Work order dispatch, quotation generation, calendar appointment scheduling, and website enquiry triage.',
      icon: UserCheck,
      accentColor: 'border-sky-500/80 text-sky-400 bg-sky-950/20',
      badge: 'Operational',
    },
    {
      role: 'technician',
      title: 'Field Technician (Dave Miller)',
      description: 'On-site field mode: safety risk assessment (JSA), test readings, compliance certificate signing, and evidence capture.',
      icon: Wrench,
      accentColor: 'border-emerald-500/80 text-emerald-400 bg-emerald-950/20',
      badge: 'Field Tech',
    },
    {
      role: 'super_admin',
      title: 'Super Admin (System Governance)',
      description: 'Multi-business tenant profile creation, template version publishing, and simulated integrations configuration.',
      icon: ShieldCheck,
      accentColor: 'border-purple-500/80 text-purple-400 bg-purple-950/20',
      badge: 'System Admin',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center space-x-2 bg-slate-900 border border-slate-800 px-3 py-1.5 rounded-full text-xs text-slate-400">
          <Lock className="w-3.5 h-3.5 text-amber-400" />
          <span>Simulated Authentication & Role Boundary</span>
        </div>
        <h1 className="text-3xl font-extrabold text-white tracking-tight">
          CABMS Session Access
        </h1>
        <p className="text-sm text-slate-400 max-w-xl mx-auto">
          The application requires an authenticated session. Select a persona below to simulate authenticated access with explicit role-based permissions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {personas.map(p => {
          const Icon = p.icon;
          return (
            <div
              key={p.role}
              className={`p-6 rounded-xl border bg-slate-900/90 hover:bg-slate-900 transition flex flex-col justify-between space-y-4 shadow-lg ${p.accentColor}`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 bg-slate-950 rounded-lg border border-slate-800">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-white text-base">{p.title}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">
                    {p.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  {p.description}
                </p>
              </div>

              <button
                onClick={() => simulateSignIn(p.role)}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs rounded-lg transition border border-slate-700 flex items-center justify-center space-x-2 cursor-pointer shadow-sm hover:border-slate-500"
              >
                <span>Sign In as {p.role.replace('_', ' ').toUpperCase()}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 flex items-center justify-between">
        <span>No external OAuth or identity server required — simulated authentication session.</span>
        <span className="font-mono text-[11px] text-slate-500">CABMS-AUTH-SIM-V1</span>
      </div>
    </div>
  );
};
