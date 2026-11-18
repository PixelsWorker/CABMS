/**
 * CABMS PAAR-P0 — Explicit Gated Runner for Disposable workerd & D1 Integration Tests
 *
 * Sets CABMS_DISPOSABLE_D1_TEST=1 in the child environment to authorize execution
 * of the real local workerd & Miniflare D1 integration test suite (W1–W8).
 */
import { spawnSync } from 'node:child_process';

process.env.CABMS_DISPOSABLE_D1_TEST = '1';
const result = spawnSync('npx', ['tsx', '--test', 'tests/workerd/p0_disposable_d1_integration.test.ts'], {
  stdio: 'inherit',
  shell: true,
  env: process.env,
});
process.exit(result.status ?? 1);
