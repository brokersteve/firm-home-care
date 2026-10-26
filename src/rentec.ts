import type { Env, Property, PropertyFields } from "./env";

/*
 * Rentec Direct Open API v3 client.
 *
 * The key's permissions are confirmed (Read: Properties, Tenants, Leases, Work Orders, Lookup;
 * Write: Work Orders, Messages), but Rentec's API reference is only visible to a logged-in account,
 * so the paths, auth header and field names below are our best reading and are confirmed against
 * the docs before the pilot. Everything Rentec-specific lives in this file, and the mappers accept
 * several likely spellings of each field so a rename is a one-line change.
 */

const PATHS = {
  properties: "/properties",
  tenants: "/tenants",
  leases: "/leases",
  workOrders: "/workorders",
  messages: "/messages",
  files: "/files",
};

export interface RentecTenant {
  id: string;
  propertyId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  insuranceExpires: string | null;
}

export interface RentecLease {
  tenantId: string;
  propertyId: string;
  start: string | null;
  end: string | null;
  moveOut: string | null;
}

type Json = Record<string, unknown>;

export class RentecClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    // Wrapped: Workers throws "Illegal invocation" when fetch is called as a method of another object.
    private readonly fetcher: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  static fromEnv(env: Env): RentecClient {
    return new RentecClient(env.RENTEC_BASE_URL, env.RENTEC_API_KEY);
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetcher(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Rentec ${method} ${path} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }

  /** Reads every page of a list endpoint. Handles a bare array or {data, next/page} envelopes. */
  /**
   * What Rentec actually returns: the field names on the first record of each list, with values hidden.
   * Shown on the admin "Check Rentec" page so the mappers below can be confirmed against the real API.
   */
  async describe(): Promise<{ name: string; ok: boolean; count: number; fields: string[]; error?: string }[]> {
    const out = [];
    for (const [name, path] of Object.entries({ Properties: PATHS.properties, Tenants: PATHS.tenants, Leases: PATHS.leases, "Work orders": PATHS.workOrders })) {
      try {
        const rows = await this.list(path);
        const keys = (row: Json, prefix = ""): string[] =>
          Object.entries(row).flatMap(([k, v]) =>
            v && typeof v === "object" && !Array.isArray(v) ? keys(v as Json, `${prefix}${k}.`) : [`${prefix}${k}`],
          );
        out.push({ name, ok: true, count: rows.length, fields: rows[0] ? keys(rows[0]) : [] });
      } catch (err) {
        out.push({ name, ok: false, count: 0, fields: [], error: String(err).slice(0, 300) });
      }
    }
    return out;
  }

  private async list(path: string): Promise<Json[]> {
    const rows: Json[] = [];
    for (let page = 1; page <= 100; page++) {
      const sep = path.includes("?") ? "&" : "?";
      const body = await this.request("GET", `${path}${sep}page=${page}`);
      const items = Array.isArray(body) ? body : (pick(body as Json, "data", "results", "items") as Json[] | undefined) ?? [];
      rows.push(...items);
      const hasMore = !Array.isArray(body) && Boolean(pick(body as Json, "next", "next_page", "has_more"));
      if (!hasMore || items.length === 0) break;
    }
    return rows;
  }

  async properties(): Promise<Property[]> {
    return (await this.list(PATHS.properties)).map(toProperty);
  }

  async tenants(): Promise<RentecTenant[]> {
    return (await this.list(PATHS.tenants)).map(toTenant);
  }

  async leases(): Promise<RentecLease[]> {
    return (await this.list(PATHS.leases)).map(toLease);
  }

  /** Files a work order on the tenant's property. Returns Rentec's work order ID. */
  async createWorkOrder(input: { propertyId: string; tenantId: string; title: string; description: string }): Promise<string> {
    const body = (await this.request("POST", PATHS.workOrders, {
      property_id: input.propertyId,
      renter_id: input.tenantId,
      title: input.title,
      description: input.description,
      source: "F.I.R.M. Home Care",
    })) as Json;
    return String(pick(body, "id", "work_order_id", "workorder_id") ?? pick(pick(body, "data") as Json ?? {}, "id") ?? "");
  }

  /** Saves "HC ..." custom fields on a property (needs Properties: Write on the key). */
  async updatePropertyFields(propertyId: string, fields: PropertyFields): Promise<void> {
    await this.request("PUT", `${PATHS.properties}/${encodeURIComponent(propertyId)}`, { custom_fields: fields });
  }

  /** Uploads a file (an inspection report) to a property's file library (needs Files: Write on the key). */
  async uploadPropertyFile(propertyId: string, filename: string, contentType: string, bytes: ArrayBuffer): Promise<void> {
    const form = new FormData();
    form.append("property_id", propertyId);
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    const res = await this.fetcher(`${this.baseUrl}${PATHS.files}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, Accept: "application/json" },
      body: form,
    });
    if (!res.ok) throw new Error(`Rentec file upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }

  /** Logs a copy of a reminder email to the tenant's message history in Rentec. */
  async logMessage(input: { tenantId: string; subject: string; body: string }): Promise<void> {
    await this.request("POST", PATHS.messages, {
      renter_id: input.tenantId,
      subject: input.subject,
      message: input.body,
    });
  }
}

function pick(obj: Json, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return undefined;
}

function str(obj: Json, ...keys: string[]): string {
  const value = pick(obj, ...keys);
  return value === undefined ? "" : String(value);
}

/** Rentec dates may come as "2026-10-26", "2026-10-26 00:00:00" or "10/26/2026". */
export function toDay(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.startsWith("0000")) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return null;
}

