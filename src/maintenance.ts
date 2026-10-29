// The maintenance tracker (plan v2) on top of tenant work orders. Rentec's work order stays the record; this adds
// triage, what each job is waiting on, the status the tenant sees (Received, Vendor contacted, Scheduled, In
// progress, Completed), the owner approval step, close-out by the tenant, and the office's alerts and end-of-day
// summary. Never promises the tenant a date or a charge: the only date a tenant sees is one staff entered.
import { Hono } from "hono";
import { html } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import { daysBetween, parseDay } from "./dates";
import type { Vendor, WorkOrder } from "./dispatch";
import { sendEmail } from "./email";
import type { Env, Property, Tenant } from "./env";
import { homeLink } from "./links";
import { layout } from "./pages";
import { pushToTenant } from "./push";
import { RentecClient, type RentecWorkOrder } from "./rentec";
import { sendText, toE164 } from "./sms";
import { getProperty, getTenant } from "./store";
import { CATEGORIES, FLAGS, TIERS, TIER_ORDER, dueAt, type Category, type Flag, type Tier } from "./triage";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export type Status = "received" | "vendor_contacted" | "scheduled" | "in_progress" | "completed";
export type WaitingOn = "vendor" | "owner" | "tenant" | "parts";

export const STATUSES: Record<Status, { label: string; rank: number }> = {
  received: { label: "Received", rank: 0 },
  vendor_contacted: { label: "Vendor contacted", rank: 1 },
  scheduled: { label: "Scheduled", rank: 2 },
  in_progress: { label: "In progress", rank: 3 },
  completed: { label: "Completed", rank: 4 },
};
const STATUS_ORDER = Object.keys(STATUSES) as Status[];

export const WAITING: Record<WaitingOn, string> = { vendor: "Vendor", owner: "Owner approval", tenant: "Tenant access", parts: "Parts" };

/** An open work order with no update for this many days is flagged. */
export const STALE_UPDATE_DAYS = 3;

/** What Rentec's work order status means for the tenant's status. OpenU (unassigned) changes nothing. */
export const RENTEC_STATUS: Record<string, { status: Status; waiting?: WaitingOn }> = {
  OpenA: { status: "vendor_contacted", waiting: "vendor" },
  Assigned: { status: "vendor_contacted", waiting: "vendor" },
  Parts: { status: "in_progress", waiting: "parts" },
  Work: { status: "in_progress" },
  Finalized: { status: "completed" },
  Closed: { status: "completed" },
};

const REVIEW_FLAGS: Flag[] = ["accommodation", "tenant_damage", "pest_after_30"];

export const flagList = (wo: Pick<WorkOrder, "flags">) => (wo.flags ? (wo.flags.split(",") as Flag[]) : []);
export const needsReview = (wo: Pick<WorkOrder, "flags" | "reviewed_at">) => !wo.reviewed_at && flagList(wo).some((f) => REVIEW_FLAGS.includes(f));

/** Why staff should look at an open work order now, if anything. */
export function attention(wo: WorkOrder, now: Date): string[] {
  if (wo.status === "completed" && wo.tenant_result !== "still_broken") return [];
  const out: string[] = [];
  if (wo.tenant_result === "still_broken") out.push("Tenant says it's still a problem");
  if (wo.status === "received" && now > dueAt(wo.created_at, wo.tier)) out.push(`Past the ${TIERS[wo.tier].target.toLowerCase()} target`);
  const quiet = Math.floor((now.getTime() - new Date(wo.updated_at ?? wo.created_at).getTime()) / 86_400_000);
  if (quiet >= STALE_UPDATE_DAYS) out.push(`No update in ${quiet} days`);
  if (needsReview(wo)) out.push("Needs your review");
  return out;
}

/** The owner's approval limit for a home: its own, else OWNER_APPROVAL_LIMIT. */
export function approvalLimit(env: Pick<Env, "OWNER_APPROVAL_LIMIT">, property: Pick<Property, "approval_limit"> | null): number {
  return property?.approval_limit ?? (Number(env.OWNER_APPROVAL_LIMIT) || 500);
}

export const needsOwner = (wo: Pick<WorkOrder, "estimate" | "owner_approved_at">, limit: number) => !wo.owner_approved_at && (wo.estimate ?? 0) > limit;

const dayWithWeekday = (day: string) => parseDay(day).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const localDay = (env: Pick<Env, "TIMEZONE">, at = new Date()) => at.toLocaleDateString("en-CA", { timeZone: env.TIMEZONE || "America/New_York" });
const when = (env: Pick<Env, "TIMEZONE">, iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: env.TIMEZONE || "America/New_York" });
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 });

export async function loadWorkOrder(env: Env, id: string | number): Promise<WorkOrder | null> {
  return env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(Number(id) || 0).first<WorkOrder>();
}

