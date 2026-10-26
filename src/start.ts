// How tenants get to their Home Care page without digging up an old email:
// - The start page (the app's short web address, also on a QR sticker in each home) has the emergency line first,
//   then "send me my link": a tenant types the phone or email on file and gets their link by text or email.
// - One tap on the admin page invites every current tenant by email and text, with add-to-home-screen steps.
// Once the page is on their home screen, the FIRM icon opens it directly every time.
import { Hono } from "hono";
import { html, raw } from "hono/html";
import qrcode from "qrcode-generator";
import { sendEmail } from "./email";
import type { Env, Tenant } from "./env";
import { homeLink } from "./links";
import { emergencyCard, layout } from "./pages";
import { sendText, toE164 } from "./sms";
import { listProperties } from "./store";

/** At most this many links sent to one tenant per hour, so the form can't be used to flood someone. */
const MAX_PER_HOUR = 3;

export const startRoutes = new Hono<{ Bindings: Env }>();

/** The active tenant whose phone or email on file matches what was typed, or null. */
export async function findTenant(env: Env, typed: string): Promise<{ tenant: Tenant; channel: "email" | "text" } | null> {
  const value = typed.trim();
  if (value.includes("@")) {
    const tenant = await env.DB.prepare("SELECT * FROM tenants WHERE active = 1 AND lower(email) = lower(?) LIMIT 1").bind(value).first<Tenant>();
    return tenant ? { tenant, channel: "email" } : null;
  }
  const phone = toE164(value);
  if (!phone) return null;
  const { results } = await env.DB.prepare("SELECT * FROM tenants WHERE active = 1 AND phone IS NOT NULL").all<Tenant>();
  const tenant = results.find((t) => toE164(t.phone ?? "") === phone);
  return tenant ? { tenant, channel: "text" } : null;
}

function startPage(env: Env, notice = ""): ReturnType<typeof layout> {
  return layout(
    "Welcome",
    html`<h1>F.I.R.M. Home Care</h1>
${emergencyCard(env)}
<div class="card"><h2>Water leaking?</h2><p>Turn the small valve under the sink or behind the toilet clockwise. If water is spraying or spreading, shut off the main water to the home, then call.</p></div>
<div class="card" id="link"><h2>Open my home page</h2>
${notice ? html`<p class="card note">${notice}</p>` : ""}
<p class="quiet">Your home's emergency guide, quick fixes and work orders. Enter the cell number or email F.I.R.M. has for you and we'll send your link.</p>
<form method="post" action="/start"><label for="who">Cell number or email</label>
<input type="text" id="who" name="who" required autocomplete="email" inputmode="email" placeholder="704-555-0100 or you@example.com">
<button class="btn primary">Send my link</button></form>
<p class="quiet">Then open the link on your phone and add it to your home screen. The FIRM icon takes you straight there next time.</p></div>`,
  );
}

startRoutes.get("/", (c) => c.html(startPage(c.env)));
startRoutes.get("/start", (c) => c.redirect("/", 301));

startRoutes.post("/start", async (c) => {
  const typed = String((await c.req.parseBody())["who"] ?? "").slice(0, 200);
  const match = await findTenant(c.env, typed);
  // Same answer whether or not it matched, so the form doesn't reveal who rents from F.I.R.M.
  const notice = "If that matches what we have on file, your link is on its way. It can take a minute. Nothing? Call or email F.I.R.M.";
  if (match) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE tenant_id = ? AND created_at > ?")
      .bind(match.tenant.id, since)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) < MAX_PER_HOUR) {
      await c.env.DB.prepare("INSERT INTO link_requests (tenant_id, channel, created_at) VALUES (?, ?, ?)")
        .bind(match.tenant.id, match.channel, new Date().toISOString())
        .run();
      try {
        await sendLink(c.env, match.tenant, match.channel, "link");
      } catch (err) {
        console.error(`Link for ${match.tenant.id} failed: ${err}`);
      }
    }
  }
  return c.html(startPage(c.env, notice));
});

/** The steps to put the page on the home screen, for email. */
const STEPS_HTML = `<p><strong>iPhone:</strong> open the link in Safari, tap the Share button, then <strong>Add to Home Screen</strong>.<br>
<strong>Android:</strong> open the link in Chrome, tap the &#8942; menu, then <strong>Add to Home screen</strong> or <strong>Install app</strong>.</p>`;

