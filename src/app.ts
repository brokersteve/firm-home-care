// The FIRM phone app (iPhone and Android) is a native shell that opens these same pages, so the app and the
// web version never drift apart. This file holds what only the app needs:
// - /app, where the app starts: the tenant's own home page once they've signed in on that phone, otherwise
//   the emergency line and a sign-in by one-time code, sent to the cell or email F.I.R.M. has on file.
// - /app.js, loaded on every page, which does nothing in a browser. Inside the app it opens Resident Connect
//   (Rentec's tenant app) for rent and leases, turns on push reminders, and opens the page a notification points to.
// - The files Apple and Google read so links in emails open in the app when it's installed.
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import type { Env, Tenant } from "./env";
import { homeLink, sign, verify } from "./links";
import { emergencyCard, layout } from "./pages";
import { savePushDevice } from "./push";
import { sendEmail } from "./email";
import { sendText, toE164 } from "./sms";
import { findTenant } from "./start";
import { getTenant } from "./store";

/** The app adds this to its browser identity (capacitor.config.ts appendUserAgent). */
export const APP_AGENT = "FIRMApp";

/** Rentec's tenant app, Resident Connect. Rent, lease documents and insurance uploads stay there. */
export const RESIDENT_CONNECT = {
  android: "com.rentecdirect.app",
  ios: "https://apps.apple.com/us/app/resident-connect-rentec-direct/id1300312018",
  play: "https://play.google.com/store/apps/details?id=com.rentecdirect.app",
};

const COOKIE = "fhc_app";
const CODE_MINUTES = 15;
const MAX_TRIES = 5;
/** At most this many codes sent to one tenant per hour, counted with "send my link" requests on the start page. */
const MAX_PER_HOUR = 3;

type AppContext = Context<{ Bindings: Env; Variables: any }>;

export const isApp = (c: AppContext) => (c.req.header("User-Agent") ?? "").includes(APP_AGENT);

/** Keeps the tenant signed in on this phone: the app opens straight to their page next time. */
export async function rememberTenant(c: AppContext, tenantId: string): Promise<void> {
  const value = `${tenantId}.${await sign(c.env.LINK_SECRET, "app", tenantId)}`;
  setCookie(c, COOKIE, value, { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 400 });
}

async function signedInTenant(c: AppContext): Promise<Tenant | null> {
  const value = getCookie(c, COOKIE) ?? "";
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const id = value.slice(0, dot);
  if (!(await verify(c.env.LINK_SECRET, value.slice(dot + 1), "app", id))) return null;
  const tenant = await getTenant(c.env, id);
  return tenant && tenant.active ? tenant : null;
}

const codeHash = (env: Env, tenantId: string, code: string) => sign(env.LINK_SECRET, "code", tenantId, code);

function newCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0]! % 1_000_000;
  return String(n).padStart(6, "0");
}

/** The App Review demo sign-in: a fixed code for one test tenant, so Apple and Google can look around. */
function isReviewLogin(env: Env, typed: string, code?: string): boolean {
  if (!env.APP_REVIEW_EMAIL || !env.APP_REVIEW_CODE) return false;
  if (typed.trim().toLowerCase() !== env.APP_REVIEW_EMAIL.toLowerCase()) return false;
  return code === undefined || code === env.APP_REVIEW_CODE;
}

function signInPage(env: Env, notice = ""): ReturnType<typeof layout> {
  return layout(
    "Welcome",
    html`<h1>Welcome to FIRM</h1>
${emergencyCard(env)}
<div class="card" id="signin"><h2>Sign in</h2>
${notice ? html`<p class="card note">${notice}</p>` : ""}
<p class="quiet">For F.I.R.M. tenants. Enter the cell number or email F.I.R.M. has for you, and we'll send a 6-digit code. No password.</p>
<form method="post" action="/app/code"><label for="who">Cell number or email</label>
<input type="text" id="who" name="who" required autocomplete="email" inputmode="email" placeholder="704-555-0100 or you@example.com">
<button class="btn primary">Send my code</button></form></div>
<div class="card"><h2>Water leaking?</h2><p>Turn the small valve under the sink or behind the toilet clockwise. If water is spraying or spreading, shut off the main water to the home, then call.</p></div>
${env.WEBSITE_URL
  ? html`<div class="card"><h2>Looking for a home?</h2><p class="quiet">See F.I.R.M.'s homes for rent in the Charlotte area, or learn about us.</p>
<a class="btn" href="${env.WEBSITE_URL}/rentals">Homes for rent</a><a class="btn" href="${env.WEBSITE_URL}">Visit ${env.WEBSITE_URL.replace(/^https?:\/\/(www\.)?/, "")}</a></div>`
  : ""}`,
  );
}

