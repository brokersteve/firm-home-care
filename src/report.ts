import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import type { Env, Property, Tenant } from "./env";
import type { Inspection } from "./inspection";
import { KIND_LABELS } from "./inspection-template";
import { photoKey } from "./photos";

const PAGE = { width: 612, height: 792, margin: 48 }; // US Letter
const INK = rgb(0.11, 0.14, 0.16);
const QUIET = rgb(0.36, 0.4, 0.44);
const LINE = rgb(0.85, 0.87, 0.89);
const POOR = rgb(0.7, 0.15, 0.12);

/** The standard PDF fonts only cover basic Latin, so swap the few characters people commonly type. */
const plain = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/°/g, " deg")
    .replace(/[^\x20-\x7E]/g, "");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of plain(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private font: PDFFont,
    private bold: PDFFont,
    private footer: string,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
    const n = this.doc.getPageCount();
    this.page.drawText(plain(`${this.footer} - page ${n}`), { x: PAGE.margin, y: 24, size: 8, font: this.font, color: QUIET });
  }
  need(h: number) {
    if (this.y - h < PAGE.margin) this.newPage();
  }
  text(s: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.bold : this.font;
    const x = opts.x ?? PAGE.margin;
    for (const line of wrap(s, font, size, opts.width ?? PAGE.width - x - PAGE.margin)) {
      this.need(size + 4);
      this.page.drawText(line, { x, y: this.y - size, size, font, color: opts.color ?? INK });
      this.y -= size + 4;
    }
  }
  rule() {
    this.need(8);
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y - 3 }, end: { x: PAGE.width - PAGE.margin, y: this.y - 3 }, thickness: 0.75, color: LINE });
    this.y -= 8;
  }
  images(list: PDFImage[]) {
    const h = 96;
    let x = PAGE.margin + 12;
    this.need(h + 6);
    for (const img of list) {
      const w = Math.min(160, (img.width / img.height) * h);
      if (x + w > PAGE.width - PAGE.margin) {
        this.y -= h + 6;
        x = PAGE.margin + 12;
        this.need(h + 6);
      }
      this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
      x += w + 6;
    }
    this.y -= h + 8;
  }
}

async function embedPhoto(doc: PDFDocument, env: Env, url: string): Promise<PDFImage | null> {
  const key = photoKey(env, url);
  const object = key ? await env.PHOTOS.get(key) : null;
  if (!object) return null;
  const bytes = await object.arrayBuffer();
  try {
    if (key!.endsWith(".png")) return await doc.embedPng(bytes);
    if (key!.endsWith(".jpg")) return await doc.embedJpg(bytes);
  } catch {
    // An image the PDF library can't read is left out; the link stays in the app.
  }
  return null;
}

export async function buildInspectionPdf(env: Env, insp: Inspection, property: Property | null, tenant: Tenant | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${KIND_LABELS[insp.kind]} - ${property?.address ?? insp.property_id}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w = new Writer(doc, font, bold, `${KIND_LABELS[insp.kind]}, ${property?.address ?? ""}`);

  w.text(env.COMPANY_NAME, { size: 10, color: QUIET });
  w.text(KIND_LABELS[insp.kind], { size: 20, bold: true });
  w.y -= 4;
  w.text(property?.address ?? `Property ${insp.property_id}`, { size: 12 });
  if (tenant) w.text(`Tenant: ${tenant.first_name} ${tenant.last_name}`);
  w.text(`Completed ${insp.completed_at?.slice(0, 10) ?? ""} by ${insp.signed_name ?? ""} (${insp.done_by === "tenant" ? "tenant" : "F.I.R.M. staff"})`);
  w.y -= 8;

  const poor = insp.rooms.flatMap((r) => r.items.filter((i) => i.condition === "Poor").map((i) => `${r.name}: ${i.name}${i.note ? ` - ${i.note}` : ""}`));
  if (poor.length) {
    w.text("Items in poor condition", { size: 12, bold: true, color: POOR });
    for (const p of poor) w.text(`- ${p}`, { x: PAGE.margin + 8 });
    w.y -= 8;
  }

  for (const room of insp.rooms) {
    w.need(40);
    w.y -= 6;
    w.text(room.name, { size: 13, bold: true });
    w.rule();
    for (const item of room.items) {
      const startY = w.y;
      const startPage = w.page;
      w.text(item.name, { width: 200 });
      const nameBottom = w.y;
      if (w.page === startPage) w.y = startY;
      w.text(item.condition || "-", { x: PAGE.margin + 210, width: 60, bold: item.condition === "Poor", color: item.condition === "Poor" ? POOR : INK });
      if (w.page === startPage) w.y = startY;
      w.text(item.note, { x: PAGE.margin + 280, color: QUIET });
      w.y = Math.min(w.y, nameBottom);
      const imgs = (await Promise.all(item.photos.map((p) => embedPhoto(doc, env, p)))).filter((i): i is PDFImage => Boolean(i));
      if (imgs.length) w.images(imgs);
      w.y -= 2;
    }
  }

  w.y -= 16;
  w.need(60);
  w.text(`Signed electronically by ${insp.signed_name ?? ""} on ${insp.completed_at?.slice(0, 10) ?? ""}, who confirmed this report is accurate.`, { color: QUIET });
  return doc.save();
}
