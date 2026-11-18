// Messages between the tenant and the technician on each work order (Steve, 2026-11-17). All inside Home Care:
// no texts and no logins, and neither side sees the other's phone number through the chat.
// - Tenant: /t/:id/:sig/wo/:wo, from their Home Care page or the phone app, with push notifications in the app
//   (or an email when they don't have the app).
// - Technician: /tech/:wo/:sig, a link in the vendor's dispatch email that works in any phone browser. "On my way",
//   suggest or set a visit time, and messages. The link stops working if the work order is sent to someone else.
// - Office: the same chat on the admin work order page, where staff can post too.
// Visit times are 2-hour windows on weekdays, 8am to 5pm, never on holidays (visits.ts). Every suggested or set
// time is added as a private note on the Rentec work order, and says an adult 18+ must be home.
import { Hono, type Context } from "hono";
import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";
import type { Vendor, WorkOrder } from "./dispatch";
import { sendEmail } from "./email";
import type { Env, Property, Tenant } from "./env";
import { homeLink, sign, verify } from "./links";
import { layout } from "./pages";
import { pushToTenant } from "./push";
import { RentecClient } from "./rentec";
import { getProperty, getTenant } from "./store";
import { DEMO_PROPERTY, DEMO_TENANT, isDemo } from "./demo";
import { checkVisit, openWindows, visitDays, visitLabel, VISIT_WINDOWS, windowLabel, dayLabel, localNow } from "./visits";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export type Side = "tenant" | "tech" | "office";
export type Kind = "text" | "on_my_way" | "propose" | "confirm";

export interface ChatMessage {
  id: number;
  work_order_id: number;
  sender: Side;
  sender_name: string;
  kind: Kind;
  body: string;
  visit_day: string | null;
  visit_start: string | null;
  created_at: string;
}

export interface ChatOrder extends WorkOrder {
  visit_day: string | null;
  visit_start: string | null;
  visit_status: "proposed" | "confirmed" | null;
  visit_by: Side | null;
  tenant_seen: number;
  tech_seen: number;
}

export const OFFICE_NAME = "F.I.R.M. office";
const MAX_MESSAGES = 300;
const MAX_LENGTH = 1000;
/** A second message within this many minutes, before the first was read, doesn't send another email or push. */
const QUIET_MINUTES = 10;
const ETAS = [15, 30, 45, 60];

/** The tenant and the office/technician are the two sides of a visit time: one suggests, the other confirms. */
const team = (s: Side | null) => (s === "tenant" ? "tenant" : "firm");
const tz = (env: Pick<Env, "TIMEZONE">) => env.TIMEZONE || "America/New_York";
const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const street = (p: Property | null) => (p ? p.address.split(",")[0]! : "the home");

// ---------- links ----------

/** The technician's page for one work order. Signed with the vendor it was sent to. */
export async function techLink(env: Pick<Env, "APP_URL" | "LINK_SECRET">, woId: number, vendorId: number): Promise<string> {
  return `${env.APP_URL}/tech/${woId}/${await sign(env.LINK_SECRET, "tech", String(woId), String(vendorId))}`;
}

export async function tenantChatLink(env: Pick<Env, "APP_URL" | "LINK_SECRET">, tenantId: string, woId: number): Promise<string> {
  return `${await homeLink(env.APP_URL, env.LINK_SECRET, tenantId)}/wo/${woId}`;
}

// ---------- data ----------

async function loadOrder(env: Env, id: number): Promise<ChatOrder | null> {
  return env.DB.prepare("SELECT * FROM work_orders WHERE id = ?").bind(id).first<ChatOrder>();
}

async function loadMessages(env: Env, woId: number): Promise<ChatMessage[]> {
  const { results } = await env.DB.prepare("SELECT * FROM wo_messages WHERE work_order_id = ? ORDER BY id").bind(woId).all<ChatMessage>();
  return results;
}

async function loadVendor(env: Env, id: number | null): Promise<Vendor | null> {
  return id ? env.DB.prepare("SELECT * FROM vendors WHERE id = ?").bind(id).first<Vendor>() : null;
}

async function completedOn(env: Env, woId: number): Promise<string | null> {
  const row = await env.DB.prepare("SELECT completed_on FROM jobs WHERE work_order_id = ?").bind(woId).first<{ completed_on: string | null }>();
  return row?.completed_on ?? null;
}

async function lastId(env: Env, woId: number): Promise<number> {
  const row = await env.DB.prepare("SELECT MAX(id) AS id FROM wo_messages WHERE work_order_id = ?").bind(woId).first<{ id: number | null }>();
  return row?.id ?? 0;
}

// ---------- posting ----------

export interface Post {
  side: Side;
  name: string;
  kind: Kind;
  body: string;
  visit?: { day: string; start: string };
}

