import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { adminPage, homeDetailsPage, tenantsPage } from "./admin";
import { isAdmin } from "./auth";
import { formatDay, policyDate } from "./dates";
import type { Env, Property, Tenant } from "./env";
import { EMERGENCY, FIXED, WORK_ORDER, findGuide, matchGuides, walk, type Guide, type Walk } from "./guides";
import { verify } from "./links";
import { VISIT_TIMES, emergencyEnding, endingPage, helpPage, homePage, layout, reportPage, safetyPage, stepPage } from "./pages";
import { savePhoto, servePhoto } from "./photos";
import { sendDueReminders } from "./reminders";
import { RentecClient } from "./rentec";
import { getProperty, getTenant, saveHomeDetails } from "./store";
import { syncFromRentec } from "./sync";
import { inspectionRoutes } from "./inspection";
import { toE164 } from "./sms";
import { dispatchRoutes, sendHeldTexts } from "./dispatch";
import { startRoutes } from "./start";
import { trackerEmail, trackerRoutes } from "./tracker";
import { sendEmail } from "./email";
import { ICON_180, ICON_192, ICON_512 } from "./icons";
import { appRoutes, isApp, registerPush, rememberTenant } from "./app";
import type { Vendor, WorkOrder } from "./dispatch";
import { alertOffice, confirmToTenant, endOfDayEmail, loadWorkOrder, logEvent, maintenanceRoutes, recordTenantResult, refreshFromRentec, requestsPage, suggestVendor, tenantRequests } from "./maintenance";
import { FLAGS, STARTED, TIERS, rentecPriority, triage } from "./triage";

type Vars = { tenant: Tenant; property: Property; base: string };
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

const today = () => formatDay(new Date());

const notFound = (c: Context) =>
  c.html(layout("Link not valid", html`<h1>This link isn't valid</h1><p>Please use the latest link from your Home Care email.</p>`), 404);

// Every tenant page sits under /t/:id/:sig, a link only this app can sign.
app.use("/t/:id/:sig/*", async (c, next) => {
  const { id, sig } = c.req.param();
  if (!(await verify(c.env.LINK_SECRET, sig, "home", id))) return notFound(c);
  const tenant = await getTenant(c.env, id);
  const property = tenant && tenant.active ? await getProperty(c.env, tenant.property_id) : null;
  if (!tenant || !property) return notFound(c);
  c.set("tenant", tenant);
  c.set("property", property);
  c.set("base", `/t/${encodeURIComponent(id)}/${sig}`);
  // A Home Care link opened in the phone app signs that phone in, so the app opens here next time.
  if (isApp(c)) await rememberTenant(c, tenant.id);
  await next();
});

app.get("/t/:id/:sig", (c) => c.redirect(`${c.req.path}/`));
app.get("/t/:id/:sig/", async (c) => {
  const open = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM work_orders WHERE tenant_id = ? AND status != 'completed'").bind(c.var.tenant.id).first<{ n: number }>();
  return c.html(homePage(c.env, c.var.base, c.var.tenant, c.var.property, c.req.query("saved") === "insurance", open?.n ?? 0));
});

// The tenant's repair requests: where each one is (Received, Vendor contacted, Scheduled, In progress, Completed).
app.get("/t/:id/:sig/requests", async (c) => c.html(requestsPage(c.env, c.var.base, await tenantRequests(c.env, c.var.tenant.id))));

// Close-out: the tenant taps Fixed or Still a problem once the work is marked complete.
app.post("/t/:id/:sig/requests/:wo/result", async (c) => {
  const wo = await loadWorkOrder(c.env, c.req.param("wo"));
  const result = String((await c.req.parseBody())["result"] ?? "");
  if (!wo || wo.tenant_id !== c.var.tenant.id || (result !== "fixed" && result !== "still_broken")) return notFound(c);
  if (wo.status === "completed" && !wo.tenant_result) await recordTenantResult(c.env, wo, result);
  const thanks = result === "fixed" ? "Thanks for letting us know it's fixed." : "Sorry it's still a problem. We've reopened your request and told F.I.R.M.; we'll be in touch.";
  return c.html(requestsPage(c.env, c.var.base, await tenantRequests(c.env, c.var.tenant.id), thanks));
});

