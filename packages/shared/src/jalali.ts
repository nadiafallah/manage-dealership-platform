import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';
import { toLatinDigits, toPersianDigits } from './text';

// All timestamps are stored in UTC. Iran has used a fixed UTC+03:30 offset
// without daylight saving since September 2022, so conversion uses a fixed
// offset; this keeps server, browser and tests deterministic. Dates entered
// for periods before 2022-09 may differ by one hour from wall-clock time.
export const TEHRAN_OFFSET_MINUTES = 210;

export interface JalaliParts {
  jy: number;
  jm: number;
  jd: number;
  hour: number;
  minute: number;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Splits a UTC instant into Tehran-local Jalali date and time parts. */
export function toJalaliParts(date: Date): JalaliParts {
  const local = new Date(date.getTime() + TEHRAN_OFFSET_MINUTES * 60_000);
  const { jy, jm, jd } = toJalaali(
    local.getUTCFullYear(),
    local.getUTCMonth() + 1,
    local.getUTCDate(),
  );
  return { jy, jm, jd, hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/** "1405/08/09" in ASCII digits (for inputs). */
export function formatJalaliDateInput(date: Date): string {
  const p = toJalaliParts(date);
  return `${p.jy}/${pad(p.jm)}/${pad(p.jd)}`;
}

/** "14:30" in ASCII digits (for inputs). */
export function formatTimeInput(date: Date): string {
  const p = toJalaliParts(date);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'] as const;
/** Indexed by getUTCDay() of the Tehran wall clock (0 = Sunday). */
export const PERSIAN_WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'] as const;

/** Short human form used next to a status: «دوشنبه ۱۸ آبان» (spec section 7). */
export function formatJalaliDay(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const p = toJalaliParts(date);
  const weekday = PERSIAN_WEEKDAYS[new Date(date.getTime() + TEHRAN_OFFSET_MINUTES * 60_000).getUTCDay()]!;
  return `${weekday} ${toPersianDigits(String(p.jd))} ${JALALI_MONTHS[p.jm - 1]}`;
}

/** Display form with Persian digits: "۱۴۰۵/۰۸/۰۹" or "۱۴۰۵/۰۸/۰۹ ۱۴:۳۰". */
export function formatJalali(
  value: Date | string | null | undefined,
  opts: { time?: boolean } = {},
): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const text = opts.time
    ? `${formatJalaliDateInput(date)} ${formatTimeInput(date)}`
    : formatJalaliDateInput(date);
  return toPersianDigits(text);
}

/**
 * Parses a Jalali date ("1405/8/9", "۱۴۰۵-۰۸-۰۹") and optional time ("14:30")
 * entered in Tehran local time. Returns null when invalid.
 */
export function parseJalali(dateText: string, timeText = '00:00'): Date | null {
  const d = toLatinDigits(dateText).trim().match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  const t = toLatinDigits(timeText || '00:00').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!d || !t) return null;
  const [jy, jm, jd] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (!isValidJalaaliDate(jy, jm, jd) || hour > 23 || minute > 59) return null;
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  const utc = Date.UTC(gy, gm - 1, gd, hour, minute) - TEHRAN_OFFSET_MINUTES * 60_000;
  return new Date(utc);
}

/** Current Jalali year in Tehran (used in case numbers). */
export function currentJalaliYear(now: Date = new Date()): number {
  return toJalaliParts(now).jy;
}

export const JALALI_MONTH_NAMES = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'] as const;

/** Tehran-local Jalali month of an instant as "1405-08" (used in month filters). */
export function jalaliMonthKey(date: Date = new Date()): string {
  const p = toJalaliParts(date);
  return `${p.jy}-${pad(p.jm)}`;
}

/** "آبان ۱۴۰۵" for a month key; the key itself when it is not valid. */
export function jalaliMonthLabel(key: string): string {
  const range = jalaliMonthRange(key);
  return range ? range.label : key;
}

/**
 * UTC bounds [from, to) of a Jalali month given as "1405-08", using the fixed
 * Tehran offset like every other conversion here. Null when the key is invalid.
 */
export function jalaliMonthRange(key: string): { jy: number; jm: number; from: Date; to: Date; label: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(toLatinDigits(key).trim());
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  if (jm < 1 || jm > 12 || jy < 1300 || jy > 1500) return null;
  const start = toGregorian(jy, jm, 1);
  const next = jm === 12 ? toGregorian(jy + 1, 1, 1) : toGregorian(jy, jm + 1, 1);
  const offset = TEHRAN_OFFSET_MINUTES * 60_000;
  return {
    jy,
    jm,
    from: new Date(Date.UTC(start.gy, start.gm - 1, start.gd) - offset),
    to: new Date(Date.UTC(next.gy, next.gm - 1, next.gd) - offset),
    label: `${JALALI_MONTH_NAMES[jm - 1]} ${toPersianDigits(jy)}`,
  };
}

/** The given month and the months before it, newest first (month pickers). */
export function recentJalaliMonths(count: number, from: Date = new Date()): string[] {
  const p = toJalaliParts(from);
  const out: string[] = [];
  let jy = p.jy;
  let jm = p.jm;
  for (let i = 0; i < count; i++) {
    out.push(`${jy}-${pad(jm)}`);
    jm -= 1;
    if (jm === 0) {
      jm = 12;
      jy -= 1;
    }
  }
  return out;
}
