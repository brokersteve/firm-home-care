// Admin: send a tenant's work order on to F.I.R.M. maintenance or a vendor in one click. The vendor gets an
// email right away and a text (held overnight: texts only go out 8am to 9pm), and the office gets a
// confirmation email that an Outlook rule files by its subject.
import { Hono } from "hono";
import { html } from "hono/html";
import { sendEmail } from "./email";
import type { Env, Property, Tenant } from "./env";
import { layout } from "./pages";
import { sendText, textSendTime, toE164 } from "./sms";
import { getProperty, getTenant } from "./store";
import { RentecClient } from "./rentec";

export interface Vendor {
  id: number;
  name: string;
  trade: string | null;
  contact: string | null;
  email: string | null;
  /** Cell, for texts. */
  phone: string | null;
  /** A landline: shown so staff can call, never texted. */
  office_phone: string | null;
  active: number;
}

export interface WorkOrder {
  id: number;
  rentec_id: string | null;
  tenant_id: string;
  property_id: string;
  guide_id: string | null;
  title: string;
  description: string;
  contact_phone: string;
  contact_email: string;
  created_at: string;
  vendor_id: number | null;
  notes: string | null;
  sent_at: string | null;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const linkify = (s: string) => escape(s).replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`);

/** The text a vendor gets. Kept short; the email has everything. */
export function vendorText(wo: WorkOrder, property: Property, tenant: Tenant | null, notes: string, env: Pick<Env, "COMPANY_NAME">): string {
  const who = tenant ? `${tenant.first_name} ${tenant.last_name}` : "Tenant";
  const parts = [
    `F.I.R.M. work order #${wo.id}: ${wo.title} at ${property.address}.`,
    `${who}: ${wo.contact_phone}.`,
    ...(notes ? [`Notes: ${notes.length > 200 ? `${notes.slice(0, 197)}...` : notes}`] : []),
    "Tenant or an adult they authorize must be home; don't enter if no one is there unless it's an emergency.",
    "Full details and photos are in your email.",
  ];
  return parts.join(" ");
}

