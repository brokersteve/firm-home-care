// The checklist every F.I.R.M. inspection walks through. Rooms are added per home at the start.

export const CONDITIONS = ["Good", "Fair", "Poor", "N/A"] as const;
export type Condition = (typeof CONDITIONS)[number] | "";

export interface InspectionItem {
  name: string;
  condition: Condition;
  note: string;
  photos: string[];
}

export interface InspectionRoom {
  name: string;
  items: InspectionItem[];
}

export type InspectionKind = "move_in" | "move_out" | "routine";
export const KIND_LABELS: Record<InspectionKind, string> = {
  move_in: "Move-in inspection",
  move_out: "Move-out inspection",
  routine: "Routine inspection",
};

const ROOM_ITEMS = {
  exterior: ["Siding and paint", "Roof and gutters (from the ground)", "Yard and landscaping", "Driveway and walkways", "Exterior doors and locks", "Windows and screens", "Outdoor faucets", "House number and mailbox"],
  living: ["Walls", "Ceiling", "Floors or carpet", "Doors", "Windows and blinds", "Lights, switches and outlets", "Closet"],
  kitchen: ["Walls and ceiling", "Floors", "Cabinets and drawers", "Countertops", "Sink and faucet", "Garbage disposal", "Range and oven", "Range hood or microwave", "Refrigerator", "Dishwasher", "Lights and outlets (test GFCI)"],
  bedroom: ["Walls", "Ceiling", "Floors or carpet", "Door", "Closet", "Windows and blinds", "Lights, switches and outlets", "Smoke detector (test)"],
  bathroom: ["Walls and ceiling", "Floors", "Toilet", "Sink and vanity", "Tub or shower", "Caulk and grout", "Exhaust fan", "Mirror and fixtures", "GFCI outlet (test)"],
  laundry: ["Washer hookups", "Dryer vent", "Floor and walls"],
  garage: ["Garage door and opener", "Floor", "Walls and ceiling", "Storage"],
  systems: ["Heating runs", "AC runs", "Thermostat", "Air filters", "Water heater", "Smoke detectors (test all)", "CO detectors (test all)", "Fire extinguisher", "Breaker panel labeled", "No leaks under sinks"],
  keys: ["Door keys", "Garage openers", "Mailbox key", "Other access devices"],
};

export interface RoomChoices {
  bedrooms: number;
  bathrooms: number;
  /** Half baths get the bathroom list without the tub or shower. */
  halfBathrooms?: number;
  dining: boolean;
  laundry: boolean;
  garage: boolean;
}

const room = (name: string, items: string[]): InspectionRoom => ({
  name,
  items: items.map((item) => ({ name: item, condition: "", note: "", photos: [] })),
});

export function buildRooms(choices: RoomChoices): InspectionRoom[] {
  const count = (n: number) => Math.max(0, Math.min(8, Math.floor(n) || 0));
  const bedrooms = count(choices.bedrooms);
  const bathrooms = count(choices.bathrooms);
  const halfBathrooms = count(choices.halfBathrooms ?? 0);
  return [
    room("Exterior", ROOM_ITEMS.exterior),
    room("Entry and living room", ROOM_ITEMS.living),
    ...(choices.dining ? [room("Dining room", ROOM_ITEMS.living)] : []),
    room("Kitchen", ROOM_ITEMS.kitchen),
    ...Array.from({ length: bedrooms }, (_, i) => room(bedrooms > 1 ? `Bedroom ${i + 1}` : "Bedroom", ROOM_ITEMS.bedroom)),
    ...Array.from({ length: bathrooms }, (_, i) => room(bathrooms > 1 ? `Bathroom ${i + 1}` : "Bathroom", ROOM_ITEMS.bathroom)),
    ...Array.from({ length: halfBathrooms }, (_, i) =>
      room(halfBathrooms > 1 ? `Half bath ${i + 1}` : "Half bath", ROOM_ITEMS.bathroom.filter((item) => item !== "Tub or shower")),
    ),
    room("Hallways and stairs", ROOM_ITEMS.living.filter((i) => i !== "Closet")),
    ...(choices.laundry ? [room("Laundry", ROOM_ITEMS.laundry)] : []),
    ...(choices.garage ? [room("Garage and storage", ROOM_ITEMS.garage)] : []),
    room("Systems and safety", ROOM_ITEMS.systems),
    room("Keys and access", ROOM_ITEMS.keys),
  ];
}

/** A room is done when every item has a condition. */
export function roomDone(r: InspectionRoom): boolean {
  return r.items.every((i) => i.condition !== "");
}
