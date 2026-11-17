// @ts-nocheck: test-only, runs in Node (node:sqlite), not in the Worker types the app is checked against.
// A small stand-in for Cloudflare D1 over Node's built-in SQLite, with the real migrations applied.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function memoryD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T) ?? null,
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }),
    run: async () => (db.prepare(sql).run(...(args as never[])), { success: true }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (list: { run: () => Promise<unknown> }[]) => Promise.all(list.map((s) => s.run())),
  } as unknown as D1Database;
}