/** Keeps only the "HC ..." custom fields, whether Rentec sends them as an object or a list of {name, value}. */
export function customFields(raw: unknown): PropertyFields {
  const fields: PropertyFields = {};
  const add = (name: unknown, value: unknown) => {
    if (typeof name === "string" && /^HC /i.test(name.trim()) && value != null && String(value).trim()) {
      fields[`HC ${name.trim().slice(3).trim()}`] = String(value).trim();
    }
  };
  if (Array.isArray(raw)) {
    for (const f of raw as Json[]) add(pick(f, "name", "field_name", "label"), pick(f, "value", "field_value"));
  } else if (raw && typeof raw === "object") {
    for (const [name, value] of Object.entries(raw)) add(name, value);
  }
  return fields;
}

export function toProperty(row: Json): Property {
  const address = [
    str(row, "address", "address1", "street", "street_address"),
    str(row, "unit", "unit_number", "address2"),
    str(row, "city"),
    [str(row, "state"), str(row, "zip", "zipcode", "postal_code")].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(", ");
  return {
    id: str(row, "id", "property_id", "propertyID"),
    name: str(row, "name", "property_name", "title") || address,
    address,
    fields: customFields(pick(row, "custom_fields", "customFields", "custom_info")),
  };
}

export function toTenant(row: Json): RentecTenant {
  return {
    id: str(row, "id", "renter_id", "tenant_id", "renterID"),
    propertyId: str(row, "property_id", "propertyID", "property"),
    firstName: str(row, "first_name", "firstname", "firstName"),
    lastName: str(row, "last_name", "lastname", "lastName"),
    email: str(row, "email", "email_address", "emailAddress") || null,
    phone: str(row, "cell_phone", "mobile_phone", "phone", "phone_number", "cellPhone", "mobile") || null,
    insuranceExpires: toDay(pick(row, "insurance_expiration", "renters_insurance_expiration", "insurance_expires")),
  };
}

export function toLease(row: Json): RentecLease {
  return {
    tenantId: str(row, "renter_id", "tenant_id", "renterID"),
    propertyId: str(row, "property_id", "propertyID"),
    start: toDay(pick(row, "move_in", "move_in_date", "start_date", "lease_start")),
    end: toDay(pick(row, "end_date", "lease_end")),
    moveOut: toDay(pick(row, "move_out", "move_out_date")),
  };
}
