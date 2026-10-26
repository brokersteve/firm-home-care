import type { PropertyFields } from "./env";

/** Where an answer leads: another step, or one of the three endings. */
export type Next = string | typeof FIXED | typeof WORK_ORDER | typeof EMERGENCY;
export const FIXED = "FIXED";
export const WORK_ORDER = "WORK_ORDER";
export const EMERGENCY = "EMERGENCY";

export interface GuideNode {
  /** Shown to the tenant. {HC Field Name} is filled from the property's Rentec custom fields. */
  text: string;
  options: { label: string; next: Next }[];
  /** Skip the question when a property field already answers it (first matching pattern wins). */
  auto?: { field: string; routes: { pattern: string; next: Next }[] };
}

export interface Guide {
  id: string;
  title: string;
  keywords: string[];
  /** Shown first, before any step. Its button leads to the emergency ending. */
  safety: string;
  start: string;
  nodes: Record<string, GuideNode>;
}

const WORKING = (next: Next = WORK_ORDER): GuideNode["options"] => [
  { label: "Yes, it's working", next: FIXED },
  { label: "No, still not working", next },
];

export const GUIDES: Guide[] = [
  {
    id: "disposal",
    title: "Garbage disposal not working",
    keywords: ["disposal", "garbage disposal", "garburator", "sink grinder", "disposer"],
    safety: "Never put a hand inside the disposal. Water leaking under the sink or a burning smell? Switch it off and call.",
    start: "hum",
    nodes: {
      hum: {
        text: "Flip the disposal switch on for a moment. Does it hum?",
        options: [
          { label: "Yes, it hums", next: "jammed" },
          { label: "No sound at all", next: "reset" },
        ],
      },
      jammed: {
        text: "It's jammed. Switch it off. Put the hex wrench ({HC Disposal Wrench}) into the socket on the bottom center and work it back and forth until it turns freely. Then press the red reset button on the bottom. Run cold water and switch it on. Is it working?",
        options: WORKING(),
      },
      reset: {
        text: "Press the red reset button on the bottom of the disposal. Run cold water and switch it on. Is it working?",
        options: WORKING("breaker"),
      },
      breaker: {
        text: "Check the breaker panel ({HC Breaker Panel}) for a switch in the middle or off, and press RESET on any outlet under the sink that has one. Try again. Is it working?",
        options: WORKING(),
      },
    },
  },
  {
    id: "breaker",
    title: "Lights or outlets out",
    keywords: ["breaker", "power out", "no power", "lights out", "outlets not working", "electricity", "tripped"],
    safety: "Burning smell, scorch marks, a hot outlet or sparks? Don't reset anything. Call.",
    start: "scope",
    nodes: {
      scope: {
        text: "Is it one outlet in a kitchen, bathroom, garage or outside, or a whole area?",
        options: [
          { label: "One outlet in one of those rooms", next: "gfci" },
          { label: "A whole room or area", next: "panel" },
        ],
      },
      gfci: {
        text: "Look for an outlet nearby with TEST and RESET buttons and press RESET firmly until it clicks. Is the power back?",
        options: WORKING("panel"),
      },
      panel: {
        text: "Open the breaker panel ({HC Breaker Panel}). Find a switch sitting in the middle or off. Push it fully off, then back on. Is the power back?",
        options: [
          { label: "Yes, it's back", next: FIXED },
          { label: "It tripped again", next: "unplug" },
          { label: "Nothing looks tripped", next: WORK_ORDER },
        ],
      },
      unplug: {
        text: "Unplug everything on that circuit and reset the breaker once more. Does it stay on?",
        options: [
          { label: "Yes, it stays on", next: FIXED },
          { label: "It trips with nothing plugged in", next: WORK_ORDER },
        ],
      },
    },
  },
  {
    id: "gfci",
    title: "Outlet not working",
    keywords: ["outlet", "gfci", "plug", "socket", "receptacle"],
    safety: "Burning smell, scorch marks, a hot outlet or sparks? Don't touch it. Call.",
    start: "find",
    nodes: {
      find: {
        text: "Look for an outlet with TEST and RESET buttons in the same room, or the nearest kitchen, bathroom, garage or outdoor outlet. One of these can control several outlets. Press RESET firmly until it clicks. Is the outlet working?",
        options: WORKING("dry"),
      },
      dry: {
        text: "Unplug everything from it and press RESET again. If the area got wet, let it dry for a few hours first. Is it working now?",
        options: WORKING("breaker"),
      },
      breaker: {
        text: "Check the breaker panel ({HC Breaker Panel}) for a switch in the middle or off. Push it fully off, then back on. Is the outlet working?",
        options: WORKING(),
      },
    },
  },
  {
    id: "drain",
    title: "Slow or clogged drain",
    keywords: ["drain", "clog", "clogged", "slow drain", "sink", "tub", "shower", "backed up"],
    safety: "Several drains backing up at once, or sewage coming up? Stop using all water and call.",
    start: "strainer",
    nodes: {
      strainer: {
        text: "Pull out the stopper or strainer and clear any hair or food. Is it draining now?",
        options: WORKING("plunge"),
      },
      plunge: {
        text: "Use a cup plunger: fill a few inches of water, cover the overflow hole with a wet cloth, and plunge 10 to 15 times. Please don't use chemical drain cleaners; they damage the pipes. Is it draining now?",
        options: WORKING(),
      },
    },
  },
  {
    id: "toilet",
    title: "Toilet clogged or running",
    keywords: ["toilet", "commode", "running toilet", "won't flush", "overflow"],
    safety: "Water rising toward the rim? Turn the valve behind the toilet clockwise to shut it off right away.",
    start: "which",
    nodes: {
      which: {
        text: "What's happening?",
        options: [
          { label: "It's clogged", next: "clogged" },
          { label: "It keeps running", next: "running" },
        ],
      },
      clogged: {
        text: "Don't flush again. Use a flange plunger (the kind with a sleeve) with 10 to 15 steady pushes. Is it clear?",
        options: WORKING("valve"),
      },
      running: {
        text: "Lift the tank lid and jiggle the handle. If the chain is tangled or too tight, loosen it so the rubber flapper sits flat. Has it stopped running?",
        options: WORKING("valve"),
      },
      valve: {
        text: "Turn the valve behind the toilet clockwise to shut off its water, and we'll send someone.",
        options: [{ label: "Valve is off", next: WORK_ORDER }],
      },
    },
  },
  {
    id: "hot_water",
    title: "No hot water",
    keywords: ["hot water", "water heater", "cold water", "no hot", "pilot"],
    safety: "Smell gas? Leave the home, then call the gas company and us from outside. Water pooling around the heater? Turn off the cold valve on top of the heater and call.",
    start: "type",
    nodes: {
      type: {
        text: "What kind of water heater do you have?",
        auto: {
          field: "HC Water Heater",
          routes: [
            { pattern: "tankless", next: "tankless" },
            { pattern: "gas", next: "gas" },
            { pattern: "electric", next: "electric" },
          ],
        },
        options: [
          { label: "Gas tank", next: "gas" },
          { label: "Electric tank", next: "electric" },
          { label: "Tankless", next: "tankless" },
          { label: "Not sure", next: WORK_ORDER },
        ],
      },
      gas: {
        text: "Look through the small window near the bottom of the heater. Can you see a small blue flame?",
        options: [
          { label: "Yes, there's a flame", next: "wait" },
          { label: "No flame", next: WORK_ORDER },
        ],
      },
      electric: {
        text: "Check the water heater breaker in the panel ({HC Breaker Panel}). If it's in the middle or off, push it fully off, then back on.",
        options: [{ label: "Done", next: "wait" }],
      },
      tankless: {
        text: "Open a hot tap all the way; a small trickle may not turn the heater on. Is hot water coming?",
        options: WORKING(),
      },
      wait: {
        text: "Wait 30 minutes, then try a hot tap. Is the water hot?",
        options: WORKING(),
      },
    },
  },
  {
    id: "hvac",
    title: "Heat or AC not working",
    keywords: ["heat", "heater", "furnace", "ac", "air conditioning", "a/c", "cooling", "thermostat", "hvac", "cold house", "hot house"],
    safety: "No heat and it's below freezing outside? Call us now.",
    start: "thermostat",
    nodes: {
      thermostat: {
        text: "Check the thermostat: set to Heat or Cool, at least 5 degrees past the room temperature. Blank screen? Replace its batteries. Is it running now?",
        options: WORKING("power"),
      },
      power: {
        text: "Check the furnace and AC breakers in the panel ({HC Breaker Panel}), and the on/off switch near the furnace (it looks like a light switch). Is it running now?",
        options: WORKING("filter"),
      },
      filter: {
        text: "Check the air filter ({HC Filter Location}, size {HC Filter Size}). A clogged filter can shut the system off; replace it if it's dirty. Is it running now?",
        options: WORKING("ice"),
      },
      ice: {
        text: "For AC: is there ice on the pipes or the indoor unit?",
        options: [
          { label: "Yes, there's ice", next: "thaw" },
          { label: "No ice, or it's the heat", next: "wait" },
        ],
      },
      thaw: {
        text: "Switch the system off and the fan to On so it can thaw, and we'll send someone.",
        options: [{ label: "Done", next: WORK_ORDER }],
      },
      wait: {
        text: "Give it 30 minutes. Is it heating or cooling now?",
        options: WORKING(),
      },
    },
  },
  {
    id: "dishwasher",
    title: "Dishwasher not draining",
    keywords: ["dishwasher", "dish washer", "standing water dishwasher"],
    safety: "Water leaking onto the floor? Stop the dishwasher, wipe up the water and call.",
    start: "filter",
    nodes: {
      filter: {
        text: "Twist out the filter at the bottom of the dishwasher and rinse it under the tap. If you have a disposal, run it for a few seconds; they share a drain. Then run a short rinse cycle. Did it drain?",
        options: WORKING(),
      },
    },
  },
  {
    id: "fridge",
    title: "Fridge not cooling",
    keywords: ["fridge", "refrigerator", "freezer", "not cold", "warm fridge"],
    safety: "Smell of burning or sparks at the plug? Unplug it if safe and call.",
    start: "light",
    nodes: {
      light: {
        text: "Open the door. Is the inside light on?",
        options: [
          { label: "Yes", next: "settings" },
          { label: "No", next: "power" },
        ],
      },
      power: {
        text: "Check that it's plugged in, and check the breaker panel ({HC Breaker Panel}). Is the light on now?",
        options: [
          { label: "Yes", next: "settings" },
          { label: "No", next: WORK_ORDER },
        ],
      },
      settings: {
        text: "Set it to about 37°F for the fridge and 0°F for the freezer. Make sure the doors close fully and food isn't blocking the vents inside. Then give it 24 hours. Is your food at risk of spoiling right now?",
        options: [
          { label: "Yes, food is getting warm", next: WORK_ORDER },
          { label: "No, I'll wait and see", next: FIXED },
        ],
      },
    },
  },
  {
    id: "detector",
    title: "Smoke or CO detector chirping",
    keywords: ["smoke detector", "smoke alarm", "chirp", "chirping", "beeping", "co detector", "carbon monoxide", "detector"],
    safety: "A CO alarm sounding (not chirping)? Get everyone outside and call 911. Smoke or fire? Get out and call 911.",
    start: "chirp",
    nodes: {
      chirp: {
        text: "One short chirp every 30 to 60 seconds means a low battery. Replace the battery ({HC Detector Battery}). Has it stopped?",
        options: WORKING(),
      },
    },
  },
];

