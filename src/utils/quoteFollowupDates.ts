export interface BusinessCalendar {
  timeZone?: string;
  holidays: ReadonlySet<string>;
}

/** Calendar dates are counted in the business zone. The result is a local date, not a send instant. */
export function quoteFollowupDates(sentAt: Date, calendar: BusinessCalendar, firstDay: 2 | 3 = 3) {
  if (!Number.isFinite(sentAt.getTime()) || (firstDay !== 2 && firstDay !== 3)) {
    throw new RangeError('Invalid quote follow-up input');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: calendar.timeZone ?? 'Australia/Brisbane', calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = formatter.formatToParts(sentAt);
  const part = (key: string) => parts.find(item => item.type === key)?.value;
  const cursor = new Date(part('year') + '-' + part('month') + '-' + part('day') + 'T00:00:00Z');
  let first = '';
  let second = '';
  for (let counted = 0; counted < 7;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const date = cursor.toISOString().slice(0, 10);
    if (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6 || calendar.holidays.has(date)) continue;
    counted++;
    if (counted === firstDay) first = date;
    if (counted === 7) second = date;
  }
  return { first, second };
}
