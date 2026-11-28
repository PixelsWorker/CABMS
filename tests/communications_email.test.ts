import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createLocalD1Database } from '../backend/db/d1.ts';
import { productionAuthenticationService, type AuthenticationService } from '../backend/workers/auth.ts';
import type { AuthContext, Env } from '../backend/types.ts';
import { emailService, type EmailEnv } from '../backend/services/emailService.ts';
import { handleCommunications } from '../backend/workers/routes/communications.ts';

async function setupCommunicationsDb() {
  const db = createLocalD1Database();
  const migrationFiles = [
    '0001_g01_initial_schema.sql',
    '0004_g01_user_account_status.sql',
    '0006_g01_privileged_identity_approvals.sql',
    '0007_g01_bootstrap_completion.sql',
    '0020_communications_email.sql',
  ];
  for (const file of migrationFiles) {
    await db.exec(readFileSync(resolve('migrations', file), 'utf8'));
  }

  const now = '2026-11-28T00:00:00.000Z';
  await db.exec(`
    INSERT INTO users (id, email, display_name, disabled, created_at, updated_at)
    VALUES
      ('usr_admin', 'admin@cabms.invalid', 'Admin User', 0, '${now}', '${now}'),
      ('usr_staff', 'staff@cabms.invalid', 'Office Staff', 0, '${now}', '${now}'),
      ('usr_tech', 'tech@cabms.invalid', 'Field Tech', 0, '${now}', '${now}');

    INSERT INTO user_identity_mappings (id, user_id, provider_id, provider_subject_id, created_at)
    VALUES
      ('uim_1', 'usr_admin', 'firebase', 'sub_admin', '${now}'),
      ('uim_2', 'usr_staff', 'firebase', 'sub_staff', '${now}'),
      ('uim_3', 'usr_tech', 'firebase', 'sub_tech', '${now}');

    INSERT INTO workspaces (id, name, slug, created_at, updated_at)
    VALUES
      ('solarcell', 'SolarCell Energy', 'solarcell', '${now}', '${now}'),
      ('smart_home', 'Smart Home Automation', 'smart-home', '${now}', '${now}');

    INSERT INTO workspace_memberships (id, workspace_id, user_id, role, created_at, updated_at)
    VALUES
      ('wm_1', 'solarcell', 'usr_admin', 'owner_admin', '${now}', '${now}'),
      ('wm_2', 'solarcell', 'usr_staff', 'office_staff', '${now}', '${now}'),
      ('wm_3', 'solarcell', 'usr_tech', 'technician', '${now}', '${now}'),
      ('wm_4', 'smart_home', 'usr_admin', 'owner_admin', '${now}', '${now}');

    INSERT INTO privileged_identity_approvals (
      id, user_id, provider_id, provider_subject_id, workspace_id, role, granted_at, granted_by
    ) VALUES
      ('pia_1', 'usr_admin', 'firebase', 'sub_admin', 'solarcell', 'owner_admin', '${now}', 'usr_admin'),
      ('pia_2', 'usr_admin', 'firebase', 'sub_admin', 'smart_home', 'owner_admin', '${now}', 'usr_admin');

    INSERT INTO workspace_settings (
      workspace_id, trading_name, primary_color, accent_color, logo_glyph,
      contact_email, review_url, updated_at
    ) VALUES (
      'solarcell', 'SolarCell QLD', '#10b981', '#0ea5e9', 'sun',
      'hello@solarcell-qld.example.invalid', 'https://g.page/r/solarcell-qld/review', '${now}'
    );
  `);

  return db;
}

function makeAuth(user: AuthContext | null): AuthenticationService {
  return {
    ...productionAuthenticationService,
    authenticateRequest: async () => user,
  };
}

const ADMIN_AUTH: AuthContext = {
  userId: 'usr_admin',
  email: 'admin@cabms.invalid',
  displayName: 'Admin User',
  providerId: 'firebase',
  providerSubjectId: 'sub_admin',
};

const STAFF_AUTH: AuthContext = {
  userId: 'usr_staff',
  email: 'staff@cabms.invalid',
  displayName: 'Office Staff',
  providerId: 'firebase',
  providerSubjectId: 'sub_staff',
};

const TECH_AUTH: AuthContext = {
  userId: 'usr_tech',
  email: 'tech@cabms.invalid',
  displayName: 'Field Tech',
  providerId: 'firebase',
  providerSubjectId: 'sub_tech',
};

