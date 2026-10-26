import { addDays, addMonths, daysBetween } from "./dates";
import type { PropertyFields, Tenant } from "./env";

export type ReminderKind =
  | "welcome"
  | "filter"
  | "detector_test"
  | "detector_battery"
  | "fall_checklist"
  | "spring_checklist"
  | "insurance"
  | "insurance_expired";

export interface DueReminder {
  kind: ReminderKind;
  dueDate: string;
}

/** A reminder missed by a failed nightly run still goes out if it is at most this many days late. */
export const CATCH_UP_DAYS = 7;

// The lease (6.3) says filters are replaced at least every 60 days.
const DEFAULT_FILTER_MONTHS = 2;

export function filterMonths(fields: PropertyFields): number {
  const months = Number.parseInt(fields["HC Filter Months"] ?? "", 10);
  return months >= 1 && months <= 12 ? months : DEFAULT_FILTER_MONTHS;
}

/** The most recent filter due date on or before today: every N months counted from move-in. */
function lastFilterDue(moveIn: string, months: number, today: string): string | null {
  let due: string | null = null;
  for (let k = 1; ; k++) {
    const next = addMonths(moveIn, k * months);
    if (next > today) return due;
    due = next;
  }
}

/** The most recent occurrence of a fixed month/day (month is 1-12) on or before today. */
function lastYearly(month: number, day: number, today: string): string {
  const year = Number(today.slice(0, 4));
  const thisYear = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return thisYear <= today ? thisYear : `${year - 1}${thisYear.slice(4)}`;
}

/**
 * Every reminder whose due date has arrived for this tenant today, within the catch-up window.
 * The caller skips any (tenant, kind, dueDate) already in reminders_sent.
 */
export function dueReminders(tenant: Tenant, fields: PropertyFields, today: string): DueReminder[] {
  if (!tenant.active || !tenant.email || !tenant.move_in) return [];
  if (tenant.move_out && tenant.move_out <= today) return [];
  const moveIn = tenant.move_in;

  const candidates: DueReminder[] = [
    { kind: "welcome", dueDate: addDays(moveIn, 1) },
    { kind: "detector_test", dueDate: `${today.slice(0, 7)}-01` },
    { kind: "fall_checklist", dueDate: lastYearly(10, 1, today) },
    { kind: "spring_checklist", dueDate: lastYearly(4, 1, today) },
  ];
  const filterDue = lastFilterDue(moveIn, filterMonths(fields), today);
  if (filterDue) candidates.push({ kind: "filter", dueDate: filterDue });
  candidates.push({ kind: "detector_battery", dueDate: lastYearly(10, 15, today) });
  if (tenant.insurance_expires) {
    candidates.push({ kind: "insurance", dueDate: addDays(tenant.insurance_expires, -30) });
    // Still the old date the day after it lapses: no new end date has been entered.
    candidates.push({ kind: "insurance_expired", dueDate: addDays(tenant.insurance_expires, 1) });
  }

  return candidates.filter(({ dueDate }) => {
    const late = daysBetween(dueDate, today);
    // Nothing before move-in: a tenant who moves in on Oct 3 doesn't get the Oct 1 checklist.
    return late >= 0 && late <= CATCH_UP_DAYS && dueDate >= moveIn;
  });
}