/** Saves a message, moves the visit time along, then tells the other side and notes schedule changes in Rentec. */
export async function addMessage(env: Env, wo: ChatOrder, post: Post, now = new Date()): Promise<void> {
  const row = await env.DB.prepare(
    `INSERT INTO wo_messages (work_order_id, sender, sender_name, kind, body, visit_day, visit_start, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(wo.id, post.side, post.name, post.kind, post.body, post.visit?.day ?? null, post.visit?.start ?? null, now.toISOString())
    .first<{ id: number }>();
  const id = row?.id ?? 0;
  if (post.visit && (post.kind === "propose" || post.kind === "confirm")) {
    await env.DB.prepare("UPDATE work_orders SET visit_day = ?, visit_start = ?, visit_status = ?, visit_by = ? WHERE id = ?")
      .bind(post.visit.day, post.visit.start, post.kind === "confirm" ? "confirmed" : "proposed", post.side, wo.id)
      .run();
  }
  // Whoever writes has seen everything before it.
  if (post.side === "tenant") await env.DB.prepare("UPDATE work_orders SET tenant_seen = ? WHERE id = ?").bind(id, wo.id).run();
  if (post.side === "tech") await env.DB.prepare("UPDATE work_orders SET tech_seen = ? WHERE id = ?").bind(id, wo.id).run();

  const property = await getProperty(env, wo.property_id);
  const tasks: Promise<unknown>[] = [];
  if (post.side !== "tenant") tasks.push(notifyTenant(env, wo, post, id, property, now));
  if (post.side !== "tech") tasks.push(notifyTechOrOffice(env, wo, post, id, property, now));
  if (post.visit && wo.rentec_id) {
    const who = post.side === "tenant" ? "the tenant" : post.name;
    const note =
      post.kind === "confirm"
        ? `Home Care: visit set for ${visitLabel(post.visit.day, post.visit.start)} (${post.body.startsWith("Confirmed") ? `confirmed by ${who}` : `set by ${who}, agreed with the tenant`}). An adult 18+ must be home.`
        : `Home Care: ${who} suggested a visit for ${visitLabel(post.visit.day, post.visit.start)}. Waiting for the other side to confirm. An adult 18+ must be home.`;
    tasks.push(RentecClient.fromEnv(env).addWorkOrderNote(wo.rentec_id, note));
  }
  for (const r of await Promise.allSettled(tasks)) if (r.status === "rejected") console.error(`Work order ${wo.id} message: ${r.reason}`);
}

/**
 * Whether to send an email or push for this message. Always for "On my way" and visit times. For a chat message,
 * not when the same side wrote a few minutes ago and the reader hasn't opened it yet: one notice is enough.
 */
async function worthNotifying(env: Env, wo: ChatOrder, post: Post, id: number, seen: number, now: Date): Promise<boolean> {
  if (post.kind !== "text") return true;
  const prev = await env.DB.prepare("SELECT id, created_at FROM wo_messages WHERE work_order_id = ? AND sender = ? AND kind = 'text' AND id < ? ORDER BY id DESC LIMIT 1")
    .bind(wo.id, post.side, id)
    .first<{ id: number; created_at: string }>();
  if (!prev || prev.id <= seen) return true;
  return now.getTime() - Date.parse(prev.created_at) > QUIET_MINUTES * 60_000;
}

/** What the tenant's phone shows. */
export function tenantNotice(post: Post, where: string): { title: string; body: string } {
  const adult = "An adult 18 or older needs to be home for the visit.";
  switch (post.kind) {
    case "on_my_way":
      return { title: `${post.name} is on the way`, body: `${post.body} ${adult}` };
    case "propose":
      return { title: "New visit time suggested", body: `${visitLabel(post.visit!.day, post.visit!.start)} at ${where}. Tap to confirm it or suggest another time. ${adult}` };
    case "confirm":
      return { title: "Visit time set", body: `${visitLabel(post.visit!.day, post.visit!.start)} at ${where}. ${adult}` };
    default:
      return { title: `Message from ${post.name}`, body: short(post.body) };
  }
}

function noticeEmail(env: Env, lines: string[], url: string, button: string, footer: string): string {
  return `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:600px">
${lines.map((l) => `<p>${escape(l).replace(/\n/g, "<br>")}</p>`).join("\n")}
<p><a href="${escape(url)}" style="display:inline-block;background:#1f5f8b;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escape(button)}</a></p>
<p style="font-size:13px;color:#666">${escape(footer)} Emergency? Call ${escape(env.EMERGENCY_PHONE)}.</p></div>`;
}

async function notifyTenant(env: Env, wo: ChatOrder, post: Post, id: number, property: Property | null, now: Date): Promise<void> {
  if (!(await worthNotifying(env, wo, post, id, wo.tenant_seen, now))) return;
  const url = await tenantChatLink(env, wo.tenant_id, wo.id);
  const notice = tenantNotice(post, street(property));
  const pushed = await pushToTenant(env, wo.tenant_id, { ...notice, url });
  if (pushed) return;
  // No phone app: the same notice by email, to the address they gave on the work order.
  const tenant = await getTenant(env, wo.tenant_id);
  const to = wo.contact_email || tenant?.email;
  if (!to) return;
  const lines = [`Hi ${tenant?.first_name ?? "there"},`, `About your work order "${wo.title}" at ${street(property)}:`, `${post.name}: ${notice.body}`];
  await sendEmail(env, to, notice.title, noticeEmail(env, lines, url, "Open my work order", "Reply on your work order page. Replies to this email don't reach the technician."));
}

async function notifyTechOrOffice(env: Env, wo: ChatOrder, post: Post, id: number, property: Property | null, now: Date): Promise<void> {
  const vendor = await loadVendor(env, wo.vendor_id);
  const what = {
    text: `${post.name} sent a message`,
    on_my_way: `${post.name} is on the way`,
    propose: `${post.side === "tenant" ? "The tenant" : post.name} suggested a visit time`,
    confirm: `Visit time set: ${post.visit ? visitLabel(post.visit.day, post.visit.start) : ""}`,
  }[post.kind];
  const subject = `Work order #${wo.id} at ${street(property)}: ${what}`;
  const lines = [`${post.name}: ${post.body}`];
  if (vendor?.email) {
    if (!(await worthNotifying(env, wo, post, id, wo.tech_seen, now))) return;
    const url = await techLink(env, wo.id, vendor.id);
    if (post.visit) lines.push("The tenant or an adult 18 or older they authorize must be home for the visit.");
    await sendEmail(env, vendor.email, subject, noticeEmail(env, lines, url, "Open the work order", "Answer on the work order page: the tenant sees it right away. Replies to this email don't reach the tenant."));
  } else if (post.side === "tenant") {
    // Not sent to a vendor yet (or the vendor has no email): the office hears from the tenant instead.
    lines.push(vendor ? `${vendor.name} has no email on file, so they didn't get this.` : "This work order hasn't been sent to a vendor yet.");
    await sendEmail(env, env.OFFICE_EMAIL, subject, noticeEmail(env, lines, `${env.APP_URL}/admin/workorders/${wo.id}`, "Open it in Home Care admin", "Answer from the admin work order page."));
  }
}

/** Reads a posted form into a message. Returns the message, or what's wrong in words for the person. */
export function readPost(form: Record<string, unknown>, wo: ChatOrder, side: Side, name: string, now: Date, timeZone: string): Post | string {
  const s = (k: string, n: number) => String(form[k] ?? "").trim().slice(0, n);
  switch (s("action", 20)) {
    case "text": {
      const body = s("body", MAX_LENGTH);
      return body ? { side, name, kind: "text", body } : "Please type a message first.";
    }
    case "on_my_way": {
      if (side === "tenant") return "Only the technician can send this.";
      const eta = Number(form["eta"]);
      if (!ETAS.includes(eta)) return "Please pick about how long until you get there.";
      return { side, name, kind: "on_my_way", body: `On my way. I should be there in about ${eta === 60 ? "an hour" : `${eta} minutes`}.` };
    }
    case "propose": {
      const day = s("day", 10);
      const start = s("start", 5);
      const error = checkVisit(day, start, now, timeZone);
      if (error) return error;
      const note = s("note", 300);
      const agreed = side !== "tenant" && form["agreed"] === "1";
      const label = visitLabel(day, start);
      return {
        side,
        name,
        kind: agreed ? "confirm" : "propose",
        body: `${agreed ? `Visit set for ${label}, as agreed with the tenant.` : `Suggested a visit: ${label}.`}${note ? ` ${note}` : ""}`,
        visit: { day, start },
      };
    }
    case "confirm": {
      if (wo.visit_status !== "proposed" || !wo.visit_day || !wo.visit_start || team(wo.visit_by) === team(side)) return "There's no suggested time to confirm.";
      if (wo.visit_day < localNow(now, timeZone).day) return "That time has passed. Please suggest another time.";
      return { side, name, kind: "confirm", body: `Confirmed: ${visitLabel(wo.visit_day, wo.visit_start)}.`, visit: { day: wo.visit_day, start: wo.visit_start } };
    }
    default:
      return "Something went wrong. Please try again.";
  }
}

async function post(env: Env, wo: ChatOrder, form: Record<string, unknown>, side: Side, name: string): Promise<string | null> {
  const now = new Date();
  const p = readPost(form, wo, side, name, now, tz(env));
  if (typeof p === "string") return p;
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM wo_messages WHERE work_order_id = ?").bind(wo.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_MESSAGES) return `This chat is full. Please call F.I.R.M. at ${env.EMERGENCY_PHONE}.`;
  await addMessage(env, wo, p, now);
  return null;
}

// ---------- pages ----------

const CHAT_STYLE = `
.chat{display:flex;flex-direction:column;gap:8px}
.msg{max-width:85%;padding:8px 12px;border-radius:12px;background:var(--bg);border:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}
.msg.mine{align-self:flex-end;background:var(--tint);border-color:var(--tint)}
.msg .who{display:block;font-size:13px;color:var(--quiet);white-space:normal}
.visit{font-size:18px;font-weight:600}
details summary{cursor:pointer;color:var(--brand);font-weight:600;padding:8px 0}
.badge{display:inline-block;background:var(--brand);color:var(--card);border-radius:999px;padding:0 8px;font-size:13px;font-weight:600}
a.wo{display:block;padding:10px 0;border-top:1px solid var(--line);color:var(--ink);text-decoration:none}
`;

// Reloads the page when a new message arrives, unless something is being typed.
const POLL_SCRIPT = `
(function(){
  var box=document.getElementById('messages'); if(!box||!box.dataset.poll) return;
  var last=+box.dataset.last||0, url=box.dataset.poll;
  setInterval(function(){
    if(document.hidden) return;
    var busy=[].some.call(document.querySelectorAll('textarea,input[name=note]'),function(t){return t.value.trim();});
    if(busy||document.activeElement&&document.activeElement.tagName==='SELECT') return;
    fetch(url,{cache:'no-store'}).then(function(r){return r.json();}).then(function(d){if(d.last>last)location.reload();}).catch(function(){});
  },20000);
})();`;

// The technician's first name, typed once and remembered on their phone, goes with everything they send.
const TECH_NAME_SCRIPT = `
(function(){
  var box=document.getElementById('tech-name'); if(!box) return;
  try{box.value=localStorage.getItem('fhc_tech_name')||'';}catch(_){}
  box.addEventListener('change',function(){try{localStorage.setItem('fhc_tech_name',box.value.trim());}catch(_){}});
  [].forEach.call(document.querySelectorAll('form[method=post]'),function(f){
    f.addEventListener('submit',function(){var i=document.createElement('input');i.type='hidden';i.name='tech_name';i.value=box.value.trim();f.appendChild(i);});
  });
})();`;

const stamp = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function chatList(messages: ChatMessage[], viewer: Side, timeZone: string, pollUrl: string, empty: string): Html {
  const last = messages.at(-1)?.id ?? 0;
  return html`<div class="card" id="messages" data-last="${last}" data-poll="${pollUrl}"><h2>Messages</h2>
${messages.length
  ? html`<div class="chat">${messages.map(
      (m) => html`<div class="msg${m.sender === viewer ? " mine" : ""}"><span class="who">${m.sender === viewer ? "You" : m.sender_name} · ${stamp(m.created_at, timeZone)}</span>${m.kind === "text" ? m.body : html`<strong>${m.body}</strong>`}</div>`,
    )}</div>`
  : html`<p class="quiet">${empty}</p>`}</div>`;
}

function timeFields(now: Date, timeZone: string, side: Side): Html {
  const days = visitDays(now, timeZone);
  return html`<label for="v-day">Day <small>Weekdays only, no holidays</small></label>
<select id="v-day" name="day" required>${days.map((d) => html`<option value="${d}">${dayLabel(d)}</option>`)}</select>
<label for="v-start">Arrival window <small>8am to 5pm</small></label>
<select id="v-start" name="start" required>${VISIT_WINDOWS.map((w) => html`<option value="${w}">${windowLabel(w)}</option>`)}</select>
${side === "tenant" ? "" : html`<label><input type="checkbox" name="agreed" value="1"> Already agreed with the tenant (by phone or in person)</label>`}
<label for="v-note">Note <small>Optional</small></label><input type="text" id="v-note" name="note" maxlength="300">`;
}

function visitCard(wo: ChatOrder, messages: ChatMessage[], viewer: Side, action: string, now: Date, timeZone: string, completed: string | null): Html {
  const adult =
    viewer === "tenant"
      ? "You or an adult 18 or older you authorize must be home for the visit. We don't enter without someone there unless it's an emergency."
      : "The tenant or an adult 18 or older they authorize must be home. Don't enter if no one is there unless it's an emergency.";
  if (completed) return html`<div class="card note"><h2>Visit</h2><p>This work order was marked done on ${dayLabel(completed)}.</p></div>`;
  const by = [...messages].reverse().find((m) => m.kind === "propose" || m.kind === "confirm");
  const label = wo.visit_day && wo.visit_start ? visitLabel(wo.visit_day, wo.visit_start) : "";
  const past = wo.visit_day ? wo.visit_day < localNow(now, timeZone).day : false;
  const mineToConfirm = wo.visit_status === "proposed" && team(wo.visit_by) !== team(viewer) && !past;
  const status = !wo.visit_status
    ? html`<p>No visit time yet.</p><p class="quiet">${viewer === "tenant" ? "The technician will suggest a time here or call you. You can also suggest one below." : "Suggest a time below, or set one you've already agreed with the tenant."}</p>`
    : wo.visit_status === "confirmed"
      ? html`<p class="quiet">${past ? "Last visit" : "Visit set for"}</p><p class="visit">${label}</p>`
      : mineToConfirm
        ? html`<p class="quiet">${by && by.sender !== viewer ? by.sender_name : "The other side"} suggested</p><p class="visit">${label}</p>
<form method="post" action="${action}"><input type="hidden" name="action" value="confirm"><button class="btn primary">${viewer === "tenant" ? "Works for me" : "Confirm this time"}</button></form>`
        : html`<p class="quiet">${team(wo.visit_by) === team(viewer) ? (viewer === "tenant" ? "You suggested" : "Suggested") : "Suggested"}</p><p class="visit">${label}</p>
<p class="quiet">${past ? "That time has passed." : `Waiting for ${viewer === "tenant" ? "the technician" : "the tenant"} to confirm.`}</p>`;
  return html`<div class="card" id="visit"><h2>Visit time</h2>${status}
<details${wo.visit_status ? "" : " open"}><summary>${wo.visit_status ? "Suggest a different time" : "Suggest a time"}</summary>
<form method="post" action="${action}"><input type="hidden" name="action" value="propose">${timeFields(now, timeZone, viewer)}
<button class="btn">Send this time</button></form></details>
<p class="quiet">${adult}</p></div>`;
}

function replyForm(action: string, viewer: Side): Html {
  return html`<form method="post" action="${action}" class="card" id="reply"><input type="hidden" name="action" value="text">
<label for="body">${viewer === "tenant" ? "Message the technician" : viewer === "tech" ? "Message the tenant" : "Message the tenant and technician"}</label>
<textarea id="body" name="body" required maxlength="${MAX_LENGTH}"></textarea>
<button class="btn primary">Send</button></form>`;
}

const errorCard = (error?: string) => (error ? html`<div class="card alert"><p>${error}</p></div>` : "");

export interface ChatView {
  wo: ChatOrder;
  messages: ChatMessage[];
  vendor: Pick<Vendor, "id" | "name"> | null;
  completed: string | null;
  now: Date;
  timeZone: string;
  error?: string;
  demo?: boolean;
}

export function tenantChatPage(env: Env, base: string, v: ChatView): Html {
  const action = `${base}/wo/${v.demo ? "demo" : v.wo.id}`;
  return layout(
    v.wo.title,
    html`<style>${raw(CHAT_STYLE)}</style><h1>${v.wo.title}</h1>
<p class="quiet">Work order #${v.wo.id} · sent ${stamp(v.wo.created_at, v.timeZone)}${v.vendor ? html` · technician: ${v.vendor.name}` : ""}</p>
${v.demo
  ? html`<div class="card note"><h2>Demo work order</h2><p>A sample conversation, so you can see how it works. Nothing you send here goes anywhere.</p>
<a class="btn" href="/tech/demo">See what the technician sees</a></div>`
  : ""}
${errorCard(v.error)}
${v.vendor ? "" : html`<div class="card note"><p>F.I.R.M. is choosing a technician. You can still send a message: the office will see it.</p></div>`}
${visitCard(v.wo, v.messages, "tenant", action, v.now, v.timeZone, v.completed)}
${chatList(v.messages, "tenant", v.timeZone, v.demo ? "" : `${action}/latest`, "No messages yet. The technician will write here, and you'll get a notice on your phone.")}
${replyForm(action, "tenant")}
<p class="quiet">Emergency? Call <a href="tel:${env.EMERGENCY_PHONE}">${env.EMERGENCY_PHONE}</a>.</p>
<a class="btn" href="${base}/">Back to my home page</a>`,
    POLL_SCRIPT,
  );
}

export function techChatPage(env: Env, action: string, v: ChatView, property: Property, tenant: Tenant | null): Html {
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(property.address)}`;
  return layout(
    `Work order #${v.wo.id}`,
    html`<style>${raw(CHAT_STYLE)}</style><h1>${v.wo.title}</h1>
<p class="quiet">F.I.R.M. work order #${v.wo.id}${v.vendor ? html` · ${v.vendor.name}` : ""}</p>
${v.demo ? html`<div class="card note"><h2>Demo: the technician's page</h2><p>This is what a technician sees from the link in their work order email. It works in any phone browser, with no app or password. Nothing you send here goes anywhere.</p></div>` : ""}
${errorCard(v.error)}
<div class="card"><dl><dt>Address</dt><dd><a href="${maps}">${property.address}</a></dd>
<dt>Tenant</dt><dd>${tenant && !isDemo(tenant.id) ? tenant.first_name : v.demo ? "Demo tenant" : "Tenant"} · <a href="tel:${v.wo.contact_phone}">${v.wo.contact_phone}</a></dd></dl></div>
${v.completed
  ? ""
  : html`<form method="post" action="${action}" class="card"><input type="hidden" name="action" value="on_my_way"><h2>Heading over?</h2>
<label for="tech-name">Your first name <small>Optional, shown to the tenant</small></label><input type="text" id="tech-name" maxlength="40" autocomplete="given-name">
<label for="eta">Arriving in about</label><select id="eta" name="eta">${ETAS.map((m) => html`<option value="${m}"${m === 30 ? " selected" : ""}>${m === 60 ? "1 hour" : `${m} minutes`}</option>`)}</select>
<button class="btn primary">On my way</button><p class="quiet">The tenant gets a notice on their phone right away.</p></form>`}
${visitCard(v.wo, v.messages, "tech", action, v.now, v.timeZone, v.completed)}
${chatList(v.messages, "tech", v.timeZone, v.demo ? "" : `${action}/latest`, "No messages yet.")}
${replyForm(action, "tech")}
<details class="card"><summary>The tenant's request</summary><pre style="white-space:pre-wrap;font:inherit">${v.wo.description}</pre></details>
<p class="quiet">Questions or an emergency on site? Call F.I.R.M. at <a href="tel:${env.EMERGENCY_PHONE}">${env.EMERGENCY_PHONE}</a>.</p>`,
    POLL_SCRIPT + TECH_NAME_SCRIPT,
  );
}

/** The chat on the admin work order page, where the office can answer too. */
export async function adminChatCard(env: Env, wo: ChatOrder): Promise<Html> {
  const now = new Date();
  const messages = await loadMessages(env, wo.id);
  const completed = await completedOn(env, wo.id);
  const link = wo.vendor_id ? await techLink(env, wo.id, wo.vendor_id) : null;
  const action = `/admin/workorders/${wo.id}/messages`;
  return html`<style>${raw(CHAT_STYLE)}</style><h2 style="margin-top:20px">Tenant and technician</h2>
${link
  ? html`<div class="card"><p class="quiet">The technician's page (it's in their email). To send it to your own tech, copy it into a text:</p><input type="text" readonly value="${link}" onclick="this.select()"></div>`
  : html`<p class="quiet">Once you send this to a vendor, they get a link to message the tenant, send "On my way" and set the visit time.</p>`}
${visitCard(wo, messages, "office", action, now, tz(env), completed)}
${chatList(messages, "office", tz(env), "", "No messages yet.")}
${replyForm(action, "office")}`;
}

// ---------- the tenant's work orders, on their home page ----------

export interface OrderSummary {
  id: number | "demo";
  title: string;
  created_at: string;
  visit_day: string | null;
  visit_start: string | null;
  visit_status: string | null;
  unread: boolean;
  completed_on: string | null;
}

export async function tenantOrders(env: Env, tenantId: string, now = new Date()): Promise<OrderSummary[]> {
  const since = new Date(now.getTime() - 180 * 86_400_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.title, w.created_at, w.visit_day, w.visit_start, w.visit_status, j.completed_on,
       EXISTS (SELECT 1 FROM wo_messages m WHERE m.work_order_id = w.id AND m.sender != 'tenant' AND m.id > w.tenant_seen) AS unread
     FROM work_orders w LEFT JOIN jobs j ON j.work_order_id = w.id
     WHERE w.tenant_id = ? AND w.created_at >= ? AND (j.completed_on IS NULL OR j.completed_on >= ?)
     ORDER BY w.id DESC LIMIT 10`,
  )
    .bind(tenantId, since, since.slice(0, 10))
    .all<Omit<OrderSummary, "unread"> & { unread: number }>()
    .catch(() => ({ results: [] as (Omit<OrderSummary, "unread"> & { unread: number })[] }));
  return results.map((r) => ({ ...r, unread: Boolean(r.unread) }));
}

