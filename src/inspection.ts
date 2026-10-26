import { Hono, type Context } from "hono";
import { html } from "hono/html";
import { homeDetailsPage } from "./admin";
import type { Env, Property, PropertyFields, Tenant } from "./env";
import {
  CONDITIONS,
  KIND_LABELS,
  buildRooms,
  roomDone,
  type InspectionKind,
  type InspectionRoom,
} from "./inspection-template";
import { layout } from "./pages";
import { SHRINK_PHOTOS_SCRIPT, savePhoto } from "./photos";
import { buildInspectionPdf } from "./report";
import { RentecClient } from "./rentec";
import { getProperty, listProperties, saveHomeDetails } from "./store";

export interface Inspection {
  id: string;
  property_id: string;
  tenant_id: string | null;
  kind: InspectionKind;
  done_by: "staff" | "tenant";
  status: "draft" | "complete";
  rooms: InspectionRoom[];
  signed_name: string | null;
  created_at: string;
  completed_at: string | null;
  report_key: string | null;
  uploaded_to_rentec: number;
  /** The home details saved during this inspection, for the report. */
  details: PropertyFields | null;
}

type Row = Omit<Inspection, "rooms" | "details"> & { rooms: string; details: string | null };
type Vars = { tenant?: Tenant; property?: Property; base?: string };
type C = Context<{ Bindings: Env; Variables: Vars }>;

async function load(env: Env, id: string): Promise<Inspection | null> {
  const row = await env.DB.prepare("SELECT * FROM inspections WHERE id = ?").bind(id).first<Row>();
  return row ? { ...row, rooms: JSON.parse(row.rooms), details: row.details ? JSON.parse(row.details) : null } : null;
}

async function saveRooms(env: Env, i: Inspection): Promise<void> {
  await env.DB.prepare("UPDATE inspections SET rooms = ? WHERE id = ?").bind(JSON.stringify(i.rooms), i.id).run();
}

/** Who is looking: staff (signed-in admin) or the tenant through their own link, and where their pages live. */
function scope(c: C) {
  const tenant = c.get("tenant");
  return tenant
    ? { who: "tenant" as const, tenant, root: `${c.get("base")}/inspection` }
    : { who: "staff" as const, tenant: null, root: "/admin/inspect" };
}

/** Staff can open any inspection; a tenant only their own move-in form. */
async function find(c: C): Promise<Inspection | null> {
  const insp = await load(c.env, c.req.param("iid") ?? "");
  const s = scope(c);
  if (!insp) return null;
  if (s.who === "tenant" && (insp.tenant_id !== s.tenant.id || insp.done_by !== "tenant")) return null;
  return insp;
}

const roomChoicesForm = (action: string, extra: unknown) => html`<form method="post" action="${action}" class="card">
${extra}
<label for="bedrooms">Bedrooms</label><input type="text" inputmode="numeric" id="bedrooms" name="bedrooms" value="3">
<label for="bathrooms">Bathrooms</label><input type="text" inputmode="numeric" id="bathrooms" name="bathrooms" value="2">
<label><input type="checkbox" name="dining" value="1"> Separate dining room</label>
<label><input type="checkbox" name="laundry" value="1" checked> Laundry area</label>
<label><input type="checkbox" name="garage" value="1"> Garage or storage room</label>
<button class="btn primary">Start</button></form>`;

