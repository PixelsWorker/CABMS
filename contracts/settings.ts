/**
 * CABMS G01 Canonical Settings & Audit Contracts
 * Shared across React/Vite Frontend and Cloudflare Worker Backend.
 */

export interface WorkspaceSettingsRow {
  workspace_id: string;
  trading_name: string;
  tagline: string | null;
  primary_color: string;
  accent_color: string;
  logo_glyph: string;
  preferred_preset: string;
  contact_email: string | null;
  contact_phone: string | null;
  operational_address: string | null;
  operating_hours: string | null;
  holiday_region: string;
  review_url: string | null;
  calendar_mapping_name: string | null;
  quote_template_name: string | null;
  invoice_template_name: string | null;
  version: number;
  transition_nonce: string | null;
  updated_at: string;
}

export interface LegalIssuerRow {
  id: string;
  workspace_id: string;
  legal_issuer_name: string;
  abn: string | null;
  electrical_licence: string | null;
  acma_cabler_registration: string | null;
  qbcc_licence: string | null;
  version: number;
  transition_nonce: string | null;
  updated_at: string;
}

export interface SettingsAuditEventRow {
  id: string;
  workspace_id: string;
  resource_type: 'workspace_settings' | 'legal_issuer';
  resource_id: string;
  event_type: 'SETTINGS_UPDATED' | 'LEGAL_DETAILS_UPDATED';
  old_version: number;
  new_version: number;
  old_values: string; // JSON string with redacted sensitive data
  new_values: string; // JSON string with redacted sensitive data
  actor_user_id: string;
  request_id: string;
  transition_nonce: string;
  created_at: string;
}

export type EditableWorkspaceSettings = Pick<
  WorkspaceSettingsRow,
  | 'trading_name'
  | 'tagline'
  | 'accent_color'
  | 'preferred_preset'
  | 'contact_email'
  | 'contact_phone'
  | 'operational_address'
  | 'operating_hours'
>;

export type EditableLegalDetails = Pick<
  LegalIssuerRow,
  | 'legal_issuer_name'
  | 'abn'
  | 'electrical_licence'
  | 'acma_cabler_registration'
  | 'qbcc_licence'
>;

export const ALLOWED_SETTINGS_KEYS: (keyof EditableWorkspaceSettings)[] = [
  'trading_name',
  'tagline',
  'accent_color',
  'preferred_preset',
  'contact_email',
  'contact_phone',
  'operational_address',
  'operating_hours',
];

export const ALLOWED_LEGAL_KEYS: (keyof EditableLegalDetails)[] = [
  'legal_issuer_name',
  'abn',
  'electrical_licence',
  'acma_cabler_registration',
  'qbcc_licence',
];

export type MutationOutcome =
  | { status: 'SUCCESS'; newVersion: number; updated: WorkspaceSettingsRow | LegalIssuerRow; auditEventId: string; reqNonce: string }
  | { status: 'NO_OP'; current: WorkspaceSettingsRow | LegalIssuerRow; version: number }
  | { status: 'PRECONDITION_FAILED'; currentVersion?: number }
  | { status: 'NOT_FOUND' };

/**
 * RFC 9457 Problem Details Contract
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code: string;
  retryable: boolean;
  request_id: string;
  errors?: Array<{
    pointer: string;
    code: string;
    message: string;
  }>;
}