function codePage(env: Env, who: string, error = ""): ReturnType<typeof layout> {
  return layout(
    "Enter your code",
    html`<h1>Enter your code</h1>
<div class="card">
${error ? html`<p class="card alert">${error}</p>` : ""}
<p class="quiet">If ${who} matches what F.I.R.M. has on file, a 6-digit code is on its way by ${who.includes("@") ? "email" : "text"}. It can take a minute and works for ${CODE_MINUTES} minutes.</p>
<form method="post" action="/app/verify"><input type="hidden" name="who" value="${who}">
<label for="code">6-digit code</label>
<input type="text" id="code" name="code" required inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6">
<button class="btn primary">Sign in</button></form>
<a class="btn" href="/app">Start over</a>
<p class="quiet">No code? Check the number or email F.I.R.M. has for you, or call the office.</p></div>
${emergencyCard(env)}`,
  );
}

export const appRoutes = new Hono<{ Bindings: Env; Variables: any }>();

appRoutes.get("/app", async (c) => {
  const tenant = await signedInTenant(c);
  if (tenant) return c.redirect(`${await homeLink(c.env.APP_URL, c.env.LINK_SECRET, tenant.id)}/`);
  if (getCookie(c, COOKIE)) deleteCookie(c, COOKIE, { path: "/" });
  return c.html(signInPage(c.env));
});

appRoutes.post("/app/code", async (c) => {
  const who = String((await c.req.parseBody())["who"] ?? "").trim().slice(0, 200);
  if (!who) return c.redirect("/app", 303);
  if (isReviewLogin(c.env, who)) return c.html(codePage(c.env, who));
  const match = await findTenant(c.env, who);
  // Same page whether or not it matched, so the form doesn't reveal who rents from F.I.R.M.
  if (match) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const recent = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM link_requests WHERE tenant_id = ? AND created_at > ?")
      .bind(match.tenant.id, since)
      .first<{ n: number }>();
    if ((recent?.n ?? 0) < MAX_PER_HOUR) {
      const code = newCode();
      const now = new Date();
      await c.env.DB.batch([
        c.env.DB.prepare("INSERT INTO link_requests (tenant_id, channel, created_at) VALUES (?, ?, ?)").bind(match.tenant.id, match.channel, now.toISOString()),
        c.env.DB.prepare("INSERT INTO app_codes (tenant_id, code_hash, expires_at) VALUES (?, ?, ?)").bind(
          match.tenant.id,
          await codeHash(c.env, match.tenant.id, code),
          new Date(now.getTime() + CODE_MINUTES * 60_000).toISOString(),
        ),
      ]);
      try {
        await sendCode(c.env, match.tenant, match.channel, code);
      } catch (err) {
        console.error(`App code for ${match.tenant.id} failed: ${err}`);
      }
    }
  }
  return c.html(codePage(c.env, who));
});

async function sendCode(env: Env, tenant: Tenant, channel: "email" | "text", code: string): Promise<void> {
  const line = `Your FIRM app code is ${code}. It works for ${CODE_MINUTES} minutes. If you didn't ask for it, you can ignore this.`;
  if (channel === "text") {
    const to = toE164(tenant.phone ?? "");
    if (to) await sendText(env, to, line);
  } else if (tenant.email) {
    await sendEmail(env, tenant.email, `Your FIRM app code: ${code}`, `<p>Hi ${tenant.first_name.replace(/[&<>"]/g, "")},</p><p>${line}</p>`);
  }
}

appRoutes.post("/app/verify", async (c) => {
  const body = await c.req.parseBody();
  const who = String(body["who"] ?? "").trim().slice(0, 200);
  const code = String(body["code"] ?? "").replace(/\D/g, "");
  const wrong = () => c.html(codePage(c.env, who, "That code didn't work. Check it and try again, or start over for a new one."), 400);

  if (isReviewLogin(c.env, who, code)) {
    const review = await findTenant(c.env, who);
    if (!review) return wrong();
    await rememberTenant(c, review.tenant.id);
    return c.redirect(`${await homeLink(c.env.APP_URL, c.env.LINK_SECRET, review.tenant.id)}/`, 303);
  }

  const match = code.length === 6 ? await findTenant(c.env, who) : null;
  if (!match) return wrong();
  const row = await c.env.DB.prepare(
    "SELECT id, code_hash, attempts FROM app_codes WHERE tenant_id = ? AND used_at IS NULL AND expires_at > ? ORDER BY id DESC LIMIT 1",
  )
    .bind(match.tenant.id, new Date().toISOString())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_TRIES) return wrong();
  if (row.code_hash !== (await codeHash(c.env, match.tenant.id, code))) {
    await c.env.DB.prepare("UPDATE app_codes SET attempts = attempts + 1 WHERE id = ?").bind(row.id).run();
    return wrong();
  }
  await c.env.DB.prepare("UPDATE app_codes SET used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  await rememberTenant(c, match.tenant.id);
  return c.redirect(`${await homeLink(c.env.APP_URL, c.env.LINK_SECRET, match.tenant.id)}/`, 303);
});

