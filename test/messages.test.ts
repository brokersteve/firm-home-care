import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { memoryD1 } from "./helpers/d1";
import { homeLink } from "../src/links";
import { techLink, tenantNotice } from "../src/messages";
import { vendorEmailHtml, vendorText } from "../src/dispatch";

const worker = (await import("../src/index")).default as { fetch: (r: Request, env: unknown, ctx: unknown) => Promise<Response> };
const ctx = { waitUntil() {}, passThroughOnException() {} };

const DB = memoryD1();
const env = {
  DB,
  APP_URL: "https://x.test",
  LINK_SECRET: "s",
  EMERGENCY_PHONE: "704-430-6193",
  OFFICE_EMAIL: "office@x.test",
  TIMEZONE: "America/New_York",
  COMPANY_NAME: "F.I.R.M.",
  RESEND_API_KEY: "log",
  FCM_SERVICE_ACCOUNT: "log",
  RENTEC_BASE_URL: "https://rentec.test",
  RENTEC_API_KEY: "k",
  ADMIN_TOKEN: "adm",
};

const logs: string[] = [];
const rentec: { url: string; body: string }[] = [];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-17T20:14:00Z")); // Tue 3:14pm Eastern
  vi.spyOn(console, "log").mockImplementation((...a) => void logs.push(a.join(" ")));
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    rentec.push({ url: String(url), body: String(init?.body ?? "") });
    return new Response("{}", { status: 200 });
  });
  const run = (sql: string, ...args: unknown[]) => DB.prepare(sql).bind(...args).run();
  await run("INSERT INTO properties (id, name, address, fields, synced_at) VALUES ('p1', '88 Birch', '88 Birch Ct, Charlotte, NC', '{}', 'x')");
  await run("INSERT INTO tenants (id, property_id, first_name, last_name, email, phone, active, synced_at) VALUES ('t1', 'p1', 'Bo', 'Li', 'bo@x.test', '704-555-0142', 1, 'x')");
  await run("INSERT INTO tenants (id, property_id, first_name, last_name, active, synced_at) VALUES ('t2', 'p1', 'Al', 'Ng', 1, 'x')");
  await run("INSERT INTO vendors (id, name, email, phone) VALUES (50, 'Ace Plumbing', 'ace@x.test', '704-555-0199')");
  await run(
    `INSERT INTO work_orders (id, rentec_id, tenant_id, property_id, title, description, contact_phone, contact_email, created_at, vendor_id, sent_at)
     VALUES (7, '555', 't1', 'p1', 'Garbage disposal not working', 'It hums.', '704-555-0142', 'bo@x.test', '2026-11-17T15:00:00Z', 50, '2026-11-17T16:00:00Z')`,
  );
});
afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const get = (url: string) => worker.fetch(new Request(url), env, ctx);
const post = (url: string, fields: Record<string, string>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return worker.fetch(new Request(url, { method: "POST", body }), env, ctx);
};
const order = () => DB.prepare("SELECT * FROM work_orders WHERE id = 7").first<Record<string, unknown>>();
const take = () => logs.splice(0).join("\n");
const notes = () => rentec.splice(0).filter((r) => r.url === "https://rentec.test/work_orders/555/notes").map((r) => JSON.parse(r.body).note as string);

describe("technician page", () => {
  it("opens from the signed link with the tenant's first name and phone, no login", async () => {
    const res = await get(await techLink(env, 7, 50));
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Garbage disposal not working");
    expect(page).toContain("Bo · ");
    expect(page).toContain('href="tel:704-555-0142"');
    expect(page).toContain("On my way");
    expect(page).toContain("adult 18 or older");
  });

  it("stops working once the work order goes to another vendor", async () => {
    expect((await get(await techLink(env, 7, 1))).status).toBe(404);
    expect((await get("https://x.test/tech/7/forged")).status).toBe(404);
  });

  it("sends On my way to the tenant by email when they don't have the app", async () => {
    const res = await post(await techLink(env, 7, 50), { action: "on_my_way", eta: "15", tech_name: "Marcelo" });
    expect(res.status).toBe(303);
    const out = take();
    expect(out).toContain("EMAIL to bo@x.test: Marcelo (Ace Plumbing) is on the way");
    expect(out).toContain("about 15 minutes");
    expect(out).not.toContain("ace@x.test"); // the tech isn't emailed about their own message
  });

  it("suggests a visit time, noted privately in Rentec", async () => {
    await DB.prepare("INSERT INTO push_devices (token, tenant_id, platform, created_at, last_seen) VALUES ('tok', 't1', 'android', 'x', 'x')").run();
    const res = await post(await techLink(env, 7, 50), { action: "propose", day: "2026-11-18", start: "09:00" });
    expect(res.status).toBe(303);
    expect(await order()).toMatchObject({ visit_day: "2026-11-18", visit_start: "09:00", visit_status: "proposed", visit_by: "tech" });
    const out = take();
    expect(out).toContain("PUSH to t1 (1 phone): New visit time suggested | Wednesday, Nov 18, 9am to 11am at 88 Birch Ct.");
    expect(out).not.toContain("EMAIL to bo@x.test"); // pushed, so no email
    expect(notes()).toEqual(["Home Care: Ace Plumbing suggested a visit for Wednesday, Nov 18, 9am to 11am. Waiting for the other side to confirm. An adult 18+ must be home."]);
  });

  it("refuses weekend, holiday and after-hours times", async () => {
    for (const [day, start] of [["2026-11-21", "09:00"], ["2026-11-26", "09:00"], ["2026-11-18", "16:00"]]) {
      const res = await post(await techLink(env, 7, 50), { action: "propose", day: day!, start: start! });
      expect(decodeURIComponent(res.headers.get("location")!)).toMatch(/error=/);
    }
    expect((await order())!.visit_day).toBe("2026-11-18");
  });
});

