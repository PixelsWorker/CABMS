/**
 * CABMS Worker Route Handlers: Customers & MYOB Sandbox Integration
 *
 * Implements workspace-scoped, D1-backed customer management:
 * - GET    /api/v1/workspaces/:workspaceId/customers
 * - POST   /api/v1/workspaces/:workspaceId/customers
 * - POST   /api/v1/workspaces/:workspaceId/customers/check-duplicate
 * - GET    /api/v1/workspaces/:workspaceId/customers/:customerId
 * - PATCH  /api/v1/workspaces/:workspaceId/customers/:customerId
 * - POST   /api/v1/workspaces/:workspaceId/customers/:customerId/retry-sync
 * - POST   /api/v1/workspaces/:workspaceId/customers/:customerId/reconcile
 */

import type { Env } from '../../types.ts';
import type { D1Database } from '../../db/d1.ts';
import { authorizeWorkspaceAccess, type AuthenticationService, productionAuthenticationService } from '../auth.ts';
import {
  accessDeniedResponse,
  authenticationRequiredResponse,
  createProblemResponse,
  resourceNotFoundResponse,
  validationErrorResponse,
} from '../problem.ts';
import { StructuredLogger } from '../logger.ts';
import { SandboxMyobGateway, type MyobWriteThroughOutcome } from '../../../src/services/myobGateway.ts';

const VALID_BRANDS = new Set(['solarcell', 'smart_home', 'cctv']);
const VALID_OUTCOMES = new Set<MyobWriteThroughOutcome>(['SUCCESS', 'FAILURE', 'UNCERTAIN']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CustomerRow {
  id: string;
  workspace_id: string;
  myob_customer_id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  billing_address: string;
  sync_status: 'SYNCED' | 'FAILED' | 'UNCERTAIN' | 'PENDING';
  is_recoverable_draft: number;
  notes: string | null;
  myob_sandbox_mode: number;
  last_sync_error: string | null;
  last_synced_at: string | null;
  version: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface SyncLogRow {
  id: string;
  operation: string;
  outcome: string;
  myob_card_id: string | null;
  is_sandbox: number;
  actor_user_id: string;
  detail: string | null;
  created_at: string;
}

export interface CustomerApiRecord {
  id: string;
  workspace_id: string;
  myob_customer_id: string;
  name: string;
  contact_person: string;
  email: string;
  phone: string;
  billing_address: string;
  brand_affiliations: string[];
  sync_status: 'SYNCED' | 'FAILED' | 'UNCERTAIN' | 'PENDING';
  is_recoverable_draft: boolean;
  notes: string | null;
  myob_sandbox_mode: boolean;
  sandbox_label: 'SANDBOX_SYNTHETIC';
  last_sync_error: string | null;
  last_synced_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  activity_history?: Array<{
    timestamp: string;
    action: string;
    actor: string;
    notes?: string;
  }>;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

async function loadBrandsForCustomers(
  db: D1Database,
  workspaceId: string,
  customerIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (customerIds.length === 0) return map;
  const placeholders = customerIds.map(() => '?').join(', ');
  const rows = await db
    .prepare(
      `SELECT customer_id, brand_id FROM customer_brand_affiliations
       WHERE workspace_id = ? AND customer_id IN (${placeholders})
       ORDER BY created_at ASC, brand_id ASC`
    )
    .bind(workspaceId, ...customerIds)
    .all<{ customer_id: string; brand_id: string }>();
  for (const row of rows.results) {
    const list = map.get(row.customer_id) ?? [];
    list.push(row.brand_id);
    map.set(row.customer_id, list);
  }
  return map;
}

function formatCustomer(
  row: CustomerRow,
  brands: string[],
  history?: SyncLogRow[]
): CustomerApiRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    myob_customer_id: row.myob_customer_id,
    name: row.name,
    contact_person: row.contact_person,
    email: row.email,
    phone: row.phone,
    billing_address: row.billing_address,
    brand_affiliations: brands,
    sync_status: row.sync_status,
    is_recoverable_draft: row.is_recoverable_draft === 1,
    notes: row.notes,
    myob_sandbox_mode: row.myob_sandbox_mode === 1,
    sandbox_label: 'SANDBOX_SYNTHETIC',
    last_sync_error: row.last_sync_error,
    last_synced_at: row.last_synced_at,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(history
      ? {
          activity_history: history.map(h => ({
            timestamp: h.created_at,
            action: `${h.operation} (${h.outcome})${h.myob_card_id ? ` [${h.myob_card_id}]` : ''}`,
            actor: h.actor_user_id,
            ...(h.detail ? { notes: h.detail } : {}),
          })),
        }
      : {}),
  };
}

async function detectDuplicate(
  db: D1Database,
  workspaceId: string,
  candidate: { name?: string; email?: string; phone?: string },
  excludeCustomerId?: string
): Promise<{ isDuplicate: boolean; field?: 'email' | 'phone' | 'name'; matchedCustomer?: CustomerApiRecord }> {
  const normEmail = candidate.email ? candidate.email.trim().toLowerCase() : '';
  const normPhone = candidate.phone ? normalizePhone(candidate.phone.trim()) : '';
  const normName = candidate.name ? candidate.name.trim().toLowerCase() : '';

  const rows = await db
    .prepare('SELECT * FROM customers WHERE workspace_id = ? ORDER BY created_at DESC')
    .bind(workspaceId)
    .all<CustomerRow>();

  for (const row of rows.results) {
    if (excludeCustomerId && row.id === excludeCustomerId) continue;
    let matchedField: 'email' | 'phone' | 'name' | null = null;
    if (normEmail && row.email.trim().toLowerCase() === normEmail) {
      matchedField = 'email';
    } else if (normPhone && normPhone !== '0400000000') {
      const existingPhone = normalizePhone(row.phone);
      if (existingPhone && existingPhone !== '0400000000' && existingPhone === normPhone) {
        matchedField = 'phone';
      }
    } else if (normName && row.name.trim().toLowerCase() === normName) {
      matchedField = 'name';
    }

    if (matchedField) {
      const brands = await loadBrandsForCustomers(db, workspaceId, [row.id]);
      return {
        isDuplicate: true,
        field: matchedField,
        matchedCustomer: formatCustomer(row, brands.get(row.id) ?? []),
      };
    }
  }

  return { isDuplicate: false };
}

function validateBrandAffiliations(raw: unknown, fallbackBrand: string): { brands: string[]; error?: string } {
  if (raw === undefined) {
    return { brands: VALID_BRANDS.has(fallbackBrand) ? [fallbackBrand] : ['solarcell'] };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { brands: [], error: 'brand_affiliations must be a non-empty array of valid brand IDs' };
  }
  const unique: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string' || !VALID_BRANDS.has(item)) {
      return { brands: [], error: `Invalid brand affiliation: ${String(item)}` };
    }
    if (!unique.includes(item)) unique.push(item);
  }
  return { brands: unique };
}