test('emailService defaults to SANDBOX_SYNTHETIC and resolves business-specific sender identity', async () => {
  const db = await setupCommunicationsDb();
  const status = emailService.getTransportStatus({ DB: db });
  assert.equal(status.mode, 'SANDBOX_SYNTHETIC');
  assert.equal(status.is_synthetic, true);

  const solarSender = await emailService.resolveSenderIdentity(db, 'solarcell');
  assert.equal(solarSender.sender_name, 'SolarCell QLD');
  assert.equal(solarSender.sender_email, 'hello@solarcell-qld.example.invalid');
  assert.equal(solarSender.is_synthetic_sender, false);

  const smartSender = await emailService.resolveSenderIdentity(db, 'smart_home');
  assert.equal(smartSender.sender_name, 'Smart Home Automation');
  assert.equal(smartSender.sender_email, 'noreply@smart-home.cabms-demo.invalid');
  assert.equal(smartSender.is_synthetic_sender, true);
});

test('emailService uses HTTPS_RELAY when configured and never persists or leaks secrets', async () => {
  const db = await setupCommunicationsDb();
  const captured: Array<{ url: string; authHeader: string | null; body: string }> = [];

  const env: EmailEnv = {
    DB: db,
    EMAIL_RELAY_URL: 'https://relay.example.invalid/v1/emails',
    EMAIL_RELAY_API_KEY: 'super_secret_relay_key_12345',
    EMAIL_FETCH_OVERRIDE: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      captured.push({
        url: String(input),
        authHeader: headers.get('Authorization'),
        body: String(init?.body || ''),
      });
      return new Response(JSON.stringify({ id: 'relay_msg_999' }), { status: 200 });
    }) as typeof fetch,
  };

  const status = emailService.getTransportStatus(env);
  assert.equal(status.mode, 'HTTPS_RELAY');
  assert.equal(status.is_synthetic, false);

  const res = await emailService.sendTestEmail(db, env, {
    workspaceId: 'solarcell',
    toEmail: 'customer@example.invalid',
    actorUserId: 'usr_admin',
    requestId: 'req_test_relay_1',
  });

  assert.equal(res.transport_mode, 'HTTPS_RELAY');
  assert.equal(res.is_synthetic, false);
  assert.equal(res.delivery.status, 'SENT');
  assert.equal(res.delivery.provider_message_id, 'relay_msg_999');
  assert.equal(captured.length, 1);
  assert.equal(captured[0].authHeader, 'Bearer super_secret_relay_key_12345');

  // Verify no secret leaked into D1 tables
  const audits = await emailService.listEmailAuditEvents(db, 'solarcell', res.delivery.id);
  assert.equal(audits.length, 1);
  assert.ok(!JSON.stringify(audits).includes('super_secret_relay_key_12345'));
  assert.ok(!JSON.stringify(res.delivery).includes('super_secret_relay_key_12345'));
});

test('emailService redacts sensitive tokens and supports delivery retry', async () => {
  const db = await setupCommunicationsDb();
  const redacted = emailService.redactEmailAuditDetails({
    api_key: 'secret-123',
    smtp_password: 'pw',
    note: 'Failed with Bearer abcdef123456',
  });
  assert.equal(redacted.api_key, '[REDACTED]');
  assert.equal(redacted.smtp_password, '[REDACTED]');
  assert.equal(redacted.note, 'Failed with Bearer [REDACTED]');

  const failed = await emailService.sendTestEmail(db, { DB: db }, {
    workspaceId: 'solarcell',
    toEmail: 'bounce@example.invalid',
    actorUserId: 'usr_admin',
    requestId: 'req_fail_1',
    simulateOutcome: 'FAILED',
  });
  assert.equal(failed.delivery.status, 'FAILED');
  assert.equal(failed.delivery.attempt_count, 1);

  // Cross-workspace retry is rejected
  const crossWs = await emailService.retryEmailDelivery(db, { DB: db }, 'smart_home', failed.delivery.id, 'usr_admin', 'req_retry_cross');
  assert.equal(crossWs.ok, false);
  if (!crossWs.ok) assert.equal(crossWs.code, 'NOT_FOUND');

  // Same-workspace retry succeeds
  const retried = await emailService.retryEmailDelivery(db, { DB: db }, 'solarcell', failed.delivery.id, 'usr_admin', 'req_retry_ok');
  assert.equal(retried.ok, true);
  if (retried.ok) {
    assert.equal(retried.result.delivery.status, 'SENT');
    assert.equal(retried.result.delivery.attempt_count, 2);
  }
});

