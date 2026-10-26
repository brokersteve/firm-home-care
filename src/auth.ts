import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env";
import { sign, verify } from "./links";

const COOKIE = "fhc_admin";

/** True for a request with the admin token in ?token= (which also signs this device in) or a valid admin cookie. */
export async function isAdmin(c: Context<{ Bindings: Env; Variables: any }>): Promise<boolean> {
  const secret = c.env.ADMIN_TOKEN;
  if (!secret) return false;
  if (c.req.query("token") === secret) {
    setCookie(c, COOKIE, await sign(secret, "admin"), { httpOnly: true, secure: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 90 });
    return true;
  }
  const cookie = getCookie(c, COOKIE);
  return Boolean(cookie && (await verify(secret, cookie, "admin")));
}
