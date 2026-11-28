import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { G01_MIGRATION_MANIFEST, runLocalMigrations } from '../backend/db/migrate.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import {
  handleQuotations,
  handlePublicQuotationToken,
  type QuoteEmailDispatchRequest,
  type QuoteEmailDispatchResult,
  type QuotationsHandlerOptions,
} from '../backend/workers/routes/quotations.ts';
import App, { AppContent } from '../src/App.tsx';
import { PublicQuotationPortal } from '../src/components/PublicQuotationPortal.tsx';
import { QuotesAcceptanceView } from '../src/views/QuotesAcceptanceView.tsx';
import { CabmsProvider } from '../src/context/CabmsContext.tsx';
import { SessionContext, type Session } from '../src/context/G01Session.tsx';
import { createFirebaseFixture } from './support/firebaseTokens.ts';
import { G01_TEST_AUTH, installG01TestAuthFixtures } from './support/g01SyntheticFixtures.ts';

async function setupQuotationDb(t: test.TestContext): Promise<LocalD1Database> {
  const db = createLocalD1Database() as LocalD1Database;
  t.after(() => db.getSqliteHandle().close());

  const dir = mkdtempSync(join(tmpdir(), 'cabms-quotes-mig-'));
  try {
    for (const [name] of G01_MIGRATION_MANIFEST) {
      writeFileSync(join(dir, name), readFileSync(resolve('migrations', name)));
    }
    await runLocalMigrations(db, { disposableTest: true, dir });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const migration0022 = readFileSync(resolve('migrations', '0022_quotations_terms.sql'), 'utf8');
  await db.exec(migration0022);
  await installG01TestAuthFixtures(db);
  return db;
}

async function seedPublishedQuoteTerms(
  db: LocalD1Database,
  workspaceId: string,
  version: string,
  content: string,
  revisionId = `rev_${version.replace(/\W+/g, '_')}`
): Promise<string> {
  const templateId = `tpl_quote_terms_${workspaceId}`;
  await db
    .prepare(
      `INSERT OR IGNORE INTO document_templates (id, workspace_id, code, name, template_type, status, current_revision_id, created_at, updated_at)
       VALUES (?, ?, 'QUOTE_TERMS_STD', 'Standard Quote Terms', 'QUOTE_TERMS', 'ACTIVE', ?, '2026-11-01T09:00:00+10:00', '2026-11-01T09:00:00+10:00')`
    )
    .bind(templateId, workspaceId, revisionId)
    .run();
  await db
    .prepare(
      `INSERT INTO template_revisions (id, template_id, version, status, content, created_at, updated_at, approved_at)
       VALUES (?, ?, ?, 'PUBLISHED', ?, '2026-11-01T09:00:00+10:00', '2026-11-01T09:00:00+10:00', '2026-11-01T09:00:00+10:00')`
    )
    .bind(revisionId, templateId, version, content)
    .run();
  await db
    .prepare(`UPDATE document_templates SET current_revision_id = ? WHERE id = ?`)
    .bind(revisionId, templateId)
    .run();
  return revisionId;
}

function makeHarness(
  db: LocalD1Database,
  authentication: ReturnType<typeof createAuthenticationService>,
  options: QuotationsHandlerOptions = {}
) {
  const env = { DB: db, ENVIRONMENT: 'test', FIREBASE_PROJECT_ID: 'cabms-test' };

  const callWorkspace = (
    workspaceId: string,
    path: string,
    method = 'GET',
    body?: unknown,
    token = ''
  ) => {
    const clean = path.replace(/^\/+/, '');
    const [pathOnly, query] = clean.split('?');
    const parts = pathOnly ? pathOnly.split('/') : [];
    const quoteId = parts[0] || undefined;
    const action = parts.length > 1 ? parts.slice(1).join('/') : undefined;
    const url = `http://local/api/v1/workspaces/${workspaceId}/quotations${pathOnly ? `/${pathOnly}` : ''}${query ? `?${query}` : ''}`;
    return handleQuotations(
      new Request(url, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      workspaceId,
      quoteId,
      action,
      `req_${crypto.randomUUID()}`,
      authentication,
      options
    );
  };

  const callPublic = (token: string, action?: 'accept' | 'refuse', method = 'GET', body?: unknown) => {
    const url = `http://local/api/v1/public/quotations/${token}${action ? `/${action}` : ''}`;
    return handlePublicQuotationToken(
      new Request(url, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      env,
      token,
      action,
      `req_${crypto.randomUUID()}`,
      options
    );
  };

  return { callWorkspace, callPublic };
}

test('quotations: enforces RBAC, workspace isolation, and GST half-up cent calculations', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const { callWorkspace } = makeHarness(db, authService, {
    now: () => new Date('2026-11-02T09:00:00+10:00'),
  });

  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  const techToken = await fixture.token(G01_TEST_AUTH.technician.uid, G01_TEST_AUTH.technician.email);

  // Unauthenticated -> 401
  assert.equal((await callWorkspace('solarcell', '', 'GET', undefined, '')).status, 401);
  // Technician -> 403
  assert.equal((await callWorkspace('solarcell', '', 'GET', undefined, techToken)).status, 403);
  // Cross-workspace -> 403
  assert.equal((await callWorkspace('cctv', '', 'GET', undefined, staffToken)).status, 403);

  // Validation error on empty line items
  const invalidRes = await callWorkspace('solarcell', '', 'POST', { job_id: 'JOB-1', title: 'Bad', line_items: [] }, staffToken);
  assert.equal(invalidRes.status, 422);

  // Create draft with half-up GST boundary ($0.35 -> $0.04 GST -> $0.39 total)
  const createRes = await callWorkspace(
    'solarcell',
    '',
    'POST',
    {
      job_id: 'JOB-2026-101',
      title: 'Switchboard Inspection',
      line_items: [{ id: 'L1', description: 'Inspection fee', quantity: 1, unit_price: 0.35 }],
    },
    staffToken
  );
  assert.equal(createRes.status, 201);
  const created = (await createRes.json()) as { quotation: { id: string; subtotal: number; gst: number; total: number; acceptance_status: string } };
  assert.equal(created.quotation.acceptance_status, 'DRAFT');
  assert.equal(created.quotation.subtotal, 0.35);
  assert.equal(created.quotation.gst, 0.04);
  assert.equal(created.quotation.total, 0.39);

  // Edit draft -> recalculates totals
  const patchRes = await callWorkspace(
    'solarcell',
    created.quotation.id,
    'PATCH',
    {
      title: 'Full Solar Upgrade',
      line_items: [
        { id: 'L1', description: 'Inverter', quantity: 1, unit_price: 1200 },
        { id: 'L2', description: 'Labour', quantity: 2.5, unit_price: 100 },
      ],
    },
    staffToken
  );
  assert.equal(patchRes.status, 200);
  const patched = (await patchRes.json()) as { quotation: { subtotal: number; gst: number; total: number; title: string } };
  assert.equal(patched.quotation.title, 'Full Solar Upgrade');
  assert.equal(patched.quotation.subtotal, 1450);
  assert.equal(patched.quotation.gst, 145);
  assert.equal(patched.quotation.total, 1595);

  // Workspace isolation on single quote read
  assert.equal((await callWorkspace('cctv', created.quotation.id, 'GET', undefined, staffToken)).status, 403);
});

test('quotations: send freezes immutable Terms snapshot, schedules follow-ups, dispatches email hook, and blocks post-send edits', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const dispatched: QuoteEmailDispatchRequest[] = [];
  const currentTime = new Date('2026-11-02T09:00:00+10:00');

  const { callWorkspace, callPublic } = makeHarness(db, authService, {
    now: () => currentTime,
    emailDispatcher: async req => {
      dispatched.push(req);
      return { deliveryId: `del_${dispatched.length}`, status: 'SENT', transport: 'test_relay' };
    },
  });

  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  const created = (await (
    await callWorkspace(
      'solarcell',
      '',
      'POST',
      {
        job_id: 'JOB-2026-202',
        title: 'Solar Array Service',
        line_items: [{ description: 'Service', quantity: 1, unit_price: 500 }],
      },
      staffToken
    )
  ).json()) as { quotation: { id: string } };

  // Sending with a nonexistent terms_revision_id fails cleanly with 422
  const noTermsRes = await callWorkspace('solarcell', `${created.quotation.id}/send`, 'POST', { terms_revision_id: 'rev_nonexistent' }, staffToken);
  assert.equal(noTermsRes.status, 422);

  // Seed published QUOTE_TERMS v2.1 and send with it
  const rev21 = await seedPublishedQuoteTerms(db, 'solarcell', 'v2.1', 'Frozen terms v2.1: 14-day validity.');

  const sendRes = await callWorkspace(
    'solarcell',
    `${created.quotation.id}/send`,
    'POST',
    { terms_revision_id: rev21, recipient_email: 'client@example.invalid' },
    staffToken
  );
  assert.equal(sendRes.status, 200);
  const sentBody = (await sendRes.json()) as {
    quotation: {
      acceptance_status: string;
      terms_version: string;
      terms_content_snapshot: string;
      issued_at: string;
      expires_at: string;
      follow_ups: Array<{ stage: string; scheduled_date: string; status: string }>;
    };
    acceptance_token: string;
    email_dispatch: { deliveryId: string; status: string };
  };

  assert.equal(sentBody.quotation.acceptance_status, 'SENT');
  assert.equal(sentBody.quotation.terms_version, 'v2.1');
  assert.equal(sentBody.quotation.terms_content_snapshot, 'Frozen terms v2.1: 14-day validity.');
  assert.equal(sentBody.quotation.issued_at, '2026-11-02T09:00:00.000+10:00');
  assert.equal(sentBody.quotation.expires_at, '2026-11-16T09:00:00.000+10:00');
  assert.equal(sentBody.quotation.follow_ups.length, 2);
  assert.equal(sentBody.quotation.follow_ups[0].stage, 'STAGE_1_COURTESY');
  assert.equal(sentBody.quotation.follow_ups[0].scheduled_date, '2026-11-05');
  assert.equal(sentBody.quotation.follow_ups[1].stage, 'STAGE_2_EXPIRY');
  assert.equal(sentBody.quotation.follow_ups[1].scheduled_date, '2026-11-11');
  assert.equal(sentBody.email_dispatch.deliveryId, 'del_1');
  assert.equal(dispatched[0].category, 'QUOTE_SENT');

  // Publishing a newer terms revision v3.0 does NOT mutate the sent quote's frozen snapshot
  await seedPublishedQuoteTerms(db, 'solarcell', 'v3.0', 'Updated terms v3.0');
  const afterTermsUpdate = (await (await callWorkspace('solarcell', created.quotation.id, 'GET', undefined, staffToken)).json()) as {
    quotation: { terms_version: string; terms_content_snapshot: string };
  };
  assert.equal(afterTermsUpdate.quotation.terms_version, 'v2.1');
  assert.equal(afterTermsUpdate.quotation.terms_content_snapshot, 'Frozen terms v2.1: 14-day validity.');

  // API PATCH on SENT quote is blocked with 409
  const editBlocked = await callWorkspace('solarcell', created.quotation.id, 'PATCH', { title: 'Tampered' }, staffToken);
  assert.equal(editBlocked.status, 409);

  // SQLite trigger blocks direct mutation of frozen snapshot or line items
  await assert.rejects(
    () => db.prepare(`UPDATE quotations SET terms_content_snapshot = 'tampered' WHERE id = ?`).bind(created.quotation.id).run(),
    /immutable/i
  );
  await assert.rejects(
    () => db.prepare(`DELETE FROM quotation_line_items WHERE quote_id = ?`).bind(created.quotation.id).run(),
    /immutable/i
  );

  // Follow-up dispatch hook
  const fuRes = await callWorkspace(
    'solarcell',
    `${created.quotation.id}/follow-ups/dispatch`,
    'POST',
    { stage: 'STAGE_1_COURTESY', recipient_email: 'client@example.invalid' },
    staffToken
  );
  assert.equal(fuRes.status, 200);
  assert.equal(dispatched[1].category, 'QUOTE_FOLLOW_UP_STAGE_1');

  // Public token preview & acceptance
  assert.equal((await callPublic('qtok_invalid_token_12345')).status, 404);
  const pubGet = await callPublic(sentBody.acceptance_token);
  assert.equal(pubGet.status, 200);

  // Missing confirmation -> 422
  assert.equal((await callPublic(sentBody.acceptance_token, 'accept', 'POST', { confirmed: false })).status, 422);

  // Valid accept -> ACCEPTED + remaining follow-ups cancelled
  const pubAccept = await callPublic(sentBody.acceptance_token, 'accept', 'POST', { confirmed: true, accepted_by_name: 'Jane Customer' });
  assert.equal(pubAccept.status, 200);
  const acceptedBody = (await pubAccept.json()) as {
    quotation: { acceptance_status: string; accepted_by_name: string; follow_ups: Array<{ stage: string; status: string }> };
  };
  assert.equal(acceptedBody.quotation.acceptance_status, 'ACCEPTED');
  assert.equal(acceptedBody.quotation.accepted_by_name, 'Jane Customer');
  assert.equal(acceptedBody.quotation.follow_ups.find(f => f.stage === 'STAGE_1_COURTESY')?.status, 'SENT');
  assert.equal(acceptedBody.quotation.follow_ups.find(f => f.stage === 'STAGE_2_EXPIRY')?.status, 'CANCELLED');

  // Second accept -> 409 ALREADY_ACCEPTED
  const secondAccept = await callPublic(sentBody.acceptance_token, 'accept', 'POST', { confirmed: true });
  assert.equal(secondAccept.status, 409);
});

test('quotations: enforces refusal, revocation, expiry, and revise/supersede guards', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  let now = new Date('2026-11-02T09:00:00+10:00');
  const { callWorkspace } = makeHarness(db, authService, { now: () => now });
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);

  await seedPublishedQuoteTerms(db, 'solarcell', 'v1.0', 'Standard Terms v1.0');

  const createAndSend = async (jobId: string) => {
    const c = (await (
      await callWorkspace(
        'solarcell',
        '',
        'POST',
        { job_id: jobId, title: `Quote for ${jobId}`, line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }] },
        staffToken
      )
    ).json()) as { quotation: { id: string } };
    await callWorkspace('solarcell', `${c.quotation.id}/send`, 'POST', {}, staffToken);
    return c.quotation.id;
  };

  // 1. Refusal guard
  const qRefuse = await createAndSend('JOB-REFUSE');
  assert.equal((await callWorkspace('solarcell', `${qRefuse}/refuse`, 'POST', { reason: 'Too expensive' }, staffToken)).status, 200);
  assert.equal((await callWorkspace('solarcell', `${qRefuse}/accept`, 'POST', {}, staffToken)).status, 409);

  // 2. Revocation guard
  const qRevoke = await createAndSend('JOB-REVOKE');
  assert.equal((await callWorkspace('solarcell', `${qRevoke}/revoke`, 'POST', { reason: 'Scope changed' }, staffToken)).status, 200);
  assert.equal((await callWorkspace('solarcell', `${qRevoke}/accept`, 'POST', {}, staffToken)).status, 409);

  // 3. Revise / Supersede guard
  const qRevise = await createAndSend('JOB-REVISE');
  const revisedRes = await callWorkspace('solarcell', `${qRevise}/revise`, 'POST', { title: 'Revised Scope' }, staffToken);
  assert.equal(revisedRes.status, 201);
  const revised = (await revisedRes.json()) as { quotation: { id: string; acceptance_status: string; supersedes_quote_id: string } };
  assert.equal(revised.quotation.acceptance_status, 'DRAFT');
  assert.equal(revised.quotation.supersedes_quote_id, qRevise);
  assert.equal((await callWorkspace('solarcell', `${qRevise}/accept`, 'POST', {}, staffToken)).status, 409);

  // 4. Expiry guard (> 14 days)
  const qExpire = await createAndSend('JOB-EXPIRE');
  now = new Date('2026-11-16T09:01:00+10:00');
  const expAccept = await callWorkspace('solarcell', `${qExpire}/accept`, 'POST', {}, staffToken);
  assert.equal(expAccept.status, 409);
  const expDetail = (await (await callWorkspace('solarcell', qExpire, 'GET', undefined, staffToken)).json()) as {
    quotation: { acceptance_status: string; follow_ups: Array<{ status: string }> };
  };
  assert.equal(expDetail.quotation.acceptance_status, 'EXPIRED');
  assert.ok(expDetail.quotation.follow_ups.every(f => f.status === 'CANCELLED'));
});

