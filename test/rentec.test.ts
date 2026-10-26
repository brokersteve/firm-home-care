import { describe, expect, it } from "vitest";
import { RentecClient, readHomeCareBlock, toDay, toLease, toProperty, toTenant, writeHomeCareBlock } from "../src/rentec";
import { buildTenants, inPilot } from "../src/sync";

describe("Rentec mappers", () => {
  it("reads dates in the formats Rentec may use", () => {
    expect(toDay("2026-10-26 00:00:00")).toBe("2026-10-26");
    expect(toDay("3/7/2026")).toBe("2026-03-07");
    expect(toDay("0000-00-00")).toBeNull();
    expect(toDay(null)).toBeNull();
  });

  it("maps a property, preferring its nickname", () => {
    const row = { id: "property:12", property_id: 12, nickname: "Elm duplex B", address: "10 Elm St", city: "Salem", state: "OR", zip: "97301" };
    expect(toProperty(row)).toEqual({ id: "12", name: "Elm duplex B", address: "10 Elm St, Salem, OR 97301", fields: {} });
  });

  it("maps a tenant to the property they haven't moved out of, with their cell number", () => {
    const t = toTenant({
      id: "renter:7", renter_id: 7, f_name: "Ana", l_name: "Reyes", email: "ana@example.com", phone: "704-555-0100", mphone: "704-555-0142",
      properties: [
        { property_id: 3, move_in: "2023-01-01", move_out: "2024-12-31" },
        { property_id: 12, move_in: "2025-01-15", move_out: "0000-00-00" },
      ],
    });
    expect(t).toEqual({ id: "7", propertyId: "12", firstName: "Ana", lastName: "Reyes", email: "ana@example.com", phone: "704-555-0142" });
    expect(toTenant({ renter_id: 8, phone: "704-555-0100", properties: [] }).phone).toBe("704-555-0100");
  });

  it("joins tenants to their latest lease and keeps only pilot properties", () => {
    const tenants = [
      toTenant({ renter_id: 1, f_name: "Ana", l_name: "Reyes", email: "ana@example.com", properties: [{ property_id: 12, move_in: "2025-02-01" }] }),
      toTenant({ renter_id: 2, f_name: "Bo", l_name: "Li", email: "bo@example.com", properties: [{ property_id: 99 }] }),
      toTenant({ renter_id: 3, f_name: "Cy", l_name: "Oz", email: "", properties: [] }),
    ];
    const leases = [
      toLease({ renter_id: 1, property_id: 12, move_in: "2024-01-01", move_out: "2025-01-01" }),
      toLease({ renter_id: 1, property_id: 12, move_in: "2025-02-01", lease_begin: "2025-02-01", lease_end: "2026-01-31" }),
      toLease({ renter_id: 2, property_id: 99, move_in: "2025-02-01" }),
      toLease({ renter_id: 3, property_id: 12, lease_begin: "2023-01-01", move_out: "2026-06-30" }),
    ];
    const rows = buildTenants(tenants, leases, new Set(["12"]), "2026-10-26");
    expect(rows.map((r) => [r.id, r.move_in, r.active, r.email, r.insurance_expires])).toEqual([
      ["1", "2025-02-01", 1, "ana@example.com", null],
      ["3", "2023-01-01", 0, null, null],
    ]);
  });
});

describe("home details in the sticky note", () => {
  it("adds a Home Care block after the office's own notes, and reads it back", () => {
    const note = writeHomeCareBlock("Gate code 4411. Owner prefers ABC Plumbing.", {
      "HC Filter 1 Size": "16x25x1",
      "HC Water Shutoff": "Crawl space,\nleft of water heater",
      "HC Gas Shutoff": " ",
    });
    expect(note).toBe(
      "Gate code 4411. Owner prefers ABC Plumbing.\n\n[Home Care]\nFilter 1 size: 16x25x1\nMain water shutoff: Crawl space, left of water heater\n[/Home Care]",
    );
    expect(readHomeCareBlock(note)).toEqual({ "HC Filter 1 Size": "16x25x1", "HC Water Shutoff": "Crawl space, left of water heater" });
  });

  it("replaces only the block, keeping text before and after it", () => {
    const old = "Before\n\n[Home Care]\nFilter 1 size: 14x20x1\nRoof: new\n[/Home Care]\n\nAfter";
    expect(writeHomeCareBlock(old, { "HC Filter 1 Size": "20x20x1" })).toBe("Before\n\n[Home Care]\nFilter 1 size: 20x20x1\n[/Home Care]\n\nAfter");
    expect(writeHomeCareBlock(old, {})).toBe("Before\n\nAfter");
    expect(readHomeCareBlock("Just a note")).toEqual({});
  });
});

