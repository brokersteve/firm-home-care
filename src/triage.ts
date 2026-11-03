// Triage for tenant work orders: the category, how urgent it is, flags for staff, and a one-line summary.
// Urgency comes from the repair itself, not from what the tenant picks (Steve, 2026-10-29): detectors are a
// 24-hour job, doors, locks and windows that won't secure are more urgent than that, a stuck disposal can wait.
// Plain rules, so F.I.R.M. can read and change them. They only ever raise urgency, never lower it.
import { daysBetween } from "./dates";

export type Tier = "emergency" | "urgent" | "routine" | "tenant";
export type Category = "plumbing" | "electrical" | "hvac" | "appliance" | "exterior" | "pest" | "security" | "safety" | "other";
export type Flag = "accommodation" | "tenant_damage" | "pest_after_30" | "drain" | "lockout";

/**
 * Response targets are the plan's proposed defaults (Steve hasn't set his own yet). "tenant" is a request the
 * lease may make the tenant's to pay for: staff review it first and the tenant is told only after that.
 */
export const TIERS: Record<Tier, { label: string; target: string; rank: number; hours?: number; businessDays?: number }> = {
  emergency: { label: "Emergency", target: "Same hour", rank: 0, hours: 1 },
  urgent: { label: "Urgent", target: "24 hours", rank: 1, hours: 24 },
  routine: { label: "Routine", target: "3 to 5 business days", rank: 2, businessDays: 5 },
  tenant: { label: "Tenant responsibility?", target: "Review first", rank: 3, businessDays: 5 },
};
export const TIER_ORDER: Tier[] = ["emergency", "urgent", "routine", "tenant"];

export const CATEGORIES: Record<Category, string> = {
  plumbing: "Plumbing",
  electrical: "Electrical",
  hvac: "Heating and AC",
  appliance: "Appliance",
  exterior: "Roof and exterior",
  pest: "Pests",
  security: "Doors, locks and windows",
  safety: "Smoke and CO detectors",
  other: "Other",
};

export const FLAGS: Record<Flag, string> = {
  accommodation: "Looks like an accessibility request (grab bars, ramps and the like). Review it yourself; don't ask the tenant questions about it.",
  tenant_damage: "May be damage the tenant caused. Review before telling the tenant who pays.",
  pest_after_30: "Pests after the first 30 days of the lease are the tenant's under the lease. Review before telling the tenant.",
  drain: "Drain clog: the tenant acknowledged they pay unless the line is collapsed or damaged through no fault of theirs.",
  lockout: "Lockout: the tenant pays F.I.R.M.'s actual cost (lease 6.7).",
};

/** Each troubleshooting guide's category and starting urgency. */
export const GUIDE_TRIAGE: Record<string, { category: Category; tier: Tier; flag?: Flag }> = {
  disposal: { category: "appliance", tier: "routine", flag: "drain" },
  breaker: { category: "electrical", tier: "urgent" },
  gfci: { category: "electrical", tier: "routine" },
  leak: { category: "plumbing", tier: "urgent" },
  drain: { category: "plumbing", tier: "routine", flag: "drain" },
  toilet: { category: "plumbing", tier: "routine", flag: "drain" },
  hot_water: { category: "plumbing", tier: "urgent" },
  hvac: { category: "hvac", tier: "urgent" },
  dishwasher: { category: "appliance", tier: "routine" },
  fridge: { category: "appliance", tier: "urgent" },
  detector: { category: "safety", tier: "urgent" },
  lockout: { category: "security", tier: "urgent", flag: "lockout" },
};

/** Follow-up questions on the work order form that decide urgency for some guides. */
export const FOLLOW_UPS: Record<string, { question: string; options: { label: string; tier?: Tier }[] }> = {
  toilet: {
    question: "Is this the only toilet in the home?",
    options: [{ label: "Yes, it's the only one", tier: "urgent" }, { label: "No, another toilet works" }],
  },
  hvac: {
    question: "What's not working?",
    options: [
      { label: "No heat, and it's freezing (32°F or colder) outside", tier: "emergency" },
      { label: "No heat", tier: "urgent" },
      { label: "No AC, and it's 90°F or hotter outside", tier: "urgent" },
      { label: "No AC", tier: "routine" },
      { label: "Something else (noise, weak airflow, thermostat)", tier: "routine" },
    ],
  },
  breaker: {
    question: "How much is out?",
    options: [
      { label: "The whole home has no power", tier: "emergency" },
      { label: "Part of the home", tier: "urgent" },
      { label: "One outlet or light", tier: "routine" },
    ],
  },
};

export const STARTED = ["Today", "Yesterday", "In the last week", "More than a week ago", "Not sure"];

interface Rule {
  pattern: RegExp;
  tier?: Tier;
  category?: Category;
  flag?: Flag;
}

