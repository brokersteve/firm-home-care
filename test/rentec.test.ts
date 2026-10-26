import { describe, expect, it } from "vitest";
import { RentecClient, customFields, toDay, toLease, toProperty, toTenant } from "../src/rentec";
import { buildTenants } from "../src/sync";

describe("Rentec mappers", () => {
  it("reads dates in the formats Rentec may use", () => {
    expect(toDay("2026-10-26 00:00:00")).toBe("2026-10-26");
    expect(toDay("3/7/2026")).toBe("2026-03-07");
    expect(toDay("0000-00-00")).toBeNull();
    expect(toDay(null)).toBeNull();
  });

  it("keeps only HC custom fields, from an object or a list", () => {
    expect(customFields({ "HC Filter Size": "16x25x1", "Roof age": "5", "HC Trash Day": " " })).toEqual({ "HC Filter Size": "16x25x1" });
    expect(customFields([{ name: "hc  Water Shutoff", value: "Basement" }])).toEqual({ "HC Water Shutoff": "Basement" });
  });

  it("maps a property", () => {
    const p = toProperty({ property_id: 12, address: "10 Elm St", unit: "B", city: "Salem", state: "OR", zip: "97301", custom_fields: { "HC Filter Size": "20x20x1" } });
    expect(p).toEqual({ id: "12", name: "10 Elm St, B, Salem, OR 97301", address: "10 Elm St, B, Salem, OR 97301", fields: { "HC Filter Size": "20x20x1" } });
  });

  it("joins tenants to their latest lease and keeps only pilot properties", () => {
    const tenants = [
      toTenant({ renter_id: 1, property_id: 12, first_name: "Ana", last_name: "Reyes", email: "ana@example.com" }),
      toTenant({ renter_id: 2, property_id: 99, first_name: "Bo", last_name: "Li", email: "bo@example.com" }),
      toTenant({ renter_id: 3, property_id: 12, first_name: "Cy", last_name: "Oz", email: "" }),
    ];
    const leases = [
      toLease({ renter_id: 1, property_id: 12, start_date: "2024-01-01", move_out: "2025-01-01" }),
      toLease({ renter_id: 1, property_id: 12, start_date: "2025-02-01" }),
      toLease({ renter_id: 2, property_id: 99, start_date: "2025-02-01" }),
      toLease({ renter_id: 3, property_id: 12, start_date: "2023-01-01", move_out: "2026-06-30" }),
    ];
    const rows = buildTenants(tenants, leases, new Set(["12"]), "2026-10-26");
    expect(rows.map((r) => [r.id, r.move_in, r.active, r.email])).toEqual([
      ["1", "2025-02-01", 1, "ana@example.com"],
      ["3", "2023-01-01", 0, null],
    ]);
  });
});

describe("RentecClient", () => {
  it("follows pages and sends the API key", async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push(`${url} ${(init.headers as Record<string, string>).Authorization}`);
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json(page === 1 ? { data: [{ id: 1 }], next: true } : { data: [{ id: 2 }], next: false });
    }) as unknown as typeof fetch;
    const client = new RentecClient("https://rentec.test/api/v3", "secret", fake);
    expect((await client.properties()).map((p) => p.id)).toEqual(["1", "2"]);
    expect(calls).toEqual(["https://rentec.test/api/v3/properties?page=1 Bearer secret", "https://rentec.test/api/v3/properties?page=2 Bearer secret"]);
  });

  it("files a work order and returns its id", async () => {
    let sent: unknown;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return Response.json({ data: { id: 555 } });
    }) as unknown as typeof fetch;
    const client = new RentecClient("https://rentec.test/api/v3", "k", fake);
    expect(await client.createWorkOrder({ propertyId: "12", tenantId: "1", title: "Toilet", description: "Tried plunging" })).toBe("555");
    expect(sent).toMatchObject({ property_id: "12", renter_id: "1", title: "Toilet" });
  });
});