/** Sends a tenant their Home Care link: "link" when they asked for it, "invite" for the launch to current tenants. */
export async function sendLink(env: Env, tenant: Tenant, channel: "email" | "text", why: "link" | "invite"): Promise<void> {
  const link = `${await homeLink(env.APP_URL, env.LINK_SECRET, tenant.id)}/`;
  if (channel === "text") {
    const to = toE164(tenant.phone ?? "");
    if (!to) return;
    await sendText(
      env,
      to,
      why === "invite"
        ? `F.I.R.M. Home Care: your home's emergency guide and quick fixes, on your phone. Open this link and tap "Add to Home Screen": ${link} Emergencies: ${env.EMERGENCY_PHONE}`
        : `Your F.I.R.M. Home Care link: ${link} Tip: tap "Add to Home Screen" so the FIRM icon opens it next time.`,
    );
    return;
  }
  if (!tenant.email) return;
  const intro =
    why === "invite"
      ? `<p>Hi ${escape(tenant.first_name)},</p><p>F.I.R.M. Home Care puts your home's emergency guide, quick fixes for common problems, and work orders on your phone. No app to download and no password.</p>`
      : `<p>Hi ${escape(tenant.first_name)},</p><p>Here's the link to your Home Care page you asked for.</p>`;
  await sendEmail(
    env,
    tenant.email,
    why === "invite" ? "Put F.I.R.M. Home Care on your phone" : "Your F.I.R.M. Home Care link",
    `${intro}
<p><a href="${link}" style="display:inline-block;background:#1f5f8b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open my Home Care page</a></p>
<p>Then add it to your home screen once, and the FIRM icon opens it every time:</p>${STEPS_HTML}
<p>Lost the icon or got a new phone? Go to ${escape(env.APP_URL.replace(/^https?:\/\//, ""))} and enter your cell number or email.</p>
<p>Emergency? Call ${escape(env.EMERGENCY_PHONE)}.</p>`,
  );
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

/** Invites every active tenant who hasn't been invited yet, by email and text. */
export async function inviteTenants(env: Env): Promise<{ invited: number; failed: string[] }> {
  const { results } = await env.DB.prepare("SELECT * FROM tenants WHERE active = 1 AND invited_at IS NULL").all<Tenant>();
  let invited = 0;
  const failed: string[] = [];
  for (const tenant of results) {
    const channels = [...(tenant.email ? ["email" as const] : []), ...(toE164(tenant.phone ?? "") ? ["text" as const] : [])];
    if (!channels.length) continue;
    let ok = false;
    for (const channel of channels) {
      try {
        await sendLink(env, tenant, channel, "invite");
        ok = true;
      } catch (err) {
        failed.push(`${tenant.first_name} ${tenant.last_name} (${channel}): ${String(err).slice(0, 120)}`);
      }
    }
    if (ok) {
      await env.DB.prepare("UPDATE tenants SET invited_at = ? WHERE id = ?").bind(new Date().toISOString(), tenant.id).run();
      invited++;
    }
  }
  return { invited, failed };
}

startRoutes.post("/admin/invite", async (c) => {
  const r = await inviteTenants(c.env);
  const msg = `Invited ${r.invited} tenant${r.invited === 1 ? "" : "s"}.${r.failed.length ? ` Didn't go through: ${r.failed.join("; ")}` : ""}`;
  return c.redirect(`/admin/?invite=${encodeURIComponent(msg)}`, 303);
});

/** An SVG QR code for a web address. */
export function qrSvg(url: string): string {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// Printable QR stickers, one per home, for the water heater, breaker panel or under the kitchen sink.
// They point to the start page, so they keep working when tenants change.
startRoutes.get("/admin/stickers", async (c) => {
  const properties = await listProperties(c.env);
  const site = c.env.APP_URL.replace(/^https?:\/\//, "");
  const svg = raw(qrSvg(`${c.env.APP_URL}/`));
  return c.html(html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Home Care stickers</title><style>
body{margin:0;font:14px/1.35 system-ui,-apple-system,sans-serif;color:#1d2329}
.bar{padding:12px 16px;background:#e8f0f6}@media print{.bar{display:none}}
.sheet{display:grid;grid-template-columns:repeat(2,3.5in);gap:.25in;padding:.4in;justify-content:center}
.sticker{border:2px solid #1f5f8b;border-radius:12px;padding:12px;display:grid;grid-template-columns:1.3in 1fr;gap:10px;align-items:center;break-inside:avoid}
.sticker svg{width:1.3in;height:1.3in}.sticker h2{margin:0 0 4px;font-size:16px;color:#1f5f8b}.sticker p{margin:2px 0}
.em{font-weight:700;color:#b3261e;white-space:nowrap}.addr{color:#5b6670;font-size:11px}
</style></head><body>
<div class="bar"><strong>Home Care stickers.</strong> Print on sticker paper or card stock, one per home: on the water heater, the breaker panel or inside the sink cabinet. The code opens ${site}, so it keeps working when tenants change. <a href="/admin/">Back to admin</a></div>
<div class="sheet">${properties.map(
    (p) => html`<div class="sticker">${svg}<div><h2>FIRM Home Care</h2><p>Leak? No heat? Something broken? Scan for quick fixes and work orders.</p>
<p class="em">Emergency: ${c.env.EMERGENCY_PHONE}</p><p>${site}</p><p class="addr">${p.address}</p></div></div>`,
  )}</div></body></html>`);
});
