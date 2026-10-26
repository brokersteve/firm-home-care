import { describe, expect, it } from "vitest";
import { money, summarize, type Job } from "../src/tracker";

const job = (o: Partial<Job>): Job => ({
  id: 1, work_order_id: null, vendor_id: 1, issued_on: "2026-10-01", property: "1 A St", work: "Fix", cost: null,
  owner_price: null, completed_on: null, vendor_paid_on: null, notes: null, ...o,
});
const vendors = [
  { id: 1, name: "Real Creative Maintenance", contact: null, phone: null, office_phone: null, sort_order: 1 },
  { id: 2, name: "Idle Co", contact: null, phone: null, office_phone: null, sort_order: null },
];

describe("work order tracker", () => {
  it("adds up what's open, owed to the vendor and charged to owners, leaving out vendors with no jobs", () => {
    const jobs = [
      job({ id: 1, cost: 1500, owner_price: 3800 }),
      job({ id: 2, cost: 200, owner_price: 300, completed_on: "2026-10-20", vendor_paid_on: "2026-10-21" }),
      job({ id: 3, cost: 100, owner_price: 150, completed_on: "2026-10-22" }),
      job({ id: 4, cost: 999, completed_on: "2026-01-05", vendor_paid_on: "2026-01-06" }),
    ];
    const [g, ...rest] = summarize(vendors, jobs, "2026-09-26");
    expect(rest).toEqual([]);
    expect(g!.jobs.map((j) => j.id)).toEqual([1, 2, 3]);
    expect(g!.open.map((j) => j.id)).toEqual([1]);
    expect(g!.owed).toBe(1600);
    expect(g!.ownerCharged).toBe(4250);
  });

  it("formats money like the worksheet", () => {
    expect(money(7300)).toBe("$7,300");
    expect(money(12.5)).toBe("$12.50");
    expect(money(null)).toBe("");
  });
});