/** The email a vendor gets: F.I.R.M.'s notes first, then the tenant's request as filed in Rentec. */
export function vendorEmailHtml(wo: WorkOrder, property: Property, vendor: Vendor, notes: string, env: Pick<Env, "COMPANY_NAME" | "EMERGENCY_PHONE">): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:640px">
<p>Hi ${escape(vendor.name)},</p>
<p>${escape(env.COMPANY_NAME)} is sending you this work order. Please contact the tenant to schedule a visit on a weekday between 8am and 5pm.</p>
<table style="border-collapse:collapse;font-size:15px">
<tr><td style="padding:2px 12px 2px 0;color:#666">Work order</td><td>#${wo.id}${wo.rentec_id ? ` (Rentec ${escape(wo.rentec_id)})` : ""}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Property</td><td>${escape(property.address)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Problem</td><td>${escape(wo.title)}</td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Tenant phone</td><td><a href="tel:${escape(wo.contact_phone)}">${escape(wo.contact_phone)}</a></td></tr>
<tr><td style="padding:2px 12px 2px 0;color:#666">Tenant email</td><td>${escape(wo.contact_email)}</td></tr>
</table>
${notes ? `<p style="background:#fff6e0;padding:10px 12px;border-radius:6px"><strong>Notes from F.I.R.M.:</strong><br>${escape(notes).replace(/\n/g, "<br>")}</p>` : ""}
<p><strong>Entry:</strong> the tenant or an adult 18 or older they authorize must be home for the visit. Please don't enter if no one is there unless it's an emergency.</p>
<p><strong>The tenant's request</strong></p>
<pre style="white-space:pre-wrap;font:inherit;background:#f5f6f7;padding:10px 12px;border-radius:6px">${linkify(wo.description)}</pre>
<p style="font-size:13px;color:#666">Questions or an emergency on site? Call F.I.R.M. at ${escape(env.EMERGENCY_PHONE)}.</p>
</div>`;
}

/** Subject of the office copy. An Outlook rule can file these by "Work order sent to". */
export function confirmationSubject(wo: WorkOrder, property: Property, vendor: Vendor): string {
  return `Work order sent to ${vendor.name}: ${property.address} - ${wo.title} [WO ${wo.id}]`;
}

export interface DispatchResult {
  emailed: boolean;
  text: "sent" | "held" | "none" | "failed";
  textAt?: Date;
}

export async function dispatchWorkOrder(env: Env, wo: WorkOrder, vendor: Vendor, notes: string, now = new Date()): Promise<DispatchResult> {
  const property = await getProperty(env, wo.property_id);
  if (!property) throw new Error(`Property ${wo.property_id} not found`);
  const tenant = await getTenant(env, wo.tenant_id);
  const result: DispatchResult = { emailed: false, text: "none" };

  const subject = `F.I.R.M. work order #${wo.id}: ${wo.title} at ${property.address}`;
  const body = vendorEmailHtml(wo, property, vendor, notes, env);
  if (vendor.email) {
    await sendEmail(env, vendor.email, subject, body);
    result.emailed = true;
  }

  const to = vendor.phone ? toE164(vendor.phone) : null;
  if (to) {
    const textBody = vendorText(wo, property, tenant, notes, env);
    const at = textSendTime(now, env.TIMEZONE);
    if (at.getTime() > now.getTime()) {
      await env.DB.prepare("INSERT INTO texts_outbox (work_order_id, to_phone, body, send_after) VALUES (?, ?, ?, ?)")
        .bind(wo.id, to, textBody, at.toISOString())
        .run();
      result.text = "held";
      result.textAt = at;
    } else {
      try {
        await sendText(env, to, textBody);
        result.text = "sent";
      } catch (err) {
        console.error(String(err));
        result.text = "failed";
      }
    }
  }

  await env.DB.prepare("UPDATE work_orders SET vendor_id = ?, notes = ?, sent_at = ? WHERE id = ?")
    .bind(vendor.id, notes || null, now.toISOString(), wo.id)
    .run();

  // A private note on the Rentec work order, so the history there shows who it went to.
  if (wo.rentec_id) {
    await RentecClient.fromEnv(env)
      .addWorkOrderNote(wo.rentec_id, `Sent to ${vendor.name} from Home Care on ${now.toLocaleDateString("en-US", { timeZone: env.TIMEZONE })}.${notes ? ` Notes: ${notes}` : ""}`)
      .catch((err) => console.error(`Rentec note for work order ${wo.rentec_id}: ${err}`));
  }

  // The office copy: what the vendor got, and how the text went.
  const textLine = {
    sent: `Texted to ${vendor.phone}.`,
    held: `Text to ${vendor.phone} is held until ${result.textAt?.toLocaleString("en-US", { timeZone: env.TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" })} (no texts 9pm to 8am).`,
    none: `No text sent: no cell number on file for this vendor.${vendor.office_phone ? ` Office: ${vendor.office_phone}.` : ""}`,
    failed: `The text to ${vendor.phone} didn't go through. Please call them.`,
  }[result.text];
  const emailLine = result.emailed ? `Emailed to ${vendor.email}.` : "No email sent: no email on file for this vendor.";
  await sendEmail(
    env,
    env.OFFICE_EMAIL,
    confirmationSubject(wo, property, vendor),
    `<div style="font-family:system-ui,sans-serif;font-size:15px"><p>${escape(emailLine)}<br>${escape(textLine)}</p><hr></div>${body}`,
  );
  return result;
}

