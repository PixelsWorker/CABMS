import assert from 'node:assert/strict';
import { test } from 'node:test';
import { quoteFollowupDates } from '../src/utils/quoteFollowupDates.ts';
import { MockMyobGateway } from '../src/services/myobGateway.ts';

test('follow-ups count from each business local date, skipping weekends and configured holidays', () => {
  const sentAt = new Date('2026-11-19T15:00:00Z');
  const holidays = new Set(['2026-11-23']);
  assert.deepEqual(quoteFollowupDates(sentAt, {holidays}), {first:'2026-11-26',second:'2026-12-02'});
  assert.deepEqual(quoteFollowupDates(sentAt, {timeZone: 'Australia/Brisbane', holidays}, 2),
    {first: '2026-11-25', second: '2026-12-02'});
  assert.deepEqual(quoteFollowupDates(sentAt, {timeZone: 'UTC', holidays}),
    {first: '2026-11-25', second: '2026-12-01'});
});

test('follow-ups count calendar days across daylight-saving change', () => {
  assert.deepEqual(quoteFollowupDates(new Date('2026-03-06T23:45:00Z'),
    {timeZone: 'America/New_York', holidays: new Set()}),
  {first: '2026-03-11', second: '2026-03-17'});
});

test('synthetic invoice lookup is workspace scoped', async () => {
  const gateway = new MockMyobGateway();
  assert.equal(gateway.mode, 'mock');
  assert.equal((await gateway.lookupInvoice('solarcell', 'MOCK-INVOICE-001'))?.state, 'CONFIRMED');
  assert.equal(await gateway.lookupInvoice('cctv', 'MOCK-INVOICE-001'), null);
});