/** Adds a line to the work order's history and counts as an update. */
export async function logEvent(env: Env, woId: number, kind: string, text: string, tenantVisible = false, at = new Date()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("INSERT INTO work_order_events (work_order_id, at, kind, text, tenant_visible) VALUES (?, ?, ?, ?, ?)").bind(woId, at.toISOString(), kind, text, tenantVisible ? 1 : 0),
    env.DB.prepare("UPDATE work_orders SET updated_at = ? WHERE id = ?").bind(at.toISOString(), woId),
  ]);
}

async function requestLink(env: Env, wo: Pick<WorkOrder, "id" | "tenant_id">): Promise<string> {
  return `${await homeLink(env.APP_URL, env.LINK_SECRET, wo.tenant_id)}/requests#wo-${wo.id}`;
}

/** Tells the tenant about their request: email (when `email`) and a push to the FIRM app. Never throws. */
async function notifyTenant(env: Env, wo: WorkOrder, subject: string, lines: string[], email: boolean): Promise<void> {
  const url = await requestLink(env, wo);
  const to = wo.contact_email || (await getTenant(env, wo.tenant_id))?.email;
  if (email && to) {
    const body = `<div style="font-family:system-ui,sans-serif;font-size:16px;line-height:1.5;color:#222;max-width:560px">
${lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}
<p><a href="${esc(url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;background:#1f5f8b;color:#fff">See your request</a></p>
<p style="font-size:13px;color:#666">Emergency? Call F.I.R.M. at ${esc(env.EMERGENCY_PHONE)}.</p></div>`;
    await sendEmail(env, to, subject, body).catch((err) => console.error(`Tenant email for work order ${wo.id}: ${err}`));
  }
  await pushToTenant(env, wo.tenant_id, { title: subject, body: lines[0] ?? "", url }).catch((err) => console.error(`Push for work order ${wo.id}: ${err}`));
}

/** The confirmation a tenant gets right after submitting, with the request number. */
export async function confirmToTenant(env: Env, wo: WorkOrder): Promise<void> {
  await notifyTenant(
    env,
    wo,
    `We got your request #${wo.id}: ${wo.title}`,
    [
      `Thanks. Your request #${wo.id} (${wo.title}) is in, and it's filed with F.I.R.M.`,
      "We'll contact you to set up a visit, on a weekday between 8am and 5pm. You can follow it on your Home Care page.",
      "You or an adult 18 or older you authorize must be home for the visit.",
    ],
    true,
  );
}

/**
 * The office alert, sent the moment an emergency or urgent request comes in (routine ones wait for the
 * end-of-day summary). Emergencies are also texted to OFFICE_CELL, at any hour.
 */
export async function alertOffice(env: Env, wo: WorkOrder, property: Property, tenant: Tenant, vendor: Vendor | null): Promise<void> {
  if (wo.tier !== "emergency" && wo.tier !== "urgent") return;
  const label = wo.tier === "emergency" ? "EMERGENCY" : "Urgent";
  const link = `${env.APP_URL}/admin/workorders/${wo.id}`;
  const flags = flagList(wo).map((f) => FLAGS[f]);
  await sendEmail(
    env,
    env.OFFICE_EMAIL,
    `${label} work order: ${property.address} - ${wo.title} [WO ${wo.id}]`,
    `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">
<p><strong>${label}</strong> (target: ${esc(TIERS[wo.tier].target.toLowerCase())}). ${esc(wo.summary ?? "")}</p>
<p>${esc(`${tenant.first_name} ${tenant.last_name}`)} · <a href="tel:${esc(wo.contact_phone)}">${esc(wo.contact_phone)}</a> · ${esc(wo.contact_email)}</p>
${flags.length ? `<p style="background:#fff6e0;padding:10px 12px;border-radius:6px">${flags.map(esc).join("<br>")}</p>` : ""}
<p>${vendor ? `Suggested: <strong>${esc(vendor.name)}</strong>. ` : ""}<a href="${esc(link)}">Open it to send it to a vendor</a>.</p>
<pre style="white-space:pre-wrap;font:inherit;background:#f5f6f7;padding:10px 12px;border-radius:6px">${esc(wo.description)}</pre></div>`,
  ).catch((err) => console.error(`Office alert for work order ${wo.id}: ${err}`));
  const cell = env.OFFICE_CELL ? toE164(env.OFFICE_CELL) : null;
  if (wo.tier === "emergency" && cell) {
    await sendText(env, cell, `EMERGENCY work order #${wo.id}: ${wo.title} at ${property.address}. ${tenant.first_name} ${tenant.last_name} ${wo.contact_phone}. ${link}`).catch((err) =>
      console.error(`Emergency text for work order ${wo.id}: ${err}`),
    );
  }
}

/** The vendor F.I.R.M. would most likely send: one whose trade fits the category, else in-house maintenance. */
export function suggestVendor(category: Category | null, vendors: Pick<Vendor, "id" | "name" | "trade" | "active" | "sort_order">[]): number | null {
  const trades: Partial<Record<Category, RegExp>> = { hvac: /hvac|heating/i, appliance: /appliance/i, pest: /wildlife|pest/i };
  const pattern = category ? trades[category] : undefined;
  const active = vendors.filter((v) => v.active);
  const match = pattern && active.find((v) => pattern.test(v.trade ?? ""));
  const inHouse = active.find((v) => /in-house/i.test(v.trade ?? "")) ?? [...active].sort((a, b) => (a.sort_order ?? 99) - (b.sort_order ?? 99))[0];
  return (match || inHouse)?.id ?? null;
}

