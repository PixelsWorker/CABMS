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
