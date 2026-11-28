import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  loadWindowsLocalTargetConfig,
  validateWindowsLocalTarget,
  type WindowsLocalTargetConfig,
} from '../scripts/p0/windowsLocalTarget.ts';

function syntheticTarget(): WindowsLocalTargetConfig {
  return {
    root: 'C:\\cabms-win-local-fixture',
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
    assert.throws(
      () => loadWindowsLocalTargetConfig({ ...validEnv, [key]: '' }),
      new RegExp(`Missing or blank ${key}`)
    );
    assert.throws(
      () => loadWindowsLocalTargetConfig({ ...validEnv, [key]: '   ' }),
      new RegExp(`Missing or blank ${key}`)
    );
    const omitted = { ...validEnv };
    delete (omitted as Record<string, string | undefined>)[key];
    assert.throws(() => loadWindowsLocalTargetConfig(omitted), new RegExp(`Missing or blank ${key}`));
  }

  const malformedCases: Array<[Record<string, string>, RegExp]> = [
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: '\\\\server\\share\\cabms' }, /Malformed CABMS_WINDOWS_LOCAL_ROOT/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: 'https://example.invalid/db' }, /Malformed CABMS_WINDOWS_LOCAL_ROOT/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_ROOT: 'C:\\cabms\\..\\escape' }, /Malformed CABMS_WINDOWS_LOCAL_ROOT/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_DATABASE: '../other.sqlite' }, /Malformed CABMS_WINDOWS_LOCAL_DATABASE/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_DATABASE: 'not-sqlite.db' }, /Malformed CABMS_WINDOWS_LOCAL_DATABASE/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_UID: 'bad' }, /Malformed CABMS_WINDOWS_LOCAL_UID/],
    [{ ...validEnv, CABMS_WINDOWS_LOCAL_EMAIL: 'not-an-email' }, /Malformed CABMS_WINDOWS_LOCAL_EMAIL/],
  ];
  for (const [badEnv, expectedErr] of malformedCases) {
    assert.throws(() => loadWindowsLocalTargetConfig(badEnv), expectedErr);
  }
});

test('Windows local target guard enforces platform and exact rejection reasons', () => {
  const expected = syntheticTarget();
  const valid = {
    root: expected.root,
    database: expected.database,
    uid: expected.uid,
    email: expected.email,
    local: true,
  };

  if (process.platform !== 'win32') {
    assert.throws(() => validateWindowsLocalTarget(valid, expected), /Windows local target required/);
    return;
  }

  assert.doesNotThrow(() => validateWindowsLocalTarget(valid, expected));

  const negativeCases: Array<[Partial<typeof valid>, RegExp]> = [
    [{ root: 'C:\\cabms-other-root' }, /Unexpected local database root/],
    [{ root: '\\\\unc\\share\\cabms' }, /Invalid local database root/],
    [{ root: 'https://example.invalid' }, /Invalid local database root/],
    [{ root: `${expected.root}\\..\\escape` }, /Invalid local database root/],
    [{ database: 'other.sqlite' }, /Unexpected local database target/],
    [{ uid: 'wrong_uid_0001' }, /Unexpected local identity/],
    [{ email: 'wrong@example.invalid' }, /Unexpected local identity/],
    [{ local: false }, /Unexpected local database root/],
  ];
  for (const [change, expectedErr] of negativeCases) {
    assert.throws(() => validateWindowsLocalTarget({ ...valid, ...change }, expected), expectedErr);
  }
});