export function ordersCard(base: string, orders: OrderSummary[], timeZone: string): Html | string {
  if (!orders.length) return "";
  const status = (o: OrderSummary) =>
    o.completed_on
      ? "Done"
      : o.visit_day && o.visit_start
        ? `${o.visit_status === "confirmed" ? "Visit" : "Visit time suggested"}: ${visitLabel(o.visit_day, o.visit_start)}`
        : `Sent ${stamp(o.created_at, timeZone)}`;
  return html`<style>${raw(CHAT_STYLE)}</style><div class="card" id="work-orders"><h2>Your work orders</h2>
<p class="quiet">Tap one to see the visit time and message the technician.</p>
${orders.map((o) => html`<a class="wo" href="${base}/wo/${o.id}"><strong>${o.title}</strong>${o.unread ? html` <span class="badge">New message</span>` : ""}<br><span class="quiet">${status(o)}</span></a>`)}</div>`;
}

// ---------- the demo ----------

/** A sample work order and conversation for the demo home. Made up each time; nothing is stored. */
export function demoChat(now: Date, timeZone: string): ChatView & { summary: OrderSummary } {
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000).toISOString();
  const days = visitDays(now, timeZone);
  const day = days[1] ?? days[0]!;
  const start = openWindows(day, now, timeZone).includes("10:00") ? "10:00" : VISIT_WINDOWS[0]!;
  const tech = "Sam (F.I.R.M. Maintenance)";
  const wo: ChatOrder = {
    id: 1001,
    rentec_id: null,
    tenant_id: DEMO_TENANT.id,
    property_id: DEMO_PROPERTY.id,
    guide_id: "disposal",
    title: "Garbage disposal not working",
    description: "Sample request. What's happening: the disposal hums but won't spin, even after pressing the reset button.\nWhere: kitchen sink\nPets in the home: no",
    contact_phone: DEMO_TENANT.phone!,
    contact_email: DEMO_TENANT.email!,
    created_at: ago(26),
    vendor_id: 0,
    notes: null,
    sent_at: ago(25),
    visit_day: day,
    visit_start: start,
    visit_status: "proposed",
    visit_by: "tech",
    tenant_seen: 0,
    tech_seen: 0,
  };
  const m = (id: number, sender: Side, sender_name: string, kind: Kind, body: string, hours: number, visit = false): ChatMessage => ({
    id,
    work_order_id: wo.id,
    sender,
    sender_name,
    kind,
    body,
    visit_day: visit ? day : null,
    visit_start: visit ? start : null,
    created_at: ago(hours),
  });
  const messages = [
    m(1, "tech", tech, "text", "Hi, this is Sam with F.I.R.M. Maintenance. Thanks for the photos. I'll bring a new disposal in case it can't be freed up.", 24),
    m(2, "tenant", "Demo tenant", "text", "Thank you! The reset button didn't help.", 23),
    m(3, "tech", tech, "propose", `Suggested a visit: ${visitLabel(day, start)}.`, 22, true),
  ];
  return {
    wo,
    messages,
    vendor: { id: 0, name: "F.I.R.M. Maintenance" },
    completed: null,
    now,
    timeZone,
    demo: true,
    summary: { id: "demo", title: wo.title, created_at: wo.created_at, visit_day: day, visit_start: start, visit_status: "proposed", unread: true, completed_on: null },
  };
}