async function create(env: Env, propertyId: string, kind: InspectionKind, doneBy: "staff" | "tenant", tenantId: string | null, body: Record<string, unknown>) {
  const id = crypto.randomUUID();
  const rooms = buildRooms({
    bedrooms: Number(body["bedrooms"]),
    bathrooms: Number(body["bathrooms"]),
    dining: body["dining"] === "1",
    laundry: body["laundry"] === "1",
    garage: body["garage"] === "1",
  });
  await env.DB.prepare(
    "INSERT INTO inspections (id, property_id, tenant_id, kind, done_by, rooms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(id, propertyId, tenantId, kind, doneBy, JSON.stringify(rooms), new Date().toISOString())
    .run();
  return id;
}

export const inspectionRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

// Staff: list and start inspections.
inspectionRoutes.get("/admin/inspect", async (c) => {
  const properties = await listProperties(c.env);
  const { results } = await c.env.DB.prepare(
    "SELECT i.id, i.kind, i.status, i.done_by, i.created_at, p.name FROM inspections i JOIN properties p ON p.id = i.property_id ORDER BY i.created_at DESC LIMIT 50",
  ).all<{ id: string; kind: InspectionKind; status: string; done_by: string; created_at: string; name: string }>();
  return c.html(
    layout(
      "Inspections",
      html`<h1>Inspections</h1>
<h2>Start an inspection</h2>
${roomChoicesForm(
  "/admin/inspect",
  html`<label for="property">Property</label><select id="property" name="property">${properties.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
<label for="kind">Type</label><select id="kind" name="kind">${(Object.keys(KIND_LABELS) as InspectionKind[]).map((k) => html`<option value="${k}">${KIND_LABELS[k]}</option>`)}</select>`,
)}
<div class="card"><h2>Recent</h2><table><tr><th>Property</th><th>Type</th><th>Status</th></tr>
${results.map(
  (r) => html`<tr><td><a href="/admin/inspect/${r.id}">${r.name}</a></td><td>${KIND_LABELS[r.kind]}${r.done_by === "tenant" ? " (tenant)" : ""}</td><td>${r.status === "complete" ? "Complete" : "In progress"}</td></tr>`,
)}</table></div>
<a class="quiet" href="/admin/">Back to admin</a>`,
    ),
  );
});

inspectionRoutes.post("/admin/inspect", async (c) => {
  const body = await c.req.parseBody();
  const property = await getProperty(c.env, String(body["property"] ?? ""));
  const kind = String(body["kind"]) as InspectionKind;
  if (!property || !(kind in KIND_LABELS)) return c.text("Pick a property and type", 400);
  const id = await create(c.env, property.id, kind, "staff", null, body);
  return c.redirect(`/admin/inspect/${id}`, 303);
});

// Tenant: their own move-in form, one per tenant.
inspectionRoutes.get("/t/:id/:sig/inspection", async (c) => {
  const tenant = c.get("tenant")!;
  const existing = await c.env.DB.prepare("SELECT id FROM inspections WHERE tenant_id = ? AND done_by = 'tenant' ORDER BY created_at DESC LIMIT 1")
    .bind(tenant.id)
    .first<{ id: string }>();
  if (existing) return c.redirect(`${c.get("base")}/inspection/${existing.id}`);
  return c.html(
    layout(
      "Move-in inspection",
      html`<h1>Move-in inspection</h1>
<p>Walk through each room and note anything damaged, dirty or not working, with a photo. This protects your security deposit: at move-out we compare against it. Your lease (1.9) asks for it within 10 days of move-in.</p>
${roomChoicesForm(`${c.get("base")}/inspection`, "")}`,
    ),
  );
});

inspectionRoutes.post("/t/:id/:sig/inspection", async (c) => {
  const tenant = c.get("tenant")!;
  const id = await create(c.env, tenant.property_id, "move_in", "tenant", tenant.id, await c.req.parseBody());
  return c.redirect(`${c.get("base")}/inspection/${id}`, 303);
});

// Both: overview, rooms, finish, report.
for (const prefix of ["/admin/inspect", "/t/:id/:sig/inspection"]) {
  inspectionRoutes.get(`${prefix}/:iid`, async (c) => {
    const insp = await find(c);
    if (!insp) return c.text("Inspection not found", 404);
    const property = await getProperty(c.env, insp.property_id);
    const s = scope(c);
    const root = `${s.root}/${insp.id}`;
    const done = insp.rooms.filter(roomDone).length;
    return c.html(
      layout(
        KIND_LABELS[insp.kind],
        html`<h1>${KIND_LABELS[insp.kind]}</h1><p class="quiet">${property?.address ?? ""}</p>
${insp.status === "complete"
  ? html`<div class="card note"><p>Completed ${insp.completed_at?.slice(0, 10)}${insp.signed_name ? ` by ${insp.signed_name}` : ""}.
${insp.uploaded_to_rentec ? " Saved to the property's files in Rentec." : ""}</p><a class="btn primary" href="${root}/report.pdf">Open the report (PDF)</a></div>`
  : html`<p>${done} of ${insp.rooms.length} rooms done.</p>`}
<div class="card">${insp.rooms.map(
  (r, i) => html`<a class="btn ${roomDone(r) ? "" : "primary"}" href="${root}/room/${i}">${roomDone(r) ? "✓ " : ""}${r.name}</a>`,
)}</div>
${s.who === "staff"
  ? html`<div class="card"><h2>Home details</h2><p class="quiet">Filters, shutoffs, breaker panel, trash day. Saved to the property in Rentec and shown on the tenant's Home Care page.</p>
${insp.status === "draft" ? html`<a class="btn ${insp.details ? "" : "primary"}" href="${root}/details">${insp.details ? "✓ Home details saved" : "Fill in home details"}</a>` : ""}</div>`
  : ""}
${insp.status === "draft"
  ? html`<form method="post" action="${root}/finish" class="card"><h2>Finish</h2>
<p class="quiet">${done < insp.rooms.length ? "Some rooms aren't finished. You can still submit; unrated items show as blank." : "All rooms are done."}</p>
<label for="signed">Your full name</label><input type="text" id="signed" name="signed" required>
<label><input type="checkbox" name="confirm" value="1" required> I confirm this report is accurate</label>
<button class="btn primary">Finish and save the report</button></form>`
  : ""}
<a class="quiet" href="${s.who === "staff" ? "/admin/inspect" : `${c.get("base")}/`}">Back</a>`,
      ),
    );
  });

  inspectionRoutes.get(`${prefix}/:iid/room/:room`, async (c) => {
    const insp = await find(c);
    const r = Number(c.req.param("room"));
    const room = insp?.rooms[r];
    if (!insp || !room) return c.text("Room not found", 404);
    const root = `${scope(c).root}/${insp.id}`;
    const locked = insp.status === "complete";
    return c.html(
      layout(
        room.name,
        html`<h1>${room.name}</h1><p class="quiet">Room ${r + 1} of ${insp.rooms.length}. Tap a condition for each item. Add a note and photo for anything Fair or Poor.</p>
<form method="post" action="${root}/room/${r}" enctype="multipart/form-data">
${room.items.map(
  (item, i) => html`<fieldset class="card" style="border:1px solid var(--line)"><legend><strong>${item.name}</strong></legend>
<div style="display:flex;gap:6px;flex-wrap:wrap">${CONDITIONS.map(
  (cond) => html`<label style="flex:1;min-width:64px;margin:0;font-weight:400;border:1px solid var(--line);border-radius:8px;padding:10px 6px;text-align:center">
<input type="radio" name="c${i}" value="${cond}" ${item.condition === cond ? "checked" : ""} ${locked ? "disabled" : ""}> ${cond}</label>`,
)}</div>
<label for="n${i}">Note <small>optional</small></label><input type="text" id="n${i}" name="n${i}" value="${item.note}" ${locked ? "disabled" : ""}>
${item.photos.length ? html`<p>${item.photos.map((p) => html`<a href="${p}" target="_blank"><img src="${p}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:6px;margin:4px 4px 0 0"></a>`)}</p>` : ""}
${locked ? "" : html`<label for="p${i}">Add photos <small>optional</small></label><input type="file" id="p${i}" name="p${i}" accept="image/*" multiple>`}
</fieldset>`,
)}
${locked ? "" : html`<button class="btn primary">Save ${r + 1 < insp.rooms.length ? "and go to next room" : "and finish"}</button>`}</form>
<a class="quiet" href="${root}">All rooms</a>`,
        SHRINK_PHOTOS_SCRIPT,
      ),
    );
  });

  inspectionRoutes.post(`${prefix}/:iid/room/:room`, async (c) => {
    const insp = await find(c);
    const r = Number(c.req.param("room"));
    const room = insp?.rooms[r];
    if (!insp || !room || insp.status !== "draft") return c.text("Room not found", 404);
    const body = await c.req.parseBody({ all: true });
    for (const [i, item] of room.items.entries()) {
      const cond = String(body[`c${i}`] ?? "");
      if ((CONDITIONS as readonly string[]).includes(cond)) item.condition = cond as typeof item.condition;
      item.note = String(body[`n${i}`] ?? "").trim().slice(0, 500);
      const files = ([] as unknown[]).concat(body[`p${i}`] ?? []).filter((f): f is File => f instanceof File && f.size > 0);
      for (const file of files.slice(0, 6)) {
        const url = await savePhoto(c.env, file, `inspection/${insp.id}`);
        if (url) item.photos.push(url);
      }
    }
    await saveRooms(c.env, insp);
    const root = `${scope(c).root}/${insp.id}`;
    return c.redirect(r + 1 < insp.rooms.length ? `${root}/room/${r + 1}` : root, 303);
  });

  // Home details inside a staff inspection: the same fields as /admin/home, saved to Rentec straight away.
  inspectionRoutes.get(`${prefix}/:iid/details`, async (c) => {
    const insp = await find(c);
    const property = insp && scope(c).who === "staff" ? await getProperty(c.env, insp.property_id) : null;
    if (!insp || !property) return c.text("Inspection not found", 404);
    const root = `${scope(c).root}/${insp.id}`;
    return c.html(homeDetailsPage(property, false, { back: root, backLabel: "Back to the inspection", button: "Save to Rentec and continue" }));
  });

  inspectionRoutes.post(`${prefix}/:iid/details`, async (c) => {
    const insp = await find(c);
    const property = insp && scope(c).who === "staff" && insp.status === "draft" ? await getProperty(c.env, insp.property_id) : null;
    if (!insp || !property) return c.text("Inspection not found", 404);
    const saved = await saveHomeDetails(c.env, property, await c.req.parseBody());
    await c.env.DB.prepare("UPDATE inspections SET details = ? WHERE id = ?").bind(JSON.stringify(saved.fields), insp.id).run();
    return c.redirect(`${scope(c).root}/${insp.id}`, 303);
  });

  inspectionRoutes.post(`${prefix}/:iid/finish`, async (c) => {
    const insp = await find(c);
    if (!insp || insp.status !== "draft") return c.text("Inspection not found", 404);
    const body = await c.req.parseBody();
    const signed = String(body["signed"] ?? "").trim().slice(0, 120);
    if (!signed || body["confirm"] !== "1") return c.text("Please type your name and confirm", 400);
    const property = await getProperty(c.env, insp.property_id);
    const completedAt = new Date().toISOString();
    const finished: Inspection = { ...insp, status: "complete", signed_name: signed, completed_at: completedAt };

    const pdf = await buildInspectionPdf(c.env, finished, property, scope(c).tenant);
    const key = `reports/${insp.id}.pdf`;
    await c.env.PHOTOS.put(key, pdf, { httpMetadata: { contentType: "application/pdf" } });

    let uploaded = 0;
    const filename = `${KIND_LABELS[insp.kind]} ${completedAt.slice(0, 10)}${insp.done_by === "tenant" ? " (tenant)" : ""}.pdf`;
    try {
      await RentecClient.fromEnv(c.env).uploadPropertyFile(insp.property_id, filename, "application/pdf", pdf.buffer as ArrayBuffer);
      uploaded = 1;
    } catch (err) {
      console.error(`Inspection ${insp.id} upload to Rentec failed: ${err}`);
    }
    await c.env.DB.prepare(
      "UPDATE inspections SET status = 'complete', signed_name = ?, completed_at = ?, report_key = ?, uploaded_to_rentec = ? WHERE id = ?",
    )
      .bind(signed, completedAt, key, uploaded, insp.id)
      .run();
    return c.redirect(`${scope(c).root}/${insp.id}`, 303);
  });

  inspectionRoutes.get(`${prefix}/:iid/report.pdf`, async (c) => {
    const insp = await find(c);
    const object = insp?.report_key ? await c.env.PHOTOS.get(insp.report_key) : null;
    if (!insp || !object) return c.text("Report not found", 404);
    return new Response(object.body, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${insp.kind}-${insp.id.slice(0, 8)}.pdf"` } });
  });
}