test('review-request lifecycle enforces deduplication, retry, and uncertain reconciliation', async () => {
  const db = await setupCommunicationsDb();
  const env: Env = { DB: db };

  // 1. Uncertain dispatch -> blocks duplicate -> reconciles to SENT -> still blocks duplicate
  const u1 = await emailService.dispatchReviewRequest(db, env, {
    workspaceId: 'solarcell',
    jobId: 'JOB-101',
    recipientEmail: 'owner@example.invalid',
    recipientName: 'Jane Owner',
    actorUserId: 'usr_staff',
    requestId: 'req_rev_1',
    simulateOutcome: 'UNCERTAIN',
  });
  assert.equal(u1.deduplicated, false);
  assert.equal(u1.review_request.status, 'UNCERTAIN');
  assert.equal(u1.review_request.uncertain_reconciliation_needed, 1);

  const dup = await emailService.dispatchReviewRequest(db, env, {
    workspaceId: 'solarcell',
    jobId: 'JOB-101',
    recipientEmail: 'owner@example.invalid',
    actorUserId: 'usr_staff',
    requestId: 'req_rev_2',
  });
  assert.equal(dup.deduplicated, true);

  const rec = await emailService.reconcileReviewRequestStatus(db, env, 'solarcell', 'JOB-101', 'SENT', 'usr_admin', 'req_rev_3');
  assert.equal(rec.ok, true);
  if (rec.ok) {
    assert.equal(rec.review_request.status, 'SENT');
    assert.equal(rec.review_request.uncertain_reconciliation_needed, 0);
  }

  // 2. Failed dispatch -> retry -> SENT
  const f1 = await emailService.dispatchReviewRequest(db, env, {
    workspaceId: 'solarcell',
    jobId: 'JOB-102',
    recipientEmail: 'owner2@example.invalid',
    actorUserId: 'usr_staff',
    requestId: 'req_rev_4',
    simulateOutcome: 'FAILED',
  });
  assert.equal(f1.review_request.status, 'FAILED');

  const fRetry = await emailService.retryReviewRequestDelivery(db, env, 'solarcell', 'JOB-102', 'usr_staff', 'req_rev_5');
  assert.equal(fRetry.ok, true);
  if (fRetry.ok) {
    assert.equal(fRetry.review_request.status, 'SENT');
    assert.equal(fRetry.review_request.attempt_count, 2);
  }
});

test('handleCommunications enforces RBAC, validation, and workspace-scoped routes', async () => {
  const db = await setupCommunicationsDb();
  const env: Env = { DB: db };

  // Unauthenticated -> 401
  const unauthRes = await handleCommunications(
    new Request('http://localhost/api/v1/workspaces/solarcell/communications/status'),
    env,
    'solarcell',
    'status',
    'req_1',
    makeAuth(null)
  );
  assert.equal(unauthRes.status, 401);

  // Technician -> 403
  const techRes = await handleCommunications(
    new Request('http://localhost/api/v1/workspaces/solarcell/communications/status'),
    env,
    'solarcell',
    'status',
    'req_2',
    makeAuth(TECH_AUTH)
  );
  assert.equal(techRes.status, 403);

  // Office staff -> 200 on status
  const statusRes = await handleCommunications(
    new Request('http://localhost/api/v1/workspaces/solarcell/communications/status'),
    env,
    'solarcell',
    'status',
    'req_3',
    makeAuth(STAFF_AUTH)
  );
  assert.equal(statusRes.status, 200);
  const statusBody = (await statusRes.json()) as { transport_status: { mode: string; is_synthetic: boolean } };
  assert.equal(statusBody.transport_status.mode, 'SANDBOX_SYNTHETIC');
  assert.equal(statusBody.transport_status.is_synthetic, true);

  // Invalid email -> 422
  const invalidRes = await handleCommunications(
    new Request('http://localhost/api/v1/workspaces/solarcell/communications/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_email: 'not-an-email' }),
    }),
    env,
    'solarcell',
    'test-email',
    'req_4',
    makeAuth(ADMIN_AUTH)
  );
  assert.equal(invalidRes.status, 422);

  // Valid test-email -> 201
  const testRes = await handleCommunications(
    new Request('http://localhost/api/v1/workspaces/solarcell/communications/test-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_email: 'qa@example.invalid', simulate_outcome: 'FAILED' }),
    }),
    env,
    'solarcell',
    'test-email',
    'req_5',
    makeAuth(ADMIN_AUTH)
  );
  assert.equal(testRes.status, 201);
  const testBody = (await testRes.json()) as { delivery: { id: string; status: string } };
  assert.equal(testBody.delivery.status, 'FAILED');

  // Retry via route -> 200
  const retryRes = await handleCommunications(
    new Request(`http://localhost/api/v1/workspaces/solarcell/communications/deliveries/${testBody.delivery.id}/retry`, {
      method: 'POST',
    }),
    env,
    'solarcell',
    `deliveries/${testBody.delivery.id}/retry`,
    'req_6',
    makeAuth(STAFF_AUTH)
  );
  assert.equal(retryRes.status, 200);
  const retryBody = (await retryRes.json()) as { delivery: { status: string; attempt_count: number } };
  assert.equal(retryBody.delivery.status, 'SENT');
  assert.equal(retryBody.delivery.attempt_count, 2);
});

