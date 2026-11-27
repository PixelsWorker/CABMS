export type MyobSyncState = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'NEEDS_REVIEW';

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