async function getCustomerWithDetails(
  db: D1Database,
  workspaceId: string,
  customerId: string
): Promise<CustomerApiRecord | null> {
  const row = await db
    .prepare('SELECT * FROM customers WHERE workspace_id = ? AND id = ?')
    .bind(workspaceId, customerId)
    .first<CustomerRow>();
  if (!row) return null;
  const [brandsMap, logs] = await Promise.all([
    loadBrandsForCustomers(db, workspaceId, [row.id]),
    db
      .prepare(
        'SELECT id, operation, outcome, myob_card_id, is_sandbox, actor_user_id, detail, created_at FROM customer_myob_sync_log WHERE workspace_id = ? AND customer_id = ? ORDER BY created_at ASC'
      )
      .bind(workspaceId, row.id)
      .all<SyncLogRow>(),
  ]);
  return formatCustomer(row, brandsMap.get(row.id) ?? [], logs.results);
}

export async function handleCustomers(
  request: Request,
  env: Env,
  workspaceId: string,
  customerId: string | undefined,
  action: string | undefined,
  requestId: string,
  authentication: AuthenticationService = productionAuthenticationService,
  gateway: SandboxMyobGateway = new SandboxMyobGateway()
): Promise<Response> {
  const logger = new StructuredLogger(requestId, workspaceId);
  const auth = await authentication.authenticateRequest(env.DB, request, env);
  if (!auth) {
    return authenticationRequiredResponse('Valid staff authentication token is required', requestId);
  }

  const membership = await authorizeWorkspaceAccess(env.DB, workspaceId, auth);
  if (!membership || membership.role === 'technician') {
    return accessDeniedResponse(
      'Technicians are restricted to viewing only the site contact details for their assigned work orders.',
      requestId
    );
  }

  const url = new URL(request.url);
  const method = request.method;
  const reply = (data: unknown, status = 200, extraHeaders?: Record<string, string>) =>
    Response.json(data, { status, headers: { 'X-Request-Id': requestId, ...(extraHeaders ?? {}) } });

  // Collection routes: /customers and /customers/check-duplicate
  if (!customerId) {
    if (action === 'check-duplicate') {
      if (method !== 'POST') {
        return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only POST is allowed', requestId, undefined, undefined, { Allow: 'POST' });
      }
      let body: unknown;
      try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON payload', [], requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return validationErrorResponse('Request body must be a JSON object', [], requestId);
      }
      const b = body as Record<string, unknown>;
      const dup = await detectDuplicate(
        env.DB,
        workspaceId,
        {
          name: typeof b.name === 'string' ? b.name : undefined,
          email: typeof b.email === 'string' ? b.email : undefined,
          phone: typeof b.phone === 'string' ? b.phone : undefined,
        },
        typeof b.exclude_customer_id === 'string' ? b.exclude_customer_id : undefined
      );
      return reply({
        is_duplicate: dup.isDuplicate,
        ...(dup.field ? { field: dup.field } : {}),
        ...(dup.matchedCustomer ? { matched_customer: dup.matchedCustomer } : {}),
      });
    }

    if (method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const brand = (url.searchParams.get('brand') || '').trim();
      const syncStatus = (url.searchParams.get('sync_status') || '').trim().toUpperCase();

      const conditions = ['c.workspace_id = ?'];
      const params: unknown[] = [workspaceId];

      if (q) {
        conditions.push(
          '(LOWER(c.name) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.phone) LIKE ? OR LOWER(c.myob_customer_id) LIKE ? OR LOWER(c.contact_person) LIKE ? OR LOWER(c.id) LIKE ?)'
        );
        const like = `%${q}%`;
        params.push(like, like, like, like, like, like);
      }
      if (syncStatus && ['SYNCED', 'FAILED', 'UNCERTAIN', 'PENDING'].includes(syncStatus)) {
        conditions.push('c.sync_status = ?');
        params.push(syncStatus);
      }
      if (brand && brand !== 'all') {
        if (!VALID_BRANDS.has(brand)) {
          return validationErrorResponse('Invalid brand filter', [{ pointer: '/query/brand', code: 'INVALID_BRAND', message: 'Unknown brand filter' }], requestId);
        }
        conditions.push('EXISTS (SELECT 1 FROM customer_brand_affiliations cba WHERE cba.customer_id = c.id AND cba.workspace_id = c.workspace_id AND cba.brand_id = ?)');
        params.push(brand);
      }

      const rows = await env.DB
        .prepare(`SELECT c.* FROM customers c WHERE ${conditions.join(' AND ')} ORDER BY c.created_at DESC`)
        .bind(...params)
        .all<CustomerRow>();

      const brandsMap = await loadBrandsForCustomers(
        env.DB,
        workspaceId,
        rows.results.map(r => r.id)
      );

      return reply({
        customers: rows.results.map(r => formatCustomer(r, brandsMap.get(r.id) ?? [])),
        myob_connection: {
          mode: 'sandbox',
          is_sandbox: true,
          status: 'CONNECTED',
          company_file: 'MYOB Business Sandbox — Shared Synthetic Company File',
        },
      });
    }

    if (method === 'POST') {
      let body: unknown;
      try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON payload', [], requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return validationErrorResponse('Request body must be a JSON object', [], requestId);
      }
      const b = body as Record<string, unknown>;
      const idempotencyKey =
        request.headers.get('Idempotency-Key')?.trim() ||
        (typeof b.idempotency_key === 'string' ? b.idempotency_key.trim() : '') ||
        `create-${crypto.randomUUID()}`;

      // Check durable idempotency log first
      const existingSync = await env.DB
        .prepare('SELECT customer_id FROM customer_myob_sync_log WHERE workspace_id = ? AND idempotency_key = ?')
        .bind(workspaceId, idempotencyKey)
        .first<{ customer_id: string }>();

      if (existingSync) {
        const existingCustomer = await getCustomerWithDetails(env.DB, workspaceId, existingSync.customer_id);
        if (existingCustomer) {
          return reply({ customer: existingCustomer, idempotent_replay: true }, 200, { 'X-Idempotent-Replay': 'true' });
        }
      }

      const name = typeof b.name === 'string' ? b.name.trim() : '';
      const email = typeof b.email === 'string' ? b.email.trim() : '';
      const contactPerson = typeof b.contact_person === 'string' && b.contact_person.trim() ? b.contact_person.trim() : name;
      const phone = typeof b.phone === 'string' ? b.phone.trim() : '';
      const billingAddress = typeof b.billing_address === 'string' ? b.billing_address.trim() : '';
      const notes = typeof b.notes === 'string' ? b.notes.trim() : null;
      const forceDistinct = b.force_distinct === true;
      const simulatedOutcomeRaw = typeof b.simulated_outcome === 'string' ? b.simulated_outcome : 'SUCCESS';

      const errors: Array<{ pointer: string; code: string; message: string }> = [];
      if (!name || name.length > 160) {
        errors.push({ pointer: '/name', code: 'REQUIRED', message: 'Customer name is required (max 160 chars)' });
      }
      if (!email || !EMAIL_REGEX.test(email) || email.length > 160) {
        errors.push({ pointer: '/email', code: 'INVALID_EMAIL', message: 'A valid customer email is required' });
      }
      if (!VALID_OUTCOMES.has(simulatedOutcomeRaw as MyobWriteThroughOutcome)) {
        errors.push({ pointer: '/simulated_outcome', code: 'INVALID_ENUM', message: 'simulated_outcome must be SUCCESS, FAILURE, or UNCERTAIN' });
      }
      const { brands, error: brandError } = validateBrandAffiliations(b.brand_affiliations, workspaceId);
      if (brandError) {
        errors.push({ pointer: '/brand_affiliations', code: 'INVALID_BRANDS', message: brandError });
      }
      if (errors.length > 0) {
        return validationErrorResponse('Customer validation failed', errors, requestId);
      }

      if (!forceDistinct) {
        const dup = await detectDuplicate(env.DB, workspaceId, { name, email, phone });
        if (dup.isDuplicate && dup.matchedCustomer) {
          return createProblemResponse(
            409,
            'DUPLICATE_CUSTOMER',
            'duplicate-customer',
            'Potential Customer Duplicate Detected',
            `A customer matching ${dup.field} already exists (${dup.matchedCustomer.name} - ${dup.matchedCustomer.myob_customer_id}).`,
            requestId,
            undefined,
            [{ pointer: `/${dup.field}`, code: 'DUPLICATE_DETECTED', message: `Matches existing customer ${dup.matchedCustomer.id}` }]
          );
        }
      }

      // Re-verify membership right before write boundary
      const currentMembership = await authorizeWorkspaceAccess(env.DB, workspaceId, auth);
      if (!currentMembership || currentMembership.role === 'technician') {
        return accessDeniedResponse('Membership or role no longer permits customer writes', requestId);
      }

      const nowIso = new Date().toISOString();
      const newCustomerId = `CUST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const myobRes = await gateway.writeThroughCustomer(
        workspaceId,
        { name, contactPerson, email, phone, billingAddress, brandAffiliations: brands, notes: notes ?? undefined },
        { idempotencyKey, simulatedOutcome: simulatedOutcomeRaw as MyobWriteThroughOutcome, nowIso }
      );

      const isDraft = myobRes.status === 'FAILED' || myobRes.status === 'UNCERTAIN' ? 1 : 0;

      const statements = [
        env.DB
          .prepare(
            `INSERT INTO customers (
              id, workspace_id, myob_customer_id, name, contact_person, email, phone,
              billing_address, sync_status, is_recoverable_draft, notes, myob_sandbox_mode,
              last_sync_error, last_synced_at, version, created_by, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?, ?)`
          )
          .bind(
            newCustomerId,
            workspaceId,
            myobRes.myobCustomerId,
            name,
            contactPerson,
            email,
            phone,
            billingAddress,
            myobRes.status,
            isDraft,
            notes,
            myobRes.error ?? null,
            myobRes.syncedAt ?? null,
            auth.userId,
            nowIso,
            nowIso
          ),
        ...brands.map(brandId =>
          env.DB
            .prepare('INSERT INTO customer_brand_affiliations (customer_id, workspace_id, brand_id, created_at) VALUES (?, ?, ?, ?)')
            .bind(newCustomerId, workspaceId, brandId, nowIso)
        ),
        env.DB
          .prepare(
            `INSERT INTO customer_myob_sync_log (
              id, workspace_id, customer_id, idempotency_key, operation, outcome,
              myob_card_id, is_sandbox, actor_user_id, request_id, detail, created_at
            ) VALUES (?, ?, ?, ?, 'CREATE', ?, ?, 1, ?, ?, ?, ?)`
          )
          .bind(
            `SYNC-${crypto.randomUUID().slice(0, 8)}`,
            workspaceId,
            newCustomerId,
            idempotencyKey,
            myobRes.status,
            myobRes.myobCustomerId,
            auth.userId,
            requestId,
            myobRes.message,
            nowIso
          ),
      ];

      await env.DB.batch(statements);
      logger.info('CUSTOMER_CREATED', 'Customer persisted with MYOB sandbox write-through', {
        fields: { customer_id: newCustomerId, sync_status: myobRes.status, myob_customer_id: myobRes.myobCustomerId },
      });

      const created = await getCustomerWithDetails(env.DB, workspaceId, newCustomerId);
      return reply({ customer: created, myob_result: myobRes }, 201);
    }

    return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Method not allowed for customers collection', requestId, undefined, undefined, { Allow: 'GET, POST' });
  }

  // Item routes: /customers/:customerId and actions (/retry-sync, /reconcile)
  const existing = await getCustomerWithDetails(env.DB, workspaceId, customerId);
  if (!existing) {
    return resourceNotFoundResponse(`Customer '${customerId}' not found in workspace`, requestId);
  }

  if (!action) {
    if (method === 'GET') {
      return reply({ customer: existing });
    }

    if (method === 'PATCH') {
      let body: unknown;
      try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON payload', [], requestId); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return validationErrorResponse('Request body must be a JSON object', [], requestId);
      }
      const b = body as Record<string, unknown>;
      const nextName = typeof b.name === 'string' ? b.name.trim() : existing.name;
      const nextContact = typeof b.contact_person === 'string' ? b.contact_person.trim() : existing.contact_person;
      const nextEmail = typeof b.email === 'string' ? b.email.trim() : existing.email;
      const nextPhone = typeof b.phone === 'string' ? b.phone.trim() : existing.phone;
      const nextAddress = typeof b.billing_address === 'string' ? b.billing_address.trim() : existing.billing_address;
      const nextNotes = b.notes === undefined ? existing.notes : (typeof b.notes === 'string' ? b.notes.trim() : null);

      const errors: Array<{ pointer: string; code: string; message: string }> = [];
      if (!nextName || nextName.length > 160) {
        errors.push({ pointer: '/name', code: 'REQUIRED', message: 'Customer name is required (max 160 chars)' });
      }
      if (!nextEmail || !EMAIL_REGEX.test(nextEmail) || nextEmail.length > 160) {
        errors.push({ pointer: '/email', code: 'INVALID_EMAIL', message: 'A valid customer email is required' });
      }
      const brandsValidation =
        b.brand_affiliations === undefined
          ? { brands: existing.brand_affiliations }
          : validateBrandAffiliations(b.brand_affiliations, workspaceId);
      if (brandsValidation.error) {
        errors.push({ pointer: '/brand_affiliations', code: 'INVALID_BRANDS', message: brandsValidation.error });
      }
      if (errors.length > 0) {
        return validationErrorResponse('Customer update validation failed', errors, requestId);
      }

      const currentMembership = await authorizeWorkspaceAccess(env.DB, workspaceId, auth);
      if (!currentMembership || currentMembership.role === 'technician') {
        return accessDeniedResponse('Membership or role no longer permits customer writes', requestId);
      }

      const nowIso = new Date().toISOString();
      const updateStatements = [
        env.DB
          .prepare(
            `UPDATE customers
             SET name = ?, contact_person = ?, email = ?, phone = ?, billing_address = ?,
                 notes = ?, version = version + 1, updated_at = ?
             WHERE workspace_id = ? AND id = ?`
          )
          .bind(nextName, nextContact || nextName, nextEmail, nextPhone, nextAddress, nextNotes, nowIso, workspaceId, customerId),
      ];

      if (b.brand_affiliations !== undefined) {
        updateStatements.push(
          env.DB
            .prepare('DELETE FROM customer_brand_affiliations WHERE workspace_id = ? AND customer_id = ?')
            .bind(workspaceId, customerId)
        );
        for (const brandId of brandsValidation.brands) {
          updateStatements.push(
            env.DB
              .prepare('INSERT INTO customer_brand_affiliations (customer_id, workspace_id, brand_id, created_at) VALUES (?, ?, ?, ?)')
              .bind(customerId, workspaceId, brandId, nowIso)
          );
        }
      }

      updateStatements.push(
        env.DB
          .prepare(
            `INSERT INTO customer_myob_sync_log (
              id, workspace_id, customer_id, idempotency_key, operation, outcome,
              myob_card_id, is_sandbox, actor_user_id, request_id, detail, created_at
            ) VALUES (?, ?, ?, ?, 'UPDATE', ?, ?, 1, ?, ?, ?, ?)`
          )
          .bind(
            `SYNC-${crypto.randomUUID().slice(0, 8)}`,
            workspaceId,
            customerId,
            `update-${customerId}-${requestId}`,
            existing.sync_status === 'PENDING' ? 'SYNCED' : existing.sync_status,
            existing.myob_customer_id,
            auth.userId,
            requestId,
            'Updated customer record and brand affiliations',
            nowIso
          )
      );

      await env.DB.batch(updateStatements);
      const updated = await getCustomerWithDetails(env.DB, workspaceId, customerId);
      return reply({ customer: updated });
    }

    return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Method not allowed for customer resource', requestId, undefined, undefined, { Allow: 'GET, PATCH' });
  }

  if (action === 'retry-sync') {
    if (method !== 'POST') {
      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only POST is allowed', requestId, undefined, undefined, { Allow: 'POST' });
    }
    let body: Record<string, unknown> = {};
    try {
      const text = await request.text();
      if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return validationErrorResponse('Invalid JSON payload', [], requestId);
    }

    const idempotencyKey =
      request.headers.get('Idempotency-Key')?.trim() ||
      (typeof body.idempotency_key === 'string' ? body.idempotency_key.trim() : '') ||
      `retry-${customerId}-${existing.version}`;

    const existingSync = await env.DB
      .prepare('SELECT id FROM customer_myob_sync_log WHERE workspace_id = ? AND idempotency_key = ?')
      .bind(workspaceId, idempotencyKey)
      .first<{ id: string }>();
    if (existingSync) {
      return reply({ customer: existing, idempotent_replay: true }, 200, { 'X-Idempotent-Replay': 'true' });
    }

    if (existing.sync_status === 'SYNCED') {
      return createProblemResponse(409, 'ALREADY_SYNCED', 'already-synced', 'Conflict', 'Customer is already synced to MYOB sandbox', requestId);
    }

    const simulatedOutcome =
      typeof body.simulated_outcome === 'string' && VALID_OUTCOMES.has(body.simulated_outcome as MyobWriteThroughOutcome)
        ? (body.simulated_outcome as MyobWriteThroughOutcome)
        : 'SUCCESS';

    const nowIso = new Date().toISOString();
    const myobRes = await gateway.retryCustomerSync(
      workspaceId,
      customerId,
      {
        name: existing.name,
        contactPerson: existing.contact_person,
        email: existing.email,
        phone: existing.phone,
        billingAddress: existing.billing_address,
        brandAffiliations: existing.brand_affiliations,
        notes: existing.notes ?? undefined,
      },
      { idempotencyKey, simulatedOutcome, nowIso }
    );

    const isDraft = myobRes.status === 'SYNCED' ? 0 : 1;
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE customers
           SET myob_customer_id = ?, sync_status = ?, is_recoverable_draft = ?,
               last_sync_error = ?, last_synced_at = ?, version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ?`
        )
        .bind(
          myobRes.myobCustomerId,
          myobRes.status,
          isDraft,
          myobRes.error ?? null,
          myobRes.syncedAt ?? existing.last_synced_at,
          nowIso,
          workspaceId,
          customerId
        ),
      env.DB
        .prepare(
          `INSERT INTO customer_myob_sync_log (
            id, workspace_id, customer_id, idempotency_key, operation, outcome,
            myob_card_id, is_sandbox, actor_user_id, request_id, detail, created_at
          ) VALUES (?, ?, ?, ?, 'RETRY_SYNC', ?, ?, 1, ?, ?, ?, ?)`
        )
        .bind(
          `SYNC-${crypto.randomUUID().slice(0, 8)}`,
          workspaceId,
          customerId,
          idempotencyKey,
          myobRes.status,
          myobRes.myobCustomerId,
          auth.userId,
          requestId,
          myobRes.message,
          nowIso
        ),
    ]);

    const updated = await getCustomerWithDetails(env.DB, workspaceId, customerId);
    return reply({ customer: updated, myob_result: myobRes });
  }

  if (action === 'reconcile') {
    if (method !== 'POST') {
      return createProblemResponse(405, 'METHOD_NOT_ALLOWED', 'method-not-allowed', 'Method Not Allowed', 'Only POST is allowed', requestId, undefined, undefined, { Allow: 'POST' });
    }
    if (existing.sync_status !== 'UNCERTAIN') {
      return createProblemResponse(409, 'INVALID_STATE', 'invalid-state', 'Conflict', 'Only UNCERTAIN customer drafts can be reconciled', requestId);
    }

    let body: unknown;
    try { body = await request.json(); } catch { return validationErrorResponse('Invalid JSON payload', [], requestId); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof (body as { confirm_synced?: unknown }).confirm_synced !== 'boolean') {
      return validationErrorResponse('confirm_synced boolean is required', [{ pointer: '/confirm_synced', code: 'REQUIRED', message: 'confirm_synced must be boolean' }], requestId);
    }

    const b = body as { confirm_synced: boolean; myob_customer_id?: string };
    const nowIso = new Date().toISOString();
    const myobRes = await gateway.reconcileUncertainCustomer(
      workspaceId,
      customerId,
      b.confirm_synced,
      typeof b.myob_customer_id === 'string' ? b.myob_customer_id : undefined,
      nowIso
    );

    const idempotencyKey =
      request.headers.get('Idempotency-Key')?.trim() ||
      `reconcile-${customerId}-${existing.version}-${b.confirm_synced ? 'confirm' : 'reject'}`;

    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE customers
           SET myob_customer_id = ?, sync_status = ?, is_recoverable_draft = ?,
               notes = ?, last_synced_at = ?, version = version + 1, updated_at = ?
           WHERE workspace_id = ? AND id = ?`
        )
        .bind(
          myobRes.myobCustomerId,
          myobRes.status,
          b.confirm_synced ? 0 : 1,
          b.confirm_synced ? existing.notes : 'Reconciliation rejected draft as duplicate/unconfirmed.',
          b.confirm_synced ? myobRes.syncedAt ?? nowIso : existing.last_synced_at,
          nowIso,
          workspaceId,
          customerId
        ),
      env.DB
        .prepare(
          `INSERT INTO customer_myob_sync_log (
            id, workspace_id, customer_id, idempotency_key, operation, outcome,
            myob_card_id, is_sandbox, actor_user_id, request_id, detail, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
        )
        .bind(
          `SYNC-${crypto.randomUUID().slice(0, 8)}`,
          workspaceId,
          customerId,
          idempotencyKey,
          b.confirm_synced ? 'RECONCILE_CONFIRM' : 'RECONCILE_REJECT',
          b.confirm_synced ? 'SYNCED' : 'REJECTED',
          myobRes.myobCustomerId,
          auth.userId,
          requestId,
          myobRes.message,
          nowIso
        ),
    ]);

    const updated = await getCustomerWithDetails(env.DB, workspaceId, customerId);
    return reply({ customer: updated, myob_result: myobRes });
  }

  return resourceNotFoundResponse(`Unknown customer action '${action}'`, requestId);
}
