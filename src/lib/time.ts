/**
 * Timezone-correct period boundaries (§50).
 *
 * The old app assumed one user in one timezone, so `new Date()` and "this
 * month" were unambiguous. With many users they are not: a transaction at
 * 11pm on 31 January in Los Angeles is a February transaction if the server
 * computes the month in UTC, and a user in Auckland gets a "weekly digest"
 * that covers the wrong seven days.
 *
 * The rules here:
 *  - storage and comparison are UTC, always;
 *  - anything a person *sees* as a boundary — a month, a week, "today" for
 *    their AI allowance — is computed in that user's IANA timezone;
 *  - the conversion uses Intl, i.e. the platform's own tz database, rather
 *    than hand-rolled offset arithmetic that breaks twice a year.
 */

/** Parts of a wall-clock time in a given zone. */
interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** Fall back to UTC rather than throwing on an unknown zone. */
export function safeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

/** The wall-clock reading of an instant, in a zone. */
export function partsInZone(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(safeTimeZone(timeZone)).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    // Intl renders midnight as "24" in some locales' hour12:false output.
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * The UTC instant corresponding to a wall-clock time in a zone.
 *
 * Works by guessing UTC, measuring how far off the zone renders it, and
 * correcting — twice, which settles the DST edge cases where the first
 * correction lands on the other side of a transition.
 */
export function zonedTimeToUtc(
  timeZone: string,
  year: number,
  month: number, // 1-12
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): Date {
  const zone = safeTimeZone(timeZone);
  let guess = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 2; i++) {
    const rendered = partsInZone(new Date(guess), zone);
    const renderedUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    const target = Date.UTC(year, month - 1, day, hour, minute, second);
    const drift = target - renderedUtc;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
}

export interface Period {
  start: Date;
  end: Date;
}

/**
 * A calendar month in the user's zone, as a half-open UTC range [start, end).
 * `month` is 1-12.
 */
export function monthRangeInZone(timeZone: string, year: number, month: number): Period {
  const start = zonedTimeToUtc(timeZone, year, month, 1);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = zonedTimeToUtc(timeZone, nextYear, nextMonth, 1);
  return { start, end };
}

/** The month containing `now` in the user's zone. */
export function currentMonthRange(timeZone: string, now = new Date()): Period {
  const { year, month } = partsInZone(now, timeZone);
  return monthRangeInZone(timeZone, year, month);
}

/** Parse a "YYYY-MM" key into a range in the user's zone. */
export function parseMonthKey(timeZone: string, key: string): Period | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12 || year < 1970 || year > 2200) return null;
  return monthRangeInZone(timeZone, year, month);
}

/** Midnight-to-midnight today, in the user's zone. */
export function todayRange(timeZone: string, now = new Date()): Period {
  const { year, month, day } = partsInZone(now, timeZone);
  const start = zonedTimeToUtc(timeZone, year, month, day);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * The user's local calendar day as "YYYY-MM-DD".
 *
 * This is the key for per-user daily AI budgets: a user's allowance resets at
 * their midnight, not at UTC midnight (§33, §50).
 */
export function localDayKey(timeZone: string, now = new Date()): string {
  const { year, month, day } = partsInZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The UTC day key, for the global (all-tenant) AI ceiling. */
export function utcDayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** A trailing window of N days, ending now, aligned to the user's midnight. */
export function trailingDays(timeZone: string, days: number, now = new Date()): Period {
  const { end } = todayRange(timeZone, now);
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The most recent seven complete days plus today, for the weekly digest. */
export function weekRange(timeZone: string, now = new Date()): Period {
  return trailingDays(timeZone, 7, now);
}

/** Format a month key for the user's zone. */
export function currentMonthKey(timeZone: string, now = new Date()): string {
  const { year, month } = partsInZone(now, timeZone);
  return `${year}-${String(month).padStart(2, "0")}`;
}
