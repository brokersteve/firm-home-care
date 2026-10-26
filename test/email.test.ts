import { describe, expect, it } from "vitest";
import { reminderEmail } from "../src/email";
import type { Property, Tenant } from "../src/env";

const tenant: Tenant = { id: "1", property_id: "p", first_name: "Ana", last_name: "R", email: "a@x.com", phone: null, move_in: "2026-01-01", move_out: null, insurance_expires: "2026-11-20", active: 1 };
const property: Property = {
  id: "p",
  name: "412 Maple",
  address: "412 Maple Ave",
  fields: { "HC Filter 1 Size": "16x25x1", "HC Filter 1 Location": "Hallway", "HC Filter 2 Size": "20x20x1", "HC Filter 2 Location": "Basement" },
};

describe("reminder emails", () => {
  it("lists every filter with its location", () => {
    const email = reminderEmail("filter", tenant, property, "2026-03-01");
    expect(email.subject).toBe("Time to change your air filters");
    expect(email.lines).toContain("16x25x1: Hallway");
    expect(email.lines).toContain("20x20x1: Basement");
  });

  it("reminds about the lease's insurance terms", () => {
    const text = reminderEmail("insurance", tenant, property, "2026-10-21").lines.join(" ");
    expect(text).toContain("November 20, 2026");
    expect(text).toContain("$100,000");
  });
});
