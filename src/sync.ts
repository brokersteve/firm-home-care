import type { Env, Property, Tenant } from "./env";
import { RentecClient, type RentecLease, type RentecTenant } from "./rentec";

export function pilotIds(env: Pick<Env, "PILOT_PROPERTY_IDS">): Set<string> | null {
  const ids = env.PILOT_PROPERTY_IDS.split(",").map((s) => s.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
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
    const pilot = pilotIds(env);
    const properties: Property[] = (await client.properties()).filter((p) => p.id && (!pilot || pilot.has(p.id)));
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
          `INSERT INTO tenants (id, property_id, first_name, last_name, email, move_in, move_out, insurance_expires, active, synced_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET property_id = excluded.property_id, first_name = excluded.first_name,
             last_name = excluded.last_name, email = excluded.email, move_in = excluded.move_in, move_out = excluded.move_out,
             insurance_expires = excluded.insurance_expires, active = excluded.active, synced_at = excluded.synced_at`,
        ).bind(t.id, t.property_id, t.first_name, t.last_name, t.email, t.move_in, t.move_out, t.insurance_expires, t.active, now),
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
