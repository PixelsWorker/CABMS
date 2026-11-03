import React from 'react';
import { useCabms } from '../context/CabmsContext.tsx';
import { useSettingsResource } from '../services/useSettingsResource.ts';
import { SettingsFeedback } from '../components/SettingsFeedback.tsx';
import type { LegalIssuerRow } from '../../contracts/settings.ts';

/** Live legal resource uses the existing profile card, field labels and responsive grid. */
export function LegalDetailsForm() {
  const { persona, brands, activeBrandId, setActiveBrandId } = useCabms();
  const resource = useSettingsResource('legal-details');
  const values = resource.value as LegalIssuerRow | undefined;
  const fields = [
    ['legal_issuer_name', 'Legal Document Issuer (Entity Name)'],
    ['abn', 'Australian Business Number (ABN)'],
    ['electrical_licence', 'Electrical Contractor Licence'],
    ['acma_cabler_registration', 'ACMA Registered Cabler No.'],
    ['qbcc_licence', 'QBCC Licence'],
  ] as const;
  return <div className="space-y-6">
    <div className="cabms-card p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b cabms-border pb-3">
        <h2 className="text-base font-bold">Business Profiles & Legal Issuers</h2>
        <div className="flex flex-wrap gap-2">{Object.values(brands).map(b => <button key={b.id} type="button" aria-pressed={b.id === activeBrandId} onClick={() => setActiveBrandId(b.id)} className="px-3 py-2 cabms-surface-subtle rounded border cabms-border">{b.name}</button>)}</div>
      </div>
      <form onSubmit={e => { e.preventDefault(); void resource.save(); }} className="space-y-4 text-xs">
        <SettingsFeedback resource={resource} />
        <fieldset disabled={persona !== 'super_admin' || !resource.row || resource.loading} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{fields.map(([key, label]) => <label key={key} htmlFor={`legal-${key}`} className="text-(--cabms-text-secondary) block font-semibold">
            {label}<input id={`legal-${key}`} type="text" required={key === 'legal_issuer_name'} maxLength={key === 'legal_issuer_name' ? 150 : 100} value={values?.[key] || ''} onChange={e => resource.setField(key, e.target.value || (key === 'legal_issuer_name' ? '' : null))} className="w-full cabms-card-subtle rounded p-2 text-(--cabms-text-primary)" />
          </label>)}</div>
          <button type="submit" disabled={resource.saving || resource.reviewRequired || !resource.dirty} className="px-4 py-2 bg-purple-600 text-white rounded font-semibold">Save Legal Details</button>
        </fieldset>
        {persona !== 'super_admin' && <p>Legal details are read-only. Super Admin authority is required to save.</p>}
      </form>
    </div>
    <div className="cabms-card p-4 text-sm">MYOB, Email and Calendar integrations are deferred. No provider credentials or connections are changed here.</div>
  </div>;
}