// ---------- routes ----------

type Vars = { tenant: Tenant; property: Property; base: string };
export const messageRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

const notValid = (c: Context, env: Env) =>
  c.html(
    layout(
      "Link not valid",
      html`<h1>This link isn't valid</h1><p>The work order may have been given to someone else, or the link was cut off. Please call F.I.R.M. at <a href="tel:${env.EMERGENCY_PHONE}">${env.EMERGENCY_PHONE}</a>.</p>`,
    ),
    404,
  );

const backTo = (url: string, error: string | null) => `${url}${error ? `?error=${encodeURIComponent(error)}` : ""}#${error ? "visit" : "messages"}`;

// Tenant side. The /t/:id/:sig middleware in index.ts has already checked the link (and stops demo POSTs).
async function tenantOrder(c: Context<{ Bindings: Env; Variables: Vars }>): Promise<ChatOrder | null> {
  const wo = await loadOrder(c.env, Number(c.req.param("wo")) || 0);
  return wo && wo.tenant_id === c.var.tenant.id ? wo : null;
}

messageRoutes.get("/t/:id/:sig/wo/:wo", async (c) => {
  const now = new Date();
  if (isDemo(c.var.tenant.id)) return c.html(tenantChatPage(c.env, c.var.base, { ...demoChat(now, tz(c.env)), error: c.req.query("error") }));
  const wo = await tenantOrder(c);
  if (!wo) return notValid(c, c.env);
  const messages = await loadMessages(c.env, wo.id);
  const last = messages.at(-1)?.id ?? 0;
  if (last > wo.tenant_seen) await c.env.DB.prepare("UPDATE work_orders SET tenant_seen = ? WHERE id = ?").bind(last, wo.id).run();
  const vendor = await loadVendor(c.env, wo.vendor_id);
  return c.html(
    tenantChatPage(c.env, c.var.base, { wo, messages, vendor, completed: await completedOn(c.env, wo.id), now, timeZone: tz(c.env), error: c.req.query("error") }),
  );
});

