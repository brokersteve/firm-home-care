import type { Env, Property, Tenant } from "./env";

interface PropertyRow {
  id: string;
  name: string;
  address: string;
  fields: string;
}

function toProperty(row: PropertyRow): Property {
  return { id: row.id, name: row.name, address: row.address, fields: JSON.parse(row.fields) };
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
