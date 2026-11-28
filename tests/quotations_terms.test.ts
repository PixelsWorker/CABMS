import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalD1Database, type LocalD1Database } from '../backend/db/d1.ts';
import { G01_MIGRATION_MANIFEST, runLocalMigrations } from '../backend/db/migrate.ts';
import { createAuthenticationService } from '../backend/workers/auth.ts';
import {
  handleQuotations,
  handlePublicQuotationToken,
  type QuoteEmailDispatchRequest,
  type QuotationsHandlerOptions,
} from '../backend/workers/routes/quotations.ts';
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
