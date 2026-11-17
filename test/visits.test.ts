import { describe, expect, it } from "vitest";
import { checkVisit, holidays, isVisitDay, openWindows, visitDays, visitLabel, windowLabel } from "../src/visits";

const NY = "America/New_York";
// Tue Nov 17, 2026, 3:14pm Eastern.
const now = new Date("2026-11-17T20:14:00Z");

describe("visit times", () => {
  it("are 2-hour windows from 8am to 5pm", () => {
    expect(windowLabel("08:00")).toBe("8am to 10am");
    expect(windowLabel("10:00")).toBe("10am to noon");
    expect(windowLabel("15:00")).toBe("3pm to 5pm");
    expect(visitLabel("2026-11-19", "13:00")).toBe("Thursday, Nov 19, 1pm to 3pm");
  });

  it("skip weekends and holidays", () => {
    expect(isVisitDay("2026-11-21")).toBe(false); // Saturday
    expect(isVisitDay("2026-11-26")).toBe(false); // Thanksgiving
    expect(isVisitDay("2026-11-27")).toBe(false); // the Friday after
    expect(isVisitDay("2026-12-25")).toBe(false);
    expect(isVisitDay("2026-11-30")).toBe(true);
    expect(holidays(2027).has("2027-07-05")).toBe(true); // July 4 is a Sunday
    expect(isVisitDay("2027-12-31")).toBe(false); // New Year's Day 2028 is a Saturday
  });

  it("only offer later windows today", () => {
    expect(openWindows("2026-11-17", now, NY)).toEqual([]); // 3:14pm: the 3pm window has started
    expect(openWindows("2026-11-18", now, NY)).toHaveLength(8);
    expect(visitDays(now, NY).slice(0, 5)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-23", "2026-11-24"]);
  });

  it("explain what's wrong with a time", () => {
    expect(checkVisit("2026-11-18", "09:00", now, NY)).toBeNull();
    expect(checkVisit("2026-11-21", "09:00", now, NY)).toMatch(/weekdays/);
    expect(checkVisit("2026-11-26", "09:00", now, NY)).toMatch(/holidays/);
    expect(checkVisit("2026-11-16", "09:00", now, NY)).toMatch(/passed/);
    expect(checkVisit("2026-11-17", "15:00", now, NY)).toMatch(/already started/);
    expect(checkVisit("2026-11-18", "17:00", now, NY)).toMatch(/pick a day and a time/);
    expect(checkVisit("2027-03-01", "09:00", now, NY)).toMatch(/next 60 days/);
  });
});
