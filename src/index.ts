import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { adminPage } from "./admin";
import { formatDay } from "./dates";
import type { Env, Property, Tenant } from "./env";
import { EMERGENCY, FIXED, WORK_ORDER, findGuide, matchGuides, walk } from "./guides";
import { verify } from "./links";
import { emergencyEnding, endingPage, helpPage, homePage, layout, safetyPage, stepPage } from "./pages";
import { sendDueReminders } from "./reminders";
import { RentecClient } from "./rentec";
import { getProperty, getTenant } from "./store";
import { syncFromRentec } from "./sync";

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
  await next();
});

app.get("/t/:id/:sig", (c) => c.redirect(`${c.req.path}/`));
app.get("/t/:id/:sig/", (c) => c.html(homePage(c.env, c.var.base, c.var.tenant, c.var.property)));

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
  if (raw === undefined) return c.html(safetyPage(c.var.base, guide, c.env));
  const answers = parseAnswers(raw);
  const walked = answers && walk(guide, answers, c.var.property.fields);
  if (!answers || !walked) return c.redirect(`${c.var.base}/guide/${guide.id}`);
  if (walked.at === EMERGENCY) return c.html(emergencyEnding(c.var.base, c.env));
  // Endings are reached only by POST (see /finish), so a stray GET just shows the last question again.
  if (walked.at === FIXED || walked.at === WORK_ORDER) {
    return c.redirect(`${c.var.base}/guide/${guide.id}?a=${answers.slice(0, -1).join(",")}`);
  }
  return c.html(stepPage(c.var.base, guide, answers, walked, c.var.property));
});

app.post("/t/:id/:sig/guide/:guide/finish", async (c) => {
  const guide = findGuide(c.req.param("guide"));
  const answers = parseAnswers(String((await c.req.parseBody())["a"] ?? ""));
  const walked = guide && answers && walk(guide, answers, c.var.property.fields);
  if (!guide || !walked || (walked.at !== FIXED && walked.at !== WORK_ORDER)) return notFound(c);
  const { tenant, property, base } = c.var;

  let workOrderId: string | null = null;
  if (walked.at === WORK_ORDER) {
    const description = [
      `Submitted by ${tenant.first_name} ${tenant.last_name} through the F.I.R.M. Home Care troubleshooting guide.`,
      "",
      "Steps already tried:",
      ...walked.history.map((h, i) => `${i + 1}. ${h.question}\n   Answer: ${h.answer}`),
    ].join("\n");
    try {
      workOrderId = await RentecClient.fromEnv(c.env).createWorkOrder({
        propertyId: property.id,
        tenantId: tenant.id,
        title: guide.title,
        description,
      });
    } catch (err) {
      console.error(`Work order for ${tenant.id} failed: ${err}`);
      return c.html(
        endingPage(
          base,
          "Please submit it in Resident Connect",
          "We couldn't file the work order automatically. Please submit it in Resident Connect, and mention the steps you've tried.",
          c.env,
          html`<a class="btn primary" href="${c.env.RESIDENT_CONNECT_URL}">Open Resident Connect</a>`,
        ),
        502,
      );
    }
  }

  await c.env.DB.prepare(
    "INSERT INTO guide_outcomes (tenant_id, guide_id, outcome, steps, work_order_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(tenant.id, guide.id, walked.at === FIXED ? "fixed" : "work_order", JSON.stringify(walked.history), workOrderId, new Date().toISOString())
    .run();

  return c.html(
    walked.at === FIXED
      ? endingPage(base, "Glad that worked", "Thanks for taking care of it. If it happens again, run the guide again or let us know.", c.env)
      : endingPage(
          base,
          "Work order submitted",
          "We've sent your request to F.I.R.M. along with the steps you tried, so our technician won't repeat them. You can follow it in Resident Connect.",
          c.env,
        ),
  );
});

// "Done" links in reminder emails. GET only asks, because email scanners open links on their own.
app.get("/done/:id/:kind/:due/:sig", async (c) => {
  const { id, kind, due, sig } = c.req.param();
  if (!(await verify(c.env.LINK_SECRET, sig, "done", id, kind, due))) return notFound(c);
  return c.html(
    layout(
      "Done",
      html`<h1>All done?</h1><form method="post"><button class="btn primary">Yes, I've done it</button></form>`,
    ),
  );
});

app.post("/done/:id/:kind/:due/:sig", async (c) => {
  const { id, kind, due, sig } = c.req.param();
  if (!(await verify(c.env.LINK_SECRET, sig, "done", id, kind, due))) return notFound(c);
  await c.env.DB.prepare("UPDATE reminders_sent SET done_at = COALESCE(done_at, ?) WHERE tenant_id = ? AND kind = ? AND due_date = ?")
    .bind(new Date().toISOString(), id, kind, due)
    .run();
  return c.html(layout("Thanks", html`<h1>Thanks!</h1><p>We've noted it. Taking care of these small things keeps your home running well.</p>`));
});

// Admin: a single shared password in ADMIN_TOKEN, passed as ?token=.
app.use("/admin/*", async (c, next) => {
  const token = c.req.query("token") ?? "";
  if (!c.env.ADMIN_TOKEN || token !== c.env.ADMIN_TOKEN) return c.text("Not authorized", 401);
  await next();
});
app.get("/admin/", async (c) => c.html(await adminPage(c.env, c.req.query("token")!)));
app.post("/admin/run", async (c) => {
  await runNightly(c.env);
  return c.redirect(`/admin/?token=${encodeURIComponent(c.req.query("token")!)}`, 303);
});

app.get("/", (c) => c.text("F.I.R.M. Home Care"));

async function runNightly(env: Env): Promise<void> {
  const day = today();
  const sync = await syncFromRentec(env, day);
  const reminders = await sendDueReminders(env, day);
  console.log(`Nightly run ${day}: synced ${sync.properties} properties, ${sync.tenants} tenants; sent ${reminders.sent} reminders`);
  if (reminders.failed.length) console.error(`Failed reminders:\n${reminders.failed.join("\n")}`);
}

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runNightly(env));
  },
};
