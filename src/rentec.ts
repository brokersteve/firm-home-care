import type { Env, Property, PropertyFields } from "./env";
import { FIELDS } from "./fields";

/*
 * Rentec Direct Open API v3 client, written against Rentec's published openapi.yaml.
 * Auth is an X-API-Key header; replies come as {summary, data}.
 *
 * The key needs Read: Properties, Tenants, Leases, Work Orders; Write: Properties (sticky notes),
 * Work Orders, Messages, Files. Everything Rentec-specific lives in this file.
 *
 * The API can't read or write property custom fields, so home details live in a marked block of
 * the property's sticky note (see HOME_CARE_START). Text outside the block is left alone.
 */

const PATHS = {
  properties: "/properties",
  tenants: "/tenants",
  leases: "/leases",
  workOrders: "/work_orders",
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
}

export interface RentecWorkOrder {
  id: string;
  /** OpenU, OpenA, Parts, Work, Finalized or Closed. */
  status: string;
  resolved: string | null;
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

  private async send(method: string, url: string, body?: unknown): Promise<Json> {
    const form = body instanceof FormData;
    const res = await this.fetcher(url.startsWith("http") ? url : `${this.baseUrl}${url}`, {
      method,
      headers: {
        "X-API-Key": this.apiKey,
        Accept: "application/json",
        ...(body && !form ? { "Content-Type": "application/json" } : {}),
      },
      body: form ? body : body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Rentec ${method} ${url.replace(/^https?:\/\/[^/]+/, "")} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return (await res.json()) as Json;
  }

  /** A list endpoint's rows. Follows summary.next_page_url when Rentec pages the reply. */
  private async list(path: string): Promise<Json[]> {
    const rows: Json[] = [];
    let url: string | null = path;
    for (let page = 0; url && page < 100; page++) {
      const body: Json = await this.send("GET", url);
      rows.push(...((Array.isArray(body.data) ? body.data : []) as Json[]));
      const summary = (body.summary ?? {}) as Json;
      url = summary.more_records && typeof summary.next_page_url === "string" ? summary.next_page_url : null;
    }
    return rows;
  }

  /**
   * What Rentec actually returns: the field names on the first record of each list, with values hidden.
   * Shown on the admin "Check Rentec" page.
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

  /** Active properties. Home details aren't included: read them per property with homeDetails(). */
  async properties(): Promise<Property[]> {
    return (await this.list(PATHS.properties)).filter((p) => !p.archived).map(toProperty);
  }

  async tenants(): Promise<RentecTenant[]> {
    return (await this.list(PATHS.tenants)).filter((t) => !t.archived).map(toTenant);
  }

  async leases(): Promise<RentecLease[]> {
    return (await this.list(PATHS.leases)).map(toLease);
  }

  private async stickyNote(propertyId: string): Promise<string> {
    const body = await this.send("GET", `${PATHS.properties}/${encodeURIComponent(propertyId)}/sticky_note`);
    return String(((body.data ?? {}) as Json).sticky_note ?? "");
  }

  /** The home details kept in the property's sticky note. */
  async homeDetails(propertyId: string): Promise<PropertyFields> {
    return readHomeCareBlock(await this.stickyNote(propertyId));
  }

  /** Saves home details into the property's sticky note, keeping anything else written there. */
  async saveHomeDetails(propertyId: string, fields: PropertyFields): Promise<void> {
    const note = writeHomeCareBlock(await this.stickyNote(propertyId), fields);
    await this.send("PUT", `${PATHS.properties}/${encodeURIComponent(propertyId)}/sticky_note`, { sticky_note: note });
  }

  /** Files an unassigned work order on the tenant's property. Returns Rentec's work order ID. */
  async createWorkOrder(input: { propertyId: string; tenantId: string; title: string; description: string; priority?: number; privateNotes?: string }): Promise<string> {
    const body = await this.send("POST", PATHS.workOrders, {
      property_id: Number(input.propertyId),
      renter_id: Number(input.tenantId),
      contact_renter_id: Number(input.tenantId),
      short_desc: input.title.slice(0, 100),
      description: input.description,
      status: "OpenU",
      ...(input.priority ? { priority: input.priority } : {}),
      // Triage (urgency, who-pays flags) is for staff only: the description is shown to the tenant.
      ...(input.privateNotes ? { private_notes: input.privateNotes } : {}),
      date_received: new Date().toISOString().slice(0, 10),
      tenant_view: true,
      email_manager: true,
    });
    // 201 wraps the work order in data; a 200 duplicate returns it bare.
    const wo = (body.data ?? body) as Json;
    return String(wo.workorder_id ?? "");
  }

  /** Work orders received in the last `days` days, with their status, for the tracker's status updates. */
  async workOrders(days = 90): Promise<RentecWorkOrder[]> {
    return (await this.list(`${PATHS.workOrders}?age=${days}d`)).map((w) => ({
      id: str(w, "workorder_id"),
      status: str(w, "status"),
      resolved: toDay(w.date_resolved),
    }));
  }

  /** Adds a note to a work order. Private notes are hidden from the tenant. */
  async addWorkOrderNote(workOrderId: string, note: string, isPrivate = true): Promise<void> {
    await this.send("POST", `${PATHS.workOrders}/${encodeURIComponent(workOrderId)}/notes`, { note, private: isPrivate });
  }

  /** Uploads a file to Rentec, attached to a property or a work order. */
  async uploadFile(to: { propertyId?: string; workOrderId?: string }, filename: string, contentType: string, bytes: ArrayBuffer): Promise<void> {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: contentType }), filename);
    if (to.propertyId) form.append("property_id", to.propertyId);
    if (to.workOrderId) form.append("workorder_id", to.workOrderId);
    await this.send("POST", PATHS.files, form);
  }

  /** Uploads a file (an inspection report) to a property's file library. */
  async uploadPropertyFile(propertyId: string, filename: string, contentType: string, bytes: ArrayBuffer): Promise<void> {
    await this.uploadFile({ propertyId }, filename, contentType, bytes);
  }

  /** Logs a copy of a reminder email to the tenant's message history in Rentec. */
  async logMessage(input: { tenantId: string; subject: string; body: string }): Promise<void> {
    await this.send("POST", PATHS.messages, {
      renter_id: Number(input.tenantId),
      subject: input.subject,
      body: input.body,
      direction: "OUT",
    });
  }
}

