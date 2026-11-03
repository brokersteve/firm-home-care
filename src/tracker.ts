// The work order tracker: every job F.I.R.M. has given a vendor, split by vendor, with what's still open,
// what F.I.R.M. owes each vendor and what the owner is charged. Modeled on Steve's Maintenance Worksheet.
// Jobs sent from the Work orders page land here on their own; others are added by hand.
import { Hono } from "hono";
import { html } from "hono/html";
import { daysBetween } from "./dates";
import type { Env } from "./env";
import { layout } from "./pages";
import { loadWorkOrder, setStatus } from "./maintenance";

export interface Job {
  id: number;
  work_order_id: number | null;
  vendor_id: number;
  issued_on: string;
  property: string;
  work: string;
  cost: number | null;
  owner_price: number | null;
  completed_on: string | null;
  vendor_paid_on: string | null;
  notes: string | null;
  invoice_number: string | null;
  owner_billed_on: string | null;
}

interface VendorRow {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  office_phone: string | null;
  sort_order: number | null;
}

/** A job open this many days or more is flagged. */
export const STALE_DAYS = 14;

export const money = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

const shortDay = (d: string | null) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : "");

export interface VendorSummary {
  vendor: VendorRow;
  jobs: Job[];
  open: Job[];
  /** Cost of jobs not yet paid to the vendor. */
  owed: number;
  /** Owner price of jobs still open or done in the period shown. */
  ownerCharged: number;
  cost: number;
}

/** Jobs grouped by vendor (most-used vendors first). Completed jobs older than `sinceDone` are left out unless unpaid. */
export function summarize(vendors: VendorRow[], jobs: Job[], sinceDone: string | null): VendorSummary[] {
  return vendors
    .map((vendor) => {
      const mine = jobs
        .filter((j) => j.vendor_id === vendor.id)
        .filter((j) => !sinceDone || !j.completed_on || j.completed_on >= sinceDone || (j.cost && !j.vendor_paid_on))
        .sort((a, b) => Number(!!a.completed_on) - Number(!!b.completed_on) || a.issued_on.localeCompare(b.issued_on));
      const sum = (list: Job[], f: (j: Job) => number | null) => list.reduce((t, j) => t + (f(j) ?? 0), 0);
      return {
        vendor,
        jobs: mine,
        open: mine.filter((j) => !j.completed_on),
        owed: sum(mine.filter((j) => !j.vendor_paid_on), (j) => j.cost),
        ownerCharged: sum(mine, (j) => j.owner_price),
        cost: sum(mine, (j) => j.cost),
      };
    })
    .filter((s) => s.jobs.length);
}

async function load(env: Env, today: string, all: boolean) {
  const vendors = (
    await env.DB.prepare("SELECT id, name, contact, phone, office_phone, sort_order FROM vendors ORDER BY sort_order IS NULL, sort_order, name").all<VendorRow>()
  ).results;
  const jobs = (await env.DB.prepare("SELECT * FROM jobs").all<Job>()).results;
  const since = all ? null : addDaysIso(today, -30);
  return summarize(vendors, jobs, since);
}

