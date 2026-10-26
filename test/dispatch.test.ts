import { describe, expect, it } from "vitest";
import { confirmationSubject, vendorText, type Vendor, type WorkOrder } from "../src/dispatch";
import { textSendTime, toE164 } from "../src/sms";

const NY = "America/New_York";

describe("text quiet hours (8am to 9pm Eastern)", () => {
  it("sends right away during the day", () => {
    const noon = new Date("2026-10-26T16:00:00Z"); // 12:00 EDT
    expect(textSendTime(noon, NY)).toEqual(noon);
    const late = new Date("2026-10-27T00:59:00Z"); // 8:59pm EDT
    expect(textSendTime(late, NY)).toEqual(late);
  });

  it("holds a 9pm text until 8am the next morning", () => {
    expect(textSendTime(new Date("2026-10-27T01:00:00Z"), NY).toISOString()).toBe("2026-10-27T12:00:00.000Z");
  });

  it("holds an early morning text until 8am the same day", () => {
    expect(textSendTime(new Date("2026-10-27T09:30:00Z"), NY).toISOString()).toBe("2026-10-27T12:00:00.000Z"); // 5:30am EDT
  });

  it("uses standard time after the clocks change", () => {
    expect(textSendTime(new Date("2026-12-02T03:00:00Z"), NY).toISOString()).toBe("2026-12-02T13:00:00.000Z"); // 10pm EST
  });
});

describe("phone numbers", () => {
  it("turns US numbers into the format Twilio needs", () => {
    expect(toE164("(704) 430-6193")).toBe("+17044306193");
    expect(toE164("1-704-430-6193")).toBe("+17044306193");
    expect(toE164("430-6193")).toBeNull();
  });
});

describe("vendor messages", () => {
  const wo = { id: 12, title: "Garbage disposal not working", contact_phone: "704-555-0142" } as WorkOrder;
  const property = { id: "102", name: "88 Birch", address: "88 Birch Ct", fields: {} };
  const vendor = { id: 1, name: "F.I.R.M. Maintenance" } as Vendor;

  it("keeps the text short with the tenant's number", () => {
    const text = vendorText(wo, property, { first_name: "Bo", last_name: "Li" } as never, "Gate code 1234", { COMPANY_NAME: "F.I.R.M." });
    expect(text).toContain("Bo Li: 704-555-0142");
    expect(text).toContain("Gate code 1234");
    expect(text.length).toBeLessThan(320);
  });

  it("gives the office copy a subject an Outlook rule can match", () => {
    expect(confirmationSubject(wo, property, vendor)).toBe("Work order sent to F.I.R.M. Maintenance: 88 Birch Ct - Garbage disposal not working [WO 12]");
  });
});