messageRoutes.get("/t/:id/:sig/wo/:wo/latest", async (c) => {
  if (isDemo(c.var.tenant.id)) return c.json({ last: 0 });
  const wo = await tenantOrder(c);
  return c.json({ last: wo ? await lastId(c.env, wo.id) : 0 }, 200, { "Cache-Control": "no-store" });
});

messageRoutes.post("/t/:id/:sig/wo/:wo", async (c) => {
  const wo = await tenantOrder(c);
  if (!wo) return notValid(c, c.env);
  const error = await post(c.env, wo, await c.req.parseBody(), "tenant", c.var.tenant.first_name);
  return c.redirect(backTo(`${c.var.base}/wo/${wo.id}`, error), 303);
});

// Technician side.
async function techOrder(env: Env, woParam: string, sig: string): Promise<{ wo: ChatOrder; vendor: Vendor } | null> {
  const wo = await loadOrder(env, Number(woParam) || 0);
  if (!wo || !wo.vendor_id || !(await verify(env.LINK_SECRET, sig, "tech", String(wo.id), String(wo.vendor_id)))) return null;
  const vendor = await loadVendor(env, wo.vendor_id);
  return vendor ? { wo, vendor } : null;
}

messageRoutes.get("/tech/demo", (c) => {
  const v = demoChat(new Date(), tz(c.env));
  return c.html(techChatPage(c.env, "/tech/demo", { ...v, error: c.req.query("error") }, DEMO_PROPERTY, DEMO_TENANT));
});

