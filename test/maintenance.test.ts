import { describe, expect, it } from "vitest";
import type { WorkOrder } from "../src/dispatch";
import { RENTEC_STATUS, approvalLimit, attention, needsOwner, suggestVendor } from "../src/maintenance";

const wo = (o: Partial<WorkOrder>): WorkOrder =>
  ({ id: 1, tier: "routine", status: "received", created_at: "2026-10-26T14:00:00.000Z", updated_at: "2026-10-26T14:00:00.000Z", flags: null, reviewed_at: null, tenant_result: null, ...o }) as WorkOrder;

describe("what needs a look", () => {
  const now = new Date("2026-10-29T15:00:00.000Z");
  it("flags no update in 3 days and a missed response target", () => {
    expect(attention(wo({ tier: "urgent" }), now)).toEqual(["Past the 24 hours target", "No update in 3 days"]);
    expect(attention(wo({ updated_at: "2026-10-29T10:00:00.000Z" }), now)).toEqual([]);
  });
  it("flags review items until reviewed, and still-a-problem even when complete", () => {
    expect(attention(wo({ flags: "accommodation", updated_at: now.toISOString() }), now)).toEqual(["Needs your review"]);
    expect(attention(wo({ flags: "accommodation", reviewed_at: "x", updated_at: now.toISOString() }), now)).toEqual([]);
    expect(attention(wo({ status: "completed", tenant_result: "still_broken", updated_at: now.toISOString() }), now)).toEqual(["Tenant says it's still a problem"]);
    expect(attention(wo({ status: "completed" }), now)).toEqual([]);
  });
});

describe("owner approval", () => {
  it("uses the home's own limit, else the default", () => {
    expect(approvalLimit({ OWNER_APPROVAL_LIMIT: "500" }, { approval_limit: null })).toBe(500);
    expect(approvalLimit({ OWNER_APPROVAL_LIMIT: "500" }, { approval_limit: 1000 })).toBe(1000);
    expect(needsOwner({ estimate: 750, owner_approved_at: null }, 500)).toBe(true);
    expect(needsOwner({ estimate: 750, owner_approved_at: "2026-10-29" }, 500)).toBe(false);
    expect(needsOwner({ estimate: 400, owner_approved_at: null }, 500)).toBe(false);
  });
});

describe("vendor suggestion and Rentec status", () => {
  const vendors = [
    { id: 1, name: "Real Creative Maintenance", trade: "In-house maintenance", active: 1, sort_order: 1 },
    { id: 2, name: "Moe Heating and Air, LLC", trade: "HVAC", active: 1, sort_order: 3 },
    { id: 3, name: "Appliance Medic", trade: "Appliances", active: 1, sort_order: null },
  ];
  it("matches the trade, else in-house", () => {
    expect(suggestVendor("hvac", vendors)).toBe(2);
    expect(suggestVendor("appliance", vendors)).toBe(3);
    expect(suggestVendor("plumbing", vendors)).toBe(1);
  });
  it("reads Rentec's statuses as the tenant's", () => {
    expect(RENTEC_STATUS["OpenA"]!.status).toBe("vendor_contacted");
    expect(RENTEC_STATUS["Parts"]).toEqual({ status: "in_progress", waiting: "parts" });
    expect(RENTEC_STATUS["Closed"]!.status).toBe("completed");
    expect(RENTEC_STATUS["OpenU"]).toBeUndefined();
  });
});
