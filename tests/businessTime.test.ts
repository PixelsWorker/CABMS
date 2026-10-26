import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceBusinessClock,
  businessCalendarDate,
  businessWeekBounds,
  formatBusinessTime,
  formatBusinessCalendarDate,
  isInBusinessWeek,
  serializeBusinessInstant,
  isBusinessDay,
  addBusinessDays,
  calculateQuoteFollowUpDates,
  calculateQuoteExpiration,
  BRISBANE_EKKA_2026,
  GOLD_COAST_SHOW_2026,
} from '../src/utils/businessTime.ts';

test('Business time is identical under Brisbane and Kolkata host timezones, including midnight', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['Australia/Brisbane', 'Asia/Kolkata', 'America/New_York']) {
      process.env.TZ = timezone;
      assert.equal(formatBusinessTime('2026-11-02T09:00:00+10:00'), '2 Nov 2026, 09:00 AEST (UTC+10)');
      assert.equal(formatBusinessTime('2026-11-01T14:00:00Z'), '2 Nov 2026, 00:00 AEST (UTC+10)');
      assert.equal(formatBusinessTime('2026-12-31T14:01:00Z'), '1 Jan 2027, 00:01 AEST (UTC+10)');
      assert.equal(formatBusinessTime('not a date'), 'Business time unavailable');
      assert.equal(formatBusinessTime('2026-11-02T09:00:00'), 'Business time unavailable');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('Brisbane week uses Monday inclusive and next Monday exclusive across year boundaries', () => {
  const clock = '2027-01-01T09:00:00+10:00';
  assert.deepEqual(businessWeekBounds(clock), {
    start: Date.parse('2026-12-28T00:00:00+10:00'),
    end: Date.parse('2027-01-04T00:00:00+10:00'),
  });
  assert.equal(isInBusinessWeek('2026-12-27T13:59:59.999Z', clock), false);
  assert.equal(isInBusinessWeek('2026-12-27T14:00:00Z', clock), true);
  assert.equal(isInBusinessWeek('2027-01-03T13:59:59.999Z', clock), true);
  assert.equal(isInBusinessWeek('2027-01-03T14:00:00Z', clock), false);
  for (const missing of [undefined, '', 'invalid', '2027-01-01T09:00:00']) {
    assert.equal(isInBusinessWeek(missing, clock), false);
  }
  assert.equal(businessWeekBounds('invalid'), null);
  assert.equal(isInBusinessWeek(clock, 'invalid'), false);
});

test('Business clock advancement and serialized event instants are explicit Brisbane times', () => {
  const start = '2026-11-02T09:00:00+10:00';
  const expectedOneHour = '2026-11-02T10:00:00.000+10:00';
  const previous = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'Australia/Brisbane', 'Asia/Kolkata', 'America/Los_Angeles']) {
      process.env.TZ = timezone;
      assert.equal(advanceBusinessClock(start, 1), expectedOneHour);
      assert.equal(advanceBusinessClock(start, 24), '2026-11-03T09:00:00.000+10:00');
      assert.equal(serializeBusinessInstant('2026-11-01T14:00:00Z'), '2026-11-02T00:00:00.000+10:00');
      assert.equal(businessCalendarDate('2026-12-31T14:01:00Z'), '2027-01-01');
      assert.equal(Date.parse(serializeBusinessInstant(start)), Date.parse(start));
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  assert.throws(() => advanceBusinessClock('2026-11-02T09:00:00', 1), /valid timestamp/i);
  assert.throws(() => advanceBusinessClock(start, Number.NaN), /finite hour/i);
});

const expectedAU = (iso: string, options: Intl.DateTimeFormatOptions) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('en-AU', {
    ...options,
    timeZone: 'Australia/Brisbane',
  }).format(Date.UTC(y, m - 1, d, 12, 0, 0));
};

