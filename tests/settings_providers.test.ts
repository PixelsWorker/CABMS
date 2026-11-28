/**
 * CABMS System & Workspace Provider Settings Tests
 *
 * Verifies:
 * - Migration 0019 schema & synthetic seed rows
 * - Strict owner_admin / super_admin RBAC (office_staff, technician, non-member rejected 403; unauthenticated 401)
 * - Strong ETag + If-Match optimistic concurrency (428, 422, 412)
 * - D1 persistence for SMTP sender identity, MYOB sandbox config, and calendar mapping
 * - Server-side-only secrets (stored in workspace_provider_secrets, NEVER returned to client, redacted in audit logs)
 * - Simulated/sandbox provider connection tests (clearly labeled simulated: true)
 * - WorkspaceSettingsView JSDOM integration for live D1 provider settings, secret handling, sandbox tests, and audit log
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createLocalD1Database, D1Database } from '../backend/db/d1.ts';
import { G01_MIGRATION_MANIFEST } from '../backend/db/migrate.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';
import { handleSettingsProviders } from '../backend/workers/routes/settingsProviders.ts';
import { createWorker } from '../backend/index.ts';
import { Env } from '../backend/types.ts';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { WorkspaceSettingsView } from '../src/views/WorkspaceSettingsView.tsx';
import { setApiBase, resetApiBase } from '../src/services/g01Client.ts';

const migrationsDir = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations');

async function initProviderTestDb(db: D1Database): Promise<void> {
  const readSql = (name: string) => readFileSync(resolve(migrationsDir, name), 'utf8');
  for (const [name] of G01_MIGRATION_MANIFEST) {
    if (name === '0006_g01_privileged_identity_approvals.sql') {
      await db.exec(`BEGIN TRANSACTION;\n${readSql(name)}\n${readSql('0007_g01_bootstrap_completion.sql')}\nCOMMIT;`);
      continue;
    }
    if (name === '0007_g01_bootstrap_completion.sql') continue;
    await db.exec(readSql(name));
  }
  await db.exec(readSql('0019_settings_providers.sql'));
  await installG01TestAuthFixtures(db);
}

describe('System & Workspace Provider Settings (D1 + RBAC + Secrets + Sandbox Tests)', () => {
  let db: D1Database;
  let env: Env;
  let fixture: Awaited<ReturnType<typeof createFirebaseFixture>>;
  let authService: ReturnType<typeof createAuthenticationService>;

  let superAdminAuth: string;
  let ownerAdminAuth: string;
  let officeStaffAuth: string;
  let technicianAuth: string;

  beforeEach(async () => {
    db = createLocalD1Database(':memory:');
    await initProviderTestDb(db);
    fixture = await createFirebaseFixture();
    authService = createAuthenticationService(fixture.transport);
    env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

    superAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.superAdmin.uid, G01_TEST_AUTH.superAdmin.email)}`;
    ownerAdminAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email)}`;
    officeStaffAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email)}`;
    technicianAuth = `Bearer ${await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email)}`;
  });

  afterEach(() => {
    mock.restoreAll();
  });

  const callProviderRoute = (
    workspaceId: string,
    subAction: string | undefined,
    method: string,
    headers: Record<string, string> = {},
    body?: unknown
  ) => {
    const suffix = subAction ? `/${subAction}` : '';
    const req = new Request(`http://localhost/api/v1/workspaces/${workspaceId}/provider-settings${suffix}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return handleSettingsProviders(req, env, workspaceId, subAction, `req_${crypto.randomUUID()}`, authService);
  };

  it('rejects unauthenticated requests with 401 and enforces strict owner_admin/super_admin RBAC (403 for staff/tech/non-member)', async () => {
    const unauth = await callProviderRoute('solarcell', undefined, 'GET');
    assert.equal(unauth.status, 401);

    for (const token of [officeStaffAuth, technicianAuth]) {
      const getRes = await callProviderRoute('solarcell', undefined, 'GET', { Authorization: token });
      assert.equal(getRes.status, 403);

      const patchRes = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: token, 'If-Match': '"1"' }, { sender_name: 'X' });
      assert.equal(patchRes.status, 403);

      const testRes = await callProviderRoute('solarcell', 'test', 'POST', { Authorization: token }, { provider: 'smtp' });
      assert.equal(testRes.status, 403);

      const auditRes = await callProviderRoute('solarcell', 'audit', 'GET', { Authorization: token });
      assert.equal(auditRes.status, 403);
    }

    // owner_admin for solarcell cannot access cctv
    const crossWs = await callProviderRoute('cctv', undefined, 'GET', { Authorization: ownerAdminAuth });
    assert.equal(crossWs.status, 403);

    // owner_admin and super_admin can read solarcell
    const oaGet = await callProviderRoute('solarcell', undefined, 'GET', { Authorization: ownerAdminAuth });
    assert.equal(oaGet.status, 200);
    assert.equal(oaGet.headers.get('ETag'), '"1"');

    const saGet = await callProviderRoute('solarcell', undefined, 'GET', { Authorization: superAdminAuth });
    assert.equal(saGet.status, 200);
  });

  it('enforces strong If-Match preconditions (428, 422, 412) and rejects unknown fields', async () => {
    const missing = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: ownerAdminAuth }, { sender_name: 'New' });
    assert.equal(missing.status, 428);

    const weak = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: ownerAdminAuth, 'If-Match': 'W/"1"' }, { sender_name: 'New' });
    assert.equal(weak.status, 422);

    const wildcard = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: ownerAdminAuth, 'If-Match': '*' }, { sender_name: 'New' });
    assert.equal(wildcard.status, 422);

    const stale = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: ownerAdminAuth, 'If-Match': '"99"' }, { sender_name: 'New' });
    assert.equal(stale.status, 412);

    const unknown = await callProviderRoute('solarcell', undefined, 'PATCH', { Authorization: ownerAdminAuth, 'If-Match': '"1"' }, { rogue_field: 'x' });
    assert.equal(unknown.status, 422);
  });

  it('persists SMTP, MYOB sandbox, calendar mapping, keeps secrets server-side only, and writes redacted audit logs', async () => {
    const secretSmtp = 'super-secret-smtp-password-999';
    const secretMyob = 'super-secret-myob-token-888';

    const patchRes = await callProviderRoute(
      'solarcell',
      undefined,
      'PATCH',
      { Authorization: ownerAdminAuth, 'If-Match': '"1"' },
      {
        sender_name: 'Solarcell Dispatch',
        sender_email: 'dispatch@solarcell.example.invalid',
        smtp_host: 'smtp.relay.example.invalid',
        smtp_port: 2525,
        smtp_username: 'relay_user',
        smtp_transport_mode: 'smtp_relay',
        smtp_secret: secretSmtp,
        myob_enabled: true,
        myob_company_file_id: 'myob-sbx-001',
        myob_company_file_name: 'Solarcell MYOB Sandbox',
        myob_client_id: 'client-id-123',
        myob_client_secret: secretMyob,
        fleet_calendar_name: 'Solarcell North Crew',
        holiday_region: 'gold_coast',
      }
    );
    assert.equal(patchRes.status, 200);
    assert.equal(patchRes.headers.get('ETag'), '"2"');

    const rawText = await patchRes.text();
    assert.doesNotMatch(rawText, /super-secret-smtp-password-999/);
    assert.doesNotMatch(rawText, /super-secret-myob-token-888/);

    const updated = JSON.parse(rawText);
    assert.equal(updated.has_smtp_secret, true);
    assert.equal(updated.has_myob_secret, true);
    assert.equal(updated.sender_name, 'Solarcell Dispatch');
    assert.equal(updated.smtp_port, 2525);
    assert.equal(updated.myob_company_file_id, 'myob-sbx-001');
    assert.equal(updated.holiday_region, 'gold_coast');

    // Verify secrets exist in workspace_provider_secrets table server-side
    const secretRows = await db
      .prepare('SELECT secret_key, secret_value FROM workspace_provider_secrets WHERE workspace_id = ?')
      .bind('solarcell')
      .all<{ secret_key: string; secret_value: string }>();
    assert.equal(secretRows.results.length, 2);

    // Verify GET never returns secrets
    const getRes = await callProviderRoute('solarcell', undefined, 'GET', { Authorization: superAdminAuth });
    const getText = await getRes.text();
    assert.doesNotMatch(getText, /super-secret-smtp-password-999/);
    assert.doesNotMatch(getText, /super-secret-myob-token-888/);

    // Verify audit log is redacted
    const auditRes = await callProviderRoute('solarcell', 'audit', 'GET', { Authorization: ownerAdminAuth });
    assert.equal(auditRes.status, 200);
    const auditText = await auditRes.text();
    assert.doesNotMatch(auditText, /super-secret-smtp-password-999/);
    assert.doesNotMatch(auditText, /super-secret-myob-token-888/);
    assert.doesNotMatch(auditText, /dispatch@solarcell\.example\.invalid/);
    assert.doesNotMatch(auditText, /relay_user/);
    assert.match(auditText, /\[REDACTED\]/);

    // Clear SMTP secret with null
    const clearRes = await callProviderRoute(
      'solarcell',
      undefined,
      'PATCH',
      { Authorization: superAdminAuth, 'If-Match': '"2"' },
      { smtp_secret: null }
    );
    assert.equal(clearRes.status, 200);
    const cleared = await clearRes.json();
    assert.equal(cleared.has_smtp_secret, false);
    assert.equal(cleared.has_myob_secret, true);
  });

  it('executes clearly labeled simulated sandbox connection tests and persists test status & audit', async () => {
    const smtpTest = await callProviderRoute('solarcell', 'test', 'POST', { Authorization: ownerAdminAuth }, { provider: 'smtp' });
    assert.equal(smtpTest.status, 200);
    const smtpBody = await smtpTest.json();
    assert.equal(smtpBody.simulated, true);
    assert.equal(smtpBody.mode, 'sandbox_simulation');
    assert.equal(smtpBody.ok, true);
    assert.equal(smtpBody.status, 'PASSED_SANDBOX');
    assert.match(smtpBody.message, /SIMULATED SANDBOX TEST/);

    const myobTest = await callProviderRoute('solarcell', 'test', 'POST', { Authorization: ownerAdminAuth }, { provider: 'myob' });
    assert.equal(myobTest.status, 200);
    const myobBody = await myobTest.json();
    assert.equal(myobBody.simulated, true);
    assert.equal(myobBody.status, 'CONNECTED_SANDBOX');

    const calTest = await callProviderRoute('solarcell', 'test', 'POST', { Authorization: ownerAdminAuth }, { provider: 'calendar' });
    assert.equal(calTest.status, 200);
    const calBody = await calTest.json();
    assert.equal(calBody.simulated, true);
    assert.equal(calBody.status, 'SYNCED_SANDBOX');

    const auditRes = await callProviderRoute('solarcell', 'audit', 'GET', { Authorization: ownerAdminAuth });
    const auditBody = await auditRes.json();
    assert.equal(auditBody.events.length, 3);
    assert.equal(auditBody.events[0].event_type, 'PROVIDER_CONNECTION_TESTED');
  });

  it('WorkspaceSettingsView loads D1 provider config, saves write-only secrets, and runs sandbox tests in JSDOM', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
    const globals = ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'IS_REACT_ACT_ENVIRONMENT'];
    const previous = new Map(globals.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
    for (const k of globals) {
      Object.defineProperty(globalThis, k, {
        configurable: true,
        writable: true,
        value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as any)[k],
      });
    }
    const container = dom.window.document.getElementById('root')!;
    const root = createRoot(container);
    const originalFetch = globalThis.fetch;

    try {
      const worker = createWorker(authService);
      setApiBase('http://localhost');
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = input instanceof Request ? input : new Request(String(input), init);
        const url = new URL(req.url);
        const providerMatch = /^\/api\/v1\/workspaces\/([^/]+)\/provider-settings(?:\/(test|audit))?$/.exec(url.pathname);
        if (providerMatch) {
          return handleSettingsProviders(req, env, providerMatch[1], providerMatch[2], `req_${crypto.randomUUID()}`, authService);
        }
        return worker.fetch(req, env);
      }) as typeof fetch;

      const token = await fixture.token(G01_TEST_AUTH.ownerAdmin.uid, G01_TEST_AUTH.ownerAdmin.email);
      const session: Session = {
        profile: {
          user: { id: G01_TEST_AUTH.ownerAdmin.userId, email: G01_TEST_AUTH.ownerAdmin.email, display_name: 'Owner Admin' },
          memberships: [{ workspace_id: 'solarcell', name: 'Solarcell', role: 'owner_admin' }],
        },
        workspaceId: 'solarcell',
        selectWorkspace: () => {},
        token: async () => token,
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };

      const settle = async () => {
        await act(async () => {
          await new Promise(resolve => setTimeout(resolve, 40));
        });
      };

      await act(async () => {
        root.render(
          React.createElement(
            SessionContext.Provider,
            { value: session },
            React.createElement(CabmsProvider, null, React.createElement(WorkspaceSettingsView))
          )
        );
      });
      await settle();

      const form = container.querySelector('[data-testid="provider-settings-form"]');
      assert.ok(form, 'Provider settings form should be rendered for owner_admin');

      const secretInput = container.querySelector<HTMLInputElement>('#provider-smtp-secret')!;
      const reactPropsKey = Object.keys(secretInput).find(k => k.startsWith('__reactProps$'))!;
      await act(async () => {
        (secretInput as any)[reactPropsKey].onChange({ target: { value: 'ui-secret-42' } });
      });

      await act(async () => {
        form!.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
      });
      await settle();

      assert.match(container.textContent!, /Configured \(server-side only\)/);
      assert.equal(container.querySelector<HTMLInputElement>('#provider-smtp-secret')!.value, '');

      const testSmtpBtn = container.querySelector<HTMLButtonElement>('[data-testid="test-smtp-btn"]')!;
      await act(async () => {
        testSmtpBtn.click();
      });
      await settle();

      const testOut = container.querySelector('[data-testid="provider-test-output"]');
      assert.ok(testOut, 'Simulated test output should be visible');
      assert.match(testOut!.textContent!, /Simulated Sandbox Test Result/i);
      assert.ok(container.querySelector('[data-testid="provider-audit-log"]'), 'Redacted audit log should be rendered');
    } finally {
      globalThis.fetch = originalFetch;
      resetApiBase();
      await act(async () => root.unmount());
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete (globalThis as any)[key];
      }
      dom.window.close();
    }
  });

  it('P1 #4 & #5 regression: provider SMTP test fails closed when smtp_relay lacks TLS or secret, and succeeds when configured', async () => {
    const getRes = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings', {
        headers: { Authorization: ownerAdminAuth },
      }),
      env,
      'solarcell',
      undefined,
      'req_prov_get',
      authService
    );
    const etag1 = getRes.headers.get('ETag')!;

    // Configure smtp_relay with smtp_use_tls = false -> test must FAIL
    const patchNoTls = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings', {
        method: 'PATCH',
        headers: { Authorization: ownerAdminAuth, 'Content-Type': 'application/json', 'If-Match': etag1 },
        body: JSON.stringify({
          sender_email: 'ops@solarcell.example.invalid',
          smtp_host: 'smtp.solarcell.example.invalid',
          smtp_port: 587,
          smtp_username: 'mailer',
          smtp_use_tls: false,
          smtp_transport_mode: 'smtp_relay',
          smtp_secret: 'secret-123',
        }),
      }),
      env,
      'solarcell',
      undefined,
      'req_prov_patch1',
      authService
    );
    assert.equal(patchNoTls.status, 200);
    const etag2 = patchNoTls.headers.get('ETag')!;

    const testFail = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings/test', {
        method: 'POST',
        headers: { Authorization: ownerAdminAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'smtp' }),
      }),
      env,
      'solarcell',
      'test',
      'req_prov_test_fail',
      authService
    );
    assert.equal(testFail.status, 200);
    const failBody = (await testFail.json()) as { ok: boolean; status: string; message: string };
    assert.equal(failBody.ok, false);
    assert.equal(failBody.status, 'FAILED');
    assert.match(failBody.message, /TLS/i);
    const etag3 = testFail.headers.get('ETag') ?? etag2;

    // Enable TLS -> test passes with PASSED_LIVE config check
    const patchTls = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings', {
        method: 'PATCH',
        headers: { Authorization: ownerAdminAuth, 'Content-Type': 'application/json', 'If-Match': etag3 },
        body: JSON.stringify({ smtp_use_tls: true }),
      }),
      env,
      'solarcell',
      undefined,
      'req_prov_patch2',
      authService
    );
    assert.equal(patchTls.status, 200);

    const testPass = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings/test', {
        method: 'POST',
        headers: { Authorization: ownerAdminAuth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'smtp' }),
      }),
      env,
      'solarcell',
      'test',
      'req_prov_test_pass',
      authService
    );
    assert.equal(testPass.status, 200);
    const passBody = (await testPass.json()) as { ok: boolean; status: string };
    assert.equal(passBody.ok, true);
    assert.equal(passBody.status, 'PASSED_LIVE');
  });

  it('Thread #9 regression: concurrent 412 race leaves existing and absent workspace_provider_secrets untouched', async () => {
    // 1. Seed initial secrets (version 1 -> 2)
    const seedRes = await callProviderRoute(
      'solarcell',
      undefined,
      'PATCH',
      { Authorization: ownerAdminAuth, 'If-Match': '"1"' },
      {
        sender_name: 'Initial Desk',
        smtp_secret: 'initial-smtp-secret',
        myob_client_secret: 'initial-myob-secret',
      }
    );
    assert.equal(seedRes.status, 200);
    assert.equal(seedRes.headers.get('ETag'), '"2"');

    // 2. Deterministic mid-flight race: preempt right before racer's db.batch executes
    let preempted = false;
    const raceDb: D1Database = {
      prepare: q => db.prepare(q),
      dump: () => db.dump(),
      exec: q => db.exec(q),
      batch: async stmts => {
        if (!preempted) {
          preempted = true;
          const winnerRes = await callProviderRoute(
            'solarcell',
            undefined,
            'PATCH',
            { Authorization: ownerAdminAuth, 'If-Match': '"2"' },
            {
              sender_name: 'Winner Ahead Desk',
              smtp_secret: 'winner-smtp-secret',
              myob_client_secret: 'winner-myob-secret',
            }
          );
          assert.equal(winnerRes.status, 200);
          assert.equal(winnerRes.headers.get('ETag'), '"3"');
        }
        return db.batch(stmts);
      },
    };
    const raceEnv: Env = { ...env, DB: raceDb };

    // Racer read version 2, then got preempted before db.batch; tries BOTH overwriting smtp_secret and clearing myob_client_secret
    const racerReq = new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings', {
      method: 'PATCH',
      headers: {
        Authorization: ownerAdminAuth,
        'Content-Type': 'application/json',
        'If-Match': '"2"',
      },
      body: JSON.stringify({
        sender_name: 'Stale Loser Desk',
        smtp_secret: 'rogue-loser-smtp-secret',
        myob_client_secret: null,
      }),
    });
    const racerRes = await handleSettingsProviders(racerReq, raceEnv, 'solarcell', undefined, 'req_race_loser_1', authService);
    assert.equal(racerRes.status, 412);

    const secretsAfterOverwriteRace = await db
      .prepare('SELECT secret_key, secret_value FROM workspace_provider_secrets WHERE workspace_id = ? ORDER BY secret_key')
      .bind('solarcell')
      .all<{ secret_key: string; secret_value: string }>();
    assert.deepEqual(
      secretsAfterOverwriteRace.results.map(r => ({ key: r.secret_key, val: r.secret_value })),
      [
        { key: 'myob_client_secret', val: 'winner-myob-secret' },
        { key: 'smtp_secret', val: 'winner-smtp-secret' },
      ]
    );

    // 3. Reverse clear/set race with another mid-flight preemption (version 3 -> 4)
    let preempted2 = false;
    const raceDb2: D1Database = {
      prepare: q => db.prepare(q),
      dump: () => db.dump(),
      exec: q => db.exec(q),
      batch: async stmts => {
        if (!preempted2) {
          preempted2 = true;
          const winner2 = await callProviderRoute(
            'solarcell',
            undefined,
            'PATCH',
            { Authorization: superAdminAuth, 'If-Match': '"3"' },
            { sender_name: 'Winner Clear Guard' }
          );
          assert.equal(winner2.status, 200);
        }
        return db.batch(stmts);
      },
    };
    const racerClearRes = await handleSettingsProviders(
      new Request('http://localhost/api/v1/workspaces/solarcell/provider-settings', {
        method: 'PATCH',
        headers: { Authorization: ownerAdminAuth, 'Content-Type': 'application/json', 'If-Match': '"3"' },
        body: JSON.stringify({ smtp_secret: null, myob_client_secret: 'stale-myob-overwrite' }),
      }),
      { ...env, DB: raceDb2 },
      'solarcell',
      undefined,
      'req_race_loser_2',
      authService
    );
    assert.equal(racerClearRes.status, 412);

    const secretsAfterClearRace = await db
      .prepare('SELECT secret_key, secret_value FROM workspace_provider_secrets WHERE workspace_id = ? ORDER BY secret_key')
      .bind('solarcell')
      .all<{ secret_key: string; secret_value: string }>();
    assert.deepEqual(
      secretsAfterClearRace.results.map(r => ({ key: r.secret_key, val: r.secret_value })),
      [
        { key: 'myob_client_secret', val: 'winner-myob-secret' },
        { key: 'smtp_secret', val: 'winner-smtp-secret' },
      ]
    );

    // 4. Stale 412 on workspace with no secrets must NOT insert new secret rows
    const staleEmptyWsRes = await callProviderRoute(
      'smart_home',
      undefined,
      'PATCH',
      { Authorization: superAdminAuth, 'If-Match': '"99"' },
      { smtp_secret: 'should-never-exist', myob_client_secret: 'should-never-exist' }
    );
    assert.equal(staleEmptyWsRes.status, 412);
    const smartHomeSecrets = await db
      .prepare('SELECT secret_key FROM workspace_provider_secrets WHERE workspace_id = ?')
      .bind('smart_home')
      .all<{ secret_key: string }>();
    assert.equal(smartHomeSecrets.results.length, 0);
  });
});