messageRoutes.post("/tech/demo", (c) =>
  c.html(
    layout(
      "Demo: nothing sent",
      html`<h1>Demo: nothing sent</h1><div class="card"><p>This is the demo, so nothing was sent. For a real work order, the tenant would get this right away as a notice on their phone (or an email if they don't have the FIRM app), and schedule changes would be added as a private note on the work order in Rentec.</p>
<a class="btn primary" href="/tech/demo">Back to the technician's page</a></div>`,
    ),
  ),
);

messageRoutes.get("/tech/:wo/:sig", async (c) => {
  const found = await techOrder(c.env, c.req.param("wo"), c.req.param("sig"));
  if (!found) return notValid(c, c.env);
  const { wo, vendor } = found;
  const property = await getProperty(c.env, wo.property_id);
  if (!property) return notValid(c, c.env);
  const messages = await loadMessages(c.env, wo.id);
  const last = messages.at(-1)?.id ?? 0;
  if (last > wo.tech_seen) await c.env.DB.prepare("UPDATE work_orders SET tech_seen = ? WHERE id = ?").bind(last, wo.id).run();
  const view: ChatView = { wo, messages, vendor, completed: await completedOn(c.env, wo.id), now: new Date(), timeZone: tz(c.env), error: c.req.query("error") };
  return c.html(techChatPage(c.env, c.req.path, view, property, await getTenant(c.env, wo.tenant_id)));
});

