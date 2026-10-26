// Reads "Label: value" home details, as the owner intake form emails them and the Walkthrough inspection's
// "Copy for Home Care" button copies them, so staff can paste them in instead of retyping.
import type { Property, PropertyFields } from "./env";
import { FIELDS } from "./fields";
import { sameAddress } from "./sync";

export interface Intake {
  address: string;
  /** HC fields found in the answers. Fields the owner skipped are left out, so they don't wipe what Rentec has. */
  fields: PropertyFields;
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

  return { address: answers.get("property address") ?? "", fields };
}

/** The one property whose address starts with the same house number and street name, or null. */
export function matchProperty(address: string, properties: Property[]): Property | null {
  const hits = properties.filter((p) => sameAddress(address, p));
  return hits.length === 1 ? hits[0]! : null;
}
