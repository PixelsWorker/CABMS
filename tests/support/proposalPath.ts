import { join } from 'node:path';

export function proposalPath(...parts: string[]): string {
  const root = process.env.CABMS_PROPOSALS_DIR || 'D:/Projects/CABMS/evidence/paar-p0-mode-a/proposals';
  return join(root, ...parts);
}