messageRoutes.get("/tech/:wo/:sig/latest", async (c) => {
  const found = await techOrder(c.env, c.req.param("wo"), c.req.param("sig"));
  return c.json({ last: found ? await lastId(c.env, found.wo.id) : 0 }, 200, { "Cache-Control": "no-store" });
});

messageRoutes.post("/tech/:wo/:sig", async (c) => {
  const found = await techOrder(c.env, c.req.param("wo"), c.req.param("sig"));
  if (!found) return notValid(c, c.env);
  const form = await c.req.parseBody();
  const first = String(form["tech_name"] ?? "").replace(/[^\p{L}\p{M} .'-]/gu, "").trim().slice(0, 40);
  const name = first ? `${first} (${found.vendor.name})` : found.vendor.name;
  const error = await post(c.env, found.wo, form, "tech", name);
  return c.redirect(backTo(c.req.path, error), 303);
});

// Office side. The /admin/* middleware in index.ts has already checked the staff sign-in.
messageRoutes.post("/admin/workorders/:id/messages", async (c) => {
  const wo = await loadOrder(c.env, Number(c.req.param("id")) || 0);
  if (!wo) return c.text("Work order not found", 404);
  const error = await post(c.env, wo, await c.req.parseBody(), "office", OFFICE_NAME);
  return c.redirect(`/admin/workorders/${wo.id}${error ? `?sent=${encodeURIComponent(error)}` : ""}#messages`, 303);
});