/** Sends texts whose 8am has come. Runs every 15 minutes. */
export async function sendHeldTexts(env: Env, now: Date): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, to_phone, body FROM texts_outbox WHERE sent_at IS NULL AND error IS NULL AND send_after <= ? ORDER BY id LIMIT 50")
    .bind(now.toISOString())
    .all<{ id: number; to_phone: string; body: string }>();
  let sent = 0;
  for (const t of results) {
    try {
      await sendText(env, t.to_phone, t.body);
      await env.DB.prepare("UPDATE texts_outbox SET sent_at = ? WHERE id = ?").bind(now.toISOString(), t.id).run();
      sent++;
    } catch (err) {
      await env.DB.prepare("UPDATE texts_outbox SET error = ? WHERE id = ?").bind(String(err).slice(0, 500), t.id).run();
    }
  }
  return sent;
}

async function vendors(env: Env, activeOnly: boolean): Promise<Vendor[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM vendors ${activeOnly ? "WHERE active = 1" : ""} ORDER BY name`).all<Vendor>();
  return results;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export const dispatchRoutes = new Hono<{ Bindings: Env }>();

dispatchRoutes.get("/admin/workorders", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT w.id, w.title, w.created_at, w.sent_at, p.address, t.first_name, t.last_name, v.name AS vendor
     FROM work_orders w JOIN properties p ON p.id = w.property_id LEFT JOIN tenants t ON t.id = w.tenant_id LEFT JOIN vendors v ON v.id = w.vendor_id
     ORDER BY w.sent_at IS NOT NULL, w.created_at DESC LIMIT 100`,
  ).all<{ id: number; title: string; created_at: string; sent_at: string | null; address: string; first_name: string | null; last_name: string | null; vendor: string | null }>();
  return c.html(
    layout(
      "Work orders",
      html`<h1>Work orders</h1>
<p class="quiet">New requests from tenants are at the top. Open one to send it to maintenance or a vendor.</p>
<div class="card"><table><tr><th>Property</th><th>Problem</th><th>Sent to</th></tr>
${results.map(
  (w) => html`<tr><td><a href="/admin/workorders/${w.id}">${w.address}</a><br><span class="quiet">${w.first_name ?? ""} ${w.last_name ?? ""} · ${when(w.created_at)}</span></td>
<td>${w.title}</td><td>${w.vendor ? html`${w.vendor}<br><span class="quiet">${when(w.sent_at!)}</span>` : html`<strong>Not sent yet</strong>`}</td></tr>`,
)}</table>${results.length ? "" : html`<p class="quiet">No work orders yet.</p>`}</div>
<a class="btn" href="/admin/vendors">Vendors</a>
<a class="quiet" href="/admin/">Back to admin</a>`,
    ),
  );
});

async function loadWorkOrder(env: Env, id: string): Promise<WorkOrder | null> {
  return env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(Number(id) || 0).first<WorkOrder>();
}

