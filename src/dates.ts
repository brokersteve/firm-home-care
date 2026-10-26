// All dates are plain YYYY-MM-DD strings, compared as UTC calendar days.

export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const d = parseDay(day);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDay(d);
}

/** Adds whole months, clamping to the last day of the target month (Jan 31 + 1 month = Feb 28). */
export function addMonths(day: string, months: number): string {
  const d = parseDay(day);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return formatDay(target);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / 86_400_000);
}

export function prettyDay(day: string): string {
  return parseDay(day).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** A policy end date from a form: YYYY-MM-DD within ten years of today, or null. */
export function policyDate(value: unknown, today: string): string | null {
  const day = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(day))) return null;
  const years = (Date.parse(day) - Date.parse(today)) / (365.25 * 86400000);
  return years > -10 && years < 10 ? day : null;
}
