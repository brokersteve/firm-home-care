import type { PropertyFields } from "./env";

/** Every home detail kept for a property (in its Rentec sticky note, under these labels), in the order the home details form shows them. */
export interface FieldSpec {
  name: string;
  label: string;
  hint: string;
  /** Needed before a property can join the pilot. */
  required?: boolean;
  /** Offered as choices on the home details form; free text is still allowed. */
  choices?: string[];
  section: "Filters" | "Safety" | "Systems" | "Local info";
}

export const MAX_FILTERS = 3;

export const FIELDS: FieldSpec[] = [
  ...Array.from({ length: MAX_FILTERS }, (_, i): FieldSpec[] => [
    {
      name: `HC Filter ${i + 1} Size`,
      label: `Filter ${i + 1} size`,
      hint: "As printed on the filter edge, e.g. 16x25x1",
      required: i === 0,
      section: "Filters",
    },
    {
      name: `HC Filter ${i + 1} Location`,
      label: `Filter ${i + 1} location`,
      hint: "e.g. Hallway ceiling return vent",
      required: i === 0,
      section: "Filters",
    },
  ]).flat(),
  { name: "HC Filter Months", label: "Change filters every (months)", hint: "Lease says at least every 60 days: 2", section: "Filters" },
  { name: "HC Smoke Detectors", label: "Smoke detectors", hint: "How many", required: true, section: "Safety" },
  { name: "HC CO Detectors", label: "CO detectors", hint: "How many, or 0", section: "Safety" },
  { name: "HC Water Shutoff", label: "Main water shutoff", hint: "e.g. Crawl space entry, left of water heater", required: true, section: "Safety" },
  { name: "HC Gas Shutoff", label: "Gas shutoff", hint: "e.g. At meter, right side of house, or None", section: "Safety" },
  { name: "HC Breaker Panel", label: "Breaker panel", hint: "e.g. Garage, left wall", required: true, section: "Safety" },
  { name: "HC Heat Type", label: "Heating", hint: "e.g. Gas furnace", choices: ["Gas furnace", "Electric furnace", "Heat pump", "Baseboard"], section: "Systems" },
  { name: "HC Water Heater", label: "Water heater", hint: "Gas tank, Electric tank or Tankless", choices: ["Gas tank", "Electric tank", "Tankless"], section: "Systems" },
  { name: "HC Disposal Wrench", label: "Disposal wrench kept at", hint: "e.g. Taped inside sink cabinet door, or None", section: "Systems" },
  { name: "HC Trash Day", label: "Trash and recycling", hint: "e.g. Tuesday; recycling every other Tuesday", required: true, section: "Local info" },
  { name: "HC Utilities", label: "Utilities", hint: "Who to call to set up electric, water, gas", section: "Local info" },
  { name: "HC Local Notes", label: "Good to know", hint: "Parking, mailbox number, HOA, nearest urgent care", section: "Local info" },
];

export const REQUIRED_FIELDS = FIELDS.filter((f) => f.required).map((f) => f.name);

export interface Filter {
  size: string;
  location: string;
}

/** The home's air filters, from the numbered HC Filter fields. */
export function filters(fields: PropertyFields): Filter[] {
  const list: Filter[] = [];
  for (let i = 1; i <= MAX_FILTERS; i++) {
    const size = fields[`HC Filter ${i} Size`]?.trim() ?? "";
    const location = fields[`HC Filter ${i} Location`]?.trim() ?? "";
    if (size || location) list.push({ size, location });
  }
  return list;
}

/** "16x25x1 (Hallway ceiling vent) and 20x20x1 (Basement furnace)", for guide steps and emails. */
export function describeFilters(fields: PropertyFields): string {
  const list = filters(fields).map((f) => [f.size, f.location && `(${f.location})`].filter(Boolean).join(" "));
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}
