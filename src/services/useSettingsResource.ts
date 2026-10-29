import { useEffect, useRef, useState } from 'react';
import { useG01Session } from '../context/G01Session.tsx';
import { apiGetLegalDetails, apiGetWorkspaceSettings, apiPatchLegalDetails, apiPatchWorkspaceSettings, type ApiResponse } from './g01Client.ts';
import type { EditableLegalDetails, EditableWorkspaceSettings, LegalIssuerRow, WorkspaceSettingsRow } from '../../contracts/settings.ts';

type Row = WorkspaceSettingsRow | LegalIssuerRow;
type Patch = Partial<EditableWorkspaceSettings & EditableLegalDetails>;
interface Entry {
  row?: Row;
  etag?: string;
  draft: Patch;
  revision: number;
  loading: boolean;
  saving: boolean;
  message: string;
  error: boolean;
  reviewRequired: boolean;
}
const empty = (): Entry => ({ draft: {}, revision: 0, loading: false, saving: false, message: '', error: false, reviewRequired: false });

/** Per-user/workspace/resource drafts; responses never clear edits made after submission. */
export function useSettingsResource(kind: 'settings' | 'legal-details') {
  const session = useG01Session();
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const key = session?.profile && session.workspaceId ? `${session.profile.user.id}:${session.workspaceId}` : '';
  const workspace = session?.workspaceId;
  const entries = useRef<Record<string, Entry>>({});
  const loadGenerations = useRef<Record<string, number>>({});
  const saveGenerations = useRef<Record<string, number>>({});
  const alive = useRef(true);
  const [, render] = useState(0);
  const state = entries.current[key] || empty();
  const update = (target: string, change: Partial<Entry>) => {
    if (!alive.current) return;
    entries.current[target] = { ...(entries.current[target] || empty()), ...change };
    render(n => n + 1);
  };
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const allowed = new Set(session?.profile?.memberships.map(m => `${session.profile!.user.id}:${m.workspace_id}`) || []);
    for (const cached of Object.keys(entries.current)) if (!allowed.has(cached)) delete entries.current[cached];
  }, [session?.profile]);
  const handleFailure = (target: string, response: ApiResponse<Row>) => {
    const status = response.status;
    const message = status === 412 ? 'Settings changed on the server. Review the latest version before saving your retained edits.'
      : status === 428 ? 'A current version is required. Review the latest values before retrying.'
      : status === 401 ? 'Your session expired. Sign in again.'
      : status === 403 ? 'You no longer have permission to access these settings.'
      : status === 404 ? 'These settings are not available for this workspace.'
      : status === 422 ? 'Correct the highlighted validation errors before saving.'
      : 'The save outcome could not be confirmed. Review the latest server values before retrying.';
    const details = status === 422 ? (response.problem?.errors || []).map(e => `${e.pointer}: ${e.message}`).join(' ') : '';
    const reqRef = response.problem?.request_id ? `(Ref: ${response.problem.request_id})` : '';
    update(target, { error: true, message: `${message} ${details} ${reqRef}`.trim(), reviewRequired: status !== 422,
      ...(status === 403 || status === 404 ? { row: undefined, etag: undefined, draft: {} } : {}) });
    if (status === 401) sessionRef.current?.invalidate();
  };
  const load = async (review = false) => {
    const currentSession = sessionRef.current;
    if (!key || !workspace || !currentSession) return;
    const target = key;
    const gen = (loadGenerations.current[target] || 0) + 1;
    loadGenerations.current[target] = gen;
    update(target, { loading: true, message: '', error: false });
    try {
      const response = await (kind === 'settings' ? apiGetWorkspaceSettings : apiGetLegalDetails)(workspace, await currentSession.token());
      if (!alive.current || loadGenerations.current[target] !== gen) return;
      if (response.ok && response.data && response.etag && response.data.workspace_id === workspace && Number.isSafeInteger(response.data.version) && response.etag === `"${response.data.version}"`) {
        update(target, { row: response.data, etag: response.etag, reviewRequired: false,
          message: review ? 'Latest server version loaded. Compare it with your retained edits, then save deliberately.' : '' });
      } else handleFailure(target, response);
    } catch {
      if (!alive.current || loadGenerations.current[target] !== gen) return;
      update(target, { error: true, message: 'Unable to load settings. Check your connection and retry.', reviewRequired: true });
    } finally {
      if (alive.current && loadGenerations.current[target] === gen) {
        update(target, { loading: false });
      }
    }
  };
  useEffect(() => { if (key && !entries.current[key]?.row) void load(); }, [key, kind]);
  const setField = (field: string, value: string | null) => {
    const entry = entries.current[key] || empty();
    update(key, { draft: { ...entry.draft, [field]: value }, revision: entry.revision + 1, message: '', error: false });
  };
  const save = async () => {
    const entry = entries.current[key];
    const currentSession = sessionRef.current;
    if (!entry?.row || !entry.etag || entry.saving || entry.loading || entry.reviewRequired || !workspace || !currentSession) return;
    const target = key;
    const revision = entry.revision;
    const gen = (saveGenerations.current[target] || 0) + 1;
    saveGenerations.current[target] = gen;
    update(target, { saving: true, message: '', error: false });
    try {
      const token = await currentSession.token();
      const response = kind === 'settings'
        ? await apiPatchWorkspaceSettings(workspace, token, entry.etag, entry.draft)
        : await apiPatchLegalDetails(workspace, token, entry.etag, entry.draft);
      if (!alive.current || saveGenerations.current[target] !== gen) return;
      if (response.ok && response.data && response.etag && response.data.workspace_id === workspace && Number.isSafeInteger(response.data.version) && response.etag === `"${response.data.version}"`) {
        const unchangedDraft = entries.current[target]?.revision === revision;
        const remainingDraft = Object.fromEntries(Object.entries(entries.current[target]?.draft || {}).filter(([field, value]) => entry.draft[field as keyof Patch] !== value));
        update(target, { row: response.data, etag: response.etag, draft: unchangedDraft ? {} : remainingDraft,
          message: unchangedDraft ? 'Settings saved to the database.' : 'Submitted changes saved. Newer edits remain unsaved.', reviewRequired: false });
      } else handleFailure(target, response);
    } catch {
      if (!alive.current || saveGenerations.current[target] !== gen) return;
      update(target, { error: true, reviewRequired: true, message: 'Save outcome uncertain. Your edits are retained. Review the latest server values before retrying.' });
    } finally {
      if (alive.current && saveGenerations.current[target] === gen) {
        update(target, { saving: false });
      }
    }
  };
  return { ...state, value: state.row ? { ...state.row, ...state.draft } : undefined, setField, save, reload: () => load(true),
    dirty: Object.keys(state.draft).length > 0, active: !!session };
}

export type SettingsResource = ReturnType<typeof useSettingsResource>;