function addDaysIso(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const today = (env: Env) => new Date().toLocaleDateString("en-CA", { timeZone: env.TIMEZONE || "America/New_York" });

export const trackerRoutes = new Hono<{ Bindings: Env }>();

trackerRoutes.get("/admin/tracker", async (c) => {
  const day = today(c.env);
  const all = c.req.query("all") === "1";
  const groups = await load(c.env, day, all);
  const totals = {
    open: groups.reduce((t, g) => t + g.open.length, 0),
    owed: groups.reduce((t, g) => t + g.owed, 0),
    owner: groups.reduce((t, g) => t + g.ownerCharged, 0),
    cost: groups.reduce((t, g) => t + g.cost, 0),
  };
  return c.html(
    layout(
      "Work order tracker",
      html`<h1>Work order tracker</h1>
<div class="stats"><div><b>${totals.open}</b><span>open jobs</span></div><div><b>${money(totals.owed)}</b><span>owed to vendors</span></div>
<div><b>${money(totals.owner)}</b><span>charged to owners</span></div><div><b>${money(totals.owner - totals.cost)}</b><span>difference</span></div></div>
<p class="quiet">Open jobs first, oldest at the top; ⚠ means open ${STALE_DAYS}+ days. ${all ? html`Showing every job. <a href="/admin/tracker">Recent only</a>` : html`Done jobs from the last 30 days, plus any not yet paid. <a href="/admin/tracker?all=1">Show all</a>`}</p>
<a class="btn primary" href="/admin/tracker/new">Add a job</a>
${groups.map(
  (g) => html`<div class="card"><h2>${g.vendor.name}</h2>
<p class="quiet">${g.vendor.contact ? html`${g.vendor.contact} · ` : ""}${g.vendor.phone ?? g.vendor.office_phone ?? ""}</p>
<p><strong>${g.open.length} open</strong> · We owe ${money(g.owed) || "$0"} · Owner charged ${money(g.ownerCharged) || "$0"}</p>
<div class="scroll"><table><tr><th>Issued</th><th>Property</th><th>Work</th><th class="n">Cost</th><th class="n">Owner</th><th>Done</th></tr>
${g.jobs.map((j) => {
  const age = j.completed_on ? 0 : daysBetween(j.issued_on, day);
  return html`<tr${j.completed_on ? html` class="done"` : ""}><td>${shortDay(j.issued_on)}${age >= STALE_DAYS ? html` <span title="Open ${age} days">⚠</span>` : ""}</td>
<td><a href="/admin/tracker/${j.id}">${j.property}</a></td><td>${j.work}</td><td class="n">${money(j.cost)}</td><td class="n">${money(j.owner_price)}</td>
<td>${j.completed_on ? html`${shortDay(j.completed_on)}${j.cost && !j.vendor_paid_on ? html`<br><small>unpaid</small>` : ""}${j.owner_price && !j.owner_billed_on ? html`<br><small>owner not billed</small>` : ""}` : html`<small>${age}d open</small>`}</td></tr>`;
})}</table></div></div>`,
)}
${groups.length ? "" : html`<p class="quiet">No jobs yet. Send a work order to a vendor, or add a job.</p>`}
<a class="quiet" href="/admin/">Back to admin</a>
<style>.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:8px 0}.stats div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.stats b{display:block;font-size:20px}.stats span{color:var(--quiet);font-size:13px}.scroll{overflow-x:auto}.n{text-align:right;font-variant-numeric:tabular-nums}
tr.done td{color:var(--quiet)}</style>`,
    ),
  );
});

async function vendorOptions(env: Env, selected: number | null) {
  const { results } = await env.DB.prepare("SELECT id, name FROM vendors WHERE active = 1 ORDER BY sort_order IS NULL, sort_order, name").all<{ id: number; name: string }>();
  return results.map((v) => html`<option value="${v.id}" ${v.id === selected ? "selected" : ""}>${v.name}</option>`);
}

async function jobForm(env: Env, job: Partial<Job>, saved: boolean) {
  const f = (name: keyof Job, label: string, type = "text", extra = "") =>
    html`<label for="${name}">${label}</label><input type="${type}" id="${name}" name="${name}" value="${job[name] ?? ""}" ${extra}>`;
  return layout(
    job.id ? "Job" : "Add a job",
    html`<h1>${job.id ? job.work : "Add a job"}</h1>
${saved ? html`<div class="card note"><p>Saved.</p></div>` : ""}
<form method="post" class="card">
<label for="vendor_id">Vendor</label><select id="vendor_id" name="vendor_id" required>${await vendorOptions(env, job.vendor_id ?? null)}</select>
${f("issued_on", "Date issued", "date", "required")}${f("property", "Property", "text", "required")}${f("work", "Work", "text", "required")}
${f("cost", "Cost (what we pay the vendor)", "number", 'step="0.01" min="0" inputmode="decimal"')}${f("owner_price", "Owner price (what the owner is charged)", "number", 'step="0.01" min="0" inputmode="decimal"')}
${f("completed_on", "Complete date", "date")}${f("invoice_number", "Vendor invoice #")}${f("vendor_paid_on", "Vendor paid on", "date")}${f("owner_billed_on", "Owner billed on", "date")}
<label for="notes">Notes</label><textarea id="notes" name="notes">${job.notes ?? ""}</textarea>
<button class="btn primary">Save</button>
${job.id && !job.completed_on ? html`<button class="btn" name="quick" value="done">Mark done today</button>` : ""}
${job.id && job.completed_on && !job.vendor_paid_on ? html`<button class="btn" name="quick" value="paid">Mark vendor paid today</button>` : ""}
${job.id && job.completed_on && job.owner_price && !job.owner_billed_on ? html`<button class="btn" name="quick" value="billed">Mark owner billed today</button>` : ""}
</form>
${job.work_order_id ? html`<a class="btn" href="/admin/workorders/${job.work_order_id}">Open the tenant's work order</a>` : ""}
<a class="quiet" href="/admin/tracker">Back to the tracker</a>`,
  );
}

function jobFields(body: Record<string, unknown>) {
  const s = (k: string) => String(body[k] ?? "").trim();
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s(k)) ? s(k) : null);
  const num = (k: string) => (s(k) === "" || Number.isNaN(Number(s(k))) ? null : Math.round(Number(s(k)) * 100) / 100);
  return {
    vendor_id: Number(s("vendor_id")) || 0,
    issued_on: day("issued_on"),
    property: s("property").slice(0, 200),
    work: s("work").slice(0, 300),
    cost: num("cost"),
    owner_price: num("owner_price"),
    completed_on: day("completed_on"),
    vendor_paid_on: day("vendor_paid_on"),
    notes: s("notes").slice(0, 2000) || null,
    invoice_number: s("invoice_number").slice(0, 60) || null,
    owner_billed_on: day("owner_billed_on"),
  };
}

trackerRoutes.get("/admin/tracker/new", async (c) => c.html(await jobForm(c.env, { issued_on: today(c.env) }, false)));

trackerRoutes.post("/admin/tracker/new", async (c) => {
  const j = jobFields(await c.req.parseBody());
  if (!j.vendor_id || !j.issued_on || !j.property || !j.work) return c.redirect("/admin/tracker/new", 303);
  const row = await c.env.DB.prepare(
    `INSERT INTO jobs (vendor_id, issued_on, property, work, cost, owner_price, completed_on, vendor_paid_on, notes, invoice_number, owner_billed_on)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(j.vendor_id, j.issued_on, j.property, j.work, j.cost, j.owner_price, j.completed_on, j.vendor_paid_on, j.notes, j.invoice_number, j.owner_billed_on)
    .first<{ id: number }>();
  return c.redirect(`/admin/tracker/${row!.id}?saved=1`, 303);
});

trackerRoutes.get("/admin/tracker/:id", async (c) => {
  const job = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(Number(c.req.param("id")) || 0).first<Job>();
  if (!job) return c.text("Job not found", 404);
  return c.html(await jobForm(c.env, job, c.req.query("saved") === "1"));
});

trackerRoutes.post("/admin/tracker/:id", async (c) => {
  const id = Number(c.req.param("id")) || 0;
  const body = await c.req.parseBody();
  const j = jobFields(body);
  const day = today(c.env);
  if (body["quick"] === "done") j.completed_on = day;
  if (body["quick"] === "paid") j.vendor_paid_on = day;
  if (body["quick"] === "billed") j.owner_billed_on = day;
  if (!j.vendor_id || !j.issued_on || !j.property || !j.work) return c.redirect(`/admin/tracker/${id}`, 303);
  const before = await c.env.DB.prepare("SELECT work_order_id, completed_on FROM jobs WHERE id = ?").bind(id).first<Pick<Job, "work_order_id" | "completed_on">>();
  await c.env.DB.prepare(
    `UPDATE jobs SET vendor_id = ?, issued_on = ?, property = ?, work = ?, cost = ?, owner_price = ?, completed_on = ?, vendor_paid_on = ?, notes = ?,
       invoice_number = ?, owner_billed_on = ? WHERE id = ?`,
  )
    .bind(j.vendor_id, j.issued_on, j.property, j.work, j.cost, j.owner_price, j.completed_on, j.vendor_paid_on, j.notes, j.invoice_number, j.owner_billed_on, id)
    .run();
  // A job marked done here completes the tenant's work order too, so they're asked whether it's fixed.
  if (j.completed_on && !before?.completed_on && before?.work_order_id) {
    const wo = await loadWorkOrder(c.env, before.work_order_id);
    if (wo && wo.status !== "completed") await setStatus(c.env, wo, "completed");
  }
  return c.redirect(body["quick"] ? "/admin/tracker" : `/admin/tracker/${id}?saved=1`, 303);
});

/** The daily tracker email for the office: open jobs by vendor, oldest first, and money owed. */
export async function trackerEmail(env: Env, day: string): Promise<{ subject: string; html: string } | null> {
  const groups = (await load(env, day, false)).filter((g) => g.open.length || g.owed);
  if (!groups.length) return null;
  const open = groups.reduce((t, g) => t + g.open.length, 0);
  const owed = groups.reduce((t, g) => t + g.owed, 0);
  const stale = groups.reduce((t, g) => t + g.open.filter((j) => daysBetween(j.issued_on, day) >= STALE_DAYS).length, 0);
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  const rows = groups
    .map(
      (g) => `<h3 style="margin:16px 0 4px">${esc(g.vendor.name)}: ${g.open.length} open${g.owed ? `, we owe ${money(g.owed)}` : ""}</h3>
<ul style="margin:0;padding-left:18px">${g.open
        .map((j) => {
          const age = daysBetween(j.issued_on, day);
          return `<li>${age >= STALE_DAYS ? "&#9888; " : ""}${esc(j.property)}: ${esc(j.work)} (${age} days)${j.owner_price ? `, owner ${money(j.owner_price)}` : ""}</li>`;
        })
        .join("")}</ul>`,
    )
    .join("");
  return {
    subject: `Work order tracker: ${open} open${stale ? `, ${stale} over ${STALE_DAYS} days` : ""}, ${money(owed) || "$0"} owed to vendors`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1d2329">${rows}
<p style="margin-top:16px"><a href="${env.APP_URL}/admin/tracker">Open the tracker</a></p></div>`,
  };
}
