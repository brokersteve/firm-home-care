import { html } from "hono/html";
import type { Property } from "./env";
import type { Env } from "./env";
import { layout } from "./pages";
import { FIELDS, REQUIRED_FIELDS } from "./fields";
import { listProperties } from "./store";
import { pilotAddresses, sameAddress } from "./sync";

export async function adminPage(env: Env) {
  const properties = await listProperties(env);
  const tenants = await env.DB.prepare(
    "SELECT property_id, COUNT(*) AS n, SUM(email IS NULL) AS no_email FROM tenants WHERE active = 1 GROUP BY property_id",
  ).all<{ property_id: string; n: number; no_email: number }>();
  const byProperty = new Map(tenants.results.map((r) => [r.property_id, r]));
  const lastSync = await env.DB.prepare("SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1").first<{
    started_at: string;
    properties: number | null;
    tenants: number | null;
    error: string | null;
  }>();
  const reminders = await env.DB.prepare(
    "SELECT kind, COUNT(*) AS sent, COUNT(done_at) AS done FROM reminders_sent GROUP BY kind ORDER BY kind",
  ).all<{ kind: string; sent: number; done: number }>();
  const outcomes = await env.DB.prepare(
    "SELECT guide_id, SUM(outcome = 'fixed') AS fixed, SUM(outcome = 'work_order') AS work_orders FROM guide_outcomes GROUP BY guide_id ORDER BY guide_id",
  ).all<{ guide_id: string; fixed: number; work_orders: number }>();

  // Pilot addresses with no matching home in Rentec: usually a typo, or a different spelling in Rentec.
  const notFound = pilotAddresses(env).filter((a) => !properties.some((p) => sameAddress(a, p)));

  return layout(
    "Admin",
    html`<h1>Home Care admin</h1>
<a class="btn primary" href="/admin/workorders">Work orders</a> <a class="btn" href="/admin/tenants">Tenants</a> <a class="btn" href="/admin/intake">Paste home details</a> <a class="btn" href="/admin/inspect">Inspections</a> <a class="btn" href="/admin/rentec-check">Check Rentec connection</a>
<div class="card"><h2>Last Rentec sync</h2>
${lastSync
  ? html`<p>${lastSync.started_at.slice(0, 16).replace("T", " ")} UTC: ${lastSync.properties ?? 0} properties, ${lastSync.tenants ?? 0} tenants
${lastSync.error ? html`<br><strong>Error:</strong> ${lastSync.error}` : ""}</p>`
  : html`<p class="quiet">Never run.</p>`}
<form method="post" action="/admin/run"><button class="btn">Sync and send due reminders now</button></form></div>
<div class="card"><h2>Pilot properties</h2><table><tr><th>Property</th><th>Tenants</th><th>Missing fields</th></tr>
${properties.map((p) => {
  const t = byProperty.get(p.id);
  const missing = REQUIRED_FIELDS.filter((f) => !p.fields[f]);
  return html`<tr><td><a href="/admin/home/${encodeURIComponent(p.id)}">${p.name}</a></td><td>${t?.n ?? 0}${t?.no_email ? html` (${t.no_email} without email)` : ""}</td><td>${missing.length ? missing.join(", ") : "None"}</td></tr>`;
})}</table>
${notFound.length && lastSync
  ? html`<p><strong>Not found in Rentec:</strong> ${notFound.join("; ")}. Check the spelling in PILOT_ADDRESSES against Rentec.</p>`
  : ""}</div>
<div class="card"><h2>Reminders</h2><table><tr><th>Reminder</th><th>Sent</th><th>Done</th></tr>
${reminders.results.map((r) => html`<tr><td>${r.kind}</td><td>${r.sent}</td><td>${r.done}</td></tr>`)}</table></div>
<div class="card"><h2>Troubleshooting</h2><table><tr><th>Guide</th><th>Fixed by tenant</th><th>Work orders</th></tr>
${outcomes.results.map((r) => html`<tr><td>${r.guide_id}</td><td>${r.fixed}</td><td>${r.work_orders}</td></tr>`)}</table></div>`,
  );
}

/** The phone form an inspector fills in at the property. Saving writes the fields to Rentec. */
export function homeDetailsPage(
  property: Property,
  saved: boolean,
  nav: { action?: string; back: string; backLabel: string; button: string } = { back: "/admin/", backLabel: "Back to admin", button: "Save to Rentec" },
) {
  const sections = [...new Set(FIELDS.map((f) => f.section))];
  return layout(
    "Home details",
    html`<h1>Home details</h1><p class="quiet">${property.address}</p>
${saved ? html`<div class="card note"><p>Saved to Rentec.</p></div>` : ""}
<p class="quiet">Fields marked * are needed for the tenant's Home Care page. Saving writes them to the property in Rentec.</p>
<form method="post"${nav.action ? html` action="${nav.action}"` : ""}>
${sections.map(
  (section) => html`<div class="card"><h2>${section}</h2>
${FIELDS.filter((f) => f.section === section).map(
  (f) => html`<label for="${f.name}">${f.label}${f.required ? " *" : ""} <small>${f.hint}</small></label>
<input type="text" id="${f.name}" name="${f.name}" value="${property.fields[f.name] ?? ""}" ${f.choices ? html`list="${f.name}-choices"` : ""}>
${f.choices ? html`<datalist id="${f.name}-choices">${f.choices.map((c) => html`<option value="${c}">`)}</datalist>` : ""}`,
)}</div>`,
)}
<button class="btn primary">${nav.button}</button></form>
<a class="quiet" href="${nav.back}">${nav.backLabel}</a>`,
  );
}

/** Active tenants with their contact details and renters insurance end date (editable). */
export async function tenantsPage(env: Env, saved?: string) {
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.phone, t.insurance_expires, p.name AS home
     FROM tenants t JOIN properties p ON p.id = t.property_id WHERE t.active = 1 ORDER BY p.name, t.last_name`,
  ).all<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; insurance_expires: string | null; home: string }>();
  return layout(
    "Tenants",
    html`<h1>Tenants</h1>
<p class="quiet">Rentec doesn't share renters insurance dates through its API, so tenants enter their policy end date on their Home Care page. Correct it here when you see a new policy in Rentec. Reminders go 30 days before and the day after this date. Leave it blank to clear it.</p>
${results.map(
  (t) => html`<div class="card${saved === t.id ? " note" : ""}"><h2>${t.first_name} ${t.last_name}</h2>
<p class="quiet">${t.home}<br>${t.email ?? "No email"} · ${t.phone ?? "No phone"}</p>
<form method="post" action="/admin/tenants/${encodeURIComponent(t.id)}/insurance"><label for="ins-${t.id}">Renters insurance ends${saved === t.id ? " (saved)" : ""}</label>
<input type="date" id="ins-${t.id}" name="expires" value="${t.insurance_expires ?? ""}"> <button class="btn">Save</button></form></div>`,
)}
${results.length ? "" : html`<p>No active tenants yet. Run the Rentec sync from the admin page.</p>`}
<a class="quiet" href="/admin/">Back to admin</a>`,
  );
}