/** After a work order is sent to a vendor: the tenant sees "Vendor contacted", and it waits on the vendor. */
export async function afterDispatch(env: Env, wo: WorkOrder, vendor: Vendor, now = new Date()): Promise<void> {
  await logEvent(env, wo.id, "sent", `Sent to ${vendor.name}.`, false, now);
  if (STATUSES[wo.status].rank < STATUSES.vendor_contacted.rank) await setStatus(env, wo, "vendor_contacted", { now });
  else await env.DB.prepare("UPDATE work_orders SET waiting_on = 'vendor' WHERE id = ? AND status = 'vendor_contacted'").bind(wo.id).run();
}

/**
 * Moves a work order to a new status, tells the tenant, notes it on the Rentec work order, and keeps the job in
 * the tracker in step. `fromRentec` is a change read from Rentec, which needs no note back.
 */
export async function setStatus(
  env: Env,
  wo: WorkOrder,
  status: Status,
  opts: { scheduledOn?: string | null; scheduledTime?: string | null; waitingOn?: WaitingOn | null; fromRentec?: boolean; now?: Date } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const scheduledOn = status === "scheduled" ? (opts.scheduledOn ?? wo.scheduled_on) : wo.scheduled_on;
  const scheduledTime = status === "scheduled" ? (opts.scheduledTime ?? wo.scheduled_time) : wo.scheduled_time;
  const waitingOn =
    opts.waitingOn !== undefined ? opts.waitingOn : status === "vendor_contacted" ? "vendor" : status === "received" ? wo.waiting_on : null;
  const reopened = status !== "completed" && wo.status === "completed";
  await env.DB.prepare(
    `UPDATE work_orders SET status = ?, scheduled_on = ?, scheduled_time = ?, waiting_on = ?, completed_at = ?,
       tenant_result = ?, tenant_result_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      status,
      scheduledOn,
      scheduledTime,
      waitingOn,
      status === "completed" ? (wo.completed_at ?? now.toISOString()) : null,
      reopened ? wo.tenant_result : status === "completed" ? null : wo.tenant_result,
      reopened ? wo.tenant_result_at : status === "completed" ? null : wo.tenant_result_at,
      now.toISOString(),
      wo.id,
    )
    .run();
  if (status === wo.status && !(status === "scheduled" && (scheduledOn !== wo.scheduled_on || scheduledTime !== wo.scheduled_time))) return;

  const updated = { ...wo, status, scheduled_on: scheduledOn, scheduled_time: scheduledTime };
  const visit = scheduledOn ? `${dayWithWeekday(scheduledOn)}${scheduledTime ? `, ${scheduledTime}` : ""}` : "";
  const by = opts.fromRentec ? " (from Rentec)" : "";
  switch (status) {
    case "vendor_contacted":
      await logEvent(env, wo.id, status, "We've sent your request to a repair technician. They or F.I.R.M. will contact you to set up a visit.", true, now);
      await notifyTenant(env, updated, `Request #${wo.id}: technician contacted`, ["We've sent your request to a repair technician. They or F.I.R.M. will contact you to set up a visit."], false);
      break;
    case "scheduled":
      await logEvent(env, wo.id, status, visit ? `Visit scheduled for ${visit}.` : "Visit scheduled.", true, now);
      await notifyTenant(
        env,
        updated,
        `Request #${wo.id}: visit scheduled${scheduledOn ? ` for ${dayWithWeekday(scheduledOn)}` : ""}`,
        [
          visit ? `Your visit for ${wo.title} is scheduled for ${visit}.` : `Your visit for ${wo.title} is scheduled.`,
          "You or an adult 18 or older you authorize must be home. If that time no longer works, please let F.I.R.M. know as soon as you can.",
        ],
        true,
      );
      break;
    case "in_progress":
      await logEvent(env, wo.id, status, `Work is under way${opts.waitingOn === "parts" ? "; waiting on parts" : ""}.${by}`, true, now);
      await notifyTenant(env, updated, `Request #${wo.id}: work under way`, ["Work on your request is under way."], false);
      break;
    case "completed":
      await logEvent(env, wo.id, status, `Marked complete.${by}`, true, now);
      await notifyTenant(
        env,
        updated,
        `Request #${wo.id}: is it fixed?`,
        [`The work on ${wo.title} is marked complete.`, "Please open your request and tap Fixed or Still a problem, so we know it's taken care of."],
        true,
      );
      await env.DB.prepare("UPDATE jobs SET completed_on = COALESCE(completed_on, ?) WHERE work_order_id = ?").bind(localDay(env, now), wo.id).run();
      break;
    case "received":
      await logEvent(env, wo.id, "reopened", "Reopened.", true, now);
      break;
  }
  if (wo.rentec_id && !opts.fromRentec && (status === "scheduled" || status === "completed")) {
    await RentecClient.fromEnv(env)
      .addWorkOrderNote(wo.rentec_id, status === "scheduled" ? `Home Care: visit scheduled for ${visit || "a date to be confirmed"}.` : "Home Care: marked complete. Please close the work order in Rentec.")
      .catch((err) => console.error(`Rentec note for work order ${wo.rentec_id}: ${err}`));
  }
}