describe("RentecClient", () => {
  const client = (handler: (url: string, init: RequestInit) => unknown, calls: string[] = []) =>
    new RentecClient("https://rentec.test/api/v3", "secret", (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url} ${(init.headers as Record<string, string>)["X-API-Key"]}`);
      return Response.json(handler(url, init), { status: init.method === "POST" ? 201 : 200 });
    }) as unknown as typeof fetch);

  it("sends the API key, reads the data envelope and follows next_page_url", async () => {
    const calls: string[] = [];
    const c = client(
      (url) =>
        url.includes("page=2")
          ? { summary: { records: 1, more_records: false }, data: [{ property_id: 2, address: "2 B St" }] }
          : { summary: { records: 2, more_records: true, next_page_url: "https://rentec.test/api/v3/properties?page=2" }, data: [{ property_id: 1, address: "1 A St" }, { property_id: 3, archived: true }] },
      calls,
    );
    expect((await c.properties()).map((p) => p.id)).toEqual(["1", "2"]);
    expect(calls).toEqual(["GET https://rentec.test/api/v3/properties secret", "GET https://rentec.test/api/v3/properties?page=2 secret"]);
  });

  it("files a work order and returns its id, including for a duplicate", async () => {
    let sent: Record<string, unknown> = {};
    const c = client((_url, init) => {
      sent = JSON.parse(String(init.body));
      return { summary: { records: 1 }, data: { id: "workorder:555", workorder_id: 555 } };
    });
    expect(await c.createWorkOrder({ propertyId: "12", tenantId: "1", title: "Toilet", description: "Tried plunging" })).toBe("555");
    expect(sent).toMatchObject({ property_id: 12, renter_id: 1, contact_renter_id: 1, short_desc: "Toilet", description: "Tried plunging", status: "OpenU", tenant_view: true });
    expect(await client(() => ({ workorder_id: 556, duplicate: true })).createWorkOrder({ propertyId: "12", tenantId: "1", title: "T", description: "" })).toBe("556");
  });

  it("saves home details into the sticky note without losing the office's text", async () => {
    const calls: string[] = [];
    let put: Record<string, unknown> = {};
    const c = client((url, init) => {
      if (init.method === "PUT") put = JSON.parse(String(init.body));
      return { data: { property_id: 12, sticky_note: "Lockbox 1234" } };
    }, calls);
    await c.saveHomeDetails("12", { "HC Breaker Panel": "Garage" });
    expect(calls.map((x) => x.split(" ").slice(0, 2).join(" "))).toEqual([
      "GET https://rentec.test/api/v3/properties/12/sticky_note",
      "PUT https://rentec.test/api/v3/properties/12/sticky_note",
    ]);
    expect(put).toEqual({ sticky_note: "Lockbox 1234\n\n[Home Care]\nBreaker panel: Garage\n[/Home Care]" });
  });

  it("logs messages with body and direction OUT", async () => {
    let sent: Record<string, unknown> = {};
    await client((_u, init) => ((sent = JSON.parse(String(init.body))), { data: {} })).logMessage({ tenantId: "7", subject: "S", body: "B" });
    expect(sent).toEqual({ renter_id: 7, subject: "S", body: "B", direction: "OUT" });
  });
});

describe("pilot homes by address", () => {
  const home = (address: string) => ({ id: "1", name: address, address, fields: {} });
  const env = { PILOT_PROPERTY_IDS: "", PILOT_ADDRESSES: "619 Flynwood Pl; 12474 Stone Garden; 5405 Hilltop" };

  it("matches on house number and street, whatever the suffix or city", () => {
    expect(inPilot(env, home("619 Flynwood Place, Charlotte, NC 28213"))).toBe(true);
    expect(inPilot(env, home("12474 Stonegarden Dr"))).toBe(true);
    expect(inPilot(env, home("5405 Hilltop Rd Unit B"))).toBe(true);
  });

  it("leaves out other homes, including the same number on another street", () => {
    expect(inPilot(env, home("619 Oakwood Pl"))).toBe(false);
    expect(inPilot(env, home("6190 Flynwood Pl"))).toBe(false);
  });

  it("includes every home when no pilot list is set", () => {
    expect(inPilot({ PILOT_PROPERTY_IDS: "", PILOT_ADDRESSES: "" }, home("1 Any St"))).toBe(true);
  });
});