test('P1 #2 & #3 regression: validates recipient_email before freezing/sending and includes public acceptance link', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);

  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  await seedPublishedQuoteTerms(db, 'solarcell', 'v3.0', 'Standard 14-day acceptance terms.');
  const dispatchedBodies: string[] = [];

  const env = {
    DB: db,
    ENVIRONMENT: 'test',
    FIREBASE_PROJECT_ID: 'cabms-test',
  };
  const routeOpts = {
    emailDispatcher: async (req: { textBody: string }) => {
      dispatchedBodies.push(req.textBody);
      return { deliveryId: 'em_test_1', status: 'SENT' as const, transport: 'SANDBOX_SYNTHETIC' };
    },
  };

  const createRes = await handleQuotations(
    new Request('http://localhost/api/v1/workspaces/solarcell/quotations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        job_id: 'JOB-RECIP-CHECK',
        customer_id: 'CUST-RECIP',
        customer_name: 'Recipient Test',
        customer_email: 'recipient@example.invalid',
        title: 'Recipient Validation Quote',
        line_items: [{ id: '1', description: 'Checkup', quantity: 1, unit_price: 100 }],
      }),
    }),
    env,
    'solarcell',
    undefined,
    undefined,
    'req_q_create',
    authService,
    routeOpts
  );
  assert.equal(createRes.status, 201);
  const { quotation } = (await createRes.json()) as { quotation: { id: string } };

  // Invalid recipient_email MUST fail 422 BEFORE mutating status or freezing terms
  const badSend = await handleQuotations(
    new Request(`http://localhost/api/v1/workspaces/solarcell/quotations/${quotation.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_email: 'not-a-valid-email' }),
    }),
    env,
    'solarcell',
    quotation.id,
    'send',
    'req_q_bad_send',
    authService,
    routeOpts
  );
  assert.equal(badSend.status, 422);
  const stillDraft = await db.prepare('SELECT acceptance_status, terms_revision_id FROM quotations WHERE id = ?').bind(quotation.id).first<{ acceptance_status: string; terms_revision_id: string | null }>();
  assert.equal(stillDraft?.acceptance_status, 'DRAFT');
  assert.equal(stillDraft?.terms_revision_id, null);

  // Valid send includes public portal link + API link and supports public GET + refuse
  const goodSend = await handleQuotations(
    new Request(`http://localhost/api/v1/workspaces/solarcell/quotations/${quotation.id}/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${staffToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_email: 'recipient@example.invalid' }),
    }),
    env,
    'solarcell',
    quotation.id,
    'send',
    'req_q_good_send',
    authService,
    routeOpts
  );
  assert.equal(goodSend.status, 200);
  const { acceptance_token: rawToken } = (await goodSend.json()) as { acceptance_token: string };
  assert.equal(dispatchedBodies.length, 1);
  assert.ok(dispatchedBodies[0].includes(`?quote_token=${encodeURIComponent(rawToken)}`));
  assert.ok(dispatchedBodies[0].includes(`/api/v1/public/quotations/${encodeURIComponent(rawToken)}`));

  const pubGet = await handlePublicQuotationToken(new Request(`http://localhost/api/v1/public/quotations/${rawToken}`), env, rawToken, undefined, 'req_pub_get', routeOpts);
  assert.equal(pubGet.status, 200);
  const pubRefuse = await handlePublicQuotationToken(
    new Request(`http://localhost/api/v1/public/quotations/${rawToken}/refuse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Customer chose another date' }),
    }),
    env,
    rawToken,
    'refuse',
    'req_pub_refuse',
    routeOpts
  );
  assert.equal(pubRefuse.status, 200);
  const refusedData = (await pubRefuse.json()) as { quotation: { acceptance_status: string } };
  assert.equal(refusedData.quotation.acceptance_status, 'REFUSED');
});

test('Thread #14: /send handles dispatch failure/uncertainty & thrown errors cleanly and supports recoverable resend', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  await seedPublishedQuoteTerms(db, 'solarcell', 'v4.0', 'Recovery Terms v4.0');

  let mode: 'FAIL' | 'THROW_TIMEOUT' | 'UNCERTAIN' | 'SENT' = 'FAIL';
  let dispatchCalls = 0;

  const { callWorkspace, callPublic } = makeHarness(db, authService, {
    now: () => new Date('2026-11-02T10:00:00+10:00'),
    emailDispatcher: async (req): Promise<QuoteEmailDispatchResult> => {
      dispatchCalls += 1;
      if (mode === 'FAIL') {
        return { deliveryId: `del_fail_${dispatchCalls}`, status: 'FAILED', transport: 'smtp_tcp', error: '550 Mailbox unavailable' };
      }
      if (mode === 'THROW_TIMEOUT') {
        throw new Error('HTTPS relay timeout 504');
      }
      if (mode === 'UNCERTAIN') {
        return { deliveryId: `del_unc_${dispatchCalls}`, status: 'UNCERTAIN', transport: 'smtp_tcp', error: 'Socket closed after DATA' };
      }
      return { deliveryId: `del_ok_${dispatchCalls}`, status: 'SENT', transport: 'smtp_tcp' };
    },
  });

  // 1. /send when emailDispatcher returns FAILED: quote is frozen as SENT, event is EMAIL_DISPATCH_FAILED, /send retry recovers
  const q1 = (await (await callWorkspace('solarcell', '', 'POST', {
    job_id: 'JOB-SEND-FAIL',
    title: 'Fail Recovery Quote',
    line_items: [{ description: 'Item', quantity: 1, unit_price: 200 }],
  }, staffToken)).json()) as { quotation: { id: string } };

  const failSendRes = await callWorkspace('solarcell', `${q1.quotation.id}/send`, 'POST', { recipient_email: 'recover@example.invalid' }, staffToken);
  assert.equal(failSendRes.status, 200);
  const failSendBody = (await failSendRes.json()) as {
    quotation: { acceptance_status: string; events: Array<{ event_type: string; details: Record<string, unknown> | null }> };
    acceptance_token: string;
    email_dispatch: { status: string };
  };
  assert.equal(failSendBody.quotation.acceptance_status, 'SENT');
  assert.equal(failSendBody.email_dispatch.status, 'FAILED');
  assert.ok(failSendBody.quotation.events.some(e => e.event_type === 'EMAIL_DISPATCH_FAILED' && e.details?.status === 'FAILED'));

  // Retry via /send while no prior dispatch succeeded -> recovers cleanly
  mode = 'SENT';
  const retrySendRes = await callWorkspace('solarcell', `${q1.quotation.id}/send`, 'POST', { recipient_email: 'recover@example.invalid' }, staffToken);
  assert.equal(retrySendRes.status, 200);
  const retrySendBody = (await retrySendRes.json()) as {
    quotation: { events: Array<{ event_type: string }> };
    acceptance_token: string;
    email_dispatch: { status: string };
  };
  assert.equal(retrySendBody.email_dispatch.status, 'SENT');
  assert.ok(retrySendBody.quotation.events.some(e => e.event_type === 'EMAIL_DISPATCHED'));
  assert.notEqual(retrySendBody.acceptance_token, failSendBody.acceptance_token);

  // Subsequent /send after successful dispatch -> 409 QUOTE_ALREADY_SENT
  const dupSendRes = await callWorkspace('solarcell', `${q1.quotation.id}/send`, 'POST', { recipient_email: 'recover@example.invalid' }, staffToken);
  assert.equal(dupSendRes.status, 409);
  assert.equal(((await dupSendRes.json()) as { code: string }).code, 'QUOTE_ALREADY_SENT');

  // 2. /send when emailDispatcher throws timeout -> preserved as UNCERTAIN (not 500, not SENT), /resend recovers
  mode = 'THROW_TIMEOUT';
  const q2 = (await (await callWorkspace('solarcell', '', 'POST', {
    job_id: 'JOB-SEND-THROW',
    title: 'Throw Recovery Quote',
    line_items: [{ description: 'Item', quantity: 1, unit_price: 300 }],
  }, staffToken)).json()) as { quotation: { id: string } };

  const throwSendRes = await callWorkspace('solarcell', `${q2.quotation.id}/send`, 'POST', { recipient_email: 'timeout@example.invalid' }, staffToken);
  assert.equal(throwSendRes.status, 200);
  const throwSendBody = (await throwSendRes.json()) as {
    quotation: { events: Array<{ event_type: string; details: Record<string, unknown> | null }> };
    acceptance_token: string;
    email_dispatch: { status: string };
  };
  assert.equal(throwSendBody.email_dispatch.status, 'UNCERTAIN');
  assert.ok(throwSendBody.quotation.events.some(e => e.event_type === 'EMAIL_DISPATCH_UNCERTAIN' && e.details?.status === 'UNCERTAIN'));

  // 3. Direct UNCERTAIN status is also preserved accurately, then /resend succeeds and issues valid public token
  mode = 'UNCERTAIN';
  const uncResendRes = await callWorkspace('solarcell', `${q2.quotation.id}/resend`, 'POST', { recipient_email: 'timeout@example.invalid' }, staffToken);
  assert.equal(uncResendRes.status, 200);
  const uncResendBody = (await uncResendRes.json()) as { email_dispatch: { status: string } };
  assert.equal(uncResendBody.email_dispatch.status, 'UNCERTAIN');

  mode = 'SENT';
  const okResendRes = await callWorkspace('solarcell', `${q2.quotation.id}/resend`, 'POST', { recipient_email: 'timeout@example.invalid' }, staffToken);
  assert.equal(okResendRes.status, 200);
  const okResendBody = (await okResendRes.json()) as { acceptance_token: string; email_dispatch: { status: string } };
  assert.equal(okResendBody.email_dispatch.status, 'SENT');
  assert.equal((await callPublic(okResendBody.acceptance_token)).status, 200);
});

test('Thread #15: follow-ups/dispatch claims atomically before dispatch and preserves FAILED/UNCERTAIN without lying as SENT', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  await seedPublishedQuoteTerms(db, 'solarcell', 'v4.1', 'Follow-Up Terms v4.1');

  let nextFollowUpOutcome: 'SENT' | 'FAILED' | 'UNCERTAIN' = 'FAILED';
  let followUpDispatchCount = 0;
  let releaseSlowDispatch: () => void = () => {};
  let slowMode = false;

  const { callWorkspace } = makeHarness(db, authService, {
    now: () => new Date('2026-11-02T09:00:00+10:00'),
    emailDispatcher: async (req): Promise<QuoteEmailDispatchResult> => {
      if (req.category === 'QUOTE_SENT') {
        return { deliveryId: 'del_quote_sent', status: 'SENT', transport: 'smtp_tcp' };
      }
      followUpDispatchCount += 1;
      if (slowMode) {
        await new Promise<void>(resolve => { releaseSlowDispatch = resolve; });
      }
      if (nextFollowUpOutcome === 'FAILED') {
        return { deliveryId: `del_fu_fail_${followUpDispatchCount}`, status: 'FAILED', transport: 'smtp_tcp', error: '550 Rejected' };
      }
      if (nextFollowUpOutcome === 'UNCERTAIN') {
        return { deliveryId: `del_fu_unc_${followUpDispatchCount}`, status: 'UNCERTAIN', transport: 'smtp_tcp', error: 'Read timeout' };
      }
      return { deliveryId: `del_fu_ok_${followUpDispatchCount}`, status: 'SENT', transport: 'smtp_tcp' };
    },
  });

  const q = (await (await callWorkspace('solarcell', '', 'POST', {
    job_id: 'JOB-FU-ATOMIC',
    title: 'Follow-Up Atomic Quote',
    line_items: [{ description: 'Service', quantity: 1, unit_price: 400 }],
  }, staffToken)).json()) as { quotation: { id: string } };
  await callWorkspace('solarcell', `${q.quotation.id}/send`, 'POST', { recipient_email: 'fu@example.invalid' }, staffToken);

  // 1. FAILED outcome must NOT mark follow-up SENT; stays SCHEDULED & retryable
  nextFollowUpOutcome = 'FAILED';
  const failFuRes = await callWorkspace('solarcell', `${q.quotation.id}/follow-ups/dispatch`, 'POST', {
    stage: 'STAGE_1_COURTESY',
    recipient_email: 'fu@example.invalid',
  }, staffToken);
  assert.equal(failFuRes.status, 200);
  const failFuBody = (await failFuRes.json()) as {
    quotation: { follow_ups: Array<{ stage: string; status: string; sent_at: string | null; email_delivery_id: string | null }>; events: Array<{ event_type: string }> };
    email_dispatch: { status: string };
  };
  assert.equal(failFuBody.email_dispatch.status, 'FAILED');
  const stage1AfterFail = failFuBody.quotation.follow_ups.find(f => f.stage === 'STAGE_1_COURTESY')!;
  assert.equal(stage1AfterFail.status, 'SCHEDULED');
  assert.equal(stage1AfterFail.sent_at, null);
  assert.equal(stage1AfterFail.email_delivery_id, null);
  assert.ok(failFuBody.quotation.events.some(e => e.event_type === 'FOLLOW_UP_FAILED'));

  // 2. Concurrent retry of STAGE_1_COURTESY claims atomically -> only ONE calls emailDispatcher
  nextFollowUpOutcome = 'SENT';
  slowMode = true;
  const callsBeforeRace = followUpDispatchCount;
  const p1 = callWorkspace('solarcell', `${q.quotation.id}/follow-ups/dispatch`, 'POST', {
    stage: 'STAGE_1_COURTESY',
    recipient_email: 'fu@example.invalid',
  }, staffToken);
  // Wait a tick for p1 to claim lock and pause in emailDispatcher
  await new Promise(resolve => setTimeout(resolve, 15));
  const p2 = callWorkspace('solarcell', `${q.quotation.id}/follow-ups/dispatch`, 'POST', {
    stage: 'STAGE_1_COURTESY',
    recipient_email: 'fu@example.invalid',
  }, staffToken);
  const res2 = await p2;
  assert.equal(res2.status, 409);
  releaseSlowDispatch();
  const res1 = await p1;
  assert.equal(res1.status, 200);
  assert.equal(followUpDispatchCount - callsBeforeRace, 1, 'Concurrent follow-up dispatch must invoke emailDispatcher at most once');
  const stage1AfterSent = ((await res1.json()) as { quotation: { follow_ups: Array<{ stage: string; status: string; sent_at: string | null }> } })
    .quotation.follow_ups.find(f => f.stage === 'STAGE_1_COURTESY')!;
  assert.equal(stage1AfterSent.status, 'SENT');
  assert.ok(stage1AfterSent.sent_at);

  // 3. UNCERTAIN outcome on STAGE_2_EXPIRY stays SCHEDULED with deliveryId recorded & blocks duplicate auto-send
  slowMode = false;
  nextFollowUpOutcome = 'UNCERTAIN';
  const uncFuRes = await callWorkspace('solarcell', `${q.quotation.id}/follow-ups/dispatch`, 'POST', {
    stage: 'STAGE_2_EXPIRY',
    recipient_email: 'fu@example.invalid',
  }, staffToken);
  assert.equal(uncFuRes.status, 200);
  const uncFuBody = (await uncFuRes.json()) as {
    quotation: { follow_ups: Array<{ stage: string; status: string; sent_at: string | null; email_delivery_id: string | null }>; events: Array<{ event_type: string }> };
    email_dispatch: { status: string };
  };
  assert.equal(uncFuBody.email_dispatch.status, 'UNCERTAIN');
  const stage2AfterUnc = uncFuBody.quotation.follow_ups.find(f => f.stage === 'STAGE_2_EXPIRY')!;
  assert.equal(stage2AfterUnc.status, 'SCHEDULED');
  assert.equal(stage2AfterUnc.sent_at, null);
  assert.ok(stage2AfterUnc.email_delivery_id);
  assert.ok(uncFuBody.quotation.events.some(e => e.event_type === 'FOLLOW_UP_UNCERTAIN'));

  const dupUncRes = await callWorkspace('solarcell', `${q.quotation.id}/follow-ups/dispatch`, 'POST', {
    stage: 'STAGE_2_EXPIRY',
    recipient_email: 'fu@example.invalid',
  }, staffToken);
  assert.equal(dupUncRes.status, 409);
});

test('Thread #16: revise version/status guards never overwrite customer ACCEPTED or leave orphaned drafts', async t => {
  const db = await setupQuotationDb(t);
  const fixture = await createFirebaseFixture();
  const authService = createAuthenticationService(fixture.transport);
  const staffToken = await fixture.token(G01_TEST_AUTH.officeStaff.uid, G01_TEST_AUTH.officeStaff.email);
  await seedPublishedQuoteTerms(db, 'solarcell', 'v4.2', 'Concurrency Terms v4.2');
  const { callWorkspace, callPublic } = makeHarness(db, authService, {
    now: () => new Date('2026-11-02T11:00:00+10:00'),
  });

  // 1. Race customer /accept vs staff /revise
  const q1 = (await (await callWorkspace('solarcell', '', 'POST', {
    job_id: 'JOB-RACE-1',
    title: 'Race Quote 1',
    line_items: [{ description: 'Item', quantity: 1, unit_price: 500 }],
  }, staffToken)).json()) as { quotation: { id: string } };
  const sent1 = (await (await callWorkspace('solarcell', `${q1.quotation.id}/send`, 'POST', {}, staffToken)).json()) as { acceptance_token: string };

  const [acceptRes, reviseRes] = await Promise.all([
    callPublic(sent1.acceptance_token, 'accept', 'POST', { confirmed: true, accepted_by_name: 'Fast Customer' }),
    callWorkspace('solarcell', `${q1.quotation.id}/revise`, 'POST', { title: 'Conflicting Revision' }, staffToken),
  ]);

  assert.equal(acceptRes.status, 200);
  assert.equal(reviseRes.status, 409);
  assert.equal(((await reviseRes.json()) as { code: string }).code, 'ALREADY_ACCEPTED');

  const finalOriginal = await db.prepare(`SELECT acceptance_status FROM quotations WHERE id = ?`).bind(q1.quotation.id).first<{ acceptance_status: string }>();
  assert.equal(finalOriginal?.acceptance_status, 'ACCEPTED');
  const orphans = await db.prepare(`SELECT id FROM quotations WHERE supersedes_quote_id = ?`).bind(q1.quotation.id).all();
  assert.equal(orphans.results.length, 0, 'Must not create orphaned revised DRAFT when customer accept wins');

  // 2. Concurrent /revise vs /revise creates at most ONE revised draft
  const q2 = (await (await callWorkspace('solarcell', '', 'POST', {
    job_id: 'JOB-RACE-2',
    title: 'Race Quote 2',
    line_items: [{ description: 'Item', quantity: 1, unit_price: 600 }],
  }, staffToken)).json()) as { quotation: { id: string } };
  await callWorkspace('solarcell', `${q2.quotation.id}/send`, 'POST', {}, staffToken);

  const [revA, revB] = await Promise.all([
    callWorkspace('solarcell', `${q2.quotation.id}/revise`, 'POST', { title: 'Rev A' }, staffToken),
    callWorkspace('solarcell', `${q2.quotation.id}/revise`, 'POST', { title: 'Rev B' }, staffToken),
  ]);
  const statuses = [revA.status, revB.status].sort((a, b) => a - b);
  assert.deepEqual(statuses, [201, 409]);
  const drafts = await db.prepare(`SELECT id FROM quotations WHERE supersedes_quote_id = ?`).bind(q2.quotation.id).all();
  assert.equal(drafts.results.length, 1);
});

function setDomInputValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, win: JSDOM['window']) {
  const proto =
    el instanceof win.HTMLTextAreaElement
      ? win.HTMLTextAreaElement.prototype
      : el instanceof win.HTMLSelectElement
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else (el as HTMLInputElement).value = value;
  if (el instanceof win.HTMLSelectElement) {
    el.dispatchEvent(new win.Event('change', { bubbles: true }));
    return;
  }
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  el.dispatchEvent(new win.Event('change', { bubbles: true }));
  const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
  if (propsKey) {
    const handler = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[propsKey]?.onChange;
    handler?.({ target: { value } });
  }
}

async function withJsdom(
  url: string,
  run: (ctx: { dom: JSDOM; container: HTMLElement; settle: (ms?: number) => Promise<void> }) => Promise<void>
) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url });
  const keys = [
    'window',
    'document',
    'navigator',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'IS_REACT_ACT_ENVIRONMENT',
  ];
  const saved = new Map(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const originalFetch = globalThis.fetch;
  for (const k of keys) {
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: k === 'IS_REACT_ACT_ENVIRONMENT' ? true : (dom.window as unknown as Record<string, unknown>)[k],
    });
  }
  const container = dom.window.document.getElementById('root')!;
  const settle = async (ms = 25) => {
    await act(async () => {
      await new Promise(r => setTimeout(r, ms));
    });
  };
  try {
    await run({ dom, container, settle });
  } finally {
    globalThis.fetch = originalFetch;
    for (const k of keys) {
      const desc = saved.get(k);
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete (globalThis as unknown as Record<string, unknown>)[k];
    }
    dom.window.close();
  }
}

test('Thread #3 & #13 UI: ?quote_token= routes unauthenticated customer to PublicQuotationPortal with accept, refuse, and error states', async () => {
  await withJsdom('http://localhost/?quote_token=qtok_portal_valid', async ({ dom, container, settle }) => {
    const baseQuote = {
      id: 'QUOTE-PORTAL-1',
      workspace_id: 'solarcell',
      job_id: 'JOB-D1-101',
      brand_id: 'solarcell',
      external_myob_ref: 'MYOB-Q-PORTAL',
      title: 'Solar Switchboard Upgrade',
      subtotal: 1000,
      gst: 100,
      total: 1100,
      terms_version: 'v5.0',
      terms_content_snapshot: 'Frozen Terms v5.0: 14-day validity.',
      frozen_issuer_snapshot: 'Solarcell Pty Ltd • ABN 12 345 678 901',
      acceptance_status: 'SENT' as const,
      issued_at: '2026-11-02T09:00:00+10:00',
      expires_at: '2026-11-16T09:00:00+10:00',
      accepted_at: null,
      accepted_by_name: null,
      refused_at: null,
      refusal_reason: null,
      revoked_at: null,
      revocation_reason: null,
      line_items: [{ id: 'LI-1', line_order: 0, description: 'Switchboard Upgrade', quantity: 1, unit_price: 1000, total: 1000 }],
      follow_ups: [{ id: 'FU-1', stage: 'STAGE_1_COURTESY', scheduled_date: '2026-11-05', status: 'SCHEDULED', channel: 'EMAIL_SIMULATED' }],
      events: [{ id: 'EV-1', event_type: 'EMAIL_DISPATCHED', details: { transport: 'SANDBOX_SYNTHETIC' }, created_at: '2026-11-02T09:00:00+10:00' }],
    };

    const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
    let currentStatus: 'SENT' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | 'SUPERSEDED' | 'REFUSED' = 'SENT';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
      requests.push({ url, method, body });

      if (url.includes('/qtok_invalid_404')) {
        return Response.json(
          { code: 'NOT_FOUND', title: 'Not Found', detail: 'Invalid or unknown acceptance token' },
          { status: 404, headers: { 'Content-Type': 'application/problem+json' } }
        );
      }
      if (url.endsWith('/accept') && method === 'POST') {
        currentStatus = 'ACCEPTED';
        return Response.json({
          quotation: { ...baseQuote, acceptance_status: 'ACCEPTED', accepted_by_name: body?.accepted_by_name || 'Customer', accepted_at: '2026-11-02T10:00:00+10:00' },
        });
      }
      if (url.endsWith('/refuse') && method === 'POST') {
        currentStatus = 'REFUSED';
        return Response.json({
          quotation: { ...baseQuote, acceptance_status: 'REFUSED', refusal_reason: body?.reason || 'Declined' },
        });
      }
      return Response.json({
        quotation: {
          ...baseQuote,
          acceptance_status: currentStatus,
          ...(currentStatus === 'ACCEPTED' ? { accepted_by_name: 'Alice Customer', accepted_at: '2026-11-02T10:00:00+10:00' } : {}),
          ...(currentStatus === 'REVOKED' ? { revocation_reason: 'Superseded by office cancellation' } : {}),
        },
      });
    }) as typeof fetch;

    // 1. Unauthenticated <App /> renders PublicQuotationPortal (NOT SignInScreen) when ?quote_token= is in URL
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(App));
    });
    await settle();

    assert.ok(container.querySelector('[data-testid="public-quotation-portal"]'), 'PublicQuotationPortal renders on ?quote_token=');
    assert.equal(container.textContent?.includes('CABMS Session Access'), false, 'Auth sign-in screen must not block public token route');
    assert.match(container.textContent || '', /Simulated \/ Sandbox Notice/);
    assert.match(container.textContent || '', /Frozen Terms v5\.0/);
    assert.match(container.textContent || '', /\$1100\.00/);
    assert.match(container.textContent || '', /\$100\.00/);

    // Also verify <AppContent /> directly inside CabmsProvider renders PublicQuotationPortal before auth gate
    await act(async () => {
      root.render(React.createElement(CabmsProvider, null, React.createElement(AppContent)));
    });
    await settle();
    assert.ok(container.querySelector('[data-testid="public-quotation-portal"]'));

    // Submit acceptance with confirmed: true and accepted_by_name
    const nameInput = container.querySelector<HTMLInputElement>('#public-accept-name')!;
    const confirmCheckbox = container.querySelector<HTMLInputElement>('#public-accept-confirm')!;
    await act(async () => {
      setDomInputValue(nameInput, 'Alice Customer', dom.window);
      confirmCheckbox.click();
    });
    const acceptBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Accept & Authorize Quotation'))!;
    await act(async () => {
      acceptBtn.click();
    });
    await settle();
    const acceptReq = requests.find(r => r.url.endsWith('/accept'));
    assert.ok(acceptReq);
    assert.deepEqual(acceptReq.body, { confirmed: true, accepted_by_name: 'Alice Customer' });
    assert.match(container.textContent || '', /Quotation Already Accepted/);

    // Reset to SENT and test Refuse
    currentStatus = 'SENT';
    await act(async () => {
      root.render(React.createElement(PublicQuotationPortal, { token: 'qtok_portal_refuse' }));
    });
    await settle();
    const refuseBox = container.querySelector<HTMLTextAreaElement>('#public-refuse-reason')!;
    await act(async () => {
      setDomInputValue(refuseBox, 'Need different installation date', dom.window);
    });
    const refuseBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Refuse Quotation'))!;
    await act(async () => {
      refuseBtn.click();
    });
    await settle();
    const refuseReq = requests.find(r => r.url.endsWith('/refuse'));
    assert.ok(refuseReq);
    assert.deepEqual(refuseReq.body, { reason: 'Need different installation date' });
    assert.match(container.textContent || '', /Quotation Refused/);

    // Verify clean error states: invalid 404, EXPIRED, REVOKED, SUPERSEDED, ACCEPTED
    await act(async () => {
      root.render(React.createElement(PublicQuotationPortal, { token: 'qtok_invalid_404' }));
    });
    await settle();
    assert.match(container.textContent || '', /Invalid or Unknown Quotation Link/);

    for (const [status, expectedHeading] of [
      ['EXPIRED', /Quotation Expired/],
      ['REVOKED', /Quotation Link Revoked/],
      ['SUPERSEDED', /Quotation Superseded/],
      ['ACCEPTED', /Quotation Already Accepted/],
    ] as const) {
      currentStatus = status;
      await act(async () => {
        root.render(React.createElement(PublicQuotationPortal, { token: `qtok_state_${status}` }));
      });
      await settle();
      assert.match(container.textContent || '', expectedHeading);
      assert.equal(container.querySelector('#public-accept-confirm'), null, `${status} state must not show active accept button`);
    }

    await act(async () => root.unmount());
  });
});

test('Thread #19 & #20 UI: QuotesAcceptanceView uses persisted compliance-jobs, discards stale fetches, guards actions, and recovers failed /send', async () => {
  await withJsdom('http://localhost/', async ({ dom, container, settle }) => {
    let releaseSlowQuote1: () => void = () => {};
    let delayQuote1Once = false;
    let sendAttempt = 0;
    const actionRequests: string[] = [];

    const solarJobs = [
      { id: 'JOB-D1-1', workspace_id: 'solarcell', job_type_id: 'JT-1', policy_id: 'POL-1', title: 'Persisted Solar Job 1', status: 'OPEN', version: 1, assignee_id: null, customer_name: 'Bob Solar', site_address: '1 Sun Rd' },
      { id: 'JOB-D1-2', workspace_id: 'solarcell', job_type_id: 'JT-1', policy_id: 'POL-1', title: 'Persisted Solar Job 2', status: 'OPEN', version: 1, assignee_id: null, customer_name: 'Cara Solar', site_address: '2 Sun Rd' },
    ];
    const cctvJobs = [
      { id: 'JOB-CCTV-9', workspace_id: 'cctv', job_type_id: 'JT-2', policy_id: 'POL-2', title: 'Persisted CCTV Job 9', status: 'OPEN', version: 1, assignee_id: null, customer_name: 'Dan CCTV', site_address: '9 Cam St' },
    ];

    const makeQuote = (id: string, ws: string, jobId: string, title: string, status: 'DRAFT' | 'SENT' = 'DRAFT') => ({
      id,
      workspace_id: ws,
      job_id: jobId,
      customer_id: null,
      brand_id: ws,
      external_myob_ref: `MYOB-${id}`,
      title,
      subtotal: 500,
      gst: 50,
      total: 550,
      terms_version: status === 'SENT' ? 'v1.0' : null,
      terms_content_snapshot: status === 'SENT' ? 'Frozen Terms v1.0' : null,
      frozen_issuer_snapshot: 'Issuer',
      acceptance_status: status,
      issued_at: status === 'SENT' ? '2026-11-02T09:00:00+10:00' : null,
      expires_at: status === 'SENT' ? '2026-11-16T09:00:00+10:00' : null,
      accepted_at: null,
      accepted_by_name: null,
      refusal_reason: null,
      revocation_reason: null,
      line_items: [{ id: 'LI-1', description: title, quantity: 1, unit_price: 500, total: 500 }],
      follow_ups: [],
      events: [],
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || 'GET';

      if (url.includes('/workspaces/solarcell/compliance-jobs')) {
        return Response.json({ jobs: solarJobs, after: null });
      }
      if (url.includes('/workspaces/cctv/compliance-jobs')) {
        return Response.json({ jobs: cctvJobs, after: null });
      }
      if (url.includes('/workspaces/solarcell/quotations?job_id=JOB-D1-1')) {
        if (delayQuote1Once) {
          delayQuote1Once = false;
          await new Promise<void>(resolve => { releaseSlowQuote1 = resolve; });
        }
        return Response.json({ quotations: [makeQuote('Q-D1-1', 'solarcell', 'JOB-D1-1', 'Quote For Job 1')] });
      }
      if (url.includes('/workspaces/solarcell/quotations?job_id=JOB-D1-2')) {
        return Response.json({ quotations: [makeQuote('Q-D1-2', 'solarcell', 'JOB-D1-2', 'Quote For Job 2')] });
      }
      if (url.includes('/workspaces/cctv/quotations?job_id=JOB-CCTV-9')) {
        return Response.json({ quotations: [makeQuote('Q-CCTV-9', 'cctv', 'JOB-CCTV-9', 'Quote For CCTV 9')] });
      }
      if (url.endsWith('/send') && method === 'POST') {
        sendAttempt += 1;
        actionRequests.push(url);
        if (sendAttempt === 1) {
          return Response.json({
            quotation: {
              ...makeQuote('Q-D1-2', 'solarcell', 'JOB-D1-2', 'Quote For Job 2', 'SENT'),
              events: [{ id: 'E1', quote_id: 'Q-D1-2', event_type: 'EMAIL_DISPATCH_FAILED', actor_name: 'Staff', details: { status: 'FAILED', recipient_email: 'bob@example.invalid', error: '550 Rejected' }, created_at: '2026-11-02T09:00:00+10:00' }],
            },
            acceptance_token: 'qtok_failed_first_1234',
            email_dispatch: { deliveryId: 'del_fail_1', status: 'FAILED', transport: 'smtp', error: '550 Rejected' },
          });
        }
        return Response.json({
          quotation: {
            ...makeQuote('Q-D1-2', 'solarcell', 'JOB-D1-2', 'Quote For Job 2', 'SENT'),
            events: [{ id: 'E2', quote_id: 'Q-D1-2', event_type: 'EMAIL_DISPATCHED', actor_name: 'Staff', details: { status: 'SENT', recipient_email: 'bob@example.invalid' }, created_at: '2026-11-02T09:01:00+10:00' }],
          },
          acceptance_token: 'qtok_recovered_portal_5678',
          email_dispatch: { deliveryId: 'del_ok_2', status: 'SENT', transport: 'smtp' },
        });
      }
      return Response.json({ quotations: [] });
    }) as typeof fetch;

    let setWorkspace!: (ws: 'solarcell' | 'cctv' | 'smart_home') => void;
    function Harness() {
      const [workspaceId, selectWorkspace] = React.useState<'solarcell' | 'cctv' | 'smart_home'>('solarcell');
      setWorkspace = selectWorkspace;
      const session: Session = {
        profile: {
          user: { id: 'u1', email: 'staff@example.invalid', display_name: 'Staff' },
          memberships: [
            { workspace_id: 'solarcell', name: 'Solarcell', role: 'office_staff' },
            { workspace_id: 'cctv', name: 'Gold Coast CCTV', role: 'office_staff' },
          ],
        },
        workspaceId,
        selectWorkspace,
        token: async () => 'staff_token',
        login: async () => {},
        logout: async () => {},
        invalidate: () => {},
        loading: false,
        error: '',
      };
      return React.createElement(
        SessionContext.Provider,
        { value: session },
        React.createElement(CabmsProvider, null, React.createElement(QuotesAcceptanceView))
      );
    }

    const root = createRoot(container);
    delayQuote1Once = true;
    await act(async () => {
      root.render(React.createElement(Harness));
    });
    await settle();

    // Persisted compliance jobs replaced demo CabmsContext.jobs
    const jobSelect = container.querySelector<HTMLSelectElement>('#quote-work-order')!;
    const optionValues = Array.from(jobSelect.options).map(o => o.value);
    assert.deepEqual(optionValues, ['JOB-D1-1', 'JOB-D1-2']);
    assert.equal(optionValues.includes('JOB-2026-101'), false, 'Demo CabmsContext.jobs must not appear in authenticated mode');

    // While JOB-D1-1 quote fetch is still pending, switch to JOB-D1-2 (fast response)
    await act(async () => {
      setDomInputValue(jobSelect, 'JOB-D1-2', dom.window);
    });
    await settle();
    assert.match(container.textContent || '', /Quote For Job 2/);

    // Now resolve the slow stale JOB-D1-1 response (even ignoring AbortSignal!) -> MUST be discarded!
    await act(async () => {
      releaseSlowQuote1?.();
      await new Promise(r => setTimeout(r, 20));
    });
    assert.match(container.textContent || '', /Quote For Job 2/);
    assert.equal(container.textContent?.includes('Quote For Job 1'), false, 'Stale out-of-order fetch response must be discarded');

    // Failed /send surfaces recovery panel, and retry succeeds + surfaces ?quote_token= URL
    const emailInput = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    await act(async () => {
      setDomInputValue(emailInput, 'bob@example.invalid', dom.window);
    });
    const sendBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Send & Freeze Terms Snapshot'))!;
    await act(async () => {
      sendBtn.click();
    });
    await settle();

    assert.ok(container.querySelector('[data-testid="d1-send-recovery-panel"]'), 'Failed send must expose recovery panel');
    const retryBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Retry / Resend Quote Email'))!;
    await act(async () => {
      retryBtn.click();
    });
    await settle();

    const portalBox = container.querySelector('[data-testid="office-portal-link-box"]');
    assert.ok(portalBox, 'Successful send must surface ?quote_token= portal link box');
    assert.ok(portalBox.textContent?.includes('?quote_token=qtok_recovered_portal_5678'));

    // Switching workspaceId immediately clears d1Quote and loads cctv compliance jobs
    await act(async () => {
      setWorkspace('cctv');
    });
    await settle();
    const cctvOptions = Array.from(container.querySelector<HTMLSelectElement>('#quote-work-order')!.options).map(o => o.value);
    assert.deepEqual(cctvOptions, ['JOB-CCTV-9']);
    assert.match(container.textContent || '', /Quote For CCTV 9/);
    assert.equal(container.textContent?.includes('Quote For Job 2'), false);

    await act(async () => root.unmount());
  });
});
