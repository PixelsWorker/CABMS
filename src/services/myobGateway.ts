export type MyobSyncState = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'NEEDS_REVIEW';
export type MyobWriteThroughOutcome = 'SUCCESS' | 'FAILURE' | 'UNCERTAIN';
export type MyobCustomerSyncStatus = 'SYNCED' | 'FAILED' | 'UNCERTAIN' | 'PENDING';

export interface MyobCustomerCardInput {
  name: string;
  contactPerson: string;
  email: string;
  phone: string;
  billingAddress: string;
  brandAffiliations: string[];
  notes?: string;
}

export interface MyobCustomerWriteResult {
  status: MyobCustomerSyncStatus;
  myobCustomerId: string;
  isSandbox: true;
  sandboxLabel: 'SANDBOX_SYNTHETIC';
  idempotencyKey: string;
  message: string;
  syncedAt?: string;
  error?: string;
}

export interface MyobGateway {
  readonly mode: 'mock' | 'live';
  lookupInvoice(workspaceId: string, reference: string): Promise<{
    reference: string;
    state: MyobSyncState;
  } | null>;
}

/** Synthetic fixtures only. Deliberately has no network or credential dependencies. */
export class MockMyobGateway implements MyobGateway {
  readonly mode = 'mock';

  async lookupInvoice(workspaceId: string, reference: string) {
    if (workspaceId !== 'solarcell' || reference !== 'MOCK-INVOICE-001') return null;
    return { reference, state: 'CONFIRMED' as const };
  }
}

function deterministicCardSuffix(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
}

/**
 * MYOB Sandbox / Synthetic Write-Through Gateway.
 * Provides deterministic, idempotent customer card creation, retry sync,
 * and uncertain reconciliation without external MYOB credentials or network calls.
 * All returned card IDs and responses are explicitly labeled as sandbox/synthetic.
 */
export class SandboxMyobGateway extends MockMyobGateway {
  readonly isSandbox = true as const;
  private readonly idempotencyCache = new Map<string, MyobCustomerWriteResult>();

  async writeThroughCustomer(
    workspaceId: string,
    input: MyobCustomerCardInput,
    options: {
      idempotencyKey?: string;
      simulatedOutcome?: MyobWriteThroughOutcome;
      nowIso?: string;
    } = {}
  ): Promise<MyobCustomerWriteResult> {
    const idempotencyKey =
      options.idempotencyKey?.trim() ||
      `myob-create-${workspaceId}-${deterministicCardSuffix(`${input.name}|${input.email}|${input.phone}`)}`;
    const cacheKey = `${workspaceId}:${idempotencyKey}`;
    const cached = this.idempotencyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const outcome = options.simulatedOutcome ?? 'SUCCESS';
    const nowIso = options.nowIso ?? new Date().toISOString();
    let result: MyobCustomerWriteResult;

    if (outcome === 'FAILURE') {
      result = {
        status: 'FAILED',
        myobCustomerId: 'PENDING_MYOB_SYNC',
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: '[SANDBOX] Simulated MYOB Business API failure; customer saved as recoverable local draft.',
        error: 'Simulated MYOB sandbox write-through failure.',
      };
    } else if (outcome === 'UNCERTAIN') {
      result = {
        status: 'UNCERTAIN',
        myobCustomerId: 'AWAITING_RECONCILIATION',
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: '[SANDBOX] Simulated MYOB timeout/ambiguous response; manual reconciliation required.',
      };
    } else {
      const cardId = `MYOB-SBX-${deterministicCardSuffix(`${workspaceId}:${idempotencyKey}:${input.email}`)}`;
      result = {
        status: 'SYNCED',
        myobCustomerId: cardId,
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: `[SANDBOX] Created synthetic MYOB customer card ${cardId}.`,
        syncedAt: nowIso,
      };
    }

    this.idempotencyCache.set(cacheKey, result);
    return result;
  }

  async retryCustomerSync(
    workspaceId: string,
    customerId: string,
    input: MyobCustomerCardInput,
    options: {
      idempotencyKey?: string;
      simulatedOutcome?: MyobWriteThroughOutcome;
      nowIso?: string;
    } = {}
  ): Promise<MyobCustomerWriteResult> {
    const idempotencyKey =
      options.idempotencyKey?.trim() ||
      `myob-retry-${workspaceId}-${customerId}`;
    const cacheKey = `${workspaceId}:${idempotencyKey}`;
    const cached = this.idempotencyCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const outcome = options.simulatedOutcome ?? 'SUCCESS';
    const nowIso = options.nowIso ?? new Date().toISOString();
    let result: MyobCustomerWriteResult;

    if (outcome === 'FAILURE') {
      result = {
        status: 'FAILED',
        myobCustomerId: 'PENDING_MYOB_SYNC',
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: '[SANDBOX] Retry sync failed in MYOB sandbox.',
        error: 'Simulated MYOB sandbox retry failure.',
      };
    } else if (outcome === 'UNCERTAIN') {
      result = {
        status: 'UNCERTAIN',
        myobCustomerId: 'AWAITING_RECONCILIATION',
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: '[SANDBOX] Retry sync returned uncertain response.',
      };
    } else {
      const cardId = `MYOB-SBX-${deterministicCardSuffix(`${workspaceId}:${customerId}:${input.email}`)}`;
      result = {
        status: 'SYNCED',
        myobCustomerId: cardId,
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: `[SANDBOX] Retry sync succeeded; assigned synthetic MYOB card ${cardId}.`,
        syncedAt: nowIso,
      };
    }

    this.idempotencyCache.set(cacheKey, result);
    return result;
  }

  async reconcileUncertainCustomer(
    workspaceId: string,
    customerId: string,
    confirmSynced: boolean,
    existingCardId?: string,
    nowIso: string = new Date().toISOString()
  ): Promise<MyobCustomerWriteResult> {
    const idempotencyKey = `myob-reconcile-${workspaceId}-${customerId}-${confirmSynced ? 'confirm' : 'reject'}`;
    if (confirmSynced) {
      const cardId =
        existingCardId?.trim() ||
        `MYOB-SBX-REC-${deterministicCardSuffix(`${workspaceId}:${customerId}`).slice(0, 5)}`;
      return {
        status: 'SYNCED',
        myobCustomerId: cardId,
        isSandbox: true,
        sandboxLabel: 'SANDBOX_SYNTHETIC',
        idempotencyKey,
        message: `[SANDBOX] Reconciled and confirmed synthetic MYOB card ${cardId}.`,
        syncedAt: nowIso,
      };
    }
    return {
      status: 'FAILED',
      myobCustomerId: 'PENDING_MYOB_SYNC',
      isSandbox: true,
      sandboxLabel: 'SANDBOX_SYNTHETIC',
      idempotencyKey,
      message: '[SANDBOX] Draft rejected during reconciliation; marked as failed draft.',
    };
  }
}

export const defaultSandboxMyobGateway = new SandboxMyobGateway();
