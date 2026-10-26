import { describe, expect, it } from "vitest";
import type { Property } from "../src/env";
import { matchProperty, parseIntake } from "../src/intake";

// Captured from the New Property Intake form's "Email my answers" button.
const ANSWERS = `FIRM New Property Information

PROPERTY
Property address: 101 Maple Ave, Charlotte NC
Bedrooms: 3
Full baths: 2
Half baths: 1
Mailbox #: 12
Other rooms: Laundry, Garage

UTILITIES & SERVICES
Duke Energy (electric): 800-777-9898 · paid by tenant during tenancy
Trash pick-up day: Tuesday

HOME CARE DETAILS
Filter 1 size: 16x25x1
Filter 1 location: Hallway ceiling
Filter 2 size: 20x20x1
Filter 2 location: Upstairs hall
Smoke detectors: 4
CO detectors: 1
Main water shutoff: Crawl space entry
Breaker panel: Garage, left wall
Heating: Heat pump
Water heater: Don't know
Disposal wrench kept at: Under sink

DOCUMENTS
[ ] Liability insurance with FIRM as additional insured ($100K minimum)
[ ] HOA CC&Rs, by-laws or other managing documents
[ ] Completed W-9
[ ] Warranty documents
[ ] Direct deposit info / voided check`;

describe("owner intake answers", () => {
  const intake = parseIntake(ANSWERS);

  it("reads the home care answers into HC fields", () => {
    expect(intake.fields).toMatchObject({
      "HC Filter 1 Size": "16x25x1",
      "HC Filter 2 Location": "Upstairs hall",
      "HC Smoke Detectors": "4",
      "HC Water Shutoff": "Crawl space entry",
      "HC Breaker Panel": "Garage, left wall",
      "HC Heat Type": "Heat pump",
      "HC Trash Day": "Tuesday",
      "HC Utilities": "Duke Energy (electric): 800-777-9898, paid by tenant",
      "HC Local Notes": "Mailbox 12",
    });
  });

  it("leaves out skipped and don't-know answers so they don't wipe Rentec", () => {
    expect(intake.fields).not.toHaveProperty("HC Water Heater");
    expect(intake.fields).not.toHaveProperty("HC Gas Shutoff");
  });

  it("reads the property address", () => {
    expect(intake.address).toBe("101 Maple Ave, Charlotte NC");
  });

  it("copes with quoted replies", () => {
    const quoted = parseIntake(ANSWERS.split("\n").map((l: string) => `> ${l}`).join("\n"));
    expect(quoted.fields["HC Filter 1 Size"]).toBe("16x25x1");
  });

  it("matches the property by house number and street", () => {
    const props = [
      { id: "101", name: "101 Maple", address: "101 Maple Avenue, Charlotte, NC 28205", fields: {} },
      { id: "102", name: "22 Oak", address: "22 Oak St", fields: {} },
    ] as Property[];
    expect(matchProperty(intake.address, props)?.id).toBe("101");
    expect(matchProperty("5 Elm Rd", props)).toBeNull();
  });
});