/** The tenant's close-out: Fixed closes it; Still a problem reopens it and tells the office right away. */
export async function recordTenantResult(env: Env, wo: WorkOrder, result: "fixed" | "still_broken", now = new Date()): Promise<void> {
  await env.DB.prepare("UPDATE work_orders SET tenant_result = ?, tenant_result_at = ? WHERE id = ?").bind(result, now.toISOString(), wo.id).run();
  if (result === "fixed") {
    await logEvent(env, wo.id, "note", "You told us it's fixed. Thanks!", true, now);
    return;
  }
  await setStatus(env, { ...wo, tenant_result: result, tenant_result_at: now.toISOString() }, "received", { waitingOn: null, now });
  await logEvent(env, wo.id, "note", "You told us it's still a problem. F.I.R.M. has been told and will be in touch.", true, now);
  const property = await getProperty(env, wo.property_id);
  await sendEmail(
    env,
    env.OFFICE_EMAIL,
    `Still a problem: ${property?.address ?? ""} - ${wo.title} [WO ${wo.id}]`,
    `<p style="font-family:system-ui,sans-serif">The tenant says work order #${wo.id} (${esc(wo.title)}) is still a problem after it was marked complete. It's reopened.
<a href="${esc(env.APP_URL)}/admin/workorders/${wo.id}">Open it</a>.</p>`,
  ).catch((err) => console.error(`Still-a-problem email for ${wo.id}: ${err}`));
  if (wo.rentec_id) {
    await RentecClient.fromEnv(env)
      .addWorkOrderNote(wo.rentec_id, "Home Care: the tenant says this is still a problem after it was marked complete.")
      .catch((err) => console.error(`Rentec note for work order ${wo.rentec_id}: ${err}`));
  }
}

/**
 * Reads each open work order's status from Rentec and moves the tenant's status forward when Rentec's changed
 * (a vendor assigned, parts on order, work under way, finalized or closed). Never moves a status backward.
 */
export async function refreshFromRentec(env: Env, now = new Date(), client = RentecClient.fromEnv(env)): Promise<number> {
  const { results: open } = await env.DB.prepare("SELECT * FROM work_orders WHERE rentec_id IS NOT NULL AND rentec_id != '' AND status != 'completed'").all<WorkOrder>();
  if (!open.length) return 0;
  const rentec = new Map<string, RentecWorkOrder>((await client.workOrders(180)).map((w) => [w.id, w]));
  let changed = 0;
  for (const wo of open) {
    const r = rentec.get(wo.rentec_id!);
    if (!r || !r.status || r.status === wo.rentec_status) continue;
    await env.DB.prepare("UPDATE work_orders SET rentec_status = ? WHERE id = ?").bind(r.status, wo.id).run();
    const mapped = RENTEC_STATUS[r.status];
    if (mapped && STATUSES[mapped.status].rank > STATUSES[wo.status].rank) {
      await setStatus(env, wo, mapped.status, { waitingOn: mapped.waiting ?? null, fromRentec: true, now });
      changed++;
    } else if (mapped?.waiting && mapped.waiting !== wo.waiting_on && wo.status !== "completed") {
      await env.DB.prepare("UPDATE work_orders SET waiting_on = ? WHERE id = ?").bind(mapped.waiting, wo.id).run();
    }
  }
  return changed;
}

// ---- Tenant pages -------------------------------------------------------------------------------------------

interface WithEvents {
  wo: WorkOrder;
  events: { at: string; text: string }[];
}

export async function tenantRequests(env: Env, tenantId: string): Promise<WithEvents[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM work_orders WHERE tenant_id = ? AND (status != 'completed' OR completed_at >= ?) ORDER BY created_at DESC LIMIT 20",
  )
    .bind(tenantId, new Date(Date.now() - 90 * 86_400_000).toISOString())
    .all<WorkOrder>();
  const out: WithEvents[] = [];
  for (const wo of results) {
    const { results: events } = await env.DB.prepare("SELECT at, text FROM work_order_events WHERE work_order_id = ? AND tenant_visible = 1 ORDER BY at, id")
      .bind(wo.id)
      .all<{ at: string; text: string }>();
    out.push({ wo, events });
  }
  return out;
}

