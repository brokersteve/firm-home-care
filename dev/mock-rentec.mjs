// A stand-in for the Rentec API (shapes from Rentec's openapi.yaml) so the app can be run locally without touching real data.
// Usage: node dev/mock-rentec.mjs  (listens on http://localhost:8788/api/v3)
import { createServer } from "node:http";

const properties = [
  { id: "property:101", property_id: 101, nickname: "", address: "412 Maple Ave", city: "Springfield", state: "OR", zip: "97477", archived: false },
  { id: "property:102", property_id: 102, nickname: "88 Birch Ct Unit 2", address: "88 Birch Ct Unit 2", city: "Springfield", state: "OR", zip: "97477", archived: false },
];
const stickyNotes = {
  101: `Lockbox code 2468.

[Home Care]
Filter 1 size: 16x25x1
Filter 1 location: Hallway ceiling return vent
Filter 2 size: 20x20x1
Filter 2 location: Upstairs bedroom hallway
Change filters every (months): 2
Smoke detectors: 4
CO detectors: 1
Main water shutoff: Basement, left of water heater
Gas shutoff: At meter, east side of house
Breaker panel: Garage, left wall
Heating: Gas furnace
Water heater: Gas tank
Disposal wrench kept at: Taped inside the sink cabinet door
Trash and recycling: Tuesday, recycling every other week
Utilities: Electric: tenant pays; Water: owner pays
[/Home Care]`,
  102: "",
};
const tenants = [
  { id: "renter:501", renter_id: 501, f_name: "Ana", l_name: "Reyes", email: "ana@example.com", phone: "", mphone: "", archived: false, properties: [{ property_id: 101, move_in: "2026-07-26", move_out: null }] },
  { id: "renter:502", renter_id: 502, f_name: "Bo", l_name: "Li", email: "bo@example.com", phone: "", mphone: "704-555-0142", archived: false, properties: [{ property_id: 102, move_in: "2026-10-25", move_out: null }] },
];
const leases = [
  { id: "lease:1", lease_id: 1, renter_id: 501, property_id: 101, move_in: "2026-07-26", lease_begin: "2026-07-26", lease_end: "2027-07-31" },
  { id: "lease:2", lease_id: 2, renter_id: 502, property_id: 102, move_in: "2026-10-25", lease_begin: "2026-10-25", lease_end: "2027-10-31" },
];
const posted = [];
const workOrders = [];
let nextWo = 9001;

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body = "";
  for await (const chunk of req) body += chunk;
  const json = (req.headers["content-type"] ?? "").includes("json");
  if (body) posted.push({ method: req.method, path: url.pathname, body: json ? JSON.parse(body) : `${body.length} bytes (${req.headers["content-type"]?.split(";")[0]})` });
  console.log(req.method, url.pathname + url.search, req.headers["x-api-key"] ? "key ok" : "NO KEY", body.slice(0, 300));
  const send = (data, status = 200) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  const list = (rows) => send({ summary: { records: rows.length, timestamp: new Date().toISOString() }, data: rows });
  if (!req.headers["x-api-key"]) return send({ error: "Unauthorized" }, 401);
  const route = url.pathname.replace(/^\/api\/v3/, "");
  if (req.method === "GET" && route === "/properties") return list(properties);
  if (req.method === "GET" && route === "/tenants") return list(tenants);
  if (req.method === "GET" && route === "/leases") return list(leases);
  if (req.method === "GET" && route === "/work_orders") return list(workOrders);
  const sticky = route.match(/^\/properties\/(\d+)\/sticky_note$/);
  if (sticky) {
    if (!(sticky[1] in stickyNotes)) return send({ error: "Property not found" }, 404);
    if (req.method === "PUT") stickyNotes[sticky[1]] = JSON.parse(body).sticky_note;
    return send({ summary: { records: 1 }, data: { property_id: Number(sticky[1]), sticky_note: stickyNotes[sticky[1]], id: `property:${sticky[1]}` } });
  }
  if (req.method === "POST" && route === "/work_orders") {
    const id = nextWo++;
    const wo = { id: `workorder:${id}`, workorder_id: id, status: "OpenU", ...JSON.parse(body) };
    workOrders.push(wo);
    return send({ summary: { records: 1 }, data: wo }, 201);
  }
  if (req.method === "POST" && /^\/work_orders\/\d+\/notes$/.test(route)) return send({ summary: { records: 1 }, data: { note_id: posted.length } }, 201);
  if (req.method === "POST" && route === "/messages") return send({ summary: { records: 1 }, data: { email_id: posted.length } }, 201);
  if (req.method === "POST" && route === "/files") return send({ success: true, file_id: 7000 + posted.length, filename: "upload" }, 201);
  if (route === "/_posted") return send(posted);
  // Play staff in Rentec: /_status?id=9001&status=OpenA (or Parts, Work, Closed).
  if (route === "/_status") {
    const wo = workOrders.find((w) => w.workorder_id === Number(url.searchParams.get("id")));
    if (wo) wo.status = url.searchParams.get("status");
    return send(wo ?? { error: "not found" }, wo ? 200 : 404);
  }
  if (route === "/_sticky") return send(stickyNotes);
  res.writeHead(404).end();
}).listen(8788, () => console.log("Mock Rentec on http://localhost:8788/api/v3"));