dispatchRoutes.get("/admin/workorders/:id", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("id"));
  if (!wo) return c.text("Work order not found", 404);
  const property = await getProperty(c.env, wo.property_id);
  const list = await vendors(c.env, true);
  const sentTo = wo.vendor_id ? (await vendors(c.env, false)).find((v) => v.id === wo.vendor_id) : null;
  const status = c.req.query("sent");
  return c.html(
    layout(
      `Work order #${wo.id}`,
      html`<h1>${wo.title}</h1><p class="quiet">#${wo.id} · ${property?.address ?? ""} · ${when(wo.created_at)}</p>
${status ? html`<div class="card note"><p>${status}</p></div>` : ""}
${sentTo ? html`<p>Last sent to <strong>${sentTo.name}</strong> on ${when(wo.sent_at!)}.</p>` : ""}
<form method="post" class="card">
<h2>${sentTo ? "Send again" : "Send to maintenance or a vendor"}</h2>
<label for="vendor">Send to</label>
<select id="vendor" name="vendor" required><option value="">Pick a vendor</option>${list.map(
        (v) => html`<option value="${v.id}" data-email="${v.email ? 1 : 0}" data-cell="${v.phone ? 1 : 0}" data-office="${v.office_phone ?? ""}" ${v.id === wo.vendor_id ? "selected" : ""}>${v.name}${v.trade ? ` (${v.trade})` : ""}${!v.email && !v.phone ? " - no email or cell on file" : ""}</option>`,
      )}<option value="new">+ A new vendor (type their details)</option></select>
<div id="new-vendor" hidden>
<label for="nv-name">Vendor name</label><input type="text" id="nv-name" name="new_name">
<label for="nv-contact">Contact person <small>Optional</small></label><input type="text" id="nv-contact" name="new_contact">
<label for="nv-email">Email</label><input type="email" id="nv-email" name="new_email">
<label for="nv-phone">Cell for texts</label><input type="tel" id="nv-phone" name="new_phone">
<label for="nv-trade">Trade <small>Optional, e.g. Plumbing</small></label><input type="text" id="nv-trade" name="new_trade">
<p class="quiet">They're added to your vendor list so they're in the dropdown next time. Give an email, a cell, or both.</p></div>
<label for="notes">Notes for the vendor <small>Gate code, parts, how urgent, who to bill</small></label>
<textarea id="notes" name="notes">${wo.notes ?? ""}</textarea>
<button class="btn primary">Send now</button>
<p class="quiet">They get an email right away and a text. Texts go out 8am to 9pm; at other times the text waits until 8am. You get a copy by email.</p></form>
<div class="card"><h2>The tenant's request</h2><p>Phone: <a href="tel:${wo.contact_phone}">${wo.contact_phone}</a><br>Email: ${wo.contact_email}</p>
<pre style="white-space:pre-wrap;font:inherit">${wo.description}</pre></div>
<a class="quiet" href="/admin/workorders">Back to work orders</a>`,
      NEW_VENDOR_SCRIPT,
    ),
  );
});

// Shows the new-vendor fields when "A new vendor" is picked, and makes the name required then.
const NEW_VENDOR_SCRIPT = `
(function(){
  var sel=document.getElementById('vendor'), box=document.getElementById('new-vendor'), name=document.getElementById('nv-name');
  function sync(){ var on=sel.value==='new'; box.hidden=!on; name.required=on; }
  sel.addEventListener('change',sync); sync();
})();`;

dispatchRoutes.post("/admin/workorders/:id", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("id"));
  if (!wo) return c.text("Work order not found", 404);
  const body = await c.req.parseBody();
  let vendor: Vendor | undefined;
  if (body["vendor"] === "new") {
    const v = vendorFields(body, "new_");
    if (!v.name || (!v.email && !(v.phone && toE164(v.phone)))) {
      return c.redirect(`/admin/workorders/${wo.id}?sent=${encodeURIComponent("For a new vendor, enter a name and an email or cell number.")}`, 303);
    }
    vendor = (await c.env.DB.prepare("INSERT INTO vendors (name, contact, trade, email, phone) VALUES (?, ?, ?, ?, ?) RETURNING *")
      .bind(v.name, v.contact, v.trade, v.email, v.phone)
      .first<Vendor>()) ?? undefined;
  } else {
    vendor = (await vendors(c.env, true)).find((v) => v.id === Number(body["vendor"]));
  }
  if (!vendor) return c.text("Pick a vendor", 400);
  if (!vendor.email && !(vendor.phone && toE164(vendor.phone))) {
    return c.redirect(`/admin/workorders/${wo.id}?sent=${encodeURIComponent(`${vendor.name} has no email or cell number on file. Add one under Vendors first.`)}`, 303);
  }
  const notes = String(body["notes"] ?? "").trim().slice(0, 2000);
  let message: string;
  try {
    const r = await dispatchWorkOrder(c.env, wo, vendor, notes);
    const textPart = {
      sent: "texted",
      held: `the text goes out at ${r.textAt?.toLocaleString("en-US", { timeZone: c.env.TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" })}`,
      none: `not texted (no cell on file${vendor.office_phone ? `; call ${vendor.office_phone}` : ""})`,
      failed: "the text failed, so please call them",
    }[r.text];
    message = `Sent to ${vendor.name}: ${r.emailed ? "emailed" : "not emailed (no email on file)"}, ${textPart}. A copy went to ${c.env.OFFICE_EMAIL}.`;
  } catch (err) {
    console.error(`Dispatch of work order ${wo.id} failed: ${err}`);
    message = `Something went wrong sending to ${vendor.name}. Please try again, or call them.`;
  }
  return c.redirect(`/admin/workorders/${wo.id}?sent=${encodeURIComponent(message)}`, 303);
});