export function requestsPage(env: Env, base: string, list: WithEvents[], thanks = ""): Html {
  return layout(
    "My repair requests",
    html`<h1>My repair requests</h1>
${thanks ? html`<div class="card note"><p>${thanks}</p></div>` : ""}
${list.length ? "" : html`<p class="quiet">No requests in the last 90 days.</p>`}
${list.map(({ wo, events }) => {
  const rank = STATUSES[wo.status].rank;
  return html`<div class="card" id="wo-${wo.id}"><h2>${wo.title}</h2><p class="quiet">Request #${wo.id} · sent ${when(env, wo.created_at)}</p>
<ol class="steps">${STATUS_ORDER.map((s) => {
    const done = STATUSES[s].rank <= rank;
    const label = s === "scheduled" && wo.scheduled_on && done ? `Scheduled: ${dayWithWeekday(wo.scheduled_on)}${wo.scheduled_time ? `, ${wo.scheduled_time}` : ""}` : STATUSES[s].label;
    return html`<li class="${done ? "on" : ""}${s === wo.status ? " now" : ""}">${label}</li>`;
  })}</ol>
${events.length ? html`<details><summary>Updates</summary><ul>${events.map((e) => html`<li><span class="quiet">${when(env, e.at)}</span><br>${e.text}</li>`)}</ul></details>` : ""}
${wo.status === "completed" && !wo.tenant_result
  ? html`<p><strong>Is it fixed?</strong></p><form method="post" action="${base}/requests/${wo.id}/result">
<button class="btn primary" name="result" value="fixed">Fixed</button><button class="btn" name="result" value="still_broken">Still a problem</button></form>`
  : wo.tenant_result === "fixed"
    ? html`<p class="quiet">You told us it's fixed. Thanks!</p>`
    : ""}</div>`;
})}
<p class="quiet">Emergency? Call ${env.EMERGENCY_PHONE}.</p>
<a class="btn" href="${base}/help">Report something new</a><a class="btn" href="${base}/">Back to my home page</a>
<style>.steps{list-style:none;padding:0;margin:8px 0}.steps li{position:relative;padding-left:28px;color:var(--quiet);margin:4px 0}
.steps li::before{content:"";position:absolute;left:4px;top:5px;width:12px;height:12px;border-radius:50%;border:2px solid var(--line)}
.steps li.on{color:var(--ink)}.steps li.on::before{background:var(--brand);border-color:var(--brand)}.steps li.now{font-weight:600}</style>`,
  );
}

// ---- Staff pages --------------------------------------------------------------------------------------------

interface BoardRow extends WorkOrder {
  address: string;
  first_name: string | null;
  last_name: string | null;
  vendor: string | null;
}

const tierBadge = (tier: Tier) => html`<span class="tier t-${tier}">${TIERS[tier].label}</span>`;

export const BOARD_STYLE = html`<style>.tier{display:inline-block;font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid var(--line);white-space:nowrap}
.t-emergency{background:#b3261e;color:#fff;border-color:#b3261e}.t-urgent{background:#f6c344;color:#1d2329;border-color:#f6c344}.t-routine{color:var(--quiet)}.t-tenant{border-style:dashed}
.warn{color:var(--alert);font-size:13px;display:block}.scroll{overflow-x:auto}</style>`;

export const maintenanceRoutes = new Hono<{ Bindings: Env }>();

// Every open work order by urgency, then age, with what it's waiting on and anything that needs a look.
maintenanceRoutes.get("/admin/workorders", async (c) => {
  const now = new Date();
  const { results } = await c.env.DB.prepare(
    `SELECT w.*, p.address, t.first_name, t.last_name, v.name AS vendor
     FROM work_orders w JOIN properties p ON p.id = w.property_id LEFT JOIN tenants t ON t.id = w.tenant_id LEFT JOIN vendors v ON v.id = w.vendor_id
     WHERE w.status != 'completed' OR w.tenant_result = 'still_broken' OR w.completed_at >= ?
     ORDER BY w.created_at`,
  )
    .bind(new Date(now.getTime() - 14 * 86_400_000).toISOString())
    .all<BoardRow>();
  const isOpen = (w: BoardRow) => w.status !== "completed" || w.tenant_result === "still_broken";
  const open = results.filter(isOpen).sort((a, b) => TIERS[a.tier].rank - TIERS[b.tier].rank || a.created_at.localeCompare(b.created_at));
  const closed = results.filter((w) => !isOpen(w)).reverse();
  const flagged = open.filter((w) => attention(w, now).length).length;
  const row = (w: BoardRow) => {
    const age = daysBetween(w.created_at.slice(0, 10), now.toISOString().slice(0, 10));
    const notes = attention(w, now);
    return html`<tr><td>${tierBadge(w.tier)}</td>
<td><a href="/admin/workorders/${w.id}">${w.address.split(",")[0]}</a> · ${w.title}<br><span class="quiet">#${w.id} · ${w.first_name ?? ""} ${w.last_name ?? ""} · ${age === 0 ? "today" : `${age}d ago`}</span>
${notes.map((n) => html`<span class="warn">⚠ ${n}</span>`)}</td>
<td>${STATUSES[w.status].label}${w.status === "scheduled" && w.scheduled_on ? html`<br><span class="quiet">${w.scheduled_on.slice(5).replace("-", "/")}</span>` : ""}
${w.waiting_on ? html`<br><span class="quiet">Waiting on ${WAITING[w.waiting_on].toLowerCase()}</span>` : ""}${w.vendor ? html`<br><span class="quiet">${w.vendor}</span>` : ""}</td></tr>`;
  };
  return c.html(
    layout(
      "Work orders",
      html`<h1>Work orders</h1>
<p class="quiet">${open.length} open${flagged ? html`, <strong>${flagged} need a look</strong>` : ""}. Most urgent first, then oldest. ⚠ marks a job past its response target, with no update in ${STALE_UPDATE_DAYS}+ days, or waiting on your review.</p>
<div class="card scroll"><table><tr><th>Urgency</th><th>Request</th><th>Status</th></tr>${open.map(row)}</table>
${open.length ? "" : html`<p class="quiet">Nothing open.</p>`}</div>
${closed.length ? html`<details class="card"><summary>Completed in the last 14 days (${closed.length})</summary><div class="scroll"><table>${closed.map(row)}</table></div></details>` : ""}
<a class="btn primary" href="/admin/tracker">Vendor job tracker</a>
<a class="btn" href="/admin/vendors">Vendors</a>
<a class="quiet" href="/admin/">Back to admin</a>${BOARD_STYLE}`,
    ),
  );
});

