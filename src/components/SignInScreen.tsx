/**
 * Simulated Authentication Access Screen
 * Presented when user is logged out or session expires (G00 persona security gate).
 */

import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { Persona } from '../types/cabms.ts';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import {
  faBuilding,
  faUserCheck,
  faWrench,
  faShield,
  faLock,
  faArrowRight,
} from '@fortawesome/free-solid-svg-icons';

export const SignInScreen: React.FC = () => {
  const { simulateSignIn } = useCabms();

  const personas: {
    role: Persona;
    title: string;
    description: string;
    icon: IconDefinition;
    accentColor: string;
    badge: string;
  }[] = [
    {
      role: 'owner_admin',
      title: 'Admin (Primary Operator)',
      description: 'Full business operations, job creation, template editing, customer linkage, and MYOB invoice synchronization.',
      icon: faBuilding,
      accentColor: 'border-amber-500/80 text-amber-400 bg-amber-950/20',
      badge: 'Recommended',
    },
    {
      role: 'office_staff',
      title: 'Office Staff (Operations & Dispatch)',
      description: 'Work order dispatch, quotation generation, calendar appointment scheduling, and website enquiry triage.',
      icon: faUserCheck,
      accentColor: 'border-sky-500/80 text-sky-400 bg-sky-950/20',
      badge: 'Operational',
    },
    {
      role: 'technician',
      title: 'Field Technician (Dave Miller)',
      description: 'On-site field mode: safety risk assessment (JSA), test readings, compliance certificate signing, and evidence capture.',
      icon: faWrench,
      accentColor: 'border-emerald-500/80 text-emerald-400 bg-emerald-950/20',
      badge: 'Field Tech',
    },
    {
      role: 'super_admin',
      title: 'Super Admin (System Governance)',
      description: 'Multi-business tenant profile creation, template version publishing, and simulated integrations configuration.',
      icon: faShield,
      accentColor: 'border-purple-500/80 text-purple-400 bg-purple-950/20',
      badge: 'System Admin',
    },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center space-x-2 cabms-surface-subtle border cabms-border px-3 py-1.5 rounded-full text-xs text-(--cabms-text-secondary)">
          <FontAwesomeIcon icon={faLock} className="w-3.5 h-3.5 text-amber-400" />
          <span>Role-Based Authentication Gateway</span>
        </div>
        <h1 className="text-3xl font-extrabold text-(--cabms-text-primary) tracking-tight">
          CABMS Session Access
        </h1>
        <p className="text-sm text-(--cabms-text-secondary) max-w-xl mx-auto">
          The application requires an authenticated session. Authentication backend pending — select a preview persona below to explore role-based permissions.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {personas.map(p => {
          return (
            <div
              key={p.role}
              className={`p-6 rounded-xl border cabms-card transition flex flex-col justify-between space-y-4 shadow-lg`}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="p-2 cabms-surface-subtle rounded-lg border cabms-border">
                      <FontAwesomeIcon icon={p.icon} className="w-5 h-5" />
                    </div>
                    <span className="font-bold text-(--cabms-text-primary) text-base">{p.title}</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded cabms-surface-subtle border cabms-border text-(--cabms-text-secondary)">
                    {p.badge}
                  </span>
                </div>
                <p className="text-xs text-(--cabms-text-secondary) leading-relaxed">
                  {p.description}
                </p>
              </div>

              <button
                onClick={() => simulateSignIn(p.role)}
                className="w-full py-2.5 cabms-surface-subtle hover:bg-sky-700 hover:text-white text-(--cabms-text-primary) font-bold text-xs rounded-lg transition border cabms-border flex items-center justify-center space-x-2 cursor-pointer shadow-sm"
              >
                <span>Sign In as {p.title.split(' (')[0].toUpperCase()}</span>
                <FontAwesomeIcon icon={faArrowRight} className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="cabms-card p-4 text-xs text-(--cabms-text-secondary) flex items-center justify-between">
        <span>Authentication backend pending — local role-based preview active.</span>
        <span className="font-mono text-[11px] text-slate-500">CABMS-AUTH-SIM-V1</span>
      </div>
    </div>
  );
};