describe("tenant side", () => {
  it("shows the suggested time with a one-tap confirm", async () => {
    const page = await (await get(`${await homeLink(env.APP_URL, env.LINK_SECRET, "t1")}/wo/7`)).text();
    expect(page).toContain("Wednesday, Nov 18, 9am to 11am");
    expect(page).toContain("Works for me");
    expect(page).toContain("Marcelo (Ace Plumbing)");
    expect(page).not.toContain("704-555-0199"); // the tech's number stays private
  });

  it("confirms the time: the tech gets an email and Rentec a private note", async () => {
    take();
    const res = await post(`${await homeLink(env.APP_URL, env.LINK_SECRET, "t1")}/wo/7`, { action: "confirm" });
    expect(res.status).toBe(303);
    expect(await order()).toMatchObject({ visit_status: "confirmed", visit_by: "tenant" });
    const out = take();
    expect(out).toContain("EMAIL to ace@x.test: Work order #7 at 88 Birch Ct: Visit time set: Wednesday, Nov 18, 9am to 11am");
    expect(out).toContain("https://x.test/tech/7/");
    expect(notes()).toEqual(["Home Care: visit set for Wednesday, Nov 18, 9am to 11am (confirmed by the tenant). An adult 18+ must be home."]);
  });

  it("emails the tech once for messages sent close together", async () => {
    const url = `${await homeLink(env.APP_URL, env.LINK_SECRET, "t1")}/wo/7`;
    await post(url, { action: "text", body: "The gate code is 1234." });
    await post(url, { action: "text", body: "And the dog will be crated." });
    expect(take().match(/EMAIL to ace@x\.test/g)).toHaveLength(1);
    // Once the tech has opened the page, the next message emails again.
    await get(await techLink(env, 7, 50));
    await post(url, { action: "text", body: "Thanks!" });
    expect(take().match(/EMAIL to ace@x\.test/g)).toHaveLength(1);
  });

  it("lists the work order on the home page with a new-message mark", async () => {
    await post(await techLink(env, 7, 50), { action: "text", body: "See you then." });
    const home = await (await get(`${await homeLink(env.APP_URL, env.LINK_SECRET, "t1")}/`)).text();
    expect(home).toContain("Your work orders");
    expect(home).toContain("Visit: Wednesday, Nov 18, 9am to 11am");
    expect(home).toContain("New message");
  });

  it("can't open another tenant's work order", async () => {
    expect((await get(`${await homeLink(env.APP_URL, env.LINK_SECRET, "t2")}/wo/7`)).status).toBe(404);
  });
});

describe("office", () => {
  it("sees the chat and the tech link on the admin page, and can answer", async () => {
    const page = await (await get("https://x.test/admin/workorders/7?token=adm")).text();
    expect(page).toContain("Tenant and technician");
    expect(page).toContain("The gate code is 1234.");
    expect(page).toContain(await techLink(env, 7, 50));
    take();
    const res = await worker.fetch(
      new Request("https://x.test/admin/workorders/7/messages?token=adm", { method: "POST", body: new URLSearchParams({ action: "text", body: "Bill this one to the owner." }) }),
      env,
      ctx,
    );
    expect(res.status).toBe(303);
    const out = take();
    expect(out).toContain("PUSH to t1");
    expect(out).toContain("EMAIL to ace@x.test");
  });
});

describe("dispatch", () => {
  it("puts the tech link in the vendor email and text", () => {
    const wo = { id: 7, title: "Disposal", contact_phone: "704-555-0142", contact_email: "bo@x.test", description: "" } as never;
    const property = { id: "p1", name: "", address: "88 Birch Ct", fields: {} };
    const link = "https://x.test/tech/7/abc";
    expect(vendorEmailHtml(wo, property, { name: "Ace" } as never, "", { COMPANY_NAME: "F.I.R.M.", EMERGENCY_PHONE: "1" }, link)).toContain(`href="${link}"`);
    expect(vendorText(wo, property, null, "", { COMPANY_NAME: "F.I.R.M." }, link)).toContain(link);
  });

  it("tells the tenant an adult must be home when a time is set", () => {
    const n = tenantNotice({ side: "tech", name: "Ace", kind: "confirm", body: "", visit: { day: "2026-11-18", start: "09:00" } }, "88 Birch Ct");
    expect(n.body).toContain("adult 18 or older");
  });
});

describe("demo", () => {
  it("shows a sample chat on the demo home, and sends nothing", async () => {
    const base = await homeLink(env.APP_URL, env.LINK_SECRET, "demo");
    const home = await (await get(`${base}/`)).text();
    expect(home).toContain(`href="/t/demo/`);
    expect(home).toContain("Your work orders");
    const page = await (await get(`${base}/wo/demo`)).text();
    expect(page).toContain("Works for me");
    expect(page).toContain("See what the technician sees");
    expect(await (await post(`${base}/wo/demo`, { action: "confirm" })).text()).toContain("Demo: message not sent");
  });

  it("shows the technician's page with sample data", async () => {
    const page = await (await get("https://x.test/tech/demo")).text();
    expect(page).toContain("On my way");
    expect(page).toContain("Demo: the technician's page");
    expect(await (await post("https://x.test/tech/demo", { action: "on_my_way", eta: "15" })).text()).toContain("Demo: nothing sent");
  });
});
