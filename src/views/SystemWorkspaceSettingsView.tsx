/**
 * System & Workspace Settings View (Destination: super_admin_setup)
 * Option B — Two-Tabbed Unified Hub:
 * - Tab 1 (Workspace Settings): Accessible to Admin (owner_admin) and Super Admin (super_admin).
 * - Tab 2 (System & Integrations): Accessible strictly to Super Admin (super_admin).
 */

import React, { useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { LegalDetailsForm } from './LegalDetailsForm.tsx';
import { useCabms } from '../context/CabmsContext.tsx';
import { WorkspaceSettingsView } from './WorkspaceSettingsView.tsx';
import { SuperAdminSetupView } from './SuperAdminSetupView.tsx';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBuilding, faGear, faLock } from '@fortawesome/free-solid-svg-icons';

export const SystemWorkspaceSettingsView: React.FC = () => {
  const session = useG01Session();
  const { persona } = useCabms();
  const [activeSubTab, setActiveSubTab] = useState<'workspace' | 'system'>('workspace');

  const isSuperAdmin = persona === 'super_admin';

  return (
    <div className="space-y-6" data-testid="system-workspace-settings-hub">
      {/* Settings Hub Header with Sub-Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-(--cabms-border-base)">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-(--cabms-text-primary)">
            {isSuperAdmin ? 'System & Workspace Settings' : 'Workspace Settings'}
          </h1>
          <p className="text-sm text-(--cabms-text-secondary)">
            {isSuperAdmin
              ? 'Multi-tenant operational profiles, shared MYOB business integration, and technical configuration.'
              : 'Operational contact information, facility addresses, and document appearance preferences.'}
          </p>
        </div>

        {/* Two-Tab Navigation Bar */}
        <div className="flex bg-(--cabms-surface-subtle) rounded-lg p-1 border border-(--cabms-border-base) self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveSubTab('workspace')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-all flex items-center gap-2 ${
              activeSubTab === 'workspace'
                ? 'bg-(--cabms-surface) text-amber-400 shadow-sm border border-(--cabms-border-focus)'
                : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
            }`}
            aria-pressed={activeSubTab === 'workspace'}
          >
            <FontAwesomeIcon icon={faBuilding} />
            <span>Workspace Settings</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubTab('system')}
            className={`px-4 py-2 text-xs font-semibold rounded-md transition-all flex items-center gap-2 ${
              activeSubTab === 'system'
                ? 'bg-(--cabms-surface) text-amber-400 shadow-sm border border-(--cabms-border-focus)'
                : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
            }`}
            aria-pressed={activeSubTab === 'system'}
          >
            <FontAwesomeIcon icon={faGear} />
            <span>System & Integrations</span>
            {!isSuperAdmin && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 flex items-center gap-1 border border-slate-700">
                <FontAwesomeIcon icon={faLock} className="w-2.5 h-2.5" />
                Super Admin
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Tab Viewport */}
      <div>
        <div hidden={activeSubTab !== 'workspace'}>
          <WorkspaceSettingsView />
        </div>
        {session && isSuperAdmin ? (
          <div hidden={activeSubTab !== 'system'}>
            <LegalDetailsForm />
          </div>
        ) : activeSubTab === 'system' ? (
          isSuperAdmin ? (
            <SuperAdminSetupView />
          ) : (
            <AccessDeniedView
              resourceName="Super Admin Business Profiles & Technical Integration Credentials"
              requiredRoleDescription="Super Admin Only"
              customExplanation="Admin, Office Staff and Technicians are strictly prohibited from modifying technical integration credentials, shared MYOB bindings, or company file mappings."
            />
          )
        ) : null}
      </div>
    </div>
  );
};
