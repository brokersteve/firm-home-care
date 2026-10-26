// Tenants never log in: every link we email carries an HMAC signature that only this app can make.

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 22);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(secret: string, ...parts: string[]): Promise<string> {
  return hmac(secret, parts.join("|"));
}

export async function verify(secret: string, signature: string, ...parts: string[]): Promise<boolean> {
  return safeEqual(await sign(secret, ...parts), signature);
}

export async function homeLink(appUrl: string, secret: string, tenantId: string): Promise<string> {
  return `${appUrl}/t/${encodeURIComponent(tenantId)}/${await sign(secret, "home", tenantId)}`;
}

export async function doneLink(appUrl: string, secret: string, tenantId: string, kind: string, dueDate: string): Promise<string> {
  const sig = await sign(secret, "done", tenantId, kind, dueDate);
  return `${appUrl}/done/${encodeURIComponent(tenantId)}/${kind}/${dueDate}/${sig}`;
}
