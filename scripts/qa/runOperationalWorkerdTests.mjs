import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const suites = [
  'tests/workerd/c1_paired_job_proposals.test.ts',
  'tests/workerd/f06_concurrency.test.ts',
];

const result = spawnSync(
  process.execPath,
  [tsxCli, '--test', ...suites],
  {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      CABMS_DISPOSABLE_D1_TEST: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
  }
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
