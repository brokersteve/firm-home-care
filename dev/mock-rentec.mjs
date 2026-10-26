// A stand-in for the Rentec API so the app can be run locally without touching real data.
// Usage: node dev/mock-rentec.mjs  (listens on http://localhost:8788/api/v3)
import { createServer } from "node:http";

const properties = [
  {
    property_id: 101,
    address: "412 Maple Ave",
    city: "Springfield",
    state: "OR",
    zip: "97477",
    custom_fields: {
      "HC Filter 1 Size": "16x25x1",
      "HC Filter 1 Location": "Hallway ceiling return vent",
      "HC Filter 2 Size": "20x20x1",
      "HC Filter 2 Location": "Upstairs bedroom hallway",
      "HC Filter Months": "2",
      "HC Smoke Detectors": "4",
      "HC CO Detectors": "1",
      "HC Detector Battery": "9V",
      "HC Heat Type": "Gas furnace",
      "HC Water Heater": "Gas tank",
      "HC Breaker Panel": "Garage, left wall",
      "HC Water Shutoff": "Basement, left of water heater",
      "HC Gas Shutoff": "At meter, east side of house",
      "HC Disposal Wrench": "Taped inside the sink cabinet door",
      "HC Trash Day": "Tuesday, recycling every other week",
      "HC Utilities": "Electric: tenant pays; Water: owner pays",
    },
  },
  { property_id: 102, address: "88 Birch Ct", unit: "Unit 2", city: "Springfield", state: "OR", zip: "97477", custom_fields: {} },
];
const tenants = [
  { renter_id: 501, property_id: 101, first_name: "Ana", last_name: "Reyes", email: "ana@example.com", insurance_expiration: "2026-11-20" },
  { renter_id: 502, property_id: 102, first_name: "Bo", last_name: "Li", email: "bo@example.com" },
];
const leases = [
  { renter_id: 501, property_id: 101, start_date: "2026-07-26" },
  { renter_id: 502, property_id: 102, start_date: "2026-10-25" },
];
const posted = [];

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  let body = "";
  for await (const chunk of req) body += chunk;
  if (body) {
    const json = (req.headers["content-type"] ?? "").includes("json");
    posted.push({ method: req.method, path: url.pathname, body: json ? JSON.parse(body) : `${body.length} bytes (${req.headers["content-type"]?.split(";")[0]})` });
  }
  console.log(req.method, url.pathname + url.search, req.headers.authorization ?? "", body.slice(0, 300));
  const send = (data) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  const route = url.pathname.replace(/^\/api\/v3/, "");
  if (req.method === "GET" && route === "/properties") return send({ data: properties, next: false });
  if (req.method === "GET" && route === "/tenants") return send({ data: tenants, next: false });
  if (req.method === "GET" && route === "/leases") return send({ data: leases, next: false });
  if (req.method === "POST" && route === "/workorders") return send({ data: { id: 9000 + posted.length } });
  if (req.method === "POST" && route === "/messages") return send({ ok: true });
  if (req.method === "POST" && route === "/files") return send({ data: { id: 7000 + posted.length } });
  const put = route.match(/^\/properties\/(\d+)$/);
  if (req.method === "PUT" && put) {
    const p = properties.find((x) => String(x.property_id) === put[1]);
    if (!p) return res.writeHead(404).end();
    p.custom_fields = JSON.parse(body).custom_fields;
    return send({ data: p });
  }
  if (route === "/_posted") return send(posted);
  res.writeHead(404).end();
}).listen(8788, () => console.log("Mock Rentec on http://localhost:8788/api/v3"));