test('FC-13: formatBusinessCalendarDate renders identical calendar dates under UTC, Brisbane, Kolkata, and New York host timezones', () => {
  const previous = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'Australia/Brisbane', 'Asia/Kolkata', 'America/New_York']) {
      process.env.TZ = timezone;
      const shortOct23 = formatBusinessCalendarDate('2026-10-23', { weekday: 'short', day: 'numeric', month: 'short' });
      assert.equal(shortOct23, expectedAU('2026-10-23', { weekday: 'short', day: 'numeric', month: 'short' }), `Short Oct 23 under ${timezone}`);

      const longOct23 = formatBusinessCalendarDate('2026-10-23', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      assert.equal(longOct23, expectedAU('2026-10-23', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), `Long Oct 23 under ${timezone}`);
      assert.ok(longOct23.includes('23') && longOct23.includes('October') && longOct23.includes('2026') && longOct23.includes('Friday'), `Long Oct 23 components under ${timezone}`);

      // Month/Year boundaries
      assert.equal(formatBusinessCalendarDate('2026-12-31', { weekday: 'short', day: 'numeric', month: 'short' }), expectedAU('2026-12-31', { weekday: 'short', day: 'numeric', month: 'short' }));
      assert.equal(formatBusinessCalendarDate('2027-01-01', { weekday: 'short', day: 'numeric', month: 'short' }), expectedAU('2027-01-01', { weekday: 'short', day: 'numeric', month: 'short' }));
      assert.equal(formatBusinessCalendarDate('2026-02-28', { day: 'numeric', month: 'short' }), expectedAU('2026-02-28', { day: 'numeric', month: 'short' }));

      // Invalid inputs
      assert.equal(formatBusinessCalendarDate('2026-02-29'), 'Invalid date');
      assert.equal(formatBusinessCalendarDate('invalid-date'), 'Invalid date');
      assert.equal(formatBusinessCalendarDate(''), 'Invalid date');
      assert.equal(formatBusinessCalendarDate(null as any), 'Invalid date');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
test('FC-13: formatBusinessCalendarDate strictly enforces Australia/Brisbane timezone even if caller options specify a different timeZone', () => {
  const expectedShortOct23 = expectedAU('2026-10-23', { weekday: 'short', day: 'numeric', month: 'short' });

  const resultOverrideNY = formatBusinessCalendarDate('2026-10-23', {
    timeZone: 'America/New_York',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  } as any);
  assert.equal(resultOverrideNY, expectedShortOct23, 'Forced Australia/Brisbane despite caller timeZone override');

  const resultOverrideHNL = formatBusinessCalendarDate('2026-10-23', {
    timeZone: 'Pacific/Honolulu',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  } as any);
  assert.equal(resultOverrideHNL, expectedShortOct23, 'Forced Australia/Brisbane despite Honolulu override');

  const resultOverrideUTC = formatBusinessCalendarDate('2026-10-23', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  } as any);
  assert.equal(resultOverrideUTC, expectedShortOct23, 'Forced Australia/Brisbane despite UTC override');
});

test('Regional holidays: Brisbane Ekka (12 Aug) vs Gold Coast Show (28 Aug)', () => {
  // Brisbane Ekka: holiday in Brisbane, business day in Gold Coast
  assert.equal(isBusinessDay(BRISBANE_EKKA_2026, 'brisbane'), false, 'Brisbane Ekka is holiday in Brisbane');
  assert.equal(isBusinessDay(BRISBANE_EKKA_2026, 'gold_coast'), true, 'Brisbane Ekka is normal business day on Gold Coast');

  // Gold Coast Show: holiday in Gold Coast, business day in Brisbane
  assert.equal(isBusinessDay(GOLD_COAST_SHOW_2026, 'gold_coast'), false, 'Gold Coast Show is holiday on Gold Coast');
  assert.equal(isBusinessDay(GOLD_COAST_SHOW_2026, 'brisbane'), true, 'Gold Coast Show is normal business day in Brisbane');

  // Statewide holiday: Boxing Day Observed (28 Dec 2026) is holiday in both
  assert.equal(isBusinessDay('2026-12-28', 'brisbane'), false, '28 Dec 2026 is holiday in Brisbane');
  assert.equal(isBusinessDay('2026-12-28', 'gold_coast'), false, '28 Dec 2026 is holiday on Gold Coast');

  // 2027 Calendar: Full Public Holiday Coverage
  assert.equal(isBusinessDay('2027-01-01', 'brisbane'), false, '1 Jan 2027 is holiday');
  assert.equal(isBusinessDay('2027-01-26', 'brisbane'), false, '26 Jan 2027 is holiday');
  assert.equal(isBusinessDay('2027-03-26', 'brisbane'), false, 'Good Friday 2027 is holiday');
  assert.equal(isBusinessDay('2027-03-29', 'brisbane'), false, 'Easter Monday 2027 is holiday');
  assert.equal(isBusinessDay('2027-04-26', 'brisbane'), false, 'Anzac Day Observed 2027 is holiday');
  assert.equal(isBusinessDay('2027-05-03', 'brisbane'), false, 'Labour Day 2027 is holiday');

  // Weekends are never business days
  assert.equal(isBusinessDay('2026-11-07', 'brisbane'), false, 'Saturday is not business day');
  assert.equal(isBusinessDay('2026-11-08', 'brisbane'), false, 'Sunday is not business day');
  assert.equal(isBusinessDay('2026-11-09', 'brisbane'), true, 'Monday is business day');
});

test('addBusinessDays correctly skips weekends and regional public holidays', () => {
  // Start Monday 2026-11-02 -> +3 business days should be Thursday 2026-11-05
  assert.equal(addBusinessDays('2026-11-02', 3, 'brisbane'), '2026-11-05');

  // Start Thursday 2026-11-05 -> +2 business days should skip Fri/Sat/Sun -> Mon 2026-11-09
  assert.equal(addBusinessDays('2026-11-05', 2, 'brisbane'), '2026-11-09');

  // Over Ekka week in Brisbane (Mon 10 Aug to Thu 13 Aug):
  // 2026-08-10 (Mon) + 3 business days: Tue (day 1), Wed is Ekka (skipped in BNE), Thu (day 2), Fri (day 3) -> 2026-08-14
  assert.equal(addBusinessDays('2026-08-10', 3, 'brisbane'), '2026-08-14');
  // On Gold Coast, Wed is not a holiday -> Wed (day 2), Thu (day 3) -> 2026-08-13
  assert.equal(addBusinessDays('2026-08-10', 3, 'gold_coast'), '2026-08-13');

  // Over Easter 2027 (Wed 24 March + 3 business days -> skips Good Friday & Easter Mon -> Wed 31 March)
  assert.equal(addBusinessDays('2027-03-24', 3, 'brisbane'), '2027-03-31');

  // Malformed / impossible dates throw RangeError instead of hanging
  assert.throws(() => addBusinessDays('', 3), RangeError);
  assert.throws(() => addBusinessDays('not-a-date', 3), RangeError);
  assert.throws(() => addBusinessDays('2026-02-31', 3), RangeError);
});

test('calculateQuoteFollowUpDates computes Stage 1 (3 business days), Stage 2 (7 business days), and 14 calendar day expiry', () => {
  const issuedAt = '2026-11-02T09:00:00+10:00'; // Monday
  const dates = calculateQuoteFollowUpDates(issuedAt, 'brisbane');
  assert.equal(dates.stage1Date, '2026-11-05', 'Stage 1 @ 3 business days');
  assert.equal(dates.stage2Date, '2026-11-11', 'Stage 2 @ 7 business days');
  assert.equal(dates.expiresAtDate, '2026-11-16', 'Expires at 14 calendar days');

  const expiryInstant = calculateQuoteExpiration(issuedAt);
  assert.equal(expiryInstant, '2026-11-16T09:00:00.000+10:00');
});
