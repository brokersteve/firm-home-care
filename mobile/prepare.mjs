// Writes www/start.js, where the offline page's "Try again" goes. Run by `npm run sync` before `cap sync`.
import { writeFileSync } from "node:fs";

const site = process.env.FIRM_APP_URL ?? "https://home.firm.vip";
writeFileSync(new URL("./www/start.js", import.meta.url), `window.FIRM_START = ${JSON.stringify(`${site}/app`)};\n`);