// The tenant's renters insurance end date. Rentec's API doesn't share it, so reminders follow this one.
app.post("/t/:id/:sig/insurance", async (c) => {
  const day = policyDate((await c.req.parseBody())["expires"], today());
  if (day) await c.env.DB.prepare("UPDATE tenants SET insurance_expires = ? WHERE id = ?").bind(day, c.var.tenant.id).run();
  return c.redirect(`${c.var.base}/?saved=insurance#insurance`, 303);
});

// The phone app's push token for this tenant.
app.post("/t/:id/:sig/push", (c) => registerPush(c, c.var.tenant.id));

// Home screen app: each tenant's manifest starts at their own page.
app.get("/t/:id/:sig/manifest.webmanifest", (c) =>
  c.json(
    {
      name: "F.I.R.M. Home Care",
      short_name: "FIRM Home",
      start_url: `${c.var.base}/`,
      scope: `${c.var.base}/`,
      display: "standalone",
      background_color: "#1f5f8b",
      theme_color: "#1f5f8b",
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    200,
    { "Content-Type": "application/manifest+json" },
  ),
);

app.get("/t/:id/:sig/help", (c) => {
  const q = (c.req.query("q") ?? "").trim().slice(0, 200);
  return c.html(helpPage(c.var.base, q, q ? matchGuides(q) : []));
});

function parseAnswers(raw: string | undefined): number[] | null {
  if (raw === undefined || raw === "") return [];
  const parts = raw.split(",").map(Number);
  return parts.every((n) => Number.isInteger(n) && n >= 0) && parts.length <= 20 ? parts : null;
}

app.get("/t/:id/:sig/guide/:guide", (c) => {
  const guide = findGuide(c.req.param("guide"));
  if (!guide) return notFound(c);
  const raw = c.req.query("a");
  if (raw === undefined) return c.html(safetyPage(c.var.base, guide, c.env, c.var.property));
  const answers = parseAnswers(raw);
  const walked = answers && walk(guide, answers, c.var.property.fields);
  if (!answers || !walked) return c.redirect(`${c.var.base}/guide/${guide.id}`);
  if (walked.at === EMERGENCY) return c.html(emergencyEnding(c.var.base, c.env, `${c.var.base}/report/${guide.id}?a=${answers.join(",")}`));
  if (walked.at === WORK_ORDER) return c.redirect(`${c.var.base}/report/${guide.id}?a=${answers.join(",")}`);
  // "Fixed" is recorded only by POST, so a stray GET shows the last question again.
  if (walked.at === FIXED) return c.redirect(`${c.var.base}/guide/${guide.id}?a=${answers.slice(0, -1).join(",")}`);
  return c.html(stepPage(c.var.base, guide, answers, walked, c.var.property));
});

async function recordOutcome(env: Env, tenantId: string, guideId: string, outcome: "fixed" | "work_order", history: Walk["history"], workOrderId: string | null) {
  await env.DB.prepare(
    "INSERT INTO guide_outcomes (tenant_id, guide_id, outcome, steps, work_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(tenantId, guideId, outcome, JSON.stringify(history), workOrderId, new Date().toISOString())
    .run();
}

app.post("/t/:id/:sig/guide/:guide/fixed", async (c) => {
  const guide = findGuide(c.req.param("guide"));
  const answers = parseAnswers(String((await c.req.parseBody())["a"] ?? ""));
  const walked = guide && answers && walk(guide, answers, c.var.property.fields);
  if (!guide || !walked || walked.at !== FIXED) return notFound(c);
  await recordOutcome(c.env, c.var.tenant.id, guide.id, "fixed", walked.history, null);
  return c.html(endingPage(c.var.base, "Glad that worked", "Thanks for taking care of it. If it happens again, run these checks again or submit a work order.", c.env));
});

/**
 * Which guide and checks a work order comes from. "other" is a problem with no guide; a=skip means the tenant
 * says they already tried the usual fixes. Anything else must be a real path that ends in a work order.
 */
function reportContext(c: Context<{ Bindings: Env; Variables: Vars }>, guideId: string, raw: string): { guide: Guide | null; walked: Walk | null } | null {
  if (guideId === "other") return { guide: null, walked: null };
  const guide = findGuide(guideId);
  if (!guide) return null;
  if (raw === "skip") return { guide, walked: { at: WORK_ORDER, history: [{ question: "Usual fixes", answer: "Tenant says they already tried the usual fixes" }] } };
  const answers = parseAnswers(raw);
  const walked = answers && walk(guide, answers, c.var.property.fields);
  // An emergency ending can send its details too, after the tenant has called.
  return walked && (walked.at === WORK_ORDER || walked.at === EMERGENCY) ? { guide, walked } : null;
}

app.get("/t/:id/:sig/report/:guide", (c) => {
  const raw = c.req.query("a") ?? "";
  const ctx = reportContext(c, c.req.param("guide"), raw);
  if (!ctx) return c.redirect(`${c.var.base}/help`);
  return c.html(reportPage(c.var.base, c.env, ctx.guide, raw, ctx.walked, c.var.tenant));
});

const MAX_PHOTOS = 5;

app.post("/t/:id/:sig/report/:guide", async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = String(body["a"] ?? "");
  const ctx = reportContext(c, c.req.param("guide"), raw);
  if (!ctx) return notFound(c);
  const { tenant, property, base } = c.var;
  const text = (key: string) => String(body[key] ?? "").trim().slice(0, 2000);
  const phone = text("phone").slice(0, 40);
  const email = text("email").slice(0, 200);
  if (!toE164(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = "Please enter a phone number (10 digits) and an email address so we can reach you.";
    return c.html(reportPage(base, c.env, ctx.guide, raw, ctx.walked, { ...tenant, phone, email }, error), 400);
  }

  const files = (key: string) => ([] as unknown[]).concat(body[key] ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  const photoUrls: string[] = [];
  for (const file of files("photos").slice(0, MAX_PHOTOS)) {
    const url = await savePhoto(c.env, file, `workorder/${tenant.id}`);
    if (url) photoUrls.push(url);
  }
  const tag = files("tag")[0];
  const tagUrl = tag ? await savePhoto(c.env, tag, `workorder/${tenant.id}`) : null;

  const visitTimes = ([] as unknown[]).concat(body["when"] ?? []).map(String).filter((t) => VISIT_TIMES.includes(t));
  const title = ctx.guide?.title ?? (text("what").split(/[.\n]/)[0]!.slice(0, 80) || "Tenant request");
  const started = STARTED.includes(text("started")) ? text("started") : "";
  const followUp = text("follow_up").slice(0, 120);
  const triaged = triage({
    guideId: ctx.guide?.id ?? null,
    emergency: ctx.walked?.at === EMERGENCY,
    answers: ctx.walked?.history.map((h) => h.answer),
    title,
    what: text("what"),
    where: text("where"),
    started,
    followUp,
    moveIn: tenant.move_in,
    today: today(),
  });
  const description = [
    `Submitted by ${tenant.first_name} ${tenant.last_name} through F.I.R.M. Home Care.`,
    `Contact: ${phone}, ${email}`,
    "",
    `What's happening: ${text("what")}`,
    ...(text("where") ? [`Where: ${text("where")}`] : []),
    ...(followUp ? [followUp] : []),
    ...(started ? [`Started: ${started}`] : []),
    ...(text("tried") ? [`Already tried: ${text("tried")}`] : []),
    ...(visitTimes.length ? [`Best times: ${visitTimes.join("; ")}`] : []),
    `Pets in the home: ${body["pets"] === "yes" ? "yes" : "no"}`,
    ...(body["adult_present"] === "1" ? ["Tenant confirmed they or an authorized adult 18+ will be home for the visit."] : []),
    ...(ctx.guide?.drainLine && body["drain_ack"] === "1"
      ? ["Tenant acknowledged clearing a slow or clogged drain is their cost unless the line is collapsed or damaged through no fault of theirs."]
      : []),
    ...(ctx.walked?.history.length
      ? ["", "Checks already done:", ...ctx.walked.history.map((h, i) => `${i + 1}. ${h.question}\n   Answer: ${h.answer}`)]
      : []),
    ...(photoUrls.length ? ["", "Photos:", ...photoUrls] : []),
    ...(tagUrl ? ["", `Model/serial tag photo: ${tagUrl}`] : []),
  ].join("\n");

  let workOrderId: string;
  const rentec = RentecClient.fromEnv(c.env);
  try {
    workOrderId = await rentec.createWorkOrder({
      propertyId: property.id,
      tenantId: tenant.id,
      // Rentec shows the title to the tenant too, so only the plain urgency words go in it.
      title: triaged.tier === "emergency" ? `EMERGENCY: ${title}` : triaged.tier === "urgent" ? `URGENT: ${title}` : title,
      description,
      priority: rentecPriority(triaged.tier, c.env.RENTEC_PRIORITIES),
      privateNotes: [`Home Care triage: ${triaged.summary}`, `Response target: ${TIERS[triaged.tier].target}.`, ...triaged.flags.map((f) => FLAGS[f])].join("\n"),
    });
  } catch (err) {
    console.error(`Work order for ${tenant.id} failed: ${err}`);
    return c.html(
      endingPage(
        base,
        "Please submit it in Resident Connect",
        "We couldn't file the work order automatically. Please submit it in Resident Connect and mention the checks you've done.",
        c.env,
        html`<a class="btn primary" href="${c.env.RESIDENT_CONNECT_URL}">Open Resident Connect</a>`,
      ),
      502,
    );
  }
  // Attach the photos to the work order in Rentec too. The links in the description still work if this fails.
  if (workOrderId) {
    const uploads = [...files("photos").slice(0, MAX_PHOTOS), ...(tag ? [tag] : [])];
    for (const file of uploads) {
      await rentec
        .uploadFile({ workOrderId }, file.name || "photo.jpg", file.type || "image/jpeg", await file.arrayBuffer())
        .catch((err) => console.error(`Photo for work order ${workOrderId}: ${err}`));
    }
  }
  await recordOutcome(c.env, tenant.id, ctx.guide?.id ?? "other", "work_order", ctx.walked?.history ?? [], workOrderId);
  const now = new Date().toISOString();
  const wo = (await c.env.DB.prepare(
    `INSERT INTO work_orders (rentec_id, tenant_id, property_id, guide_id, title, description, contact_phone, contact_email, created_at,
       tier, category, summary, flags, started, status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?) RETURNING *`,
  )
    .bind(
      workOrderId || null, tenant.id, property.id, ctx.guide?.id ?? null, title, description, phone, email, now,
      triaged.tier, triaged.category, triaged.summary, triaged.flags.join(",") || null, started || null, now,
    )
    .first<WorkOrder>())!;
  await logEvent(c.env, wo.id, "created", "We received your request.", true);
  await confirmToTenant(c.env, wo);
  const { results: vendors } = await c.env.DB.prepare("SELECT * FROM vendors").all<Vendor>();
  const suggested = vendors.find((v) => v.id === suggestVendor(wo.category, vendors)) ?? null;
  await alertOffice(c.env, wo, property, tenant, suggested);
  return c.html(
    endingPage(
      base,
      "Work order submitted",
      `Your request number is #${wo.id}. We've sent it to F.I.R.M. with your photos and the checks you did, and emailed you a copy. We'll contact you to set up a visit.`,
      c.env,
      html`${triaged.tier === "emergency" ? html`<p><strong>If you haven't called yet, please call now.</strong></p><a class="btn danger" href="tel:${c.env.EMERGENCY_PHONE}">Call ${c.env.EMERGENCY_PHONE}</a>` : ""}
<a class="btn primary" href="${base}/requests#wo-${wo.id}">Follow my request</a>`,
    ),
  );
});

const png = (b64: string) => () =>
  new Response(Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0)), {
    headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=604800" },
  });
app.get("/icon-512.png", png(ICON_512));
app.get("/icon-192.png", png(ICON_192));
app.get("/apple-touch-icon.png", png(ICON_180));
app.get("/favicon.ico", png(ICON_192));

// Photo links in work orders and inspection reports. Keys are random, so a link can't be guessed.
app.get("/photo/*", (c) => servePhoto(c.env, c.req.path.slice("/photo/".length)));

// "Done" links in reminder emails. GET only asks, because email scanners open links on their own.
app.get("/done/:id/:kind/:due/:sig", async (c) => {
  const { id, kind, due, sig } = c.req.param();
  if (!(await verify(c.env.LINK_SECRET, sig, "done", id, kind, due))) return notFound(c);
  return c.html(layout("Done", html`<h1>All done?</h1><form method="post"><button class="btn primary">Yes, I've done it</button></form>`));
});

app.post("/done/:id/:kind/:due/:sig", async (c) => {
  const { id, kind, due, sig } = c.req.param();
  if (!(await verify(c.env.LINK_SECRET, sig, "done", id, kind, due))) return notFound(c);
  await c.env.DB.prepare("UPDATE reminders_sent SET done_at = COALESCE(done_at, ?) WHERE tenant_id = ? AND kind = ? AND due_date = ?")
    .bind(new Date().toISOString(), id, kind, due)
    .run();
  return c.html(layout("Thanks", html`<h1>Thanks!</h1><p>We've noted it. Taking care of these small things keeps your home running well.</p>`));
});

// Admin: one shared password (ADMIN_TOKEN). Open /admin/?token=... once on a device; a cookie keeps it signed in.
app.use("/admin/*", async (c, next) => {
  if (!(await isAdmin(c))) return c.text("Not authorized. Open the admin link with ?token= once on this device.", 401);
  await next();
});
app.get("/admin/", async (c) => c.html(await adminPage(c.env, c.req.query("invite") ?? "")));
// Shows which fields Rentec returns (names only), to confirm the API mapping before the pilot.
app.get("/admin/rentec-check", async (c) => {
  const results = await RentecClient.fromEnv(c.env).describe();
  return c.html(
    layout(
      "Check Rentec",
      html`<h1>Check the Rentec connection</h1>
<p class="quiet">Field names Rentec sends back for the first record of each list. No tenant details are shown. Send a screenshot of this page to Claude to confirm the app reads the right fields.</p>
${results.map(
  (r) => html`<div class="card${r.ok ? "" : " alert"}"><h2>${r.name}</h2>
${r.ok ? html`<p class="quiet">${r.count} records</p><p style="font-family:monospace;font-size:13px">${r.fields.join(", ") || "(empty list)"}</p>` : html`<p>${r.error}</p>`}</div>`,
)}<a class="quiet" href="/admin/">Back to admin</a>`,
    ),
  );
});

// Tenants and their renters insurance end dates, which staff can correct (Rentec's API doesn't share them).
app.get("/admin/tenants", async (c) => c.html(await tenantsPage(c.env, c.req.query("saved"))));
app.post("/admin/tenants/:id/insurance", async (c) => {
  const value = String((await c.req.parseBody())["expires"] ?? "").trim();
  const day = value ? policyDate(value, today()) : null;
  if (!value || day) await c.env.DB.prepare("UPDATE tenants SET insurance_expires = ? WHERE id = ?").bind(day, c.req.param("id")).run();
  return c.redirect(`/admin/tenants?saved=${encodeURIComponent(c.req.param("id"))}`, 303);
});

app.post("/admin/run", async (c) => {
  await runNightly(c.env);
  return c.redirect("/admin/", 303);
});

// Home details: filled in on a phone during an inspection, saved straight to the property's sticky note in Rentec.
app.get("/admin/home/:property", async (c) => {
  const property = await getProperty(c.env, c.req.param("property"));
  if (!property) return c.text("Property not found", 404);
  return c.html(homeDetailsPage(property, c.req.query("saved") === "1"));
});
app.post("/admin/home/:property", async (c) => {
  const property = await getProperty(c.env, c.req.param("property"));
  if (!property) return c.text("Property not found", 404);
  await saveHomeDetails(c.env, property, await c.req.parseBody());
  return c.redirect(`/admin/home/${encodeURIComponent(property.id)}?saved=1`, 303);
});

app.route("/", inspectionRoutes);
app.route("/", maintenanceRoutes);
app.route("/", dispatchRoutes);
app.route("/", startRoutes);
app.route("/", trackerRoutes);
app.route("/", appRoutes);


async function runNightly(env: Env): Promise<void> {
  const day = today();
  const sync = await syncFromRentec(env, day);
  const reminders = await sendDueReminders(env, day);
  console.log(`Nightly run ${day}: synced ${sync.properties} properties, ${sync.tenants} tenants; sent ${reminders.sent} reminders`);
  if (reminders.failed.length) console.error(`Failed reminders:\n${reminders.failed.join("\n")}`);
  // The office's daily tracker email (open jobs by vendor, money owed), sent before the workday.
  const tracker = await trackerEmail(env, day);
  if (tracker) await sendEmail(env, env.OFFICE_EMAIL, tracker.subject, tracker.html).catch((err) => console.error(`Tracker email: ${err}`));
}

/** The office's end-of-day work order summary: new, scheduled, closed, and anything that needs a look. */
async function sendEndOfDay(env: Env): Promise<void> {
  const summary = await endOfDayEmail(env);
  if (summary) await sendEmail(env, env.OFFICE_EMAIL, summary.subject, summary.html).catch((err) => console.error(`End-of-day email: ${err}`));
}

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(sendHeldTexts(env, new Date()));
      // Work order status from Rentec (vendor assigned, parts, in progress, closed) for the tenant's status page.
      ctx.waitUntil(refreshFromRentec(env).catch((err) => console.error(`Rentec status refresh: ${err}`)));
    } else if (event.cron === "0 22 * * *") ctx.waitUntil(sendEndOfDay(env));
    else ctx.waitUntil(runNightly(env));
  },
};
