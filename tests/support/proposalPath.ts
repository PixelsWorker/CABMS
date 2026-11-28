import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PROPOSALS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'proposals');

export function proposalPath(...parts: string[]): string {
  const root = process.env.CABMS_PROPOSALS_DIR?.trim() || DEFAULT_PROPOSALS_DIR;
  return join(root, ...parts);
}
