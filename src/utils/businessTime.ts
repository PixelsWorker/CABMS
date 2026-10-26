import { HolidayRegion } from '../types/cabms.ts';
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

/**
 * Format a calendar date-only string ('YYYY-MM-DD') safely in Australia/Brisbane business context,
 * ensuring no 1-day drift occurs under host timezones with negative UTC offsets (FC-13).
 */
export function formatBusinessCalendarDate(
  dateStr: string,
  options?: Intl.DateTimeFormatOptions
): string {
  if (typeof dateStr !== 'string') return 'Invalid date';
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 'Invalid date';

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return 'Invalid date';

  const utcNoon = Date.UTC(year, month - 1, day, 12, 0, 0);
  const d = new Date(utcNoon);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return 'Invalid date';
  }

  return new Intl.DateTimeFormat('en-AU', {
    ...options,
    timeZone: BUSINESS_TIME_ZONE,
  }).format(utcNoon);
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

// QLD Statewide Public Holidays (2026 + 2027)
export const QUEENSLAND_STATEWIDE_HOLIDAYS_2026: readonly string[] = [
  '2026-01-01', // New Year's Day
  '2026-01-26', // Australia Day
  '2026-04-03', // Good Friday
  '2026-04-04', // Easter Saturday
  '2026-04-05', // Easter Sunday
  '2026-04-06', // Easter Monday
  '2026-04-25', // Anzac Day
  '2026-05-04', // Labour Day
  '2026-10-05', // King's Birthday
  '2026-12-25', // Christmas Day
  '2026-12-26', // Boxing Day
  '2026-12-28', // Boxing Day (Observed Public Holiday)
  // Complete 2027 Queensland Public Holiday Calendar
  '2027-01-01', // New Year's Day 2027
  '2027-01-26', // Australia Day 2027
  '2027-03-26', // Good Friday 2027
  '2027-03-27', // Easter Saturday 2027
  '2027-03-28', // Easter Sunday 2027
  '2027-03-29', // Easter Monday 2027
  '2027-04-25', // Anzac Day 2027
  '2027-04-26', // Anzac Day (Observed) 2027
  '2027-05-03', // Labour Day 2027
  '2027-10-04', // King's Birthday 2027
  '2027-12-25', // Christmas Day 2027
  '2027-12-26', // Boxing Day 2027
  '2027-12-27', // Christmas Day (Observed) 2027
  '2027-12-28', // Boxing Day (Observed) 2027
];

// Regional Show Days (2026 + 2027)
export const BRISBANE_EKKA_2026 = '2026-08-12'; // Royal Queensland Show (Brisbane Area)
export const GOLD_COAST_SHOW_2026 = '2026-08-28'; // Gold Coast Show Day
export const BRISBANE_EKKA_2027 = '2027-08-11';
export const GOLD_COAST_SHOW_2027 = '2027-08-27';

export const BRISBANE_METRO_PUBLIC_HOLIDAYS_2026 = new Set<string>([
  ...QUEENSLAND_STATEWIDE_HOLIDAYS_2026,
  BRISBANE_EKKA_2026,
  BRISBANE_EKKA_2027,
]);

export const GOLD_COAST_PUBLIC_HOLIDAYS_2026 = new Set<string>([
  ...QUEENSLAND_STATEWIDE_HOLIDAYS_2026,
  GOLD_COAST_SHOW_2026,
  GOLD_COAST_SHOW_2027,
]);

export function getPublicHolidays(region: HolidayRegion = 'brisbane'): Set<string> {
  return region === 'gold_coast' ? GOLD_COAST_PUBLIC_HOLIDAYS_2026 : BRISBANE_METRO_PUBLIC_HOLIDAYS_2026;
}

/** Check if dateStr ('YYYY-MM-DD') is a business day (Mon-Fri and not a public holiday in region). */
export function isBusinessDay(dateStr: string, region: HolidayRegion = 'brisbane'): boolean {
  if (typeof dateStr !== 'string') return false;
  const match = dateStr.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const d = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return false;
  }
  if (year < 2026 || year > 2027) {
    throw new RangeError(`Holiday calendar is only populated for 2026-2027; received year ${year}.`);
  }
  const dow = d.getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (dow === 0 || dow === 6) return false;

  const holidays = getPublicHolidays(region);
  return !holidays.has(dateStr);
}

/**
 * Add a number of business days to a starting date or instant, skipping weekends and regional public holidays.
 * Returns the resulting calendar date in 'YYYY-MM-DD' format.
 */
export function addBusinessDays(
  startInstantOrDate: string,
  days: number,
  region: HolidayRegion = 'brisbane'
): string {
  if (days < 0 || !Number.isInteger(days)) {
    throw new RangeError('days must be a non-negative integer');
  }
  let currentYMD = startInstantOrDate.includes('T')
    ? businessCalendarDate(startInstantOrDate)
    : startInstantOrDate.trim();

  const match = currentYMD.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new RangeError('A valid YYYY-MM-DD date or timezone-qualified instant is required.');
  let [year, month, day] = match.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new RangeError('A valid calendar date is required.');
  }
  if (year < 2026 || year > 2027) {
    throw new RangeError(`Supported business calendar range is 2026-2027; received year ${year}.`);
  }
  let added = 0;
  while (added < days) {
    const nextDate = new Date(Date.UTC(year, month - 1, day + 1, 12, 0, 0));
    year = nextDate.getUTCFullYear();
    month = nextDate.getUTCMonth() + 1;
    day = nextDate.getUTCDate();
    currentYMD = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isBusinessDay(currentYMD, region)) {
      added++;
    }
  }
  return currentYMD;
}

/** Calculate quote follow-up dates (Stage 1 @ 3 business days, Stage 2 @ 7 business days, Expiration @ 14 calendar days). */
export function calculateQuoteFollowUpDates(
  issuedAt: string,
  region: HolidayRegion = 'brisbane'
): { stage1Date: string; stage2Date: string; expiresAtDate: string } {
  const stage1Date = addBusinessDays(issuedAt, 3, region);
  const stage2Date = addBusinessDays(issuedAt, 7, region);
  const expiresAtInstant = advanceBusinessClock(issuedAt, 14 * 24);
  const expiresAtDate = businessCalendarDate(expiresAtInstant);
  return { stage1Date, stage2Date, expiresAtDate };
}

/** Calculate quote expiration timestamp (14 calendar days after issuance). */
export function calculateQuoteExpiration(issuedAt: string): string {
  return advanceBusinessClock(issuedAt, 14 * 24);
}
