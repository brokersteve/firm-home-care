// Texts to vendors through Twilio. Nothing goes out between 9pm and 8am local time; those wait in texts_outbox.
import type { Env } from "./env";

export const TEXT_HOURS = { start: 8, end: 21 };

/** "(704) 555-0100" or "704.555.0100" → "+17045550100". Null when it isn't a US number. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

/** The local wall-clock parts of an instant in a time zone. */
function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return { y: +parts.year!, m: +parts.month!, d: +parts.day!, h: +parts.hour!, min: +parts.minute!, s: +parts.second! };
}

/** When a text may go out: now if it's 8am to 9pm local time, otherwise the next 8am. */
export function textSendTime(now: Date, timeZone: string): Date {
  const p = localParts(now, timeZone);
  if (p.h >= TEXT_HOURS.start && p.h < TEXT_HOURS.end) return now;
  // How far local time is ahead of UTC right now, to turn "8:00 local" back into an instant.
  const offset = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(now.getTime() / 1000) * 1000;
  const day = p.h >= TEXT_HOURS.end ? p.d + 1 : p.d;
  return new Date(Date.UTC(p.y, p.m - 1, day, TEXT_HOURS.start) - offset);
}

export async function sendText(env: Env, to: string, body: string): Promise<void> {
  // Local preview: set TWILIO_AUTH_TOKEN=log to print texts instead of sending them.
  if (env.TWILIO_AUTH_TOKEN === "log") {
    console.log(`TEXT to ${to}: ${body}`);
    return;
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body }),
  });
  if (!res.ok) throw new Error(`Text to ${to} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}