appRoutes.get("/app/signout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.redirect("/app");
});

/** The phone's push token, posted by /app.js from a tenant page (so the signed link says whose phone it is). */
export async function registerPush(c: AppContext, tenantId: string): Promise<Response> {
  const body = (await c.req.json().catch(() => ({}))) as { token?: unknown; platform?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 4096) return c.json({ ok: false }, 400);
  await savePushDevice(c.env, tenantId, token, String(body.platform ?? ""));
  return c.json({ ok: true });
}

appRoutes.get("/app.js", (c) =>
  c.body(appScript(c.env), 200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=3600" }),
);

/** The script every page loads. In a browser it stops on the first line. */
export function appScript(env: Pick<Env, "RESIDENT_CONNECT_URL">): string {
  const config = JSON.stringify({ rc: env.RESIDENT_CONNECT_URL, ...RESIDENT_CONNECT });
  return `(function(){
var C=window.Capacitor;if(!C||!C.isNativePlatform||!C.isNativePlatform())return;
var K=${config},P=C.Plugins||{},platform=C.getPlatform();
document.documentElement.classList.add('in-app');
var st=document.createElement('style');st.textContent='html.in-app main{padding-top:calc(16px + env(safe-area-inset-top,0px));padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))}';
document.head.appendChild(st);
var a2hs=document.getElementById('a2hs');if(a2hs)a2hs.hidden=true;

// Resident Connect: open Rentec's app if it's installed, otherwise its store page.
function openRentec(){
  var L=P.AppLauncher;
  if(!L){location.href=platform==='ios'?K.ios:K.play;return;}
  if(platform==='android'){
    L.canOpenUrl({url:K.android}).then(function(r){return L.openUrl({url:r.value?K.android:'market://details?id='+K.android});})
      .catch(function(){L.openUrl({url:K.play});});
  }else{L.openUrl({url:K.ios}).catch(function(){location.href=K.ios;});}
}
document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest&&e.target.closest('a[href]');
  if(a&&K.rc&&a.href.indexOf(K.rc)===0){e.preventDefault();openRentec();}
},true);

// A tapped notification, or an email link opened in the app, goes to its page.
function go(url){try{var u=new URL(url,location.href);if(u.host===location.host)location.href=u.pathname+u.search+u.hash;}catch(_){}}
if(P.App)P.App.addListener('appUrlOpen',function(e){go(e.url);});
var M=P.FirebaseMessaging;
if(M)M.addListener('notificationActionPerformed',function(e){var d=e&&e.notification&&e.notification.data;if(d&&d.url)go(d.url);});

var m=location.pathname.match(/^\\/t\\/[^\\/]+\\/[^\\/]+/);if(!m)return;
var home=location.pathname===m[0]+'/';
if(home){var main=document.querySelector('main'),out=document.createElement('p');out.className='quiet';
  out.innerHTML='<a href="/app/signout">Not you? Sign out of this phone</a>';if(main)main.appendChild(out);}
if(!M)return;
function register(){M.getToken().then(function(r){if(!r||!r.token)return;
  fetch(m[0]+'/push',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:r.token,platform:platform})});});}
M.checkPermissions().then(function(p){
  if(p.receive==='granted'){register();return;}
  if(p.receive==='denied'||!home)return;
  try{if(localStorage.getItem('fhc_push_later'))return;}catch(_){}
  var card=document.createElement('div');card.className='card note';
  card.innerHTML='<h2>Get reminders on this phone</h2><p>Air filters, detector checks and insurance renewal: a quick note on your phone when each one is due.</p>'+
    '<button class="btn primary" type="button">Turn on reminders</button><button class="btn" type="button">Not now</button>';
  var b=card.querySelectorAll('button');
  b[0].onclick=function(){M.requestPermissions().then(function(r){card.hidden=true;if(r.receive==='granted')register();});};
  b[1].onclick=function(){card.hidden=true;try{localStorage.setItem('fhc_push_later','1');}catch(_){}};
  var h=document.querySelector('main .alert');if(h&&h.parentNode)h.parentNode.insertBefore(card,h.nextSibling);
});
})();`;
}

// Links in emails and texts (/t/... and /app) open in the app when it's installed. Off until the app IDs are set.
appRoutes.get("/.well-known/apple-app-site-association", (c) => {
  if (!c.env.APPLE_TEAM_ID) return c.notFound();
  return c.json({
    applinks: { details: [{ appIDs: [`${c.env.APPLE_TEAM_ID}.${c.env.APP_ID}`], components: [{ "/": "/t/*" }, { "/": "/app" }] }] },
  });
});

appRoutes.get("/.well-known/assetlinks.json", (c) => {
  if (!c.env.ANDROID_CERT_SHA256) return c.notFound();
  return c.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: c.env.APP_ID, sha256_cert_fingerprints: c.env.ANDROID_CERT_SHA256.split(",").map((s) => s.trim()) },
    },
  ]);
});
