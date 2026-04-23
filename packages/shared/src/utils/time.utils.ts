// packages/shared/src/utils/time.utils.ts
// IST-aware time utilities.
// getTodayDateKey() is the only safe way to derive business dates in IST.
// Never use new Date().toISOString().split('T')[0] for backend business logic.

const IST_TIMEZONE = 'Asia/Kolkata';

function getDatePartsIST(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  const day = parts.find((part) => part.type === 'day')?.value ?? '01';

  return { year, month, day };
}

/**
 * Returns a YYYY-MM-DD business date key in IST for the supplied date.
 */
export function getDateKey(date: Date = new Date()): string {
  const { year, month, day } = getDatePartsIST(date);
  return `${year}-${month}-${day}`;
}

/**
 * Returns today's date key in IST.
 */
export function getTodayDateKey(now: Date = new Date()): string {
  return getDateKey(now);
}

/**
 * Returns tomorrow's date key in IST.
 */
export function getTomorrowDateKey(now: Date = new Date()): string {
  return getDateKey(new Date(now.getTime() + 24 * 60 * 60 * 1000));
}

/**
 * Returns yesterday's date key in IST.
 */
export function getYesterdayDateKey(now: Date = new Date()): string {
  return getDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/**
 * Returns today's date as YYYY-MM-DD in IST timezone.
 * Kept for compatibility with older call sites.
 */
export function getISODateIST(): string {
  return getTodayDateKey();
}

/**
 * Converts integer minutes-since-midnight to "HH:MM" display string.
 * Example: 435 -> "07:15"
 */
export function minutesToTimeString(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Converts "HH:MM" string to minutes-since-midnight.
 * Example: "17:30" -> 1050
 */
export function timeStringToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Returns the current minutes since midnight in IST.
 */
export function getMinutesSinceMidnightIST(date: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0);

  return hour * 60 + minute;
}

/**
 * Formats a Date object to a readable 12-hour IST time string.
 * Example: "08:30 AM"
 */
export function formatTimeIST(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

/** @deprecated use getTodayDateKey instead */
export const getIsoDateInIST = getISODateIST;

/**
 * Returns tomorrow's day of week in IST as MON, TUE, WED, THU, FRI, SAT, or SUN.
 */
export function getTomorrowDayOfWeekIST(now: Date = new Date()): string {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  return new Intl.DateTimeFormat('en-US', {
    timeZone: IST_TIMEZONE,
    weekday: 'short',
  }).format(tomorrow).toUpperCase();
}
