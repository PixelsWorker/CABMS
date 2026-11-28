/**
 * Workspace Settings View (Tab 1 of System & Workspace Settings)
 * Accessible to Admin (owner_admin) and Super Admin (super_admin).
 * Allows managing operational contacts, hours, address, and branding preferences.
 * Legal entities and technical credentials remain strictly read-only for Admins.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { buildApiUrl } from '../services/g01Client.ts';
import { useSettingsResource } from '../services/useSettingsResource.ts';
import { SettingsFeedback } from '../components/SettingsFeedback.tsx';
import type { WorkspaceSettingsRow } from '../../contracts/settings.ts';
import type {
  WorkspaceProviderConfigPublic,
  ProviderAuditEventRow,
  ProviderTestResponse,
} from '../../backend/workers/routes/settingsProviders.ts';
import { useCabms } from '../context/CabmsContext.tsx';
import { BrandConfig, BrandId, VisualPreset } from '../types/cabms.ts';
import { AccessDeniedView } from '../components/AccessDeniedView.tsx';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBuilding,
  faPhone,
  faEnvelope,
  faLocationDot,
  faClock,
  faPalette,
  faLock,
  faCheck,
  faCircleCheck,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons';

interface WorkspaceDraft {
  tagline: string;
  contactPhone: string;
  contactEmail: string;
  operationalAddress: string;
  operatingHours: string;
  preferredPreset: VisualPreset;
}

const getBrandDefaults = (brand: BrandConfig, fallbackPreset: VisualPreset): WorkspaceDraft => ({
  tagline: brand.tagline || '',
  contactPhone: brand.contactPhone || '',
  contactEmail: brand.contactEmail || '',
  operationalAddress: brand.operationalAddress || '',
  operatingHours: brand.operatingHours || '',
  preferredPreset: brand.preferredPreset || fallbackPreset,
});

export const WorkspaceSettingsView: React.FC<{ isActive?: boolean }> = ({ isActive = true }) => {
  const {
    persona,
    activeBrandId,
    setActiveBrandId,
    brands,
    updateBrandConfig,
    myobConnection,
    visualPreset,
    setVisualPreset,
  } = useCabms();

  const session = useG01Session();
  const resource = useSettingsResource('settings');
  const serverValues = resource.value as WorkspaceSettingsRow | undefined;
  const currentBrand = brands[activeBrandId];
  const canEdit = persona === 'super_admin' || persona === 'owner_admin';

  // Provider & System Configuration (D1-backed when session is active)
  const [providerConfig, setProviderConfig] = useState<WorkspaceProviderConfigPublic | null>(null);
  const [providerEtag, setProviderEtag] = useState<string | null>(null);
  const [providerDraft, setProviderDraft] = useState<Record<string, unknown>>({});
  const [smtpSecretInput, setSmtpSecretInput] = useState('');
  const [myobSecretInput, setMyobSecretInput] = useState('');
  const [clearSmtpSecret, setClearSmtpSecret] = useState(false);
  const [clearMyobSecret, setClearMyobSecret] = useState(false);
  const [providerLoading, setProviderLoading] = useState(false);
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerTesting, setProviderTesting] = useState<'smtp' | 'myob' | 'calendar' | null>(null);
  const [providerMessage, setProviderMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [providerTestOutput, setProviderTestOutput] = useState<ProviderTestResponse | null>(null);
  const [providerAudit, setProviderAudit] = useState<ProviderAuditEventRow[]>([]);

  const loadProviderConfig = useCallback(async () => {
    if (!isActive || !session?.workspaceId || !canEdit) {
      if (!session?.workspaceId || !canEdit) {
        setProviderConfig(null);
        setProviderEtag(null);
        setProviderAudit([]);
      }
      return;
    }
    setProviderLoading(true);
    try {
      const token = await session.token();
      const ws = encodeURIComponent(session.workspaceId);
      const res = await fetch(buildApiUrl(`/api/v1/workspaces/${ws}/provider-settings`), {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json, application/problem+json' },
      });
      if (res.ok) {
        const data = (await res.json()) as WorkspaceProviderConfigPublic;
        setProviderConfig(data);
        setProviderEtag(res.headers.get('ETag') || `"${data.version}"`);
        setProviderDraft({});
        setSmtpSecretInput('');
        setMyobSecretInput('');
        setClearSmtpSecret(false);
        setClearMyobSecret(false);
        const auditRes = await fetch(buildApiUrl(`/api/v1/workspaces/${ws}/provider-settings/audit`), {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (auditRes.ok) {
          const auditBody = (await auditRes.json()) as { events?: ProviderAuditEventRow[] };
          setProviderAudit(auditBody.events || []);
        }
      } else if (res.status === 404) {
        setProviderConfig(null);
        setProviderEtag(null);
      }
    } catch {
      // Non-fatal if provider-settings route is not mounted in a partial test harness
    } finally {
      setProviderLoading(false);
    }
  }, [isActive, session?.workspaceId, canEdit, session]);

  useEffect(() => {
    setProviderMessage(null);
    setProviderTestOutput(null);
    void loadProviderConfig();
  }, [loadProviderConfig]);

  const effectiveProvider = providerConfig ? { ...providerConfig, ...providerDraft } as WorkspaceProviderConfigPublic : null;

  const setProviderField = (field: string, value: unknown) => {
    setProviderDraft(prev => ({ ...prev, [field]: value }));
    setProviderMessage(null);
  };

  const handleSaveProviders = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.workspaceId || !providerConfig || !providerEtag || providerSaving) return;
    const payload: Record<string, unknown> = { ...providerDraft };
    if (clearSmtpSecret) payload.smtp_secret = null;
    else if (smtpSecretInput) payload.smtp_secret = smtpSecretInput;
    if (clearMyobSecret) payload.myob_client_secret = null;
    else if (myobSecretInput) payload.myob_client_secret = myobSecretInput;

    if (Object.keys(payload).length === 0) {
      setProviderMessage({ text: 'No provider configuration changes to save.', error: false });
      return;
    }

    setProviderSaving(true);
    setProviderMessage(null);
    try {
      const token = await session.token();
      const ws = encodeURIComponent(session.workspaceId);
      const res = await fetch(buildApiUrl(`/api/v1/workspaces/${ws}/provider-settings`), {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, application/problem+json',
          'If-Match': providerEtag,
        },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = (await res.json()) as WorkspaceProviderConfigPublic;
        setProviderConfig(updated);
        setProviderEtag(res.headers.get('ETag') || `"${updated.version}"`);
        setProviderDraft({});
        setSmtpSecretInput('');
        setMyobSecretInput('');
        setClearSmtpSecret(false);
        setClearMyobSecret(false);
        setProviderMessage({ text: 'Provider settings saved to D1 (secrets stored server-side only).', error: false });
        void loadProviderConfig();
      } else {
        const prob = (await res.json().catch(() => null)) as { detail?: string } | null;
        setProviderMessage({ text: prob?.detail || `Failed to save provider settings (HTTP ${res.status}).`, error: true });
      }
    } catch {
      setProviderMessage({ text: 'Network error while saving provider settings.', error: true });
    } finally {
      setProviderSaving(false);
    }
  };

  const handleTestProvider = async (provider: 'smtp' | 'myob' | 'calendar') => {
    if (!session?.workspaceId || providerTesting) return;
    setProviderTesting(provider);
    setProviderMessage(null);
    try {
      const token = await session.token();
      const ws = encodeURIComponent(session.workspaceId);
      const res = await fetch(buildApiUrl(`/api/v1/workspaces/${ws}/provider-settings/test`), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, application/problem+json',
        },
        body: JSON.stringify({ provider }),
      });
      if (res.ok) {
        const result = (await res.json()) as ProviderTestResponse;
        setProviderTestOutput(result);
        setProviderConfig(result.config);
        setProviderEtag(res.headers.get('ETag') || `"${result.config.version}"`);
        void loadProviderConfig();
      } else {
        const prob = (await res.json().catch(() => null)) as { detail?: string } | null;
        setProviderMessage({ text: prob?.detail || `Connection test failed (HTTP ${res.status}).`, error: true });
      }
    } catch {
      setProviderMessage({ text: 'Network error running simulated provider test.', error: true });
    } finally {
      setProviderTesting(null);
    }
  };

  useEffect(() => {
    if (resource.active && resource.row && 'preferred_preset' in resource.row) setVisualPreset(resource.row.preferred_preset as VisualPreset);
  }, [resource.row?.version, activeBrandId]);

  // Retain unsaved form drafts per brand across workspace tab switches
  const [drafts, setDrafts] = useState<Record<string, WorkspaceDraft>>({});

  // Active form values fall back to current brand config if no draft exists
  const currentFormValues: WorkspaceDraft = resource.active ? {
    tagline: serverValues?.tagline || '', contactPhone: serverValues?.contact_phone || '',
    contactEmail: serverValues?.contact_email || '', operationalAddress: serverValues?.operational_address || '',
    operatingHours: serverValues?.operating_hours || '', preferredPreset: (serverValues?.preferred_preset || 'dark_company') as VisualPreset,
  } : drafts[activeBrandId] ?? (currentBrand ? getBrandDefaults(currentBrand, visualPreset) : ({} as WorkspaceDraft));

  const updateDraftField = <K extends keyof WorkspaceDraft>(key: K, value: WorkspaceDraft[K]) => {
    if (resource.active) {
      const fields = { tagline: 'tagline', contactPhone: 'contact_phone', contactEmail: 'contact_email', operationalAddress: 'operational_address', operatingHours: 'operating_hours', preferredPreset: 'preferred_preset' };
      resource.setField(fields[key], value);
      return;
    }
    if (!currentBrand) return;
    setDrafts(prev => ({
      ...prev,
      [activeBrandId]: {
        ...(prev[activeBrandId] ?? getBrandDefaults(currentBrand, visualPreset)),
        [key]: value,
      },
    }));
  };

  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setSavedFeedback(false);
  }, [activeBrandId]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBrand) return;
    if (resource.active) { void resource.save(); return; }
    const updated: BrandConfig = {
      ...currentBrand,
      tagline: currentFormValues.tagline,
      contactPhone: currentFormValues.contactPhone,
      contactEmail: currentFormValues.contactEmail,
      operationalAddress: currentFormValues.operationalAddress,
      operatingHours: currentFormValues.operatingHours,
      preferredPreset: currentFormValues.preferredPreset,
    };
    const result = updateBrandConfig(updated);
    if (result && !result.success) return;
    if (currentFormValues.preferredPreset !== currentBrand.preferredPreset) {
      setVisualPreset(currentFormValues.preferredPreset);
    }
    // Clear draft for this brand upon successful save
    setDrafts(prev => {
      const next = { ...prev };
      delete next[activeBrandId];
      return next;
    });
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 4000);
  };

  const operationalBrandList = (['solarcell', 'smart_home', 'cctv'] as BrandId[]).filter(id => !!brands[id]).map(
    id => brands[id] || { id, name: id }
  );

  if (!currentBrand) {
    return (
      <AccessDeniedView
        resourceName="Workspace Settings"
        requiredRoleDescription="Authorized Workspace Administrator"
        customExplanation="The selected workspace is not accessible to your account."
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="workspace-settings-view">
      {/* Workspace Brand Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-(--cabms-border-base)">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-(--cabms-text-primary)">
            Workspace Operational Settings
          </h2>
          <p className="text-sm text-(--cabms-text-secondary)">
            Manage contact channels, operating hours, and appearance preferences for each operating trade business.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-(--cabms-text-secondary)">
            Active Workspace:
          </span>
          <div className="flex bg-(--cabms-surface-subtle) rounded-lg p-1 border border-(--cabms-border-base)">
            {operationalBrandList.map(b => {
              const hasDraft = Boolean(drafts[b.id]);
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => setActiveBrandId(b.id as BrandId)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-1.5 ${
                    activeBrandId === b.id
                      ? 'bg-(--cabms-surface) text-(--cabms-text-primary) shadow-sm border border-(--cabms-border-focus)'
                      : 'text-(--cabms-text-secondary) hover:text-(--cabms-text-primary)'
                  }`}
                  aria-pressed={activeBrandId === b.id}
                >
                  <span>{b.name}</span>
                  {hasDraft && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-amber-400"
                      title="Unsaved draft changes"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Integration Health Strip */}
      {resource.active && (
        <p className="text-xs text-(--cabms-text-secondary)">
          {providerConfig
            ? 'Live D1 provider status below. All connection tests run in clearly labeled Sandbox Simulation mode.'
            : 'Integration indicators below are synthetic demonstrations; no provider is connected.'}
        </p>
      )}
      <div className="cabms-card p-4 bg-(--cabms-surface-subtle) border border-(--cabms-border-base) rounded-lg">
        <h3 className="text-xs font-bold uppercase tracking-wider text-(--cabms-text-secondary) mb-3">
          Integration Health Status (Read-Only)
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">MYOB Business (Sandbox):</span>
            {providerConfig ? (
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1.5 ${
                  providerConfig.myob_connection_status === 'CONNECTED_SANDBOX'
                    ? 'cabms-badge-completed'
                    : providerConfig.myob_connection_status === 'FAILED'
                    ? 'cabms-badge-danger'
                    : 'cabms-badge-warning'
                }`}
              >
                <FontAwesomeIcon
                  icon={providerConfig.myob_connection_status === 'CONNECTED_SANDBOX' ? faCircleCheck : faTriangleExclamation}
                  className="w-3 h-3"
                />
                {providerConfig.myob_connection_status}
              </span>
            ) : (
              <span
                className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1.5 ${
                  myobConnection.status === 'CONNECTED'
                    ? 'cabms-badge-completed'
                    : 'cabms-badge-danger'
                }`}
              >
                <FontAwesomeIcon
                  icon={myobConnection.status === 'CONNECTED' ? faCircleCheck : faTriangleExclamation}
                  className="w-3 h-3"
                />
                {myobConnection.status}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">SMTP Email Relay:</span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1.5 ${
                providerConfig?.smtp_last_test_status === 'PASSED_SANDBOX' || providerConfig?.smtp_last_test_status === 'PASSED_LIVE'
                  ? 'cabms-badge-completed'
                  : providerConfig?.smtp_last_test_status === 'FAILED'
                  ? 'cabms-badge-danger'
                  : 'cabms-badge-warning'
              }`}
            >
              <FontAwesomeIcon icon={faClock} className="w-3 h-3" />
              {providerConfig ? `${providerConfig.smtp_last_test_status} (${providerConfig.smtp_transport_mode})` : 'Local Configuration Mode'}
            </span>
          </div>

          <div className="flex items-center justify-between p-2.5 rounded bg-(--cabms-surface) border border-(--cabms-border-base)">
            <span className="text-xs font-medium text-(--cabms-text-secondary)">Calendar Mapping:</span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-semibold flex items-center gap-1.5 ${
                providerConfig
                  ? providerConfig.calendar_sync_status === 'SYNCED_SANDBOX'
                    ? 'cabms-badge-completed'
                    : 'cabms-badge-warning'
                  : 'cabms-badge-completed'
              }`}
            >
              <FontAwesomeIcon icon={faCircleCheck} className="w-3 h-3" />
              {providerConfig ? providerConfig.calendar_sync_status : 'SYNCED'}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <form onSubmit={handleSave} className="cabms-card p-6 space-y-4">
          {resource.active && <SettingsFeedback resource={resource} />}
          <fieldset className="space-y-4" disabled={resource.active && (!canEdit || !resource.row || resource.loading)}>
          {resource.active && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-xs">Trading Name<input id="ws-trading-name" required maxLength={100} className="w-full cabms-card-subtle rounded p-2" value={serverValues?.trading_name || ''} onChange={e => resource.setField('trading_name', e.target.value)} /></label>
            {serverValues?.contract_threshold_cents !== undefined && <label className="text-xs">
              Contract threshold including GST (AUD cents)
              <input type="number" min="0" step="1" required className="w-full cabms-card-subtle rounded p-2"
                value={serverValues.contract_threshold_cents ?? ''} onChange={e => resource.setField('contract_threshold_cents',
                  e.target.value === '' ? null : e.target.valueAsNumber)} />
            </label>}
            <div className="rounded-lg border border-(--cabms-border-base) cabms-card-subtle p-3 flex items-center gap-3">
              <span
                aria-hidden="true"
                className="w-6 h-6 rounded border border-(--cabms-border-base) shrink-0"
                style={{ backgroundColor: 'var(--cabms-brand-primary)' }}
              />
              <div className="text-xs">
                <div className="font-semibold text-(--cabms-text-primary)">{currentBrand?.name || activeBrandId}</div>
                <div className="text-(--cabms-text-secondary)">Official company brand accent (read-only)</div>
              </div>
            </div>
          </div>}
          <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2 border-b border-(--cabms-border-base) pb-3">
            <FontAwesomeIcon icon={faBuilding} className="text-amber-500" />
            Operational Contact & Preferences
          </h3>

            {/* Tagline */}
            <div>
              <label htmlFor="ws-tagline" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                Workspace Tagline / Business Focus
              </label>
              <input
                id="ws-tagline"
                type="text"
                value={currentFormValues.tagline}
                onChange={e => updateDraftField('tagline', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="e.g. Commercial & Residential Solar Energy Systems"
              />
            </div>

            {/* Phone & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="ws-phone" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                  <FontAwesomeIcon icon={faPhone} className="mr-1 text-(--cabms-text-secondary)" />
                  Operational Phone
                </label>
                <input
                  id="ws-phone"
                  type="text"
                  value={currentFormValues.contactPhone}
                  onChange={e => updateDraftField('contactPhone', e.target.value)}
                  className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                  placeholder="(07) 5500 0000"
                />
              </div>
              <div>
                <label htmlFor="ws-email" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                  <FontAwesomeIcon icon={faEnvelope} className="mr-1 text-(--cabms-text-secondary)" />
                  Operational Email
                </label>
                <input
                  id="ws-email"
                  type="email"
                  value={currentFormValues.contactEmail}
                  onChange={e => updateDraftField('contactEmail', e.target.value)}
                  className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                  placeholder="operations@example.invalid"
                />
              </div>
            </div>

            {/* Address & Hours */}
            <div>
              <label htmlFor="ws-address" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faLocationDot} className="mr-1 text-(--cabms-text-secondary)" />
                Operating Facility / Dispatch Address
              </label>
              <input
                id="ws-address"
                type="text"
                value={currentFormValues.operationalAddress}
                onChange={e => updateDraftField('operationalAddress', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="12 Industry Way, Brendale QLD 4500"
              />
            </div>

            <div>
              <label htmlFor="ws-hours" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faClock} className="mr-1 text-(--cabms-text-secondary)" />
                Standard Operating Hours
              </label>
              <input
                id="ws-hours"
                type="text"
                value={currentFormValues.operatingHours}
                onChange={e => updateDraftField('operatingHours', e.target.value)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
                placeholder="Mon-Fri 7:00 AM - 5:00 PM AEST"
              />
            </div>

            {/* Preferred Visual Preset */}
            <div>
              <label htmlFor="ws-preset" className="block text-xs font-medium text-(--cabms-text-secondary) mb-1">
                <FontAwesomeIcon icon={faPalette} className="mr-1 text-(--cabms-text-secondary)" />
                Preferred Workspace Visual Preset
              </label>
              <select
                id="ws-preset"
                value={currentFormValues.preferredPreset}
                onChange={e => updateDraftField('preferredPreset', e.target.value as VisualPreset)}
                className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) text-(--cabms-text-primary) text-sm focus:border-(--cabms-border-focus) focus:outline-none"
              >
                <option value="dark_neutral">Preset 1 — All Dark (Neutral Panels)</option>
                <option value="dark_company">Preset 2 — Dark + Company Branding (Recommended)</option>
                <option value="light_neutral">Preset 3 — All Light (Neutral Panels)</option>
                <option value="light_company">Preset 4 — Light + Company Branding</option>
                <option value="high_visibility_dark">High Visibility Dark</option>
              </select>
              <p className="text-[11px] text-(--cabms-text-secondary) mt-1">
                Active theme preset: <span className="font-mono">{visualPreset}</span>.
              </p>
            </div>

            {/* Submit Button */}
            <div className="pt-2 flex items-center gap-3">
              <button
                type="submit"
                disabled={resource.active && (resource.saving || resource.reviewRequired || !resource.dirty)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold rounded text-sm transition-colors shadow-sm flex items-center gap-2"
              >
                <FontAwesomeIcon icon={faCheck} />
                Save Workspace Settings
              </button>
              {!resource.active && savedFeedback && (
                <span className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                  <FontAwesomeIcon icon={faCircleCheck} />
                  Settings saved successfully!
                </span>
              )}
            </div>
          </fieldset>
          </form>

          {/* Legal Entity & Licences (Read-only for Admin) */}
          <div className="cabms-card p-6 bg-(--cabms-surface-subtle) border border-(--cabms-border-base) rounded-lg space-y-4">
            <div className="flex items-center justify-between border-b border-(--cabms-border-base) pb-3">
              <h3 className="text-base font-semibold text-(--cabms-text-primary) flex items-center gap-2">
                <FontAwesomeIcon icon={faLock} className="text-(--cabms-text-secondary)" />
                Legal Entity & Statutory Licences
              </h3>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                {persona === 'super_admin' ? 'Super Admin Mode' : 'Admin Read-Only'}
              </span>
            </div>

            <div className="p-3 bg-amber-950/20 border border-amber-800/40 rounded text-xs text-amber-200/90 leading-relaxed">
              Legal entity names, ABN, and statutory licence registrations are governed under corporate compliance and
              can only be modified by Super Admin in the System & Integrations console.
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Legal Entity Name:</span>
                <span className="font-semibold text-(--cabms-text-primary) block">{currentBrand.legalIssuerName}</span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">ABN Registration:</span>
                <span className="font-mono text-(--cabms-text-primary) block">{currentBrand.abnPlaceholder}</span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Electrical Contractor Licence:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.electricalLicencePlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">ACMA Registered Cabler:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.acmaCablerPlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">QBCC Trade Licence:</span>
                <span className="font-mono text-(--cabms-text-primary) block">
                  {currentBrand.qbccLicencePlaceholder || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-(--cabms-text-secondary) block mb-0.5">Regional Calendar Policy:</span>
                <span className="font-semibold text-(--cabms-text-primary) block capitalize">
                  {currentBrand.holidayRegion === 'gold_coast' ? 'Gold Coast (Show: 28 Aug)' : 'Brisbane Metro (Ekka: 12 Aug)'}
                </span>
              </div>
            </div>
          </div>

          {/* System & Provider Configuration (D1-Backed, Owner Admin & Super Admin) */}
          {resource.active && !canEdit && (
            <div className="cabms-card p-4 border border-(--cabms-border-base) rounded-lg text-xs text-(--cabms-text-secondary)" data-testid="provider-settings-restricted">
              Provider &amp; System Configuration (SMTP, MYOB Sandbox, Calendar Mapping) is strictly restricted to Owner Admin and Super Admin.
            </div>
          )}

          {resource.active && canEdit && effectiveProvider && (
            <form onSubmit={handleSaveProviders} className="cabms-card p-6 space-y-6" data-testid="provider-settings-form">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-(--cabms-border-base) pb-3">
                <div>
                  <h3 className="text-base font-semibold text-(--cabms-text-primary)">
                    System &amp; Provider Configuration (D1-Backed)
                  </h3>
                  <p className="text-xs text-(--cabms-text-secondary)">
                    Configure SMTP sender identity, MYOB sandbox, and calendar mappings. Secrets are write-only and stored server-side only.
                  </p>
                </div>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-sky-950/60 text-sky-300 border border-sky-800/60 self-start">
                  Sandbox Simulation Mode
                </span>
              </div>

              {providerMessage && (
                <div
                  role="status"
                  className={`p-3 rounded text-xs border ${
                    providerMessage.error
                      ? 'bg-red-950/40 border-red-800/60 text-red-200'
                      : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                  }`}
                >
                  {providerMessage.text}
                </div>
              )}

              {providerTestOutput && (
                <div
                  role="status"
                  data-testid="provider-test-output"
                  className={`p-3 rounded text-xs border ${
                    providerTestOutput.ok
                      ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-200'
                      : 'bg-amber-950/40 border-amber-800/60 text-amber-200'
                  }`}
                >
                  <div className="font-semibold uppercase tracking-wider text-[10px] mb-1">
                    Simulated Sandbox Test Result ({providerTestOutput.provider}) — {providerTestOutput.status}
                  </div>
                  <div>{providerTestOutput.message}</div>
                </div>
              )}

              {/* 1. SMTP & Email Sender Identity */}
              <div className="space-y-3 border-b border-(--cabms-border-base) pb-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-(--cabms-text-primary)">SMTP &amp; Email Sender Identity</h4>
                  <button
                    type="button"
                    data-testid="test-smtp-btn"
                    disabled={providerTesting !== null || providerLoading}
                    onClick={() => void handleTestProvider('smtp')}
                    className="px-3 py-1.5 text-xs font-semibold rounded border border-(--cabms-border-base) cabms-surface-subtle hover:border-(--cabms-border-focus)"
                  >
                    {providerTesting === 'smtp' ? 'Testing...' : 'Test SMTP (Sandbox)'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Sender Display Name</span>
                    <input
                      id="provider-sender-name"
                      type="text"
                      required
                      maxLength={100}
                      value={effectiveProvider.sender_name || ''}
                      onChange={e => setProviderField('sender_name', e.target.value)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Sender Email</span>
                    <input
                      id="provider-sender-email"
                      type="email"
                      maxLength={254}
                      value={effectiveProvider.sender_email || ''}
                      onChange={e => setProviderField('sender_email', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Reply-To Email</span>
                    <input
                      id="provider-reply-to"
                      type="email"
                      maxLength={254}
                      value={effectiveProvider.reply_to_email || ''}
                      onChange={e => setProviderField('reply_to_email', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">SMTP Host</span>
                    <input
                      id="provider-smtp-host"
                      type="text"
                      maxLength={200}
                      value={effectiveProvider.smtp_host || ''}
                      onChange={e => setProviderField('smtp_host', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">SMTP Port</span>
                    <input
                      id="provider-smtp-port"
                      type="number"
                      min={1}
                      max={65535}
                      value={effectiveProvider.smtp_port}
                      onChange={e => setProviderField('smtp_port', e.target.valueAsNumber || 587)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Transport Mode</span>
                    <select
                      id="provider-smtp-mode"
                      value={effectiveProvider.smtp_transport_mode}
                      onChange={e => setProviderField('smtp_transport_mode', e.target.value)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    >
                      <option value="sandbox">Sandbox Simulation</option>
                      <option value="smtp_relay">SMTP Relay</option>
                      <option value="http_relay">HTTPS Email Relay</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">SMTP Username</span>
                    <input
                      id="provider-smtp-username"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.smtp_username || ''}
                      onChange={e => setProviderField('smtp_username', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <div className="block sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="provider-smtp-secret" className="text-(--cabms-text-secondary)">
                        SMTP Secret / API Key (Write-Only)
                      </label>
                      {providerConfig?.has_smtp_secret && !clearSmtpSecret && (
                        <span className="text-[10px] font-mono text-emerald-400">
                          Configured (server-side only)
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        id="provider-smtp-secret"
                        type="password"
                        autoComplete="new-password"
                        placeholder={providerConfig?.has_smtp_secret ? '•••••••• (enter new value to rotate)' : 'Enter SMTP password or relay key'}
                        value={smtpSecretInput}
                        onChange={e => { setSmtpSecretInput(e.target.value); setClearSmtpSecret(false); }}
                        className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                      />
                      {providerConfig?.has_smtp_secret && (
                        <button
                          type="button"
                          onClick={() => { setClearSmtpSecret(v => !v); setSmtpSecretInput(''); }}
                          className="px-2.5 py-1 rounded border border-(--cabms-border-base) text-[11px] shrink-0"
                        >
                          {clearSmtpSecret ? 'Undo Clear' : 'Clear'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. MYOB Sandbox Configuration */}
              <div className="space-y-3 border-b border-(--cabms-border-base) pb-5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-(--cabms-text-primary)">MYOB Sandbox Configuration</h4>
                  <button
                    type="button"
                    data-testid="test-myob-btn"
                    disabled={providerTesting !== null || providerLoading}
                    onClick={() => void handleTestProvider('myob')}
                    className="px-3 py-1.5 text-xs font-semibold rounded border border-(--cabms-border-base) cabms-surface-subtle hover:border-(--cabms-border-focus)"
                  >
                    {providerTesting === 'myob' ? 'Testing...' : 'Test MYOB (Sandbox)'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <label className="flex items-center gap-2 pt-4">
                    <input
                      id="provider-myob-enabled"
                      type="checkbox"
                      checked={effectiveProvider.myob_enabled}
                      onChange={e => setProviderField('myob_enabled', e.target.checked)}
                    />
                    <span>Enable MYOB Sandbox Sync</span>
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">MYOB Company File Name</span>
                    <input
                      id="provider-myob-file-name"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.myob_company_file_name || ''}
                      onChange={e => setProviderField('myob_company_file_name', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">MYOB Sandbox File ID</span>
                    <input
                      id="provider-myob-file-id"
                      type="text"
                      maxLength={120}
                      value={effectiveProvider.myob_company_file_id || ''}
                      onChange={e => setProviderField('myob_company_file_id', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">MYOB Client ID</span>
                    <input
                      id="provider-myob-client-id"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.myob_client_id || ''}
                      onChange={e => setProviderField('myob_client_id', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <div className="block sm:col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="provider-myob-secret" className="text-(--cabms-text-secondary)">
                        MYOB Client Secret (Write-Only)
                      </label>
                      {providerConfig?.has_myob_secret && !clearMyobSecret && (
                        <span className="text-[10px] font-mono text-emerald-400">
                          Configured (server-side only)
                        </span>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        id="provider-myob-secret"
                        type="password"
                        autoComplete="new-password"
                        placeholder={providerConfig?.has_myob_secret ? '•••••••• (enter new value to rotate)' : 'Enter MYOB sandbox client secret'}
                        value={myobSecretInput}
                        onChange={e => { setMyobSecretInput(e.target.value); setClearMyobSecret(false); }}
                        className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                      />
                      {providerConfig?.has_myob_secret && (
                        <button
                          type="button"
                          onClick={() => { setClearMyobSecret(v => !v); setMyobSecretInput(''); }}
                          className="px-2.5 py-1 rounded border border-(--cabms-border-base) text-[11px] shrink-0"
                        >
                          {clearMyobSecret ? 'Undo Clear' : 'Clear'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Calendar Mapping */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-(--cabms-text-primary)">Calendar Mapping &amp; Holiday Policy</h4>
                  <button
                    type="button"
                    data-testid="test-calendar-btn"
                    disabled={providerTesting !== null || providerLoading}
                    onClick={() => void handleTestProvider('calendar')}
                    className="px-3 py-1.5 text-xs font-semibold rounded border border-(--cabms-border-base) cabms-surface-subtle hover:border-(--cabms-border-focus)"
                  >
                    {providerTesting === 'calendar' ? 'Testing...' : 'Test Calendar (Sandbox)'}
                  </button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Primary Hub Calendar</span>
                    <input
                      id="provider-primary-calendar"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.primary_hub_calendar || ''}
                      onChange={e => setProviderField('primary_hub_calendar', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Fleet Calendar Name</span>
                    <input
                      id="provider-fleet-calendar"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.fleet_calendar_name || ''}
                      onChange={e => setProviderField('fleet_calendar_name', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Fleet Calendar ID</span>
                    <input
                      id="provider-fleet-calendar-id"
                      type="text"
                      maxLength={150}
                      value={effectiveProvider.fleet_calendar_id || ''}
                      onChange={e => setProviderField('fleet_calendar_id', e.target.value || null)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    />
                  </label>
                  <label className="block">
                    <span className="text-(--cabms-text-secondary) block mb-1">Regional Holiday Policy</span>
                    <select
                      id="provider-holiday-region"
                      value={effectiveProvider.holiday_region}
                      onChange={e => setProviderField('holiday_region', e.target.value)}
                      className="w-full px-3 py-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base)"
                    >
                      <option value="brisbane">Brisbane Metro (Ekka)</option>
                      <option value="gold_coast">Gold Coast (Show Day)</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className="pt-2 flex items-center gap-3">
                <button
                  type="submit"
                  data-testid="save-providers-btn"
                  disabled={providerSaving || providerLoading}
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded text-sm transition-colors shadow-sm"
                >
                  {providerSaving ? 'Saving Provider Config...' : 'Save Provider Configuration'}
                </button>
                <span className="text-[11px] font-mono text-(--cabms-text-secondary)">
                  v{providerConfig?.version ?? 1}
                </span>
              </div>

              {providerAudit.length > 0 && (
                <div className="pt-4 border-t border-(--cabms-border-base) space-y-2" data-testid="provider-audit-log">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-(--cabms-text-secondary)">
                    Redacted Provider Audit Log
                  </h4>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto text-[11px] font-mono">
                    {providerAudit.slice(0, 10).map(ev => (
                      <div key={ev.id} className="p-2 rounded bg-(--cabms-surface-subtle) border border-(--cabms-border-base) flex flex-col gap-0.5">
                        <div className="flex justify-between text-(--cabms-text-primary)">
                          <span>{ev.event_type} ({ev.provider_type})</span>
                          <span>v{ev.old_version} -&gt; v{ev.new_version}</span>
                        </div>
                        <div className="text-(--cabms-text-secondary) truncate">
                          {ev.new_values}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </form>
          )}
      </div>
    </div>
  );
};
