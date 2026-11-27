import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {
  loadWindowsLocalTargetConfig,
  validateWindowsLocalTarget,
  type WindowsLocalTargetConfig,
} from '../scripts/p0/windowsLocalTarget.ts';

function syntheticTarget(): WindowsLocalTargetConfig {
  const root =
    process.platform === 'win32'
      ? path.win32.join(os.tmpdir(), 'cabms-win-local-fixture')
      : 'C:\\cabms-win-local-fixture';
  return {
    root,
    database: 'fixture-local.sqlite',
    uid: 'fixture_uid_0001',
    email: 'fixture@example.invalid',
  };
}

test('loadWindowsLocalTargetConfig fails closed on missing, blank, or malformed config', () => {
  const target = syntheticTarget();
  const validEnv = {
    CABMS_WINDOWS_LOCAL_ROOT: target.root,
    CABMS_WINDOWS_LOCAL_DATABASE: target.database,
    CABMS_WINDOWS_LOCAL_UID: target.uid,
    CABMS_WINDOWS_LOCAL_EMAIL: target.email,
  };
  assert.deepEqual(loadWindowsLocalTargetConfig(validEnv), {
    ...target,
    root: path.win32.normalize(target.root),
  });

  for (const key of [
    'CABMS_WINDOWS_LOCAL_ROOT',
    'CABMS_WINDOWS_LOCAL_DATABASE',
    'CABMS_WINDOWS_LOCAL_UID',
    'CABMS_WINDOWS_LOCAL_EMAIL',
  ]) {
    assert.throws(() => loadWindowsLocalTargetConfig({ ...validEnv, [key]: '' }));
    assert.throws(() => loadWindowsLocalTargetConfig({ ...validEnv, [key]: '   ' }));
    const omitted = { ...validEnv };
    delete (omitted as Record<string, string | undefined>)[key];
    assert.throws(() => loadWindowsLocalTargetConfig(omitted));
  }

  for (const badEnv of [
    { ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: '\\\\server\\share\\cabms' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: 'https://example.invalid/db' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: 'C:\\cabms\\..\\escape' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_DATABASE: '../other.sqlite' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_DATABASE: 'not-sqlite.db' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_UID: 'bad' },
    { ...validEnv, CABMS_WINDOWS_LOCAL_EMAIL: 'not-an-email' },
  ]) {
    assert.throws(() => loadWindowsLocalTargetConfig(badEnv));
  }
});

test('Windows local enrollment rejects other targets, databases, paths, and identities before access', () => {
  const expected = syntheticTarget();
  const valid = {
    root: expected.root,
    database: expected.database,
    uid: expected.uid,
    email: expected.email,
    local: true,
  };
  if (process.platform === 'win32') {
    assert.doesNotThrow(() => validateWindowsLocalTarget(valid, expected));
  }
  for (const change of [
    { root: 'C:\\cabms-other-root' },
    { root: '\\\\unc\\share\\cabms' },
    { root: 'https://example.invalid' },
    { root: `${expected.root}\\..\\escape` },
    { database: 'other.sqlite' },
    { uid: 'wrong_uid_0001' },
    { email: 'wrong@example.invalid' },
    { local: false },
  ]) {
    assert.throws(() => validateWindowsLocalTarget({ ...valid, ...change }, expected));
  }
});