/** The tracker cards on a work order's staff page: triage, status, owner approval and history. */
export async function trackerPanel(env: Env, wo: WorkOrder, property: Property | null): Promise<Html> {
  const now = new Date();
  const limit = approvalLimit(env, property);
  const { results: events } = await env.DB.prepare("SELECT at, kind, text, tenant_visible FROM work_order_events WHERE work_order_id = ? ORDER BY at DESC, id DESC")
    .bind(wo.id)
    .all<{ at: string; kind: string; text: string; tenant_visible: number }>();
  const notes = attention(wo, now);
  const due = dueAt(wo.created_at, wo.tier);
  const ownerSubject = `Approval needed: ${property?.address ?? ""} - ${wo.title}`;
  const ownerBody = [
    "Hi,",
    "",
    `A repair is needed at ${property?.address ?? "your property"}: ${wo.title}.`,
    ...(wo.summary ? [wo.summary] : []),
    "",
    `The expected cost is about ${money(wo.estimate ?? 0)}, which is over the ${money(limit)} we can approve without you under our management agreement.`,
    "Please reply to approve, or call me with any questions.",
    "",
    "Thank you,",
    "Steve",
    env.COMPANY_NAME,
  ].join("\n");
  const statusOptions = STATUS_ORDER.map((s) => html`<option value="${s}" ${s === wo.status ? "selected" : ""}>${STATUSES[s].label}</option>`);
  return html`<div class="card${notes.length ? " alert" : ""}"><h2>${tierBadge(wo.tier)} ${CATEGORIES[(wo.category ?? "other") as Category]}</h2>
<p>${wo.summary ?? ""}</p>
<p class="quiet">Response target: ${TIERS[wo.tier].target}${wo.status === "received" ? ` (by ${when(env, due.toISOString())})` : ""}.</p>
${flagList(wo).map((f) => html`<p class="card note">${FLAGS[f]}</p>`)}
${notes.map((n) => html`<span class="warn">⚠ ${n}</span>`)}
<form method="post" action="/admin/workorders/${wo.id}/triage"><div class="row2">
<div><label for="tier">Urgency</label><select id="tier" name="tier">${TIER_ORDER.map((t) => html`<option value="${t}" ${t === wo.tier ? "selected" : ""}>${TIERS[t].label} (${TIERS[t].target})</option>`)}</select></div>
<div><label for="category">Category</label><select id="category" name="category">${(Object.keys(CATEGORIES) as Category[]).map((k) => html`<option value="${k}" ${k === wo.category ? "selected" : ""}>${CATEGORIES[k]}</option>`)}</select></div></div>
${needsReview(wo) ? html`<label><input type="checkbox" name="reviewed" value="1"> I've reviewed this</label>` : ""}
<button class="btn">Save urgency</button></form></div>

<form method="post" action="/admin/workorders/${wo.id}/status" class="card"><h2>Status: ${STATUSES[wo.status].label}${wo.waiting_on ? html` · waiting on ${WAITING[wo.waiting_on].toLowerCase()}` : ""}</h2>
${wo.rentec_status ? html`<p class="quiet">Rentec status: ${wo.rentec_status}. Rentec's API can't change it, so close the work order in Rentec too.</p>` : ""}
${wo.tenant_result ? html`<p>Tenant says: <strong>${wo.tenant_result === "fixed" ? "Fixed" : "Still a problem"}</strong> (${when(env, wo.tenant_result_at!)})</p>` : ""}
<div class="row2"><div><label for="status">Status</label><select id="status" name="status">${statusOptions}</select></div>
<div><label for="waiting_on">Waiting on</label><select id="waiting_on" name="waiting_on"><option value="">Nothing</option>${(Object.keys(WAITING) as WaitingOn[]).map(
    (k) => html`<option value="${k}" ${k === wo.waiting_on ? "selected" : ""}>${WAITING[k]}</option>`,
  )}</select></div></div>
<div class="row2"><div><label for="scheduled_on">Visit date</label><input type="date" id="scheduled_on" name="scheduled_on" value="${wo.scheduled_on ?? ""}"></div>
<div><label for="scheduled_time">Time <small>e.g. 9am to noon</small></label><input type="text" id="scheduled_time" name="scheduled_time" value="${wo.scheduled_time ?? ""}"></div></div>
<label for="note">Note for the history <small>Staff only</small></label><input type="text" id="note" name="note">
<button class="btn primary">Save status</button>
<p class="quiet">The tenant sees the status and gets an email when a visit is scheduled or the work is complete. A visit date is only shown once you enter it here.</p></form>

<form method="post" action="/admin/workorders/${wo.id}/approval" class="card${needsOwner(wo, limit) ? " alert" : ""}"><h2>Owner approval</h2>
${needsOwner(wo, limit)
  ? html`<p><strong>${money(wo.estimate!)} is over this owner's ${money(limit)} limit.</strong> Get the owner's OK before the work starts.</p>
<a class="btn" href="mailto:?subject=${encodeURIComponent(ownerSubject)}&body=${encodeURIComponent(ownerBody)}">Draft the owner email</a>
<button class="btn primary" name="approved" value="1">The owner approved</button>`
  : wo.owner_approved_at
    ? html`<p>Owner approved ${when(env, wo.owner_approved_at)}.</p>`
    : html`<p class="quiet">Jobs over ${money(limit)} need the owner's OK first.</p>`}
<div class="row2"><div><label for="estimate">Expected cost</label><input type="number" id="estimate" name="estimate" step="0.01" min="0" inputmode="decimal" value="${wo.estimate ?? ""}"></div>
<div><label for="limit">This owner's limit</label><input type="number" id="limit" name="limit" step="1" min="0" inputmode="decimal" value="${property?.approval_limit ?? ""}" placeholder="${limit}"></div></div>
<button class="btn">Save</button></form>

${events.length
  ? html`<details class="card"><summary>History (${events.length})</summary><ul>${events.map(
      (e) => html`<li><span class="quiet">${when(env, e.at)}${e.tenant_visible ? " · tenant sees this" : ""}</span><br>${e.text}</li>`,
    )}</ul></details>`
  : ""}
<style>.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}input[type=date],input[type=number]{width:100%;padding:12px;border-radius:10px;border:1px solid var(--line);font:inherit;background:var(--card);color:var(--ink)}</style>
${BOARD_STYLE}`;
}

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const back = (id: number, msg: string) => `/admin/workorders/${id}?sent=${encodeURIComponent(msg)}`;

maintenanceRoutes.post("/admin/workorders/:id/triage", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("id"));
  if (!wo) return c.text("Work order not found", 404);
  const body = await c.req.parseBody();
  const tier = (TIER_ORDER as string[]).includes(String(body["tier"])) ? (String(body["tier"]) as Tier) : wo.tier;
  const category = String(body["category"]) in CATEGORIES ? (String(body["category"]) as Category) : wo.category;
  const reviewed = body["reviewed"] === "1" && !wo.reviewed_at;
  await c.env.DB.prepare("UPDATE work_orders SET tier = ?, category = ?, reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?")
    .bind(tier, category, reviewed ? new Date().toISOString() : null, wo.id)
    .run();
  const changes = [
    ...(tier !== wo.tier ? [`urgency ${TIERS[wo.tier].label} → ${TIERS[tier].label}`] : []),
    ...(category !== wo.category ? [`category → ${CATEGORIES[category ?? "other"]}`] : []),
    ...(reviewed ? ["reviewed"] : []),
  ];
  if (changes.length) await logEvent(c.env, wo.id, "triage", `Staff: ${changes.join(", ")}.`);
  return c.redirect(back(wo.id, changes.length ? "Saved." : "No change."), 303);
});

maintenanceRoutes.post("/admin/workorders/:id/status", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("id"));
  if (!wo) return c.text("Work order not found", 404);
  const body = await c.req.parseBody();
  const s = (k: string) => String(body[k] ?? "").trim();
  const status = (STATUS_ORDER as string[]).includes(s("status")) ? (s("status") as Status) : wo.status;
  const waitingOn = s("waiting_on") in WAITING ? (s("waiting_on") as WaitingOn) : null;
  const scheduledOn = isDay(s("scheduled_on")) ? s("scheduled_on") : null;
  if (status === "scheduled" && !scheduledOn) return c.redirect(back(wo.id, "Enter the visit date to mark it scheduled."), 303);
  await setStatus(c.env, wo, status, { scheduledOn, scheduledTime: s("scheduled_time").slice(0, 60) || null, waitingOn });
  if (s("note")) await logEvent(c.env, wo.id, "note", s("note").slice(0, 500));
  return c.redirect(back(wo.id, `Saved: ${STATUSES[status].label}${waitingOn ? `, waiting on ${WAITING[waitingOn].toLowerCase()}` : ""}.`), 303);
});

maintenanceRoutes.post("/admin/workorders/:id/approval", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("id"));
  if (!wo) return c.text("Work order not found", 404);
  const body = await c.req.parseBody();
  const num = (k: string) => {
    const v = String(body[k] ?? "").trim();
    return v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100;
  };
  const property = await getProperty(c.env, wo.property_id);
  const estimate = num("estimate");
  const ownLimit = num("limit");
  if (property && ownLimit !== (property.approval_limit ?? null)) {
    await c.env.DB.prepare("UPDATE properties SET approval_limit = ? WHERE id = ?").bind(ownLimit, property.id).run();
  }
  const approved = body["approved"] === "1" && !wo.owner_approved_at;
  const limit = approvalLimit(c.env, property ? { approval_limit: ownLimit } : null);
  const waiting = approved ? (wo.waiting_on === "owner" ? null : wo.waiting_on) : needsOwner({ estimate, owner_approved_at: wo.owner_approved_at }, limit) ? "owner" : wo.waiting_on === "owner" ? null : wo.waiting_on;
  await c.env.DB.prepare("UPDATE work_orders SET estimate = ?, owner_approved_at = COALESCE(owner_approved_at, ?), waiting_on = ? WHERE id = ?")
    .bind(estimate, approved ? new Date().toISOString() : null, waiting, wo.id)
    .run();
  if (approved) await logEvent(c.env, wo.id, "approved", `Owner approved${estimate ? ` (${money(estimate)})` : ""}.`);
  else if (estimate !== wo.estimate) await logEvent(c.env, wo.id, "note", `Expected cost: ${estimate == null ? "cleared" : money(estimate)}.`);
  return c.redirect(back(wo.id, approved ? "Owner approval saved." : "Saved."), 303);
});

/**
 * The end-of-day summary for the office: what came in, got scheduled or closed today, and what needs a look.
 * Null on a day with nothing to report.
 */
export async function endOfDayEmail(env: Env, now = new Date()): Promise<{ subject: string; html: string } | null> {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const rows = (
    await env.DB.prepare(
      `SELECT w.*, p.address FROM work_orders w JOIN properties p ON p.id = w.property_id
       WHERE w.status != 'completed' OR w.tenant_result = 'still_broken' OR w.updated_at >= ? ORDER BY w.created_at`,
    )
      .bind(since)
      .all<WorkOrder & { address: string }>()
  ).results;
  const { results: events } = await env.DB.prepare("SELECT work_order_id, kind FROM work_order_events WHERE at >= ?").bind(since).all<{ work_order_id: number; kind: string }>();
  const had = (kind: string) => new Set(events.filter((e) => e.kind === kind).map((e) => e.work_order_id));
  const [scheduledIds, completedIds] = [had("scheduled"), had("completed")];
  const created = rows.filter((w) => w.created_at >= since).sort((a, b) => TIERS[a.tier].rank - TIERS[b.tier].rank);
  const scheduled = rows.filter((w) => scheduledIds.has(w.id) && w.status === "scheduled");
  const closed = rows.filter((w) => completedIds.has(w.id) && w.status === "completed");
  const look = rows.map((w) => ({ w, why: attention(w, now) })).filter((x) => x.why.length);
  if (!created.length && !scheduled.length && !closed.length && !look.length) return null;
  const line = (w: WorkOrder & { address: string }, extra = "") =>
    `<li>${esc(TIERS[w.tier].label)}: ${esc(w.address.split(",")[0]!)} - ${esc(w.title)}${extra} <a href="${esc(env.APP_URL)}/admin/workorders/${w.id}">#${w.id}</a></li>`;
  const section = (title: string, items: string[]) => (items.length ? `<h3 style="margin:16px 0 4px">${title}</h3><ul style="margin:0;padding-left:18px">${items.join("")}</ul>` : "");
  const open = rows.filter((w) => w.status !== "completed").length;
  return {
    subject: `End of day: ${created.length} new, ${scheduled.length} scheduled, ${closed.length} closed${look.length ? `, ${look.length} need a look` : ""}`,
    html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1d2329">
${section("Needs a look", look.map(({ w, why }) => line(w, ` (${esc(why.join("; "))})`)))}
${section("New today", created.map((w) => line(w, w.vendor_id ? "" : " (not sent yet)")))}
${section("Scheduled", scheduled.map((w) => line(w, w.scheduled_on ? ` for ${esc(dayWithWeekday(w.scheduled_on))}${w.scheduled_time ? `, ${esc(w.scheduled_time)}` : ""}` : "")))}
${section("Closed", closed.map((w) => line(w, w.tenant_result === "fixed" ? " (tenant says fixed)" : "")))}
<p style="margin-top:16px">${open} open in all. <a href="${esc(env.APP_URL)}/admin/workorders">Open the work orders</a></p></div>`,
  };
}
