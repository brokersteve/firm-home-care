import type { Env, Property, Tenant } from "./env";
import { FIELDS } from "./fields";
import { RentecClient } from "./rentec";

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  fields: string;
  approval_limit?: number | null;
}

function toProperty(row: PropertyRow): Property {
  return { id: row.id, name: row.name, address: row.address, fields: JSON.parse(row.fields), approval_limit: row.approval_limit ?? null };
}

export async function getTenant(env: Env, id: string): Promise<Tenant | null> {
  return env.DB.prepare("SELECT * FROM tenants WHERE id = ?").bind(id).first<Tenant>();
}

export async function getProperty(env: Env, id: string): Promise<Property | null> {
  const row = await env.DB.prepare("SELECT * FROM properties WHERE id = ?").bind(id).first<PropertyRow>();
  return row ? toProperty(row) : null;
}

export async function listProperties(env: Env): Promise<Property[]> {
  const { results } = await env.DB.prepare("SELECT * FROM properties ORDER BY name").all<PropertyRow>();
  return results.map(toProperty);
}

export async function activeTenants(env: Env): Promise<Tenant[]> {
  const { results } = await env.DB.prepare("SELECT * FROM tenants WHERE active = 1").all<Tenant>();
  return results;
}

/** Saves the home details form: Rentec's sticky note first (the source of truth), then our copy. */
export async function saveHomeDetails(env: Env, property: Property, body: Record<string, unknown>, client = RentecClient.fromEnv(env)): Promise<Property> {
  const fields = { ...property.fields };
  for (const f of FIELDS) {
    const value = String(body[f.name] ?? "").trim().slice(0, 500);
    if (value) fields[f.name] = value;
    else delete fields[f.name];
  }
  await client.saveHomeDetails(property.id, fields);
  await env.DB.prepare("UPDATE properties SET fields = ? WHERE id = ?").bind(JSON.stringify(fields), property.id).run();
  return { ...property, fields };
}
