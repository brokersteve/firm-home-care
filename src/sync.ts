import type { Env, Property, Tenant } from "./env";
import { RentecClient, type RentecLease, type RentecTenant } from "./rentec";

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/**
 * True when a property has the same house number and street name as a short address like "619 Flynwood Pl".
 * Street suffixes and city are ignored, and "Stone Garden" also matches "Stonegarden".
 */
export function sameAddress(address: string, p: Pick<Property, "address" | "name">): boolean {
  const [num, ...rest] = words(address);
  const street = rest.find((w) => !/^\d/.test(w));
  if (!num || !street) return false;
  const w = words(`${p.address} ${p.name}`);
  return w.includes(num) && w.join("").includes(street);
}

/** The pilot homes, as short addresses separated by ";" (PILOT_ADDRESSES). */
export function pilotAddresses(env: Pick<Env, "PILOT_ADDRESSES">): string[] {
  return (env.PILOT_ADDRESSES ?? "").split(";").map((s) => s.trim()).filter(Boolean);
}

/** Whether a property is in the pilot, by Rentec id or by address. With neither list set, every property is. */
export function inPilot(env: Pick<Env, "PILOT_PROPERTY_IDS" | "PILOT_ADDRESSES">, p: Property): boolean {
  const ids = env.PILOT_PROPERTY_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  const addresses = pilotAddresses(env);
  if (!ids.length && !addresses.length) return true;
  return ids.includes(p.id) || addresses.some((a) => sameAddress(a, p));
}

/** Joins Rentec tenants with their most recent lease. A tenant with no lease on file is left out. */
export function buildTenants(tenants: RentecTenant[], leases: RentecLease[], propertyIds: Set<string>, today: string): Tenant[] {
  const latest = new Map<string, RentecLease>();
  for (const lease of leases) {
    const current = latest.get(lease.tenantId);
    if (!current || (lease.start ?? "") > (current.start ?? "")) latest.set(lease.tenantId, lease);
  }
  const rows: Tenant[] = [];
  for (const t of tenants) {
    const lease = latest.get(t.id);
    const propertyId = t.propertyId || lease?.propertyId || "";
    if (!lease || !propertyIds.has(propertyId)) continue;
    const moveOut = lease.moveOut;
    rows.push({
      id: t.id,
      property_id: propertyId,
      first_name: t.firstName,
      last_name: t.lastName,
      email: t.email,
      phone: t.phone,
      move_in: lease.start,
      move_out: moveOut,
      insurance_expires: t.insuranceExpires,
      active: moveOut && moveOut <= today ? 0 : 1,
    });
  }
  return rows;
}

export interface SyncResult {
  properties: number;
  tenants: number;
}

/** Copies the pilot properties and their tenants from Rentec. Tenants who vanish from Rentec are marked inactive. */
export async function syncFromRentec(env: Env, today: string, client = RentecClient.fromEnv(env)): Promise<SyncResult> {
  const now = new Date().toISOString();
  const run = await env.DB.prepare("INSERT INTO sync_runs (started_at) VALUES (?) RETURNING id").bind(now).first<{ id: number }>();
  try {
    const properties: Property[] = (await client.properties()).filter((p) => p.id && inPilot(env, p));
    const ids = new Set(properties.map((p) => p.id));
    const tenants = buildTenants(await client.tenants(), await client.leases(), ids, today);

    const statements = [
      ...properties.map((p) =>
        env.DB.prepare(
          `INSERT INTO properties (id, name, address, fields, synced_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET name = excluded.name, address = excluded.address, fields = excluded.fields, synced_at = excluded.synced_at`,
        ).bind(p.id, p.name, p.address, JSON.stringify(p.fields), now),
      ),
      ...tenants.map((t) =>
        env.DB.prepare(
          `INSERT INTO tenants (id, property_id, first_name, last_name, email, phone, move_in, move_out, insurance_expires, active, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET property_id = excluded.property_id, first_name = excluded.first_name,
             last_name = excluded.last_name, email = excluded.email, phone = excluded.phone, move_in = excluded.move_in, move_out = excluded.move_out,
             insurance_expires = excluded.insurance_expires, active = excluded.active, synced_at = excluded.synced_at`,
        ).bind(t.id, t.property_id, t.first_name, t.last_name, t.email, t.phone, t.move_in, t.move_out, t.insurance_expires, t.active, now),
      ),
      // Anyone not seen in this sync has left Rentec's list: stop reminding them.
      env.DB.prepare("UPDATE tenants SET active = 0 WHERE synced_at < ?").bind(now),
      env.DB.prepare("UPDATE sync_runs SET finished_at = ?, properties = ?, tenants = ? WHERE id = ?").bind(
        new Date().toISOString(),
        properties.length,
        tenants.length,
        run!.id,
      ),
    ];
    await env.DB.batch(statements);
    return { properties: properties.length, tenants: tenants.length };
  } catch (err) {
    await env.DB.prepare("UPDATE sync_runs SET finished_at = ?, error = ? WHERE id = ?")
      .bind(new Date().toISOString(), String(err), run!.id)
      .run();
    throw err;
  }
}