const DETECTOR = /\b(smoke|fire|co|carbon monoxide) (alarm|detector)s?\b/g;
const APPLIANCE_DOOR = /(fridge|refrigerator|freezer|dishwasher|oven|washer|dryer|microwave|cabinet|closet|shower)\W+(\w+\W+){0,2}$/;
const WILDLIFE = /\b(squirrels?|raccoons?|bats?|snakes?|possums?|opossums?|birds?|termites?)\b/;

// Checked in order; a request can match several. Categories: the first match wins. Tiers: the most urgent wins.
const RULES: Rule[] = [
  // Emergencies: life safety, water and power, and anything that leaves the home unsecured.
  { pattern: /\b(smell(s|ing)? (of |like )?gas|gas (smell|leak)|rotten eggs?)\b/, tier: "emergency" },
  { pattern: /\b(fire|flames?|smoke|sparks?|sparking|burning smell|smells? (like )?burning|electrical smell|scorch\w*)\b/, tier: "emergency", category: "electrical" },
  { pattern: /\b(flood(s|ed|ing)?|burst|water (is )?(pouring|spraying|gushing|pooling)|through the ceiling)\b/, tier: "emergency", category: "plumbing" },
  { pattern: /\b(sewage|sewer|raw waste)\b/, tier: "emergency", category: "plumbing" },
  { pattern: /\bno (running )?water\b(?!.{0,25}\b(ice|dispenser|fridge|refrigerator)\b)/, tier: "emergency", category: "plumbing" },
  { pattern: /\b(no (power|electricity)|power is (out|off))\b/, tier: "emergency", category: "electrical" },
  { pattern: /\b(door|window|gate|slider)s? (won'?t|doesn'?t|does not|will not|can'?t|cannot|isn'?t|is not) (lock|latch|close|shut|secure)/, tier: "emergency", category: "security" },
  { pattern: /\b((won'?t|doesn'?t|can'?t|cannot|will not|does not) lock|lock (is )?broken|broken (lock|deadbolt|door|window)|window (is )?(broken|shattered|smashed)|break-?in|broken into|kicked in|stuck open)\b/, tier: "emergency", category: "security" },
  // Within 24 hours.
  { pattern: /\bdetector\b/, tier: "urgent", category: "safety" },
  { pattern: /\bno hot water\b|\bwaterheater\b.{0,20}\b(not|isn'?t|won'?t|stopped|broken|out)\b/, tier: "urgent", category: "plumbing" },
  { pattern: /\b(fridge|refrigerator|freezer)\b.{0,30}\b(not|isn'?t|won'?t|warm|stopped|broke)/, tier: "urgent", category: "appliance" },
  { pattern: /\bno (heat|ac|a\/c|air)\b|\b(heat|heater|furnace|ac|a\/c|air condition\w*)\b.{0,20}\b(not|isn'?t|won'?t|stopped|broken|out)\b/, tier: "urgent", category: "hvac" },
  { pattern: /\b(mold|mould|mildew)\b/, tier: "urgent" },
  { pattern: /\b(leak\w*|drip\w*)\b.{0,30}\bceiling\b|\bceiling\b.{0,30}\b(leak\w*|drip\w*|wet)\b/, tier: "urgent", category: "plumbing" },
  // Category only.
  { pattern: /\b(roach(es)?|cockroach\w*|ants?|mice|mouse|rats?|rodents?|bed ?bugs?|fleas?|spiders?|wasps?|hornets?|bees|pests?|bugs|termites?|squirrels?|raccoons?|bats?|snakes?|possums?|opossums?|birds? nest)\b/, category: "pest" },
  { pattern: /\b(toilet|sink|faucet|drain|pipe|shower|tub|waterheater|plumb\w*|leak\w*|drip\w*)\b/, category: "plumbing" },
  { pattern: /\b(outlet|switch|breaker|lights?|wiring|electric\w*|gfci|ceiling fan)\b/, category: "electrical" },
  { pattern: /\b(furnace|thermostat|hvac|heat pump|vents?|ducts?|heat|ac|a\/c)\b/, category: "hvac" },
  { pattern: /\b(dishwasher|washer|dryer|oven|stove|range|microwave|disposal|appliance|ice maker|fridge|refrigerator)\b/, category: "appliance" },
  { pattern: /\b(roof|gutters?|siding|fence|deck|porch|driveway|yard|trees?|shingles?|chimney|garage door|downspouts?)\b/, category: "exterior" },
  { pattern: /\b(locks?|doors?|windows?|keys?|deadbolt|garage)\b/, category: "security" },
  // Who pays: staff review these before the tenant hears anything.
  {
    pattern: /\b((i|we|my (son|daughter|kids?|child|children|husband|wife|boyfriend|girlfriend|roommate|guest|dog|cat|pet)|the (kids|dog|cat|puppy)) (accidentally )?(broke|dropped|knocked|chewed|scratched|cracked|punched|kicked|damaged|flushed)|accidentally)\b/,
    flag: "tenant_damage",
  },
  {
    pattern: /\b(grab ?bars?|ramps?|wheelchair|walker|hand ?rails?|disabilit\w*|disabled|accessib\w*|accommodation|handicap\w*|mobility|hearing (impaired|loss)|deaf|blind|visual(ly)? impair\w*|strobe)\b/,
    flag: "accommodation",
  },
];

export interface TriageInput {
  guideId: string | null;
  /** The guide ended at "this is an emergency". */
  emergency?: boolean;
  /** Each check the tenant answered in the guide. */
  answers?: string[];
  title: string;
  what: string;
  where?: string;
  started?: string;
  /** The answer to the guide's follow-up question (FOLLOW_UPS). */
  followUp?: string;
  /** The tenant's move-in date, for the 30-day pest rule. */
  moveIn?: string | null;
  today: string;
}

export interface Triage {
  tier: Tier;
  category: Category;
  flags: Flag[];
  summary: string;
}

const worse = (a: Tier, b: Tier) => (TIERS[a].rank <= TIERS[b].rank ? a : b);

export function triage(input: TriageInput): Triage {
  const fromGuide = input.guideId ? GUIDE_TRIAGE[input.guideId] : undefined;
  // Rules read the tenant's own words; a guide's title (prefilled on the form) already set the guide's urgency.
  const what = fromGuide ? input.what.replace(input.title, "") : `${input.title} ${input.what}`;
  // "Smoke detector" is not smoke, and a water heater is plumbing: read those phrases as one word first.
  const text = ` ${[what, input.where ?? ""].join(" ").toLowerCase().replace(/[’`]/g, "'")} `
    .replace(DETECTOR, " detector ")
    .replace(/\bwater heaters?\b/g, "waterheater");

  let tier: Tier = fromGuide?.tier ?? "routine";
  let category: Category | null = fromGuide?.category ?? null;
  const flags = new Set<Flag>(fromGuide?.flag ? [fromGuide.flag] : []);

  // A water stain with no water now can wait.
  if (input.guideId === "leak" && input.answers?.some((a) => a.startsWith("A stain"))) tier = "routine";
  const follow = input.guideId ? FOLLOW_UPS[input.guideId]?.options.find((o) => o.label === input.followUp) : undefined;
  if (follow?.tier) tier = input.guideId === "hvac" || input.guideId === "breaker" ? follow.tier : worse(tier, follow.tier);
  if (input.emergency) tier = "emergency";

  for (const rule of RULES) {
    const m = rule.pattern.exec(text);
    if (!m) continue;
    // "The fridge door won't close" is an appliance, not an unsecured home.
    if (rule.category === "security" && rule.tier && APPLIANCE_DOOR.test(text.slice(Math.max(0, m.index - 30), m.index))) continue;
    if (rule.tier) tier = worse(tier, rule.tier);
    if (rule.category && !category) category = rule.category;
    if (rule.flag) flags.add(rule.flag);
  }
  category ??= "other";

  // Insects and mice after the first 30 days are the tenant's (lease); wildlife and termites stay the owner's.
  const settledIn = input.moveIn ? daysBetween(input.moveIn, input.today) > 30 : true;
  if (category === "pest" && settledIn && !WILDLIFE.test(text)) flags.add("pest_after_30");
  // Who-pays questions go to staff first, unless it's an emergency: safety comes before the bill.
  if (tier !== "emergency" && (flags.has("tenant_damage") || flags.has("pest_after_30"))) tier = "tenant";

  const parts = [
    `${TIERS[tier].label} · ${CATEGORIES[category]}: ${input.title}${input.where ? ` (${input.where})` : ""}.`,
    ...(input.followUp ? [`${input.followUp}.`] : []),
    ...(input.started ? [`Started: ${input.started.toLowerCase()}.`] : []),
  ];
  return { tier, category, flags: [...flags], summary: parts.join(" ").slice(0, 300) };
}

/** When the first response is due: hours for emergencies and urgent jobs, business days (no weekends) otherwise. */
export function dueAt(createdAt: string, tier: Tier): Date {
  const t = TIERS[tier];
  const at = new Date(createdAt);
  if (t.hours) return new Date(at.getTime() + t.hours * 3_600_000);
  let left = t.businessDays ?? 5;
  while (left > 0) {
    at.setUTCDate(at.getUTCDate() + 1);
    if (at.getUTCDay() !== 0 && at.getUTCDay() !== 6) left--;
  }
  return at;
}

/** Rentec's work order priority (1 to 5) for each tier, from RENTEC_PRIORITIES ("emergency,urgent,routine,tenant"). */
export function rentecPriority(tier: Tier, setting: string | undefined): number | undefined {
  const values = (setting || "1,2,3,3").split(",").map((v) => Number.parseInt(v.trim(), 10));
  const n = values[TIER_ORDER.indexOf(tier)];
  return n && n >= 1 && n <= 5 ? n : undefined;
}