const FALLBACK = "ask F.I.R.M. if you're not sure";

/** Fills {HC Field} placeholders from the property's custom fields. */
export function fillText(text: string, fields: PropertyFields): string {
  return text.replace(/\{(HC [^}]+)\}/g, (_, name: string) => fields[name]?.trim() || FALLBACK);
}

export function findGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** Ranks guides by how many of their keywords appear in what the tenant typed. Longer keywords count more. */
export function matchGuides(query: string): Guide[] {
  const q = ` ${query.toLowerCase().replace(/[^a-z0-9/ ]+/g, " ")} `;
  return GUIDES.map((guide) => ({
    guide,
    score: guide.keywords.reduce((sum, k) => (q.includes(` ${k} `) || q.includes(` ${k}s `) ? sum + k.length : sum), 0),
  }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.guide);
}

/** Follows an `auto` route when the property's field answers the question. */
export function resolveNode(guide: Guide, nodeId: string, fields: PropertyFields): Next {
  const node = guide.nodes[nodeId];
  if (!node?.auto) return nodeId;
  const value = fields[node.auto.field] ?? "";
  const route = node.auto.routes.find((r) => new RegExp(r.pattern, "i").test(value));
  return route ? route.next : nodeId;
}

export interface Walk {
  /** The node to show now, or an ending. */
  at: Next;
  /** Each question shown and the answer picked, for the work order. */
  history: { question: string; answer: string }[];
}

/** Replays a list of answer indexes from the start of a guide. Returns null if the path is invalid. */
export function walk(guide: Guide, answers: number[], fields: PropertyFields): Walk | null {
  let at: Next = resolveNode(guide, guide.start, fields);
  const history: Walk["history"] = [];
  for (const index of answers) {
    const node = guide.nodes[at];
    const option = node?.options[index];
    if (!option) return null;
    history.push({ question: fillText(node.text, fields), answer: option.label });
    at = option.next in guide.nodes ? resolveNode(guide, option.next, fields) : option.next;
  }
  return { at, history };
}
