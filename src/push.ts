// Push notifications to the FIRM phone app, through Firebase Cloud Messaging (one service for iPhone and Android).
// FCM_SERVICE_ACCOUNT is the Firebase service account JSON. Without it, push is off and reminders go by email only.
import type { Env } from "./env";

export interface Push {
  title: string;
  body: string;
  /** The page the app opens when the notification is tapped. */
  url: string;
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

/** A short-lived Google access token for FCM, from the service account's signed JWT. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claims))}`;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google token failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** The FCM request body for one phone. */
export function fcmMessage(token: string, push: Push) {
  return {
    message: {
      token,
      notification: { title: push.title, body: push.body },
      data: { url: push.url },
      android: { notification: { icon: "ic_stat_firm", color: "#1f5f8b" } },
      apns: { payload: { aps: { sound: "default" } } },
    },
  };
}

/**
 * Sends a push to every phone the tenant has signed in on. Returns how many got it. Phones that uninstalled
 * the app are forgotten. Never throws for one bad phone; throws only when push isn't set up right.
 */
export async function pushToTenant(env: Env, tenantId: string, push: Push): Promise<number> {
  if (!env.FCM_SERVICE_ACCOUNT) return 0;
  const { results } = await env.DB.prepare("SELECT token FROM push_devices WHERE tenant_id = ?").bind(tenantId).all<{ token: string }>();
  if (!results.length) return 0;
  if (env.FCM_SERVICE_ACCOUNT === "log") {
    console.log(`PUSH to ${tenantId} (${results.length} phone${results.length === 1 ? "" : "s"}): ${push.title} | ${push.body} | ${push.url}`);
    return results.length;
  }
  const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
  const auth = await accessToken(sa);
  let sent = 0;
  for (const { token } of results) {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(fcmMessage(token, push)),
    });
    if (res.ok) {
      sent++;
    } else if (res.status === 404 || res.status === 400) {
      // UNREGISTERED or a malformed token: the app was removed or the token replaced.
      await env.DB.prepare("DELETE FROM push_devices WHERE token = ?").bind(token).run();
    } else {
      console.error(`Push to ${tenantId} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  }
  return sent;
}

/** Remembers a phone for a tenant. A token moves with whoever signed in last on that phone. */
export async function savePushDevice(env: Env, tenantId: string, token: string, platform: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO push_devices (token, tenant_id, platform, created_at, last_seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET tenant_id = excluded.tenant_id, platform = excluded.platform, last_seen = excluded.last_seen`,
  )
    .bind(token, tenantId, platform === "ios" ? "ios" : "android", now, now)
    .run();
}