dispatchRoutes.get("/admin/vendors", async (c) => {
  const list = await vendors(c.env, false);
  const field = (name: string, label: string, type: string, value = "") =>
    html`<label for="${name}">${label}</label><input type="${type}" id="${name}" name="${name}" value="${value}">`;
  return c.html(
    layout(
      "Vendors",
      html`<h1>Vendors</h1>
<p class="quiet">Who you can send work orders to. Texts need a cell number; the email gets the full request and photos.</p>
${list.map(
  (v) => html`<form method="post" action="/admin/vendors/${v.id}" class="card"${v.active ? "" : html` style="opacity:.6"`}>
${field("name", "Name", "text", v.name)}${field("contact", "Contact person", "text", v.contact ?? "")}${field("trade", "Trade", "text", v.trade ?? "")}${field("email", "Email", "email", v.email ?? "")}${field("phone", "Cell for texts", "tel", v.phone ?? "")}${field("office_phone", "Office phone (not texted)", "tel", v.office_phone ?? "")}
<label><input type="checkbox" name="active" value="1" ${v.active ? "checked" : ""}> Show in the Send to list</label>
<button class="btn">Save</button></form>`,
)}
<form method="post" action="/admin/vendors" class="card"><h2>Add a vendor</h2>
${field("name", "Name", "text")}${field("contact", "Contact person", "text")}${field("trade", "Trade", "text")}${field("email", "Email", "email")}${field("phone", "Cell for texts", "tel")}${field("office_phone", "Office phone (not texted)", "tel")}
<button class="btn primary">Add vendor</button></form>
<a class="quiet" href="/admin/workorders">Back to work orders</a>`,
    ),
  );
});

function vendorFields(body: Record<string, unknown>, prefix = "") {
  const s = (k: string) => String(body[prefix + k] ?? "").trim().slice(0, 200);
  return {
    name: s("name"),
    contact: s("contact") || null,
    trade: s("trade") || null,
    email: s("email") || null,
    phone: s("phone") || null,
    office_phone: s("office_phone") || null,
  };
}

dispatchRoutes.post("/admin/vendors", async (c) => {
  const v = vendorFields(await c.req.parseBody());
  if (!v.name) return c.redirect("/admin/vendors", 303);
  await c.env.DB.prepare("INSERT INTO vendors (name, contact, trade, email, phone, office_phone) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(v.name, v.contact, v.trade, v.email, v.phone, v.office_phone)
    .run();
  return c.redirect("/admin/vendors", 303);
});

dispatchRoutes.post("/admin/vendors/:id", async (c) => {
  const body = await c.req.parseBody();
  const v = vendorFields(body);
  if (!v.name) return c.redirect("/admin/vendors", 303);
  await c.env.DB.prepare("UPDATE vendors SET name = ?, contact = ?, trade = ?, email = ?, phone = ?, office_phone = ?, active = ? WHERE id = ?")
    .bind(v.name, v.contact, v.trade, v.email, v.phone, v.office_phone, body["active"] === "1" ? 1 : 0, Number(c.req.param("id")) || 0)
    .run();
  return c.redirect("/admin/vendors", 303);
});
