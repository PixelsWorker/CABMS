import { validateSignedSnapshot } from './cabmsLogic.ts';

/** Preview-only display helper. This is not authorization, legal validation or evidence verification. */
export type PreviewFormType = 'JSA' | 'ELECTRICAL' | 'SMOKE_ALARM' | 'TCA1' | 'TCA2';

/** Requirements are supplied by the simulated job; no universal form policy is inferred. */
export function getPendingPreviewForms(
  required: readonly PreviewFormType[],
  signedOff: Partial<Record<PreviewFormType, boolean>>,
): PreviewFormType[] {
  return [...new Set(required)].filter(form => signedOff[form] !== true);
}

/** A simulated flag alone is insufficient if its job-bound preview snapshot is invalid. */
export function isValidPreviewSignOff(form: PreviewFormType, jobId: string, signedOff: boolean, snapshot?: string): boolean {
  return signedOff && validateSignedSnapshot(snapshot, jobId, form).valid;
}

/** A recorded preview sign-off with invalid data needs review, not another sign-off. */
export function getInvalidPreviewForms(
  required: readonly PreviewFormType[],
  signedOff: Partial<Record<PreviewFormType, boolean>>,
  valid: Partial<Record<PreviewFormType, boolean>>,
): PreviewFormType[] {
  return [...new Set(required)].filter(form => signedOff[form] === true && valid[form] !== true);
}
