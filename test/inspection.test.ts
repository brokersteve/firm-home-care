import { describe, expect, it } from "vitest";
import { buildRooms, roomDone } from "../src/inspection-template";

describe("inspection rooms", () => {
  it("adds one room per bedroom and bathroom, numbered when there's more than one", () => {
    const names = buildRooms({ bedrooms: 3, bathrooms: 1, dining: false, laundry: true, garage: false }).map((r) => r.name);
    expect(names).toContain("Bedroom 3");
    expect(names).toContain("Bathroom");
    expect(names).toContain("Laundry");
    expect(names).not.toContain("Garage and storage");
    expect(names.at(-1)).toBe("Keys and access");
  });

  it("keeps room counts sensible", () => {
    const rooms = buildRooms({ bedrooms: Number("lots"), bathrooms: 99, dining: false, laundry: false, garage: false });
    expect(rooms.filter((r) => r.name.startsWith("Bedroom"))).toHaveLength(0);
    expect(rooms.filter((r) => r.name.startsWith("Bathroom"))).toHaveLength(8);
  });

  it("counts a room done once every item has a condition", () => {
    const [exterior] = buildRooms({ bedrooms: 1, bathrooms: 1, dining: false, laundry: false, garage: false });
    expect(roomDone(exterior!)).toBe(false);
    for (const item of exterior!.items) item.condition = "Good";
    expect(roomDone(exterior!)).toBe(true);
  });
});
