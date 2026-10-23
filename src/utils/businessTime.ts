/** Brisbane has no daylight saving: all demo business dates use AEST (UTC+10). */
export const BUSINESS_TIME_ZONE = 'Australia/Brisbane';
const BUSINESS_OFFSET_MS = 10 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Require an explicit offset so stored instants never depend on the browser timezone.
function instant(value: string): number {
  return /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? Date.parse(value) : NaN;
}

/** Serialize an absolute instant with Brisbane's explicit fixed UTC+10 offset. */
export function serializeBusinessInstant(value: string | number): string {
  const timestamp = typeof value === 'number' ? value : instant(value);
  if (!Number.isFinite(timestamp)) throw new RangeError('A valid timestamp with an explicit timezone is required.');
  return new Date(timestamp + BUSINESS_OFFSET_MS).toISOString().replace(/Z$/, '+10:00');
}

/** Return the Brisbane calendar date for an absolute instant. */
export function businessCalendarDate(value: string | number): string {
  return serializeBusinessInstant(value).split('T', 1)[0];
}

/** Advance elapsed hours independently of the host timezone or its DST rules. */
export function advanceBusinessClock(clock: string, hours: number): string {
  const timestamp = instant(clock);
  if (!Number.isFinite(timestamp) || !Number.isFinite(hours)) {
    throw new RangeError('A valid timestamp and finite hour increment are required.');
  }
  return serializeBusinessInstant(timestamp + hours * HOUR_MS);
}

export function formatBusinessTime(value: string): string {
  const timestamp = instant(value);
  if (!Number.isFinite(timestamp)) return 'Business time unavailable';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIME_ZONE,
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(timestamp);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value;
  return `${part('day')} ${part('month')} ${part('year')}, ${part('hour')}:${part('minute')} AEST (UTC+10)`;
}

/** Monday 00:00 inclusive through the following Monday 00:00 exclusive, in Brisbane. */
export function businessWeekBounds(clock: string): { start: number; end: number } | null {
  const timestamp = instant(clock);
  if (!Number.isFinite(timestamp)) return null;
  const local = new Date(timestamp + BUSINESS_OFFSET_MS);
  const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const start = day - ((local.getUTCDay() + 6) % 7) * DAY_MS - BUSINESS_OFFSET_MS;
  return { start, end: start + 7 * DAY_MS };
}

export function isInBusinessWeek(completedAt: string | undefined, clock: string): boolean {
  const bounds = businessWeekBounds(clock);
  const completed = completedAt ? instant(completedAt) : NaN;
  return !!bounds && Number.isFinite(completed) && completed >= bounds.start && completed < bounds.end;
}
