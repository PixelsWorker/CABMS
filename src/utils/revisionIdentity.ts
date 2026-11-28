/** Server transitions require an actual pending revision ID, never a display version. */
export function pendingRevisionId(revisions: ReadonlyArray<{id?:string;status?:string;version?:string}> | undefined, status: 'DRAFT'|'REVIEW'): string | null {
  const pending = revisions?.find(revision => revision.status === status);
  return typeof pending?.id === 'string' && pending.id.trim() ? pending.id : null;
}

export function publishedTemplateFromServer(row: {current_revision_id?:unknown;current_version?:unknown;current_content?:unknown;revision_status?:unknown}) {
  if (typeof row.current_revision_id !== 'string' || !row.current_revision_id || typeof row.current_version !== 'string' || !row.current_version || typeof row.current_content !== 'string' || row.revision_status !== 'PUBLISHED') return null;
  return {currentRevisionId:row.current_revision_id,currentVersion:row.current_version,content:row.current_content,activeStatus:'PUBLISHED' as const};
}
