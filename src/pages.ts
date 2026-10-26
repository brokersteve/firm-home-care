import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Env, Property, Tenant } from "./env";
import { FIXED, GUIDES, WORK_ORDER, fillText, type Guide, type Walk } from "./guides";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

const STYLE = `
:root{--ink:#1d2329;--quiet:#5b6670;--line:#d9dee3;--brand:#1f5f8b;--bg:#f6f7f9;--card:#fff;--alert:#b3261e}
@media (prefers-color-scheme:dark){:root{--ink:#e8ebee;--quiet:#a3adb6;--line:#38414a;--brand:#7cb8e4;--bg:#14181c;--card:#1d2328;--alert:#f2b8b5}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:560px;margin:0 auto;padding:16px}
header{padding:8px 0 4px}header small{color:var(--quiet)}
h1{font-size:22px;margin:4px 0 12px}h2{font-size:17px;margin:0 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}
.alert{border-color:var(--alert)}.alert h2{color:var(--alert)}
.btn{display:block;width:100%;text-align:center;padding:14px 16px;margin:8px 0;border-radius:10px;border:1px solid var(--brand);
  background:var(--card);color:var(--brand);font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
.btn.primary{background:var(--brand);color:var(--card)}.btn.danger{border-color:var(--alert);color:var(--alert)}
dl{margin:0}dt{color:var(--quiet);font-size:14px;margin-top:8px}dd{margin:0}
input[type=search]{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);font:inherit;background:var(--card);color:var(--ink)}
ol{padding-left:20px}li{margin:6px 0}.quiet{color:var(--quiet);font-size:14px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid var(--line);padding:6px 4px;text-align:left;vertical-align:top}
`;

export function layout(title: string, body: Html): Html {
  return html`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · F.I.R.M. Home Care</title><style>${raw(STYLE)}</style></head>
<body><main><header><small>F.I.R.M. Home Care</small></header>${body}</main></body></html>`;
}

function emergencyCard(env: Env): Html {
  return html`<div class="card alert"><h2>Emergency?</h2>
<p>Fire, gas smell or CO alarm: get out and call 911. Flooding, no heat in freezing weather, or anything unsafe: call F.I.R.M.</p>
<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">Call ${env.EMERGENCY_PHONE}</a></div>`;
}

function infoList(property: Property, rows: [string, string][]): Html {
  const filled = rows.filter(([, field]) => property.fields[field]);
  if (!filled.length) return html`<p class="quiet">Not on file yet. Ask F.I.R.M.</p>`;
  return html`<dl>${filled.map(([label, field]) => html`<dt>${label}</dt><dd>${property.fields[field]}</dd>`)}</dl>`;
}

export function homePage(env: Env, base: string, tenant: Tenant, property: Property): Html {
  return layout(
    "Home",
    html`<h1>Hi ${tenant.first_name}</h1><p class="quiet">${property.address}</p>
${emergencyCard(env)}
<div class="card"><h2>Something not working?</h2>
<form action="${base}/help" method="get"><input type="search" name="q" placeholder="e.g. garbage disposal not working" aria-label="Describe the problem"></form>
<a class="btn" href="${base}/help">See common fixes</a></div>
<div class="card"><h2>Emergency guide for your home</h2>${infoList(property, [
      ["Water shutoff", "HC Water Shutoff"],
      ["Gas shutoff", "HC Gas Shutoff"],
      ["Breaker panel", "HC Breaker Panel"],
    ])}</div>
<div class="card"><h2>Your home</h2>${infoList(property, [
      ["Air filter", "HC Filter Size"],
      ["Filter location", "HC Filter Location"],
      ["Heating", "HC Heat Type"],
      ["Water heater", "HC Water Heater"],
    ])}</div>
<div class="card"><h2>Local info</h2>${infoList(property, [
      ["Trash and recycling", "HC Trash Day"],
      ["Utilities", "HC Utilities"],
      ["Good to know", "HC Local Notes"],
    ])}</div>
<div class="card"><h2>Rent and repairs</h2><p class="quiet">Pay rent, request repairs and see your lease in Resident Connect.</p>
<a class="btn" href="${env.RESIDENT_CONNECT_URL}">Open Resident Connect</a></div>`,
  );
}

export function helpPage(base: string, query: string, matches: Guide[]): Html {
  const others = GUIDES.filter((g) => !matches.includes(g));
  return layout(
    "Troubleshooting",
    html`<h1>What's going on?</h1>
<form method="get"><input type="search" name="q" value="${query}" placeholder="e.g. toilet keeps running" aria-label="Describe the problem"></form>
${query && !matches.length ? html`<p class="quiet">No guide matched “${query}”. Pick one below, or submit a work order in Resident Connect.</p>` : ""}
${matches.length ? html`<div class="card"><h2>Best match</h2>${matches.map((g) => html`<a class="btn primary" href="${base}/guide/${g.id}">${g.title}</a>`)}</div>` : ""}
<div class="card"><h2>${matches.length ? "Other guides" : "Common problems"}</h2>${others.map((g) => html`<a class="btn" href="${base}/guide/${g.id}">${g.title}</a>`)}</div>
<a class="quiet" href="${base}">Back to my home page</a>`,
  );
}

export function safetyPage(base: string, guide: Guide, env: Env): Html {
  return layout(
    guide.title,
    html`<h1>${guide.title}</h1>
<div class="card alert"><h2>Safety first</h2><p>${guide.safety}</p>
<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">This is an emergency: call ${env.EMERGENCY_PHONE}</a></div>
<a class="btn primary" href="${base}/guide/${guide.id}?a=">I'm safe, let's start</a>`,
  );
}

export function stepPage(base: string, guide: Guide, answers: number[], walked: Walk, property: Property): Html {
  const node = guide.nodes[walked.at]!;
  const prefix = answers.length ? `${answers.join(",")},` : "";
  return layout(
    guide.title,
    html`<h1>${guide.title}</h1><div class="card"><p>${fillText(node.text, property.fields)}</p>
${node.options.map((o, i) =>
  o.next === FIXED || o.next === WORK_ORDER
    ? html`<form method="post" action="${base}/guide/${guide.id}/finish"><input type="hidden" name="a" value="${prefix}${i}"><button class="btn ${o.next === FIXED ? "primary" : ""}">${o.label}</button></form>`
    : html`<a class="btn" href="${base}/guide/${guide.id}?a=${prefix}${i}">${o.label}</a>`,
)}</div>
<a class="quiet" href="${base}/guide/${guide.id}${answers.length ? `?a=${answers.slice(0, -1).join(",")}` : ""}">Back</a>`,
  );
}

export function endingPage(base: string, title: string, message: string, env: Env, extra?: Html): Html {
  return layout(
    title,
    html`<h1>${title}</h1><div class="card"><p>${message}</p>${extra ?? ""}</div>
<p class="quiet">Emergency? Call ${env.EMERGENCY_PHONE}.</p><a class="btn" href="${base}">Back to my home page</a>`,
  );
}

export function emergencyEnding(base: string, env: Env): Html {
  return endingPage(base, "Call us now", "This needs attention right away. Please call F.I.R.M.", env, html`<a class="btn danger" href="tel:${env.EMERGENCY_PHONE}">Call ${env.EMERGENCY_PHONE}</a>`);
}