test('P1 #4 & #5 regression: workspace provider settings wire into emailService and SMTP requires TLS before AUTH', async () => {
  const db = await setupCommunicationsDb();
  const now = new Date().toISOString();
  await db.exec(`INSERT OR IGNORE INTO workspaces (id, name, slug, created_at, updated_at) VALUES ('cctv', 'CCTV', 'cctv', '${now}', '${now}');`);
  const sql0019 = readFileSync(resolve('migrations/0019_settings_providers.sql'), 'utf8');
  await db.exec(sql0019);
  await db.prepare('DELETE FROM workspace_provider_configs WHERE workspace_id = ?').bind('solarcell').run();

  await db.exec(`
    INSERT INTO workspace_provider_configs (
      workspace_id, sender_name, sender_email, reply_to_email, smtp_host, smtp_port, smtp_username,
      smtp_use_tls, smtp_transport_mode, version, updated_at, updated_by_user_id
    ) VALUES (
      'solarcell', 'SolarCell Configured Desk', 'dispatch@solarcell-custom.example.invalid',
      'reply@solarcell-custom.example.invalid', 'smtp.solarcell.example.invalid', 587, 'mailer',
      0, 'smtp_relay', 1, '${now}', 'usr_admin'
    );
    INSERT INTO workspace_provider_secrets (workspace_id, secret_key, secret_value, updated_at, updated_by_user_id)
    VALUES ('solarcell', 'smtp_secret', 'super-secret-smtp-pass', '${now}', 'usr_admin');
  `);

  // Sender identity reflects persisted workspace_provider_configs
  const sender = await emailService.resolveSenderIdentity(db, 'solarcell');
  assert.equal(sender.sender_name, 'SolarCell Configured Desk');
  assert.equal(sender.sender_email, 'dispatch@solarcell-custom.example.invalid');
  assert.equal(sender.reply_to_email, 'reply@solarcell-custom.example.invalid');

  // With smtp_use_tls = 0, live SMTP transport MUST remain disabled (SANDBOX_SYNTHETIC)
  const tlsDisabledStatus = await emailService.getWorkspaceTransportStatus(db, 'solarcell');
  assert.equal(tlsDisabledStatus.mode, 'SANDBOX_SYNTHETIC');
  assert.equal(tlsDisabledStatus.is_synthetic, true);
  assert.match(tlsDisabledStatus.reason, /TLS/i);

  // Enabling smtp_use_tls = 1 activates SMTP_TCP with server-side secret
  await db.prepare(`UPDATE workspace_provider_configs SET smtp_use_tls = 1 WHERE workspace_id = 'solarcell'`).run();
  const tlsEnabledStatus = await emailService.getWorkspaceTransportStatus(db, 'solarcell');
  assert.equal(tlsEnabledStatus.mode, 'SMTP_TCP');
  assert.equal(tlsEnabledStatus.is_synthetic, false);

  // dispatchViaSmtpTcp refuses plaintext (useTls: false) before any socket or AUTH
  const plaintextBlocked = await emailService.dispatchViaSmtpTcp(
    {},
    { fromName: 'Test', fromEmail: 'a@example.invalid', toEmail: 'b@example.invalid', subject: 'Hi', bodyText: 'Hello' },
    { host: 'smtp.example.invalid', port: 587, user: 'u', pass: 'p', useTls: false }
  );
  assert.equal(plaintextBlocked.status, 'FAILED');
  assert.equal(plaintextBlocked.errorCode, 'SMTP_TLS_REQUIRED');

  // dispatchViaSmtpTcp refuses server that omits STARTTLS before sending AUTH LOGIN
  const sentCommands: string[] = [];
  const fakeNoStartTlsSocket = () => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const responses = ['220 smtp.example.invalid ESMTP\r\n', '250-smtp.example.invalid\r\n250 AUTH LOGIN\r\n'];
    let idx = 0;
    return {
      readable: new ReadableStream<Uint8Array>({
        pull(ctrl) {
          if (idx < responses.length) ctrl.enqueue(encoder.encode(responses[idx++]));
          else ctrl.close();
        },
      }),
      writable: new WritableStream<Uint8Array>({
        write(chunk) { sentCommands.push(decoder.decode(chunk).trim()); },
      }),
      close: async () => undefined,
    };
  };
  const noStartTlsRes = await emailService.dispatchViaSmtpTcp(
    {},
    { fromName: 'Test', fromEmail: 'a@example.invalid', toEmail: 'b@example.invalid', subject: 'Hi', bodyText: 'Hello' },
    { host: 'smtp.example.invalid', port: 587, user: 'u', pass: 'secret-never-sent', useTls: true },
    fakeNoStartTlsSocket
  );
  assert.equal(noStartTlsRes.status, 'FAILED');
  assert.equal(noStartTlsRes.errorCode, 'SMTP_TLS_REQUIRED');
  assert.ok(!sentCommands.some(c => c.includes('AUTH LOGIN') || c.includes(btoa('secret-never-sent'))));
});
