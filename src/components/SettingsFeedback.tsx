import React from 'react';
import type { SettingsResource } from '../services/useSettingsResource.ts';

export function SettingsFeedback({ resource }: { resource: SettingsResource }) {
  const labels: Record<string, string> = {
    trading_name: 'Trading name', tagline: 'Tagline', accent_color: 'Brand accent', preferred_preset: 'Appearance preset',
    contact_email: 'Operational email', contact_phone: 'Operational phone', operational_address: 'Operational address', operating_hours: 'Operating hours',
    legal_issuer_name: 'Legal issuer', abn: 'ABN', electrical_licence: 'Electrical licence', acma_cabler_registration: 'ACMA registration', qbcc_licence: 'QBCC licence',
  };
  const legalIdentifiers = new Set(['abn', 'electrical_licence', 'acma_cabler_registration', 'qbcc_licence']);
  const comparisons = resource.row ? Object.keys(resource.draft).filter(key => Object.hasOwn(labels, key)).map(key => {
    const value = resource.row![key as keyof typeof resource.row];
    return { key, label: labels[key], value: legalIdentifiers.has(key) ? (value ? 'Value present (masked)' : 'Not set') : value == null || value === '' ? 'Not set' : String(value) };
  }) : [];
  return <div aria-live="polite" className="text-sm space-y-2">
    {resource.loading && <p role="status">Loading current database values...</p>}
    {resource.saving && <p role="status">Saving...</p>}
    {resource.message && <p role={resource.error ? 'alert' : 'status'}>{resource.message}</p>}
    {resource.reviewRequired && <button type="button" disabled={resource.loading || resource.saving} onClick={() => void resource.reload()} className="px-3 py-2 cabms-surface-subtle rounded border cabms-border">Review latest server values and retain edits</button>}
    {comparisons.length > 0 && <details><summary>Last confirmed server values for edited fields</summary>
      <dl className="space-y-2">{comparisons.map(item => <div key={item.key}><dt className="font-semibold">{item.label}</dt><dd className="wrap-break-word">{item.value}</dd></div>)}</dl>
    </details>}
  </div>;
}
