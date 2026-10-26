// Simple line drawings shown beside troubleshooting steps. They use the page's colour variables,
// so they read in light and dark mode. Each is a plain SVG string.

const INK = "var(--ink)";
const QUIET = "var(--quiet)";
const LINE = "var(--line)";
const ACCENT = "var(--brand)";
const ALERT = "var(--alert)";

const svg = (label: string, height: number, body: string) =>
  `<svg viewBox="0 0 380 ${height}" role="img" aria-label="${label}" font-family="system-ui,sans-serif" font-size="12" style="width:100%;max-width:420px;display:block;margin:12px auto">
<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${ACCENT}"/></marker></defs>${body}</svg>`;

export const DIAGRAMS = {
  disposal_bottom: svg(
    "Bottom of the disposal: hex socket in the center, red reset button near the edge",
    200,
    `<text x="160" y="16" text-anchor="middle" fill="${QUIET}">Looking up at the bottom of the disposal</text>
<circle cx="140" cy="110" r="72" fill="none" stroke="${INK}" stroke-width="2"/>
<circle cx="140" cy="110" r="10" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>
<polygon points="140,104 145,107 145,113 140,116 135,113 135,107" fill="${ACCENT}"/>
<circle cx="190" cy="150" r="8" fill="${ALERT}"/>
<path d="M250 70 L156 104" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="252" y="62" fill="${INK}">Hex socket: wrench</text><text x="252" y="76" fill="${INK}">goes here, turn</text><text x="252" y="90" fill="${INK}">back and forth</text>
<path d="M250 170 L202 154" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="252" y="172" fill="${INK}">Red reset</text><text x="252" y="186" fill="${INK}">button: press</text>`,
  ),
  breaker_panel: svg(
    "A tripped breaker sits in the middle. Push it fully off, then back on.",
    190,
    `<rect x="40" y="20" width="120" height="160" rx="6" fill="none" stroke="${INK}" stroke-width="2"/>
${[0, 1, 2, 3, 4]
  .map((i) => {
    const y = 36 + i * 28;
    const tripped = i === 2;
    return `<rect x="56" y="${y}" width="88" height="20" rx="3" fill="none" stroke="${tripped ? ALERT : LINE}" stroke-width="${tripped ? 2 : 1.5}"/>
<rect x="${tripped ? 92 : 112}" y="${y + 4}" width="16" height="12" rx="2" fill="${tripped ? ALERT : INK}"/>`;
  })
  .join("")}
<path d="M230 102 L152 102" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="176" y="40" fill="${INK}">ON switches all</text><text x="176" y="54" fill="${INK}">point one way</text>
<text x="236" y="98" fill="${ALERT}" font-weight="600">Tripped: stuck</text><text x="236" y="112" fill="${ALERT}" font-weight="600">in the middle</text>
<text x="176" y="160" fill="${INK}">Push fully OFF,</text><text x="176" y="174" fill="${INK}">then back ON</text>`,
  ),
  gfci: svg(
    "GFCI outlet with TEST and RESET buttons between the two plugs. Press RESET.",
    190,
    `<rect x="70" y="14" width="110" height="166" rx="10" fill="none" stroke="${INK}" stroke-width="2"/>
<rect x="95" y="34" width="60" height="34" rx="8" fill="none" stroke="${INK}" stroke-width="1.5"/>
<rect x="95" y="126" width="60" height="34" rx="8" fill="none" stroke="${INK}" stroke-width="1.5"/>
<rect x="88" y="80" width="34" height="34" rx="4" fill="none" stroke="${QUIET}" stroke-width="1.5"/><text x="105" y="101" text-anchor="middle" fill="${QUIET}" font-size="10">TEST</text>
<rect x="128" y="80" width="34" height="34" rx="4" fill="none" stroke="${ACCENT}" stroke-width="2.5"/><text x="145" y="101" text-anchor="middle" fill="${ACCENT}" font-size="10" font-weight="600">RESET</text>
<path d="M250 97 L166 97" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="196" y="80" fill="${INK}">Press RESET</text><text x="196" y="122" fill="${INK}">until it clicks</text>`,
  ),
  toilet_valve: svg(
    "The shutoff valve is low on the wall behind the toilet. Turn it clockwise to stop the water.",
    190,
    `<line x1="20" y1="180" x2="300" y2="180" stroke="${LINE}" stroke-width="2"/><line x1="40" y1="20" x2="40" y2="180" stroke="${LINE}" stroke-width="2"/>
<rect x="60" y="30" width="70" height="60" rx="6" fill="none" stroke="${INK}" stroke-width="2"/>
<path d="M60 96 H200 Q200 140 160 150 L150 180 H100 L96 150 Q60 140 60 96Z" fill="none" stroke="${INK}" stroke-width="2"/>
<line x1="40" y1="150" x2="62" y2="150" stroke="${INK}" stroke-width="3"/><line x1="62" y1="150" x2="70" y2="96" stroke="${QUIET}" stroke-width="2"/>
<ellipse cx="52" cy="150" rx="7" ry="11" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>
<path d="M44 128 A14 14 0 0 1 64 134" fill="none" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="210" y="120" fill="${INK}">Valve behind</text><text x="210" y="134" fill="${INK}">the toilet:</text><text x="210" y="148" fill="${ACCENT}" font-weight="600">turn clockwise</text><text x="210" y="162" fill="${INK}">to shut off</text>`,
  ),
  toilet_tank: svg(
    "Inside the tank: the chain from the handle lifts the rubber flapper. Leave a little slack so the flapper seals.",
    200,
    `<rect x="30" y="20" width="200" height="170" rx="6" fill="none" stroke="${INK}" stroke-width="2"/>
<line x1="30" y1="60" x2="230" y2="60" stroke="${LINE}" stroke-dasharray="4 4"/><text x="236" y="64" fill="${QUIET}">water line</text>
<line x1="20" y1="40" x2="120" y2="40" stroke="${INK}" stroke-width="3"/><text x="36" y="34" fill="${INK}">handle lever</text>
<path d="M118 40 Q124 90 112 150" fill="none" stroke="${ACCENT}" stroke-width="1.5" stroke-dasharray="3 3"/>
<ellipse cx="110" cy="160" rx="30" ry="8" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>
<line x1="80" y1="176" x2="140" y2="176" stroke="${INK}" stroke-width="2"/>
<text x="236" y="120" fill="${INK}">Chain: a little</text><text x="236" y="134" fill="${INK}">slack, not tangled</text>
<text x="236" y="164" fill="${INK}">Flapper must</text><text x="236" y="178" fill="${INK}">sit flat to seal</text>`,
  ),
  water_shutoff: svg(
    "Two kinds of main water shutoff. Turn a round wheel clockwise. Turn a lever a quarter turn so it crosses the pipe.",
    170,
    `<line x1="20" y1="80" x2="140" y2="80" stroke="${INK}" stroke-width="6"/><line x1="80" y1="80" x2="80" y2="50" stroke="${INK}" stroke-width="3"/>
<circle cx="80" cy="40" r="18" fill="none" stroke="${ACCENT}" stroke-width="2.5"/>
<path d="M60 22 A26 26 0 0 1 104 28" fill="none" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="80" y="118" text-anchor="middle" fill="${INK}" font-weight="600">Round wheel</text><text x="80" y="134" text-anchor="middle" fill="${INK}">turn clockwise</text><text x="80" y="150" text-anchor="middle" fill="${INK}">until it stops</text>
<line x1="180" y1="80" x2="300" y2="80" stroke="${INK}" stroke-width="6"/><rect x="232" y="68" width="16" height="24" fill="none" stroke="${INK}" stroke-width="2"/>
<line x1="240" y1="70" x2="240" y2="30" stroke="${ACCENT}" stroke-width="5" stroke-linecap="round"/>
<line x1="240" y1="70" x2="280" y2="70" stroke="${QUIET}" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 6"/>
<text x="240" y="118" text-anchor="middle" fill="${INK}" font-weight="600">Lever</text><text x="240" y="134" text-anchor="middle" fill="${INK}">quarter turn so it</text><text x="240" y="150" text-anchor="middle" fill="${INK}">crosses the pipe = off</text>`,
  ),
  dishwasher_filter: svg(
    "The filter sits in the floor of the dishwasher under the bottom rack. Twist it out, rinse, twist back in.",
    170,
    `<rect x="40" y="20" width="240" height="130" rx="6" fill="none" stroke="${INK}" stroke-width="2"/>
<line x1="40" y1="110" x2="280" y2="110" stroke="${LINE}" stroke-width="2"/><text x="50" y="140" fill="${QUIET}" font-size="11">floor of the tub</text><text x="50" y="128" fill="${QUIET}" font-size="11">(rack removed)</text>
<ellipse cx="160" cy="124" rx="28" ry="10" fill="none" stroke="${ACCENT}" stroke-width="2.5"/><rect x="146" y="80" width="28" height="44" rx="4" fill="none" stroke="${ACCENT}" stroke-width="2"/>
<path d="M120 70 A40 16 0 0 1 200 70" fill="none" stroke="${ACCENT}" stroke-width="1.5" marker-end="url(#arr)"/>
<text x="160" y="50" text-anchor="middle" fill="${INK}">Twist to unlock, lift out, rinse</text>`,
  ),
} as const;

export type DiagramId = keyof typeof DIAGRAMS;