export const HOME_CARE_START = "[Home Care]";
export const HOME_CARE_END = "[/Home Care]";
const BY_LABEL = new Map(FIELDS.map((f) => [f.label.toLowerCase(), f.name]));

/** Reads the "Label: value" lines between [Home Care] and [/Home Care] in a sticky note. */
export function readHomeCareBlock(note: string): PropertyFields {
  const start = note.indexOf(HOME_CARE_START);
  const end = note.indexOf(HOME_CARE_END, start);
  if (start < 0) return {};
  const block = note.slice(start + HOME_CARE_START.length, end < 0 ? undefined : end);
  const fields: PropertyFields = {};
  for (const line of block.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = BY_LABEL.get(line.slice(0, colon).trim().toLowerCase());
    const value = line.slice(colon + 1).trim();
    if (name && value) fields[name] = value;
  }
  return fields;
}

/** Replaces (or adds, at the end) the Home Care block in a sticky note. Other text is kept as is. */
export function writeHomeCareBlock(note: string, fields: PropertyFields): string {
  const lines = FIELDS.filter((f) => fields[f.name]?.trim()).map((f) => `${f.label}: ${fields[f.name]!.replace(/\s*\r?\n\s*/g, " ").trim()}`);
  const block = lines.length ? [HOME_CARE_START, ...lines, HOME_CARE_END].join("\n") : "";
  const start = note.indexOf(HOME_CARE_START);
  if (start < 0) return [note.trimEnd(), block].filter(Boolean).join("\n\n");
  const endAt = note.indexOf(HOME_CARE_END, start);
  const before = note.slice(0, start).trimEnd();
  const after = endAt < 0 ? "" : note.slice(endAt + HOME_CARE_END.length).trimStart();
  return [before, block, after].filter(Boolean).join("\n\n");
}

function str(obj: Json, ...keys: string[]): string {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

/** Rentec dates come as "2026-10-26" or "2026-10-26 00:00:00"; "0000-00-00" means none. */
export function toDay(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.startsWith("0000")) return null;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[3]}-${us[1]!.padStart(2, "0")}-${us[2]!.padStart(2, "0")}`;
  return null;
}

export function toProperty(row: Json): Property {
  const address = [str(row, "address"), str(row, "city"), [str(row, "state"), str(row, "zip")].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return { id: str(row, "property_id"), name: str(row, "nickname") || address, address, fields: {} };
}

export function toTenant(row: Json): RentecTenant {
  // A tenant can be linked to several properties over time: use the one they haven't moved out of, else the latest.
  const homes = (Array.isArray(row.properties) ? row.properties : []) as Json[];
  const current =
    homes.find((h) => !toDay(h.move_out)) ??
    [...homes].sort((a, b) => (toDay(b.move_in) ?? "").localeCompare(toDay(a.move_in) ?? ""))[0];
  return {
    id: str(row, "renter_id"),
    propertyId: current ? str(current, "property_id") : "",
    firstName: str(row, "f_name"),
    lastName: str(row, "l_name"),
    email: str(row, "email") || null,
    phone: str(row, "mphone", "phone") || null,
  };
}

export function toLease(row: Json): RentecLease {
  return {
    tenantId: str(row, "renter_id"),
    propertyId: str(row, "property_id"),
    start: toDay(row.move_in) ?? toDay(row.lease_begin),
    end: toDay(row.lease_end),
    moveOut: toDay(row.move_out),
  };
}
