// Reads the answers an owner sends from the New Property Intake form (the "Email my answers" or "Copy answers"
// text), so staff can paste them in and get the home details and an inspection without retyping.
import type { Property, PropertyFields } from "./env";
import { FIELDS } from "./fields";
import type { RoomChoices } from "./inspection-template";

export interface Intake {
  address: string;
  /** HC fields found in the answers. Fields the owner skipped are left out, so they don't wipe what Rentec has. */
  fields: PropertyFields;
  rooms: RoomChoices;
}

// The intake form prints home care answers under the same labels as the home details form.
const BY_LABEL = new Map(FIELDS.map((f) => [f.label.toLowerCase(), f.name]));
BY_LABEL.set("trash pick-up day", "HC Trash Day");

const UTILITY = /\((electric|water and sewer|gas|trash)\)/i;
const LOCAL_NOTES: [label: string, prefix: string][] = [
  ["mailbox #", "Mailbox"],
  ["parking space #", "Parking space"],
  ["hoa name", "HOA:"],
  ["community features", "Community:"],
];

export function parseIntake(text: string): Intake {
  const answers = new Map<string, string>();
  const utilities: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    // Replies and forwards quote lines with "> ".
    const line = raw.replace(/^[>\s]+/, "").trim();
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const label = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (UTILITY.test(label)) utilities.push(line.replace(/ · /g, ", ").replace(/ during tenancy$/, ""));
    else if (value && !answers.has(label.toLowerCase())) answers.set(label.toLowerCase(), value);
  }

  const fields: PropertyFields = {};
  for (const [label, value] of answers) {
    const name = BY_LABEL.get(label);
    if (name && value.toLowerCase() !== "don't know") fields[name] = value;
  }
  if (utilities.length) fields["HC Utilities"] = utilities.join("; ");
  const notes = LOCAL_NOTES.flatMap(([label, prefix]) => (answers.get(label) ? [`${prefix} ${answers.get(label)}`] : []));
  if (notes.length) fields["HC Local Notes"] = notes.join(". ");

  const count = (label: string) => Number.parseInt(answers.get(label) ?? "", 10) || 0;
  const other = answers.get("other rooms");
  const has = (word: string) => (other ?? "").toLowerCase().includes(word);
  return {
    address: answers.get("property address") ?? "",
    fields,
    rooms: {
      bedrooms: count("bedrooms"),
      bathrooms: count("full baths"),
      halfBathrooms: count("half baths"),
      dining: has("dining"),
      // Most homes have a laundry area, so assume one unless the owner answered the question.
      laundry: other === undefined || has("laundry"),
      garage: has("garage"),
    },
  };
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** The one property whose address starts with the same house number and street name, or null. */
export function matchProperty(address: string, properties: Property[]): Property | null {
  const [num, street] = words(address);
  if (!num || !street) return null;
  const hits = properties.filter((p) => {
    const w = words(`${p.address} ${p.name}`);
    return w.includes(num) && w.includes(street);
  });
  return hits.length === 1 ? hits[0]! : null;
}
