// Renders the FIRM icon (../assets/icon.svg) into the source images @capacitor/assets turns into every
// iPhone and Android icon and splash size. Run with `npm run icons`.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");
const svg = readFileSync(new URL("../assets/icon.svg", import.meta.url), "utf8");
const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
// The drawing without its blue square, for Android's adaptive icon foreground.
const art = inner.replace(/<rect width="512" height="512"[^>]*\/>/, "");
const BRAND = "#1f5f8b";
mkdirSync(new URL("./assets", import.meta.url), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(file, size, body, transparent = false) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:${transparent ? "transparent" : BRAND}">${body}</body></html>`);
  await page.screenshot({ path: new URL(`./assets/${file}`, import.meta.url).pathname, omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
}
const box = (size, scale, content) => {
  const s = size * scale;
  const o = (size - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><g transform="translate(${o} ${o}) scale(${s / 512})">${content}</g></svg>`;
};
await render("icon-only.png", 1024, box(1024, 1, inner));
// Android crops adaptive icons to a circle or squircle: keep the drawing inside the middle 66%.
await render("icon-foreground.png", 1024, box(1024, 0.66, art), true);
await render("icon-background.png", 1024, "");
await render("splash.png", 2732, box(2732, 0.22, art));
await render("splash-dark.png", 2732, box(2732, 0.22, art));
await browser.close();
console.log("Wrote mobile/assets/");
