/**
 * CABMS Service Factory
 * Exports the active data adapter (defaulting to MockDataAdapter).
 */

import { CabmsDataAdapter } from './types.ts';
import { MockDataAdapter } from './mockAdapter.ts';

const mockInstance = new MockDataAdapter();
let activeAdapter: CabmsDataAdapter = mockInstance;

export const getDataAdapter = (): CabmsDataAdapter => activeAdapter;
export const getMockDataAdapter = (): MockDataAdapter => mockInstance;

export const setAdapterForTesting = (adapter: CabmsDataAdapter): void => {
  activeAdapter = adapter;
};

export * from './types.ts';
export { MockDataAdapter } from './mockAdapter.ts';
export { HttpDataAdapter } from './httpAdapter.ts';
