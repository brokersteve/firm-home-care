import { describe, expect, it } from "vitest";
import { dueAt, rentecPriority, triage, type TriageInput } from "../src/triage";

const t = (o: Partial<TriageInput>) => triage({ guideId: null, title: "Tenant request", what: "", today: "2026-10-29", moveIn: "2026-01-01", ...o });

describe("urgency by repair (Steve, 2026-10-29)", () => {
  it("makes detectors a 24-hour job, not a fire", () => {
    expect(t({ guideId: "detector", title: "Smoke or CO detector chirping", what: "Smoke or CO detector chirping. Smoke detector in the hall keeps beeping" }).tier).toBe("urgent");
    const other = t({ title: "Smoke alarm broken", what: "Smoke alarm broken in the bedroom" });
    expect(other).toMatchObject({ tier: "urgent", category: "safety" });
  });

  it("treats a home that won't secure as more urgent than 24 hours", () => {
    expect(t({ title: "Front door", what: "The front door won't lock" })).toMatchObject({ tier: "emergency", category: "security" });
    expect(t({ title: "Window", what: "Back bedroom window is broken" })).toMatchObject({ tier: "emergency", category: "security" });
    expect(t({ title: "Garage", what: "Garage door is stuck open" }).tier).toBe("emergency");
  });

  it("doesn't mistake an appliance door for an unsecured home", () => {
    expect(t({ title: "Fridge", what: "The fridge door won't close all the way" }).tier).not.toBe("emergency");
  });

  it("leaves a stuck disposal routine", () => {
    expect(t({ guideId: "disposal", title: "Garbage disposal not working", what: "Garbage disposal not working. It hums" })).toMatchObject({ tier: "routine", category: "appliance", flags: ["drain"] });
  });

  it("raises urgency from the tenant's words, never lowers it", () => {
    expect(t({ guideId: "dishwasher", title: "Dishwasher not draining", what: "Dishwasher not draining. Now water is pouring onto the floor" }).tier).toBe("emergency");
    expect(t({ title: "Smell", what: "I smell gas in the kitchen" }).tier).toBe("emergency");
    expect(t({ title: "Water heater", what: "Water heater not working" })).toMatchObject({ tier: "urgent", category: "plumbing" });
    expect(t({ title: "Lights", what: "The floodlight by the driveway is out" }).tier).toBe("routine");
  });

  it("uses the follow-up answers", () => {
    expect(t({ guideId: "toilet", title: "Toilet clogged or running", what: "", followUp: "Yes, it's the only one" }).tier).toBe("urgent");
    expect(t({ guideId: "toilet", title: "Toilet clogged or running", what: "", followUp: "No, another toilet works" }).tier).toBe("routine");
    expect(t({ guideId: "hvac", title: "Heat or AC not working", what: "Heat or AC not working. ", followUp: "No heat, and it's freezing (32°F or colder) outside" }).tier).toBe("emergency");
    expect(t({ guideId: "hvac", title: "Heat or AC not working", what: "Heat or AC not working. ", followUp: "No AC" }).tier).toBe("routine");
  });

  it("makes a guide's emergency ending an emergency, and a leak stain routine", () => {
    expect(t({ guideId: "leak", title: "Water leak", what: "", emergency: true }).tier).toBe("emergency");
    expect(t({ guideId: "leak", title: "Water leak", what: "", answers: ["A stain, no water now"] }).tier).toBe("routine");
  });
});

describe("who pays: staff review first", () => {
  it("flags insects after the first 30 days, not before, and never wildlife", () => {
    expect(t({ title: "Roaches", what: "Roaches in the kitchen" })).toMatchObject({ tier: "tenant", category: "pest", flags: ["pest_after_30"] });
    expect(t({ title: "Roaches", what: "Roaches in the kitchen", moveIn: "2026-10-15" })).toMatchObject({ tier: "routine", flags: [] });
    expect(t({ title: "Attic", what: "Squirrels in the attic" })).toMatchObject({ tier: "routine", category: "pest", flags: [] });
  });

  it("flags damage the tenant describes causing, unless it's an emergency", () => {
    expect(t({ title: "Towel bar", what: "My son broke the towel bar" })).toMatchObject({ tier: "tenant", flags: ["tenant_damage"] });
    expect(t({ title: "Pipe", what: "I accidentally hit a pipe and it burst" }).tier).toBe("emergency");
  });

  it("flags accessibility requests without changing what's asked", () => {
    expect(t({ title: "Grab bar", what: "Could we get a grab bar by the tub?" }).flags).toContain("accommodation");
  });
});

describe("targets and Rentec priority", () => {
  it("counts routine targets in business days", () => {
    expect(dueAt("2026-10-30T15:00:00.000Z", "routine").toISOString()).toBe("2026-11-06T15:00:00.000Z"); // Friday + 5 business days
    expect(dueAt("2026-10-30T15:00:00.000Z", "urgent").toISOString()).toBe("2026-10-31T15:00:00.000Z");
  });

  it("maps tiers to Rentec's 1-5 priority from the setting", () => {
    expect(rentecPriority("emergency", "")).toBe(1);
    expect(rentecPriority("routine", "5,4,3,3")).toBe(3);
    expect(rentecPriority("urgent", "5,4,3,3")).toBe(4);
    expect(rentecPriority("urgent", "x")).toBeUndefined();
  });
});
