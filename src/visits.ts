// Visit times for work orders. Visits are on weekdays between 8am and 5pm, never on nights, weekends or holidays.
// A visit is a 2-hour arrival window, so the last one starts at 3pm and ends at 5pm.
import { addDays, parseDay } from "./dates";

export const WINDOW_HOURS = 2;
/** Start of each arrival window, local time. */
export const VISIT_WINDOWS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];
/** How far ahead a visit can be set. */
export const MAX_DAYS_AHEAD = 60;

const hourLabel = (h: number) => (h === 12 ? "noon" : `${h % 12 || 12}${h < 12 ? "am" : "pm"}`);

/** "10:00" → "10am to noon". */
export function windowLabel(start: string): string {
  const h = Number(start.slice(0, 2));
  return `${hourLabel(h)} to ${hourLabel(h + WINDOW_HOURS)}`;
}

/** "2026-11-19" → "Thursday, Nov 19". */
export function dayLabel(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}

export function visitLabel(day: string, start: string): string {
  return `${dayLabel(day)}, ${windowLabel(start)}`;
}

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The nth weekday (0 = Sunday) of a month (1-12); n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return iso(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0));
  return iso(year, month, lastDay.getUTCDate() - ((lastDay.getUTCDay() - weekday + 7) % 7));
}

/** A fixed-date holiday that falls on a weekend is taken on the Friday before or the Monday after. */
function observed(day: string): string {
  const dow = parseDay(day).getUTCDay();
  return dow === 6 ? addDays(day, -1) : dow === 0 ? addDays(day, 1) : day;
}

/**
 * Days with no visits. Steve to confirm this list: it is the common small-business set, not one F.I.R.M. has
 * given us. Change it here and every visit picker follows.
 */
export function holidays(year: number): Set<string> {
  return new Set([
    observed(iso(year, 1, 1)), // New Year's Day
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(iso(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    addDays(nthWeekday(year, 11, 4, 4), 1), // the Friday after
    observed(iso(year, 12, 24)), // Christmas Eve
    observed(iso(year, 12, 25)), // Christmas Day
  ]);
}

export function isVisitDay(day: string): boolean {
  const dow = parseDay(day).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const year = Number(day.slice(0, 4));
  // New Year's Day on a Saturday is taken on Dec 31 of the year before.
  return !holidays(year).has(day) && !holidays(year + 1).has(day);
}

/** Today's date and hour on the wall clock in a time zone. */
export function localNow(now: Date, timeZone: string): { day: string; hour: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/** The windows still open on a day: all of them, or on today only the ones that start after this hour. */
export function openWindows(day: string, now: Date, timeZone: string): string[] {
  const local = localNow(now, timeZone);
  if (day < local.day || !isVisitDay(day)) return [];
  return day === local.day ? VISIT_WINDOWS.filter((w) => Number(w.slice(0, 2)) > local.hour) : VISIT_WINDOWS;
}

/** The next days a visit can be set, for the date picker. */
export function visitDays(now: Date, timeZone: string, count = 20): string[] {
  const today = localNow(now, timeZone).day;
  const days: string[] = [];
  for (let i = 0; i <= MAX_DAYS_AHEAD && days.length < count; i++) {
    const day = addDays(today, i);
    if (openWindows(day, now, timeZone).length) days.push(day);
  }
  return days;
}

/** Null if this visit time is allowed, otherwise what's wrong, in words for the person who picked it. */
export function checkVisit(day: string, start: string, now: Date, timeZone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day)) || !VISIT_WINDOWS.includes(start)) return "Please pick a day and a time.";
  const today = localNow(now, timeZone).day;
  if (day < today) return "That day has passed. Please pick another.";
  if (day > addDays(today, MAX_DAYS_AHEAD)) return `Please pick a day in the next ${MAX_DAYS_AHEAD} days.`;
  if (!isVisitDay(day)) return "Visits are on weekdays only, not on weekends or holidays. Please pick another day.";
  if (!openWindows(day, now, timeZone).includes(start)) return "That time has already started today. Please pick a later time or another day.";
  return null;
}
