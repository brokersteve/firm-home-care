import { describe, expect, it } from "vitest";
import { addMonths } from "../src/dates";
import type { Tenant } from "../src/env";
import { dueReminders } from "../src/schedule";

const tenant = (over: Partial<Tenant> = {}): Tenant => ({
  id: "t1",
  property_id: "p1",
  first_name: "Ana",
  last_name: "Reyes",
  email: "ana@example.com",
  move_in: "2026-01-15",
  move_out: null,
  insurance_expires: null,
  active: 1,
  ...over,
});
const kinds = (t: Tenant, fields: Record<string, string>, today: string) => dueReminders(t, fields, today).map((r) => `${r.kind}@${r.dueDate}`);

describe("addMonths", () => {
  it("clamps to the end of shorter months", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-15", 3)).toBe("2027-02-15");
  });
});

describe("dueReminders", () => {
  it("sends the welcome the day after move-in", () => {
    expect(kinds(tenant(), {}, "2026-01-16")).toContain("welcome@2026-01-16");
  });

  it("sends the filter reminder every HC Filter Months from move-in", () => {
    const fields = { "HC Filter Months": "2" };
    expect(kinds(tenant(), fields, "2026-03-15")).toContain("filter@2026-03-15");
    expect(kinds(tenant(), fields, "2026-05-18")).toContain("filter@2026-05-15");
    expect(kinds(tenant(), fields, "2026-04-15").some((k) => k.startsWith("filter"))).toBe(false);
  });

  it("defaults to the lease's 60 days (every 2 months) when the field is missing or nonsense", () => {
    expect(kinds(tenant(), { "HC Filter Months": "often" }, "2026-03-15")).toContain("filter@2026-03-15");
    expect(kinds(tenant(), {}, "2026-05-15")).toContain("filter@2026-05-15");
  });

  it("sends the monthly detector test on the 1st, with a week to catch up", () => {
    expect(kinds(tenant(), {}, "2026-06-01")).toContain("detector_test@2026-06-01");
    expect(kinds(tenant(), {}, "2026-06-08")).toContain("detector_test@2026-06-01");
    expect(kinds(tenant(), {}, "2026-06-09").some((k) => k.startsWith("detector_test"))).toBe(false);
  });

  it("sends the yearly battery reminder on October 15", () => {
    expect(kinds(tenant(), {}, "2026-10-15")).toContain("detector_battery@2026-10-15");
  });

  it("sends the insurance reminder 30 days before expiry", () => {
    expect(kinds(tenant({ insurance_expires: "2026-08-31" }), {}, "2026-08-01")).toContain("insurance@2026-08-01");
  });

  it("sends nothing dated before move-in", () => {
    expect(kinds(tenant({ move_in: "2026-10-03" }), {}, "2026-10-04")).toEqual(["welcome@2026-10-04"]);
  });

  it("sends nothing to tenants who moved out, have no email, or are inactive", () => {
    expect(dueReminders(tenant({ move_out: "2026-05-31" }), {}, "2026-06-01")).toEqual([]);
    expect(dueReminders(tenant({ email: null }), {}, "2026-06-01")).toEqual([]);
    expect(dueReminders(tenant({ active: 0 }), {}, "2026-06-01")).toEqual([]);
  });
});
